import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, utimesSync, rmSync } from 'node:fs';
import path from 'node:path';
import { engine, perm, policy, plan, filePlan, examplePlan, setup, runTask, sandboxSetup, GOOD_T1, GOOD_T2, tmp } from './support/orchestration-fixtures.mjs';
import { makeKey, syntheticModel } from './support/permission-fixtures.mjs';

const refused = (fn, code) => assert.throws(fn, (e) => e instanceof engine.Refusal && e.code === code, `expected refusal ${code}`);
const P = (n) => engine.sha256(`prompt ${n}`);
const taskOf = (p, id) => p.tasks.find((t) => t.id === id);
const events = (h) => engine.readEvents(engine.runDir(h.ctx, h.runId));

test('init creates a run with the first task READY and the rest PENDING, and is idempotent', () => {
  const h = setup();
  assert.equal(h.status('T1'), 'READY'); assert.equal(h.status('T2'), 'PENDING');
  assert.equal(h.load().state, 'ACTIVE');
  const again = engine.initRun(h.ctx, examplePlan());
  assert.equal(again.existed, true); assert.equal(again.runId, h.runId);
  assert.equal(events(h).filter((e) => e.action === 'run-created').length, 1, 'a second init changes nothing');
  const other = engine.initRun(h.ctx, plan((p) => { p.title = 'A different plan'; }));
  assert.notEqual(other.runId, h.runId);
  assert.throws(() => engine.initRun(h.ctx, plan((p) => { delete p.risks; })), (e) => e.code === 'PLAN_INVALID' && e.detail.length > 0);
});

test('the happy path completes, with evidence, checkpoints, a verified chain and a rendered trace and report', () => {
  const h = setup();
  assert.equal(runTask(h, 'T1', GOOD_T1).outcome, 'completed');
  assert.equal(h.status('T2'), 'READY');
  assert.equal(runTask(h, 'T2', GOOD_T2).outcome, 'completed');
  const run = h.load();
  assert.equal(run.state, 'COMPLETED');
  assert.equal(run.tasks.T2.verdict, 'ACCEPT-WITH-CONDITIONS');
  for (const id of ['T1', 'T2']) {
    const ev = run.tasks[id].evidence;
    assert.ok(ev.some((e) => e.type === 'captured-result' && /^[0-9a-f]{64}$/.test(e.sha256)));
    assert.ok(ev.some((e) => e.type === 'acceptance'));
    assert.ok(existsSync(path.join(engine.runDir(h.ctx, h.runId), ev.find((e) => e.type === 'captured-result').ref)));
  }
  const v = engine.verifyRun(h.ctx, h.runId);
  assert.equal(v.ok, true, v.problems.join('; '));
  assert.ok(v.checkpoints >= 3, 'created, each completion and the run state change are checkpointed');
  const trace = engine.renderTrace(h.ctx, h.runId);
  assert.match(trace, /hash chain intact/); assert.match(trace, /\| accept \| VALIDATING to COMPLETED/); assert.match(trace, /COMPLETED/);
  const report = engine.renderReport(h.ctx, h.runId);
  assert.match(report, /FR-001, SEC-001/); assert.match(report, /captured-result/);
  assert.equal(engine.nextActions(h.ctx, run).recommendation.action, 'complete');
});

test('captured results are marked untrusted and keep secrets out', () => {
  const h = setup();
  const secret = `token = gh${'p'}_${'Z9y8X7w6V5'.repeat(4)}`;
  runTask(h, 'T1', `${GOOD_T1}\n${secret}\n`);
  const a = h.st('T1').artifacts[0];
  const file = readFileSync(path.join(engine.runDir(h.ctx, h.runId), a.path), 'utf8');
  assert.match(file.split('\n')[0], /^<!-- captured result .*UNTRUSTED model output/);
  assert.doesNotMatch(file, /Z9y8X7w6V5/);
  assert.ok(a.redactions >= 1);
});

test('start refusals: wrong agent, unknown task, not ready, background, closed run, spent attempts; each is logged and changes nothing', () => {
  const h = setup();
  const before = JSON.stringify(h.st('T1'));
  refused(() => engine.start(h.ctx, h.runId, 'T1', { agent: 'security-reviewer', promptSha256: P(1) }), 'WRONG_AGENT');
  refused(() => engine.start(h.ctx, h.runId, 'T9', { agent: 'maritime-domain', promptSha256: P(1) }), 'NO_TASK');
  refused(() => engine.start(h.ctx, h.runId, 'T2', { agent: 'architecture-critic', promptSha256: P(1) }), 'NOT_READY');
  refused(() => engine.start(h.ctx, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(1), mode: 'background' }), 'BACKGROUND_DENIED');
  assert.equal(JSON.stringify(h.st('T1')), before, 'refusals do not change task state');
  assert.equal(events(h).filter((e) => e.action === 'refused').length, 4, 'but each refusal is in the log');
  engine.cancelRun(h.ctx, h.runId, { reason: 'test' });
  refused(() => engine.start(h.ctx, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(2) }), 'RUN_NOT_ACTIVE');
});

test('an agent cannot start a task assigned to the orchestrator, and the orchestrator cannot start one assigned to a specialist', () => {
  const p = examplePlan();
  p.tasks.push({ id: 'T3', title: 'Consolidate', objective: 'Consolidate.', requirements: ['SEC-001'], agent: 'orchestrator', executor: 'orchestrator', inputContext: [], expectedArtifacts: [{ kind: 'result' }], permissions: { tier: 'P0', tools: ['read', 'search'], operations: ['fs.read'] }, dependsOn: ['T1', 'T2'], acceptance: [{ id: 'A1', type: 'min-words', target: '@result', min: 5 }], maxAttempts: 1, recovery: 'Writes nothing; capture it again.' });
  const h = setup(p);
  refused(() => engine.start(h.ctx, h.runId, 'T1', { agent: 'orchestrator', promptSha256: P(1) }), 'WRONG_AGENT');
  runTask(h, 'T1', GOOD_T1); runTask(h, 'T2', GOOD_T2);
  refused(() => engine.start(h.ctx, h.runId, 'T3', { agent: 'architecture-critic', promptSha256: P(3) }), 'WRONG_AGENT');
  engine.start(h.ctx, h.runId, 'T3', { agent: 'orchestrator', promptSha256: P(3) });
  assert.equal(engine.submit(h.ctx, h.runId, 'T3', { resultText: 'A consolidated report with enough words to pass the check here.', source: 'operator capture' }).outcome, 'completed');
  assert.equal(h.load().state, 'COMPLETED');
});

