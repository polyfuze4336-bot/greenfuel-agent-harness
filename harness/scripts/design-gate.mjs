#!/usr/bin/env node
// Design Review Gate. Reads a design (DES-*) and its review record (RV-*) and computes whether the design
// is Rejected, Blocked or Approvable, then checks that the declared status is not more permissive.
// Usage:
//   node harness/scripts/design-gate.mjs docs/architecture/reviews/RV-0001-<slug>.md
//   node harness/scripts/design-gate.mjs docs/architecture/reviews/RV-0001-<slug>.md --select B   (what-if)
//   node harness/scripts/design-gate.mjs --coverage
// Exit codes: 0 consistent (or Approvable in what-if); 1 invalid or inconsistent; 2 Blocked or Unscreened (what-if); 3 Rejected (what-if).
// The gate checks structure and consistency. It cannot judge whether a stated reason is true; that is the reviewer's job.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContext } from './validate-context.mjs';

const REQ = /^(BR|FR|SEC|DATA|AGT|NFR)-\d{3}$/;
const REQ_G = /(BR|FR|SEC|DATA|AGT|NFR)-\d{3}/g;
const VOCAB = {
  disposition: ['Selected', 'Not selected', 'Rejected (hard constraint)', 'Deferred'],
  trace: /^(Addressed|Partial|Unresolved|Not applicable|Waived \(ADR-\d{4}\))$/,
  hc: ['Satisfied', 'Conditional', 'Violated', 'Unresolved', 'Not applicable'],
  perspective: ['Pass', 'Concern', 'Fail', 'Not assessed'],
  defence: ['Answered', 'Unanswered', 'Not applicable'],
  status: ['Draft', 'In review', 'Blocked', 'Rejected', 'Approved'],
  checkpoint: ['CP1', 'CP2', 'CP3', 'CP4', 'CP5'],
  compare: /^(Meets|Conditional|Does not meet|Unknown)\b/,
  reversible: /^(Yes|Partly|No)\b/,
};
const ALLOWED = { Rejected: ['Rejected'], Blocked: ['Draft', 'In review', 'Blocked'], Approvable: ['Draft', 'In review', 'Blocked', 'Approved'] };
const BLOCKING_MILESTONES = new Set(['M1', 'M2']);

const split = (t) => t.replace(/\r\n/g, '\n').split('\n');
export const cellsOf = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
const isSep = (c) => c.every((x) => /^:?-{3,}:?$/.test(x));
export const tableRows = (t) => split(t).filter((l) => l.trim().startsWith('|')).map(cellsOf).filter((c) => !isSep(c));
const field = (t, name) => t.match(new RegExp(`^- \\*\\*${name}:\\*\\*\\s*(.*)$`, 'm'))?.[1].trim();
const list = (s) => (s ?? '').split(/[,;]+/).map((x) => x.trim()).filter((x) => x && !/^none$/i.test(x));
const refs = (s, re) => [...(s ?? '').matchAll(re)].map((m) => m[0]);

function comparison(text) {
  const L = split(text);
  const i = L.findIndex((l) => /^\|\s*Criterion\s*\|/.test(l));
  if (i < 0) return null;
  const rows = [];
  for (let j = i + 1; j < L.length && L[j].trim().startsWith('|'); j++) { const c = cellsOf(L[j]); if (!isSep(c)) rows.push(c); }
  return { header: cellsOf(L[i]), rows };
}

const SHAPES = [[/^[A-Z]$/, 4, 'option'], [REQ, 5, 'requirement trace'], [/^TD-\d{3}$/, 6, 'tradeoff'], [/^DA-\d{3}$/, 4, 'assumption'], [/^CN-\d{3}$/, 3, 'constraint'], [/^RK-\d{3}$/, 2, 'risk']];

