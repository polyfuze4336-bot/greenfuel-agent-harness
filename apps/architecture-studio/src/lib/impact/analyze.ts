import { reviewLane, type NormalizedDecision, type Suggestion } from '../intel/schema.ts';
import { buildGraph, dependentsOf } from '../queue/graph.ts';
import type { Edge, WorkItem, WorkKind } from '../queue/types.ts';
import type { Doc, DesignReview, QaItem, Requirement, Risk, Task } from '../repo/types.ts';
import type { BlockingDependency, FollowUp, ImpactAction, ImpactItem, ImpactKind, ImpactResult, SuggestedRelationship, UnresolvedReference } from './types.ts';

// Builds the impact of a decision from explicit repository references only. Pure: it takes the records the Studio has already read,
// so it can be tested on small hand-made worlds. Nothing here calls a model, and nothing here changes a status.

export interface ImpactInput {
  commit: string;
  records: NormalizedDecision[];
  requirements: Requirement[];
  risks: Risk[];
  tasks: Task[];
  reviews: DesignReview[];
  docs: Doc[];
  qa: QaItem[];
  suggestions: Suggestion[];
  /** The Work Queue's items and the dependencies its sources state. Optional: without it, tasks come from their own citations only. */
  queue?: { items: WorkItem[]; edges: Edge[]; refNodes: { id: string; title: string }[]; unresolved: { from: string; ref: string; src: { path: string; line: number } | null }[] } | null;
}

const UNRESOLVED = new Set(['Proposed', 'Pending Review', 'Blocked', 'Deferred']);
const AFTER: Record<ImpactAction, string> = { approve: 'Approved', reject: 'Rejected', defer: 'Deferred', revise: 'Pending Review' };