test('start and submit are idempotent: repeating them changes nothing', () => {
  const h = setup();
  const a = engine.start(h.ctx, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(1) });
  const b = engine.start(h.ctx, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(1) });
  assert.equal(b.idempotent, true); assert.equal(b.attempt, a.attempt); assert.equal(h.st('T1').attempts, 1);
  const s1 = engine.submit(h.ctx, h.runId, 'T1', { resultText: GOOD_T1 });
  const rev = h.load().rev;
  const s2 = engine.submit(h.ctx, h.runId, 'T1', { resultText: GOOD_T1 });
  assert.equal(s1.outcome, 'completed'); assert.equal(s2.idempotent, true); assert.equal(h.load().rev, rev, 'no new revision');
});

test('error classification maps known failure text to classes, and unknown text to UNKNOWN', () => {
  const h = setup();
  const c = (m, explicit) => engine.classifyError(m, h.ctx, explicit);
  assert.equal(c('Denied by preToolUse hook: [AGENT-GUARD qa-engineer] command not on allow-list'), 'PERMISSION_DENIED');
  assert.equal(c('[HARNESS-POLICY DEF-06] no deletes'), 'PERMISSION_DENIED');
  assert.equal(c('request timed out after 60s'), 'TRANSIENT'); assert.equal(c('HTTP 429 rate limit'), 'TRANSIENT'); assert.equal(c('ECONNRESET'), 'TRANSIENT');
  assert.equal(c('ENOENT: no such file or directory'), 'INPUT_MISSING');
  assert.equal(c('hard constraint HC-01 breached by cross-jurisdiction copy'), 'POLICY_VIOLATION');
  assert.equal(c('the two requirements contradict each other'), 'CONFLICT');
  assert.equal(c('the session ended unexpectedly'), 'INTERRUPTED');
  assert.equal(c('something odd happened'), 'UNKNOWN');
  assert.equal(c('x', 'CONFLICT'), 'CONFLICT');
  assert.throws(() => c('x', 'MADE_UP'), (e) => e.code === 'ERROR_CLASS');
  for (const [k, d] of Object.entries(policy.errorClasses)) { assert.ok(['retry', 'block', 'escalate', 'stop'].includes(d.action), k); assert.equal(typeof d.retryable, 'boolean'); }
});

test('an acceptance failure is retryable once with feedback and a changed prompt, then escalates when attempts are spent', () => {
  const h = setup();
  engine.start(h.ctx, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(1) });
  assert.equal(engine.submit(h.ctx, h.runId, 'T1', { resultText: 'too short' }).outcome, 'failed');
  assert.equal(h.status('T1'), 'FAILED'); assert.equal(h.st('T1').terminal, false);
  const next = engine.nextActions(h.ctx, h.load());
  assert.equal(next.recommendation.action, 'retry');
  assert.ok(next.retryable[0].feedback.some((f) => /min-words/.test(f)), 'the retry carries the failed checks');
  engine.retry(h.ctx, h.runId, 'T1');
  refused(() => engine.start(h.ctx, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(1) }), 'UNCHANGED_PROMPT');
  engine.start(h.ctx, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(2) });
  assert.equal(engine.submit(h.ctx, h.runId, 'T1', { resultText: 'still too short' }).outcome, 'failed');
  const t = h.st('T1');
  assert.equal(t.terminal, true, 'two attempts used');
  refused(() => engine.retry(h.ctx, h.runId, 'T1'), 'NOT_RETRYABLE');
  const run = h.load();
  assert.equal(run.tasks.T2.status, 'BLOCKED'); assert.match(run.tasks.T2.blockedReason, /dependency T1 is FAILED/);
  assert.equal(run.state, 'NEEDS_HUMAN');
  assert.ok(run.attention.some((a) => /T1 FAILED/.test(a)));
  assert.ok(events(h).some((e) => e.action === 'escalate' && /retry budget spent/.test(e.reason)));
  assert.equal(engine.nextActions(h.ctx, run).recommendation.action, 'escalate');
});

test('a transient failure waits out its backoff, then may restart', () => {
  const h = setup();
  engine.start(h.ctx, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(1) });
  const f = engine.fail(h.ctx, h.runId, 'T1', { message: 'request timed out' });
  assert.deepEqual([f.errorClass, f.action], ['TRANSIENT', 'retry']);
  engine.retry(h.ctx, h.runId, 'T1');
  refused(() => engine.start(h.ctx, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(2) }), 'BACKOFF');
  h.clk.advanceSec(6);
  engine.start(h.ctx, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(2) });
  assert.equal(h.status('T1'), 'RUNNING');
});

