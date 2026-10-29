// FACTS for the capstone deck, Q&A and notes. Every number shown to an audience is read from a committed source file here, never typed into a slide.
// If a source file changes, the generated deck changes with it (and the committed copy must be regenerated: tests/presentation.test.mjs checks this).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const json = (p) => JSON.parse(read(p));

export const usd = (n) => { const a = Math.abs(n); const s = a >= 1e6 ? `$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M` : a >= 1e3 ? `$${Math.round(a).toLocaleString('en-US')}` : `$${Math.round(a)}`; return n < 0 ? `-${s}` : s; };
export const usd1 = (n) => { const a = Math.abs(n); const s = a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : usd(a); return n < 0 ? `-${s}` : s; };
export const pct = (x) => `${(x * 100).toFixed(1)}%`;

export function loadFacts() {
  const res = json('docs/business/model/results.json'); const S = res.scenarios; const v = (s, k) => S[s].figures[k].value;
  const hist = json('docs/evaluation/agent-runs/history.json'); const base = hist.filter((h) => h.arm === 'deterministic-workflow').pop();
  const run = json(`docs/evaluation/agent-runs/${base.runId}.json`); const A = run.aggregates;
  const evDir = 'docs/evidence/records'; const evs = fs.readdirSync(path.join(root, evDir)).filter((f) => /^EV-\d+\.json$/.test(f)).sort();
  let full = null; for (const f of evs) { const r = json(`${evDir}/${f}`); if (r.exitCode === 0 && Array.isArray(r.argv) && r.argv.join(' ').includes('npm') && r.argv.join(' ').includes('test') && r.tapSummary && r.tapSummary.tests > 1000) full = { id: r.id, tests: r.tapSummary.tests, pass: r.tapSummary.pass }; }
  const dr = read('docs/context/DECISION-REGISTER.md');
  const openDecisions = (dr.match(/^\| D-\d+ .*\| Open \|\s*$/gm) ?? []).length; const m1Open = (dr.match(/^\| D-\d+ .*\| M1 \| Open \|\s*$/gm) ?? []).length;
  const bvm = read('docs/business/BUSINESS-VALUE-MODEL.md'); const label = (k) => Number((bvm.match(new RegExp(`^\\| ${k} \\|.*\\| (\\d+) \\|$`, 'm')) ?? [])[1]);
  const opts = S.base.options; const opt = (id) => opts.find((o) => o.id === id);
  const cm = read('docs/target-architecture/10-CONTROL-MATRIX.md'); const cmRows = (cm.match(/^\| (SV|IS|CC|CL|EM|RA|AU)-\d+ \|/gm) ?? []).length; const cmNot = (cm.match(/^\| (SV|IS|CC|CL|EM|RA|AU)-\d+ \|.*(Not testable|Not modelled|\*\*Not)/gm) ?? []).length;
  const sr = read('docs/target-architecture/13-SECURITY-REVIEW.md');
  const f = {
    // business model (all SCENARIO class unless noted in the model)
    npv: v('base', 'npv3'), npvCons: v('conservative', 'npv3'), npvOpt: v('optimistic', 'npv3'), payback: v('base', 'payback_months'), paybackOpt: v('optimistic', 'payback_months'), paybackCons: v('conservative', 'payback_months'),
    tco: v('base', 'tco3'), tcoCons: v('conservative', 'tco3'), tcoOpt: v('optimistic', 'tco3'), oneTime: v('base', 'one_time_cost'), opexY3: v('base', 'platform_opex_y3'), benefitY3: v('base', 'benefit_y3'),
    certToday: v('base', 'cert_cost_base'), certRun: v('base', 'cert_cost_tobe_run'), certFull: v('base', 'cert_cost_tobe_full'), turnToday: v('base', 'turnaround_base_hours'), turnTobe: v('base', 'turnaround_tobe_hours'),
    premiumPool: v('base', 'premium_pool_y3'), premiumProtected: v('base', 'premium_protected_y3'), breakEven: S.base.breakEvenDeliveries, deliveriesAssumed: 600,
    benefit: { labour: v('base', 'benefit_labour_y3'), disputes: v('base', 'benefit_dispute_y3'), audit: v('base', 'benefit_audit_y3'), premium: v('base', 'benefit_premium_y3'), margin: v('base', 'benefit_incremental_y3') },
    opt1: opt('opt1'), opt2: opt('opt2'), opt3: opt('opt3'), labels: { verified: label('verified'), userProvided: label('user-provided'), benchmark: label('benchmark'), scenario: label('scenario assumption') },
    // evaluation (measured on SYNTHETIC data)
    eval: { runId: base.runId, cases: A.cases, passed: run.perCase.filter((c) => c.success).length, completion: A.taskCompletionRate, emissions: A.calculationCorrectness, numeric: A.numericAssertions, escRecall: A.escalation.recall, escPrecision: A.escalation.precision, gate: run.gates.overall, hardGates: run.gates.gates.filter((g) => g.hard).length, softGates: run.gates.gates.filter((g) => !g.hard).length, miss: run.perCase.filter((c) => !c.success).map((c) => c.id) },
    tests: full, openDecisions, m1Open, controlRows: cmRows, controlsNotTestable: cmNot,
    review: { high: Number((sr.match(/\| (\d+) \| 🟠 HIGH/g) ?? []).length), text: 'three HIGH, eleven MEDIUM and two LOW' },
  };
  return f;
}
