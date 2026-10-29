import crypto from 'node:crypto';
import type { Decision, Risk, Task } from '../repo/types.ts';
import type { Fragment, ParsedOption, ReqRow, SectionAt, TraceRow } from './extract.ts';
import { STATUSES, type ApprovalEvent, type Claim, type Comparison, type EvidenceRef, type FieldSource, type Flag, type Implication, type NormStatus, type NormalizedDecision, type OptionInfo, type PriorityValue, type RubricRef, type Src, type Verdict } from './schema.ts';

// Turns cached per-file fragments into normalized decision records. Deterministic: no model, no network, no guessing.
// A value is copied from a source, or derived by a rule written down here, or left null and listed in `missing`.

const uniq = <T>(a: T[]): T[] => [...new Set(a)];
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const PRIORITY_RANK: Record<string, number> = { Must: 3, Should: 2, Could: 1 };

export interface AssembleInput {
  fragments: Fragment[];
  commit: string;
  blobOf: (path: string) => string;
}

interface DesignFrag {
  path: string;
  id: string;
  review: string | null;
  adrs: string[];
  tags: string[];
  idLine: number;
  cites: string[];
  comparison: { line: number; columns: string[]; rows: { criterion: string; line: number; cells: Record<string, { verdict: Verdict; text: string }> }[] } | null;
}
interface ReviewFrag {
  path: string;
  id: string;
  design: string | null;
  declared: string | null;
  decider: string | null;
  line: number;
}
interface AdrFrag {
  path: string;
  legacy: Decision;
  review: string | null;
  supersedes: string | null;
  sections: Record<string, SectionAt | null>;
  options: ParsedOption[];
  positive: { text: string; line: number }[];
  negative: { text: string; line: number }[];
  evidenceIds: string[];
  otherEvidence: string[];
  requirements: string[];
  cites: string[];
}

const REGISTER_KIND: Record<string, string> = {
  C: 'Stakeholder clarification',
  D: 'Verification of a regulatory or certification claim',
  X: 'Architecture decision',
};

export function statusFromAdr(cls: Decision['status'], reviewBlocked: boolean): { status: NormStatus; rule: string } {
  switch (cls) {
    case 'accepted':
      return { status: 'Approved', rule: 'ADR status line says Accepted' };
    case 'rejected':
      return { status: 'Rejected', rule: 'ADR status line says Rejected' };
    case 'superseded':
      return { status: 'Superseded', rule: 'ADR status line says Superseded' };
    case 'deferred':
      return { status: 'Deferred', rule: 'ADR status line says Deferred' };
    default:
      return reviewBlocked ? { status: 'Blocked', rule: 'ADR status line says Proposed and the design review it names is declared Blocked' } : { status: 'Proposed', rule: 'ADR status line says Proposed' };
  }
}

function hashOf(rec: Omit<NormalizedDecision, 'contentHash'>): string {
  const json = JSON.stringify(rec, (k, v) => (k === 'line' || k === 'commit' || k === 'blob' ? undefined : v));
  return crypto.createHash('sha256').update(json).digest('hex');
}

function highest(ids: string[], pri: Map<string, string>): { value: PriorityValue; basis: string } | null {
  const have = ids.filter((i) => pri.has(i));
  if (!have.length) return null;
  const counts: Record<string, number> = {};
  for (const i of have) counts[pri.get(i)!] = (counts[pri.get(i)!] ?? 0) + 1;
  const top = Object.keys(counts).sort((a, b) => (PRIORITY_RANK[b] ?? 0) - (PRIORITY_RANK[a] ?? 0))[0]!;
  if (!PRIORITY_RANK[top]) return null;
  const detail = ['Must', 'Should', 'Could'].filter((p) => counts[p]).map((p) => `${p} ${counts[p]}`).join(', ');
  return { value: top as PriorityValue, basis: `highest priority of ${have.length} traced requirement(s): ${detail}` };
}

function claimsFor(opt: OptionInfo, cmp: Comparison, key: string, designPath: string): void {
  for (const r of cmp.rows) {
    const c = r.cells[key];
    if (!c) continue;
    const claim: Claim = { text: `${r.criterion}: ${c.text}`, src: { path: designPath, line: r.line }, basis: 'recorded', criterion: r.criterion };
    if (c.verdict === 'meets') opt.pros.push(claim);
    else if (c.verdict === 'does-not-meet') opt.cons.push(claim);
    else if (c.verdict === 'conditional') opt.conditional.push(claim);
    else opt.unknown.push(claim);
  }
}