test('non-retryable classes escalate, block or stop instead of retrying', () => {
  const denied = setup();
  engine.start(denied.ctx, denied.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(1) });
  assert.equal(engine.fail(denied.ctx, denied.runId, 'T1', { message: 'Denied by preToolUse hook: [AGENT-GUARD] nope' }).action, 'escalate');
  assert.equal(denied.st('T1').terminal, true); refused(() => engine.retry(denied.ctx, denied.runId, 'T1'), 'NOT_RETRYABLE');

  const missing = setup();
  engine.start(missing.ctx, missing.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(1) });
  assert.equal(engine.fail(missing.ctx, missing.runId, 'T1', { message: 'ENOENT: no such file' }).action, 'block');
  assert.equal(missing.status('T1'), 'BLOCKED');
  refused(() => engine.unblock(missing.ctx, missing.runId, 'T1', {}), 'REASON');
  engine.unblock(missing.ctx, missing.runId, 'T1', { reason: 'the file was restored' });
  assert.equal(missing.status('T1'), 'READY');

  const stop = setup();
  engine.start(stop.ctx, stop.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(1) });
  assert.equal(engine.fail(stop.ctx, stop.runId, 'T1', { errorClass: 'POLICY_VIOLATION', message: 'cross-jurisdiction copy attempted' }).action, 'stop');
  assert.equal(stop.load().state, 'STOPPED');
  refused(() => engine.start(stop.ctx, stop.runId, 'T2', { agent: 'architecture-critic', promptSha256: P(2) }), 'RUN_NOT_ACTIVE');
  assert.equal(engine.nextActions(stop.ctx, stop.load()).recommendation.action, 'stop');

  const internal = setup();
  engine.start(internal.ctx, internal.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(1) });
  assert.equal(engine.fail(internal.ctx, internal.runId, 'T1', { errorClass: 'INTERNAL', message: 'state inconsistent' }).action, 'stop');
});

test('an UNKNOWN error is retried once, then escalated, even with attempts left', () => {
  const h = setup(plan((p) => { taskOf(p, 'T1').maxAttempts = 3; }));
  engine.start(h.ctx, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(1) });
  assert.equal(engine.fail(h.ctx, h.runId, 'T1', { message: 'strange' }).action, 'retry');
  engine.retry(h.ctx, h.runId, 'T1'); h.clk.advanceSec(10);
  engine.start(h.ctx, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(2) });
  assert.equal(engine.fail(h.ctx, h.runId, 'T1', { message: 'strange again' }).action, 'escalate');
  assert.equal(h.st('T1').attempts, 2); assert.equal(h.st('T1').terminal, true);
});

test('operations from the wrong state are refused', () => {
  const h = setup();
  refused(() => engine.submit(h.ctx, h.runId, 'T1', { resultText: GOOD_T1 }), 'NOT_RUNNING');
  refused(() => engine.fail(h.ctx, h.runId, 'T1', { message: 'x' }), 'NOT_ACTIVE');
  refused(() => engine.retry(h.ctx, h.runId, 'T1'), 'NOT_FAILED');
  refused(() => engine.validateTask(h.ctx, h.runId, 'T1'), 'NOT_VALIDATING');
  refused(() => engine.applyApproval(h.ctx, h.runId, 'T1', {}), 'NOT_AWAITING');
  refused(() => engine.reopen(h.ctx, h.runId, 'T1', { reason: 'x' }), 'NOT_COMPLETED');
  refused(() => engine.unblock(h.ctx, h.runId, 'T1', { reason: 'x' }), 'NOT_BLOCKED');
  refused(() => engine.pauseForApproval(h.ctx, h.runId, 'T1', { tier: 'P2', reason: 'x' }), 'NOT_RUNNING');
  engine.cancelTask(h.ctx, h.runId, 'T1', { reason: 'not needed' });
  refused(() => engine.cancelTask(h.ctx, h.runId, 'T1', {}), 'TERMINAL');
  assert.equal(h.status('T2'), 'BLOCKED', 'a cancelled dependency blocks its dependents');
  assert.throws(() => engine.cancelRun(h.ctx, 'RUN-0000000000', {}), (e) => e.code === 'NO_RUN');
  assert.throws(() => engine.loadRun(h.ctx, '../etc'), (e) => e.code === 'RUN_ID');
});

test('cancelling a run cancels every unfinished task and closes the run', () => {
  const h = setup();
  runTask(h, 'T1', GOOD_T1);
  engine.cancelRun(h.ctx, h.runId, { reason: 'requirements changed' });
  const run = h.load();
  assert.equal(run.state, 'CANCELLED'); assert.equal(run.tasks.T1.status, 'COMPLETED'); assert.equal(run.tasks.T2.status, 'CANCELLED');
});

test('every acceptance check type passes and fails as specified', () => {
  const one = (check, text) => {
    const h = setup(plan((p) => { p.tasks = [{ ...taskOf(p, 'T1'), acceptance: [{ id: 'A1', target: '@result', ...check }] }]; }));
    engine.start(h.ctx, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(1) });
    const r = engine.submit(h.ctx, h.runId, 'T1', { resultText: text });
    return { ok: r.outcome === 'completed', detail: r.results.find((x) => x.id === 'A1').detail, task: h.st('T1') };
  };
  assert.equal(one({ type: 'file-exists' }, 'text').ok, true); assert.equal(one({ type: 'file-exists' }, '   ').ok, false);
  assert.equal(one({ type: 'file-contains', pattern: 'residency' }, 'Residency matters').ok, true); assert.equal(one({ type: 'file-contains', pattern: 'residency' }, 'nothing').ok, false);
  assert.equal(one({ type: 'file-not-contains', pattern: 'TODO' }, 'done').ok, true); assert.equal(one({ type: 'file-not-contains', pattern: 'TODO' }, 'a TODO here').ok, false);
  assert.equal(one({ type: 'headings', headings: ['Risks'] }, '## 2. Risks\n\nx').ok, true); assert.equal(one({ type: 'headings', headings: ['Risks'] }, 'Risks are mentioned only in prose').ok, false);
  assert.equal(one({ type: 'min-words', min: 3 }, 'one two three').ok, true); assert.equal(one({ type: 'min-words', min: 3 }, 'one two').ok, false);
  assert.equal(one({ type: 'json-valid' }, '{"a":1}').ok, true); assert.equal(one({ type: 'json-valid' }, '{a:1}').ok, false);
  assert.equal(one({ type: 'no-secret' }, 'plain text').ok, true);
  assert.equal(one({ type: 'no-secret' }, `key ${'-----BEGIN '}${'PRIVATE'} KEY-----`).ok, false);
  const v = one({ type: 'verdict' }, 'Analysis.\n\n**Verdict:** REWORK\n');
  assert.equal(v.ok, true); assert.equal(v.task.verdict, 'REWORK');
  assert.equal(one({ type: 'verdict' }, 'Verdict: looks fine').ok, false);
  assert.equal(one({ type: 'verdict', allowed: ['ACCEPT'] }, 'Verdict: REJECT').ok, false);
  assert.equal(one({ type: 'cites-requirements', min: 1 }, 'See FR-001 for readings.').ok, true);
  assert.equal(one({ type: 'cites-requirements', min: 1 }, 'See BR-001 only.').ok, false, 'BR-001 exists but is not one of this task\'s requirements');
  const fab = one({ type: 'cites-requirements', min: 1 }, 'FR-001 and FR-777 are both required.');
  assert.equal(fab.ok, false); assert.match(fab.detail, /FR-777/, 'an invented requirement ID is caught');
  assert.equal(one({ type: 'cites-requirements', min: 1 }, 'Mentions DES-0001 and EV-0001 and D-009 only; FR-001 too.').ok, true, 'other ID styles are not mistaken for requirements');
});

