import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fakeRun } from './support/eval-fake.mjs';

const require = createRequire(import.meta.url);
const ev = require('../harness/eval/eval.cjs');
const { canonical, sha256 } = require('../harness/hooks/permission-engine.cjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'eval-engine-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/policy/evaluation-policy.json'), 'utf8'));
const mkctx = (runsDir, run) => ev.makeContext({ root: ROOT, runsDir, run });
const fake = fakeRun;
function runWith(opts, selection) {
  const dir = tmp(); const ctx = mkctx(dir, fake(opts));
  const r = ev.runEvaluation(ctx, selection);
  return { dir, ctx, r, run: r.run, status: (id) => r.run.tests.find((t) => t.id === id)?.status, gate: (id) => r.run.gates.find((g) => g.id === id) };
}
const modify = (file, fn) => { const o = JSON.parse(fs.readFileSync(file, 'utf8')); fn(o); fs.writeFileSync(file, `${JSON.stringify(o, null, 2)}\n`); };

test('parseTap reads results, counts and directives', () => {
  const p = ev.parseTap('ok 1 - a\nnot ok 2 - b\nok 3 - c # SKIP why\n# tests 3\n# pass 1\n# fail 1\n# skipped 1\n# todo 0\n# cancelled 0\n');
  assert.deepEqual(p.top.map((t) => [t.ok, t.name, t.directive]), [[true, 'a', null], [false, 'b', null], [true, 'c', 'SKIP']]);
  assert.equal(p.pass, 1); assert.equal(p.fail, 1); assert.equal(p.skipped, 1);
});

test('deriveStatus: PASS needs evidence that the test ran; skipped, absent, killed and unrun tests are never PASS', () => {
  const evalTest = { id: 'EVAL-HRN-SEC-001', mode: 'executable', runner: { type: 'eval-test', file: 'x.mjs' } };
  const ran = (extra) => ({ ran: true, exitCode: 0, ...extra });
  const one = { matches: 1, summary: { tests: 1, rootCount: 1 } };
  assert.equal(ev.deriveStatus(evalTest, ran({ parsed: { ...one, entry: { ok: true, name: 'EVAL-HRN-SEC-001: x', directive: null } } })).status, 'PASS');
  assert.equal(ev.deriveStatus(evalTest, ran({ parsed: { ...one, entry: { ok: false, name: 'EVAL-HRN-SEC-001: x', directive: null }, detail: 'boom' } })).status, 'FAIL');
  assert.equal(ev.deriveStatus(evalTest, ran({ parsed: { ...one, entry: { ok: true, name: 'x', directive: 'SKIP' } } })).status, 'BLOCKED', 'a skipped test is not a pass');
  assert.equal(ev.deriveStatus(evalTest, ran({ parsed: { entry: null } })).status, 'FAIL', 'a test that is absent from the output did not run');
  assert.equal(ev.deriveStatus(evalTest, ran({ signal: 'SIGKILL', parsed: { ...one, entry: { ok: true, name: 'x' } } })).status, 'FAIL', 'a run killed at its time limit is a failure');
  assert.equal(ev.deriveStatus(evalTest, ran({ exitCode: 1, parsed: { ...one, entry: { ok: true, name: 'x' } } })).status, 'FAIL', 'ok in the output but a failing exit code is not a pass');
  assert.equal(ev.deriveStatus(evalTest, ran({ parsed: { matches: 2, summary: { tests: 2, rootCount: 2 }, entry: { ok: true, name: 'x' } } })).status, 'FAIL', 'a result that appears twice is not accepted');
  assert.equal(ev.deriveStatus(evalTest, ran({ parsed: { matches: 1, summary: { tests: 1, rootCount: 2 }, entry: { ok: true, name: 'x' } } })).status, 'FAIL', 'a result line the reporter did not count is not accepted');
  assert.equal(ev.deriveStatus(evalTest, { ran: false }).status, 'FAIL', 'not run, not blocked and not pending is a failure');
  assert.equal(ev.deriveStatus(evalTest, { ran: false, blockedReason: 'G5' }).status, 'BLOCKED');
  assert.equal(ev.deriveStatus(evalTest, undefined).status, 'FAIL');
  const suite = { id: 'EVAL-HRN-FUN-001', mode: 'executable', runner: { type: 'suite', files: ['t.mjs'], minPass: 5 } };
  assert.equal(ev.deriveStatus(suite, ran({ parsed: { tests: 9, pass: 9, fail: 0, skipped: 0, todo: 0, cancelled: 0 } })).status, 'PASS');
  assert.equal(ev.deriveStatus(suite, ran({ parsed: { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0, cancelled: 0 } })).status, 'FAIL', 'a suite that ran nothing is not a pass');
  assert.equal(ev.deriveStatus(suite, ran({ parsed: { tests: 9, pass: 8, fail: 0, skipped: 1, todo: 0, cancelled: 0 } })).status, 'BLOCKED', 'a skipped test did not run');
  assert.equal(ev.deriveStatus(suite, ran({ exitCode: 1, parsed: { tests: 9, pass: 8, fail: 1, skipped: 0, todo: 0, cancelled: 0 } })).status, 'FAIL');
  assert.equal(ev.deriveStatus(suite, ran({ parsed: { tests: 9, pass: 9, fail: 0, skipped: 0, todo: 0, cancelled: 1 } })).status, 'FAIL', 'a cancelled test is a failure');
  const cmd = { id: 'EVAL-HRN-REQ-001', mode: 'executable', runner: { type: 'command', argv: ['node'], expect: { exit: 2, match: 'NOT-READY' } } };
  assert.equal(ev.deriveStatus(cmd, ran({ exitCode: 2, matched: true })).status, 'PASS');
  assert.equal(ev.deriveStatus(cmd, ran({ exitCode: 2, matched: false })).status, 'FAIL');
  assert.equal(ev.deriveStatus(cmd, ran({ exitCode: 0, matched: true })).status, 'FAIL');
  const pending = { id: 'EVAL-PRD-FUN-001', mode: 'pending', pendingReason: 'nothing exists yet to run this against' };
  assert.equal(ev.deriveStatus(pending, { ran: false }).status, 'PENDING');
  assert.equal(ev.deriveStatus(pending, ran({})).status, 'FAIL', 'a pending test cannot have run');
});

test('a full run with every executable test passing still does not pass past a gate that has pending tests', () => {
  const x = runWith({}); try {
    assert.equal(x.run.partial, false);
    assert.equal(x.gate('G1').status, 'PASS');
    assert.equal(x.gate('G2').status, 'PASS');
    assert.equal(x.gate('G3').status, 'PASS');
    assert.equal(x.gate('G4').status, 'INCOMPLETE', 'G4 has only pending tests: nothing is shown');
    for (const g of ['G5', 'G6', 'G7']) assert.notEqual(x.gate(g).status, 'PASS');
    assert.equal(x.gate('G4').progression, 'blocked');
    assert.equal(x.status('EVAL-PRC-AZR-001'), 'BLOCKED', 'the readiness check must not run before G5 passes');
    assert.match(JSON.parse(fs.readFileSync(path.join(x.r.dir, 'results/EVAL-PRC-AZR-001.json'), 'utf8')).blockedReason, /G5 is/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(x.r.dir, 'results/EVAL-PRC-AZR-001.json'), 'utf8')).ran, false);
    assert.ok(x.run.tests.filter((t) => t.status === 'PENDING').length >= 15);
    for (const t of x.run.tests.filter((t) => t.id.startsWith('EVAL-PRD-'))) assert.equal(t.status, 'PENDING', `${t.id}: no production agent exists`);
    assert.equal(ev.verifyRun(x.ctx, x.r.runId).ok, true);
  } finally { rm(x.dir); }
});

