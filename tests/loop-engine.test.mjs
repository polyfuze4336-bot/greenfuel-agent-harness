// The bounded Plan -> Execute -> Verify -> Critique -> Repair loop: the six requested scenarios plus the rules that make it safe.
// Every test builds its own workspace under .harness-work and its own loop store and log folders. A "repair" here is a scripted
// file copy standing in for a model, so these tests show the loop's decisions (repair, diagnose, escalate, stop), not model skill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loop, repo, FIX, readJson, setup, diagnosis, lastLabel, toolchainOk, toolchainDir } from './support/loop-fixtures.mjs';
import { agentHook, AGENTS } from './support/permission-fixtures.mjs';

const refused = (fn, code, re) => assert.throws(fn, (e) => { assert.ok(e instanceof loop.Refusal, `expected a refusal, got ${e?.constructor?.name}: ${e?.message}`); assert.equal(e.code, code); if (re) assert.match(e.message, re); return true; });
const outTail = (h, label) => readJson(path.join(h.dir(), 'checks', `${label}.json`)).outputTail;
// first attempt with no change, so the first verification fails and the loop asks for a repair
function failFirst(h) { h.init(); h.begin(); h.end({ summary: 'initial attempt: nothing changed' }); return h.verify(); }

// ---------------------------------------------------------------- scenario 1: TypeScript build failure
test('1. a TypeScript build failure is repaired: classified, fed back, fixed and verified by the loop', { skip: !toolchainOk() && 'the pinned TypeScript toolchain is not installed (see docs/loop/LOOP.md); CI does not install it' }, () => {
  const h = setup('ts-build');
  const r1 = failFirst(h);
  assert.equal(r1.state, 'REPAIR');
  assert.equal(r1.results[0].class, 'BUILD_ERROR');
  assert.match(outTail(h, r1.results[0].label), /TS2322/, 'the compiler error is kept');
  assert.equal(h.status().next.action, 'begin');
  assert.equal(h.begin().feedback[0].class, 'BUILD_ERROR');
  h.apply('fix');
  const e = h.end({ summary: 'return a number, not a string' });
  assert.deepEqual(e.changed, ['src/sum.ts']);
  assert.equal(h.verify().state, 'PASSED');
  assert.deepEqual(h.check().problems, []);
  assert.equal(h.load().outcome.state, 'PASSED');
});

test('1b. a missing or unpinned toolchain stops the loop as missing critical context instead of guessing', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-notool-'));
  const h = setup('ts-build', { ctxOpts: { toolchainDir: empty } });
  h.init(); h.begin(); h.end({});
  const r = h.verify();
  assert.equal(r.state, 'STOPPED');
  assert.equal(h.load().outcome.class, 'MISSING_CONTEXT');
  assert.match(h.load().outcome.detail, /toolchain is not installed/);
  assert.equal(h.load().attempts.filter((a) => a.type === 'repair').length, 0, 'no repair was attempted');
  fs.rmSync(empty, { recursive: true, force: true });
});

// ---------------------------------------------------------------- scenario 2: failed API contract test
test('2. a failed API contract test is repaired; failures and the repair history are preserved', () => {
  const h = setup('api-contract');
  const r1 = failFirst(h);
  assert.equal(r1.state, 'REPAIR');
  assert.equal(r1.results[0].class, 'CONTRACT_FAILURE');
  const failLabel = r1.results[0].label;
  assert.match(outTail(h, failLabel), /quantity must be a number/);
  h.begin(); h.apply('fix');
  assert.deepEqual(h.end({ summary: 'return quantity as a number' }).changed, ['api/handler.mjs']);
  const r2 = h.verify();
  assert.equal(r2.state, 'PASSED');
  const L = h.load();
  assert.deepEqual(L.attempts.map((a) => `${a.id}:${a.status}`), ['E0:ENDED', 'R1:ENDED']);
  assert.equal(L.failureHistory.length, 1);
  assert.ok(fs.existsSync(path.join(h.dir(), 'checks', `${failLabel}.json`)), 'the failing run is still there after the pass');
  assert.match(fs.readFileSync(path.join(h.dir(), 'checks', `${failLabel}.out.txt`), 'utf8'), /quantity must be a number/);
  // before and after copies let a reviewer see exactly what the repair changed
  assert.match(fs.readFileSync(path.join(h.dir(), 'attempts', 'R1', 'before', 'api', 'handler.mjs'), 'utf8'), /String\(id \* 2\)/);
  assert.match(fs.readFileSync(path.join(h.dir(), 'attempts', 'R1', 'after', 'api', 'handler.mjs'), 'utf8'), /quantity: id \* 2/);
  assert.deepEqual(h.check().problems, []);
  refused(() => h.begin(), 'NOT_READY');
});

test('2b. a repair that edits the protected contract check is refused as tampering and stops the loop', () => {
  const h = setup('api-contract');
  failFirst(h); h.begin();
  h.write('contract.check.mjs', "import test from 'node:test';\ntest('always passes', () => {});\n");
  const r = h.end({ summary: 'make the check pass' });
  assert.equal(r.outcome.state, 'STOPPED');
  assert.equal(r.outcome.class, 'TEST_TAMPERING');
  assert.match(r.outcome.detail, /contract\.check\.mjs is protected/);
  assert.equal(h.load().checkRuns, 1, 'no verification ran on the tampered files');
  assert.ok(fs.existsSync(path.join(h.dir(), 'attempts', 'R1', 'after', 'contract.check.mjs')), 'the rejected change is kept for the reviewer');
  refused(() => h.verify(), 'NOT_VERIFYING');
  assert.deepEqual(h.check().problems, []);
});