test('a blocking review verdict leaves the run NEEDS_HUMAN, and a bounded reopen reworks the reviewed task and its dependents', () => {
  const h = setup(plan((p) => { taskOf(p, 'T1').review = { required: true, by: 'T2' }; taskOf(p, 'T1').maxAttempts = 3; }));
  runTask(h, 'T1', GOOD_T1);
  assert.equal(runTask(h, 'T2', 'Weak evidence for SEC-001.\n\nVerdict: REWORK\n').outcome, 'completed');
  let run = h.load();
  assert.equal(run.state, 'NEEDS_HUMAN');
  assert.ok(run.attention.some((a) => /REWORK on T1/.test(a)));
  assert.equal(engine.nextActions(h.ctx, run).recommendation.action, 'escalate');
  engine.reopen(h.ctx, h.runId, 'T1', { reason: 'critic verdict REWORK' });
  run = h.load();
  assert.equal(run.tasks.T1.status, 'READY'); assert.equal(run.tasks.T2.status, 'PENDING'); assert.equal(run.tasks.T2.attempts, 0);
  assert.equal(run.state, 'ACTIVE');
  runTask(h, 'T1', GOOD_T1);
  assert.equal(runTask(h, 'T2', GOOD_T2).outcome, 'completed');
  assert.equal(h.load().state, 'COMPLETED');
  refused(() => engine.reopen(h.ctx, h.runId, 'T1', { reason: 'again' }), 'REOPEN_LIMIT');
  assert.ok(events(h).some((e) => e.action === 'invalidate' && e.taskId === 'T2'));
});

test('a reviewed task cannot be reopened while a dependent runs, nor without a reason', () => {
  const h = setup(plan((p) => { taskOf(p, 'T1').maxAttempts = 3; }));
  runTask(h, 'T1', GOOD_T1);
  refused(() => engine.reopen(h.ctx, h.runId, 'T1', {}), 'REASON');
  engine.start(h.ctx, h.runId, 'T2', { agent: 'architecture-critic', promptSha256: P(5) });
  refused(() => engine.reopen(h.ctx, h.runId, 'T1', { reason: 'late' }), 'DEPENDENT_ACTIVE');
});

test('a task that needs approval waits for a signed, plan-bound, unexpired, unused approval from registered approvers', () => {
  const k = makeKey(['P2']); const k4 = makeKey(['P4']); const k4b = makeKey(['P4']); const stranger = makeKey(['P2']);
  const model = syntheticModel([k, k4, k4b]);
  const p = plan((x) => { taskOf(x, 'T2').approval = { required: true, tier: 'P2', reason: 'a human must accept the critic running on this' }; });
  const h = setup(p, { model });
  runTask(h, 'T1', GOOD_T1);
  assert.equal(h.status('T2'), 'AWAITING_APPROVAL');
  assert.equal(engine.nextActions(h.ctx, h.load()).recommendation.action, 'wait-for-approval');
  refused(() => engine.start(h.ctx, h.runId, 'T2', { agent: 'architecture-critic', promptSha256: P(1) }), 'NOT_READY');
  const sign = (rec, ...keys) => keys.reduce((r, key) => perm.signApproval(r, key.privateKeyPem, key.keyId), rec);
  const req = (o = {}) => engine.requestApproval(h.ctx, h.runId, 'T2', { reason: 'reviewed the plan', ...o });
  const bad = (rec, re) => assert.throws(() => engine.applyApproval(h.ctx, h.runId, 'T2', rec), (e) => e.code === 'APPROVAL_INVALID' && re.test(e.message));
  bad(req(), /valid signature/);
  bad(sign(req(), stranger), /valid signature/);
  bad({ ...sign(req(), k), planHash: 'f'.repeat(64) }, /different plan|valid signature/);
  bad(sign({ ...req(), taskId: 'T1' }, k), /different run or task/);
  const tampered = sign(req(), k); tampered.reason = 'something else';
  bad(tampered, /valid signature/);
  const expired = sign({ ...req(), issuedAt: new Date(h.clk.now().getTime() - 7200000).toISOString(), expiresAt: new Date(h.clk.now().getTime() - 3600000).toISOString() }, k);
  bad(expired, /expired/);
  bad(sign({ ...req({ tier: 'P2' }), tier: 'P4' }, k), /valid signature|lifetime/);
  const good = sign(req(), k);
  const r = engine.applyApproval(h.ctx, h.runId, 'T2', good);
  assert.equal(r.decision, 'approve'); assert.equal(h.status('T2'), 'READY');
  assert.ok(events(h).some((e) => e.action === 'approve' && e.detail.approval === good.id));
  assert.ok(existsSync(path.join(engine.runDir(h.ctx, h.runId), 'approvals', `${good.id}.json`)));
  engine.start(h.ctx, h.runId, 'T2', { agent: 'architecture-critic', promptSha256: P(1) });
  refused(() => engine.applyApproval(h.ctx, h.runId, 'T2', good), 'NOT_AWAITING');
  assert.ok(h.load().approvalsUsed.includes(good.id), 'an approval is remembered so it cannot be replayed');
  void k4; void k4b;
});

