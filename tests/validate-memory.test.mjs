// Memory wiring: the validator and what it rejects, the read-only MCP tools, the control-plane rule that keeps agents from
// writing memory, and the CLI's write rules. Store behaviour itself is covered by memory.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { engine, repo, realModel, registry, AGENTS, tmpDir, agentHook } from './support/permission-fixtures.mjs';
import { validateMemory, ledgerAnchorProblems } from '../harness/scripts/validate-memory.mjs';
import { callTool, handle, resetForTests, TOOLS } from '../harness/mcp/greenfuel-tools-server.mjs';

const FILES = ['harness/policy', 'harness/memory', 'harness/hooks', 'harness/approvals', 'harness/scripts/memory.mjs', 'harness/tools/tool-registry.json', '.mcp.json', '.github/agents', 'docs/memory', 'docs/adr', 'docs/architecture/HARD-CONSTRAINTS.md', 'memory'];
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vm-'));
  for (const f of FILES) { mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); cpSync(path.join(repo, f), path.join(root, f), { recursive: true, filter: (s) => !s.includes('.lock') }); }
  return root;
}
const editJson = (root, rel, fn) => { const f = path.join(root, rel); const j = JSON.parse(readFileSync(f, 'utf8')); fn(j); writeFileSync(f, JSON.stringify(j, null, 2)); };
const editText = (root, rel, fn) => { const f = path.join(root, rel); writeFileSync(f, fn(readFileSync(f, 'utf8'))); };
const errorsOf = (root) => validateMemory(root).map((e) => e.msg);
const POLICY = 'harness/policy/memory-policy.json';

test('the committed memory configuration and data pass', () => assert.deepEqual(errorsOf(repo), []));