test('a hard-constraint failure is not hidden by many passing tests: its gate fails critically and the constraint is VIOLATED', () => {
  const x = runWith({ fail: ['EVAL-PRC-DAT-006'] }); try {
    assert.ok(x.run.counts.PASS >= 40, 'most tests pass');
    assert.equal(x.status('EVAL-PRC-DAT-006'), 'FAIL');
    assert.equal(x.gate('G3').status, 'FAIL'); assert.equal(x.gate('G3').critical, true);
    assert.equal(x.run.hardConstraints.find((h) => h.id === 'HC-08').verdict, 'VIOLATED');
    assert.equal(x.gate('G4').status, 'BLOCKED'); assert.equal(x.gate('G4').progression, 'blocked');
    assert.match(ev.renderReport(x.ctx, x.r.runId), /\*\*1 hard constraint\(s\) have a failing test: HC-08\. This stands whatever the gates say\.\*\*/);
  } finally { rm(x.dir); }
});

test('a failing non-critical test without a hard constraint fails its gate but is not marked critical', () => {
  const x = runWith({ fail: ['EVAL-PRC-DAT-005'] }); try {
    assert.equal(x.gate('G3').status, 'FAIL'); assert.equal(x.gate('G3').critical, false);
    assert.equal(x.run.hardConstraints.filter((h) => h.verdict === 'VIOLATED').length, 0);
  } finally { rm(x.dir); }
});

test('entry criteria: a failing control test blocks every gate, because the evaluation can no longer be trusted', () => {
  const x = runWith({ fail: ['EVAL-HRN-SEC-001'] }); try {
    assert.equal(x.status('EVAL-HRN-SEC-001'), 'FAIL');
    for (const g of policy.gates) { assert.notEqual(x.gate(g.id).status, 'PASS', `${g.id} must not pass`); assert.equal(x.gate(g.id).progression, 'blocked'); }
    assert.match(x.gate('G1').reason, /entry criteria not met: EVAL-HRN-SEC-001/);
  } finally { rm(x.dir); }
});

test('a skipped, absent, empty or killed test is never reported as passed', () => {
  const skipped = runWith({ skip: ['EVAL-HRN-SEC-005'] }); const absent = runWith({ omit: ['EVAL-HRN-SEC-011'] });
  const sk = runWith({ suiteOverride: { 'tests/loop-engine.test.mjs': { tests: 31, skipped: 1 } } }); const empty = runWith({ suiteOverride: { 'tests/memory.test.mjs,tests/validate-memory.test.mjs': { tests: 0 } } });
  const killed = runWith({ signal: 'SIGKILL' });
  try {
    assert.equal(skipped.status('EVAL-HRN-SEC-005'), 'BLOCKED');
    assert.equal(absent.status('EVAL-HRN-SEC-011'), 'FAIL');
    assert.equal(sk.status('EVAL-HRN-FUN-004'), 'BLOCKED', 'the loop suite with its TypeScript scenario skipped did not fully run');
    assert.equal(empty.status('EVAL-HRN-FUN-002'), 'FAIL');
    for (const t of killed.run.tests.filter((t) => t.status !== 'PENDING' && t.status !== 'BLOCKED')) assert.equal(t.status, 'FAIL', `${t.id}: killed at the time limit`);
    assert.equal(killed.run.counts.PASS, 0);
  } finally { for (const x of [skipped, absent, sk, empty, killed]) rm(x.dir); }
});

