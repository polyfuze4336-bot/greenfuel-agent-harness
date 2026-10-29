// RUNNER for the synthetic agent evaluation: loads a versioned dataset, runs one arm, scores from the environment's records, evaluates quality gates, and writes a hash-chained run record.
// Commands: run --arm <id> [--write] | list | verify | compare [--write]. Reproducible: the content hash excludes wall-clock latency and creation time only.
// This is SYNTHETIC EVALUATION. A run here is never production evidence.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { canonical, sha256 } from '../scripts/spec-validators.mjs';
import { DATASET_VERSION, datasetPaths, buildDataset } from './build-dataset.mjs';
import { createEnv } from './env.mjs';
import { scoreCase, aggregate, SCORER_VERSION, TAXONOMY } from './score.mjs';
import * as deterministic from './arms/deterministic.mjs';
import { controls } from './arms/controls.mjs';
import { single, multi, readRegistry } from './arms/llm.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
export const runsDir = path.join(root, 'docs', 'evaluation', 'agent-runs');
export const GATES = JSON.parse(fs.readFileSync(path.join(here, 'gates.json'), 'utf8'));
const norm = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
export const codeSha = () => sha256(['env.mjs', 'score.mjs', 'gates.json', 'lib/decimal.mjs', 'arms/deterministic.mjs', 'arms/controls.mjs'].map((f) => norm(path.join(here, f))).join('\u0000'));

export const ARMS = { [deterministic.arm.id]: { ...deterministic.arm, run: deterministic.run }, ...Object.fromEntries(controls.map((a) => [a.id, a])), [single.id]: single, [multi.id]: multi };

export function loadDataset() {
  const p = datasetPaths(); const cases = JSON.parse(norm(p.cases)); const manifest = JSON.parse(norm(p.manifest));
  return { cases, manifest };
}
export function datasetProblems({ cases, manifest }) {
  const out = [];
  if (sha256(canonical(cases)) !== manifest.casesSha256) out.push('cases.json does not match the hash in manifest.json');
  if (manifest.version !== DATASET_VERSION) out.push('manifest version differs from the builder version');
  if (cases.length !== manifest.caseCount) out.push('case count differs from the manifest');
  if (new Set(cases.map((c) => c.id)).size !== cases.length) out.push('duplicate case ids');
  return out;
}

const view = (c) => ({ id: c.id, task: c.task, tenant: c.tenant, request: JSON.parse(JSON.stringify(c.request)) }); // the arm never sees facts or expected outcomes

export const getMetric = (agg, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), agg);
export function evaluateGates(agg, status = 'RUN') {
  const res = [];
  for (const g of [...GATES.hard.map((x) => ({ ...x, hard: true })), ...GATES.soft.map((x) => ({ ...x, hard: false }))]) {
    const v = getMetric(agg, g.metric);
    let r;
    if (status !== 'RUN') r = 'NOT-RUN';
    else if (g.value === null) r = 'NOT-SET';
    else if (v === null || v === undefined) r = g.hard ? 'NO-OPPORTUNITIES' : 'NOT-SET';
    else r = ({ '==': v === g.value, '>=': v >= g.value, '<=': v <= g.value })[g.op] ? 'PASS' : 'FAIL';
    res.push({ id: g.id, metric: g.metric, hard: g.hard, op: g.op, threshold: g.value, value: v ?? null, result: r });
  }
  const hardFail = res.some((x) => x.hard && x.result === 'FAIL'); const hardUnknown = res.some((x) => x.hard && x.result === 'NO-OPPORTUNITIES');
  const overall = status !== 'RUN' ? 'NOT-RUN' : hardFail ? 'FAIL' : hardUnknown ? 'INCOMPLETE' : res.some((x) => !x.hard && x.result === 'NOT-SET') ? 'HARD-GATES-PASS-SOFT-THRESHOLDS-NOT-SET' : 'PASS';
  return { overall, gates: res };
}

const strip = (rec) => {
  const { contentSha256, createdAt, ...rest } = rec;
  // Wall-clock latency is the only legitimately non-reproducible value: it is dropped from the hash wherever it appears (including inside a latency gate result).
  return JSON.parse(JSON.stringify(rest, (k, v) => (k === 'latencyMs' ? undefined : (v && typeof v === 'object' && typeof v.metric === 'string' && v.metric.startsWith('latencyMs') ? { ...v, value: undefined } : v))));
};
export const contentHash = (rec) => sha256(canonical(strip(rec)));

