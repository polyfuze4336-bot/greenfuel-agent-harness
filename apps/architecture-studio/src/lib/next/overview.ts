import type { NormalizedDecision } from '../intel/schema.ts';
import type { AreaReadiness } from '../baseline/readiness.ts';
import type { WorkItem } from '../queue/types.ts';
import { isClosed } from '../queue/views.ts';
import { pickNext } from './rank.ts';
import { POINTS, type NextAction } from './types.ts';

// The Overview as data: what to do next, what stands in the way of the next implementation phase, and how far along the real records
// say things are. Progress is counts of records, never a percentage of "maturity", and never a score. Pure.

export interface ListItem {
  key: string;
  title: string;
  detail: string;
  href: string;
  /** A short fact shown at the right: a date, a priority, a status. */
  meta: string | null;
  /** The ranked action behind this row, with the rules that placed it. Null for a row that is not an action (a decision approved earlier). */
  action: NextAction | null;
}

export interface Section {
  count: number;
  items: ListItem[];
}

export interface Fraction {
  label: string;
  done: number;
  total: number;
  /** Where the numerator and denominator come from. */
  basis: string;
}

export interface MandatoryDecision {
  id: string;
  title: string;
  state: string;
  gates: string[];
  href: string;
}

export interface OverviewModel {
  commit: string;
  next: NextAction | null;
  then: NextAction[];
  waitingOnOthers: NextAction[];
  readiness: {
    available: boolean;
    stageTitle: string | null;
    ready: boolean;
    /** Mandatory decisions for the next phase that are not approved. */
    blockingDecisions: MandatoryDecision[];
    /** Gates and measures that are not decisions. */
    otherBlockers: { code: string; text: string }[];
    /** Decisions that exist but the next phase does not need. Not required, and said so. */
    optionalOpen: number;
  };
  progress: Fraction[];
  awaiting: Section & { byLane: { architecture: number; stakeholder: number; verification: number; unclassified: number } };
  blockers: Section;
  tasks: Section;
  recentlyApproved: Section;
  rework: Section;
}

export interface OverviewInput {
  commit: string;
  actions: NextAction[];
  decisions: NormalizedDecision[];
  items: WorkItem[];
  /** The area for the next implementation phase, from the baseline readiness. Null when the policy has none. */
  area: AreaReadiness | null;
  /** Areas for later stages. */
  laterAreas: AreaReadiness[];
}

const TOP = 3;
const OPEN = new Set(['Proposed', 'Pending Review', 'Blocked']);
const toItem = (a: NextAction, meta: string | null = null): ListItem => ({ key: a.key, title: a.title, detail: a.detail, href: a.href, meta, action: a });

/** The newest date any record gives for this decision's approval. ISO or date-only strings both sort as text. */
export function approvedOn(d: NormalizedDecision): string | null {
  const dates = d.approvalHistory.map((h) => h.date).filter((x): x is string => !!x && /^\d{4}-\d\d-\d\d/.test(x));
  return dates.length ? dates.sort().reverse()[0]! : null;
}

