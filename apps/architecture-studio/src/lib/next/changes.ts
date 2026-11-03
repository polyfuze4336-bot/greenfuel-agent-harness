import type { NormalizedDecision } from '../intel/schema.ts';
import type { Impact } from '../baseline/state.ts';
import type { WorkItem } from '../queue/types.ts';
import { isClosed } from '../queue/views.ts';

// What moved, as data: the history of decisions, what has changed since a baseline, and the work a change touches. Pure.

export interface HistoryRow {
  at: string;
  decisionId: string;
  title: string;
  /** What the record says, as written. */
  text: string;
  actor: string | null;
  /** Where the record comes from: a review record merged on GitHub, a signed approval, the decision's own status line, the owner log. */
  source: 'review record' | 'signed approval' | 'status line' | 'owner log';
  signed: boolean;
  href: string;
  /** Other dated records this decision has, not shown: its status line and its owner log usually say the same thing. */
  more: number;
}

// When a decision has several records on the same day, the one that carries the most weight is shown.
const WEIGHT: Record<HistoryRow['source'], number> = { 'review record': 3, 'signed approval': 3, 'status line': 2, 'owner log': 1 };
const SOURCE: Record<string, HistoryRow['source']> = { 'review-event': 'review record', 'signed-approval': 'signed approval', 'status-line': 'status line', 'owner-log': 'owner log' };

/** The latest recorded decisions across the register, newest first. Only records that carry a date are shown, so nothing is placed in time by a guess. */
export function decisionHistory(decisions: NormalizedDecision[], limit = 12): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const d of decisions) {
    const own: HistoryRow[] = [];
    for (const h of d.approvalHistory) {
      if (!h.date || !/^\d{4}-\d\d-\d\d/.test(h.date)) continue;
      own.push({ at: h.date, decisionId: d.id, title: d.title, text: h.text, actor: h.actor, source: SOURCE[h.type] ?? 'status line', signed: h.signed, href: `/decisions?id=${encodeURIComponent(d.id)}`, more: 0 });
    }
    // One row per decision: its newest record, and a count of the others.
    own.sort((a, b) => b.at.localeCompare(a.at) || WEIGHT[b.source] - WEIGHT[a.source]);
    if (own[0]) rows.push({ ...own[0], more: own.length - 1 });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at) || a.decisionId.localeCompare(b.decisionId, undefined, { numeric: true })).slice(0, limit);
}

export interface AffectedTask {
  id: string;
  title: string;
  status: string;
  /** Hard: the work cannot proceed (a deferred decision it needs). Advisory: look at it again (a rejected decision or a changed requirement). */
  kind: 'blocked' | 'review';
  why: string;
  by: string;
  href: string;
}

/** Open work that a decision or requirement change touches, from the queue's own derived blocks and review flags. Closed work is not shown. */
export function affectedTasks(items: WorkItem[]): AffectedTask[] {
  const out: AffectedTask[] = [];
  for (const i of items) {
    if (isClosed(i.status) || i.kind === 'decision') continue;
    for (const b of i.derivedBlocks) out.push({ id: i.id, title: i.title, status: i.status, kind: 'blocked', why: b.reason, by: b.by, href: `/queue?id=${encodeURIComponent(i.id)}` });
    for (const r of i.reviewNeeded) out.push({ id: i.id, title: i.title, status: i.status, kind: 'review', why: r.reason, by: r.by, href: `/queue?id=${encodeURIComponent(i.id)}` });
  }
  return out.sort((a, b) => Number(b.kind === 'blocked') - Number(a.kind === 'blocked') || a.id.localeCompare(b.id, undefined, { numeric: true }));
}

export interface BaselineChange {
  baseline: string;
  severity: Impact['severity'];
  text: string;
  subject: string;
  /** The authorized reopening that covers it. None means nobody authorized the change. */
  controlledBy: string | null;
}

/** What has changed since each authorized baseline, invalidating ones first. */
export function baselineChanges(baselines: { id: string; status: string; impacts: Impact[] }[]): BaselineChange[] {
  const out: BaselineChange[] = [];
  for (const b of baselines) {
    if (b.status !== 'approved') continue;
    for (const i of b.impacts) out.push({ baseline: b.id, severity: i.severity, text: i.text, subject: i.subject, controlledBy: i.controlledBy });
  }
  return out.sort((a, b) => Number(b.severity === 'invalidates') - Number(a.severity === 'invalidates') || a.baseline.localeCompare(b.baseline) || a.subject.localeCompare(b.subject, undefined, { numeric: true }));
}
