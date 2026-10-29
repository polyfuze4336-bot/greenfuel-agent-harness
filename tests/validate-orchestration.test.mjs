import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repo, tmp, engine, setup, examplePlan } from './support/orchestration-fixtures.mjs';
import { validateOrchestration } from '../harness/scripts/validate-orchestration.mjs';

const FILES = ['harness/policy', 'harness/orchestration', 'harness/hooks', 'harness/approvals', 'harness/lib', 'harness/scripts/tasks.mjs', 'harness/tools/tool-registry.json', '.github/hooks', '.github/agents/orchestrator.agent.md', 'docs/orchestration', 'docs/context/REQUIREMENTS.md', 'docs/context/NON-FUNCTIONAL-REQUIREMENTS.md', 'docs/architecture/HARD-CONSTRAINTS.md'];
function sandbox() {
  const root = tmp('gf-vo-');
  for (const f of FILES) { mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); cpSync(path.join(repo, f), path.join(root, f), { recursive: true }); }
  return root;
}
const POLICY = 'harness/policy/orchestration-policy.json';
const editJson = (root, rel, fn) => { const f = path.join(root, rel); const j = JSON.parse(readFileSync(f, 'utf8')); fn(j); writeFileSync(f, JSON.stringify(j, null, 2)); };
const editText = (root, rel, fn) => { const f = path.join(root, rel); writeFileSync(f, fn(readFileSync(f, 'utf8'))); };
const errorsOf = (root) => validateOrchestration(root).map((e) => e.msg);

test('the committed framework configuration passes', () => assert.deepEqual(errorsOf(repo), []));

const mutations = [
  ['a missing state', POLICY, (j) => { j.states = j.states.filter((s) => s !== 'BLOCKED'); }, /states must be exactly/],
  ['COMPLETED reachable without validation', POLICY, (j) => { j.transitions.RUNNING.push('COMPLETED'); }, /COMPLETED may be entered only from VALIDATING/],
  ['RUNNING reachable from PENDING', POLICY, (j) => { j.transitions.PENDING.push('RUNNING'); }, /RUNNING may be entered only from READY/],
  ['an unreachable state', POLICY, (j) => { j.transitions.PENDING = j.transitions.PENDING.filter((s) => s !== 'AWAITING_APPROVAL'); j.transitions.RUNNING = j.transitions.RUNNING.filter((s) => s !== 'AWAITING_APPROVAL'); }, /cannot be reached from PENDING|READY/],
  ['an outgoing transition from CANCELLED', POLICY, (j) => { j.transitions.CANCELLED = ['READY']; }, /CANCELLED must have no outgoing/],
  ['an unknown target state', POLICY, (j) => { j.transitions.READY.push('PAUSED'); }, /unknown state/],
  ['a transition to itself', POLICY, (j) => { j.transitions.READY.push('READY'); }, /to itself/],
  ['a transition note for a transition that does not exist', POLICY, (j) => { j.transitionNotes['PENDING>COMPLETED'] = 'x'; }, /does not exist/],
  ['an unusual transition without a note', POLICY, (j) => { delete j.transitionNotes['COMPLETED>VALIDATING']; }, /needs a transitionNote/],
  ['a retryable PERMISSION_DENIED', POLICY, (j) => { Object.assign(j.errorClasses.PERMISSION_DENIED, { retryable: true, action: 'retry', backoffSeconds: [0] }); }, /must never be retryable/],
  ['a retryable class whose action is not retry', POLICY, (j) => { j.errorClasses.TRANSIENT.action = 'escalate'; }, /retryable must be true exactly when/],
  ['a retryable class without a backoff', POLICY, (j) => { delete j.errorClasses.TRANSIENT.backoffSeconds; }, /needs backoffSeconds/],
  ['a missing error class', POLICY, (j) => { delete j.errorClasses.UNKNOWN; }, /UNKNOWN is required/],
  ['a classifier ahead of the permission-denied one', POLICY, (j) => { j.classifierPatterns.unshift({ class: 'TRANSIENT', pattern: 'timeout' }); }, /PERMISSION_DENIED must be the first/],
  ['a classifier with a bad pattern', POLICY, (j) => { j.classifierPatterns.push({ class: 'TRANSIENT', pattern: '(' }); }, /not a valid regular expression/],
  ['an unanchored command pattern', POLICY, (j) => { j.commandAllowList.push('npm run validate'); }, /anchored/],
  ['a command allow-list that permits inline node', POLICY, (j) => { j.commandAllowList.push('^node -e .*$'); }, /dangerous command: node -e 1/],
  ['a command allow-list that permits git push', POLICY, (j) => { j.commandAllowList.push('^git push.*$'); }, /dangerous command: git push/],
  ['a command allow-list that permits a validator write', POLICY, (j) => { j.commandAllowList.push('^node harness/scripts/validate-[\\w-]+\\.mjs( [\\w:./-]+)*$'); }, /dangerous command: node harness\/scripts\/validate-permissions.mjs --write/],
  ['an unknown reviewer agent', POLICY, (j) => { j.reviewerAgents.push('free-agent'); }, /not in agent-policy/],
  ['a blocking verdict that is not a verdict', POLICY, (j) => { j.blockingVerdicts.push('MAYBE'); }, /not a verdict/],
  ['an unbounded retry cap', POLICY, (j) => { j.limits.maxAttemptsCap = 50; }, /defeats the bounded-retry rule/],
  ['a non-integer limit', POLICY, (j) => { j.limits.leaseMinutes = 'long'; }, /positive integer/],
  ['background delegation allowed', POLICY, (j) => { j.delegation.requireSync = false; }, /must be synchronous/],
  ['untracked delegation allowed during a run', POLICY, (j) => { j.delegation.denyUntrackedWhileRunActive = false; }, /marker can be skipped/],
  ['the runs folder moved', POLICY, (j) => { j.runsDir = 'docs/runs'; }, /runsDir must be docs\/state\/runs/],
  ['an unknown acceptance type', POLICY, (j) => { j.acceptanceTypes.push('vibes'); }, /unknown acceptance type/],
  ['the runs folder no longer control plane', 'harness/policy/permissions.json', (j) => { j.pathClasses.find((c) => c.id === 'control-plane').pattern = '^(harness/|\\.github/)'; }, /control plane/],
];
for (const [name, file, fn, expect] of mutations) {
  test(`validate-orchestration rejects ${name}`, () => {
    const root = sandbox(); editJson(root, file, fn);
    const errs = errorsOf(root);
    assert.ok(errs.some((e) => expect.test(e)), `expected ${expect}, got ${errs.join(' | ') || 'no errors'}`);
  });
}