// ---------------------------------------------------------------- scenario 3: incorrect emissions calculation fixture
test('3. an incorrect fixture calculation is repaired against a separately documented expected result', () => {
  const doc = fs.readFileSync(path.join(FIX, 'emissions', 'EXPECTED.md'), 'utf8');
  const data = readJson(path.join(FIX, 'emissions', 'workspace', 'fixture-data.json'));
  assert.match(doc, /\*\*2500 kg\*\*/);
  assert.equal(data.expectedKg, 2500, 'the documented value and the data file agree');
  assert.equal(data.massKg * data.factorKgPerKg, 2500);
  assert.match(doc, /not a certification-scheme factor/);
  assert.match(data.note, /FIXTURE ONLY/);
  const h = setup('emissions');
  const r1 = failFirst(h);
  assert.equal(r1.results[0].class, 'CALCULATION_MISMATCH');
  assert.match(outTail(h, r1.results[0].label), /1002\.5/, 'the wrong result is in the preserved output');
  h.begin(); h.apply('fix'); h.end({ summary: 'multiply mass by factor' });
  assert.equal(h.verify().state, 'PASSED');
  assert.equal(h.read('fixture-data.json').includes('"expectedKg": 2500'), true, 'the expected result was never touched');
});

test('3b. changing the expected result to match the wrong code is refused: the loop will not let a check be edited to pass', () => {
  const h = setup('emissions');
  failFirst(h); h.begin();
  fs.copyFileSync(path.join(FIX, 'emissions', 'tamper', 'fixture-data.json'), path.join(h.ws, 'fixture-data.json'));
  const r = h.end({ summary: 'align the expected value with the output' });
  assert.equal(r.outcome.class, 'TEST_TAMPERING');
  assert.equal(h.load().state, 'STOPPED');
  assert.match(h.read('calc.mjs'), /massKg \+ factorKgPerKg/, 'nothing was fixed or hidden');
});

// ---------------------------------------------------------------- scenario 4: sovereignty policy violation
test('4. a sovereignty policy violation stops the loop immediately: no repair, no retry, a human decision is required', () => {
  const h = setup('sovereignty');
  h.init(); h.begin();
  h.write('NOTES.md', '# Fixture notes\n\nTried: name a cloud region as the residency basis.\n');
  h.end({ summary: 'declare the region as the residency basis' });
  const r = h.verify();
  assert.equal(r.state, 'STOPPED');
  const L = h.load();
  assert.equal(L.outcome.class, 'HARD_CONSTRAINT_VIOLATION');
  assert.match(L.outcome.requires, /architecture decision/);
  assert.match(outTail(h, r.results[0].label), /a cloud region is not a residency control/, 'the real validator said so');
  assert.equal(L.checkRuns, 1, 'the check ran once and was not retried');
  assert.equal(L.attempts.filter((a) => a.type === 'repair').length, 0, 'no repair attempt was offered');
  assert.equal(h.status().next.action, 'human');
  refused(() => h.begin(), 'NOT_READY');
  refused(() => h.verify(), 'NOT_VERIFYING');
  assert.deepEqual(h.check().problems, []);
});

// ---------------------------------------------------------------- scenario 5: unauthorized cross-shipowner data access
test('5. reading another shipowner\'s fixture stops the loop, is denied and audited, and never reaches verification', () => {
  const h = setup('api-contract', { task: { scope: { shipowner: 'owner-a' } } });
  failFirst(h); h.begin();
  const r = h.end({ summary: 'look at owner-b data for hints', actions: [{ tool: 'view', args: { path: 'tests/fixtures/shipowners/owner-b/delivery-summary.json' } }] });
  assert.equal(r.outcome.state, 'STOPPED');
  assert.equal(h.load().outcome.class, 'PERMISSION_VIOLATION');
  assert.match(h.load().outcome.detail, /owner-b/);
  assert.match(h.load().outcome.detail, /DEF-04/);
  assert.equal(h.load().checkRuns, 1);
  const rows = h.logRows();
  assert.ok(rows.some((x) => x.rules.includes('DEF-04')), 'the denial is in the audit log');
  assert.ok(!JSON.stringify(rows).includes('SYNTHETIC-OWNER-B-CONFIDENTIAL-MARKER'));
});

test('5b. the same scope allows the shipowner\'s own fixture, and copying another shipowner\'s content into the workspace is caught', () => {
  const h = setup('api-contract', { task: { scope: { shipowner: 'owner-a' } } });
  failFirst(h); h.begin();
  h.apply('fix');
  const ok = h.end({ summary: 'fix', actions: [{ tool: 'view', args: { path: 'tests/fixtures/shipowners/owner-a/delivery-summary.json' } }] });
  assert.equal(ok.state, 'VERIFY', 'the in-scope read is allowed');
  const g = setup('api-contract');
  failFirst(g); g.begin();
  g.write('api/notes.txt', 'copied: SYNTHETIC-OWNER-B-CONFIDENTIAL-MARKER');
  const r = g.end({ summary: 'copy' });
  assert.equal(r.outcome.state, 'STOPPED');
  assert.equal(g.load().outcome.class, 'SENSITIVE_DATA');
});

