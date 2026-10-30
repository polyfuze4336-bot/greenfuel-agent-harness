// Who may act on a work item, when each action is offered, and what a request must contain. Pure functions.
import type { Actor, RoleCheck } from './events.ts';
import { isListed, rolesHeld, type Policy } from './rules.ts';
import { PRIORITIES, type WorkItem } from '../queue/types.ts';
import { WORK_ACTIONS, WORK_ID, workPermittedIn, type WorkAction, type WorkState } from './work-events.ts';

export interface WorkAuthorisation {
  ok: boolean;
  code?: 'no-policy' | 'not-listed' | 'missing-role' | 'self-approval';
  reason?: string;
  roleCheck: RoleCheck;
}

const MIN_REASON = 10;

export function authoriseWork(actor: Pick<Actor, 'login' | 'githubId'>, action: WorkAction, state: WorkState, policy: Policy): WorkAuthorisation {
  const policySource = policy.source === 'canonical' ? 'canonical' : 'local-head-not-canonical';
  const held = rolesHeld(actor, policy);
  const completion = action === 'approve-completion' || action === 'reject-completion';
  const base: RoleCheck = { critical: false, required: completion ? policy.work.completionRoles : [], held, namedRoles: [], outstanding: [], policySource };
  // Anyone verified may comment; it still reaches the repository only through a reviewed pull request.
  if (action === 'comment') return { ok: true, roleCheck: base };
  if (!policy.people.length) return { ok: false, code: 'no-policy', reason: 'No approver is configured in the decision workflow policy, so nobody can act on work items.', roleCheck: base };
  if (!isListed(actor, policy)) return { ok: false, code: 'not-listed', reason: `${actor.login} is not a registered person in the policy.`, roleCheck: base };
  if (completion) {
    if (!policy.work.completionRoles.length) return { ok: false, code: 'no-policy', reason: 'The policy names no role that may approve or reject completion, so it is denied.', roleCheck: base };
    if (!policy.work.completionRoles.some((r) => held.includes(r))) return { ok: false, code: 'missing-role', reason: `${actor.login} does not hold a role that may ${action === 'approve-completion' ? 'approve' : 'reject'} completion (${policy.work.completionRoles.join(' or ')}).`, roleCheck: base };
    if (policy.work.requireIndependentApproval && state.submittedBy && state.submittedBy.toLowerCase() === actor.login.toLowerCase()) {
      return { ok: false, code: 'self-approval', reason: `${actor.login} submitted this work for review and the policy requires a different person to approve or reject it.`, roleCheck: base };
    }
  }
  return { ok: true, roleCheck: base };
}

export interface WorkAvailability {
  action: WorkAction;
  allowed: boolean;
  reason: string | null;
}

const NO_COMPLETION: WorkItem['kind'][] = ['decision', 'design-gate', 'build-blocker'];

export function workAvailability(item: WorkItem, s: WorkState): WorkAvailability[] {
  const permitted = workPermittedIn(s.phase);
  return WORK_ACTIONS.map((action): WorkAvailability => {
    const no = (reason: string): WorkAvailability => ({ action, allowed: false, reason });
    if (s.problems.length) return no('The work-item record on the canonical branch is inconsistent. Fix it in the repository first.');
    if (!permitted.includes(action)) {
      return no(
        s.phase === 'completed' ? 'Completed work cannot be changed silently. Reopen it first.' : s.phase === 'in-review' ? 'Waiting for a completion decision: approve or reject it first.' : s.phase === 'blocked' || s.phase === 'clarification' ? 'Clear the block or clarification first.' : 'Not allowed in this state.',
      );
    }
    if (action === 'comment') return { action, allowed: true, reason: null };
    const closed = item.status === 'Done' || item.status === 'Rejected' || item.status === 'Superseded';
    if (s.phase === 'none' && item.status === 'Superseded') return no('Superseded work only accepts comments.');
    if (s.phase === 'none' && closed && action !== 'reopen') return no(`Already ${item.status.toLowerCase()} in the repository. Reopen it first.`);
    if (action === 'reopen') {
      if (NO_COMPLETION.includes(item.kind)) return no(item.kind === 'decision' ? 'Decisions are reopened through the decision review workflow.' : 'This item is derived from repository facts; it clears when the fact changes.');
      return s.phase === 'completed' || (s.phase === 'none' && (closed || item.status === 'Closed, no evidence')) ? { action, allowed: true, reason: null } : no('Only completed, closed or rejected work can be reopened.');
    }
    if ((action === 'submit-for-review' || action === 'approve-completion' || action === 'reject-completion') && NO_COMPLETION.includes(item.kind)) {
      return no(item.kind === 'decision' ? 'A decision is decided through the decision review workflow.' : 'This item is derived from repository facts; it clears when the fact changes.');
    }
    return { action, allowed: true, reason: null };
  });
}