test('a partial run evaluates no gates and blocks tests that need one, so a partial run cannot pass a gate', () => {
  const x = runWith({}, { ids: ['EVAL-HRN-SEC-001', 'EVAL-PRC-AZR-001', 'EVAL-PRD-SEC-003'] }); try {
    assert.equal(x.run.partial, true); assert.deepEqual(x.run.gates, []);
    assert.equal(x.status('EVAL-HRN-SEC-001'), 'PASS');
    assert.equal(x.status('EVAL-PRC-AZR-001'), 'BLOCKED');
    assert.match(JSON.parse(fs.readFileSync(path.join(x.r.dir, 'results/EVAL-PRC-AZR-001.json'), 'utf8')).blockedReason, /not evaluated in a partial run/);
    assert.equal(x.status('EVAL-PRD-SEC-003'), 'PENDING');
    assert.equal(x.run.tests.length, 3);
    assert.equal(ev.verifyRun(x.ctx, x.r.runId).ok, true);
    assert.match(ev.renderReport(x.ctx, x.r.runId), /partial run, so the gates were not evaluated/);
  } finally { rm(x.dir); }
  assert.throws(() => runWith({}, { ids: ['EVAL-NOPE-000'] }), /no test matches/);
});

test('verifyRun finds a forged status, an altered evidence file, a forged gate and a forged integrity hash', () => {
  const x = runWith({ fail: ['EVAL-PRC-DAT-006'] }); const runFile = path.join(x.r.dir, 'run.json');
  const fresh = () => ev.verifyRun(x.ctx, x.r.runId);
  try {
    assert.equal(fresh().ok, true);
    const original = fs.readFileSync(runFile, 'utf8');
    // 1. the status is edited to PASS and nothing else is
    modify(runFile, (r) => { r.tests.find((t) => t.id === 'EVAL-PRC-DAT-006').status = 'PASS'; });
    let v = fresh(); assert.equal(v.ok, false); assert.ok(v.problems.some((p) => /EVAL-PRC-DAT-006: recorded PASS but the evidence derives FAIL/.test(p)), v.problems.join('; '));
    fs.writeFileSync(runFile, original);
    // 2. the evidence file is edited to say it passed
    const evFile = path.join(x.r.dir, 'results/EVAL-PRC-DAT-006.json');
    const evOriginal = fs.readFileSync(evFile, 'utf8');
    modify(evFile, (e) => { e.parsed.entry.ok = true; e.status = 'PASS'; });
    v = fresh(); assert.equal(v.ok, false); assert.ok(v.problems.some((p) => /evidence file altered/.test(p)));
    // 3. the evidence file is edited and its hash in run.json is updated too: the status no longer follows from the evidence
    modify(runFile, (r) => { const t = r.tests.find((q) => q.id === 'EVAL-PRC-DAT-006'); t.evidenceSha256 = sha256(fs.readFileSync(evFile, 'utf8')); });
    v = fresh(); assert.equal(v.ok, false); assert.ok(v.problems.some((p) => /EVAL-PRC-DAT-006: recorded FAIL but the evidence derives PASS/.test(p)), v.problems.join('; '));
    fs.writeFileSync(evFile, evOriginal); fs.writeFileSync(runFile, original);
    // 4. a PASS for a test that never ran
    const pFile = path.join(x.r.dir, 'results/EVAL-PRD-SEC-003.json');
    modify(pFile, (e) => { e.status = 'PASS'; }); modify(runFile, (r) => { const t = r.tests.find((q) => q.id === 'EVAL-PRD-SEC-003'); t.status = 'PASS'; t.evidenceSha256 = sha256(fs.readFileSync(pFile, 'utf8')); });
    v = fresh(); assert.equal(v.ok, false); assert.ok(v.problems.some((p) => /EVAL-PRD-SEC-003: recorded PASS but the evidence derives PENDING/.test(p)), v.problems.join('; '));
    // 5. the gate is edited to PASS (the forged test evidence from step 4 is restored first)
    fs.writeFileSync(runFile, original); modify(pFile, (e) => { e.status = 'PENDING'; });
    assert.equal(fresh().ok, true, 'restored to the recorded state');
    modify(runFile, (r) => { r.gates.find((g) => g.id === 'G3').status = 'PASS'; });
    v = fresh(); assert.equal(v.ok, false); assert.ok(v.problems.some((p) => /recorded gates differ/.test(p)) && v.problems.some((p) => /integrity hash/.test(p)), v.problems.join('; '));
    fs.writeFileSync(runFile, original);
    // 6. a hard constraint is edited from VIOLATED to a clean verdict
    modify(runFile, (r) => { r.hardConstraints.find((h) => h.id === 'HC-08').verdict = 'NO TEST FAILED'; });
    v = fresh(); assert.equal(v.ok, false); assert.ok(v.problems.some((p) => /hard-constraint matrix differs/.test(p)), v.problems.join('; '));
    fs.writeFileSync(runFile, original);
    // 7. a result is deleted
    modify(runFile, (r) => { r.tests = r.tests.filter((t) => t.id !== 'EVAL-PRC-DAT-006'); });
    v = fresh(); assert.equal(v.ok, false); assert.ok(v.problems.some((p) => /EVAL-PRC-DAT-006: no result in a full run/.test(p)), v.problems.join('; '));
  } finally { rm(x.dir); }
  assert.equal(ev.verifyRun(mkctx(os.tmpdir()), '../../x').ok, false);
});

