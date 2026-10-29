import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { evaluateProbes, PROBES, MANUAL, AGENTS } = await import('../harness/scripts/live-validation.mjs');

// The hooks run for real, in a child process, with a controlled environment. The host is SIMULATED by environment variables: these tests prove
// the verifier's logic, not that VS Code behaves this way. The live result is the owner's session, read with the same script.
function env(logDir, host) {
  const e = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(COPILOT|GITHUB_COPILOT|VSCODE|TERM_PROGRAM|REMOTE_CONTAINERS|CODESPACES)/i.test(k)));
  e.HARNESS_LOG_DIR = logDir; delete e.NODE_TEST_CONTEXT;
  if (host === 'vscode') { e.TERM_PROGRAM = 'vscode'; e.TERM_PROGRAM_VERSION = '1.143.0'; e.VSCODE_PID = '1'; }
  if (host === 'cli') { e.COPILOT_AGENT_SESSION = '1'; }
  return e;
}
function hook(logDir, host, script, agent, toolName, toolArgs, sessionId = 'S1') {
  const args = [path.join(REPO, 'harness/hooks', script), ...(agent ? [agent] : [])];
  return spawnSync(process.execPath, args, { input: JSON.stringify({ toolName, toolArgs, sessionId, cwd: REPO, mode: 'agent' }), encoding: 'utf8', cwd: REPO, env: env(logDir, host) });
}
const events = (dir) => readFileSync(path.join(dir, 'audit-events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const by = (r, id) => r.results.find((x) => x.id === id);

function fullSession(dir, host) {
  hook(dir, host, 'policy-guard.cjs', null, 'view', { path: 'docs' });
  hook(dir, host, 'policy-guard.cjs', null, 'powershell', { command: 'gh auth token' });
  hook(dir, host, 'agent-guard.cjs', 'qa-engineer', 'powershell', { command: 'az group delete --name gf-simulated --yes' });
  hook(dir, host, 'agent-guard.cjs', 'qa-engineer', 'powershell', { command: 'node --test tests/approver-enrollment.test.mjs' });
  hook(dir, host, 'agent-guard.cjs', 'orchestrator', 'edit', { path: 'docs/lv-probe.md' });
  hook(dir, host, 'agent-guard.cjs', 'orchestrator', 'runSubagent', { agentName: 'qa-engineer' }, 'S2');
  hook(dir, host, 'agent-guard.cjs', 'qa-engineer', 'view', { path: 'README.md' }, 'S2');
  for (const a of AGENTS) hook(dir, host, 'agent-guard.cjs', a, 'view', { path: 'README.md' }, 'S3');
}

test('a simulated VS Code session: every automatic probe is observed from real hook events, and manual items stay manual', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gf-lv-'));
  try {
    fullSession(dir, 'vscode');
    const r = evaluateProbes(events(dir));
    for (const p of PROBES.filter((x) => x.id !== 'LV-08')) assert.equal(by(r, p.id).status, 'OBSERVED', `${p.id}: ${by(r, p.id).detail}`);
    assert.equal(by(r, 'LV-08').status, 'NOT OBSERVED', 'no MCP tool result was produced, so it is not claimed');
    assert.deepEqual(r.hostVersionsSeen, ['1.143.0']);
    for (const m of MANUAL) assert.equal(by(r, m.id).status, 'MANUAL');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('events from the Copilot CLI or an unknown host are never counted as VS Code evidence', () => {
  for (const host of ['cli', 'unknown']) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'gf-lv-'));
    try {
      fullSession(dir, host);
      const r = evaluateProbes(events(dir));
      assert.ok(events(dir).length > 10, 'the hooks really did run and log');
      assert.equal(r.vscodeEvents, 0);
      for (const id of ['LV-01', 'LV-03', 'LV-04', 'LV-05', 'LV-06', 'LV-07']) assert.equal(by(r, id).status, 'NOT OBSERVED', `${host} ${id}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('a partial session reports exactly what is missing, and delegation without a sub-agent hook is called out', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gf-lv-'));
  try {
    hook(dir, 'vscode', 'agent-guard.cjs', 'orchestrator', 'runSubagent', { agentName: 'qa-engineer' }, 'S9');
    hook(dir, 'vscode', 'agent-guard.cjs', 'qa-engineer', 'view', { path: 'README.md' }, 'S10');
    const r = evaluateProbes(events(dir));
    assert.equal(by(r, 'LV-07').status, 'NOT OBSERVED'); assert.match(by(r, 'LV-07').detail, /no sub-agent hook event followed/);
    assert.equal(by(r, 'LV-06').status, 'NOT OBSERVED'); assert.match(by(r, 'LV-06').detail, /2 of 12 agents seen; missing: ai-engineer/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the since filter excludes older events, and an empty log observes nothing', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gf-lv-'));
  try {
    fullSession(dir, 'vscode');
    assert.equal(by(evaluateProbes(events(dir), { since: new Date(Date.now() + 3600000).toISOString() }), 'LV-02').status, 'NOT OBSERVED');
    assert.equal(evaluateProbes([]).results.filter((x) => x.status === 'OBSERVED').length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an MCP tool outcome is observed when the output guard recorded one, and the CLI prints a summary that claims nothing it did not see', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gf-lv-'));
  try {
    spawnSync(process.execPath, [path.join(REPO, 'harness/hooks/tool-output-guard.cjs')], { input: JSON.stringify({ sessionId: 's', toolName: 'greenfuel-tools/validate_requirements', toolArgs: {}, toolResult: { resultType: 'success', textResultForLlm: 'ok' } }), encoding: 'utf8', cwd: REPO, env: env(dir, 'vscode') });
    assert.equal(by(evaluateProbes(events(dir)), 'LV-08').status, 'OBSERVED');
    const cli = spawnSync(process.execPath, [path.join(REPO, 'harness/scripts/live-validation.mjs'), '--log-dir', dir], { encoding: 'utf8', cwd: REPO });
    assert.equal(cli.status, 0); assert.match(cli.stdout, /1 of 8 automatic probes OBSERVED, 7 NOT OBSERVED, 5 manual items/); assert.match(cli.stdout, /Nothing is claimed as passed that the log does not show/);
    const none = spawnSync(process.execPath, [path.join(REPO, 'harness/scripts/live-validation.mjs'), '--log-dir', path.join(dir, 'missing')], { encoding: 'utf8', cwd: REPO });
    assert.match(none.stdout, /0 of 8 automatic probes OBSERVED/); assert.match(none.stderr, /no event log/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
