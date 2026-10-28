import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { engine, realModel, registry, repo, AGENTS, agentPolicy } from './support/permission-fixtures.mjs';
import { pathToFileURL } from 'node:url';

const ops = (cmd) => engine.classify('powershell', { command: cmd }, realModel, repo, registry).ops.map((o) => o.op);
const decideFor = (agent, tool, args, extra = {}) => engine.decide({ agent, tool, args, cwd: repo, phase: 0, model: realModel, registry, scope: { shipowner: null, jurisdiction: null }, logDir: path.join(repo, '.harness-logs-test-unused'), audit: false, ...extra });

test('the model has five ordered tiers and the documented never-grantable list', () => {
  const t = realModel.perm.tiers;
  assert.deepEqual(Object.keys(t), ['P0', 'P1', 'P2', 'P3', 'P4']);
  assert.deepEqual(Object.values(t).map((x) => x.rank), [0, 1, 2, 3, 4]);
  for (const op of ['secret.read', 'data.cross-shipowner', 'data.cross-jurisdiction', 'regulatory.file', 'commercial.settle', 'git.protected.modify', 'azure.prod.any']) assert.ok(realModel.perm.neverGrantable.includes(op), op);
});

test('shell commands classify to the expected operation', () => {
  const table = [
    ['az group delete -n x', 'azure.delete'], ['azd down', 'azure.delete'], ['terraform destroy', 'azure.delete'], ['az account get-access-token', 'azure.secret.read'],
    ['az keyvault secret show --name x', 'azure.secret.read'], ['az deployment group create -g x', 'azure.nonprod.deploy'], ['azd up', 'azure.nonprod.deploy'],
    ['git status', 'git.read'], ['git commit -m x', 'git.write'], ['git push origin main', 'git.protected.modify'], ['npm test', 'exec.test'],
  ];
  for (const [cmd, op] of table) assert.ok(ops(cmd).includes(op), `${cmd} -> ${ops(cmd)}`);
});

test('an unknown tool, operation or command is denied for a named agent', () => {
  for (const agent of AGENTS) {
    assert.equal(decideFor(agent, 'totally_unknown_tool', {}).decision, 'deny', agent);
    assert.equal(decideFor(agent, 'powershell', { command: 'frobnicate --all' }).decision, 'deny', agent);
    assert.ok(decideFor(agent, 'powershell', { command: 'frobnicate --all' }).rules.includes('DEF-02'));
  }
});

test('an unrecognised segment in a chained command makes the whole command denied', () => {
  assert.equal(decideFor('qa-engineer', 'powershell', { command: 'git status && frobnicate' }).decision, 'deny');
  assert.equal(decideFor('qa-engineer', 'powershell', { command: 'git status\nfrobnicate' }).decision, 'deny');
});

test('every agent ceiling is P0 or P1 and none reaches Azure', () => {
  for (const [agent, c] of Object.entries(realModel.perm.agentCeilings)) {
    assert.ok(AGENTS.includes(agent), agent);
    for (const [env, tier] of Object.entries(c)) { assert.ok(tier <= 1, `${agent} ${env}`); assert.ok(!env.startsWith('azure'), `${agent} must have no standing Azure ceiling`); }
  }
  assert.deepEqual(Object.keys(realModel.perm.agentCeilings).sort(), [...AGENTS].sort());
});

