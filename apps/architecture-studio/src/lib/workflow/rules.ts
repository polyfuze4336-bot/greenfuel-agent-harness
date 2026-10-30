// Which actions a decision currently offers, and what a request must contain. Pure functions.
// WHO may take an action is decided in auth/authorize.ts, from the access policy (harness/policy/access-policy.json). This file
// only says what the decision's own state allows, whatever the person's role: a decision already approved cannot be approved
// again, a blocked one cannot be approved, and so on.
import type { NormStatus, NormalizedDecision } from '../intel/schema.ts';
import { ACCESS_POLICY_PATH, emptyAccessPolicy, parseAccessPolicy, rolesNamed, type AccessPolicy } from '../auth/access-policy.ts';
import { ACTIONS, DECISION_ID, permittedIn, type ActionKind, type OptionRef, type ReviewState } from './events.ts';

export const POLICY_PATH = ACCESS_POLICY_PATH;
export type Policy = AccessPolicy;
export const emptyPolicy = emptyAccessPolicy;
export const parsePolicy = parseAccessPolicy;
export { rolesNamed };

/** The status the repository's own source states, ignoring any merged review record. Quality gates read this one. */
export const sourceStatusOf = (d: NormalizedDecision): NormStatus => d.review?.sourceStatus ?? d.status;
export const sourceRuleOf = (d: NormalizedDecision): string => d.review?.sourceStatusRule ?? d.statusRule;

export function isCritical(d: NormalizedDecision, policy: Pick<AccessPolicy, 'critical'>): boolean {
  if (d.priority && policy.critical.priorities.includes(d.priority.value)) return true;
  return policy.critical.includeBlocked && sourceStatusOf(d) === 'Blocked';
}
// ---- which actions a decision offers

export interface ActionAvailability {
  action: ActionKind;
  allowed: boolean;
  reason: string | null;
}

export function availability(d: NormalizedDecision, s: ReviewState): ActionAvailability[] {
  const srcStatus = sourceStatusOf(d);
  const effective = s.effectiveStatus ?? d.status;
  const phaseOk = permittedIn(s.phase);
  const hasRec = !!d.recommendedOption;
  const alts = hasRec ? d.options.filter((o) => !o.recommended) : d.options;
  return ACTIONS.map((action): ActionAvailability => {
    const no = (reason: string): ActionAvailability => ({ action, allowed: false, reason });
    if (s.problems.length) return no('The review record for this decision is inconsistent on the canonical branch. Fix it in the repository first.');
    if (!phaseOk.includes(action)) {
      return no(action === 'reopen' || action === 'comment' ? 'Not allowed in this state.' : `Already ${s.phase === 'rejected' ? 'rejected' : 'approved'} in the review record. It cannot be overwritten; reopen it first.`);
    }
    if (action === 'comment' || action === 'recommend') return { action, allowed: true, reason: null };
    if (srcStatus === 'Superseded' && s.phase === 'none') return no('This decision is Superseded. Review the decision that supersedes it.');
    if (action === 'reopen') {
      return effective === 'Approved' || effective === 'Rejected' ? { action, allowed: true, reason: null } : no('Only an Approved or Rejected decision can be reopened.');
    }
    // From here on the action decides the decision.
    if (s.phase === 'none' && srcStatus === 'Approved') return no('The source already records this decision as Approved. It cannot be overwritten; reopen it first.');
    if (s.phase === 'none' && srcStatus === 'Rejected') return no('The source already records this decision as Rejected. Reopen it first.');
    const approves = action === 'approve' || action === 'approve-alternative' || action === 'approve-with-conditions';
    if (approves && srcStatus === 'Blocked') return no(`Approval is refused while the decision is Blocked (${sourceRuleOf(d)}). Reject, defer, request revision or comment instead.`);
    if (approves && d.options.length === 0) return no('No option is recorded for this decision, so there is nothing to approve. Request a revision.');
    if (action === 'approve' && !hasRec) return no('The source recommends no option. Use "Select and approve an alternative" to choose one explicitly.');
    if (action === 'approve-alternative' && alts.length === 0) return no('There is no alternative option to select.');
    return { action, allowed: true, reason: null };
  });
}