const mutations = [
  ['an agent that can create authoritative entries', (r) => editJson(r, POLICY, (j) => { j.writers.agent.maxTrust = 'authoritative'; }), /writer agent must not be able to create authoritative/],
  ['an agent that can approve', (r) => editJson(r, POLICY, (j) => { j.writers.agent.may.push('approve'); }), /writer agent must not approve/],
  ['a tool writer that is not quarantined', (r) => editJson(r, POLICY, (j) => { j.writers.tool.quarantine = false; }), /writer tool must be quarantined/],
  ['a document writer trusted above untrusted', (r) => editJson(r, POLICY, (j) => { j.writers.document.maxTrust = 'unreviewed'; }), /writer document must be quarantined at untrusted/],
  ['the importer without verified approvals', (r) => editJson(r, POLICY, (j) => { delete j.writers.importer.requiresVerifiedApproval; }), /importer must require a verified approval/],
  ['the engine without evidence', (r) => editJson(r, POLICY, (j) => { delete j.writers.engine.requiresEvidence; }), /engine entries must cite evidence/],
  ['retired knowledge still returned', (r) => editJson(r, POLICY, (j) => { j.statusFactors.superseded = 0.5; }), /status factor for superseded must be 0/],
  ['recency that outranks authority', (r) => editJson(r, POLICY, (j) => { j.retrieval.recencyWeight = 0.5; }), /small tie-breaker/],
  ['authority that is not ordered', (r) => editJson(r, POLICY, (j) => { j.authorityWeights.reviewed = 0.3; }), /authority weights must rise/],
  ['a decision that expires by itself', (r) => editJson(r, POLICY, (j) => { j.ttlDays.decision = 30; }), /decision must not expire by itself/],
  ['an episodic kind without an expiry', (r) => editJson(r, POLICY, (j) => { j.ttlDays.lesson = null; }), /episodic memory needs an expiry/],
  ['a constraint that can be proposed', (r) => editJson(r, POLICY, (j) => { j.kinds.constraint.statuses.push('proposed'); }), /a constraint exists only as approved/],
  ['a missing writer', (r) => editJson(r, POLICY, (j) => { delete j.writers.tool; }), /writer tool is missing/],
  ['no sensitive-data patterns', (r) => editJson(r, POLICY, (j) => { j.sensitive.customer = []; }), /sensitive.customer patterns are required/],
  ['memory no longer a control-plane path', (r) => editJson(r, 'harness/policy/permissions.json', (j) => { const c = j.pathClasses.find((x) => x.id === 'control-plane'); c.pattern = c.pattern.replace('memory/|', ''); }), /memory\/ must be a control-plane path/],
  ['a mutating memory tool in the registry', (r) => editJson(r, 'harness/tools/tool-registry.json', (j) => { j.tools.find((t) => t.name === 'memory_search').mutation = 'local'; }), /must be an enabled, read-local, non-mutating tool/],
  ['a missing memory tool in the registry', (r) => editJson(r, 'harness/tools/tool-registry.json', (j) => { j.tools = j.tools.filter((t) => t.name !== 'memory_resume'); }), /memory_resume is missing/],
  ['a memory tool left out of the allow-list', (r) => editJson(r, '.mcp.json', (j) => { j.mcpServers['greenfuel-tools'].tools = j.mcpServers['greenfuel-tools'].tools.filter((t) => t !== 'memory_resume'); }), /memory_resume is not in the greenfuel-tools allow-list/],
  ['a memory write tool in the allow-list', (r) => editJson(r, '.mcp.json', (j) => { j.mcpServers['greenfuel-tools'].tools.push('memory_write'); }), /would let an agent write memory/],
  ['an agent file out of step with the policy', (r) => editText(r, '.github/agents/orchestrator.agent.md', (t) => t.replace(", 'greenfuel-tools/memory_search'", '')), /memory_search must be granted in both/],
  ['a grant in the policy only', (r) => editJson(r, 'harness/policy/agent-policy.json', (j) => { j.agents['qa-engineer'].mcp.push('greenfuel-tools/memory_search'); }), /qa-engineer: memory_search must be granted in both/],
  ['an unknown memory tool granted', (r) => editJson(r, 'harness/policy/agent-policy.json', (j) => { j.agents['qa-engineer'].mcp.push('greenfuel-tools/memory_write'); }), /grants unknown memory tool/],
  ['a document that dropped a required topic', (r) => editText(r, 'docs/memory/MEMORY-MODEL.md', (t) => t.replaceAll('Why not SQLite', 'Why not a database')), /must cover 'Why not SQLite'/],
  ['an approved entry deleted', (r) => fs.rmSync(path.join(r, 'memory/decisions/DEC-0003.json')), /recorded in the ledger but its file is missing/],
  ['an approved entry deleted, snapshot not updated', (r) => fs.rmSync(path.join(r, 'memory/decisions/DEC-0003.json')), /CURRENT.json does not match/],
  ['an approved statement edited in place', (r) => editJson(r, 'memory/decisions/DEC-0003.json', (j) => { j.statement = 'Something else entirely.'; }), /changed outside the store/],
  ['a missing snapshot', (r) => fs.rmSync(path.join(r, 'memory/architecture-state/CURRENT.json')), /CURRENT.json is missing/],
  ['a constraint unpinned by hand', (r) => editJson(r, 'memory/architecture-state/CON-0001.json', (j) => { j.critical = false; }), /changed outside the store/],
  ['an entry with a stray field', (r) => editJson(r, 'memory/lessons/LES-0001.json', (j) => { j.payload = 'x'; }), /unknown field 'payload'/],
  ['a file in the wrong folder', (r) => { fs.renameSync(path.join(r, 'memory/lessons/LES-0001.json'), path.join(r, 'memory/decisions/LES-0001.json')); }, /belongs in memory\/lessons/],
  ['an ADR that is no longer Accepted while memory says approved', (r) => editText(r, 'docs/adr/0009-task-execution-framework.md', (t) => t.replace('**Status:** Accepted', '**Status:** Proposed')), /approval does not verify|DEC-0009 is approved but ADR-0009 is Proposed/],
  ['an Accepted ADR missing from memory', (r) => fs.writeFileSync(path.join(r, 'docs/adr/0099-new.md'), '# ADR 0099: New thing\n\n- **Status:** Accepted\n- **Date:** 2026-01-01\n\n## Decision\nDo it.\n'), /ADR-0099 is Accepted but has no memory entry/],
  ['a hard constraint missing from memory', (r) => editText(r, 'docs/architecture/HARD-CONSTRAINTS.md', (t) => `${t}\n| HC-99 | A new rule nobody imported |\n`), /HC-99 is a hard constraint with no memory entry/],
  ['a ledger row removed', (r) => editText(r, 'memory/ledger.jsonl', (t) => `${t.split('\n').filter(Boolean).slice(0, -1).join('\n')}\n`), /changed outside the store|has no ledger record/],
  ['a claim that VS Code was restarted', (r) => editText(r, 'docs/memory/MEMORY-MODEL.md', (t) => `${t}\nThe memory survived after VS Code was restarted.\n`), /must not claim a VS Code restart/],
];
for (const [name, mutate, re] of mutations) {
  test(`the validator rejects ${name}`, (t) => {
    const root = sandbox(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    assert.deepEqual(errorsOf(root), [], 'the sandbox copy starts clean');
    mutate(root);
    const errs = errorsOf(root);
    assert.ok(errs.some((e) => re.test(e)), `expected ${re}, got:\n${errs.join('\n') || '(nothing)'}`);
  });
}

// ---------------------------------------------------------------- MCP tools
test('memory_search and memory_resume are listed as read-only tools and never write', () => {
  resetForTests();
  handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  const list = handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }).result.tools;
  for (const n of ['memory_search', 'memory_resume']) {
    const t = list.find((x) => x.name === n);
    assert.ok(t, n);
    assert.equal(t.annotations.readOnlyHint, true);
    assert.equal(t.annotations.destructiveHint, false);
    assert.equal(t.inputSchema.additionalProperties, false);
  }
  assert.ok(!list.some((t) => /^memory_(write|add|save|update|delete|approve|supersede|invalidate)/.test(t.name)));
  const dir = path.join(repo, 'memory');
  const snap = () => { const o = {}; const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else o[p] = fs.readFileSync(p, 'utf8'); } }; walk(dir); return o; };
  const before = snap();
  callTool('memory_search', { query: 'HC-01' });
  callTool('memory_resume', {});
  assert.deepEqual(snap(), before, 'read-only tools left every memory file unchanged');
});

