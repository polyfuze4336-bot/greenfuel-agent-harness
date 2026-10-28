// Checks the architecture-governance artefacts in docs/architecture and design ADRs. Zero dependencies.
// Covers: hard-constraint, perspective, question-bank, risk-register and checkpoint tables; ADR structure and
// the ADR-to-review coupling; every review record through the design-review gate; and a heuristic lint
// for fabricated figures and unverified compliance claims.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { loadContext } from './validate-context.mjs';
import { loadGovernance, evaluate, tableRows } from './design-gate.mjs';

const A = 'docs/architecture';
const TAGS = new Set(['ALL', 'DATA', 'EDGE', 'AGENT', 'CERT', 'CALC', 'OPS', 'INTEG', 'COST']);
const LEVEL = new Set(['Low', 'Medium', 'High', 'Unassessed']);
const RISK_STATUS = new Set(['Open', 'Mitigated', 'Accepted', 'Closed']);
const ADR_STATUS = new Set(['Proposed', 'Accepted', 'Rejected', 'Superseded']);
const ADR_TYPES = new Set(['Design', 'Harness', 'Governance']);
const COMMON = ['Context', 'Options considered', 'Decision', 'Consequences', 'Revisit when', 'Evidence'];
const DESIGN_ONLY = ['Requirements addressed', 'Hard constraints', 'Why this option is appropriate', 'Reliability consequences', 'Security consequences', 'Residency implications', 'Cost and operational implications', 'Reversibility', 'Validation evidence', 'Review gate'];
const REQ_G = /(BR|FR|SEC|DATA|AGT|NFR)-\d{3}/g;

const FIGURES = [
  [/[$€£]\s?\d|\b(USD|EUR|SGD|CNY|JPY|KRW|MYR|INR|HKD|AUD)\s?\d|\d\s?(USD|EUR|SGD|CNY|JPY|KRW|MYR|INR|HKD|AUD)\b/, 'a monetary amount'],
  [/\b\d+(\.\d+)?\s?(%|percent)/i, 'a percentage'],
  [/\b\d+(\.\d+)?\s?(ms|milliseconds?|seconds?|minutes?|hours?|days?|TB|GB|MB|KB|Gbps|Mbps|tps|rps|vCPUs?)\b/i, 'a figure with a unit'],
  [/\b(five )?nines\b/i, 'an availability claim'],
  [/\b(is|are|will be)\s+(fully\s+)?(compliant|certified)\b|\bcomplies with\b|\bmeets the requirements of\b/i, 'a compliance claim'],
];
const FIG_ALLOW = /placeholder|illustrative|source:/i;
const CLAIM_ALLOW = /candidate|unverified|not verified|never|must not|does not|cannot|no claim|reject|red flag|fabricat|prohibit/i;

const sections = (text) => {
  const out = new Map();
  const parts = text.replace(/<!--[\s\S]*?-->/g, '').split(/^## /m).slice(1);
  for (const p of parts) { const nl = p.indexOf('\n'); out.set(p.slice(0, nl).trim(), p.slice(nl + 1).trim()); }
  return out;
};
const refs = (s, re) => [...(s ?? '').matchAll(re)].map((m) => m[0]);

function mdUnder(dir) {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'templates') walk(p); } else if (e.name.endsWith('.md')) out.push(p); } };
  if (existsSync(dir)) walk(dir);
  return out;
}