test('validate-orchestration rejects wiring that weakens the orchestrator or the hook', () => {
  let root = sandbox();
  editJson(root, '.github/hooks/orchestration.json', (j) => { delete j.hooks.postToolUse; });
  assert.ok(errorsOf(root).some((e) => /postToolUse/.test(e)));
  root = sandbox();
  editText(root, '.github/agents/orchestrator.agent.md', (t) => t.replace("tools: ['read',", "tools: ['edit', 'read',"));
  assert.ok(errorsOf(root).some((e) => /must not give the orchestrator an edit or execute tool/.test(e)));
  root = sandbox();
  editText(root, '.github/agents/orchestrator.agent.md', (t) => t.replace(/TASK-REF:/g, 'TASK:'));
  assert.ok(errorsOf(root).some((e) => /TASK-REF/.test(e)));
  root = sandbox();
  editText(root, '.github/agents/orchestrator.agent.md', (t) => t.replace(", 'greenfuel-tools/check_plan'", ''));
  assert.ok(errorsOf(root).some((e) => /check_plan/.test(e)));
  root = sandbox();
  editJson(root, 'harness/policy/agent-policy.json', (j) => { j.agents.orchestrator.commands = ['^node harness/scripts/tasks\\.mjs .*$']; });
  assert.ok(errorsOf(root).some((e) => /no write scope and no commands/.test(e)));
});

test('validate-orchestration rejects missing documents, an invalid example plan and stale generated tables', () => {
  let root = sandbox();
  editText(root, 'docs/orchestration/ORCHESTRATION.md', (t) => t.replace('Identify dependencies and risks', 'Think about things'));
  assert.ok(errorsOf(root).some((e) => /workflow step "Identify dependencies and risks"/.test(e)));
  root = sandbox();
  editText(root, 'docs/orchestration/ORCHESTRATION.md', (t) => t.replace('| COMPLETED (terminal)', '| COMPLETED (final)'));
  assert.ok(errorsOf(root).some((e) => /out of date/.test(e)));
  root = sandbox();
  editText(root, 'docs/orchestration/TASK-CONTRACT.md', (t) => t.replaceAll('`recovery`', '`undo`'));
  assert.ok(errorsOf(root).some((e) => /document the field recovery/.test(e)));
  root = sandbox();
  editJson(root, 'docs/orchestration/templates/EXAMPLE-PLAN.json', (j) => { j.tasks[0].agent = 'general-purpose'; });
  assert.ok(errorsOf(root).some((e) => /example plan is invalid/.test(e)));
});

test('validate-orchestration checks committed runs: tampering and a leftover ACTIVE run are reported', () => {
  let root = sandbox();
  const ctx = engine.makeContext({ root, runsDir: path.join(root, 'docs/state/runs') });
  const { runId } = engine.initRun(ctx, examplePlan());
  const prevCi = process.env.CI;
  try {
    delete process.env.CI;
    assert.deepEqual(errorsOf(root), [], 'locally, an open run is allowed while work is in progress');
    process.env.CI = 'true';
    assert.ok(errorsOf(root).some((e) => new RegExp(`run ${runId} is ACTIVE`).test(e)), 'in CI an ACTIVE run is an error: it would block untracked delegation');
    delete process.env.CI;
    engine.cancelRun(ctx, runId, { reason: 'finished' });
    assert.deepEqual(errorsOf(root), [], 'a finished run with an intact chain is fine');
    editText(root, `docs/state/runs/${runId}/events.jsonl`, (t) => t.replace('"run-created"', '"run-edited"'));
    assert.ok(errorsOf(root).some((e) => /failed its integrity check/.test(e)));
  } finally { if (prevCi === undefined) delete process.env.CI; else process.env.CI = prevCi; }
  void setup; root = null;
});
