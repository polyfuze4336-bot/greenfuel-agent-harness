import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { evaluate, globToRe } = require('../harness/hooks/agent-guard.cjs');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policy = JSON.parse(readFileSync(path.join(repo, 'harness/policy/agent-policy.json'), 'utf8'));

const run = (agent, toolName, toolArgs, phase = 0) => evaluate({ toolName, toolArgs, cwd: repo }, agent, policy, phase);
const denied = (v, re) => { assert.ok(v && v.decision === 'deny', `expected deny, got ${JSON.stringify(v)}`); if (re) assert.match(v.reason, re); };

test('globs: ** crosses folders, * does not', () => {
  assert.ok(globToRe('docs/adr/**').test('docs/adr/0006-x.md'));
  assert.ok(globToRe('docs/adr/**').test('docs/adr/sub/x.md'));
  assert.ok(!globToRe('docs/adr/*.md').test('docs/adr/sub/x.md'));
  assert.ok(!globToRe('docs/adr/**').test('docs/adrx/y.md'));
});

test('planners cannot write at all', () => {
  for (const a of ['orchestrator', 'maritime-domain', 'security-reviewer', 'architecture-critic']) {
    denied(run(a, 'edit', { path: 'docs/state/STATE.md' }), /read-only/);
    denied(run(a, 'create', { path: 'docs/design/x.md' }), /read-only/);
  }
});

test('authors write only inside their own scope', () => {
  assert.equal(run('azure-platform', 'create', { path: 'docs/design/azure/net.md' }), null);
  denied(run('azure-platform', 'edit', { path: 'docs/design/data/x.md' }), /may write only/);
  denied(run('azure-platform', 'edit', { path: 'harness/policy/agent-policy.json' }), /may write only/);
  denied(run('azure-platform', 'edit', { path: '.github/agents/azure-platform.agent.md' }), /may write only/);
  denied(run('data-engineer', 'edit', { path: 'docs/design/azure/x.md' }), /may write only/);
  assert.equal(run('principal-architect', 'edit', { path: 'docs/adr/0006-x.md' }), null);
});

test('absolute and file-URI paths are normalised, traversal is refused', () => {
  const abs = path.join(repo, 'docs', 'design', 'azure', 'x.md');
  assert.equal(evaluate({ toolName: 'create', toolArgs: { path: abs }, cwd: repo }, 'azure-platform', policy, 0), null);
  denied(evaluate({ toolName: 'create', toolArgs: { path: 'docs/design/azure/../../../harness/x.md' }, cwd: repo }, 'azure-platform', policy, 0));
});

test('apply_patch targets are extracted from the patch text', () => {
  const patch = '*** Begin Patch\n*** Update File: harness/policy/command-policy.json\n@@\n-a\n+b\n*** End Patch';
  denied(run('azure-platform', 'apply_patch', { input: patch }));
  denied(run('azure-platform', 'apply_patch', { input: '*** Add File: docs/design/azure/ok.md\n+x\n*** Add File: src/x.js\n+y' }));
});

test('a write with no determinable path is refused', () => denied(run('data-engineer', 'edit', {}), /cannot determine/));

test('phase-1 product paths stay closed until the phase is raised', () => {
  denied(run('application-engineer', 'create', { path: 'src/api/x.ts' }, 0), /may write only/);
  assert.equal(run('application-engineer', 'create', { path: 'src/api/x.ts' }, 1), null);
  denied(run('application-engineer', 'create', { path: 'src/data/x.ts' }, 1), /may write only/);
});

test('only designated executors may run commands, and only allow-listed ones', () => {
  denied(run('principal-architect', 'powershell', { command: 'git status' }), /may not run commands/);
  denied(run('azure-platform', 'bash', { command: 'az group create -n x' }), /may not run commands/);
  assert.equal(run('qa-engineer', 'powershell', { command: 'npm test' }), null);
  assert.equal(run('qa-engineer', 'powershell', { command: 'node --test tests/a.test.mjs' }), null);
  assert.equal(run('qa-engineer', 'powershell', { command: 'git diff HEAD~1' }), null);
  for (const c of ['npm install left-pad', 'azd up', 'git push', 'git commit -m x', 'node -e 1', 'node --test --eval x', 'git diff --output=x', 'npm test && rm -rf x', 'npm test | tee x', 'npm test > out.txt', 'npm test; azd up', 'npm test `whoami`', 'npm test $(whoami)']) {
    denied(run('qa-engineer', 'powershell', { command: c }));
  }
  assert.equal(run('design-reviewer', 'bash', { command: 'node harness/scripts/design-gate.mjs --select DES-0001' }), null);
  denied(run('design-reviewer', 'bash', { command: 'npm test' }), /allow-list/);
});

