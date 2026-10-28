// Support for the orchestration tests: a controllable clock, throwaway run stores and a sandbox repository root.
// Everything is local and synthetic. No Azure, GitHub or network call is made, and nothing is written into the real run store.
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const engine = require('../../harness/orchestration/engine.cjs');
export const perm = require('../../harness/hooks/permission-engine.cjs');
export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const policy = JSON.parse(readFileSync(path.join(repo, 'harness/policy/orchestration-policy.json'), 'utf8'));
export const agentPolicy = JSON.parse(readFileSync(path.join(repo, 'harness/policy/agent-policy.json'), 'utf8'));
export const TEMPLATE = path.join(repo, 'docs/orchestration/templates/EXAMPLE-PLAN.json');

const dirs = [];
process.on('exit', () => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
export const tmp = (p = 'gf-orch-') => { const d = mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };

export function clock(start = '2026-01-01T00:00:00.000Z') {
  let t = Date.parse(start);
  return { now: () => new Date(t), advanceMs: (ms) => { t += ms; }, advanceMin: (m) => { t += m * 60000; }, advanceSec: (s) => { t += s * 1000; } };
}

export const examplePlan = () => JSON.parse(readFileSync(TEMPLATE, 'utf8'));
export const plan = (mutate) => { const p = examplePlan(); mutate?.(p); return p; };

// A text that satisfies the example plan's T1 checks, and one that satisfies T2's.
export const GOOD_T1 = `## Assumptions\n\nThe baseline requires FR-001 raw readings bound to the delivery and SEC-001 residency in the port jurisdiction. ${'evidence '.repeat(130)}\n`;
export const GOOD_T2 = 'The assessment treats nothing as proof. SEC-001 still needs a data-flow inventory.\n\nVerdict: ACCEPT-WITH-CONDITIONS\n';

export function setup(p = examplePlan(), extra = {}) {
  const clk = clock();
  const ctx = engine.makeContext({ runsDir: tmp('gf-runs-'), now: clk.now, ...extra });
  const { runId } = engine.initRun(ctx, p);
  const load = () => engine.loadRun(ctx, runId);
  const st = (id) => load().tasks[id];
  return { ctx, clk, runId, load, st, status: (id) => st(id).status };
}

// Drive one delegation the way the hook does: start, then submit the reply.
export function runTask(h, taskId, text, { agent, prompt = `work on ${taskId} attempt ${Math.random()}` } = {}) {
  const pt = h.load().plan.tasks.find((t) => t.id === taskId);
  engine.start(h.ctx, h.runId, taskId, { agent: agent ?? pt.agent, promptSha256: engine.sha256(prompt), actor: 'test' });
  return engine.submit(h.ctx, h.runId, taskId, { resultText: text, actor: 'test', source: 'test' });
}

// A sandbox repository root with just what the engine reads, so file artifacts and command checks can be tested without touching the real repo.
export function sandbox() {
  const root = tmp('gf-sbx-');
  for (const f of ['docs/context/REQUIREMENTS.md', 'docs/context/NON-FUNCTIONAL-REQUIREMENTS.md', 'docs/architecture/HARD-CONSTRAINTS.md', 'harness/policy/secret-patterns.json', 'harness/policy/command-policy.json']) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    cpSync(path.join(repo, f), path.join(root, f));
  }
  mkdirSync(path.join(root, 'docs/design/system'), { recursive: true });
  mkdirSync(path.join(root, 'tests'), { recursive: true });
  writeFileSync(path.join(root, 'tests/ok.test.mjs'), "import { test } from 'node:test';\ntest('ok', () => {});\n");
  writeFileSync(path.join(root, 'tests/bad.test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert';\ntest('bad', () => assert.equal(1, 2));\n");
  return root;
}

// Plan with a file artifact written by principal-architect and reviewed by the critic.
export const filePlan = (mutate) => {
  const p = {
    schema: 'greenfuel.task-plan/v1', title: 'File artifact plan', request: 'r', objective: 'o', requirements: ['FR-001', 'SEC-001'], constraints: ['HC-01'],
    risks: [{ id: 'RK-1', text: 'a risk', mitigation: 'a mitigation' }],
    tasks: [
      { id: 'T1', title: 'Write', objective: 'Write the proposal.', requirements: ['FR-001', 'SEC-001'], agent: 'principal-architect', inputContext: ['docs/context/REQUIREMENTS.md'],
        expectedArtifacts: [{ kind: 'file', path: 'docs/design/system/PROPOSAL.md' }], permissions: { tier: 'P1', tools: ['read', 'search', 'edit'], operations: ['fs.read', 'fs.write'] }, dependsOn: [],
        acceptance: [{ id: 'A1', type: 'file-exists', target: 'docs/design/system/PROPOSAL.md' }, { id: 'A2', type: 'cites-requirements', target: 'docs/design/system/PROPOSAL.md', min: 1 }],
        maxAttempts: 2, recovery: 'Delete the file and re-run the task; nothing else is changed.', review: { required: true, by: 'T2' } },
      { id: 'T2', title: 'Review', objective: 'Challenge it.', requirements: ['SEC-001'], agent: 'architecture-critic', inputContext: [], expectedArtifacts: [{ kind: 'result' }],
        permissions: { tier: 'P0', tools: ['read', 'search'], operations: ['fs.read', 'fs.search'] }, dependsOn: ['T1'], acceptance: [{ id: 'A1', type: 'verdict', target: '@result' }],
        maxAttempts: 2, recovery: 'The task writes nothing; discard its result and re-delegate.' },
    ],
  };
  mutate?.(p);
  return p;
};

export function sandboxSetup(p = filePlan(), extra = {}) {
  const root = sandbox();
  const clk = clock();
  const ctx = engine.makeContext({ root, policy, agentPolicy, model: perm.loadModel(repo), phase: 0, runsDir: path.join(root, 'docs/state/runs'), now: () => new Date(Date.now()), ...extra });
  const { runId } = engine.initRun(ctx, p);
  const load = () => engine.loadRun(ctx, runId);
  return { root, ctx, clk, runId, load, st: (id) => load().tasks[id], status: (id) => load().tasks[id].status };
}

export function cli(args, env = {}) {
  const r = spawnSync(process.execPath, [path.join(repo, 'harness/scripts/tasks.mjs'), ...args], { encoding: 'utf8', cwd: repo, env: { ...process.env, ...env } });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

export function hook(mode, event, env = {}) {
  const r = spawnSync(process.execPath, [path.join(repo, 'harness/hooks/delegation-guard.cjs'), mode], { input: JSON.stringify({ sessionId: 's', cwd: repo, ...event }), encoding: 'utf8', cwd: repo, env: { ...process.env, ...env } });
  let o = {}; try { o = r.stdout.trim() ? JSON.parse(r.stdout) : {}; } catch { o = { unparseable: r.stdout }; }
  return { status: r.status, denied: o.permissionDecision === 'deny', reason: o.permissionDecisionReason ?? '', stderr: r.stderr };
}