test('path classification handles traversal, case, backslashes, file URLs and absolute paths', () => {
  const owner = 'tests/fixtures/shipowners/owner-b/x.json';
  for (const spelling of [owner, `./${owner}`, 'tests/fixtures/shipowners/owner-a/../owner-b/x.json', owner.toUpperCase(), owner.replace(/\//g, '\\'), path.join(repo, owner), `file://${pathToFileURL(path.join(repo, owner)).pathname}`]) {
    const rel = engine.toRel(spelling, repo, repo);
    const info = engine.classifyPath(rel, realModel);
    assert.ok(info.classes.includes('shipowner'), spelling);
    assert.equal(String(info.owner).toLowerCase(), 'owner-b', spelling);
  }
  for (const s of ['.env', 'a/b/.env.local', 'keys/server.pem', 'x/id_rsa', '.npmrc']) assert.ok(engine.classifyPath(engine.toRel(s, repo, repo), realModel).classes.includes('secret'), s);
  assert.ok(engine.classifyPath('harness/policy/permissions.json', realModel).classes.includes('control-plane'));
  assert.ok(engine.classifyPath('docs/approvals/AP-1.json', realModel).classes.includes('control-plane'));
  assert.deepEqual(engine.classifyPath('docs/context/BUSINESS-CASE.md', realModel).classes, []);
});

test('a path outside the repository is not mistaken for a repository path', () => {
  assert.equal(engine.toRel('C:/Windows/System32/drivers/etc/hosts', repo, repo).startsWith('C:'), true);
});

test('filterIsolated keeps the scoped owner and ordinary lines, drops others, and is fail-closed with no scope', () => {
  const text = ['tests/fixtures/shipowners/owner-a/f.json:1:a', 'tests/fixtures/shipowners/owner-b/f.json:1:b', 'docs/x.md:1:plain', '.env:1:KEY=1'].join('\n');
  const scoped = engine.filterIsolated(text, { shipowner: 'owner-a', jurisdiction: null }, realModel);
  assert.match(scoped.text, /owner-a/); assert.doesNotMatch(scoped.text, /owner-b/); assert.match(scoped.text, /plain/); assert.doesNotMatch(scoped.text, /KEY=1/);
  assert.equal(scoped.removed, 2);
  const none = engine.filterIsolated(text, { shipowner: null, jurisdiction: null }, realModel);
  assert.doesNotMatch(none.text, /owner-a|owner-b/); assert.equal(none.removed, 3);
});

test('a read-only tool call by a planner is allowed and carries no approval', () => {
  const d = decideFor('maritime-domain', 'view', { path: 'docs/context/BUSINESS-CASE.md' });
  assert.equal(d.decision, 'allow');
  assert.deepEqual(d.approvals, []);
});

test('writing the control plane is denied for every agent even when the path is otherwise in scope', () => {
  for (const agent of AGENTS) for (const p of ['harness/policy/permissions.json', 'harness/policy/approvers.json', 'docs/approvals/AP-1.json', 'harness/hooks/permission-engine.cjs']) {
    const d = decideFor(agent, 'edit', { path: p });
    assert.equal(d.decision, 'deny', `${agent} ${p}`);
    assert.ok(d.rules.includes('CTL-01'), `${agent} ${p}: ${d.rules}`);
  }
});

test('the agent policy and the permission ceilings agree on who can run a shell', () => {
  for (const [agent, def] of Object.entries(agentPolicy.agents)) {
    const hasShell = def.tools.some((t) => ['execute', 'powershell', 'bash'].includes(t)) && (def.commands ?? []).length > 0;
    const ceiling = realModel.perm.agentCeilings[agent]['local-exec'] ?? 0;
    assert.equal(hasShell ? ceiling >= 1 : ceiling === 0, true, agent);
  }
});

test('run state and the orchestration policy are control plane: no agent may write them, even with a write scope that overlaps', () => {
  for (const agent of AGENTS) for (const p of ['docs/state/runs/RUN-0123456789/run.json', 'docs/state/runs/RUN-0123456789/events.jsonl', 'docs/state/runs/RUN-0123456789/results/T1-a1.md', 'harness/policy/orchestration-policy.json', 'harness/orchestration/engine.cjs']) {
    const d = decideFor(agent, 'edit', { path: p });
    assert.equal(d.decision, 'deny', `${agent} ${p}`);
    assert.ok(d.rules.includes('CTL-01'), `${agent} ${p}: ${d.rules}`);
  }
  assert.equal(decideFor('principal-architect', 'edit', { path: 'docs/state/STATE.md' }).decision, 'allow', 'the rest of docs/state is still writable by its owner');
});