test('the evidence of a result is bounded and redacted, and never contains the whole output', () => {
  const secret = ['ghp', '_', 'A'.repeat(36)].join('');
  const run = fake({}); const dir = tmp();
  const ctx = mkctx(dir, (c, a, o) => { const r = run(c, a, o); return a[0] === '--test' ? { ...r, stdout: `${'x'.repeat(5000)}\n${secret}\n${r.stdout}` } : r; });
  try {
    const r = ev.runEvaluation(ctx, { ids: ['EVAL-HRN-FUN-001'] });
    const body = fs.readFileSync(path.join(r.dir, 'results/EVAL-HRN-FUN-001.json'), 'utf8');
    assert.ok(!body.includes(secret), 'a secret-shaped string must be redacted from stored output');
    assert.ok(JSON.parse(body).outputTail.length <= policy.limits.outputTailBytes);
    assert.ok(JSON.parse(body).outputBytes > 5000);
    assert.match(JSON.parse(body).outputSha256, /^[0-9a-f]{64}$/);
  } finally { rm(dir); }
});

test('the runner refuses a command outside the allow-list and records it as blocked, never as a pass', () => {
  const ctx = mkctx(os.tmpdir());
  for (const bad of [['node', '-e', '1'], ['node', '--test', '--import', 'x.mjs', 'y.mjs'], ['node', '--test', '--test-reporter=tap', '../x.mjs'], ['npm', 'test'], ['node', 'harness/scripts/approval.mjs', 'sign'], ['node', 'harness/scripts/evaluate.mjs', 'run']]) {
    assert.ok(ev.commandProblems(ctx, bad), `must refuse: ${bad.join(' ')}`);
  }
  for (const good of [['node', '--test', '--test-reporter=tap', 'tests/x.test.mjs'], ['node', 'harness/scripts/validate-memory.mjs'], ['node', 'harness/scripts/spec-validators.mjs', 'architecture']]) assert.equal(ev.commandProblems(ctx, good), null, good.join(' '));
});

test('the report has every required column, shows the passing and the blocked test, and is reproducible from its run', () => {
  const x = runWith({ fail: ['EVAL-PRC-DAT-006', 'EVAL-PRC-DAT-005', 'EVAL-PRC-ARC-001'] }); try {
    const md = ev.renderReport(x.ctx, x.r.runId);
    assert.match(md, /\| Test ID \| Requirement ID \| Scenario \| Expected outcome \| Actual outcome \| Evidence \| Severity \| Status \| Remediation \|/);
    const row = (id) => md.split('\n').find((l) => l.startsWith(`| ${id} |`));
    assert.match(row('EVAL-HRN-SEC-001'), /\*\*PASS\*\*/); assert.match(row('EVAL-HRN-SEC-001'), /ran and passed/);
    assert.match(row('EVAL-PRC-AZR-001'), /\*\*BLOCKED\*\*/); assert.match(row('EVAL-PRC-AZR-001'), /Not run: required gate G5 is/);
    assert.match(row('EVAL-PRC-DAT-006'), /\*\*FAIL\*\*/);
    assert.match(row('EVAL-PRD-SEC-003'), /\*\*PENDING\*\*/); assert.match(row('EVAL-PRD-SEC-003'), /Not run: /);
    for (const id of x.run.tests.map((t) => t.id)) assert.ok(row(id), `${id} has a report row`);
    assert.equal(ev.renderReport(x.ctx, x.r.runId), md, 'rendering is deterministic');
    assert.ok(!/\bscore\b/i.test(md.replace(/There is no score/g, '').replace(/nothing is decided by them/g, '')), 'the report presents no score');
    assert.throws(() => ev.renderReport(x.ctx, '../x'), /not a run id/);
  } finally { rm(x.dir); }
});

// ---- catalogue validation, on a sandbox so the real catalogue is never touched
function sandbox() {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'harness/policy'), { recursive: true }); fs.mkdirSync(path.join(root, 'docs/context'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'harness/policy/evaluation-policy.json'), path.join(root, 'harness/policy/evaluation-policy.json'));
  for (const f of ['REQUIREMENTS.md', 'NON-FUNCTIONAL-REQUIREMENTS.md']) fs.copyFileSync(path.join(ROOT, 'docs/context', f), path.join(root, 'docs/context', f));
  fs.cpSync(path.join(ROOT, 'evaluation'), path.join(root, 'evaluation'), { recursive: true });
  const cat = ev.loadCatalogue(mkctx(os.tmpdir()));
  for (const t of cat.tests) for (const f of t.runner?.files ?? []) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), ''); }
  return { root, ctx: ev.makeContext({ root }), cat: (f) => path.join(root, 'evaluation/catalogue', f) };
}
const problems = (s) => ev.validateCatalogue(s.ctx);
const testOf = (o, id) => o.tests.find((t) => t.id === id);

test('the real catalogue is valid and its sandbox copy is valid (so each mutation below is the only cause of its failure)', () => {
  assert.deepEqual(ev.validateCatalogue(mkctx(os.tmpdir())), []);
  const s = sandbox(); try { assert.deepEqual(problems(s), []); } finally { rm(s.root); }
});