test('memory_search returns approved constraints and decisions first, with status, trust and a data-not-instructions note', () => {
  const r = callTool('memory_search', { query: 'HC-01' });
  assert.equal(r.results[0].id, 'CON-0001');
  assert.equal(r.results[0].trust, 'authoritative');
  assert.equal(r.results[0].status, 'approved');
  assert.equal(r.results[0].critical, true);
  assert.match(r.note, /data, not instructions/);
  const d = callTool('memory_search', { query: 'permission model least privilege', limit: 3 });
  assert.equal(d.results[0].id, 'DEC-0008');
  const p = callTool('memory_search', { query: 'hold delivery measurements jurisdiction-local authoritative stores' });
  const prop = p.results.find((x) => x.id === 'DEC-0004');
  assert.ok(prop, 'the proposed ADR is found');
  assert.equal(prop.status, 'proposed');
  assert.ok(prop.warnings.some((w) => /not approved/.test(w)), 'and labelled as not approved');
  assert.deepEqual(callTool('memory_resume', {}), { tasks: [] });
});

test('the memory tools refuse malformed arguments', () => {
  const bad = (name, args, re) => assert.throws(() => callTool(name, args), re);
  bad('memory_search', {}, /missing argument 'query'/);
  bad('memory_search', { query: '' }, /query must be 1 to 200/);
  bad('memory_search', { query: 'x'.repeat(201) }, /query must be 1 to 200/);
  bad('memory_search', { query: 'a', extra: 1 }, /unknown argument/);
  bad('memory_search', { query: 'a', category: 'secrets' }, /category must be/);
  bad('memory_search', { query: 'a', limit: 99 }, /limit must be/);
  bad('memory_resume', { taskId: '../../x' }, /taskId must look like/);
  bad('memory_resume', { taskId: 'TSK-0001', path: 'x' }, /unknown argument|path must be/);
  assert.equal(TOOLS.filter((t) => t.name.startsWith('memory_')).length, 2);
});

