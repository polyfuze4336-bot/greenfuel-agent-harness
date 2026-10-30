// Which view a work item belongs to. One definition, used by the server for counts and by the browser for filtering.
import type { WorkItem, WorkKind, WorkStatus } from './types.ts';

export const VIEWS = ['all', 'mine', 'approvals', 'blocked', 'critical', 'gaps', 'completed', 'rejected', 'evidence'] as const;
export type View = (typeof VIEWS)[number];

export const VIEW_LABEL: Record<View, string> = {
  all: 'All tasks',
  mine: 'My tasks',
  approvals: 'Pending approvals',
  blocked: 'Blocked',
  critical: 'Critical risks',
  gaps: 'Architecture gaps',
  completed: 'Completed',
  rejected: 'Rejected or cancelled',
  evidence: 'Evidence gaps (rubric)',
};

export const VIEW_RULE: Record<View, string> = {
  all: 'Every work item except rubric evidence gaps, which are kept in their own view.',
  mine: 'Items assigned to you by a merged assignment, and unassigned open items whose owner text names a role you hold.',
  approvals: 'Open items waiting for someone to approve them: undecided decisions, design reviews that are not approved, and work submitted for completion review.',
  blocked: 'Items marked Blocked by their source or by a merged record, and items blocked because they require a critical decision that is deferred.',
  critical: 'Open risks (impact High), security findings (high severity, not fully fixed), gaps (severity Critical), design gates that compute Blocked, and build blockers.',
  gaps: 'Capstone gaps, requirement gaps, residency validation procedures that have not been run, and design review gates.',
  completed: 'Done means completion evidence exists. "Closed, no evidence" means a source says closed but no valid evidence is linked.',
  rejected: 'Rejected (including a request the owner did not grant), and superseded decisions.',
  evidence: 'Rubric criteria whose evidence is less than complete, from the rubric traceability. Separate from engineering work.',
};

export const CLOSED: WorkStatus[] = ['Done', 'Closed, no evidence', 'Rejected', 'Superseded'];
export const isClosed = (s: WorkStatus) => CLOSED.includes(s);

const GAP_KINDS: WorkKind[] = ['gap', 'requirement-gap', 'validation', 'design-gate'];
const CRITICAL_KINDS: WorkKind[] = ['risk', 'security', 'gap', 'design-gate', 'build-blocker'];

export interface Me {
  login: string;
  roles: string[];
}

export type MineReason = 'assigned' | 'role';

export function mineReason(i: WorkItem, me: Me | null): MineReason | null {
  if (!me) return null;
  if (i.assignee && i.assignee.toLowerCase() === me.login.toLowerCase()) return 'assigned';
  if (!i.assignee && !isClosed(i.status) && i.class !== 'evidence-gap' && i.ownerRoles.some((r) => me.roles.includes(r))) return 'role';
  return null;
}

export function inView(i: WorkItem, view: View, me: Me | null = null): boolean {
  switch (view) {
    case 'all':
      return i.class !== 'evidence-gap';
    case 'mine':
      return mineReason(i, me) !== null;
    case 'approvals':
      return i.approval !== null && !isClosed(i.status);
    case 'blocked':
      return (i.status === 'Blocked' || i.derivedBlocks.length > 0) && !isClosed(i.status);
    case 'critical':
      return i.critical && !isClosed(i.status) && CRITICAL_KINDS.includes(i.kind);
    case 'gaps':
      return GAP_KINDS.includes(i.kind) && i.class !== 'evidence-gap' && !isClosed(i.status);
    case 'completed':
      return i.status === 'Done' || i.status === 'Closed, no evidence';
    case 'rejected':
      return i.status === 'Rejected' || i.status === 'Superseded';
    case 'evidence':
      return i.class === 'evidence-gap';
  }
}

export function countViews(items: WorkItem[], me: Me | null = null): Record<View, number> {
  const out = Object.fromEntries(VIEWS.map((v) => [v, 0])) as Record<View, number>;
  for (const i of items) for (const v of VIEWS) if (inView(i, v, me)) out[v]++;
  return out;
}
