import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const M = require('../harness/lib/business-model.cjs');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { computeAll, validateBusiness, render } = await import('../harness/scripts/business-model.mjs');
const P = await import('../harness/scripts/azure-prices.mjs');

const { model, prices } = M.load(REPO);
const clone = (o) => JSON.parse(JSON.stringify(o));
const npv = (s, ov = {}) => M.calculate(model, prices, s, ov).figs.npv3.value;

test('the committed model is valid, has no user-provided input, and every input has a class and a basis', () => {
  assert.deepEqual(M.inputProblems(model.inputs), []);
  assert.equal(model.inputs.filter((i) => i.class === 'user-provided').length, 0, 'the owner supplied no figure; nothing may claim otherwise');
  for (const i of model.inputs) { assert.ok(M.CLASSES.includes(i.class), i.id); }
  assert.ok(model.inputs.filter((i) => i.class === 'verified').every((i) => i.priceMeter), 'every verified input is a priced meter');
  assert.ok(model.inputs.filter((i) => i.class === 'scenario').every((i) => i.rationale.length >= 15));
});

const BAD = [
  ['a scenario with no rationale', (m) => { delete m.inputs.find((i) => i.id === 'ports').rationale; }, /rationale/],
  ['verified without a meter or source', (m) => { const i = m.inputs.find((x) => x.id === 'ports'); i.class = 'verified'; }, /verified needs/],
  ['a benchmark without a url', (m) => { delete m.inputs.find((i) => i.id === 'sg_biobunker_mt').url; }, /benchmark needs/],
  ['a benchmark without a retrieval date', (m) => { delete m.inputs.find((i) => i.id === 'sg_biobunker_mt').retrievedAt; }, /benchmark needs/],
  ['user-provided without a person and date', (m) => { m.inputs.find((i) => i.id === 'ports').class = 'user-provided'; }, /providedBy and providedOn/],
  ['an unknown class', (m) => { m.inputs.find((i) => i.id === 'ports').class = 'measured'; }, /class must be/],
  ['a duplicate id', (m) => { m.inputs.push(clone(m.inputs[0])); }, /duplicate/],
  ['a verified input that varies by scenario', (m) => { const i = m.inputs.find((x) => x.id === 'sg_biobunker_mt'); delete i.value; i.values = { conservative: 1, base: 2, optimistic: 3 }; }, /may only vary scenario/],
  ['an input with no value', (m) => { const i = m.inputs.find((x) => x.id === 'ports'); delete i.value; }, /needs values/],
];
for (const [name, mutate, re] of BAD) test(`input validation rejects ${name}`, () => { const m = clone(model); mutate(m); assert.ok(M.inputProblems(m.inputs).some((e) => re.test(e)), M.inputProblems(m.inputs).join(' | ')); });

test('arithmetic: labour cost per certificate matches a hand calculation from the inputs', () => {
  const f = M.calculate(model, prices, 'base').figs;
  assert.equal(f.cert_cost_base.value, 6 * 45 + 4 * 75 + 2 * 110 + 3 * 65);
  assert.equal(f.cert_cost_tobe_labour.value, 1.5 * 45 + 0.75 * 75 + 1 * 110 + 0.75 * 65);
  assert.equal(f.cert_hours_base.value, 15);
  assert.equal(f.turnaround_base_hours.value, 6 * 24);
  assert.equal(f.dispute_cost_base.value, 45 * 95 + 45000 * 0.15);
  assert.equal(f.audit_cost_base.value, 240 * 65);
  assert.equal(f.green_tonnes_y1.value, 600 * 500);
});