export function buildOverview(i: OverviewInput): OverviewModel {
  const byDecision = new Map(i.decisions.map((d) => [d.id, d]));
  const mineOrUnknown = i.actions.filter((a) => a.mine !== false);
  const next = pickNext(i.actions);
  const then = mineOrUnknown.filter((a) => a.key !== next?.key).slice(0, 4);
  const waitingOnOthers = i.actions.filter((a) => a.mine === false).slice(0, 4);

  const decisionKinds = new Set(['review-decision', 'answer-clarification', 'verify-claim']);
  const awaitingAll = mineOrUnknown.filter((a) => decisionKinds.has(a.kind));
  const byLane = { architecture: 0, stakeholder: 0, verification: 0, unclassified: 0 };
  for (const a of awaitingAll) byLane[a.kind === 'review-decision' ? (a.venue === 'repository' ? 'unclassified' : 'architecture') : a.kind === 'answer-clarification' ? 'stakeholder' : 'verification']++;

  const blockersAll = i.actions.filter((a) => a.blocksNextPhase);
  // A task needs attention when it blocks the next phase, or is critical or High priority by its own source. Everything else is in the queue.
  const tasksAll = i.actions.filter((a) => a.kind === 'work-item' && a.venue === 'repository' && (a.blocksNextPhase || a.reasons.filter((r) => r.rule === 'criticality').reduce((n, r) => n + r.points, 0) >= (POINTS.taskPriority.High ?? 12)));
  const reworkAll = i.actions.filter((a) => a.kind === 'rework-rejected');

  const approved = i.decisions
    .filter((d) => d.status === 'Approved')
    .map((d) => ({ d, on: approvedOn(d) }))
    .filter((x): x is { d: NormalizedDecision; on: string } => x.on !== null)
    .sort((a, b) => b.on.localeCompare(a.on) || a.d.id.localeCompare(b.d.id, undefined, { numeric: true }));

  const area = i.area;
  const mandatory = area?.requiredDecisions ?? [];
  const blockingDecisions: MandatoryDecision[] = mandatory
    .filter((r) => !r.approved)
    .map((r) => ({ id: r.id, title: r.title, state: r.state, gates: r.requiredBy, href: byDecision.get(r.id) ? `/decisions/${encodeURIComponent(r.id)}/review` : `/decisions?id=${encodeURIComponent(r.id)}` }));
  const decisionBlockerCodes = new Set(['missing', 'review', 'pending', 'rejected', 'deferred', 'superseded', 'unresolved-required-decisions', 'rejected-required', 'deferred-required']);
  const otherBlockers = (area?.blockers ?? []).filter((b) => !decisionBlockerCodes.has(b.code)).map((b) => ({ code: b.code, text: b.text }));
  const requiredIds = new Set([...mandatory.map((r) => r.id), ...i.laterAreas.flatMap((a) => a.requiredDecisions.map((r) => r.id))]);
  const optionalOpen = i.decisions.filter((d) => OPEN.has(d.status) && !requiredIds.has(d.id)).length;

  const itemById = new Map(i.items.map((x) => [x.id, x]));
  const progress: Fraction[] = [];
  if (area) {
    progress.push({ label: 'Mandatory decisions approved', done: mandatory.filter((r) => r.approved).length, total: mandatory.length, basis: `Decisions the gates of ${area.stageTitle || area.title} name, approved under the baseline policy` });
    progress.push({ label: 'Gates satisfied', done: area.gates.filter((g) => g.satisfied).length, total: area.gates.length, basis: 'Gates of the next implementation phase in the baseline policy' });
    if (area.requiredReviews.length) progress.push({ label: 'Design reviews approved', done: area.requiredReviews.filter((r) => r.satisfied).length, total: area.requiredReviews.length, basis: 'Design reviews those gates require' });
    const chain = area.closureItems.map((id) => itemById.get(id)).filter((x): x is WorkItem => !!x);
    if (chain.length) progress.push({ label: 'Tasks the phase needs, done with evidence', done: chain.filter((x) => x.status === 'Done').length, total: chain.length, basis: 'Work the gates require, followed through the queue’s "requires" links' });
  }
  const later = i.laterAreas.flatMap((a) => a.requiredDecisions);
  const laterUnique = [...new Map(later.map((r) => [r.id, r])).values()].filter((r) => !mandatory.some((m) => m.id === r.id));
  if (laterUnique.length) progress.push({ label: 'Later-phase decisions approved', done: laterUnique.filter((r) => r.approved).length, total: laterUnique.length, basis: 'Decisions only the production stages need. Not required for the next phase' });
  const open = i.items.filter((x) => x.class !== 'evidence-gap' && x.kind !== 'decision');
  if (open.length) progress.push({ label: 'Queue tasks closed with evidence', done: open.filter((x) => x.status === 'Done').length, total: open.filter((x) => !isClosed(x.status) || x.status === 'Done').length, basis: 'Every task, risk, gap and design gate in the work queue that is open or done' });

  return {
    commit: i.commit,
    next,
    then,
    waitingOnOthers,
    readiness: { available: !!area, stageTitle: area ? area.stageTitle || area.title : null, ready: !!area?.ready && blockingDecisions.length === 0 && otherBlockers.length === 0, blockingDecisions, otherBlockers, optionalOpen },
    progress,
    awaiting: { count: awaitingAll.length, items: awaitingAll.slice(0, TOP).map((a) => toItem(a)), byLane },
    blockers: { count: blockersAll.length, items: blockersAll.slice(0, TOP).map((a) => toItem(a)) },
    tasks: { count: tasksAll.length, items: tasksAll.slice(0, TOP).map((a) => toItem(a)) },
    recentlyApproved: { count: approved.length, items: approved.slice(0, TOP).map((x) => ({ key: `approved:${x.d.id}`, title: x.d.id, detail: x.d.title, href: `/decisions?id=${encodeURIComponent(x.d.id)}`, meta: x.on.slice(0, 10), action: null })) },
    rework: { count: reworkAll.length, items: reworkAll.slice(0, TOP).map((a) => toItem(a)) },
  };
}