test('catalogue validation rejects each structural fault', () => {
  const cases = [
    ['a result in the catalogue', 'harness.json', (o) => { testOf(o, 'EVAL-HRN-SEC-001').status = 'PASS'; }, /must not carry results \(found 'status'\)/],
    ['a result named actual', 'harness.json', (o) => { testOf(o, 'EVAL-HRN-SEC-001').actual = 'ok'; }, /must not carry results \(found 'actual'\)/],
    ['a duplicate id', 'harness.json', (o) => { o.tests.push({ ...testOf(o, 'EVAL-HRN-SEC-001') }); }, /duplicate id/],
    ['a malformed id', 'harness.json', (o) => { testOf(o, 'EVAL-HRN-SEC-001').id = 'SEC-1'; }, /id must look like/],
    ['a prefix that disagrees with the scope', 'harness.json', (o) => { testOf(o, 'EVAL-HRN-SEC-001').scope = 'production-contract'; }, /must use the PRC prefix/],
    ['a production test in the harness suite', 'harness.json', (o) => { const t = { ...testOf(o, 'EVAL-HRN-SEC-001'), id: 'EVAL-PRC-SEC-009', scope: 'production-contract' }; o.tests.push(t); }, /never mixed/],
    ['a domain that disagrees with the id', 'harness.json', (o) => { testOf(o, 'EVAL-HRN-SEC-001').domain = 'SOV'; }, /domain must match the id/],
    ['an unknown severity', 'harness.json', (o) => { testOf(o, 'EVAL-HRN-SEC-001').severity = 'urgent'; }, /severity must be/],
    ['an unknown requirement', 'harness.json', (o) => { testOf(o, 'EVAL-HRN-SEC-001').requirements = ['SEC-999']; }, /unknown requirement 'SEC-999'/],
    ['no requirement', 'harness.json', (o) => { testOf(o, 'EVAL-HRN-SEC-001').requirements = []; }, /requirements is required/],
    ['an unknown hard constraint', 'harness.json', (o) => { testOf(o, 'EVAL-HRN-SEC-001').hardConstraints = ['HC-99']; }, /unknown hard constraint HC-99/],
    ['an unknown gate', 'production.json', (o) => { testOf(o, 'EVAL-PRC-DAT-001').gate = 'G9'; }, /gate must be null or one of/],
    ['a requires gate that does not come before', 'production.json', (o) => { testOf(o, 'EVAL-PRC-AZR-001').requires = ['G6']; }, /requires must name gates that come before/],
    ['an unknown red-team scenario', 'production.json', (o) => { testOf(o, 'EVAL-PRC-DAT-001').redTeam = 'RT-99'; }, /unknown red-team scenario/],
    ['an executable production-agent test', 'production.json', (o) => { const t = testOf(o, 'EVAL-PRD-SEC-003'); t.mode = 'executable'; delete t.pendingReason; t.runner = { type: 'command', argv: ['node', 'harness/scripts/validate-tools.mjs'], expect: { exit: 0 } }; }, /production-agent tests must be pending/],
    ['a pending test with a runner', 'production.json', (o) => { testOf(o, 'EVAL-PRD-SEC-003').runner = { type: 'command', argv: ['node', 'harness/scripts/validate-tools.mjs'], expect: { exit: 0 } }; }, /a pending test has no runner/],
    ['a pending test with no reason', 'production.json', (o) => { testOf(o, 'EVAL-PRD-SEC-003').pendingReason = 'later'; }, /needs a pendingReason/],
    ['a pending entry test', 'harness.json', (o) => { const t = testOf(o, 'EVAL-HRN-PRF-001'); t.entry = true; }, /an entry test must be executable/],
    ['an entry test that is not a harness test', 'production.json', (o) => { testOf(o, 'EVAL-PRC-REQ-001').entry = true; }, /an entry test must be a critical or high harness test/],
    ['a command outside the allow-list', 'harness.json', (o) => { testOf(o, 'EVAL-HRN-REQ-001').runner.argv = ['node', '-e', 'process.exit(0)']; }, /not on the command allow-list/],
    ['a command with a parent path', 'harness.json', (o) => { testOf(o, 'EVAL-HRN-REQ-001').runner.argv = ['node', 'harness/scripts/spec-validators.mjs', 'tests/../x']; }, /relative with no \.\./],
    ['a command with no expected exit', 'harness.json', (o) => { delete testOf(o, 'EVAL-HRN-REQ-001').runner.expect; }, /a command needs expect\.exit/],
    ['a suite with no minimum', 'harness.json', (o) => { delete testOf(o, 'EVAL-HRN-FUN-001').runner.minPass; }, /a suite needs minPass of at least 1/],
    ['a missing runner file', 'harness.json', (o) => { testOf(o, 'EVAL-HRN-DAT-003').runner.file = 'evaluation/checks/none.eval.mjs'; }, /does not exist/],
    ['an eval-test with no test of that id', 'harness.json', (o) => { testOf(o, 'EVAL-HRN-DAT-003').id = 'EVAL-HRN-DAT-009'; }, /has no test named with EVAL-HRN-DAT-009/],
    ['an unknown runner', 'harness.json', (o) => { testOf(o, 'EVAL-HRN-REQ-001').runner.type = 'shell'; }, /runner\.type must be one of/],
  ];
  for (const [what, file, mutate, re] of cases) {
    const s = sandbox();
    try { modify(s.cat(file), mutate); const p = problems(s); assert.ok(p.some((m) => re.test(m)), `${what}: not rejected for the right reason: ${p.join(' | ').slice(0, 300) || 'no problem reported'}`); } finally { rm(s.root); }
  }
});