test('arithmetic: premium protection and platform cost are reproducible by hand', () => {
  const r = M.calculate(model, prices, 'base'); const v = r.values;
  const d3 = v.deliveries_per_year * (1 + v.volume_growth) ** 2;
  assert.ok(Math.abs(r.figs.premium_protected_y3.value - d3 * v.tonnes_per_delivery * v.premium_usd_t * (v.risk_base - v.risk_tobe) * v.loss_profit_impact * (1 - v.loss_overlap)) < 1e-6);
  const one = r.detail.platform[0];
  const hsm = v.hsm_pools * 8760 * v.p_hsm_pool; assert.ok(Math.abs(one.hsm - hsm) < 1e-9);
  const sb = v.sb_units * 8760 * v.p_sb_premium; assert.ok(Math.abs(one.sb - sb) < 1e-9);
  assert.equal(v.p_hsm_pool, 3.2, 'the verified Managed HSM price came from the price file');
});

test('determinism: the same inputs give identical figures, and scenarios are ordered conservative <= base <= optimistic on NPV', () => {
  assert.deepEqual(M.calculate(model, prices, 'base').figs, M.calculate(model, prices, 'base').figs);
  assert.ok(npv('conservative') < npv('base') && npv('base') < npv('optimistic'));
});

test('weakest class: a result using any scenario input is a scenario result; pure verified stays verified', () => {
  assert.equal(M.weakest(['verified', 'verified']), 'verified');
  assert.equal(M.weakest(['verified', 'benchmark']), 'benchmark');
  assert.equal(M.weakest(['verified', 'scenario', 'benchmark']), 'scenario');
  const r = M.calculate(model, prices, 'base');
  for (const f of Object.values(r.figs)) assert.equal(f.class, 'scenario', `${f.id} depends on scenario inputs and must say so`);
  for (const f of Object.values(r.figs)) assert.ok(f.inputs.length > 0, f.id);
});

test('sensitivity direction: more volume, premium and savings raise NPV; more build cost, rates of cost and contingency lower it', () => {
  const base = npv('base');
  assert.ok(npv('base', { deliveries_per_year: 1200 }) > base); assert.ok(npv('base', { premium_usd_t: 200 }) > base); assert.ok(npv('base', { h_evidence_tobe: 0.5 }) > base);
  assert.ok(npv('base', { build_person_months: 200 }) < base); assert.ok(npv('base', { pm_cost: 20000 }) < base); assert.ok(npv('base', { contingency: 0.4 }) < base); assert.ok(npv('base', { fte_cost: 200000 }) < base);
  assert.ok(npv('base', { jurisdictions: 8 }) < base, 'more cells cost more');
  assert.throws(() => M.calculate(model, prices, 'base', { price_region: 'moon' }), /no price/);
});

test('benefit sources and the removal analysis behave: removing a source lowers NPV; the all-sources NPV is the headline', () => {
  const d = M.benefitDependence(model, prices, 'base');
  assert.equal(d.baseNpv, npv('base'));
  for (const r of d.rows.filter((x) => !/only/.test(x.source))) assert.ok(r.npv < d.baseNpv, r.source);
});

test('break-even deliveries really is the zero of the NPV, and null when it cannot be reached', () => {
  const be = M.breakEvenDeliveries(model, prices, 'base');
  assert.ok(be > 600, 'the base case does not break even at its own volume'); assert.ok(Math.abs(npv('base', { deliveries_per_year: be })) < 1);
  assert.ok(M.breakEvenDeliveries(model, prices, 'optimistic') < 600);
  const none = clone(model); for (const id of ['risk_base']) { const i = none.inputs.find((x) => x.id === id); i.values = { conservative: 0, base: 0, optimistic: 0 }; }
  for (const id of ['h_evidence_base', 'h_calc_base', 'h_qm_base', 'h_filing_base']) { const i = none.inputs.find((x) => x.id === id); i.values = { conservative: 0, base: 0, optimistic: 0 }; }
  for (const id of ['writeoff_base', 'h_dispute_base', 'h_audit_base']) { const i = none.inputs.find((x) => x.id === id); i.values = { conservative: 0, base: 0, optimistic: 0 }; }
  assert.equal(M.breakEvenDeliveries(none, prices, 'base'), null, 'with no benefit there is no break-even');
});

