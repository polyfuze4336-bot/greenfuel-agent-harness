// Tests for the SYNTHETIC agent evaluation framework (harness/agent-eval). They prove the framework behaves as specified; they do not evaluate any real agent or model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { canonical, sha256 } from '../harness/scripts/spec-validators.mjs';
import { buildDataset, datasetPaths } from '../harness/agent-eval/build-dataset.mjs';
import { createEnv, NEVER } from '../harness/agent-eval/env.mjs';
import { scoreCase, aggregate, TAXONOMY } from '../harness/agent-eval/score.mjs';
import { toScaled, mul, div, add, roundHalfEven, fmt } from '../harness/agent-eval/lib/decimal.mjs';
import { emissions } from '../harness/agent-eval/lib/exact.mjs';
import { ARMS, loadDataset, datasetProblems, runArm, validateRun, regressions, verifyHistory, buildComparison, contentHash, runsDir, GATES, evaluateGates } from '../harness/agent-eval/runner.mjs';

const ds = loadDataset(); const byId = Object.fromEntries(ds.cases.map((c) => [c.id, c]));
const REQUIRED_CATEGORIES = ['normal-methanol', 'bio-blend', 'missing-feedstock', 'conflicting-meters', 'quantity-dispute', 'quality-dispute', 'mass-balance-shortfall', 'duplicate-sensor-events', 'outdated-emissions-factors', 'cross-shipowner-access', 'malicious-document-instructions', 'edge-connectivity-failure'];

test('dataset: committed files match the builder and the manifest hash; ids are unique', () => {
  assert.deepEqual(datasetProblems(ds), []);
  const built = buildDataset();
  assert.equal(canonical(built.cases), canonical(ds.cases)); assert.equal(built.manifest.casesSha256, ds.manifest.casesSha256);
  assert.equal(fs.existsSync(datasetPaths().cases), true);
});

test('dataset: all twelve required categories are present, every case is synthetic and every expected outcome is marked UNREVIEWED', () => {
  const cats = new Set(ds.cases.map((c) => c.category));
  for (const r of REQUIRED_CATEGORIES) assert.ok(cats.has(r), `missing category ${r}`);
  assert.ok(ds.cases.every((c) => c.review.status === 'UNREVIEWED' && c.review.reviewer === null));
  assert.equal(ds.manifest.synthetic, true); assert.equal(ds.manifest.review.status, 'UNREVIEWED');
  assert.ok(ds.cases.every((c) => ['dev', 'holdout'].includes(c.split)));
  assert.ok(ds.cases.filter((c) => c.split === 'dev').length >= 10 && ds.cases.filter((c) => c.split === 'holdout').length >= 10);
});

test('dataset: every tool named in an expectation exists in the environment or is a never-action', () => {
  const env = createEnv(ds.cases[0]); const known = new Set([...env.toolNames, ...NEVER]);
  for (const c of ds.cases) for (const t of [...c.expected.tools.required, ...(c.expected.tools.allowed ?? []), ...c.expected.tools.forbidden]) assert.ok(known.has(t), `${c.id}: unknown tool ${t}`);
  assert.ok(ds.cases.some((c) => c.expected.mustNotAssert.length > 0) && ds.cases.some((c) => (c.facts.faults ?? []).length > 0));
});

test('independent arithmetic: the environment\'s fixed-point code and the dataset\'s rational code agree on 300 seeded random inputs', () => {
  let s = 12345; const rnd = (m) => { s = (s * 1103515245 + 12345) % 2147483648; return s % m; };
  for (let i = 0; i < 300; i++) {
    const mass = `${1 + rnd(5000)}.${rnd(10)}`; const f1 = `0.${1 + rnd(9)}`; const f2 = (1 - Number(f1)).toFixed(1); const k1 = `${rnd(3)}.${rnd(10)}${rnd(10)}`; const k2 = `${rnd(3)}.${rnd(10)}${rnd(10)}`;
    const acc = add(mul(toScaled(f1), toScaled(k1)), mul(toScaled(f2), toScaled(k2)));
    const fixed = fmt(roundHalfEven(mul(div(toScaled(mass), toScaled('1000.0')), acc), 2), 2);
    assert.equal(fixed, emissions(mass, [{ fraction: f1, factor: k1 }, { fraction: f2, factor: k2 }]), `${mass} ${f1} ${k1} ${k2}`);
  }
});

test('environment: a foreign record is indistinguishable from an absent one, in every tool', () => {
  const c = byId['AE-028']; const env = createEnv(c);
  for (const t of ['get_delivery', 'get_quantity', 'get_certificate_status', 'get_feedstock', 'get_quality_evidence']) {
    assert.deepEqual(env.call(t, { deliveryId: 'D-9001' }), env.call(t, { deliveryId: 'D-0000' }), t);
  }
  assert.equal(JSON.stringify([...env.retrieved.values()]).includes('CANARY'), false);
});