export function validateArchitecture(root) {
  if (!existsSync(path.join(root, A, 'HARD-CONSTRAINTS.md'))) return [];
  const errors = [];
  const fail = (msg) => errors.push({ check: 'architecture', msg });
  const ctx = loadContext(root);
  const gov = loadGovernance(root);
  const read = (p) => readFileSync(path.join(root, p), 'utf8');

  const cs = new Set([...ctx.cs].filter((c) => /^CS-C\d$/.test(c)));
  const covered = new Set();
  for (const h of gov.hcs.values()) {
    if (h.cells !== 5) fail(`${h.id}: expected 5 cells, found ${h.cells}`);
    refs(h.source, /CS-(C\d|P\d)/g).forEach((c) => covered.add(c));
    for (const r of h.related) if (!ctx.reqs.has(r)) fail(`${h.id}: unknown related requirement ${r}`);
  }
  if (gov.hcs.size < 12) fail(`expected at least 12 hard constraints, found ${gov.hcs.size}`);
  for (const c of cs) if (!covered.has(c)) fail(`case-study constraint ${c} is not covered by any hard constraint`);
  for (let i = 1; i <= 10; i++) if (!gov.pvs.has(`PV-${String(i).padStart(2, '0')}`)) fail(`missing perspective PV-${String(i).padStart(2, '0')}`);
  for (const c of tableRows(read(`${A}/REVIEW-PERSPECTIVES.md`))) if (/^PV-\d{2}$/.test(c[0])) refs(c[5], /HC-\d{2}/g).forEach((h) => { if (!gov.hcs.has(h)) fail(`${c[0]}: unknown constraint ${h}`); });

  const perPv = new Map();
  for (const q of gov.questions.values()) {
    if (q.cells !== 7) fail(`${q.id}: expected 7 cells, found ${q.cells}`);
    if (!gov.pvs.has(q.pv)) fail(`${q.id}: unknown perspective ${q.pv}`);
    if (q.id.slice(3, 5) !== q.pv.slice(3)) fail(`${q.id}: id does not match perspective ${q.pv}`);
    q.tags.forEach((t) => { if (!TAGS.has(t)) fail(`${q.id}: unknown tag ${t}`); });
    const e = perPv.get(q.pv) ?? { n: 0, crit: 0 }; e.n++; if (q.critical) e.crit++; perPv.set(q.pv, e);
  }
  for (const id of gov.pvs) { const e = perPv.get(id); if (!e || e.n < 5) fail(`${id}: needs at least five questions`); else if (!e.crit) fail(`${id}: needs at least one critical question`); }

  const tdIds = new Set([...gov.designs.values()].flatMap((d) => d.tradeoffs.map((t) => t.id)));
  for (const r of gov.risks.values()) {
    const c = r.cells;
    if (c.length !== 9) { fail(`${r.id}: expected 9 cells, found ${c.length}`); continue; }
    if (!LEVEL.has(c[3]) || !LEVEL.has(c[4])) fail(`${r.id}: impact and likelihood must be Low, Medium, High or Unassessed`);
    if (!RISK_STATUS.has(c[7])) fail(`${r.id}: status '${c[7]}' invalid`);
    if (!c[5] || !c[6]) fail(`${r.id}: mitigation and owner role are required`);
    for (const d of refs(c[8], /D-\d{3}/g)) if (!ctx.decisions.has(d)) fail(`${r.id}: unknown decision ${d}`);
    for (const h of refs(c[8], /HC-\d{2}/g)) if (!gov.hcs.has(h)) fail(`${r.id}: unknown constraint ${h}`);
    for (const q of refs(c[8], REQ_G)) if (!ctx.reqs.has(q)) fail(`${r.id}: unknown requirement ${q}`);
    for (const q of refs(c[8], /DES-\d{4}/g)) if (!gov.designs.has(q)) fail(`${r.id}: unknown design ${q}`);
    for (const q of refs(c[8], /TD-\d{3}/g)) if (!tdIds.has(q)) fail(`${r.id}: unknown tradeoff ${q}`);
  }
  const cps = tableRows(read(`${A}/REVIEW-CHECKPOINTS.md`)).map((c) => c[0]);
  for (const cp of ['CP1', 'CP2', 'CP3', 'CP4', 'CP5']) if (!cps.includes(cp)) fail(`REVIEW-CHECKPOINTS is missing ${cp}`);

  for (const a of gov.adrs.values()) {
    if (!ADR_STATUS.has(a.status)) fail(`${a.id}: status '${a.status}' invalid`);
    if (!ADR_TYPES.has(a.type)) fail(`${a.id}: type '${a.type}' invalid`);
    const s = sections(a.text);
    const need = a.type === 'Design' ? [...COMMON, ...DESIGN_ONLY] : COMMON;
    for (const h of need) if ((s.get(h) ?? '').length < 15) fail(`${a.id}: section '${h}' is missing or empty`);
    if (a.type !== 'Design') continue;
    const reqs = refs(s.get('Requirements addressed'), REQ_G);
    if (!reqs.length) fail(`${a.id}: 'Requirements addressed' must list requirement IDs`);
    reqs.forEach((r) => { if (!ctx.reqs.has(r)) fail(`${a.id}: unknown requirement ${r}`); });
    const hcs = refs(s.get('Hard constraints'), /HC-\d{2}/g);
    if (!hcs.length) fail(`${a.id}: 'Hard constraints' must list HC identifiers`);
    hcs.forEach((h) => { if (!gov.hcs.has(h)) fail(`${a.id}: unknown constraint ${h}`); });
    if ((s.get('Options considered').match(/^\d+\.\s/gm) ?? []).length < 3) fail(`${a.id}: at least three options must be listed`);
    const rv = gov.reviews.get(a.review);
    if (!rv) { fail(`${a.id}: Design ADR must name an existing review (found '${a.review}')`); continue; }
    const design = gov.designs.get(rv.design);
    if (!design?.adrs.includes(a.id)) fail(`${a.id}: the design ${rv.design} does not list this ADR`);
    if (a.status === 'Accepted' && rv.status !== 'Approved') fail(`${a.id}: cannot be Accepted while review ${rv.id} is ${rv.status}`);
  }

  for (const d of gov.designs.values()) {
    if (!gov.reviews.has(d.review)) fail(`${d.id}: review ${d.review} not found`);
    if (!d.adrs.length) fail(`${d.id}: lists no ADR`);
    for (const a of d.adrs) { const adr = gov.adrs.get(a); if (!adr) fail(`${d.id}: ${a} not found`); else if (adr.review !== d.review) fail(`${a}: its Review field must be ${d.review}`); }
  }
  for (const rv of gov.reviews.values()) {
    const design = gov.designs.get(rv.design);
    if (!design) { fail(`${rv.id}: design ${rv.design} not found`); continue; }
    for (const e of evaluate(design, rv, ctx, gov).errors) fail(`${rv.id}: ${e}`);
  }

  const files = [...mdUnder(path.join(root, A)), ...[...gov.adrs.values()].map((a) => path.join(root, a.file))];
  for (const f of files) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    read(rel).split(/\r?\n/).forEach((line, i) => {
      for (const [re, what] of FIGURES) {
        const allow = what === 'a compliance claim' ? CLAIM_ALLOW : FIG_ALLOW;
        if (re.test(line) && !allow.test(line)) fail(`${rel}:${i + 1}: possible ${what} without a source or placeholder marker`);
      }
    });
  }
  return errors;
}