test('payback agrees with the sign of the undiscounted three-year net benefit', () => {
  for (const s of M.SCENARIOS) {
    const f = M.calculate(model, prices, s).figs;
    if (f.net3.value >= 0) assert.ok(f.payback_months.value !== null && f.payback_months.value <= 36, `${s}: net >= 0 implies payback within 36 months`);
    else assert.ok(f.payback_months.value === null || f.payback_months.value > 36, `${s}: net < 0 implies payback after 36 months`);
  }
});

test('options: centralised is ineligible, edge-plus-shore is only conditional, only sovereign cells are a complete eligible costing; every option has a finite cost', () => {
  for (const s of M.SCENARIOS) {
    const o = Object.fromEntries(M.calculate(model, prices, s).options.map((x) => [x.id, x]));
    assert.equal(o.opt1.eligible, false); assert.equal(o.opt2.eligible, 'conditional'); assert.equal(o.opt3.eligible, true);
    for (const x of Object.values(o)) assert.ok(Number.isFinite(x.tco3) && x.tco3 > 0);
    assert.ok(o.opt3.tco3 > o.opt1.tco3, `${s}: sovereignty has a price`);
  }
  assert.match(model.options.opt1.ineligibleReason, /HC-01/);
});

test('the committed report, results and csv are current and the validator passes on the repository', () => {
  assert.deepEqual(validateBusiness(REPO), []);
  const text = render(computeAll(REPO));
  assert.match(text, /no input is user-provided/); assert.ok(text.includes('stacked extremes, not a confidence interval'));
  assert.ok(!/\bROI of\b/i.test(text), 'no prose claims a return');
});