export function validateRun(rec) {
  const p = [];
  if (rec.schema !== 'greenfuel.agent-eval-run/v1') p.push('wrong schema');
  if (rec.contentSha256 !== contentHash(rec)) p.push('content hash does not match the record (altered after it was written)');
  if (rec.arm.kind === 'llm' && rec.arm.status === 'RUN') {
    const reg = readRegistry(); const m = reg.models.find((x) => x.id === rec.arm.model?.id);
    if (!rec.arm.model?.modelVersion) p.push('an LLM run must record the model version');
    if (!m || m.status !== 'VERIFIED') p.push('an LLM run must name a VERIFIED model from registry.json');
    if (!rec.arm.promptSha256 || !reg.prompts.some((x) => x.sha256 === rec.arm.promptSha256)) p.push('an LLM run must record a registered prompt sha256');
    if (!rec.arm.tokenPriceSource) p.push('an LLM run must record the source and date of the token prices used');
  }
  return p;
}

export async function runArm(armId, dataset = loadDataset(), { repeats = 1 } = {}) {
  const arm = ARMS[armId]; if (!arm) throw new Error(`unknown arm ${armId}`);
  const bad = datasetProblems(dataset); if (bad.length) throw new Error(`dataset invalid: ${bad.join('; ')}`);
  const base = { schema: 'greenfuel.agent-eval-run/v1', synthetic: true, notProductionEvidence: true, dataset: { version: dataset.manifest.version, casesSha256: dataset.manifest.casesSha256, reviewStatus: dataset.manifest.review.status }, scorer: { version: SCORER_VERSION }, codeSha256: codeSha(), repeats };
  if (arm.notRun) {
    const agg = null; const g = evaluateGates({}, 'NOT-RUN');
    const rec = { ...base, runId: null, arm: { id: arm.id, kind: arm.kind, status: 'NOT_RUN', orchestration: arm.orchestration, model: null, promptSha256: null, notRunReasons: arm.notRunReasons }, perCase: [], aggregates: agg, gates: g, failure: 'F-NOT-RUN' };
    rec.runId = `AR-${arm.id}-NOT-RUN`; rec.contentSha256 = contentHash(rec); return rec;
  }
  const perCase = []; const timings = {};
  for (const c of dataset.cases) {
    const env = createEnv(c); const t0 = performance.now(); let result;
    try { result = await arm.run(view(c), env); } catch (e) { result = null; env.log.push({ tool: 'ARM-ERROR', result: String(e.message).slice(0, 80) }); }
    timings[c.id] = performance.now() - t0;
    const s = scoreCase(c, result, env); s.latencyMs = timings[c.id]; perCase.push(s);
  }
  const aggregates = aggregate(perCase, timings);
  const rec = { ...base, runId: null, arm: { id: arm.id, kind: arm.kind, status: 'RUN', orchestration: arm.orchestration, model: arm.model, promptSha256: arm.promptSha256 ?? null, version: arm.version }, perCase, aggregates, gates: evaluateGates(aggregates) };
  rec.contentSha256 = contentHash(rec); rec.runId = `AR-${arm.id}-${rec.contentSha256.slice(0, 8)}`; rec.contentSha256 = contentHash(rec);
  rec.createdAt = undefined; return rec;
}

// Regression: a candidate run must not be worse than the committed baseline of the same arm and dataset on the protected metrics.
export function regressions(candidate, baseline) {
  const out = []; if (!baseline) return ['no baseline to compare'];
  if (candidate.dataset.casesSha256 !== baseline.dataset.casesSha256) return ['the dataset differs from the baseline: not comparable'];
  const A = candidate.aggregates; const B = baseline.aggregates;
  const worseHigh = ['taskCompletionRate', 'calculationCorrectness.rate', 'escalation.recall', 'toolSelectionPrecision', 'evidenceCitationAccuracy'];
  const worseLow = ['security.disclosureCases', 'security.neverActionAttempts', 'security.qcBypassAttempts', 'unsupportedClaims.statements', 'unsupportedClaims.numbers'];
  for (const m of worseHigh) { const a = getMetric(A, m); const b = getMetric(B, m); if (a !== null && b !== null && a < b) out.push(`${m} fell from ${b} to ${a}`); }
  for (const m of worseLow) { const a = getMetric(A, m); const b = getMetric(B, m); if (a > b) out.push(`${m} rose from ${b} to ${a}`); }
  return out;
}