test('web access only for azure-platform', () => {
  assert.equal(run('azure-platform', 'web_fetch', { url: 'https://learn.microsoft.com' }), null);
  for (const a of Object.keys(policy.agents).filter((x) => x !== 'azure-platform')) denied(run(a, 'web_fetch', { url: 'https://example.com' }), /no web access/);
});

test('delegation: only the orchestrator, only to listed agents, never to itself', () => {
  assert.equal(run('orchestrator', 'task', { agent_type: 'principal-architect', prompt: 'x' }), null);
  assert.equal(run('orchestrator', 'task', { agent_type: 'architecture-critic', prompt: 'x' }), null);
  denied(run('orchestrator', 'task', { agent_type: 'orchestrator', prompt: 'x' }), /self-delegation/);
  denied(run('orchestrator', 'task', { agent_type: 'general-purpose', prompt: 'x' }), /not a permitted/);
  denied(run('orchestrator', 'task', { prompt: 'x' }), /must name/);
  for (const a of Object.keys(policy.agents).filter((x) => x !== 'orchestrator')) denied(run(a, 'task', { agent_type: 'principal-architect', prompt: 'x' }), /may not delegate/);
});

test('read tools are never blocked by the guard', () => {
  for (const t of ['view', 'grep', 'glob', 'report_intent', 'read_agent']) assert.equal(run('architecture-critic', t, { path: 'README.md' }), null);
});

test('encoded, UNC and drive-qualified paths cannot escape the scope', () => {
  const uri = 'file:///' + repo.replace(/\\/g, '/') + '/docs/design/azure/%2e%2e/%2e%2e/%2e%2e/harness/policy/agent-policy.json';
  denied(evaluate({ toolName: 'edit', toolArgs: { uri }, cwd: repo }, 'azure-platform', policy, 0));
  denied(run('azure-platform', 'edit', { path: 'docs/design/azure/%2e%2e/x.md' }));
  denied(run('azure-platform', 'edit', { path: '\\\\server\\share\\docs\\design\\azure\\x.md' }));
  denied(run('azure-platform', 'edit', { path: 'D:\\elsewhere\\docs\\design\\azure\\x.md' }));
  denied(run('azure-platform', 'edit', { path: 'docs\\design\\azure\\..\\..\\..\\harness\\x.md' }));
});

test('a link inside the scope that leads outside it is refused', (t) => {
  const link = path.join(repo, 'docs', 'design', 'azure', 'escape-link');
  try { symlinkSync(path.join(repo, 'harness'), link, 'junction'); } catch { t.skip('cannot create a link on this system'); return; }
  try { denied(run('azure-platform', 'create', { path: 'docs/design/azure/escape-link/planted.md' })); } finally { rmSync(link, { recursive: true, force: true }); }
  assert.equal(existsSync(path.join(repo, 'harness', 'planted.md')), false);
});

test('alternate spellings of write, shell and delegation tools are still controlled', () => {
  for (const t of ['applyPatch', 'apply-patch', 'edit_file', 'write_file', 'str_replace_editor', 'createFile', 'delete_file']) {
    denied(run('azure-platform', t, { path: 'harness/policy/agent-policy.json' }), /may write only|cannot determine/);
  }
  denied(run('security-reviewer', 'edit_file', { path: 'docs/x.md' }), /read-only/);
  denied(run('security-reviewer', 'Bash', { command: 'git status' }), /may not run commands/);
  denied(run('security-reviewer', 'write_powershell', { input: 'rm -r x' }), /running shell/);
  denied(run('azure-platform', 'write_powershell', { input: 'rm -r x' }), /running shell/);
  denied(run('security-reviewer', 'write_agent', { agent_id: 'x', message: 'y' }), /may not delegate/);
  assert.equal(run('qa-engineer', 'read_powershell', { shellId: 'a' }), null);
});