test('catalogue validation rejects coverage gaps: a domain, gate, hard constraint or red-team scenario with no test', () => {
  const cases = [
    ['a domain with no test', (o) => ({ ...o, tests: o.tests.filter((t) => t.domain !== 'PRF') }), /domain PRF has no test/],
    ['a gate with no test', (o) => ({ ...o, tests: o.tests.filter((t) => t.gate !== 'G7') }), /gate G7 has no test/],
    ['a hard constraint with no test', (o) => ({ ...o, tests: o.tests.map((t) => ({ ...t, hardConstraints: (t.hardConstraints ?? []).filter((h) => h !== 'HC-07') })) }), /hard constraint HC-07 has no test/],
    ['a red-team scenario with no production test', (o) => ({ ...o, tests: o.tests.map((t) => (t.redTeam === 'RT-09' ? { ...t, redTeam: undefined } : t)) }), /red-team scenario RT-09 has no production-suite test/],
  ];
  for (const [what, mutate, re] of cases) {
    const s = sandbox();
    try {
      for (const f of ['harness.json', 'production.json']) modify(s.cat(f), (o) => { const n = mutate(o); o.tests = n.tests; });
      const p = problems(s); assert.ok(p.some((m) => re.test(m)), `${what}: not rejected: ${p.join(' | ').slice(0, 300) || 'no problem reported'}`);
    } finally { rm(s.root); }
  }
  const s = sandbox(); try { modify(s.cat('harness.json'), (o) => { o.tests = o.tests.map((t) => (t.redTeam === 'RT-06' ? { ...t, redTeam: undefined } : t)); }); assert.ok(problems(s).some((m) => /RT-06 has a harness analogue and no harness test/.test(m))); } finally { rm(s.root); }
  const t = sandbox(); try { modify(t.cat('harness.json'), (o) => { o.tests.forEach((x) => { x.entry = false; }); }); assert.ok(problems(t).some((m) => /entry criteria need at least one entry test/.test(m))); } finally { rm(t.root); }
});

test('runEvaluation refuses an invalid catalogue instead of running it', () => {
  const s = sandbox(); const dir = tmp();
  try {
    modify(s.cat('harness.json'), (o) => { testOf(o, 'EVAL-HRN-SEC-001').status = 'PASS'; });
    const ctx = ev.makeContext({ root: s.root, runsDir: dir, run: () => { throw new Error('must not run'); } });
    assert.throws(() => ev.runEvaluation(ctx), /the catalogue is not valid/);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { rm(s.root); rm(dir); }
});

test('the command line: validate passes, a real harness test passes, the readiness test is blocked, and the run verifies', () => {
  const dir = tmp(); const env = { ...process.env, CI: 'true', HARNESS_EVAL_RUNS_DIR: dir }; delete env.NODE_TEST_CONTEXT;
  const cli = (...a) => spawnSync(process.execPath, ['harness/scripts/evaluate.mjs', ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 180000 });
  try {
    const v = cli('validate'); assert.equal(v.status, 0, v.stdout + v.stderr);
    assert.equal(cli('bogus').status, 2);
    assert.equal(cli('verify', '--run', '../x').status, 1);
    assert.equal(cli('gates', '--run', '../x').status, 2);
    // a real run of one test: it executes evaluation/checks/harness.eval.mjs and finds the test by its id
    const r = cli('run', '--ids', 'EVAL-HRN-SEC-001,EVAL-PRC-AZR-001,EVAL-PRD-SEC-003');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.tests, ['EVAL-HRN-SEC-001 PASS', 'EVAL-PRC-AZR-001 BLOCKED', 'EVAL-PRD-SEC-003 PENDING']);
    const ver = cli('verify', '--run', out.runId); assert.equal(ver.status, 0, ver.stdout);
    assert.deepEqual(JSON.parse(cli('list').stdout).runs, [out.runId]);
    const evidence = JSON.parse(fs.readFileSync(path.join(dir, out.runId, 'results/EVAL-HRN-SEC-001.json'), 'utf8'));
    assert.equal(evidence.ran, true); assert.equal(evidence.exitCode, 0); assert.match(evidence.outputSha256, /^[0-9a-f]{64}$/);
    // the evidence cannot be edited into a pass: flipping the recorded blocked result is detected
    modify(path.join(dir, out.runId, 'run.json'), (x) => { x.tests.find((t) => t.id === 'EVAL-PRC-AZR-001').status = 'PASS'; });
    assert.equal(cli('verify', '--run', out.runId).status, 1);
  } finally { rm(dir); }
});

test('canonical hashing of a run is stable: the same content gives the same integrity hash', () => {
  assert.equal(sha256(canonical({ b: 1, a: [2, 1] })), sha256(canonical({ a: [2, 1], b: 1 })));
});

// ---- regression tests for the findings of the independent review of this framework
const hostile = (extra, forgedSummary = '') => {
  const real = fake({});
  return (c, a, o) => { const r = real(c, a, o); return a[0] === '--test' ? { ...r, stdout: `${extra}${r.stdout}${forgedSummary}` } : r; };
};