test('the validator detects an edited report, an edited input and a corrupt price file', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'gf-biz-'));
  try {
    cpSync(path.join(REPO, 'docs/business'), path.join(tmp, 'docs/business'), { recursive: true });
    assert.deepEqual(validateBusiness(tmp), []);
    const rp = path.join(tmp, 'docs/business/BUSINESS-VALUE-MODEL.md'); writeFileSync(rp, `${readFileSync(rp, 'utf8')}\nA quietly added claim: payback in 2 months.\n`);
    assert.ok(validateBusiness(tmp).some((e) => /stale or edited/.test(e)));
    writeFileSync(rp, readFileSync(path.join(REPO, 'docs/business/BUSINESS-VALUE-MODEL.md')));
    const mp = path.join(tmp, 'docs/business/model/model.json'); const m = JSON.parse(readFileSync(mp, 'utf8')); m.inputs.find((i) => i.id === 'premium_usd_t').values.base = 500; writeFileSync(mp, JSON.stringify(m));
    assert.ok(validateBusiness(tmp).some((e) => /stale or edited/.test(e)), 'changing an input without regenerating is caught');
    writeFileSync(mp, readFileSync(path.join(REPO, 'docs/business/model/model.json')));
    const pp = path.join(tmp, 'docs/business/model/azure-prices.json'); const pj = JSON.parse(readFileSync(pp, 'utf8')); pj.meters[0].perRegion.southeastasia = { retailPrice: 0.1 }; writeFileSync(pp, JSON.stringify(pj));
    assert.ok(validateBusiness(tmp).some((e) => /azure-prices.json/.test(e)));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- price file
test('price selection: first charged tier, newest effective date, matching unit; null when nothing is charged; filters are quoted', () => {
  const items = [
    { retailPrice: 0, tierMinimumUnits: 0, effectiveStartDate: '2020-01-01T00:00:00Z', unitOfMeasure: '1 GB' },
    { retailPrice: 2.99, tierMinimumUnits: 5, effectiveStartDate: '2020-01-01T00:00:00Z', unitOfMeasure: '1 GB', meterId: 'a' },
    { retailPrice: 2.5, tierMinimumUnits: 5, effectiveStartDate: '2021-01-01T00:00:00Z', unitOfMeasure: '1 GB', meterId: 'b' },
    { retailPrice: 9, tierMinimumUnits: 5, effectiveStartDate: '2099-01-01T00:00:00Z', unitOfMeasure: '1 GB', meterId: 'future' },
    { retailPrice: 1, tierMinimumUnits: 0, effectiveStartDate: '2020-01-01T00:00:00Z', unitOfMeasure: '1/Month', meterId: 'wrong-unit' },
  ];
  assert.equal(P.pick(items, new Date('2026-01-01'), '1 GB').meterId, 'b');
  assert.equal(P.pick(items, new Date('2026-01-01'), '1 GB').retailPrice, 2.5);
  assert.equal(P.pick([{ retailPrice: 0, effectiveStartDate: '2020-01-01T00:00:00Z', unitOfMeasure: 'x' }], new Date(), 'x'), null);
  assert.equal(P.pick([], new Date()), null);
  assert.match(P.filterFor({ serviceName: "O'Brien", productName: 'p', skuName: 's', meterName: 'm' }, 'southeastasia'), /O''Brien/);
});

test('price file: fetchAll uses only the anonymous Retail Prices API and needs no credential', async () => {
  const urls = [];
  const fakeFetch = async (url, opts) => { urls.push({ url, opts }); return { ok: true, json: async () => ({ Items: [{ retailPrice: 1, tierMinimumUnits: 0, effectiveStartDate: '2020-01-01T00:00:00Z', unitOfMeasure: '1 Hour', meterId: 'x', meterName: 'gpt global' }], NextPageLink: null }) }; };
  const out = await P.fetchAll({ fetchImpl: fakeFetch, now: new Date('2026-01-01') });
  assert.ok(urls.every((u) => u.url.startsWith('https://prices.azure.com/api/retail/prices') && !u.opts)); assert.equal(out.meters.length, P.METERS.length); assert.equal(out.regions.length, P.REGIONS.length);
  await assert.rejects(() => P.fetchAll({ fetchImpl: async () => ({ ok: false, status: 503 }) }), /503/);
});

test('price file: the committed file is a real retrieval with provenance, and its limits say a price is not availability', () => {
  assert.deepEqual(P.checkFile(path.join(REPO, 'docs/business/model/azure-prices.json')), []);
  assert.match(prices.limits.join(' '), /does not show the service meets any residency rule/);
  assert.equal(prices.currency, 'USD'); assert.ok(Date.parse(prices.retrievedAt) > Date.parse('2026-01-01'));
});

void mkdirSync;

test('overlap: removing double counting lowers the premium benefit; full overlap removes it; the report shows the full-overlap case', () => {
  const base = M.calculate(model, prices, 'base');
  const none = M.calculate(model, prices, 'base', { loss_overlap: 0 });
  assert.ok(none.figs.premium_protected_y3.value > base.figs.premium_protected_y3.value);
  assert.equal(M.calculate(model, prices, 'base', { loss_overlap: 1 }).figs.premium_protected_y3.value, 0);
  const d = M.benefitDependence(model, prices, 'base');
  const full = d.rows.find((r) => /full overlap/.test(r.source)); assert.ok(full && full.npv < d.baseNpv);
  assert.match(render(computeAll(REPO)), /with full overlap of premium and dispute losses/);
});

test('fully loaded cost per certificate divides one-time cost by the certificates of years 1 to 3, not by three times year 3', () => {
  const r = M.calculate(model, prices, 'optimistic'); const v = r.values;
  const d = [1, 2, 3].map((y) => v.deliveries_per_year * (1 + v.volume_growth) ** (y - 1));
  const expected = r.figs.cert_cost_tobe_labour.value + r.figs.platform_opex_y3.value / d[2] + r.figs.one_time_cost.value / (d[0] + d[1] + d[2]);
  assert.ok(Math.abs(r.figs.cert_cost_tobe_full.value - expected) < 1e-6);
});