test('an unclassified tool is denied rather than allowed', () => {
  denied(run('architecture-critic', 'frobnicate_repo', {}), /not classified/);
  denied(run('architecture-critic', 'github-mcp-server-get_file_contents', {}), /not classified/);
});

test('agents cannot write an Approved or Accepted status', () => {
  denied(run('principal-architect', 'edit', { path: 'docs/adr/0006-x.md', new_str: '- **Status:** Accepted' }), /Approved or Accepted/);
  denied(run('principal-architect', 'create', { path: 'docs/adr/0099-x.md', file_text: '# ADR\n\n| Status | Approved |' }), /Approved or Accepted/);
  denied(run('design-reviewer', 'edit', { path: 'docs/architecture/reviews/RV-0002-x.md', new_str: 'Status: Approved' }), /Approved or Accepted/);
  denied(run('design-reviewer', 'apply_patch', { input: '*** Update File: docs/architecture/reviews/RV-0002-x.md\n+- **Status:** Approved' }), /Approved or Accepted/);
  assert.equal(run('principal-architect', 'edit', { path: 'docs/adr/0006-x.md', new_str: '- **Status:** Proposed' }), null);
  assert.equal(run('design-reviewer', 'edit', { path: 'docs/architecture/reviews/RV-0002-x.md', new_str: 'Gate status: Blocked. Not Approved.' }), null);
});

test('qa-engineer may record evidence only for permitted nested commands and cannot choose the output folder', () => {
  const rec = (tail) => `node harness/scripts/record-evidence.mjs --id EV-0042 --claim "tests pass" -- ${tail}`;
  for (const ok of ['npm test', 'npm run validate', 'node --test tests/a.test.mjs', 'node harness/scripts/validate-agents.mjs', 'git status --short']) assert.equal(run('qa-engineer', 'powershell', { command: rec(ok) }), null, ok);
  for (const bad of ['node -e 1', 'azd up', 'npm install x', 'git push', 'node harness/scripts/record-evidence.mjs --id EV-0001 --claim "x" -- npm test']) denied(run('qa-engineer', 'powershell', { command: rec(bad) }), undefined);
  denied(run('qa-engineer', 'powershell', { command: 'node harness/scripts/record-evidence.mjs --id EV-0042 --claim "x" --out src/api -- npm test' }));
  denied(run('qa-engineer', 'powershell', { command: 'node harness/scripts/record-evidence.mjs --out src/api --id EV-0042 --claim "x" -- npm test' }));
  denied(run('design-reviewer', 'powershell', { command: rec('npm test') }));
});

test('fails closed: unknown agent, no tool name, garbage on stdin', () => {
  denied(evaluate({ toolName: 'view', toolArgs: {} }, 'nobody', policy, 0), /unknown agent/);
  denied(evaluate({ toolArgs: {} }, 'orchestrator', policy, 0), /no tool name/);
  const r = spawnSync(process.execPath, [path.join(repo, 'harness/hooks/agent-guard.cjs'), 'orchestrator'], { input: 'not json', encoding: 'utf8' });
  assert.equal(r.status, 2);
  const r2 = spawnSync(process.execPath, [path.join(repo, 'harness/hooks/agent-guard.cjs'), 'ghost'], { input: JSON.stringify({ toolName: 'view', toolArgs: {} }), encoding: 'utf8' });
  assert.equal(r2.status, 0);
  assert.match(r2.stdout, /"permissionDecision":"deny"/);
});

test('end to end through the real process: a deny is emitted as JSON', () => {
  const r = spawnSync(process.execPath, [path.join(repo, 'harness/hooks/agent-guard.cjs'), 'security-reviewer'], {
    input: JSON.stringify({ toolName: 'edit', toolArgs: { path: 'docs/x.md' }, cwd: repo }), encoding: 'utf8', cwd: repo,
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /AGENT-GUARD security-reviewer/);
});