export function assemble(input: AssembleInput): { records: NormalizedDecision[]; warnings: string[] } {
  const { fragments, commit, blobOf } = input;
  const warnings: string[] = [];
  const of = <T = Record<string, unknown>>(kind: Fragment['kind']) => fragments.filter((f) => f.kind === kind).map((f) => ({ path: f.path, ...(f.data as object) }) as T & { path: string });

  const adrFrags = of<AdrFrag>('adr').sort((a, b) => a.path.localeCompare(b.path));
  const registerRows = of<{ rows: Decision[] }>('register').flatMap((f) => f.rows);
  const reqRows = of<{ rows: ReqRow[] }>('requirements').flatMap((f) => f.rows.map((r) => ({ ...r, path: f.path })));
  const traceRows = of<{ rows: TraceRow[] }>('trace').flatMap((f) => f.rows.map((r) => ({ ...r, path: f.path })));
  const risks = of<{ rows: Risk[] }>('risks').flatMap((f) => f.rows);
  const todoFrags = of<{ rows: Task[]; log: { date: string; text: string; adrs: string[]; line: number }[] }>('todo');
  const tasks = [...todoFrags.flatMap((f) => f.rows), ...of<{ rows: Task[] }>('roadmap').flatMap((f) => f.rows)];
  const designs = of<DesignFrag>('design').map((d) => ({ ...d, id: String(d.id) }));
  const reviews = of<ReviewFrag>('review').map((r) => ({ ...r, id: String(r.id) }));
  const evidence = new Map(of<{ id: string; claim: string | null; exitCode: number | null }>('evidence').filter((e) => e.id).map((e) => [e.id, e]));
  const approvals = of<{ id: string | null; subject: { type?: string; id?: string } | null; decision: string | null; createdAt: string | null; reason: string | null; signatures: number }>('approval');
  const rubric = of<{ mentions: { criterion: string; title: string; label: string; line: number; ids: string[] }[] }>('rubric').flatMap((f) => f.mentions.map((m) => ({ ...m, path: f.path })));
  const docCites = fragments.filter((f) => Array.isArray((f.data as { cites?: string[] }).cites)).map((f) => ({ path: f.path, cites: (f.data as { cites: string[] }).cites }));

  const priority = new Map(reqRows.map((r) => [r.id, r.priority]));
  const reviewById = new Map(reviews.map((r) => [r.id, r]));
  const designById = new Map(designs.map((d) => [d.id, d]));
  const t2 = tasks.find((t) => t.id === 'T2');

  const records: NormalizedDecision[] = [];

  const base = (id: string, kind: NormalizedDecision['kind'], title: string, srcPath: string, srcLine: number, statusRaw: string): NormalizedDecision => ({
    id,
    kind,
    title,
    description: null,
    businessJustification: null,
    category: null,
    tags: [],
    milestone: null,
    priority: null,
    status: 'Proposed',
    statusRaw,
    statusRule: '',
    approvalBasis: 'none',
    recommendedOption: null,
    options: [],
    comparison: null,
    implications: { cost: null, security: null, reliability: null, dataSovereignty: null, operational: null },
    dependsOn: [],
    dependedOnBy: [],
    supersedes: [],
    supersededBy: [],
    blockingRequirements: [],
    relatedAdrs: [],
    relatedRisks: [],
    relatedTasks: [],
    relatedReviews: [],
    requiredApproverRole: null,
    decisionOwner: null,
    decisionDate: null,
    approvalHistory: [],
    source: { path: srcPath, line: srcLine, commit, blob: blobOf(srcPath) },
    citedBy: [],
    evidence: [],
    rubric: [],
    flags: [],
    missing: [],
    fieldSources: {},
    contentHash: '',
  });

  // ---- ADRs
  for (const a of adrFrags) {
    const l = a.legacy;
    const number = l.id.slice(4);
    const rec = base(l.id, 'adr', l.title, a.path, 1, l.statusRaw);
    const fs = (field: string, src: Src, rule: string) => {
      rec.fieldSources[field] = { ...src, rule };
    };
    // design and review links
    const myDesigns = designs.filter((d) => d.adrs.includes(l.id) || (a.review && d.review === a.review));
    const reviewIds = uniq([...(a.review ? [a.review] : []), ...myDesigns.map((d) => d.review).filter((x): x is string => !!x)]);
    const blocked = reviewIds.some((r) => reviewById.get(r)?.declared === 'Blocked');
    const st = statusFromAdr(l.status, blocked);
    rec.status = st.status;
    rec.statusRule = st.rule;
    fs('status', { path: a.path, line: 3 }, st.rule);
    for (const f of l.flags.review) rec.flags.push({ code: 'review', text: f });
    if (l.status === 'proposed' && /Maybe|unrecognised/i.test(l.flags.review.join(' '))) rec.flags.push({ code: 'status-unrecognised', text: 'The status line was not recognised; shown as Proposed.' });
    rec.tags = uniq(myDesigns.flatMap((d) => d.tags));

    // description, justification, category
    if (a.sections.decision) {
      rec.description = clip(a.sections.decision.text, 1500);
      fs('description', { path: a.path, line: a.sections.decision.line }, 'ADR "## Decision" section, first 1500 characters');
    }
    if (a.sections.why) {
      rec.businessJustification = clip(a.sections.why.text, 1500);
      fs('businessJustification', { path: a.path, line: a.sections.why.line }, 'ADR "## Why this option is appropriate" section');
    }
    if (l.adrType && !l.adrType.startsWith('(none')) {
      rec.category = l.adrType;
      fs('category', { path: a.path, line: 4 }, 'ADR "Type" header');
    }
    rec.decisionDate = l.date ?? null;
    if (l.date) fs('decisionDate', { path: a.path, line: 5 }, 'ADR "Date" header (the date the ADR was written, not necessarily the date it was approved)');
    if (l.owner) {
      rec.decisionOwner = l.owner;
      rec.requiredApproverRole = { text: l.owner, basis: 'ADR "Deciders" header' };
      fs('decisionOwner', { path: a.path, line: 6 }, 'ADR "Deciders" header');
      fs('requiredApproverRole', { path: a.path, line: 6 }, 'ADR "Deciders" header');
    }

    // priority from the requirements the ADR says it addresses
    rec.priority = highest(a.requirements, priority);
    if (rec.priority && a.sections.requirements) fs('priority', { path: a.path, line: a.sections.requirements.line }, 'highest priority among requirements in "## Requirements addressed"');

    // options
    const opts: OptionInfo[] = a.options.map((o) => ({
      key: o.key,
      name: o.name,
      summary: o.summary,
      disposition: o.disposition,
      recommended: !!o.disposition && /^(Selected|Chosen|Proposed)$/.test(o.disposition),
      tradeoffs: o.tradeoffs,
      pros: [],
      cons: [],
      conditional: [],
      unknown: [],
      mapping: null,
      src: { path: a.path, line: o.line },
    }));
    // comparison table from the design, tied to options by letter, or by position when unambiguous
    const design = myDesigns.find((d) => d.comparison);
    if (design?.comparison) {
      const cols = design.comparison.columns;
      const byLetter = cols.length > 0 && cols.every((c) => opts.some((o) => o.key === c));
      const byPosition = !byLetter && design.adrs.length === 1 && opts.length === cols.length && opts.length > 0;
      if (byLetter || byPosition) {
        const mapping = byLetter ? 'letter' : 'position';
        cols.forEach((col, i) => {
          const opt = byLetter ? opts.find((o) => o.key === col) : opts[i];
          if (opt) {
            opt.mapping = mapping;
            claimsFor(opt, { designId: design.id, src: { path: design.path, line: design.comparison!.line }, columns: cols, rows: design.comparison!.rows.map((r) => ({ criterion: r.criterion, cells: r.cells, line: r.line })), mapping }, col, design.path);
          }
        });
        rec.comparison = { designId: design.id, src: { path: design.path, line: design.comparison.line }, columns: cols, rows: design.comparison.rows.map((r) => ({ criterion: r.criterion, cells: r.cells, line: r.line })), mapping };
        fs('options', { path: design.path, line: design.comparison.line }, `pros, cons, conditions and unknowns from the design comparison table, columns tied to options by ${mapping}`);
      }
    }
    const rec0 = opts.filter((o) => o.recommended);
    if (rec0.length > 1) rec.flags.push({ code: 'multiple-recommended', text: `${rec0.length} options are marked selected or proposed; the first is shown as recommended.` });
    const recommended = rec0[0] ?? null;
    if (recommended) {
      for (const p of a.positive) recommended.pros.push({ text: p.text, src: { path: a.path, line: p.line }, basis: 'recorded', criterion: 'ADR Consequences (positive)' });
      for (const n of a.negative) recommended.cons.push({ text: n.text, src: { path: a.path, line: n.line }, basis: 'recorded', criterion: 'ADR Consequences (negative)' });
      fs('recommendedOption', recommended.src, 'option the ADR marks Selected, Chosen or Proposed');
    }
    rec.options = opts;
    rec.recommendedOption = recommended;
    if (opts.length && !rec.fieldSources.options) fs('options', { path: a.path, line: opts[0]!.src.line }, 'numbered list in ADR "## Options considered"');

    // implications: only where the ADR has a section for them
    const imp = (sec: SectionAt | null, rule: string): Implication | null => (sec ? { text: clip(sec.text, 1500), src: { path: a.path, line: sec.line, rule } } : null);
    rec.implications.cost = imp(a.sections.cost ?? null, 'ADR "## Cost and operational implications" (one section feeds both cost and operational)');
    rec.implications.operational = imp(a.sections.cost ?? null, 'ADR "## Cost and operational implications" (one section feeds both cost and operational)');
    rec.implications.security = imp(a.sections.security ?? null, 'ADR "## Security consequences"');
    rec.implications.reliability = imp(a.sections.reliability ?? null, 'ADR "## Reliability consequences"');
    rec.implications.dataSovereignty = imp(a.sections.residency ?? null, 'ADR "## Residency implications"');
    for (const [k, v] of Object.entries(rec.implications)) if (v) rec.fieldSources[`implications.${k}`] = v.src;

    // links
    rec.dependsOn = uniq([...l.refs.decisions, ...a.cites.filter((c) => c.startsWith('ADR-') && c !== l.id)]).filter((x) => x !== l.id);
    rec.relatedRisks = uniq(l.refs.risks);
    rec.relatedReviews = reviewIds;
    rec.supersedes = a.supersedes && !/^none/i.test(a.supersedes) ? uniq([...a.supersedes.matchAll(/(?:ADR[ -]?)?(\d{4})/g)].map((m) => `ADR-${m[1]}`)) : [];
    rec.relatedTasks = uniq(tasks.filter((t) => t.refs.adrs.includes(number)).map((t) => t.id));

    // blocking requirements: requirements the ADR addresses that still name an open clarification
    rec.blockingRequirements = a.requirements
      .map((id) => ({ id, row: traceRows.find((t) => t.id === id) }))
      .filter((x) => x.row && x.row.open.length > 0)
      .map((x) => ({ id: x.id, priority: priority.get(x.id) ?? null }));

    // approval history
    const m = /^(Accepted|Rejected|Superseded|Deferred)\s*\(([^)]*)\)/.exec(l.statusRaw);
    if (m) {
      const date = /\d{4}-\d\d-\d\d/.exec(m[2]!)?.[0] ?? null;
      const actor = m[2]!.replace(/\d{4}-\d\d-\d\d,?\s*/, '').trim() || null;
      rec.approvalHistory.push({ type: 'status-line', date, actor, text: clip(l.statusRaw, 400), signed: false, src: { path: a.path, line: 3 } });
    }
    for (const ap of approvals) {
      if (ap.subject?.type === 'adr' && ap.subject.id === number) rec.approvalHistory.push({ type: 'signed-approval', date: ap.createdAt, actor: null, text: `Approval record ${ap.id ?? ''}: ${ap.decision ?? 'decision not stated'}${ap.reason ? ` (${clip(ap.reason, 160)})` : ''}`, signed: true, src: { path: (ap as { path: string }).path, line: 1 } });
    }
    for (const f of todoFrags) for (const e of f.log) if (e.adrs.includes(number)) rec.approvalHistory.push({ type: 'owner-log', date: e.date, actor: null, text: clip(e.text, 300), signed: false, src: { path: f.path, line: e.line } });
    rec.approvalHistory.sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''));
    const signed = rec.approvalHistory.some((e) => e.signed);
    if (signed) rec.approvalBasis = 'signed';
    else if (l.status === 'accepted') rec.approvalBasis = l.flags.delegated ? 'delegated-unsigned' : /by instruction in chat/i.test(l.statusRaw) ? 'owner-instruction-unsigned' : 'none';
    if (rec.status === 'Approved' && rec.approvalBasis === 'none') rec.flags.push({ code: 'approved-by-text-only', text: 'The status line says Accepted but no signed approval record and no recorded owner instruction was found.' });
    if (rec.status === 'Approved' && rec.approvalBasis !== 'signed') rec.flags.push({ code: 'unsigned', text: 'Approved without a signed approval record.' });
    if (l.flags.partialScope) rec.flags.push({ code: 'partial-scope', text: 'Accepted with part of the scope excluded or deferred.' });

    // evidence
    const evidenceRefs: EvidenceRef[] = [];
    for (const id of uniq(a.evidenceIds)) {
      const ev = evidence.get(id);
      const ep = fragments.find((f) => f.kind === 'evidence' && (f.data as { id?: string }).id === id)?.path ?? null;
      evidenceRefs.push({ id, kind: 'test-run', claim: ev?.claim ?? null, exitCode: ev?.exitCode ?? null, resolved: !!ev, src: ep ? { path: ep, line: 1 } : null });
    }
    for (const id of uniq(a.otherEvidence)) {
      const r = reviewById.get(id);
      const d = designById.get(id);
      evidenceRefs.push({ id, kind: r ? 'design-review' : d ? 'design' : 'other', claim: null, exitCode: null, resolved: !!(r || d), src: r ? { path: r.path, line: r.line } : d ? { path: d.path, line: d.idLine } : null });
    }
    rec.evidence = evidenceRefs;

    // rubric: direct mentions, and mentions of the design or review the ADR belongs to
    const direct = [l.id, `ADR-${number}`];
    const viaIds = [...myDesigns.map((d) => d.id), ...reviewIds];
    rec.rubric = rubricRefs(rubric, direct, viaIds);
    records.push(rec);
  }

  // ---- register entries
  for (const d of registerRows) {
    const rec = base(d.id, 'register-entry', d.title, d.src.path, d.src.line, d.statusRaw);
    const fs = (field: string, rule: string) => {
      rec.fieldSources[field] = { path: d.src.path, line: d.src.line, rule };
    };
    rec.status = 'Pending Review';
    rec.statusRule = 'Register status is Open: an answer is awaited and no option is chosen';
    fs('status', rec.statusRule);
    for (const f of d.flags.review) rec.flags.push({ code: 'review', text: f });
    if (!/^open$/i.test(d.statusRaw)) rec.flags.push({ code: 'status-unrecognised', text: `Register status "${d.statusRaw}" is not recognised; shown as Pending Review.` });
    if (t2 && t2.status === 'deferred' && /register/i.test(t2.detail)) rec.flags.push({ code: 'owner-deferral', text: 'Owner task T2 records that answering the register was deferred. The status is not changed.' });
    if (d.whyItMatters) {
      rec.businessJustification = d.whyItMatters;
      fs('businessJustification', 'Register "Why it matters" column');
    }
    if (d.kind) {
      rec.category = d.kind.split('+').map((k) => REGISTER_KIND[k.trim()] ?? k.trim()).join('; ');
      fs('category', 'Register "Kind" column, expanded with the legend at the top of the register');
    }
    rec.milestone = d.milestone ?? null;
    if (d.milestone) rec.tags = [`Needed by ${d.milestone}`];
    rec.options = d.options.map((o, i) => ({ key: `#${i + 1}`, name: o, summary: null, disposition: null, recommended: false, tradeoffs: null, pros: [], cons: [], conditional: [], unknown: [], mapping: null, src: { path: d.src.path, line: d.src.line } }));
    if (rec.options.length) fs('options', 'Register "Known options (none chosen)" column, split on semicolons');
    if (d.owner) {
      rec.decisionOwner = d.owner;
      rec.requiredApproverRole = { text: d.owner, basis: 'Register "Owner role" column: the register says an entry becomes an ADR once decided by the named role' };
      fs('decisionOwner', 'Register "Owner role" column');
      fs('requiredApproverRole', 'Register "Owner role" column');
    }
    const traced = traceRows.filter((t) => [...t.decisions, ...t.open, ...t.verify].includes(d.id));
    rec.blockingRequirements = traced.map((t) => ({ id: t.id, priority: priority.get(t.id) ?? null })).sort((a, b) => a.id.localeCompare(b.id));
    rec.priority = highest(traced.map((t) => t.id), priority);
    if (rec.priority) fs('priority', 'requirements whose traceability row cites this decision');
    rec.dependsOn = d.refs.decisions;
    rec.relatedRisks = risks.filter((r) => r.decisions.includes(d.id)).map((r) => r.id);
    rec.relatedTasks = tasks.filter((t) => t.refs.decisions.includes(d.id)).map((t) => t.id);
    const citingDesigns = designs.filter((x) => x.cites.includes(d.id));
    rec.relatedReviews = uniq(citingDesigns.map((x) => x.review).filter((x): x is string => !!x));
    rec.rubric = rubricRefs(rubric, [d.id], []);
    records.push(rec);
  }

  // ---- reverse edges, citations, ADR relations
  const byId = new Map(records.map((r) => [r.id, r]));
  for (const r of records) for (const dep of r.dependsOn) byId.get(dep)?.dependedOnBy.push(r.id);
  for (const r of records) for (const s of r.supersedes) byId.get(s)?.supersededBy.push(r.id);
  for (const r of records) {
    r.dependedOnBy = uniq(r.dependedOnBy).sort();
    const citing = docCites.filter((c) => c.path !== r.source.path && c.cites.includes(r.id));
    r.citedBy = citing.map((c) => c.path).sort().slice(0, 40);
    r.relatedAdrs = uniq([...r.dependsOn.filter((x) => x.startsWith('ADR-')), ...r.dependedOnBy.filter((x) => x.startsWith('ADR-')), ...citing.map((c) => c.path).flatMap((p) => { const m = /^docs\/adr\/(\d{4})-/.exec(p); return m ? [`ADR-${m[1]}`] : []; }), ...(r.kind === 'register-entry' ? [] : [])]).filter((x) => x !== r.id).sort();
    r.relatedTasks = uniq(r.relatedTasks).sort();
    r.relatedRisks = uniq(r.relatedRisks).sort();
    // missing fields: listed, never filled
    const miss: string[] = [];
    if (!r.description) miss.push('description');
    if (!r.businessJustification) miss.push('businessJustification');
    if (!r.category) miss.push('category');
    if (!r.priority) miss.push('priority');
    if (!r.recommendedOption) miss.push('recommendedOption');
    if (!r.options.length) miss.push('options');
    for (const [k, v] of Object.entries(r.implications)) if (!v) miss.push(`implications.${k}`);
    if (!r.requiredApproverRole) miss.push('requiredApproverRole');
    if (!r.decisionOwner) miss.push('decisionOwner');
    if (!r.decisionDate) miss.push('decisionDate');
    if (!r.approvalHistory.length) miss.push('approvalHistory');
    if (!r.evidence.length) miss.push('evidence');
    if (!r.rubric.length) miss.push('rubric');
    r.missing = miss;
    const { contentHash: _drop, ...rest } = r;
    void _drop;
    r.contentHash = hashOf(rest);
  }
  records.sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id, 'en', { numeric: true }) : a.kind === 'adr' ? -1 : 1));
  if (!adrFrags.length) warnings.push('No ADR files were found at this commit.');
  if (!registerRows.length) warnings.push('No decision-register rows were found at this commit.');
  return { records, warnings };
}

function rubricRefs(mentions: { criterion: string; title: string; label: string; line: number; ids: string[]; path: string }[], direct: string[], via: string[]): RubricRef[] {
  const out: RubricRef[] = [];
  const seen = new Set<string>();
  for (const m of mentions) {
    const d = m.ids.some((i) => direct.includes(i));
    const v = !d && m.ids.some((i) => via.includes(i));
    if (!d && !v) continue;
    const key = `${m.criterion}:${m.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ criterion: m.criterion, title: m.title, via: d ? 'direct' : 'design', label: m.label, src: { path: m.path, line: m.line } });
  }
  return out;
}