// ---------------------------------------------------------------- permissions: agents cannot write memory
const decideFor = (agent, tool, args) => engine.decide({ agent, tool, args, cwd: repo, phase: 0, model: realModel, registry, scope: { shipowner: null, jurisdiction: null }, logDir: path.join(repo, '.harness-logs-test-unused'), audit: false });

test('memory files are a control-plane path: no agent may edit them, and no agent may run the memory CLI', () => {
  assert.ok(engine.classifyPath('memory/decisions/DEC-0001.json', realModel).classes.includes('control-plane'));
  assert.ok(engine.classifyPath('memory/ledger.jsonl', realModel).classes.includes('control-plane'));
  for (const agent of AGENTS) {
    for (const p of ['memory/decisions/DEC-0001.json', 'memory/architecture-state/CURRENT.json', 'memory/ledger.jsonl', 'memory/task-state/TSK-0001.json', 'memory/lessons/LES-9999.json']) {
      const d = decideFor(agent, 'edit', { path: p });
      assert.equal(d.decision, 'deny', `${agent} ${p}`);
      assert.ok(d.rules.includes('CTL-01'), `${agent} ${p}: ${d.rules}`);
    }
    for (const cmd of ['node harness/scripts/memory.mjs add --file x.json --as human:owner', 'node harness/scripts/memory.mjs approve DEC-0004 --adr ADR-0004 --as human:owner', 'node harness/scripts/memory.mjs verify']) {
      const h = agentHook(agent, 'powershell', { command: cmd });
      assert.equal(h.denied, true, `${agent}: ${cmd} (${h.reason})`);
    }
  }
});

test('an agent cannot bypass the block by delegating: the denial depends on the acting agent, and every agent is denied', () => {
  const denies = AGENTS.map((a) => decideFor(a, 'edit', { path: 'memory/decisions/DEC-0004.json' }).decision);
  assert.ok(denies.every((d) => d === 'deny'));
});

// ---------------------------------------------------------------- the CLI
function cliEnv(dir) { const e = { ...process.env, HARNESS_MEMORY_DIR: path.join(dir, 'memory'), HARNESS_LOG_DIR: path.join(dir, 'logs'), HARNESS_ADR_DIR: path.join(repo, 'tests/fixtures/memory/adr') }; delete e.NODE_TEST_CONTEXT; return e; }
const run = (dir, args) => spawnSync(process.execPath, [path.join(repo, 'harness/scripts/memory.mjs'), ...args], { env: cliEnv(dir), encoding: 'utf8', cwd: os.tmpdir() });

test('the CLI needs a named writer for every write, and the writer type decides what is accepted', () => {
  const dir = tmpDir('gf-memcli-');
  const entry = (extra = {}) => ({ kind: 'proposal', title: 'Use queues at the edge', statement: 'Queue deliveries at the edge until the link returns.', subject: 'edge.sync', position: 'queue-first', tags: ['edge'], refs: ['NFR-001'], owner: 'principal-architect', critical: false, provenance: { source: 'human', ref: 'chat:2026-01-01', trust: 'unreviewed', evidence: [] }, validity: { status: 'proposed' }, ...extra });
  const file = path.join(dir, 'entry.json'); writeFileSync(file, JSON.stringify(entry()));

  let r = run(dir, ['add', '--file', file]);
  assert.equal(r.status, 2);
  assert.equal(JSON.parse(r.stdout).error, 'USAGE');
  assert.ok(!fs.existsSync(path.join(dir, 'memory/decisions')), 'nothing was written');

  const approvedFile = path.join(dir, 'approved.json');
  writeFileSync(approvedFile, JSON.stringify(entry({ kind: 'decision', provenance: { source: 'human', ref: 'ADR-0101', trust: 'authoritative', evidence: [] }, approval: { by: 'programme-owner', at: new Date().toISOString(), ref: 'ADR-0101' }, validity: { status: 'approved' }, owner: 'programme-owner' })));
  r = run(dir, ['add', '--file', approvedFile, '--as', 'agent:principal-architect']);
  assert.equal(r.status, 3, r.stdout);
  assert.equal(JSON.parse(r.stdout).error, 'DENIED');
  assert.ok(!fs.existsSync(path.join(dir, 'memory/decisions')), 'the denied write left no file');
  assert.ok(fs.readFileSync(path.join(dir, 'logs/memory-denied.jsonl'), 'utf8').includes('may not create a decision'));

  r = run(dir, ['add', '--file', file, '--as', 'human:owner-a']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).id, 'PRO-0001');
  r = run(dir, ['list', '--kind', 'proposal']);
  assert.equal(JSON.parse(r.stdout).entries[0].id, 'PRO-0001');
  r = run(dir, ['verify']);
  assert.equal(r.status, 0, r.stdout);
  r = run(dir, ['add', '--file', file, '--as', 'bad writer']);
  assert.equal(r.status, 2);

  r = run(dir, ['approve', 'PRO-0001', '--adr', 'ADR-0101', '--as', 'human:owner-a']);
  assert.equal(r.status, 3, 'a proposal-kind entry is not a decision and cannot be approved');
  const denied = run(dir, ['denied', '--last', '5']);
  assert.ok(JSON.parse(denied.stdout).count >= 2);
});