test('5c. an agent actor is screened by its own contract: in Phase 0 no agent may change workspace code, with a Phase 1 scope it may', () => {
  const real = setup('api-contract', { task: { agent: 'application-engineer' } });
  failFirst(real); real.begin(); real.apply('fix');
  const r = real.end({ summary: 'fix' });
  assert.equal(r.outcome.class, 'PERMISSION_VIOLATION');
  assert.ok(real.logRows().some((x) => x.agent === 'application-engineer'), 'the guard recorded the denial against the agent');

  const policy = JSON.parse(JSON.stringify(readJson(path.join(repo, 'harness/policy/agent-policy.json'))));
  policy.agents['application-engineer'].writes = ['.harness-work/**'];
  policy.agents['application-engineer'].writesPhase1 = ['.harness-work/**'];
  const scoped = setup('api-contract', { task: { agent: 'application-engineer' }, ctxOpts: { agentPolicy: policy, phase: 1 } });
  failFirst(scoped); scoped.begin(); scoped.apply('fix');
  assert.equal(scoped.end({ summary: 'fix' }).state, 'VERIFY', 'inside an explicit scope the same change is allowed');
  assert.equal(scoped.verify().state, 'PASSED');
});

// ---------------------------------------------------------------- scenario 6: repeated failure that cannot be repaired safely
test('6a. the same failure twice escalates to a person instead of retrying', () => {
  const h = setup('api-contract');
  failFirst(h); h.begin();
  h.write('api/handler.mjs', `${h.read('api/handler.mjs')}\n// tidy up\n`);
  h.end({ summary: 'cosmetic change only' });
  const r = h.verify();
  assert.equal(r.state, 'ESCALATED');
  const L = h.load();
  assert.equal(L.outcome.class, 'REPEATED_FAILURE');
  assert.equal(L.failureHistory.length, 2);
  assert.equal(L.failureHistory[0].fingerprint, L.failureHistory[1].fingerprint, 'a comment moved the line numbers; the fingerprint ignores them');
  assert.equal(L.attempts.filter((a) => a.type === 'repair').length, 1, 'one repair, not three');
  assert.match(L.outcome.requires, /diagnosis/);
  assert.equal(h.status().next.action, 'human');
  assert.deepEqual(h.check().problems, []);
});

test('6b. repairs that fail differently each time are diagnosed, then stop when the three-attempt budget is used', () => {
  const h = setup('api-contract');
  failFirst(h);
  const tryQuantity = (expr, summary) => { h.begin(); h.write('api/handler.mjs', `export function getItem(id) {\n  return { id, name: \`item-\${id}\`, quantity: ${expr} };\n}\n`); h.end({ summary }); return h.verify(); };
  assert.equal(tryQuantity('null', 'use null for the quantity').state, 'DIAGNOSE', 'the second failure needs a diagnosis, not a blind retry');
  // a repair cannot begin without a diagnosis
  refused(() => h.begin(), 'NOT_READY', /record a diagnosis first/);
  const label = lastLabel(h);
  // diagnoses that are refused
  refused(() => loop.diagnose(h.ctx, h.id, { hypothesis: 'x', evidence: [label], differentApproach: 'y' }), 'DIAGNOSIS_REJECTED', /20 to/);
  refused(() => loop.diagnose(h.ctx, h.id, diagnosis(h, 'E0-v1-api-contract', 'Return the quantity as a plain number computed from the id.')), 'DIAGNOSIS_REJECTED', /latest failure/);
  refused(() => loop.diagnose(h.ctx, h.id, diagnosis(h, 'nope', 'Return the quantity as a plain number computed from the id.')), 'DIAGNOSIS_REJECTED', /latest failure/);
  refused(() => loop.diagnose(h.ctx, h.id, diagnosis(h, label, 'Edit the expected type in the contract so the check accepts null.')), 'DIAGNOSIS_REJECTED', /weakening a test/);
  refused(() => loop.diagnose(h.ctx, h.id, diagnosis(h, label, 'use null for the quantity')), 'DIAGNOSIS_REJECTED', /same approach as one already tried/);
  assert.equal(h.events().filter((e) => e.action === 'diagnosis-rejected').length, 5, 'each refusal is in the log');
  assert.deepEqual(h.check().problems, [], 'refusals leave the store consistent');
  assert.equal(loop.diagnose(h.ctx, h.id, diagnosis(h, label, 'Compute the quantity as a number from the id instead of a placeholder value.')).state, 'REPAIR');
  assert.equal(tryQuantity('undefined', 'use undefined for the quantity').state, 'DIAGNOSE');
  loop.diagnose(h.ctx, h.id, diagnosis(h, lastLabel(h), 'Read the type name from the failing assertion and return that type.'));
  const last = tryQuantity('true', 'use a boolean for the quantity');
  assert.equal(last.state, 'ESCALATED');
  const L = h.load();
  assert.equal(L.outcome.class, 'BUDGET_EXHAUSTED');
  assert.equal(L.attempts.filter((a) => a.type === 'repair').length, 3);
  assert.equal(L.diagnoses.length, 2);
  assert.equal(L.failureHistory.length, 4, 'every failure is kept');
  for (const lab of L.failureHistory.flatMap((x) => x.labels)) assert.ok(fs.existsSync(path.join(h.dir(), 'checks', `${lab}.out.txt`)), `${lab} preserved`);
  refused(() => h.begin(), 'NOT_READY');
  assert.deepEqual(h.check().problems, []);
});