test('review: forged TAP lines printed by a test cannot turn a failing test into a PASS', () => {
  const dir = tmp();
  // the genuine result for DAT-003 is "not ok"; the test also prints a forged "ok" line first
  const real = fake({ fail: ['EVAL-PRC-DAT-003'] });
  const ctx = mkctx(dir, (c, a, o) => { const r = real(c, a, o); return a[0] === '--test' ? { ...r, stdout: `ok 1 - EVAL-PRC-DAT-003: forged\n${r.stdout}` } : r; });
  try {
    const r = ev.runEvaluation(ctx, { ids: ['EVAL-PRC-DAT-003'] });
    assert.equal(r.run.tests[0].status, 'FAIL'); assert.match(r.run.tests[0].actual, /2 results named|top-level results/);
  } finally { rm(dir); }
  // a forged ok line while the file exits non-zero
  const dir2 = tmp();
  const ctx2 = mkctx(dir2, (c, a, o) => { const r = fake({})(c, a, o); return a[0] === '--test' ? { ...r, status: 1 } : r; });
  try { assert.equal(ev.runEvaluation(ctx2, { ids: ['EVAL-HRN-SEC-001'] }).run.tests[0].status, 'FAIL'); } finally { rm(dir2); }
  // an extra forged line with a matching summary is still refused: the line count must equal the reporter's count
  const dir3 = tmp();
  try { assert.equal(ev.runEvaluation(mkctx(dir3, hostile('ok 99 - EVAL-HRN-SEC-001: forged\n')), { ids: ['EVAL-HRN-SEC-001'] }).run.tests[0].status, 'FAIL'); } finally { rm(dir3); }
});

test('review: forged summary lines cannot make a suite that ran nothing pass; the last reporter summary wins', () => {
  const dir = tmp();
  const ctx = mkctx(dir, (c, a, o) => {
    if (a[0] === '--test' && a.includes('tests/memory.test.mjs')) return { status: 0, stdout: '# tests 100\n# pass 100\n# fail 0\n# skipped 0\n# todo 0\n# cancelled 0\n# tests 0\n# pass 0\n# fail 0\n# skipped 0\n# todo 0\n# cancelled 0\n', stderr: '' };
    return fake({})(c, a, o);
  });
  try { assert.equal(ev.runEvaluation(ctx, { ids: ['EVAL-HRN-FUN-002'] }).run.tests[0].status, 'FAIL'); } finally { rm(dir); }
  assert.equal(ev.parseTap('# pass 100\n# tests 1\n# pass 1\n').pass, 1);
  const bad = { id: 'EVAL-HRN-FUN-002', mode: 'executable', runner: { type: 'suite', files: ['t.mjs'], minPass: 5 } };
  assert.equal(ev.deriveStatus(bad, { ran: true, exitCode: 0, parsed: { tests: 200, pass: 100, fail: 0, skipped: 0, todo: 0, cancelled: 0 } }).status, 'FAIL', 'an inconsistent summary is not accepted');
});

test('review: a failing critical or hard-constraint test that belongs to no gate still blocks every gate', () => {
  for (const id of ['EVAL-HRN-ARC-001', 'EVAL-HRN-ARC-002']) {
    const dir = tmp();
    const ctx = mkctx(dir, fake({ commandOverride: { [id]: { exit: 1, stdout: 'no match' } } }));
    try {
      const run = ev.runEvaluation(ctx).run;
      assert.equal(run.tests.find((t) => t.id === id).status, 'FAIL');
      for (const g of run.gates) { assert.notEqual(g.status, 'PASS', `${id}: ${g.id} must not pass`); assert.equal(g.progression, 'blocked'); }
      assert.match(run.gates[0].reason, new RegExp(`outside any gate failed: ${id}`));
    } finally { rm(dir); }
  }
});

test('review: a partial run never reports NO TEST FAILED for a constraint whose other tests were not run', () => {
  const x = runWith({}, { ids: ['EVAL-HRN-OBS-001'] }); try {
    const hc08 = x.run.hardConstraints.find((h) => h.id === 'HC-08');
    assert.equal(hc08.verdict, 'PARTIAL'); assert.ok(hc08.tests.some((t) => t.status === 'MISSING'));
    assert.ok(!x.run.hardConstraints.some((h) => h.verdict === 'NO TEST FAILED' && h.tests.some((t) => t.status === 'MISSING')));
  } finally { rm(x.dir); }
});

test('review: run metadata is covered by the integrity hash, an evidence path must be canonical, and counts must match', () => {
  const x = runWith({}, { ids: ['EVAL-HRN-SEC-001'] }); const runFile = path.join(x.r.dir, 'run.json'); const original = fs.readFileSync(runFile, 'utf8');
  try {
    for (const [what, mut, re] of [
      ['startedAt', (r) => { r.startedAt = '2001-01-01T00:00:00.000Z'; }, /integrity hash/],
      ['gitHead', (r) => { r.gitHead = 'a'.repeat(40); }, /integrity hash/],
      ['selection', (r) => { r.selection = {}; }, /integrity hash/],
      ['counts', (r) => { r.counts.PASS = 9; }, /recorded counts differ/],
      ['an evidence path that leaves the run folder', (r) => { r.tests[0].evidenceRef = '../run.json'; }, /evidenceRef must be exactly results\/EVAL-HRN-SEC-001\.json/],
    ]) {
      fs.writeFileSync(runFile, original); modify(runFile, mut);
      const v = ev.verifyRun(x.ctx, x.r.runId); assert.equal(v.ok, false, what); assert.ok(v.problems.some((p) => re.test(p)), `${what}: ${v.problems.join('; ')}`);
    }
  } finally { rm(x.dir); }
});