// ---- request validation

export interface ActionRequest {
  action: ActionKind;
  expectedRevision: string;
  idempotencyKey: string;
  optionKey?: string | null;
  rationale?: string | null;
  conditions?: string[] | null;
  comment?: string | null;
  /** For a recommendation: approve, reject or revise. */
  recommendation?: string | null;
}

export interface Cleaned {
  option: OptionRef | null;
  rationale: string | null;
  comment: string | null;
  conditions: string[];
  recommendation: string | null;
}

// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (s: unknown, max: number): string => (typeof s === 'string' ? s.replace(CTRL, '').trim().slice(0, max) : '');
const MIN_REASON = 10;

export function validateRequest(req: Partial<ActionRequest>, d: NormalizedDecision): { ok: true; value: Cleaned } | { ok: false; message: string } {
  if (!req.action || !ACTIONS.includes(req.action)) return { ok: false, message: 'Unknown action.' };
  if (!req.expectedRevision || typeof req.expectedRevision !== 'string') return { ok: false, message: 'expectedRevision is required, so a stale review can be detected.' };
  if (!req.idempotencyKey || !/^[A-Za-z0-9-]{8,80}$/.test(req.idempotencyKey)) return { ok: false, message: 'idempotencyKey must be 8 to 80 letters, digits or dashes.' };
  const a = req.action;
  const rationale = clean(req.rationale, 4000);
  const comment = clean(req.comment, 4000);
  const needsReason = a === 'reject' || a === 'defer' || a === 'request-revision' || a === 'reopen' || a === 'approve-alternative';
  if (needsReason && rationale.length < MIN_REASON) {
    const what = a === 'reject' ? 'Rejecting' : a === 'defer' ? 'Deferring' : a === 'request-revision' ? 'Requesting a revision' : a === 'reopen' ? 'Reopening' : 'Selecting an alternative';
    return { ok: false, message: `${what} needs a written rationale of at least ${MIN_REASON} characters.` };
  }
  if (a === 'comment' && !comment) return { ok: false, message: 'A comment cannot be empty.' };
  let recommendation: string | null = null;
  if (a === 'recommend') {
    recommendation = typeof req.recommendation === 'string' ? req.recommendation : '';
    if (!['approve', 'reject', 'revise'].includes(recommendation)) return { ok: false, message: 'A recommendation must be approve, reject or revise.' };
    if (rationale.length < MIN_REASON) return { ok: false, message: `A recommendation needs a written rationale of at least ${MIN_REASON} characters.` };
  }
  let conditions: string[] = [];
  if (a === 'approve-with-conditions') {
    conditions = (Array.isArray(req.conditions) ? req.conditions : []).map((c) => clean(c, 500)).filter(Boolean);
    if (!conditions.length) return { ok: false, message: 'Approval with conditions needs at least one condition.' };
    if (conditions.length > 10) return { ok: false, message: 'At most 10 conditions.' };
  }
  let option: OptionRef | null = null;
  if (a === 'approve') option = d.recommendedOption ? { key: d.recommendedOption.key, name: d.recommendedOption.name, recommended: true } : null;
  if (a === 'approve-alternative' || a === 'approve-with-conditions') {
    const key = clean(req.optionKey, 40);
    const chosen = key ? d.options.find((o) => o.key === key) : a === 'approve-with-conditions' ? d.recommendedOption : undefined;
    if (!chosen) return { ok: false, message: key ? `Option "${key}" is not an option of this decision.` : 'Choose the option to approve.' };
    if (a === 'approve-alternative' && d.recommendedOption && chosen.key === d.recommendedOption.key) return { ok: false, message: 'That is the recommended option. Use "Approve the recommended option".' };
    option = { key: chosen.key, name: chosen.name, recommended: !!d.recommendedOption && chosen.key === d.recommendedOption.key };
  }
  return { ok: true, value: { option, rationale: rationale || null, comment: comment || null, conditions, recommendation } };
}

export const isDecisionId = (s: string) => DECISION_ID.test(s);