test('a rejection cancels the task, and a task paused mid-run for approval gets its attempt back', () => {
  const k = makeKey(['P2']);
  const h = setup(examplePlan(), { model: syntheticModel([k]) });
  engine.start(h.ctx, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(1) });
  refused(() => engine.pauseForApproval(h.ctx, h.runId, 'T1', { tier: 'P1', reason: 'x' }), 'APPROVAL');
  engine.pauseForApproval(h.ctx, h.runId, 'T1', { tier: 'P2', reason: 'the delegate found it needs a decision on scope' });
  assert.equal(h.status('T1'), 'AWAITING_APPROVAL'); assert.equal(h.st('T1').attempts, 0, 'the attempt is refunded');
  const rec = perm.signApproval(engine.requestApproval(h.ctx, h.runId, 'T1', { decision: 'reject', reason: 'out of scope' }), k.privateKeyPem, k.keyId);
  assert.equal(engine.applyApproval(h.ctx, h.runId, 'T1', rec).decision, 'reject');
  assert.equal(h.status('T1'), 'CANCELLED');
  assert.equal(h.status('T2'), 'BLOCKED');
});

test('a P4 task approval needs two distinct registered approvers', () => {
  const a = makeKey(['P4']); const b = makeKey(['P4']);
  const p = plan((x) => { taskOf(x, 'T1').approval = { required: true, tier: 'P4', reason: 'sensitive step needing two people' }; });
  const h = setup(p, { model: syntheticModel([a, b]) });
  assert.equal(h.status('T1'), 'AWAITING_APPROVAL');
  const req = engine.requestApproval(h.ctx, h.runId, 'T1', { reason: 'two people read it' });
  const one = perm.signApproval(req, a.privateKeyPem, a.keyId);
  assert.throws(() => engine.applyApproval(h.ctx, h.runId, 'T1', one), (e) => /needs 2 valid/.test(e.message));
  assert.throws(() => engine.applyApproval(h.ctx, h.runId, 'T1', perm.signApproval(one, a.privateKeyPem, a.keyId)), (e) => /needs 2 valid/.test(e.message), 'the same key twice is one approver');
  engine.applyApproval(h.ctx, h.runId, 'T1', perm.signApproval(one, b.privateKeyPem, b.keyId));
  assert.equal(h.status('T1'), 'READY');
});

test('with the committed (empty) approver registry, no task approval can ever succeed', () => {
  const p = plan((x) => { taskOf(x, 'T1').approval = { required: true, tier: 'P2', reason: 'needs a person' }; });
  const h = setup(p);
  const k = makeKey(['P2']);
  const rec = perm.signApproval(engine.requestApproval(h.ctx, h.runId, 'T1', { reason: 'x' }), k.privateKeyPem, k.keyId);
  assert.throws(() => engine.applyApproval(h.ctx, h.runId, 'T1', rec), (e) => e.code === 'APPROVAL_INVALID');
  assert.equal(h.status('T1'), 'AWAITING_APPROVAL');
});

test('file artifacts must be fresh, exist and pass; a stale or missing file fails the attempt', () => {
  const h = sandboxSetup();
  const file = path.join(h.root, 'docs/design/system/PROPOSAL.md');
  writeFileSync(file, 'An old proposal citing FR-001.\n');
  const old = new Date(Date.now() - 3600000); utimesSync(file, old, old);
  engine.start(h.ctx, h.runId, 'T1', { agent: 'principal-architect', promptSha256: P(1) });
  const stale = engine.submit(h.ctx, h.runId, 'T1', {});
  assert.equal(stale.outcome, 'failed');
  assert.ok(stale.results.some((r) => r.type === 'artifact-fresh' && !r.ok), 'a file older than the attempt is not this attempt\'s work');
  engine.retry(h.ctx, h.runId, 'T1');
  engine.start(h.ctx, h.runId, 'T1', { agent: 'principal-architect', promptSha256: P(2) });
  rmSync(file, { force: true });
  assert.equal(engine.submit(h.ctx, h.runId, 'T1', {}).outcome, 'failed');
  assert.match(h.st('T1').feedback.join(' '), /does not exist/);
});