const historyPath = path.join(runsDir, 'history.json');
export const readHistory = () => (fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, 'utf8')) : []);
export function writeRun(rec) {
  fs.mkdirSync(runsDir, { recursive: true }); const hist = readHistory();
  if (hist.some((h) => h.runId === rec.runId && h.contentSha256 === rec.contentSha256)) return { written: false, reason: 'identical run already recorded' };
  const prev = hist.length ? hist[hist.length - 1].entrySha256 : '0'.repeat(64);
  const entry = { runId: rec.runId, arm: rec.arm.id, status: rec.arm.status, datasetVersion: rec.dataset.version, casesSha256: rec.dataset.casesSha256, scorerVersion: rec.scorer.version, codeSha256: rec.codeSha256, contentSha256: rec.contentSha256, overall: rec.gates.overall, prevEntrySha256: prev };
  entry.entrySha256 = sha256(canonical(entry));
  const file = path.join(runsDir, `${rec.runId}.json`);
  fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`); fs.writeFileSync(historyPath, `${JSON.stringify([...hist, entry], null, 2)}\n`);
  return { written: true, file };
}
export function verifyHistory() {
  const hist = readHistory(); const problems = []; let prev = '0'.repeat(64);
  for (const h of hist) {
    const { entrySha256, ...b } = h; if (h.prevEntrySha256 !== prev) problems.push(`${h.runId}: chain broken`); if (sha256(canonical(b)) !== entrySha256) problems.push(`${h.runId}: entry altered`); prev = entrySha256;
    const f = path.join(runsDir, `${h.runId}.json`);
    if (!fs.existsSync(f)) { problems.push(`${h.runId}: record file missing`); continue; }
    const rec = JSON.parse(norm(f)); for (const q of validateRun(rec)) problems.push(`${h.runId}: ${q}`); if (rec.contentSha256 !== h.contentSha256) problems.push(`${h.runId}: record differs from the history entry`);
  }
  return problems;
}

const f2 = (v, d = 3) => (v === null || v === undefined ? 'n/a' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(d)) : String(v));
export function comparisonMarkdown(recs) {
  const cols = recs.map((r) => r.arm.id); const row = (label, fn) => `| ${label} | ${recs.map((r) => (r.arm.status === 'NOT_RUN' ? 'NOT RUN' : fn(r.aggregates))).join(' | ')} |`;
  const lines = [
    '<!-- Generated by harness/agent-eval/runner.mjs compare --write. Do not edit by hand. -->', '# Agent evaluation comparison (generated)', '',
    `Dataset v${recs[0].dataset.version} (${recs[0].dataset.casesSha256.slice(0, 12)}), expected outcomes **${recs[0].dataset.reviewStatus}**. SYNTHETIC evaluation: not production evidence. Control arms exist only to prove the scorer detects failures and are not candidates.`, '',
    `| Metric | ${cols.join(' | ')} |`, `|---|${cols.map(() => '---').join('|')}|`,
    `| Kind | ${recs.map((r) => r.arm.kind).join(' | ')} |`,
    row('Cases', (a) => f2(a.cases)), row('Task completion rate', (a) => f2(a.taskCompletionRate)), row('Tool selection precision', (a) => f2(a.toolSelectionPrecision)), row('Required-tool recall', (a) => f2(a.requiredToolRecall)),
    row('Evidence citation accuracy', (a) => f2(a.evidenceCitationAccuracy)), row('Citation recall', (a) => f2(a.citationRecall)),
    row('Unsupported statements / numbers', (a) => `${a.unsupportedClaims.statements} / ${a.unsupportedClaims.numbers}`),
    row('Never-action attempts', (a) => f2(a.security.neverActionAttempts)), row('QC-bypass attempts', (a) => f2(a.security.qcBypassAttempts)), row('Disclosure cases (of opportunities)', (a) => `${a.security.disclosureCases} of ${a.security.disclosureOpportunities}`),
    row('Escalation precision', (a) => f2(a.escalation.precision)), row('Escalation recall', (a) => f2(a.escalation.recall)), row('Escalation reason correct (of true escalations)', (a) => f2(a.escalation.reasonCorrectRate)),
    row('Calculation correctness', (a) => `${a.calculationCorrectness.correct} of ${a.calculationCorrectness.cases}`), row('Recovery after transient failure', (a) => `${a.recovery.recovered} of ${a.recovery.cases}`),
    row('Model tokens', (a) => `${a.tokens.input} in / ${a.tokens.output} out`), row('Overall gate result', () => ''),
  ];
  lines[lines.length - 1] = `| Overall gate result | ${recs.map((r) => r.gates.overall).join(' | ')} |`;
  lines.push('', '## Task completion by category', '', `| Category | ${cols.join(' | ')} |`, `|---|${cols.map(() => '---').join('|')}|`);
  const cats = Object.keys(recs.find((r) => r.aggregates)?.aggregates.byCategory ?? {});
  for (const c of cats) lines.push(`| ${c} | ${recs.map((r) => (r.aggregates ? `${r.aggregates.byCategory[c].success}/${r.aggregates.byCategory[c].n}` : 'NOT RUN')).join(' | ')} |`);
  lines.push('', '## Failure taxonomy counts', '', `| Code | Meaning | ${cols.join(' | ')} |`, `|---|---|${cols.map(() => '---').join('|')}|`);
  for (const [code, t] of Object.entries(TAXONOMY)) { if (code === 'F-NOT-RUN') continue; lines.push(`| ${code} | ${t.text} | ${recs.map((r) => (r.aggregates ? String(r.aggregates.failureCounts[code] ?? 0) : 'NOT RUN')).join(' | ')} |`); }
  const nr = recs.filter((r) => r.arm.status === 'NOT_RUN');
  if (nr.length) { lines.push('', '## Arms that did not run', ''); for (const r of nr) lines.push(`- **${r.arm.id}** (${r.arm.orchestration}): ${r.arm.notRunReasons.join('; ')}.`); }
  return `${lines.join('\n')}\n`;
}
export const COMPARISON_ORDER = ['deterministic-workflow', 'llm-single-agent', 'llm-multi-agent', 'control-naive-completer', 'control-injectable', 'control-fabricator', 'control-leaker'];
export async function buildComparison() { const ds = loadDataset(); const recs = []; for (const id of COMPARISON_ORDER) recs.push(await runArm(id, ds)); return { recs, md: comparisonMarkdown(recs) }; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2); const flag = (n) => rest.includes(n); const val = (n) => rest[rest.indexOf(n) + 1];
  if (cmd === 'run') {
    const rec = await runArm(val('--arm')); console.log(JSON.stringify({ runId: rec.runId, status: rec.arm.status, overall: rec.gates.overall, aggregates: rec.aggregates && { successRate: rec.aggregates.taskCompletionRate, calc: rec.aggregates.calculationCorrectness, escalation: rec.aggregates.escalation } }, null, 2));
    if (flag('--write')) console.log(writeRun(rec));
  } else if (cmd === 'compare') {
    const { recs, md } = await buildComparison(); const f = path.join(runsDir, 'COMPARISON.md');
    if (flag('--write')) { fs.mkdirSync(runsDir, { recursive: true }); fs.writeFileSync(f, md); for (const r of recs) if (r.arm.id === 'deterministic-workflow' || r.arm.status === 'NOT_RUN') writeRun(r); console.log(`wrote ${f}`); } else console.log(md);
  } else if (cmd === 'verify') {
    const p = [...datasetProblems(loadDataset()), ...verifyHistory()]; if (p.length) { console.error(p.join('\n')); process.exit(1); } console.log(`agent-eval verify: OK (${readHistory().length} recorded run(s))`);
  } else if (cmd === 'list') { console.log(Object.values(ARMS).map((a) => `${a.id}\t${a.kind}\t${a.notRun ? 'NOT RUN' : 'runnable'}`).join('\n')); } else { console.error('usage: run --arm <id> [--write] | compare [--write] | verify | list'); process.exit(2); }
}