test('6c. a failure after a non-idempotent step is escalated, never retried automatically', () => {
  const h = setup('api-contract');
  failFirst(h); h.begin();
  const r = h.end({ summary: 'commit and try again', actions: [{ tool: 'powershell', args: { command: 'git commit -m fixture' } }] });
  assert.equal(r.state, 'VERIFY');
  assert.equal(h.load().attempts[1].nonIdempotent, true);
  assert.equal(h.verify().state, 'ESCALATED');
  assert.equal(h.load().outcome.class, 'NON_IDEMPOTENT_FAILURE');
  assert.equal(h.load().attempts.filter((a) => a.type === 'repair').length, 1, 'budget remained, and it was still not retried');
});

test('6d. destructive cloud operations and secret reads are refused inside a loop, recorded and stopped', () => {
  for (const [cmd, rule] of [['az group delete -n fixture-rg --yes', /DEF-06|azure\.delete/], ['az keyvault secret show --name x --vault-name y', /DEF-05|azure\.secret\.read/]]) {
    const h = setup('api-contract');
    failFirst(h); h.begin();
    const r = h.end({ summary: 'clean up', actions: [{ tool: 'powershell', args: { command: cmd } }] });
    assert.equal(r.outcome.state, 'STOPPED', cmd);
    const a = h.load().attempts.at(-1);
    assert.ok(a.violations.some((v) => v.class === 'PERMISSION_VIOLATION' && rule.test(v.detail)), JSON.stringify(a.violations));
    assert.ok(a.violations.some((v) => v.class === 'UNSAFE_ACTION'), 'and it is on the loop\'s own never-in-a-loop list');
    assert.equal(h.load().checkRuns, 1);
  }
});

// ---------------------------------------------------------------- budget and timeouts
test('a check that exceeds its timeout is killed, classified TIMEOUT, and the wall-clock budget escalates', () => {
  const h = setup('api-contract', { task: { checks: [{ id: 'slow-test', kind: 'test', argv: ['node', '--test', 'slow.check.mjs'], timeoutSec: 1 }], limits: { wallBudgetSeconds: 1 } } });
  h.write('slow.check.mjs', "import test from 'node:test';\ntest('slow', async () => { await new Promise((r) => setTimeout(r, 30000)); });\n");
  h.task.protectedPaths = ['slow.check.mjs'];
  h.init(); h.begin(); h.end({});
  const started = Date.now();
  const r = h.verify();
  assert.ok(Date.now() - started < 15000, 'the check was killed, not waited for');
  assert.equal(r.state, 'ESCALATED');
  assert.equal(h.load().outcome.class, 'BUDGET_EXHAUSTED');
  assert.equal(h.load().failureHistory[0].classes[0], 'TIMEOUT');
});

test('the check-run budget is enforced', () => {
  const one = setup('api-contract', { task: { limits: { maxCheckRuns: 1 } } });
  assert.equal(failFirst(one).state, 'ESCALATED', 'with a one-run budget the first failure already has no budget left for a repair');
  assert.equal(one.load().outcome.class, 'BUDGET_EXHAUSTED');
  const h = setup('api-contract', { task: { limits: { maxCheckRuns: 2 } } });
  failFirst(h);
  assert.equal(h.load().checkRuns, 1);
  h.begin(); h.write('api/handler.mjs', 'export function getItem(id) {\n  return { id, name: `item-${id}`, quantity: null };\n}\n'); h.end({ summary: 'a different failure' });
  const r = h.verify();
  assert.equal(r.state, 'ESCALATED');
  assert.equal(h.load().outcome.class, 'BUDGET_EXHAUSTED');
  assert.equal(h.load().checkRuns, 2, 'no third check ran');
});

// ---------------------------------------------------------------- independent review
test('review: the loop passes only after an independent approval of the verified files; rework counts as a repair', () => {
  const h = setup('api-contract', { task: { review: { required: true, reviewer: 'architecture-critic' } } });
  h.init(); h.begin(); h.apply('fix'); h.end({ summary: 'fix' });
  assert.equal(h.verify().state, 'CRITIQUE', 'passing checks are not enough when a review is required');
  refused(() => loop.critique(h.ctx, h.id, { reviewer: 'application-engineer', verdict: 'APPROVE' }), 'REVIEWER');
  refused(() => loop.critique(h.ctx, h.id, { reviewer: 'design-reviewer', verdict: 'APPROVE' }), 'REVIEWER', /names architecture-critic/);
  refused(() => loop.critique(h.ctx, h.id, { reviewer: 'architecture-critic', verdict: 'REWORK', findings: 'no' }), 'FINDINGS');
  assert.equal(loop.critique(h.ctx, h.id, { reviewer: 'architecture-critic', verdict: 'REWORK', findings: 'The handler should not recompute the quantity inline; add a named helper.' }).state, 'REPAIR');
  assert.equal(h.status().next.action, 'begin');
  h.begin(); h.write('api/handler.mjs', `const quantityOf = (id) => id * 2;\nexport function getItem(id) {\n  return { id, name: \`item-\${id}\`, quantity: quantityOf(id) };\n}\n`);
  h.end({ summary: 'extract a helper' });
  assert.equal(h.verify().state, 'CRITIQUE');
  assert.equal(loop.critique(h.ctx, h.id, { reviewer: 'architecture-critic', verdict: 'APPROVE' }).state, 'PASSED');
  assert.deepEqual(h.load().critiques.map((c) => c.verdict), ['REWORK', 'APPROVE']);
  assert.match(fs.readFileSync(path.join(h.dir(), 'critiques', 'C1.md'), 'utf8'), /does not instruct the loop/);
  assert.deepEqual(h.check().problems, []);
});