test('a fresh file artifact completes, records its hash, and resume detects later drift and revalidates it', () => {
  const h = sandboxSetup();
  const file = path.join(h.root, 'docs/design/system/PROPOSAL.md');
  engine.start(h.ctx, h.runId, 'T1', { agent: 'principal-architect', promptSha256: P(1) });
  writeFileSync(file, 'A proposal that cites FR-001 and SEC-001.\n');
  assert.equal(engine.submit(h.ctx, h.runId, 'T1', {}).outcome, 'completed');
  const art = h.st('T1').artifacts.find((a) => a.kind === 'file');
  assert.match(art.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(engine.resume(h.ctx, h.runId).drift, [], 'unchanged files are not drift');
  writeFileSync(file, 'Someone edited the accepted proposal; it still cites FR-001.\n');
  const r = engine.resume(h.ctx, h.runId);
  assert.deepEqual(r.drift, ['T1']);
  assert.equal(h.status('T1'), 'VALIDATING');
  assert.ok(h.load().attention.some((a) => /artifact drift/.test(a)));
  assert.equal(engine.validateTask(h.ctx, h.runId, 'T1').outcome, 'completed');
  assert.notEqual(h.st('T1').artifacts.find((a) => a.kind === 'file').sha256, art.sha256, 'the new hash is recorded');
  writeFileSync(file, 'Edited again and now it cites nothing at all.\n');
  engine.resume(h.ctx, h.runId);
  assert.equal(engine.validateTask(h.ctx, h.runId, 'T1').outcome, 'failed', 'revalidation applies the acceptance tests again');
});

test('a captured result that is altered after acceptance is tampering: the run stops', () => {
  const h = setup();
  runTask(h, 'T1', GOOD_T1);
  const f = path.join(engine.runDir(h.ctx, h.runId), h.st('T1').artifacts[0].path);
  writeFileSync(f, readFileSync(f, 'utf8').replace('FR-001', 'FR-001 and invented claims'));
  assert.ok(engine.verifyRun(h.ctx, h.runId).problems.some((x) => /altered/.test(x)));
  assert.deepEqual(engine.resume(h.ctx, h.runId).drift, ['T1']);
  assert.equal(engine.validateTask(h.ctx, h.runId, 'T1').outcome, 'failed');
  assert.equal(h.load().state, 'STOPPED'); assert.equal(h.st('T1').lastError.class, 'INTERNAL');
});

test('command checks run only through validate, are evidenced, and a failing command fails the task', () => {
  const pass = sandboxSetup(filePlan((p) => { taskOf(p, 'T1').acceptance.push({ id: 'A3', type: 'command', argv: ['node', '--test', 'tests/ok.test.mjs'] }); }));
  engine.start(pass.ctx, pass.runId, 'T1', { agent: 'principal-architect', promptSha256: P(1) });
  writeFileSync(path.join(pass.root, 'docs/design/system/PROPOSAL.md'), 'Cites FR-001.\n');
  const s = engine.submit(pass.ctx, pass.runId, 'T1', {});
  assert.equal(s.outcome, 'pending'); assert.equal(pass.status('T1'), 'VALIDATING');
  assert.equal(engine.nextActions(pass.ctx, pass.load()).recommendation.action, 'validate');
  const v = engine.validateTask(pass.ctx, pass.runId, 'T1');
  assert.equal(v.outcome, 'completed');
  const ev = pass.st('T1').evidence.find((e) => e.type === 'command');
  const rec = JSON.parse(readFileSync(path.join(engine.runDir(pass.ctx, pass.runId), ev.ref), 'utf8'));
  assert.equal(rec.exitCode, 0); assert.deepEqual(rec.argv, ['node', '--test', 'tests/ok.test.mjs']); assert.match(rec.outputSha256, /^[0-9a-f]{64}$/);
  assert.ok('workingTreeDirty' in rec, 'command evidence says whether the tree matched the commit it names');

  const fail = sandboxSetup(filePlan((p) => { taskOf(p, 'T1').acceptance.push({ id: 'A3', type: 'command', argv: ['node', '--test', 'tests/bad.test.mjs'] }); }));
  engine.start(fail.ctx, fail.runId, 'T1', { agent: 'principal-architect', promptSha256: P(1) });
  writeFileSync(path.join(fail.root, 'docs/design/system/PROPOSAL.md'), 'Cites FR-001.\n');
  engine.submit(fail.ctx, fail.runId, 'T1', {});
  assert.equal(engine.validateTask(fail.ctx, fail.runId, 'T1').outcome, 'failed');
  assert.equal(fail.st('T1').lastError.class, 'ACCEPTANCE_FAILED');
  assert.ok(fail.st('T1').feedback.some((f) => /exit 1/.test(f)));
});

test('the engine never runs a command a plan could smuggle in: the allow-list is enforced again at run time', () => {
  const h = sandboxSetup(filePlan((p) => { taskOf(p, 'T1').acceptance.push({ id: 'A3', type: 'command', argv: ['node', '--test', 'tests/ok.test.mjs'] }); }));
  engine.start(h.ctx, h.runId, 'T1', { agent: 'principal-architect', promptSha256: P(1) });
  writeFileSync(path.join(h.root, 'docs/design/system/PROPOSAL.md'), 'Cites FR-001.\n');
  engine.submit(h.ctx, h.runId, 'T1', {});
  const stricter = { ...h.ctx, policy: { ...policy, commandAllowList: ['^npm run validate$'] } };
  assert.equal(engine.validateTask(stricter, h.runId, 'T1').outcome, 'failed');
  assert.match(h.st('T1').feedback.join(' '), /not on the command allow-list/);
});

test('permissions are re-checked at every start: a plan that was valid is refused if the world changed', () => {
  const h = setup();
  const strict = { ...h.ctx, phase: 0, agents: JSON.parse(JSON.stringify(h.ctx.agents)) };
  strict.agents.agents['maritime-domain'].tools = ['read'];
  refused(() => engine.start(strict, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(1) }), 'PERMISSION');
  assert.equal(h.status('T1'), 'READY');
});

test('the default tmp helper is isolated from the real run store', () => {
  assert.ok(tmp().includes('gf-orch-'));
});