export function parseDesign(text) {
  const rows = tableRows(text);
  const malformed = [];
  for (const c of rows) for (const [re, n, name] of SHAPES) if (re.test(c[0]) && c.length !== n) malformed.push(`${name} row '${c[0]}' has ${c.length} cells, expected ${n}`);
  const pick = (re, n) => rows.filter((c) => re.test(c[0]) && c.length === n);
  return {
    id: field(text, 'Design ID'), review: field(text, 'Review'), adrs: refs(field(text, 'ADRs'), /ADR-\d{4}/g),
    tags: list(field(text, 'Tags')), scopeCaps: list(field(text, 'Scope capabilities')), extra: refs(field(text, 'Extra requirements in scope'), REQ_G),
    options: pick(/^[A-Z]$/, 4).map(([id, name, summary, disp]) => ({ id, name, summary, disp })),
    trace: pick(REQ, 5).map(([id, element, how, status, validation]) => ({ id, element, how, status, validation })),
    tradeoffs: pick(/^TD-\d{3}$/, 6).map(([id, gain, give, by, rev]) => ({ id, gain, give, by, rev })),
    assumptions: pick(/^DA-\d{3}$/, 4).map(([id]) => ({ id })), constraints: pick(/^CN-\d{3}$/, 3).map(([id]) => ({ id })),
    risks: pick(/^RK-\d{3}$/, 2).map(([id]) => ({ id })), comparison: comparison(text), malformed, mentions: [...new Set(refs(text, REQ_G))],
  };
}

export function parseReview(text) {
  const rows = tableRows(text);
  return {
    id: field(text, 'Review ID'), design: field(text, 'Design'), checkpoint: field(text, 'Checkpoint'), status: field(text, 'Status'), decider: field(text, 'Decider') ?? '',
    hc: rows.filter((c) => /^[A-Z]$/.test(c[0]) && /^HC-\d{2}$/.test(c[1]) && c.length === 5).map(([option, constraint, verdict, reason, conditions]) => ({ option, constraint, verdict, reason, conditions })),
    perspectives: rows.filter((c) => /^PV-\d{2}$/.test(c[0]) && c.length === 5).map(([id, verdict, findings, reference, risk]) => ({ id, verdict, findings, reference, risk })),
    overrides: rows.filter((c) => REQ.test(c[0]) && c.length === 4).map(([id, author, reviewer, reason]) => ({ id, author, reviewer, reason })),
    defence: rows.filter((c) => /^DQ-\d{2}-\d{2}$/.test(c[0]) && c.length === 4).map(([id, disposition, answer, reference]) => ({ id, disposition, answer, reference })),
  };
}

export function loadGovernance(root) {
  const read = (p) => readFileSync(path.join(root, p), 'utf8');
  const A = 'docs/architecture';
  const gov = { hcs: new Map(), pvs: new Set(), questions: new Map(), risks: new Map(), adrs: new Map(), designs: new Map(), reviews: new Map(), errors: [] };
  for (const c of tableRows(read(`${A}/HARD-CONSTRAINTS.md`))) if (/^HC-\d{2}$/.test(c[0])) gov.hcs.set(c[0], { id: c[0], source: c[2], related: refs(c[4], REQ_G), cells: c.length });
  for (const c of tableRows(read(`${A}/REVIEW-PERSPECTIVES.md`))) if (/^PV-\d{2}$/.test(c[0])) gov.pvs.add(c[0]);
  for (const c of tableRows(read(`${A}/DEFENSE-QUESTION-BANK.md`))) if (/^DQ-\d{2}-\d{2}$/.test(c[0])) gov.questions.set(c[0], { id: c[0], pv: c[1], tags: c[2].split(',').map((s) => s.trim()), critical: c[3] === 'Yes', cells: c.length });
  for (const c of tableRows(read(`${A}/RISK-REGISTER.md`))) if (/^RK-\d{3}$/.test(c[0])) gov.risks.set(c[0], { id: c[0], cells: c, status: c[7] });
  const adrDir = path.join(root, 'docs', 'adr');
  for (const f of existsSync(adrDir) ? readdirSync(adrDir) : []) {
    const m = f.match(/^(\d{4})-.+\.md$/);
    if (!m || m[1] === '0000') continue;
    const text = read(`docs/adr/${f}`);
    gov.adrs.set(`ADR-${m[1]}`, { id: `ADR-${m[1]}`, file: `docs/adr/${f}`, text, status: text.match(/\*\*Status:\*\*\s*(\w+)/)?.[1], type: text.match(/\*\*Type:\*\*\s*(\w+)/)?.[1] ?? 'Harness', review: field(text, 'Review') });
  }
  for (const [dir, map, parse, key] of [['designs', gov.designs, parseDesign, /^DES-\d{4}-/], ['reviews', gov.reviews, parseReview, /^RV-\d{4}-/]]) {
    const d = path.join(root, A, dir);
    for (const f of existsSync(d) ? readdirSync(d) : []) if (key.test(f) && f.endsWith('.md')) { const text = read(`${A}/${dir}/${f}`); const rec = parse(text); map.set(rec.id ?? f, { ...rec, file: `${A}/${dir}/${f}`, text }); }
  }
  return gov;
}