test('review: files changed between verification and review stop the loop, and a block escalates', () => {
  const a = setup('api-contract', { task: { review: { required: true } } });
  a.init(); a.begin(); a.apply('fix'); a.end({}); a.verify();
  a.write('api/handler.mjs', `${a.read('api/handler.mjs')}// sneaky\n`);
  assert.equal(loop.critique(a.ctx, a.id, { reviewer: 'architecture-critic', verdict: 'APPROVE' }).state, 'STOPPED');
  assert.equal(a.load().outcome.class, 'UNTRACKED_CHANGE');
  const b = setup('api-contract', { task: { review: { required: true } } });
  b.init(); b.begin(); b.apply('fix'); b.end({}); b.verify();
  loop.critique(b.ctx, b.id, { reviewer: 'design-reviewer', verdict: 'BLOCK', findings: 'The design violates a hard constraint.' });
  assert.equal(b.load().state, 'ESCALATED');
  assert.equal(b.load().outcome.class, 'REVIEW_BLOCK');
});

// ---------------------------------------------------------------- success cannot be declared
test('there is no way to declare success: PASSED comes only from the loop\'s own verification, and a forged state is detected', () => {
  assert.equal(Object.keys(loop).filter((k) => /pass|success|complete|mark|done/i.test(k)).length, 0, 'the loop API has no function that marks work successful');
  const h = setup('api-contract');
  failFirst(h);
  const file = path.join(h.dir(), 'loop.json');
  const forged = readJson(file); forged.state = 'PASSED'; forged.outcome = { state: 'PASSED', class: null, detail: 'forged' };
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, JSON.stringify(forged, null, 2));
  assert.ok(h.check().problems.some((p) => /loop\.json says PASSED but the event log ends in REPAIR/.test(p)));
  assert.throws(() => h.begin(), (e) => e instanceof loop.LoopError, 'a tampered store is not used');
  fs.writeFileSync(file, original);
  assert.deepEqual(h.check().problems, []);
  // an event log forged to say PASSED without a verification
  const ev = path.join(h.dir(), 'events.jsonl'); const evOrig = fs.readFileSync(ev, 'utf8');
  fs.writeFileSync(ev, evOrig.replace('"to":"REPAIR"', '"to":"PASSED"'));
  assert.ok(h.check().problems.some((p) => /content altered/.test(p)));
  fs.writeFileSync(ev, evOrig);
  // preserved evidence cannot be rewritten
  const evid = path.join(h.dir(), 'checks', fs.readdirSync(path.join(h.dir(), 'checks')).find((f) => f.endsWith('.json')));
  const evidOrig = fs.readFileSync(evid, 'utf8');
  fs.writeFileSync(evid, evidOrig.replace('"exitCode": 1', '"exitCode": 0'));
  assert.ok(h.check().problems.some((p) => /evidence file altered/.test(p)));
  fs.writeFileSync(evid, evidOrig);
  const ch = path.join(h.dir(), 'attempts', 'E0', 'changes.json');
  const chOrig = fs.readFileSync(ch, 'utf8'); fs.writeFileSync(ch, chOrig.replace('"noChange": true', '"noChange": false'));
  assert.ok(h.check().problems.some((p) => /changes record altered/.test(p)));
  fs.writeFileSync(ch, chOrig);
  const t = readJson(file); t.task.acceptance = ['anything']; fs.writeFileSync(file, JSON.stringify(t, null, 2));
  assert.ok(h.check().problems.some((p) => /task contract was changed|does not match/.test(p)));
  fs.writeFileSync(file, original);
  assert.deepEqual(h.check().problems, []);
});

test('files changed outside an attempt are never screened, so they stop the loop', () => {
  const a = setup('api-contract');
  a.init(); a.begin(); a.end({});
  a.write('api/handler.mjs', `${a.read('api/handler.mjs')}// after the attempt ended\n`);
  assert.equal(a.verify().state, 'STOPPED');
  assert.equal(a.load().outcome.class, 'UNTRACKED_CHANGE');
  const b = setup('api-contract');
  failFirst(b);
  b.write('api/handler.mjs', `${b.read('api/handler.mjs')}// between attempts\n`);
  assert.equal(b.begin().outcome.class, 'UNTRACKED_CHANGE');
});