test('a reopen never overwrites earlier captured replies: they are archived, still verified, and tampering with them is detected', () => {
  const h = setup(plan((p) => { taskOf(p, 'T1').review = { required: true, by: 'T2' }; taskOf(p, 'T1').maxAttempts = 3; }));
  const dir = engine.runDir(h.ctx, h.runId);
  runTask(h, 'T1', GOOD_T1);
  runTask(h, 'T2', 'First challenge of SEC-001.\n\nVerdict: REWORK\n');
  const first = h.st('T2').artifacts.find((a) => a.kind === 'result');
  const firstText = readFileSync(path.join(dir, first.path), 'utf8');
  engine.reopen(h.ctx, h.runId, 'T1', { reason: 'critic verdict REWORK' });
  runTask(h, 'T1', GOOD_T1);
  runTask(h, 'T2', 'Second challenge of SEC-001, after the rework.\n\nVerdict: ACCEPT\n');
  const second = h.st('T2').artifacts.find((a) => a.kind === 'result');
  assert.notEqual(second.path, first.path, 'the second reply has its own file');
  assert.equal(readFileSync(path.join(dir, first.path), 'utf8'), firstText, 'the first reply is untouched');
  const t2 = h.st('T2');
  assert.equal(t2.archive.length, 1); assert.equal(t2.archive[0].verdict, 'REWORK'); assert.equal(t2.archive[0].artifacts[0].path, first.path);
  assert.equal(h.load().state, 'COMPLETED');
  assert.equal(engine.verifyRun(h.ctx, h.runId).ok, true);
  writeFileSync(path.join(dir, first.path), `${firstText}\nrewritten history`);
  assert.ok(engine.verifyRun(h.ctx, h.runId).problems.some((x) => /archived result .* was altered/.test(x)));
  rmSync(path.join(dir, first.path));
  assert.ok(engine.verifyRun(h.ctx, h.runId).problems.some((x) => /archived result .* is missing/.test(x)));
});

test('release: an attempt that never ran is refunded by a human with a reason, and the budget is intact afterwards', () => {
  const h = setup();
  engine.start(h.ctx, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(1) });
  refused(() => engine.release(h.ctx, h.runId, 'T1', { reason: 'short' }), 'REASON');
  refused(() => engine.release(h.ctx, h.runId, 'T2', { reason: 'this task never started at all' }), 'NOT_RUNNING');
  const r = engine.release(h.ctx, h.runId, 'T1', { reason: 'the tool rejected the call; no delegate ran' });
  assert.equal(r.state, 'ACTIVE');
  const t = h.st('T1');
  assert.equal(t.status, 'READY'); assert.equal(t.attempts, 0, 'refunded'); assert.equal(t.lease, null);
  assert.equal(t.released.length, 1); assert.match(t.released[0].reason, /rejected the call/);
  assert.ok(events(h).some((e) => e.action === 'release' && e.detail.attemptRefunded === true));
  engine.start(h.ctx, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(1) });
  assert.equal(h.st('T1').attempts, 1, 'the same prompt may be used again because no attempt consumed it');
  assert.equal(engine.nextActions(h.ctx, h.load()).recommendation.action, 'wait');
  assert.match(engine.nextActions(h.ctx, h.load()).recommendation.why, /release/);
});

// ---- regressions for the independent review of the framework -------------------------------------------------------------

test('review finding: a quoted earlier verdict cannot mask a final REWORK; one verdict, repeated, is fine', () => {
  const h = setup(plan((p) => { taskOf(p, 'T1').review = { required: true, by: 'T2' }; }));
  runTask(h, 'T1', GOOD_T1);
  engine.start(h.ctx, h.runId, 'T2', { agent: 'architecture-critic', promptSha256: P(1) });
  const r = engine.submit(h.ctx, h.runId, 'T2', { resultText: 'Verdict: ACCEPT\n\nThe previous draft concluded the above, but this review finds SEC-001 unacceptable.\n\nVerdict: REWORK\n' });
  assert.equal(r.outcome, 'failed');
  assert.match(h.st('T2').feedback.join(' '), /conflicting verdict lines \(ACCEPT, REWORK\)/);
  assert.equal(h.st('T2').verdict, null, 'no verdict is recorded from a conflicting reply');
  engine.retry(h.ctx, h.runId, 'T2');
  engine.start(h.ctx, h.runId, 'T2', { agent: 'architecture-critic', promptSha256: P(2) });
  assert.equal(engine.submit(h.ctx, h.runId, 'T2', { resultText: 'Findings on SEC-001.\n\nVerdict: REWORK\n\nSummary again.\n**Verdict:** REWORK\n' }).outcome, 'completed');
  assert.equal(h.st('T2').verdict, 'REWORK'); assert.equal(h.load().state, 'NEEDS_HUMAN');
});

test('review finding: untracked delegation is denied while a run is waiting for a human or stopped, and a human closing the run releases it', () => {
  const h = setup(plan((p) => { taskOf(p, 'T1').review = { required: true, by: 'T2' }; }));
  runTask(h, 'T1', GOOD_T1); runTask(h, 'T2', 'SEC-001 is weak.\n\nVerdict: REWORK\n');
  assert.equal(h.load().state, 'NEEDS_HUMAN');
  const free = { toolName: 'task', toolArgs: { name: 'x', agent_type: 'principal-architect', mode: 'sync', prompt: 'untracked work' } };
  const d = engine.delegationPre(h.ctx, free);
  assert.equal(d.decision, 'deny'); assert.equal(d.rule, 'ORCH-01'); assert.match(d.reason, /NEEDS_HUMAN/);
  refused(() => engine.closeRun(h.ctx, h.runId, { reason: 'short' }), 'REASON');
  engine.closeRun(h.ctx, h.runId, { reason: 'Accepted the critic REWORK as the outcome; the proposal is discarded.' });
  assert.equal(h.load().state, 'CLOSED');
  assert.equal(engine.delegationPre(h.ctx, free).decision, 'allow', 'a closed run no longer gates ad hoc delegation');
  refused(() => engine.closeRun(h.ctx, h.runId, { reason: 'closing a second time now' }), 'NOT_CLOSABLE');
  refused(() => engine.start(h.ctx, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(9) }), 'RUN_NOT_ACTIVE');
  assert.equal(engine.nextActions(h.ctx, h.load()).recommendation.action, 'stop');
  const s = setup(); engine.start(s.ctx, s.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(1) }); engine.fail(s.ctx, s.runId, 'T1', { errorClass: 'POLICY_VIOLATION', message: 'cross-jurisdiction copy' });
  assert.equal(engine.delegationPre(s.ctx, free).decision, 'deny', 'a STOPPED run also gates it');
});