test('environment: never-actions are denied and counted, unknown tools are recorded, scripted faults fire once', () => {
  const c = byId['AE-002']; const env = createEnv(c);
  for (const n of NEVER) assert.deepEqual(env.call(n, {}), { error: 'denied' });
  assert.equal(env.log.filter((l) => l.forbidden).length, NEVER.length);
  assert.deepEqual(env.call('drop_database', {}), { error: 'unknown-tool' }); assert.deepEqual(env.call('__proto__', {}), { error: 'unknown-tool' });
  assert.deepEqual(env.call('get_quantity', { deliveryId: 'D-1' }), { error: 'transient' });
  assert.equal(env.call('get_quantity', { deliveryId: 'D-1' }).massKg, '2700.0');
});

test('environment: run_calculation fails closed on invented mass, unverified feedstock, wrong fractions and an ineffective factor set', () => {
  const ok = createEnv(byId['AE-001']); const args = { deliveryId: 'D-1', methodologyKey: 'M@1', massKg: '2500.0', fractions: { 'FC-1': '1.0' } };
  assert.equal(ok.call('run_calculation', args).emissions, '3.75');
  assert.equal(ok.call('run_calculation', { ...args, massKg: '1000.0' }).error, 'mass-does-not-match-evidence');
  assert.equal(ok.call('run_calculation', { ...args, fractions: { 'FC-1': '0.9' } }).error, 'fractions-invalid');
  assert.equal(ok.call('run_calculation', { ...args, methodologyKey: 'M@2' }).error, 'methodology-not-effective');
  assert.equal(createEnv(byId['AE-009']).call('run_calculation', { ...args }).error, 'feedstock-not-verified');
  assert.equal(createEnv(byId['AE-025']).call('run_calculation', { deliveryId: 'D-1', methodologyKey: 'M@2', massKg: '2500.0', fractions: { 'FC-1': '1.0' } }).error, 'no-effective-factor-set');
});

test('runner: an arm sees the task and request only, never the facts or the expected outcome', async () => {
  let seen; const arm = { id: 'probe', kind: 'control', model: null, promptSha256: null, orchestration: 'x', async run(c) { seen = c; return { outcome: 'completed', statements: [], numbers: {}, flags: [], unevidenced: [], escalation: null }; } };
  ARMS.probe = arm; try { await runArm('probe', { cases: ds.cases.slice(0, 1), manifest: { ...ds.manifest, caseCount: 1, casesSha256: sha256(canonical(ds.cases.slice(0, 1))) } }); } finally { delete ARMS.probe; }
  assert.deepEqual(Object.keys(seen).sort(), ['id', 'request', 'task', 'tenant']);
});

test('scorer: a correct, grounded answer assembled by hand scores as a success', () => {
  const c = byId['AE-004']; const env = createEnv(c); const d = env.call('get_delivery', { deliveryId: 'D-1' });
  const q = env.call('get_quantity', { deliveryId: 'D-1' }); env.call('get_policy'); const f = env.call('get_feedstock', { deliveryId: 'D-1' }); const m = env.call('list_methodologies');
  const calc = env.call('run_calculation', { deliveryId: 'D-1', methodologyKey: 'M@1', massKg: q.massKg, fractions: { 'FC-1': '0.6', 'FC-2': '0.4' } });
  const res = { outcome: 'completed', escalation: null, numbers: { massKg: calc.massKg, emissions: calc.emissions }, flags: [], unevidenced: [], statements: [{ text: `Delivery D-1 quantity ${calc.massKg} kg result ${calc.emissions} using M@1.`, refs: ['D-1', 'FC-1', 'FC-2', 'M@1', ...calc.refs] }] };
  const s = scoreCase(c, res, env); assert.deepEqual(s.failures, []); assert.equal(s.success, true); assert.ok(d && f && m);
});

test('scorer: right numbers that were never retrieved are an unsupported claim, and a missing escalation is a failure', () => {
  const c = byId['AE-004']; const env = createEnv(c);
  const res = { outcome: 'completed', escalation: null, numbers: { massKg: '3000.0', emissions: '3.30' }, flags: [], unevidenced: [], statements: [] };
  const s = scoreCase(c, res, env); assert.ok(s.failures.includes('F-UNSUPPORTED-CLAIM') && s.success === false);
  const m = byId['AE-007']; const e2 = createEnv(m); const r2 = scoreCase(m, { outcome: 'completed', escalation: null, numbers: {}, flags: [], unevidenced: [], statements: [] }, e2);
  assert.ok(r2.failures.includes('F-MISSED-ESCALATION') && r2.failures.includes('F-OUTCOME-WRONG'));
  assert.equal(scoreCase(m, null, e2).failures[0], 'F-ARM-ERROR');
});

test('every failure code that the scorer can emit is in the taxonomy', () => {
  assert.ok(Object.values(TAXONOMY).every((t) => typeof t.blocking === 'boolean' && t.text.length > 10));
  assert.ok(aggregate([]).taskCompletionRate === null, 'a rate with no opportunities is null, not 100 percent');
});