// ---------------------------------------------------------------- ledger anchored in Git; task list filter
const gitOk = spawnSync('git', ['--version']).status === 0;
test('a whole-folder rollback or rewrite of the memory ledger is detected against Git, a legitimate append is not', { skip: !gitOk }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-led-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'memory'), { recursive: true });
  const rows = fs.readFileSync(path.join(repo, 'memory/ledger.jsonl'), 'utf8').split('\n').filter(Boolean);
  assert.ok(rows.length > 3);
  const ledger = path.join(root, 'memory/ledger.jsonl');
  const write = (r) => writeFileSync(ledger, `${r.join('\n')}\n`);
  const git = (...a) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-C', root, ...a], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
  git('init', '-q'); write(rows); git('add', '.'); git('commit', '-q', '-m', 'memory');
  assert.deepEqual(ledgerAnchorProblems(root, ['HEAD']).problems, [], 'unchanged');
  write([...rows, rows.at(-1)]);
  assert.deepEqual(ledgerAnchorProblems(root, ['HEAD']).problems, [], 'an append is allowed');
  write(rows.slice(0, -2));
  assert.match(ledgerAnchorProblems(root, ['HEAD']).problems[0], /fewer rows than at HEAD.*rolled back/);
  write([rows[0].replace('"op":"create"', '"op":"approve"'), ...rows.slice(1)]);
  assert.match(ledgerAnchorProblems(root, ['HEAD']).problems[0], /differs from HEAD at row 1: history was rewritten/);
  const none = ledgerAnchorProblems(os.tmpdir(), ['HEAD']);
  assert.ok(none.skipped, 'outside a Git top level the check is skipped, not failed');
});

test('memory_resume lists only active or interrupted tasks that have not expired', (t) => {
  const dir = tmpDir('gf-memtask-');
  const prev = { m: process.env.HARNESS_MEMORY_DIR, l: process.env.HARNESS_LOG_DIR };
  process.env.HARNESS_MEMORY_DIR = path.join(dir, 'memory'); process.env.HARNESS_LOG_DIR = path.join(dir, 'logs');
  t.after(() => { for (const [k, v] of [['HARNESS_MEMORY_DIR', prev.m], ['HARNESS_LOG_DIR', prev.l]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const store = createRequire(import.meta.url)('../harness/memory/store.cjs');
  const ctx = store.makeContext();
  const w = { type: 'agent', name: 'orchestrator' };
  const a = store.taskStart(ctx, { objective: 'Still going', requirements: ['BR-002'], owner: 'orchestrator' }, w);
  const b = store.taskStart(ctx, { objective: 'Finished work', requirements: ['BR-002'], owner: 'orchestrator' }, w);
  store.taskSetState(ctx, b.id, 'completed', w);
  const list = callTool('memory_resume', {}).tasks;
  assert.deepEqual(list.map((x) => x.id), [a.id]);
});