test('review finding: the state hash covers the plan, order, limits, policy fields and every task field', () => {
  const edits = {
    'policyBlocking': (j) => { j.policyBlocking = []; }, 'plan': (j) => { j.plan.tasks[0].maxAttempts = 3; }, 'topoOrder': (j) => { j.topoOrder.reverse(); },
    'limits': (j) => { j.limits.leaseMinutes = 99999; }, 'createdAt': (j) => { j.createdAt = '2020-01-01T00:00:00.000Z'; }, 'a task field': (j) => { j.tasks.T1.reopens = 9; },
    'hashVersion': (j) => { delete j.hashVersion; },
  };
  for (const [name, fn] of Object.entries(edits)) {
    const h = setup(plan((p) => { taskOf(p, 'T1').review = { required: true, by: 'T2' }; }));
    runTask(h, 'T1', GOOD_T1); runTask(h, 'T2', 'Weak SEC-001.\n\nVerdict: REWORK\n');
    const f = path.join(engine.runDir(h.ctx, h.runId), 'run.json');
    const j = JSON.parse(readFileSync(f, 'utf8')); fn(j); writeFileSync(f, JSON.stringify(j, null, 2));
    assert.throws(() => h.load(), (e) => e.code === 'INTEGRITY', `editing ${name} must be detected`);
    assert.equal(engine.verifyRun(h.ctx, h.runId).ok, false, name);
  }
});

test('review finding: blocking verdicts come from the trusted policy, not from the run file', () => {
  const h = setup(plan((p) => { taskOf(p, 'T1').review = { required: true, by: 'T2' }; }));
  const lax = { ...h.ctx, policy: { ...policy, blockingVerdicts: [] } };
  runTask(h, 'T1', GOOD_T1); runTask(h, 'T2', 'Weak SEC-001.\n\nVerdict: REWORK\n');
  assert.equal(h.load().state, 'NEEDS_HUMAN');
  assert.equal(engine.checkpoint(lax, h.runId).n >= 0, true);
  assert.equal(h.load().state, 'COMPLETED', 'only the policy decides what blocks, so a different policy is a control-plane change and is visible in review');
});

test('review finding: verify checks accepted file artifacts and command evidence, tolerating only line-ending differences', () => {
  const h = sandboxSetup(filePlan((p) => { taskOf(p, 'T1').acceptance.push({ id: 'A3', type: 'command', argv: ['node', '--test', 'tests/ok.test.mjs'] }); }));
  const file = path.join(h.root, 'docs/design/system/PROPOSAL.md');
  engine.start(h.ctx, h.runId, 'T1', { agent: 'principal-architect', promptSha256: P(1) });
  writeFileSync(file, 'Line one cites FR-001.\r\nLine two.\r\n');
  engine.submit(h.ctx, h.runId, 'T1', {}); engine.validateTask(h.ctx, h.runId, 'T1');
  assert.equal(h.status('T1'), 'COMPLETED');
  assert.equal(engine.verifyRun(h.ctx, h.runId).ok, true);
  writeFileSync(file, 'Line one cites FR-001.\nLine two.\n');
  assert.equal(engine.verifyRun(h.ctx, h.runId).ok, true, 'a Windows to Linux line-ending change is not tampering');
  writeFileSync(file, 'Line one cites FR-001.\nLine two, altered.\n');
  assert.ok(engine.verifyRun(h.ctx, h.runId).problems.some((x) => /accepted file .* no longer matches/.test(x)));
  writeFileSync(file, 'Line one cites FR-001.\r\nLine two.\r\n');
  const ev = path.join(engine.runDir(h.ctx, h.runId), h.st('T1').evidence.find((e) => e.type === 'command').ref);
  writeFileSync(ev, `${readFileSync(ev, 'utf8')} `);
  assert.ok(engine.verifyRun(h.ctx, h.runId).problems.some((x) => /command evidence .* was altered/.test(x)));
});

test('a run written under the old state hash still loads, and its next change upgrades it to the whole-state hash', () => {
  const h = setup();
  runTask(h, 'T1', GOOD_T1);
  assert.equal(h.load().hashVersion, 2);
  const dir = engine.runDir(h.ctx, h.runId);
  rmSync(path.join(dir, 'checkpoints'), { recursive: true, force: true });
  // Rebuild the log and run.json as the earlier engine wrote them: version-1 state hash, no hashVersion.
  const run = h.load(); delete run.hashVersion;
  const legacy = engine.canonical({ runId: run.runId, planHash: run.planHash, state: run.state, rev: run.rev, attention: run.attention, tasks: run.tasks, approvalsUsed: run.approvalsUsed });
  const sh = engine.sha256(legacy);
  const evs = engine.readEvents(dir); let prev = null;
  const rebuilt = evs.map((e) => { const x = { ...e, prevHash: prev }; delete x.hash; if (e.seq === evs.at(-1).seq || e.rev === run.rev) x.stateHash = sh; x.hash = engine.sha256(engine.canonical({ ...x, hash: undefined })); prev = x.hash; return x; });
  const last = rebuilt.filter((e) => e.rev === run.rev);
  run.eventHead = rebuilt.at(-1).hash; run.lastCommit = { events: last };
  writeFileSync(path.join(dir, 'events.jsonl'), `${rebuilt.map((e) => JSON.stringify(e)).join('\n')}\n`);
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify(run, null, 2));
  assert.equal(h.load().hashVersion, undefined, 'the legacy run loads under its own hash');
  engine.checkpoint(h.ctx, h.runId, { label: 'upgrade' });
  assert.equal(h.load().hashVersion, 2);
  assert.ok(events(h).some((e) => e.action === 'integrity-upgrade'));
  assert.equal(engine.verifyRun(h.ctx, h.runId).ok, true);
});