export interface WorkRequest {
  action: WorkAction;
  expectedRevision: string;
  idempotencyKey: string;
  assignee?: string | null;
  priority?: string | null;
  dueDate?: string | null;
  rationale?: string | null;
  comment?: string | null;
  evidence?: string[] | null;
  blockedBy?: string[] | null;
}

export interface CleanWork {
  assignee: string | null;
  priority: WorkItem['priority'];
  dueDate: string | null;
  rationale: string | null;
  comment: string | null;
  evidence: string[];
  blockedBy: string[];
}

// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(CTRL, '').trim().slice(0, max) : '');
const EVIDENCE_REF = /^(?:EV-\d{4}|(?:docs|tests|harness|evaluation|memory|infra|src)\/[A-Za-z0-9._/@-]{1,200})$/;

export function validateWorkRequest(req: Partial<WorkRequest>): { ok: true; value: CleanWork } | { ok: false; message: string } {
  if (!req.action || !WORK_ACTIONS.includes(req.action)) return { ok: false, message: 'Unknown action.' };
  if (!req.expectedRevision || typeof req.expectedRevision !== 'string') return { ok: false, message: 'expectedRevision is required, so a stale view can be detected.' };
  if (!req.idempotencyKey || !/^[A-Za-z0-9-]{8,80}$/.test(req.idempotencyKey)) return { ok: false, message: 'idempotencyKey must be 8 to 80 letters, digits or dashes.' };
  const a = req.action;
  const rationale = clean(req.rationale, 4000);
  const comment = clean(req.comment, 4000);
  const needs = ['prioritize', 'mark-blocked', 'unblock', 'request-clarification', 'reject-completion', 'reopen'] as WorkAction[];
  if (needs.includes(a) && rationale.length < MIN_REASON) return { ok: false, message: `This action needs a written reason of at least ${MIN_REASON} characters.` };
  if (a === 'comment' && !comment) return { ok: false, message: 'A comment cannot be empty.' };
  let assignee: string | null = null;
  let dueDate: string | null = null;
  if (a === 'assign') {
    assignee = clean(req.assignee, 60) || null;
    if (!assignee) return { ok: false, message: 'Choose who to assign this to.' };
    const d = clean(req.dueDate, 10);
    if (d) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`)) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) return { ok: false, message: 'A due date must be a real date written YYYY-MM-DD. Leave it empty if none is agreed.' };
      dueDate = d;
    }
  }
  let priority: WorkItem['priority'] = null;
  if (a === 'prioritize') {
    const p = clean(req.priority, 20);
    if (!(PRIORITIES as readonly string[]).includes(p)) return { ok: false, message: `Priority must be one of ${PRIORITIES.join(', ')}.` };
    priority = p as WorkItem['priority'];
  }
  let evidence: string[] = [];
  if (a === 'submit-for-review') {
    evidence = [...new Set((Array.isArray(req.evidence) ? req.evidence : []).map((e) => clean(e, 240)).filter(Boolean))];
    if (!evidence.length) return { ok: false, message: 'Submitting for review needs completion evidence: at least one evidence record (EV-nnnn) or repository file.' };
    if (evidence.length > 10) return { ok: false, message: 'At most 10 evidence references.' };
    const bad = evidence.find((e) => !EVIDENCE_REF.test(e) || e.includes('..'));
    if (bad) return { ok: false, message: `"${bad.slice(0, 60)}" is not an evidence record id (EV-nnnn) or a repository path.` };
  }
  const blockedBy = a === 'mark-blocked' ? [...new Set((Array.isArray(req.blockedBy) ? req.blockedBy : []).map((x) => clean(x, 20)).filter(Boolean))].slice(0, 10) : [];
  if (blockedBy.some((x) => !WORK_ID.test(x))) return { ok: false, message: 'A blocking item must be a work item id.' };
  return { ok: true, value: { assignee, priority, dueDate, rationale: rationale || null, comment: comment || null, evidence, blockedBy } };
}