const worse = (a, b) => ([a, b].find((s) => s === 'Unresolved') ?? [a, b].find((s) => s === 'Partial') ?? a);

const hasRef = (s) => Boolean(s) && !/^(none|n\/a|–|-)$/i.test(s);
const ID_REF = /\b(DES|ADR|EV|RK|TD|DA|CN|HC|PV|DQ|RV|V|D)-\d{2,4}\b|\b(BR|FR|SEC|DATA|AGT|NFR)-\d{3}\b|\bsections? \d/;
const CAP_SET = new Set(['DEA', 'EAA', 'DRA', 'MBA', 'CCA', 'XC', 'EDG', 'SOV']);
const TAG_SET = new Set(['ALL', 'DATA', 'EDGE', 'AGENT', 'CERT', 'CALC', 'OPS', 'INTEG', 'COST']);
const GENERIC_DECIDER = /\b(bot|tbd|n\/a|agent|model|llm|copilot|claude|gpt|reviewer|architect|challenger|pending|unknown)\b/i;
const decidedOpen = (dec, gov) => { const n = dec?.status.match(/ADR-\d{4}/)?.[0]; return !(n && gov.adrs.get(n)?.status === 'Accepted'); };
const adrRequirements = (text) => refs(text.replace(/<!--[\s\S]*?-->/g, '').match(/^## Requirements addressed\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1], REQ_G);

export function evaluate(design, review, ctx, gov, { select } = {}) {
  const errors = []; const reject = []; const block = [];
  const err = (m) => errors.push(m);
  const selectedId = select ?? design.options.find((o) => o.disp === 'Selected')?.id;
  design.malformed.forEach(err);
  if (review.design !== design.id) err(`review names design ${review.design}, expected ${design.id}`);
  if (design.review !== review.id) err(`design names review ${design.review}, expected ${review.id}`);

  const letters = new Set(design.options.map((o) => o.id));
  if (design.options.length < 3) err('at least three options are required');
  if (letters.size !== design.options.length) err('option letters are not unique');
  for (const o of design.options) if (!VOCAB.disposition.includes(o.disp)) err(`option ${o.id}: disposition '${o.disp}' invalid`);
  if (design.options.filter((o) => o.disp === 'Selected').length !== 1) err('exactly one option must be Selected');
  const cmp = design.comparison;
  if (!cmp || cmp.rows.length < 3) err('alternatives comparison needs a table with at least three criteria');
  else {
    const cols = cmp.header.slice(1);
    if (cols.join() !== [...letters].join()) err(`comparison columns (${cols.join(',')}) must match options (${[...letters].join(',')})`);
    for (const r of cmp.rows) { if (r.length !== cmp.header.length) err(`comparison row '${r[0]}' has ${r.length} cells`); else r.slice(1).forEach((x) => { if (!VOCAB.compare.test(x)) err(`comparison '${r[0]}': cell must start with Meets, Conditional, Does not meet or Unknown`); }); }
  }
  for (const [k, v] of [['tradeoff', design.tradeoffs], ['assumption', design.assumptions], ['constraint', design.constraints], ['risk', design.risks]]) if (!v.length) err(`at least one ${k} is required`);
  for (const t of design.tradeoffs) if (!VOCAB.reversible.test(t.rev)) err(`${t.id}: Reversible must start with Yes, Partly or No`);
  for (const r of design.risks) if (!gov.risks.has(r.id)) err(`unknown risk ${r.id}`);

  const traceById = new Map();
  for (const t of design.trace) {
    if (traceById.has(t.id)) err(`duplicate trace row ${t.id}`);
    traceById.set(t.id, t);
    const req = ctx.reqs.get(t.id);
    if (!req) { err(`trace references unknown requirement ${t.id}`); continue; }
    if (!VOCAB.trace.test(t.status)) { err(`${t.id}: status '${t.status}' invalid`); continue; }
    if (t.status === 'Addressed' && (!t.element || !t.validation)) err(`${t.id}: Addressed needs a design element and a validation plan or evidence`);
    if (t.status === 'Not applicable') {
      if (!t.how) err(`${t.id}: Not applicable needs a reason`);
      const hcBound = [...gov.hcs.values()].some((h) => h.related.includes(t.id));
      if (req.cls === 'A' || hcBound) err(`${t.id}: cannot be Not applicable (class ${req.cls}${hcBound ? ', tied to a hard constraint' : ''}); use Partial or Unresolved, or move it to a sibling design`);
      else if (!review.overrides.some((o) => o.id === t.id && o.reviewer === 'Not applicable')) err(`${t.id}: Not applicable needs the reviewer's confirmation in the overrides table`);
    }
    const w = t.status.match(/Waived \((ADR-\d{4})\)/)?.[1];
    if (w) {
      const hcBound = [...gov.hcs.values()].some((h) => h.related.includes(t.id));
      if (req.cls === 'A' || hcBound) err(`${t.id}: cannot be waived (class ${req.cls}${hcBound ? ', tied to a hard constraint' : ''})`);
      if (gov.adrs.get(w)?.status !== 'Accepted') err(`${t.id}: waiver ${w} is not an Accepted ADR`);
    }
  }
  const scope = new Set(design.extra);
  if (!design.scopeCaps.length || design.scopeCaps.some((c) => !CAP_SET.has(c))) err(`Scope capabilities must be a non-empty list from ${[...CAP_SET].join(', ')}`);
  if (!design.tags.length || design.tags.some((t) => !TAG_SET.has(t))) err(`Tags must be a non-empty list from ${[...TAG_SET].join(', ')}`);
  for (const r of ctx.reqs.values()) if (r.caps.some((c) => design.scopeCaps.includes(c))) scope.add(r.id);
  for (const id of scope) { if (!ctx.reqs.has(id)) err(`extra requirement ${id} does not exist`); else if (!traceById.has(id)) err(`scope requires a trace row for ${id}`); }
  const claimed = new Set([...design.mentions, ...design.adrs.flatMap((a) => adrRequirements(gov.adrs.get(a)?.text ?? ''))]);
  for (const id of claimed) if (ctx.reqs.has(id) && !traceById.has(id)) err(`${id} is claimed in the design or its ADR but has no trace row`);

  const optionLetters = letters;
  for (const h of review.hc) {
    if (!optionLetters.has(h.option)) err(`HC row names unknown option ${h.option}`);
    if (!gov.hcs.has(h.constraint)) err(`HC row names unknown constraint ${h.constraint}`);
    if (!VOCAB.hc.includes(h.verdict)) err(`${h.option}/${h.constraint}: verdict '${h.verdict}' invalid`);
    if (!h.reason) err(`${h.option}/${h.constraint}: a reason is required`);
    else if (h.verdict === 'Satisfied' && !ID_REF.test(h.reason)) err(`${h.option}/${h.constraint}: a Satisfied verdict must cite a design element, decision, requirement or evidence ID in its reason`);
    else if (h.verdict === 'Not applicable' && h.reason.length < 25) err(`${h.option}/${h.constraint}: Not applicable needs a specific reason`);
    if (h.verdict === 'Conditional') { const ds = refs(h.conditions, /D-\d{3}/g); if (!ds.length) err(`${h.option}/${h.constraint}: Conditional needs decision IDs`); ds.forEach((d) => { if (!ctx.decisions.has(d)) err(`unknown decision ${d}`); }); }
  }
  if (!select) {
    for (const hc of gov.hcs.keys()) if (!review.hc.some((h) => h.option === selectedId && h.constraint === hc)) err(`selected option ${selectedId} has no verdict for ${hc}`);
    for (const o of design.options) {
      const violated = review.hc.some((h) => h.option === o.id && h.verdict === 'Violated');
      if (o.disp === 'Rejected (hard constraint)' && !violated) err(`option ${o.id} is marked Rejected (hard constraint) but has no Violated verdict`);
      if (violated && o.disp !== 'Rejected (hard constraint)' && o.disp !== 'Selected') err(`option ${o.id} has a Violated verdict but is not marked Rejected (hard constraint)`);
    }
  }
  const pvSeen = new Set();
  for (const p of review.perspectives) {
    if (!gov.pvs.has(p.id)) err(`unknown perspective ${p.id}`);
    if (pvSeen.has(p.id)) err(`duplicate perspective ${p.id}`); pvSeen.add(p.id);
    if (!VOCAB.perspective.includes(p.verdict)) err(`${p.id}: verdict '${p.verdict}' invalid`);
    if (p.verdict !== 'Pass' && !p.findings) err(`${p.id}: findings are required unless Pass`);
    if (!hasRef(p.reference) || !ID_REF.test(p.reference)) err(`${p.id}: a reference to the design, a decision or evidence is required, including for Pass`);
    if (p.verdict === 'Concern' && !refs(p.risk, /RK-\d{3}/g).some((r) => gov.risks.has(r))) err(`${p.id}: a Concern needs a linked risk that exists`);
  }
  for (const id of gov.pvs) if (!pvSeen.has(id)) err(`missing perspective ${id}`);
  for (const o of review.overrides) {
    if (!traceById.has(o.id)) err(`override for ${o.id}, which is not in the design trace`);
    if (!VOCAB.trace.test(o.reviewer)) err(`override ${o.id}: reviewer status invalid`);
    if (!o.reason) err(`override ${o.id}: reason required`);
  }
  const tagSet = new Set(design.tags);
  const applicable = [...gov.questions.values()].filter((q) => q.critical && (q.tags.includes('ALL') || q.tags.some((t) => tagSet.has(t))));
  const answered = new Map(review.defence.map((d) => [d.id, d]));
  for (const d of review.defence) {
    if (!gov.questions.has(d.id)) err(`unknown question ${d.id}`);
    if (!VOCAB.defence.includes(d.disposition)) err(`${d.id}: disposition '${d.disposition}' invalid`);
    if (d.disposition === 'Answered' && !hasRef(d.reference)) err(`${d.id}: Answered needs a reference`);
    if (d.disposition !== 'Answered' && !d.answer) err(`${d.id}: a reason is required`);
  }
  for (const q of applicable) if (!answered.has(q.id)) err(`critical question ${q.id} has no disposition`);
  if (!VOCAB.checkpoint.includes(review.checkpoint)) err(`checkpoint '${review.checkpoint}' invalid`);
  if (!VOCAB.status.includes(review.status)) err(`status '${review.status}' invalid`);

  const mine = review.hc.filter((h) => h.option === selectedId);
  for (const h of mine) {
    if (h.verdict === 'Violated') reject.push(`${h.constraint} violated by option ${selectedId}: ${h.reason}`);
    if (h.verdict === 'Unresolved') block.push(`${h.constraint} unresolved for option ${selectedId}`);
    if (h.verdict === 'Conditional') { const open = refs(h.conditions, /D-\d{3}/g).filter((d) => decidedOpen(ctx.decisions.get(d), gov)); if (open.length) block.push(`${h.constraint} is conditional on open ${open.join(', ')}`); }
  }
  if (select && mine.length < gov.hcs.size) block.push(`option ${select} is unscreened: ${mine.length} of ${gov.hcs.size} hard-constraint verdicts recorded`);
  for (const p of review.perspectives) {
    if (p.verdict === 'Fail') reject.push(`${p.id} failed: ${p.findings}`);
    if (p.verdict === 'Not assessed') block.push(`${p.id} not assessed`);
  }
  const effective = new Map();
  for (const t of design.trace) { const o = review.overrides.find((x) => x.id === t.id); effective.set(t.id, o ? worse(t.status, o.reviewer) : t.status); }
  const openDecisions = new Map();
  for (const [id, st] of effective) {
    const req = ctx.reqs.get(id);
    if (!req || req.pri !== 'Must' || st === 'Not applicable' || st.startsWith('Waived')) continue;
    if (st === 'Partial' || st === 'Unresolved') block.push(`${id} (Must) is ${st}`);
    for (const d of refs(ctx.trace.get(id)?.open, /D-\d{3}/g)) {
      const dec = ctx.decisions.get(d);
      if (dec && decidedOpen(dec, gov) && /[CD]/.test(dec.kind) && BLOCKING_MILESTONES.has(dec.by)) openDecisions.set(d, [...(openDecisions.get(d) ?? []), id]);
    }
  }
  for (const [d, reqs] of openDecisions) block.push(`${d} (${ctx.decisions.get(d).by}) is Open and affects ${reqs.join(', ')}`);
  for (const q of applicable) { const a = answered.get(q.id); if (!a || a.disposition === 'Unanswered') block.push(`critical question ${q.id} is unanswered`); }

  const computed = reject.length ? 'Rejected' : block.length ? 'Blocked' : 'Approvable';
  const declared = review.status;
  if (!select) {
    if (!ALLOWED[computed].includes(declared)) err(`declared status '${declared}' is not allowed when the gate computes ${computed} (allowed: ${ALLOWED[computed].join(', ')})`);
    if (declared === 'Approved') {
      if (review.checkpoint !== 'CP4') err('Approved requires checkpoint CP4');
      if (!review.decider || GENERIC_DECIDER.test(review.decider) || !/^[\p{Lu}][\p{L}.' -]+ \([^)]+\)$/u.test(review.decider)) err('Approved requires a named human decider in the form "Name (role)"; models, generic roles and placeholders are refused');
    }
  }
  return { computed, reject, block, errors, selectedId };
}

export function evaluateReviewFile(root, reviewPath, opts) {
  const ctx = loadContext(root);
  const gov = loadGovernance(root);
  const rel = path.relative(root, path.resolve(root, reviewPath)).split(path.sep).join('/');
  const review = [...gov.reviews.values()].find((r) => r.file === rel);
  if (!review) return { errors: [`no review record at ${reviewPath}`], reject: [], block: [], computed: 'Unknown' };
  const design = gov.designs.get(review.design);
  if (!design) return { errors: [`review names unknown design ${review.design}`], reject: [], block: [], computed: 'Unknown' };
  return { ...evaluate(design, review, ctx, gov, opts), review, design, ctxErrors: ctx.errors.map((e) => e.msg) };
}

export function coverage(root) {
  const ctx = loadContext(root); const gov = loadGovernance(root);
  const status = new Map();
  for (const d of gov.designs.values()) for (const t of d.trace) status.set(t.id, [...(status.get(t.id) ?? []), `${d.id}:${t.status}`]);
  const missing = [...ctx.reqs.values()].filter((r) => !status.has(r.id));
  return { total: ctx.reqs.size, traced: status.size, mustUntraced: missing.filter((r) => r.pri === 'Must').map((r) => r.id), untraced: missing.length, status };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const args = process.argv.slice(2);
  if (args.includes('--coverage')) {
    const c = coverage(root);
    console.log(`Requirements with a design trace row: ${c.traced} of ${c.total}. Must requirements with none: ${c.mustUntraced.length}.`);
    process.exit(0);
  }
  const sel = args.indexOf('--select');
  const select = sel >= 0 ? args[sel + 1] : undefined;
  const r = evaluateReviewFile(root, args.find((a) => !a.startsWith('--') && a !== select), { select });
  console.log(`Review: ${r.review?.id ?? '?'}  Design: ${r.design?.id ?? '?'}  Option evaluated: ${r.selectedId ?? '?'}${select ? ' (what-if)' : ''}`);
  console.log(`Computed: ${r.computed}${r.review ? `   Declared: ${r.review.status}` : ''}`);
  for (const x of r.reject) console.log(`REJECT  ${x}`);
  for (const x of r.block) console.log(`BLOCK   ${x}`);
  for (const x of r.errors) console.log(`ERROR   ${x}`);
  for (const x of r.ctxErrors ?? []) console.log(`ERROR   baseline: ${x}`);
  console.log(`Summary: ${r.reject.length} rejection reason(s), ${r.block.length} blocking reason(s), ${r.errors.length + (r.ctxErrors?.length ?? 0)} error(s)`);
  if (r.ctxErrors?.length) process.exit(1);
  if (select) process.exit(r.computed === 'Rejected' ? 3 : r.computed === 'Approvable' ? 0 : 2);
  process.exit(r.errors.length ? 1 : 0);
}