test('review: a report or a gate table is refused for a run that does not verify', () => {
  const x = runWith({}); const runFile = path.join(x.r.dir, 'run.json');
  try {
    assert.ok(ev.renderReport(x.ctx, x.r.runId));
    modify(runFile, (r) => { r.gates.find((g) => g.id === 'G4').status = 'PASS'; });
    assert.throws(() => ev.renderReport(x.ctx, x.r.runId), /does not verify, so no report is rendered/);
  } finally { rm(x.dir); }
});

test('review: the command line exits 3 for a run that blocks progression, and refuses gates of an unverified run', () => {
  const dir = tmp(); const env = { ...process.env, CI: 'true', HARNESS_EVAL_RUNS_DIR: dir }; delete env.NODE_TEST_CONTEXT;
  const cli = (...a) => spawnSync(process.execPath, ['harness/scripts/evaluate.mjs', ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 180000 });
  try {
    // EVAL-PRC-DAT-006 genuinely fails today (a finding), so a real run of it must block progression
    const r = cli('run', '--ids', 'EVAL-PRC-DAT-006');
    assert.equal(r.status, 3, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout); assert.equal(out.progression, 'not evaluated (partial run)'); assert.deepEqual(out.hardConstraintsViolated, ['HC-08']);
    assert.equal(cli('gates', '--run', out.runId).status, 0);
    modify(path.join(dir, out.runId, 'run.json'), (x) => { x.tests[0].status = 'PASS'; });
    assert.equal(cli('gates', '--run', out.runId).status, 1);
  } finally { rm(dir); }
});
test('rerun (CI): an identical re-run passes; an unlisted difference fails; the listed TypeScript skip is tolerated but nothing else', () => {
  const committed = tmp(); const base = mkctx(committed, fake({}));
  try {
    ev.runEvaluation(base);
    const again = (opts) => ev.rerun({ ...base, run: fake(opts) });
    const same = again({}); assert.equal(same.ok, true, same.differences.join('; ')); assert.match(same.committedRun, /^EVRUN-[0-9a-f]{10}$/);
    const listed = again({ suiteOverride: { 'tests/loop-engine.test.mjs': { tests: 31, skipped: 1 } } });
    assert.equal(listed.ok, true, 'the TypeScript scenario skipped in CI is the one listed difference'); assert.deepEqual(listed.allowed, ['EVAL-HRN-FUN-004']);
    const other = again({ suiteOverride: { 'tests/memory.test.mjs,tests/validate-memory.test.mjs': { tests: 100, skipped: 1 } } });
    assert.equal(other.ok, false); assert.ok(other.differences.some((d) => /EVAL-HRN-FUN-002: committed PASS, re-run BLOCKED/.test(d)));
    const worse = again({ suiteOverride: { 'tests/loop-engine.test.mjs': { tests: 31, fail: 1 } } });
    assert.equal(worse.ok, false, 'a FAIL where the committed run says PASS is not the listed BLOCKED difference');
    const gate = again({ fail: ['EVAL-HRN-SEC-001'] });
    assert.equal(gate.ok, false); assert.ok(gate.differences.some((d) => /gates differ/.test(d)));
    const hc = again({ fail: ['EVAL-PRC-SEC-001'] });
    assert.ok(hc.differences.some((d) => /hard-constraint verdicts differ/.test(d)));
  } finally { rm(committed); }
  assert.throws(() => ev.rerun(mkctx(tmp(), fake({}))), /no committed full run/);
});

test('rerun (CI): compareRuns lists only differences the policy allows, by exact test and status', () => {
  const mk = (tests, gates = [], hardConstraints = []) => ({ tests: tests.map(([id, status]) => ({ id, status })), gates, hardConstraints });
  const p = { ciRerun: { allowedDifferences: [{ id: 'A', status: 'BLOCKED', reason: 'x' }] } };
  assert.deepEqual(ev.compareRuns(p, mk([['A', 'BLOCKED'], ['B', 'PASS']]), mk([['A', 'PASS'], ['B', 'PASS']])), []);
  assert.equal(ev.compareRuns(p, mk([['A', 'FAIL']]), mk([['A', 'PASS']])).length, 1);
  assert.equal(ev.compareRuns(p, mk([['B', 'FAIL']]), mk([['B', 'PASS']])).length, 1);
  assert.equal(ev.compareRuns(p, mk([['A', 'BLOCKED'], ['C', 'PASS']]), mk([['A', 'PASS']])).length, 1, 'a test that appears or disappears is a difference');
  assert.equal(ev.compareRuns({}, mk([['A', 'BLOCKED']]), mk([['A', 'PASS']])).length, 1, 'with no policy entry nothing is tolerated');
});

test('rerun (CI): the command line refuses to compare when no committed run exists', () => {
  const dir = tmp(); const env = { ...process.env, CI: 'true', HARNESS_EVAL_RUNS_DIR: dir }; delete env.NODE_TEST_CONTEXT;
  try { const r = spawnSync(process.execPath, ['harness/scripts/evaluate.mjs', 'rerun'], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 }); assert.equal(r.status, 2); assert.match(r.stdout, /NO_COMMITTED_RUN/); } finally { rm(dir); }
});