// ---------------------------------------------------------------- recovery after interruption
test('an interrupted attempt is recovered from the files: its changes are screened and verified, in a new process', () => {
  const h = setup('api-contract');
  failFirst(h); h.begin(); h.apply('fix');
  // the session dies here: the attempt is open and never ended
  const within = loop.resume(h.again(), h.id);
  assert.equal(within.action, 'wait');
  h.state.t += 31 * 60000;
  const env = { ...process.env, HARNESS_LOOPS_DIR: h.ctx.loopsDir, HARNESS_LOG_DIR: path.join(h.tmp, 'logs') }; delete env.NODE_TEST_CONTEXT;
  const L = readJson(path.join(h.dir(), 'loop.json'));
  // the clock of a child process cannot be moved, so the moved clock is used for resume here and the child continues from the files
  const r = loop.resume(h.again(), h.id);
  assert.equal(r.interrupted, 'R1');
  assert.deepEqual(r.changed, ['api/handler.mjs']);
  assert.equal(r.state, 'VERIFY');
  assert.equal(r.next.action, 'verify');
  assert.ok(h.events().some((e) => e.action === 'attempt-interrupted'));
  const cli = spawnSync(process.execPath, [path.join(repo, 'harness/scripts/loop.mjs'), 'verify', '--loop', h.id], { env, encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  assert.equal(JSON.parse(cli.stdout).state, 'PASSED');
  assert.equal(h.load().attempts.at(-1).changed[0], 'api/handler.mjs');
  assert.ok(L.rev < h.load().rev);
  assert.deepEqual(h.check().problems, []);
});

test('an interrupted attempt whose changes break a rule is stopped on resume, not verified', () => {
  const h = setup('api-contract');
  failFirst(h); h.begin();
  h.write('contract.check.mjs', 'process.exit(0);\n');
  h.state.t += 31 * 60000;
  const r = loop.resume(h.again(), h.id);
  assert.equal(r.outcome.class, 'TEST_TAMPERING');
  assert.equal(h.load().state, 'STOPPED');
});

// ---------------------------------------------------------------- the task contract
test('the task contract is validated before anything runs', () => {
  const base = JSON.parse(fs.readFileSync(path.join(FIX, 'api-contract', 'task.json'), 'utf8'));
  const ws = '.harness-work/never-created';
  const ctx = loop.makeContext();
  const cases = [
    ['no acceptance criteria', { acceptance: [] }, /acceptance criteria are required/],
    ['an unknown agent', { agent: 'root' }, /agent must be/],
    ['an inline interpreter', { checks: [{ id: 'bad', kind: 'test', argv: ['node', '-e', 'process.exit(0)'] }] }, /not on the command allow-list/],
    ['a parent path in a check', { checks: [{ id: 'bad', kind: 'test', argv: ['node', '--test', '../x.mjs'] }] }, /allow-list|relative with no/],
    ['a package install', { checks: [{ id: 'bad', kind: 'build', argv: ['npm', 'install', 'x'] }] }, /not on the command allow-list/],
    ['an unknown check kind', { checks: [{ id: 'bad', kind: 'magic', argv: ['node', '--test', 'x.mjs'] }] }, /kind must be/],
    ['a hard constraint that is not declared', { checks: [{ id: 'bad', kind: 'policy', argv: ['node', '--test', 'x.mjs'], hardConstraint: 'HC-01' }] }, /one of the task's constraints/],
    ['no protected paths', { protectedPaths: [] }, /protectedPaths is required/],
    ['a raised limit', { limits: { maxRepairAttempts: 10 } }, /may only tighten/],
    ['an unknown limit', { limits: { timeoutMinutes: 5 } }, /cannot be set by a task/],
    ['a self review', { agent: 'design-reviewer', review: { required: true, reviewer: 'design-reviewer' } }, /not the task's own agent/],
    ['an unlisted reviewer', { review: { required: true, reviewer: 'qa-engineer' } }, /review\.reviewer must be/],
    ['a bad requirement id', { requirements: ['whatever'] }, /requirements must be/],
    ['a context file outside the repository', { contextRefs: ['file:../secret.txt'] }, /contextRefs/],
    ['scope with an unknown key', { scope: { tenant: 'x' } }, /scope may hold/],
  ];
  for (const [name, patch, re] of cases) {
    const errs = loop.validateTask(ctx, { ...base, ...patch }, ws);
    assert.ok(errs.some((e) => re.test(e)), `${name}: expected ${re}, got ${errs.join(' | ') || '(nothing)'}`);
  }
  assert.ok(loop.validateTask(ctx, base, 'docs/state').some((e) => /workspace must be a folder under/.test(e)));
  assert.ok(loop.validateTask(ctx, base, '../outside').some((e) => /workspace must be a folder under/.test(e)));
  assert.deepEqual(loop.validateTask(ctx, base, ws), []);
  const h = setup('api-contract'); // refusal at init leaves no loop behind
  refused(() => loop.init(h.ctx, { task: { ...base, acceptance: [] }, workspace: h.wsRel }), 'TASK_INVALID');
  assert.equal(loop.listLoops(h.ctx).length, 0);
});

// ---------------------------------------------------------------- test selection and fingerprints
test('test selection runs the checks that cover the changed files first, and the rest only if those pass', () => {
  const checks = [
    { id: 'b-test', kind: 'test', argv: ['node', '--test', 'b.check.mjs'], covers: ['b/**'] },
    { id: 'a-build', kind: 'build', argv: ['node', '--test', 'a.check.mjs'], covers: ['a/**'] },
    { id: 'c-contract', kind: 'contract', argv: ['node', '--test', 'c.check.mjs'] },
  ];
  const ctx = loop.makeContext();
  const first = loop.selectChecks(ctx, { checks }, null);
  assert.deepEqual(first.first.map((c) => c.id), ['a-build', 'c-contract', 'b-test'], 'build, contract, test order');
  assert.deepEqual(first.rest, []);
  const sel = loop.selectChecks(ctx, { checks }, ['b/x.mjs']);
  assert.deepEqual(sel.first.map((c) => c.id), ['c-contract', 'b-test'], 'a check with no covers always runs');
  assert.deepEqual(sel.rest.map((c) => c.id), ['a-build']);

  const h = setup('api-contract', { task: { checks: [...readJson(path.join(FIX, 'api-contract', 'task.json')).checks, { id: 'other', kind: 'test', argv: ['node', '--test', 'other.check.mjs'], covers: ['other/**'] }] } });
  h.write('other.check.mjs', "import test from 'node:test';\ntest('other', () => {});\n");
  h.task.protectedPaths = ['contract.check.mjs', 'contract/**', 'other.check.mjs'];
  h.init(); h.begin(); h.end({});
  assert.equal(h.verify().state, 'REPAIR');
  h.begin(); h.apply('fix'); h.end({});
  assert.equal(h.verify().state, 'PASSED');
  const ev = h.events().filter((e) => e.action === 'verify-start').at(-1);
  assert.deepEqual(ev.selected, ['api-contract']);
  assert.deepEqual(ev.deferred, ['other']);
  assert.deepEqual(h.events().filter((e) => e.action === 'check').slice(-2).map((e) => e.id), ['api-contract', 'other'], 'the deferred check ran after the selected one passed');
});

test('a failure has the same fingerprint when only times, line numbers and paths differ', () => {
  const a = loop.normalise('# duration_ms 12.5\nat file:///C:/x/.harness-work/t1/a.mjs:12:3\nfailed at 2026-10-28T10:00:00.123Z took 12ms', 'C:\\x\\.harness-work\\t1', 'C:\\x');
  const b = loop.normalise('# duration_ms 999.1\nat file:///C:/x/.harness-work/t1/a.mjs:40:9\nfailed at 2027-01-01T00:00:00.000Z took 87ms', 'C:\\x\\.harness-work\\t1', 'C:\\x');
  assert.equal(a, b);
  assert.notEqual(loop.normalise('expected 1', null, null), loop.normalise('expected 2', null, null));
});

// ---------------------------------------------------------------- who can run the loop
test('agents may run only the granted loop commands: qa-engineer status, verify and verify-store, nothing else, and nobody may write the loop store', () => {
  const GRANTED = { 'qa-engineer': ['status', 'verify', 'verify-store'] };
  for (const agent of AGENTS) {
    for (const sub of ['init', 'begin', 'end', 'diagnose', 'critique', 'resume', 'cancel', 'list', 'report', 'status', 'verify', 'verify-store']) {
      const cmd = sub === 'init' ? 'node harness/scripts/loop.mjs init --task t.json --workspace .harness-work/x' : `node harness/scripts/loop.mjs ${sub} --loop LOOP-0123456789`;
      const r = agentHook(agent, 'powershell', { command: cmd });
      const allowed = (GRANTED[agent] ?? []).includes(sub);
      assert.equal(r.denied, !allowed, `${agent}: ${cmd} (${r.reason})`);
    }
    for (const cmd of ['node harness/scripts/loop.mjs verify --loop LOOP-0123456789 --actor root', 'node harness/scripts/loop.mjs verify --loop ../../x', 'node harness/scripts/loop.mjs verify --loop LOOP-0123456789; node -e 1']) assert.equal(agentHook(agent, 'powershell', { command: cmd }).denied, true, `${agent}: ${cmd}`);
    const w = agentHook(agent, 'edit', { path: 'docs/state/loops/LOOP-0123456789/loop.json' });
    assert.equal(w.denied, true, `${agent} may not write the loop store`);
  }
});

// ---------------------------------------------------------------- the CLI
test('the CLI drives a loop to PASSED with meaningful exit codes, and to a stop with exit 3', () => {
  const h = setup('api-contract');
  const env = { ...process.env, HARNESS_LOOPS_DIR: h.ctx.loopsDir, HARNESS_LOG_DIR: path.join(h.tmp, 'logs') }; delete env.NODE_TEST_CONTEXT;
  const cli = (...a) => spawnSync(process.execPath, [path.join(repo, 'harness/scripts/loop.mjs'), ...a], { env, encoding: 'utf8', cwd: os.tmpdir() });
  const taskFile = path.join(h.tmp, 'task.json'); fs.writeFileSync(taskFile, JSON.stringify(h.task));
  let r = cli('init', '--task', taskFile, '--workspace', h.wsRel); assert.equal(r.status, 0, r.stdout + r.stderr);
  const id = JSON.parse(r.stdout).loopId;
  assert.equal(cli('begin', '--loop', id).status, 0);
  assert.equal(cli('end', '--loop', id, '--summary', 'first look').status, 0);
  r = cli('verify', '--loop', id); assert.equal(r.status, 1, 'a failing check is exit 1'); assert.equal(JSON.parse(r.stdout).state, 'REPAIR');
  assert.equal(cli('begin', '--loop', id).status, 0);
  h.apply('fix');
  assert.equal(cli('end', '--loop', id, '--summary', 'fix').status, 0);
  r = cli('verify', '--loop', id); assert.equal(r.status, 0, r.stdout); assert.equal(JSON.parse(r.stdout).state, 'PASSED');
  assert.equal(cli('verify-store', '--loop', id).status, 0);
  r = cli('status', '--loop', id); assert.equal(JSON.parse(r.stdout).state, 'PASSED');
  assert.match(cli('report', '--loop', id).stdout, /Preserved failures/);
  r = cli('begin', '--loop', id); assert.equal(r.status, 2, 'a refusal is exit 2'); assert.equal(JSON.parse(r.stdout).error, 'NOT_READY');
  // a stop is exit 3
  const g = setup('emissions');
  const env2 = { ...env, HARNESS_LOOPS_DIR: path.join(g.tmp, 'loops') };
  const cli2 = (...a) => spawnSync(process.execPath, [path.join(repo, 'harness/scripts/loop.mjs'), ...a], { env: env2, encoding: 'utf8', cwd: os.tmpdir() });
  const tf = path.join(g.tmp, 'task.json'); fs.writeFileSync(tf, JSON.stringify(g.task));
  const id2 = JSON.parse(cli2('init', '--task', tf, '--workspace', g.wsRel).stdout).loopId;
  cli2('begin', '--loop', id2); cli2('end', '--loop', id2); cli2('verify', '--loop', id2); cli2('begin', '--loop', id2);
  fs.copyFileSync(path.join(FIX, 'emissions', 'tamper', 'fixture-data.json'), path.join(g.ws, 'fixture-data.json'));
  r = cli2('end', '--loop', id2); assert.equal(r.status, 3, r.stdout);
  assert.equal(JSON.parse(r.stdout).outcome.class, 'TEST_TAMPERING');
});

// ---------------------------------------------------------------- regressions from the independent review
test('a check that rewrites workspace files while it runs cannot produce PASSED: the files are compared again after the checks', () => {
  const h = setup('api-contract');
  failFirst(h); h.begin();
  const bad = h.read('api/handler.mjs');
  h.write('api/handler.mjs', `import { writeFileSync } from 'node:fs';\nconst self = new URL(import.meta.url);\nconst original = ${JSON.stringify(bad)};\nexport function getItem(id) { return { id, name: \`item-\${id}\`, quantity: id * 2 }; }\nwriteFileSync(self, original);\n`);
  h.end({ summary: 'a handler that restores its old self after being loaded' });
  const r = h.verify();
  assert.equal(r.state, 'STOPPED');
  assert.equal(h.load().outcome.class, 'UNTRACKED_CHANGE');
  assert.match(h.load().outcome.detail, /a check changed files/);
  assert.ok(h.events().some((e) => e.action === 'check-changed-files' && e.changed.includes('api/handler.mjs')));
  assert.equal(h.load().verifiedSha, null, 'nothing was recorded as verified');
});

test('no folder is exempt from observation: a dependency folder is seen, and a large one is refused', () => {
  const h = setup('api-contract');
  failFirst(h); h.begin(); h.apply('fix');
  h.write('node_modules/dep/index.mjs', 'export const x = 1;\n');
  const r = h.end({ summary: 'add a dependency' });
  assert.equal(r.outcome.class, 'PERMISSION_VIOLATION');
  assert.match(r.outcome.detail, /node_modules\/dep\/index\.mjs is outside the paths this task may change/);
  const g = setup('api-contract');
  failFirst(g); g.begin();
  for (let i = 0; i < 40; i += 1) g.write(`api/big-${i}.txt`, 'x'.repeat(60000));
  assert.throws(() => g.end({}), (e) => e instanceof loop.Refusal && e.code === 'WORKSPACE_TOO_LARGE');
});

test('node options that load code are not accepted in a check, and NODE_OPTIONS from the environment is not passed to checks', () => {
  const base = JSON.parse(fs.readFileSync(path.join(FIX, 'api-contract', 'task.json'), 'utf8'));
  const ctx = loop.makeContext();
  for (const argv of [['node', '--test', '--import', './api/preload.mjs', 'contract.check.mjs'], ['node', '--test', '--require', 'x.js', 'a.mjs'], ['node', '--test', '--experimental-loader=x', 'a.mjs'], ['node', '--test', '--inspect', 'a.mjs']]) {
    assert.ok(loop.validateTask(ctx, { ...base, checks: [{ id: 'xx', kind: 'test', argv }] }, '.harness-work/n').some((e) => /not on the command allow-list/.test(e)), argv.join(' '));
  }
  const h = setup('api-contract');
  const prev = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = '--require ./does-not-exist.cjs';
  try { failFirst(h); h.begin(); h.apply('fix'); h.end({}); assert.equal(h.verify().state, 'PASSED', 'a poisoned NODE_OPTIONS did not reach the check'); } finally { if (prev === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = prev; }
});

test('a customer marker is found in a large or binary changed file, not only in small text files', () => {
  for (const make of [() => `${'a'.repeat(270000)}CONFIDENTIAL-MARKER`, () => Buffer.concat([Buffer.from([0, 255, 254, 1, 2]), Buffer.from('CONFIDENTIAL-MARKER')]).toString('latin1')]) {
    const h = setup('api-contract', { task: { allowedWritePaths: ['api/**'] } });
    failFirst(h); h.begin(); h.apply('fix');
    fs.writeFileSync(path.join(h.ws, 'api', 'blob.bin'), Buffer.from(make(), 'latin1'));
    const r = h.end({});
    assert.equal(r.outcome.class, 'SENSITIVE_DATA');
  }
});