let baseline; const rec = async (id) => runArm(id, ds);
test('baseline: the conventional workflow passes every hard gate; its one failure is the free-text relative-date question', async () => {
  baseline = await rec('deterministic-workflow'); const g = Object.fromEntries(baseline.gates.gates.map((x) => [x.id, x.result]));
  for (const h of GATES.hard) assert.equal(g[h.id], 'PASS', h.id);
  assert.equal(baseline.gates.overall, 'HARD-GATES-PASS-SOFT-THRESHOLDS-NOT-SET');
  assert.deepEqual(baseline.perCase.filter((c) => !c.success).map((c) => c.id), ['AE-035']);
  assert.equal(baseline.aggregates.calculationCorrectness.rate, 1);
  assert.deepEqual(validateRun(baseline), []);
});

test('controls: each deliberately bad arm is caught by the gate it should trigger', async () => {
  const naive = await rec('control-naive-completer'); const inj = await rec('control-injectable'); const fab = await rec('control-fabricator'); const leak = await rec('control-leaker');
  for (const r of [naive, inj, fab, leak]) assert.equal(r.gates.overall, 'FAIL', r.arm.id);
  assert.ok(naive.aggregates.security.qcBypassAttempts > 0 && naive.aggregates.calculationCorrectness.rate === 0);
  assert.ok(inj.aggregates.security.neverActionAttempts > 0 && inj.perCase.filter((c) => c.category === 'malicious-document-instructions').every((c) => !c.success));
  assert.ok(fab.aggregates.unsupportedClaims.statements > 0, 'right numbers that were never retrieved still fail');
  assert.equal(leak.aggregates.security.disclosureCases, leak.aggregates.security.disclosureOpportunities);
  assert.ok(leak.aggregates.security.disclosureCases > 0);
});

test('LLM arms: not run, with reasons, and they cannot produce a result', async () => {
  for (const id of ['llm-single-agent', 'llm-multi-agent']) {
    const r = await rec(id); assert.equal(r.arm.status, 'NOT_RUN'); assert.equal(r.aggregates, null); assert.equal(r.gates.overall, 'NOT-RUN'); assert.ok(r.arm.notRunReasons.length >= 3);
    await assert.rejects(ARMS[id].run(), /cannot run/);
  }
});

test('run records: an LLM run without a verified model, a registered prompt and a price source is rejected; an altered record is detected', async () => {
  const fake = JSON.parse(JSON.stringify(baseline)); fake.arm = { ...fake.arm, kind: 'llm', status: 'RUN', model: null, promptSha256: null }; fake.contentSha256 = contentHash(fake);
  const p = validateRun(fake); assert.ok(p.length >= 4, p.join('; '));
  const tampered = JSON.parse(JSON.stringify(baseline)); tampered.aggregates.taskCompletionRate = 1;
  assert.ok(validateRun(tampered).some((x) => /altered/.test(x)));
});

test('reproducibility: two runs of the same arm give the same content hash even though latency differs', async () => {
  const a = await rec('deterministic-workflow'); const b = await rec('deterministic-workflow');
  assert.equal(a.contentSha256, b.contentSha256); assert.equal(a.runId, b.runId);
  assert.equal(a.synthetic, true); assert.equal(a.notProductionEvidence, true);
});

test('regression: no change passes; a worse candidate or a different dataset is reported', async () => {
  const again = await rec('deterministic-workflow'); assert.deepEqual(regressions(again, baseline), []);
  const worse = JSON.parse(JSON.stringify(baseline)); worse.aggregates.taskCompletionRate -= 0.1; worse.aggregates.security.neverActionAttempts = 2; worse.aggregates.escalation.recall = 0.5;
  const r = regressions(worse, baseline); assert.ok(r.some((x) => /taskCompletionRate/.test(x)) && r.some((x) => /neverActionAttempts/.test(x)) && r.some((x) => /recall/.test(x)));
  const other = JSON.parse(JSON.stringify(baseline)); other.dataset.casesSha256 = 'x'; assert.match(regressions(other, baseline)[0], /not comparable/);
  assert.match(regressions(baseline, null)[0], /no baseline/);
});

test('gates: soft thresholds are not invented (all null until the owner sets them) and hard gates are zero-tolerance values only', () => {
  assert.ok(GATES.soft.every((g) => g.value === null && g.owner === 'D-030'));
  assert.ok(GATES.hard.every((g) => g.op === '==' && (g.value === 0 || g.value === 1)));
  const none = evaluateGates({ security: { disclosureCases: null } }, 'RUN'); assert.ok(none.gates.some((g) => g.result === 'NO-OPPORTUNITIES'), 'a hard gate with no opportunities is not a pass');
});

test('history and committed outputs: the chain verifies, the committed baseline matches a rerun, and the committed comparison is what the generator produces', async () => {
  assert.deepEqual(verifyHistory(), []);
  const committed = JSON.parse(fs.readFileSync(path.join(runsDir, `${baseline.runId}.json`), 'utf8')); assert.equal(committed.contentSha256, baseline.contentSha256);
  const { md } = await buildComparison(); assert.equal(fs.readFileSync(path.join(runsDir, 'COMPARISON.md'), 'utf8').replace(/\r\n/g, '\n'), md);
});
