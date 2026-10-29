'use strict';
// Assumption-driven business model. Pure functions: the same model file and price file always give the same numbers.
// Every input carries a class: verified, user-provided, benchmark or scenario. Every output reports the weakest class among the inputs it used,
// so a result built on one scenario assumption is a scenario result, however many verified prices sit beside it.
const fs = require('node:fs');
const path = require('node:path');

const CLASSES = ['verified', 'user-provided', 'benchmark', 'scenario'];
const RANK = Object.fromEntries(CLASSES.map((c, i) => [c, i])); // higher = weaker
const SCENARIOS = ['conservative', 'base', 'optimistic'];
const SEC_YEAR = 365 * 24 * 3600;
const HOURS_YEAR = 8760;
const ORIGIN = 'docs/business/model/model.json';

function inputProblems(inputs) {
  const p = []; const ids = new Set();
  for (const i of inputs) {
    const at = `input ${i?.id ?? '?'}`;
    if (!i || typeof i.id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(i.id)) { p.push(`${at}: id must be lower snake case`); continue; }
    if (ids.has(i.id)) p.push(`${at}: duplicate id`); ids.add(i.id);
    if (!CLASSES.includes(i.class)) { p.push(`${at}: class must be one of ${CLASSES.join(', ')}`); continue; }
    if (typeof i.label !== 'string' || !i.label || typeof i.unit !== 'string') p.push(`${at}: label and unit are required`);
    const hasVals = i.values && SCENARIOS.every((s) => i.values[s] !== undefined);
    if (!hasVals && i.value === undefined && !i.priceMeter) p.push(`${at}: needs values for ${SCENARIOS.join('/')}, a single value, or a priceMeter`);
    if (i.class === 'scenario' && !(typeof i.rationale === 'string' && i.rationale.length >= 15)) p.push(`${at}: a scenario assumption needs a rationale and an owner check (rationale is missing or too short)`);
    if (i.class === 'verified' && !(i.priceMeter || (i.url && i.retrievedAt))) p.push(`${at}: verified needs a priceMeter from the price file, or a url and retrievedAt`);
    if (i.class === 'benchmark' && !(/^https?:\/\//.test(i.url ?? '') && !Number.isNaN(Date.parse(i.retrievedAt ?? '')) && i.source)) p.push(`${at}: a benchmark needs source, url and retrievedAt`);
    if (i.class === 'user-provided' && !(i.providedBy && !Number.isNaN(Date.parse(i.providedOn ?? '')))) p.push(`${at}: user-provided needs providedBy and providedOn (a named person and a date)`);
    if (i.class !== 'scenario' && i.priceMeter === undefined && i.values && new Set(SCENARIOS.map((s) => i.values[s])).size > 1) p.push(`${at}: a ${i.class} input has one value; scenarios may only vary scenario assumptions`);
  }
  return p;
}

function load(root) {
  const model = JSON.parse(fs.readFileSync(path.join(root, ORIGIN), 'utf8'));
  const prices = JSON.parse(fs.readFileSync(path.join(root, 'docs/business/model/azure-prices.json'), 'utf8'));
  return { model, prices };
}

// Resolves every input for one scenario. Prices come from the price file for the chosen price region.
function resolve(model, prices, scenario, overrides = {}) {
  const region = overrides.price_region ?? model.priceRegion;
  const meters = new Map(prices.meters.map((m) => [m.id, m]));
  const values = {}; const meta = {};
  for (const i of model.inputs) {
    let v;
    if (i.priceMeter) { const pr = meters.get(i.priceMeter)?.perRegion?.[region]; if (!pr) throw new Error(`no price for ${i.priceMeter} in ${region}`); v = pr.retailPrice; }
    else v = i.values ? i.values[scenario] : i.value;
    if (overrides[i.id] !== undefined) v = overrides[i.id];
    values[i.id] = v; meta[i.id] = i;
  }
  return { values, meta, region };
}

function weakest(classes) { return [...classes].sort((a, b) => RANK[b] - RANK[a])[0] ?? 'scenario'; }

// Core calculation for one scenario. Returns every figure with its class and the inputs it used.
function calculate(model, prices, scenario, overrides = {}) {
  const { values, meta, region } = resolve(model, prices, scenario, overrides);
  const used = new Set();
  const g = (id) => { if (!(id in values)) throw new Error(`unknown input ${id}`); used.add(id); return values[id]; };
  const figs = {};
  const fig = (id, label, unit, fn) => { used.clear(); const value = fn(); const ids = [...used]; figs[id] = { id, label, unit, value, class: weakest(ids.map((x) => meta[x].class)), inputs: ids }; return value; };

  // ---- unit-cost building blocks
  const hours = { evidence: ['h_evidence_base', 'h_evidence_tobe', 'rate_ops'], calc: ['h_calc_base', 'h_calc_tobe', 'rate_quality'], qm: ['h_qm_base', 'h_qm_tobe', 'rate_qm'], filing: ['h_filing_base', 'h_filing_tobe', 'rate_compliance'] };
  const certHours = (which) => Object.values(hours).reduce((s, [b, t]) => s + g(which === 'base' ? b : t), 0);
  const certCost = (which) => Object.values(hours).reduce((s, [b, t, r]) => s + g(which === 'base' ? b : t) * g(r), 0);

  fig('cert_hours_base', 'Manual hours per certificate, today', 'hours', () => certHours('base'));
  fig('cert_hours_tobe', 'Manual hours per certificate, with the platform', 'hours', () => certHours('tobe'));
  fig('cert_cost_base', 'Labour cost per certificate, today', 'USD', () => certCost('base'));
  fig('cert_cost_tobe_labour', 'Labour cost per certificate, with the platform', 'USD', () => certCost('tobe'));
  fig('turnaround_base_hours', 'Delivery-to-certificate turnaround, today', 'hours', () => g('turnaround_base_days') * 24);
  fig('turnaround_tobe_hours', 'Delivery-to-certificate turnaround, with the platform (bounded by the human approval)', 'hours', () => g('turnaround_tobe_hours'));

  // ---- volumes by year
  const years = [1, 2, 3];
  const deliveries = (y, d = g('deliveries_per_year')) => d * (1 + g('volume_growth')) ** (y - 1);
  const ramp = (y) => g(`ramp_y${y}`);

  // ---- annual benefit at full ramp for d deliveries
  const labourSaving = (d) => d * (certCost('base') - certCost('tobe'));
  const disputeHoursBase = (d) => d * g('dispute_rate') * g('h_dispute_base');
  const disputeHoursTobe = (d) => d * g('dispute_rate') * g('h_dispute_tobe');
  const disputeSaving = (d) => d * g('dispute_rate') * ((g('h_dispute_base') - g('h_dispute_tobe')) * g('rate_commercial') + g('dispute_value') * (g('writeoff_base') - g('writeoff_tobe')));
  const auditSaving = () => g('audits_per_year') * (g('h_audit_base') - g('h_audit_tobe')) * g('rate_compliance');
  const tonnes = (d) => d * g('tonnes_per_delivery');
  const premiumProtected = (d) => tonnes(d) * g('premium_usd_t') * (g('risk_base') - g('risk_tobe')) * g('loss_profit_impact') * (1 - g('loss_overlap'));
  const incrementalMargin = (d) => tonnes(d) * g('incremental_share') * g('margin_usd_t');
  const benefit = (d, y) => (labourSaving(d) + disputeSaving(d) + auditSaving() + premiumProtected(d) + incrementalMargin(d)) * ramp(y);

  // ---- platform cost
  const jurisdictions = () => g('jurisdictions');
  const cellOpex = (dCell, cumGb) => {
    const vcpuA = g('p_aca_vcpu_active'); const vcpuI = g('p_aca_vcpu_idle'); const memA = g('p_aca_mem_active'); const memI = g('p_aca_mem_idle');
    const af = g('active_fraction'); const vc = g('vcpu_per_replica'); const mem = g('mem_gib_per_replica');
    const aca = g('services_per_cell') * g('replicas_per_service') * SEC_YEAR * (af * (vc * vcpuA + mem * memA) + (1 - af) * (vc * vcpuI + mem * memI));
    const pg = HOURS_YEAR * g('p_pg_compute') * g('pg_ha_multiplier') + g('pg_storage_gb') * g('p_pg_storage') * 12 + g('pg_backup_gb') * g('p_pg_backup') * 12;
    const blob = cumGb * g('p_blob_zrs') * 12;
    const sb = g('sb_units') * HOURS_YEAR * g('p_sb_premium');
    const hsm = g('hsm_pools') * HOURS_YEAR * g('p_hsm_pool');
    const law = g('log_gb_per_day') * 365 * g('p_law_ingest') + g('log_gb_per_day') * 30 * g('log_extra_months') * g('p_law_retention') * 12;
    const ai = g('ai_mtokens_per_cell') * g('p_ai_per_mtoken');
    const net = g('network_security_month') * 12;
    void dCell;
    return { aca, pg, blob, sb, hsm, law, ai, net, prod: aca + pg + blob + sb + hsm + law + ai + net };
  };
  const cells = (opt) => {
    const o = model.options[opt];
    const platform = o.platformCells === 'jurisdictions' ? jurisdictions() : o.platformCells;
    return { platform, coordination: o.coordination ?? 0, localStores: o.localStores === 'ports' ? g('ports') : 0, buildMult: g(o.buildMultiplier), opsFteExtra: o.opsFtePerLocalStore ? g(o.opsFtePerLocalStore) : 0 };
  };
  const platformYear = (opt, y) => {
    const c = cells(opt); const dTot = deliveries(y);
    // cumulative evidence volume per platform cell at the end of year y, in GB
    let cum = 0; for (let s = 1; s <= y; s++) cum += (deliveries(s) / c.platform) * g('evidence_mb_per_delivery') / 1024;
    const one = cellOpex(dTot / c.platform, cum);
    const onprem = opt === 'opt3' ? g('onprem_cell_share') : 0;
    const cloudCells = c.platform * (1 - onprem); const onpremCells = c.platform * onprem;
    const full = one.prod * (1 + g('nonprod_fraction'));
    const platform = cloudCells * full + onpremCells * full * g('onprem_cost_multiplier') + c.coordination * full * g('coordination_fraction');
    return { one, full, platform, cells: c };
  };
  const opexYear = (opt, y) => {
    const p = platformYear(opt, y); const c = p.cells;
    const edge = g('ports') * g('edge_hw_port') * g('edge_support_pct');
    const store = c.localStores * g('local_store_hw_port') * g('edge_support_pct');
    const fte = (c.platform * g('ops_fte_per_cell') + c.coordination * g('ops_fte_per_cell') * g('coordination_fraction') + c.localStores * c.opsFteExtra + g('security_fte')) * g('fte_cost');
    return { platform: p.platform, edge, store, ops: fte, licences: g('licences_year'), total: p.platform + edge + store + fte + g('licences_year'), detail: p };
  };
  const oneTime = (opt) => {
    const c = cells(opt); const extraCells = Math.max(0, c.platform - 1);
    const buildPm = g('build_person_months') * c.buildMult + g('integration_person_months') + extraCells * g('onboarding_pm_per_cell');
    const build = buildPm * g('pm_cost');
    const assurance = jurisdictions() * g('legal_per_jurisdiction') + g('pentest_cost');
    const hw = g('ports') * g('edge_hw_port') + c.localStores * g('local_store_hw_port') + (opt === 'opt3' ? c.platform * g('onprem_cell_share') * g('onprem_cell_capex') : 0);
    const subtotal = build + assurance + hw;
    const contingency = subtotal * g('contingency');
    return { build, assurance, hw, contingency, total: subtotal + contingency };
  };

  const rec = (opt) => {
    const y0 = oneTime(opt); const ys = years.map((y) => opexYear(opt, y));
    const tco = y0.total + ys.reduce((s, y) => s + y.total, 0);
    return { y0, ys, tco };
  };
  const chosen = 'opt3';
  const R = {}; for (const opt of Object.keys(model.options)) R[opt] = rec(opt);

  // ---- headline figures for the recommended option
  const sel = R[chosen];
  const d1 = deliveries(1); const d3 = deliveries(3);
  fig('platform_opex_y1', 'Annual platform operating cost, year 1 (recommended option)', 'USD', () => { opexYear(chosen, 1); return sel.ys[0].total; });
  fig('platform_opex_y3', 'Annual platform operating cost, year 3 (recommended option)', 'USD', () => { opexYear(chosen, 3); return sel.ys[2].total; });
  fig('one_time_cost', 'One-time cost (build, assurance, hardware, contingency)', 'USD', () => oneTime(chosen).total);
  fig('tco3', 'Three-year total cost of ownership (recommended option)', 'USD', () => rec(chosen).tco);
  const benefits = years.map((y) => benefit(deliveries(y), y));
  fig('benefit_y1', 'Annual benefit, year 1 (after ramp)', 'USD', () => benefit(d1, 1));
  fig('benefit_y3', 'Annual benefit, year 3 (after ramp)', 'USD', () => benefit(d3, 3));
  fig('benefit3', 'Three-year benefit', 'USD', () => years.reduce((s, y) => s + benefit(deliveries(y), y), 0));
  fig('net3', 'Three-year net benefit (benefit minus TCO)', 'USD', () => years.reduce((s, y) => s + benefit(deliveries(y), y), 0) - rec(chosen).tco);
  fig('roi3', 'Three-year ROI (net benefit divided by TCO)', 'ratio', () => (years.reduce((s, y) => s + benefit(deliveries(y), y), 0) - rec(chosen).tco) / rec(chosen).tco);
  const r = () => g('discount_rate');
  fig('npv3', 'Three-year net present value', 'USD', () => { const rr = r(); return -oneTime(chosen).total + years.reduce((s, y) => s + (benefit(deliveries(y), y) - opexYear(chosen, y).total) / (1 + rr) ** y, 0); });

  // payback: monthly cash flow, years 4 to 10 held at year 3 (labelled as an extrapolation)
  const payback = () => {
    let cum = -sel.y0.total; const maxM = 120;
    for (let m = 1; m <= maxM; m++) {
      const y = Math.min(3, Math.ceil(m / 12)); const flow = (benefits[y - 1] - sel.ys[y - 1].total) / 12; const before = cum; cum += flow;
      if (cum >= 0) return m - 1 + (flow === 0 ? 1 : -before / flow);
    }
    return null;
  };
  fig('payback_months', 'Payback period (months; null = not within 10 years; years 4 to 10 held at year 3)', 'months', () => payback());
  // the payback figure depends on every benefit and cost input; record them
  figs.payback_months.inputs = Object.keys(values); figs.payback_months.class = weakest(Object.keys(values).map((x) => meta[x].class));

  // ---- the five operating measures
  fig('cert_cost_tobe_run', 'Run cost per certificate with the platform (labour plus platform operating cost, year 3)', 'USD', () => certCost('tobe') + opexYear(chosen, 3).total / deliveries(3));
  fig('cert_cost_tobe_full', 'Fully loaded cost per certificate with the platform (year 3 run cost plus the one-time cost spread over the certificates of years 1 to 3)', 'USD', () => certCost('tobe') + opexYear(chosen, 3).total / deliveries(3) + oneTime(chosen).total / (deliveries(1) + deliveries(2) + deliveries(3)));
  fig('manual_hours_base', 'Annual manual hours, today (certificates, disputes, audits; year 3 volume)', 'hours', () => d3 * certHours('base') + disputeHoursBase(d3) + g('audits_per_year') * g('h_audit_base'));
  fig('manual_hours_tobe', 'Annual manual hours, with the platform (year 3 volume)', 'hours', () => d3 * certHours('tobe') + disputeHoursTobe(d3) + g('audits_per_year') * g('h_audit_tobe'));
  fig('dispute_cost_base', 'Dispute handling cost per dispute, today (labour plus write-off)', 'USD', () => g('h_dispute_base') * g('rate_commercial') + g('dispute_value') * g('writeoff_base'));
  fig('dispute_cost_tobe', 'Dispute handling cost per dispute, with the platform', 'USD', () => g('h_dispute_tobe') * g('rate_commercial') + g('dispute_value') * g('writeoff_tobe'));
  fig('disputes_per_year', 'Disputes per year (year 3 volume)', 'count', () => d3 * g('dispute_rate'));
  fig('audit_cost_base', 'Audit preparation cost per audit, today', 'USD', () => g('h_audit_base') * g('rate_compliance'));
  fig('audit_cost_tobe', 'Audit preparation cost per audit, with the platform', 'USD', () => g('h_audit_tobe') * g('rate_compliance'));
  fig('premium_protected_y3', 'Green-fuel premium protected per year (year 3, before ramp)', 'USD', () => premiumProtected(d3));
  fig('incremental_margin_y3', 'Incremental margin from volume enabled by auditor-grade evidence per year (year 3, before ramp)', 'USD', () => incrementalMargin(d3));
  fig('premium_pool_y3', 'Green-fuel premium revenue pool per year (year 3, for scale)', 'USD', () => tonnes(d3) * g('premium_usd_t'));
  fig('benefit_labour_y3', 'Benefit by source, year 3: certificate labour', 'USD', () => labourSaving(d3) * ramp(3));
  fig('benefit_dispute_y3', 'Benefit by source, year 3: disputes', 'USD', () => disputeSaving(d3) * ramp(3));
  fig('benefit_audit_y3', 'Benefit by source, year 3: audit preparation', 'USD', () => auditSaving() * ramp(3));
  fig('benefit_premium_y3', 'Benefit by source, year 3: premium protected', 'USD', () => premiumProtected(d3) * ramp(3));
  fig('benefit_incremental_y3', 'Benefit by source, year 3: incremental margin', 'USD', () => incrementalMargin(d3) * ramp(3));
  fig('green_tonnes_y1', 'Green-fuel tonnes delivered per year (year 1)', 'tonnes', () => tonnes(d1));
  fig('share_of_sg_biobunker', 'Group green tonnes as a share of Singapore 2025 biobunker sales (plausibility check only)', 'ratio', () => tonnes(d1) / (g('sg_biobunker_mt') * 1e6));

  // ---- architecture options (cost only; benefit is the same function, but option 1 breaches HC-01 and is not eligible)
  const optionRows = Object.entries(model.options).map(([id, o]) => {
    const x = R[id]; const row = { id, name: o.name, eligible: o.eligible, tco3: x.tco, oneTime: x.y0.total, opexY3: x.ys[2].total };
    return row;
  });
  const options = optionRows.map((o) => ({ ...o, class: weakest(Object.keys(values).map((x) => meta[x].class)) }));

  return { scenario, region, figs, options, values, meta, detail: { y0: sel.y0, ys: sel.ys, benefits, deliveries: years.map((y) => deliveries(y)), platform: sel.ys.map((y) => y.detail.one), R } };
}

// What a change of +/- pct in one input does to the three-year NPV. Only inputs listed in model.sensitivity.
function sensitivity(model, prices, scenario, pct = 0.2) {
  const base = calculate(model, prices, scenario);
  const out = [];
  for (const id of model.sensitivity) {
    const b = base.values[id]; if (typeof b !== 'number') continue;
    const lo = calculate(model, prices, scenario, { [id]: b * (1 - pct) }).figs.npv3.value;
    const hi = calculate(model, prices, scenario, { [id]: b * (1 + pct) }).figs.npv3.value;
    out.push({ id, label: base.meta[id].label, class: base.meta[id].class, base: b, npvLow: lo, npvHigh: hi, swing: Math.abs(hi - lo) });
  }
  return { baseNpv: base.figs.npv3.value, rows: out.sort((a, b) => b.swing - a.swing) };
}

// Deliveries per year at which the three-year NPV is zero, other inputs unchanged. null when not reached up to 40 times the scenario volume.
function breakEvenDeliveries(model, prices, scenario) {
  const f = (d) => calculate(model, prices, scenario, { deliveries_per_year: d }).figs.npv3.value;
  const d0 = calculate(model, prices, scenario).values.deliveries_per_year;
  let lo = 1; let hi = d0 * 40;
  if (f(hi) < 0) return null;
  if (f(lo) >= 0) return lo;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (f(mid) >= 0) hi = mid; else lo = mid; }
  return hi;
}

// The three-year NPV with each benefit source switched off in turn: shows which source carries the case.
function benefitDependence(model, prices, scenario) {
  const base = calculate(model, prices, scenario);
  const zero = { labour: { h_evidence_tobe: base.values.h_evidence_base, h_calc_tobe: base.values.h_calc_base, h_qm_tobe: base.values.h_qm_base, h_filing_tobe: base.values.h_filing_base },
    disputes: { h_dispute_tobe: base.values.h_dispute_base, writeoff_tobe: base.values.writeoff_base },
    audit: { h_audit_tobe: base.values.h_audit_base },
    premium: { risk_tobe: base.values.risk_base, incremental_share: 0 } };
  const rows = Object.entries(zero).map(([k, ov]) => ({ source: k, npv: calculate(model, prices, scenario, ov).figs.npv3.value }));
  // If every premium-at-risk loss were already counted as a dispute concession, the premium line would add nothing.
  rows.push({ source: 'full overlap of premium and dispute losses', npv: calculate(model, prices, scenario, { loss_overlap: 1 }).figs.npv3.value });
  const only = { 'labour only': { ...zero.disputes, ...zero.audit, ...zero.premium }, 'premium and incremental only': { ...zero.labour, ...zero.disputes, ...zero.audit } };
  for (const [k, ov] of Object.entries(only)) rows.push({ source: k, npv: calculate(model, prices, scenario, ov).figs.npv3.value });
  return { baseNpv: base.figs.npv3.value, rows };
}

module.exports = { CLASSES, SCENARIOS, inputProblems, load, resolve, calculate, sensitivity, breakEvenDeliveries, benefitDependence, weakest };