/** Where a document that cites a decision belongs, by where it lives. It classifies a citation; it never creates one. */
export function classifyDocument(path: string): ImpactKind | 'adr' {
  const p = path;
  const file = p.split('/').pop() ?? p;
  if (/^docs\/adr\//.test(p)) return 'adr';
  if (/^docs\/capstone\/presentation\//.test(p)) return 'slide';
  if (/^docs\/security\//.test(p)) return 'security';
  if (/SOVEREIGN|RESIDENCY/i.test(file)) return 'sovereignty';
  if (/DATA-CLASSIFICATION|DATA-FLOW|^docs\/design\/data\//i.test(p)) return 'data-flow';
  if (/^docs\/azure\//.test(p) || /^infra\//.test(p) || /^docs\/runbooks\//.test(p) || /DEPLOYMENT/i.test(file)) return 'infrastructure';
  if (/COST|PRICING|BUDGET/i.test(file)) return 'cost';
  if (/^docs\/(evaluation|evidence)\//.test(p) || /TEST|VALIDATION|COVERAGE/i.test(file)) return 'test';
  if (/^docs\/(architecture\/(designs|reviews)|target-architecture)\//.test(p)) return 'component';
  return 'document';
}

const WORK_TO_IMPACT: Partial<Record<WorkKind, ImpactKind>> = { task: 'task', roadmap: 'task', backlog: 'task', gap: 'task', security: 'security', validation: 'test', risk: 'risk', 'design-gate': 'review', 'requirement-gap': 'requirement', decision: 'decision' };

const kindOfRequirement = (id: string): ImpactKind => (id.startsWith('SEC-') ? 'security' : id.startsWith('DATA-') ? 'data-flow' : 'requirement');

const clip = (s: string, n = 150) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Decision dependency cycles, as concrete paths. A cycle is reported, never followed. */
export function findCycles(records: Pick<NormalizedDecision, 'id' | 'dependsOn'>[]): string[][] {
  const ids = new Set(records.map((r) => r.id));
  const next = new Map(records.map((r) => [r.id, r.dependsOn.filter((d) => ids.has(d))]));
  const out = new Map<string, string[]>();
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (n: string) => {
    state.set(n, 1);
    stack.push(n);
    for (const m of next.get(n) ?? []) {
      if (state.get(m) === 1) {
        const cyc = stack.slice(stack.indexOf(m));
        const key = [...cyc].sort().join('|');
        if (!out.has(key)) out.set(key, [...cyc, m]);
      } else if (!state.get(m)) visit(m);
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const r of records) if (!state.get(r.id)) visit(r.id);
  return [...out.values()];
}

export function analyzeImpact(input: ImpactInput, id: string, action: ImpactAction): ImpactResult | null {
  const byId = new Map(input.records.map((r) => [r.id, r]));
  const d = byId.get(id);
  if (!d) return null;
  const reqs = new Map(input.requirements.map((r) => [r.id, r]));
  const risks = new Map(input.risks.map((r) => [r.id, r]));
  const tasks = new Map(input.tasks.map((t) => [t.id, t]));
  const reviews = new Map(input.reviews.map((r) => [r.id, r]));
  const docs = new Map(input.docs.map((x) => [x.path, x]));
  const src = d.source;

  const direct = new Map<string, ImpactItem>();
  const potential = new Map<string, ImpactItem>();
  const add = (m: Map<string, ImpactItem>, it: ImpactItem) => {
    const key = `${it.kind}:${it.id}`;
    if (!m.has(key)) m.set(key, it);
  };
  const D = (it: Omit<ImpactItem, 'tier' | 'via'>) => add(direct, { ...it, tier: 'direct', via: null });

  // ---- decisions: what this one rests on, and what rests on it, as the records state it
  for (const x of d.dependedOnBy) {
    const r = byId.get(x);
    if (r) D({ id: r.id, kind: 'decision', title: r.title, relation: 'cites this decision as something it depends on', src: { path: r.source.path, line: r.source.line }, status: r.status });
  }
  for (const x of d.supersededBy) {
    const r = byId.get(x);
    if (r) D({ id: r.id, kind: 'decision', title: r.title, relation: 'says it supersedes this decision', src: { path: r.source.path, line: r.source.line }, status: r.status });
  }
  for (const x of d.relatedAdrs) {
    const r = byId.get(x);
    if (r && !d.dependsOn.includes(x)) D({ id: r.id, kind: 'decision', title: r.title, relation: 'is related to this decision in a record that cites both', src: { path: r.source.path, line: r.source.line }, status: r.status });
  }

  // ---- requirements: traceability rows and the ADR's own "Requirements addressed"
  for (const rr of d.relatedRequirements) {
    const q = reqs.get(rr.id);
    const rel = rr.relation === 'blocked-until-decided' ? 'cannot be fully accepted until this is decided (traceability row)' : rr.relation === 'addressed-by-this-adr' ? 'is addressed by this ADR' : 'names this decision in its traceability row';
    D({ id: rr.id, kind: kindOfRequirement(rr.id), title: q?.title ?? rr.id, relation: rel, src: q?.src ?? null, status: rr.priority });
  }

  // ---- risks, tasks, design reviews, tests
  for (const rid of d.relatedRisks) {
    const r = risks.get(rid);
    if (r) D({ id: r.id, kind: 'risk', title: r.title, relation: 'risk register cites this decision', src: r.src, status: r.status });
  }
  for (const tid of d.relatedTasks) {
    const t = tasks.get(tid);
    if (t) D({ id: t.id, kind: 'task', title: t.title, relation: 'task cites this decision', src: t.src, status: t.status });
  }
  for (const rv of d.relatedReviews) {
    const r = reviews.get(rv);
    if (r) D({ id: r.id, kind: 'review', title: r.title, relation: r.blockingDecisions.includes(id) ? 'design review gate is blocked by this decision' : 'design review cites this decision', src: r.src, status: r.declared });
  }
  for (const e of d.evidence) if (e.kind === 'test-run') D({ id: e.id, kind: 'test', title: e.claim ?? e.id, relation: 'evidence record this decision cites', src: e.src, status: e.exitCode === null ? 'no result recorded' : e.exitCode === 0 ? 'passed' : `exit ${e.exitCode}` });

  // ---- documents that cite it, placed by where they live
  for (const p of d.citedBy) {
    const k = classifyDocument(p);
    if (k === 'adr') continue; // an ADR that cites this decision is already a decision above
    D({ id: p, kind: k, title: docs.get(p)?.title ?? p.split('/').pop() ?? p, relation: 'cites this decision', src: { path: p, line: 1 }, status: docs.get(p)?.authority ?? null });
  }
  for (const q of input.qa) {
    if (new RegExp(`\\b${id.replace(/[-]/g, '\\-')}\\b`).test(`${q.question} ${q.uncertain}`)) D({ id: q.id, kind: 'slide', title: clip(q.question), relation: 'a panel Q&A item names this decision', src: q.src, status: null });
  }

  // ---- what this decision itself states about cost, security, sovereignty and operations
  const stated: [keyof NormalizedDecision['implications'], ImpactKind, string][] = [['cost', 'cost', 'Cost'], ['security', 'security', 'Security'], ['dataSovereignty', 'sovereignty', 'Sovereignty'], ['operational', 'infrastructure', 'Operational'], ['reliability', 'infrastructure', 'Reliability']];
  for (const [f, kind, label] of stated) {
    const v = d.implications[f];
    if (v) D({ id: `${f}:${id}`, kind, title: `${label} implication stated in this decision: ${clip(v.text, 120)}`, relation: 'stated by this decision', src: { path: v.src.path, line: v.src.line }, status: null });
  }

  // ---- the work queue: what its sources say requires or mentions this decision
  const blocking: BlockingDependency[] = [];
  if (input.queue) {
    const g = buildGraph(input.queue.items, input.queue.edges, input.queue.refNodes);
    const items = new Map(input.queue.items.map((i) => [i.id, i]));
    for (const dep of dependentsOf(g, id)) {
      const it = items.get(dep.id);
      const kind = it ? WORK_TO_IMPACT[it.kind] : undefined;
      if (!it || !kind || it.id === id) continue;
      const base = { id: it.id, kind, title: it.title, src: it.source, status: it.status };
      if (dep.depth <= 1) {
        D({ ...base, relation: dep.type === 'requires' ? 'work that requires this decision (a source says so)' : 'work that mentions this decision' });
      } else {
        add(potential, { ...base, relation: 'requires work that requires this decision', tier: 'potential', via: dep.via[0] ?? null });
      }
      if (dep.type === 'requires' && !['Done', 'Rejected', 'Superseded'].includes(it.status)) blocking.push({ id: it.id, title: it.title, status: it.status, direction: 'waits-for-this', src: it.source });
    }
  }

  // ---- potentially affected: what depends on the decisions that depend on this one
  const seen = new Set<string>([id]);
  let frontier = [id];
  for (let depth = 1; depth <= 3 && frontier.length; depth++) {
    const nextFrontier: string[] = [];
    for (const f of frontier) {
      for (const x of byId.get(f)?.dependedOnBy ?? []) {
        if (seen.has(x)) continue; // also what stops a dependency cycle
        seen.add(x);
        nextFrontier.push(x);
        const r = byId.get(x);
        if (!r) continue;
        if (depth > 1) add(potential, { id: r.id, kind: 'decision', title: r.title, relation: `rests on ${f}, which rests on this decision`, src: { path: r.source.path, line: r.source.line }, status: r.status, tier: 'potential', via: f });
        for (const rr of r.relatedRequirements) if (!direct.has(`${kindOfRequirement(rr.id)}:${rr.id}`)) add(potential, { id: rr.id, kind: kindOfRequirement(rr.id), title: reqs.get(rr.id)?.title ?? rr.id, relation: `tied to ${r.id}, which rests on this decision`, src: reqs.get(rr.id)?.src ?? null, status: rr.priority, tier: 'potential', via: r.id });
        for (const t of r.relatedTasks) { const tk = tasks.get(t); if (tk && !direct.has(`task:${t}`)) add(potential, { id: tk.id, kind: 'task', title: tk.title, relation: `cites ${r.id}, which rests on this decision`, src: tk.src, status: tk.status, tier: 'potential', via: r.id }); }
        for (const rk of r.relatedRisks) { const k = risks.get(rk); if (k && !direct.has(`risk:${rk}`)) add(potential, { id: k.id, kind: 'risk', title: k.title, relation: `cites ${r.id}, which rests on this decision`, src: k.src, status: k.status, tier: 'potential', via: r.id }); }
        for (const rv of r.relatedReviews) { const v = reviews.get(rv); if (v && !direct.has(`review:${rv}`)) add(potential, { id: v.id, kind: 'review', title: v.title, relation: `covers ${r.id}, which rests on this decision`, src: v.src, status: v.declared, tier: 'potential', via: r.id }); }
      }
    }
    frontier = nextFrontier;
  }
  for (const k of [...potential.keys()]) if (direct.has(k)) potential.delete(k);

  // ---- blocking: what this decision rests on that is not settled, and what is waiting for it
  for (const dep of d.dependsOn) {
    const r = byId.get(dep);
    if (r && UNRESOLVED.has(r.status)) blocking.push({ id: r.id, title: r.title, status: r.status, direction: 'rests-on', src: { path: r.source.path, line: r.source.line } });
  }
  for (const rr of d.relatedRequirements.filter((x) => x.relation === 'blocked-until-decided')) {
    const q = reqs.get(rr.id);
    blocking.push({ id: rr.id, title: q?.title ?? rr.id, status: 'waiting for this decision', direction: 'waits-for-this', src: q?.src ?? null });
  }
  for (const rv of d.relatedReviews) {
    const r = reviews.get(rv);
    if (r?.blockingDecisions.includes(id)) blocking.push({ id: r.id, title: r.title, status: r.declared, direction: 'waits-for-this', src: r.src });
  }

  // ---- references that point at nothing, and dependency cycles
  const unresolved: UnresolvedReference[] = d.invalidReferences.map((r) => ({ id: r.id, kind: r.kind, via: r.via, src: r.src }));
  for (const u of input.queue?.unresolved ?? []) if (u.from === id) unresolved.push({ id: u.ref, kind: 'work item reference', via: 'a work item that cites this decision', src: u.src });
  const cycles = findCycles(input.records).filter((c) => c.includes(id));

  // ---- AI-suggested relationships, kept apart and unverified until a record says so
  const explicit = new Set([...direct.values(), ...potential.values()].map((x) => x.id).concat(d.dependsOn, d.dependedOnBy, d.supersedes, d.supersededBy));
  const unverified: SuggestedRelationship[] = input.suggestions
    .filter((s) => s.kind === 'relationship' && s.targetId && (s.decisionId === id || s.targetId === id))
    .map((s) => ({ id: s.id, targetId: s.decisionId === id ? s.targetId! : s.decisionId, direction: (s.decisionId === id ? 'from-this' : 'to-this') as 'from-this' | 'to-this', relation: s.text, rationale: s.rationale, generatedBy: { tool: s.generatedBy.tool, date: s.generatedBy.date }, src: s.src, nowExplicit: explicit.has(s.decisionId === id ? s.targetId! : s.decisionId) }));

  // ---- follow-up work and rework, by what the action does
  const directList = [...direct.values()];
  const dependents = directList.filter((x) => x.kind === 'decision' && byId.get(x.id)?.dependsOn.includes(id));
  const followUp: FollowUp[] = [];
  const fu = (text: string, because: string, s: { path: string; line: number } | null = null) => followUp.push({ text, because, src: s });
  const restsOn = blocking.filter((b) => b.direction === 'rests-on');
  const waiting = blocking.filter((b) => b.direction === 'waits-for-this');
  const lane = reviewLane(d.natures);
  const reqsBlocked = d.relatedRequirements.filter((x) => x.relation === 'blocked-until-decided');

  if (action === 'approve') {
    if (d.approvalBasis !== 'signed') fu('Record a signed approval for it (ADR 0008). A Studio review record, or an instruction in chat, is a recorded decision and not a signature.', 'No signed approval record names this decision', { path: 'docs/adr/0008-least-privilege-permission-model.md', line: 1 });
    if (restsOn.length) fu(`Settle or consciously accept the ${restsOn.length} decision(s) it rests on first: ${restsOn.slice(0, 6).map((x) => x.id).join(', ')}${restsOn.length > 6 ? ', …' : ''}. Approving it does not settle them.`, 'Its dependencies are not Approved', src);
    for (const q of reqsBlocked.slice(0, 8)) fu(`${q.id} no longer waits for this decision: update its traceability row and check its acceptance criteria.`, 'A traceability row names it as open', reqs.get(q.id)?.src ?? null);
    for (const x of dependents) {
      const r = byId.get(x.id)!;
      const left = r.dependsOn.filter((y) => y !== id && byId.get(y) && UNRESOLVED.has(byId.get(y)!.status));
      fu(left.length === 0 ? `${r.id} would have no unresolved dependency left, so it can be reviewed on its merits.` : `${r.id} still rests on ${left.length} other unresolved decision(s): ${left.slice(0, 5).join(', ')}.`, `${r.id} cites this decision`, { path: r.source.path, line: r.source.line });
    }
    for (const w of waiting.filter((x) => x.id !== undefined && !reqsBlocked.some((q) => q.id === x.id)).slice(0, 8)) fu(`${w.id} (${w.status}) was waiting for this decision and can be taken up.`, 'A source says it requires this decision', w.src);
  } else if (action === 'reject') {
    fu('Choose what replaces it, and record that as a new decision or a superseding ADR. A rejection ends an option; it does not make the need go away.', 'Items below still depend on the need this decision answers', src);
    for (const x of dependents.slice(0, 10)) fu(`Reconsider ${x.id}${x.status === 'Approved' ? ' (already Approved: it was approved on the strength of this decision)' : ''}: it cites this decision as something it depends on.`, `${x.id} cites this decision`, x.src);
    for (const q of d.relatedRequirements.slice(0, 8)) fu(`${q.id} needs another route: it was tied to this decision.`, 'Traceability row names it', reqs.get(q.id)?.src ?? null);
    for (const w of waiting.slice(0, 8)) fu(`${w.id} (${w.status}) requires this decision and cannot proceed as planned.`, 'A source says it requires this decision', w.src);
  } else if (action === 'defer') {
    fu('Record who will revisit it and what would settle it. Work that waits for it stays blocked until then.', 'Items below wait for it', src);
    for (const w of waiting.slice(0, 10)) fu(`${w.id} (${w.status}) stays blocked.`, 'A source says it requires this decision', w.src);
    for (const x of dependents.slice(0, 8)) fu(`${x.id} stays unresolved while it is deferred.`, `${x.id} cites this decision`, x.src);
  } else {
    fu('Re-review what already relied on its current text: decisions that cite it, and any approval given on that basis.', 'Other records cite this decision', src);
    for (const x of dependents.filter((y) => y.status === 'Approved').slice(0, 8)) fu(`${x.id} is Approved and cites this decision: check that its approval still holds if this one changes.`, `${x.id} cites this decision`, x.src);
    for (const e of directList.filter((y) => y.kind === 'test').slice(0, 5)) fu(`Re-run or re-read evidence ${e.id}: it was recorded against the current text.`, 'This decision cites the evidence record', e.src);
  }
  if (lane !== 'architecture') {
    fu(lane === 'stakeholder' ? 'This is a stakeholder clarification. Its effect comes from recording the business fact in the repository, by the named role; the Studio does not approve it.' : lane === 'verification' ? 'This is a regulatory or certification claim. Its effect comes from a qualified person verifying it and recording the evidence; the Studio does not approve it.' : 'The register states no kind for this entry, so what resolves it is not known.', 'Its register Kind', src);
  }
  if (unresolved.length) fu(`Correct ${unresolved.length} reference(s) that point at nothing (${unresolved.slice(0, 4).map((u) => u.id).join(', ')}).`, 'A cited id does not exist at this commit', src);
  if (cycles.length) fu(`Break the dependency cycle: ${cycles[0]!.join(' → ')}.`, 'Records cite each other in a circle', src);

  const REWORK_KINDS: ImpactKind[] = ['decision', 'component', 'slide', 'document', 'infrastructure', 'security', 'sovereignty', 'data-flow', 'test', 'cost'];
  const rework = action === 'reject' || action === 'revise' ? directList.filter((x) => REWORK_KINDS.includes(x.kind) && x.relation !== 'stated by this decision') : [];

  const byKind: ImpactResult['byKind'] = {};
  for (const it of [...directList, ...potential.values()]) {
    const k = (byKind[it.kind] ??= { direct: 0, potential: 0 });
    k[it.tier]++;
  }
  const potentialList = [...potential.values()];
  const costImp = d.implications.cost;
  const statusAfter = action === 'revise' && d.status === 'Pending Review' ? null : AFTER[action];
  const notes: string[] = [];
  if (!d.dependedOnBy.length && !directList.length) notes.push('No repository record cites this decision, so no downstream item is listed. That does not prove nothing depends on it.');
  if (cycles.length) notes.push(`This decision is part of ${cycles.length} dependency cycle(s). They are reported and not followed.`);
  if (input.queue === null || input.queue === undefined) notes.push('The work queue was not available, so tasks are those that cite the decision themselves.');

  return {
    decisionId: id,
    title: d.title,
    action,
    commit: input.commit,
    statusNow: d.status,
    statusAfter,
    statusNote: lane === 'architecture' ? 'The Studio changes nothing: a review record merged through GitHub does.' : 'This kind of record is not approved in the Studio. The analysis shows what depends on it, whoever resolves it and however.',
    summary: { direct: directList.length, potential: potentialList.length, blocking: blocking.length, followUp: followUp.length, rework: rework.length, unresolved: unresolved.length, unverified: unverified.filter((u) => !u.nowExplicit).length },
    byKind,
    direct: directList,
    potential: potentialList,
    blocking,
    followUp,
    rework,
    unresolved,
    cycles,
    unverified,
    estimate: {
      counts: `${directList.length} item(s) name this decision and ${potentialList.length} more are reached through decisions that depend on it, across ${Object.keys(byKind).length} categories.`,
      effort: null,
      cost: costImp ? { text: clip(costImp.text, 400), src: { path: costImp.src.path, line: costImp.src.line } } : null,
      note: 'No source in the repository sizes this work, so no effort, duration or cost is estimated. Counts are of the records listed, not a measure of work.',
    },
    notes,
  };
}
