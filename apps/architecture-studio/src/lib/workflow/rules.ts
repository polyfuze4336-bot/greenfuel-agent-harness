// Who may act on a decision, and which actions a decision currently allows. Pure functions.
// Policy is data in harness/policy/decision-workflow.json. It is a control-plane file: changing who can approve is a
// reviewed repository change, never a Studio action. An empty or missing policy denies every decision action.
import type { NormStatus, NormalizedDecision } from '../intel/schema.ts';
import { ACTIONS, DECISION_ID, permittedIn, type ActionKind, type Actor, type OptionRef, type ReviewState, type RoleCheck } from './events.ts';

export const POLICY_PATH = 'harness/policy/decision-workflow.json';

export interface PolicyPerson {
  githubLogin: string;
  githubId: number;
  holder: string;
  roles: string[];
}

export interface Policy {
  people: PolicyPerson[];
  roleAliases: Record<string, string[]>;
  critical: { priorities: string[]; includeBlocked: boolean; requiredRoles: string[] };
  reopen: { requiredRoles: string[] };
  /** Rules for work items: who may approve or reject completion, and whether the submitter may not approve their own work. */
  work: { completionRoles: string[]; requireIndependentApproval: boolean };
  source: 'canonical' | 'local-head-not-canonical' | 'missing';
  problems: string[];
}

export function emptyPolicy(source: Policy['source'], problem?: string): Policy {
  return { people: [], roleAliases: {}, critical: { priorities: ['Must'], includeBlocked: true, requiredRoles: [] }, reopen: { requiredRoles: [] }, work: { completionRoles: [], requireIndependentApproval: true }, source, problems: problem ? [problem] : [] };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : []);

export function parsePolicy(text: string | undefined, source: Policy['source']): Policy {
  if (text === undefined) return emptyPolicy('missing', `${POLICY_PATH} does not exist, so nobody can decide.`);
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return emptyPolicy(source, `${POLICY_PATH} is not valid JSON, so nobody can decide.`);
  }
  const p = emptyPolicy(source);
  const aliases = (o.roleAliases && typeof o.roleAliases === 'object' ? o.roleAliases : {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(aliases)) p.roleAliases[k] = strings(v).map((s) => s.toLowerCase());
  const seen = new Set<string>();
  for (const raw of Array.isArray(o.people) ? o.people : []) {
    const r = raw as Record<string, unknown>;
    const login = typeof r.githubLogin === 'string' ? r.githubLogin.trim() : '';
    const roles = strings(r.roles);
    if (!login || !Number.isInteger(r.githubId) || (r.githubId as number) <= 0 || typeof r.holder !== 'string' || !r.holder.trim()) {
      p.problems.push(`A person entry needs githubLogin, a numeric githubId and a holder name: ${login || '(no login)'} was ignored.`);
      continue;
    }
    if (seen.has(login.toLowerCase())) {
      p.problems.push(`${login} appears twice; the second entry was ignored.`);
      continue;
    }
    const unknown = roles.filter((x) => !(x in p.roleAliases));
    if (unknown.length) p.problems.push(`${login} has role(s) with no alias entry (${unknown.join(', ')}); they were ignored.`);
    seen.add(login.toLowerCase());
    p.people.push({ githubLogin: login, githubId: r.githubId as number, holder: r.holder.trim(), roles: roles.filter((x) => x in p.roleAliases) });
  }
  const c = (o.critical ?? {}) as Record<string, unknown>;
  p.critical = { priorities: strings(c.priorities).length ? strings(c.priorities) : ['Must'], includeBlocked: c.includeBlocked !== false, requiredRoles: strings(c.requiredRoles).filter((r) => r in p.roleAliases) };
  p.reopen = { requiredRoles: strings((o.reopen as Record<string, unknown> | undefined)?.requiredRoles).filter((r) => r in p.roleAliases) };
  const w = (o.work ?? {}) as Record<string, unknown>;
  const completion = strings(w.completionRoles).filter((r) => r in p.roleAliases);
  p.work = { completionRoles: completion.length ? completion : p.critical.requiredRoles, requireIndependentApproval: w.requireIndependentCompletionApproval !== false };
  if (!p.people.length) p.problems.push('No approver is configured, so nobody can decide.');
  return p;
}

/** Roles held by a verified GitHub account. Both the login and the numeric id must match, so a renamed or recycled login gets nothing. */
export function rolesHeld(actor: Pick<Actor, 'login' | 'githubId'>, policy: Policy): string[] {
  const p = policy.people.find((x) => x.githubLogin.toLowerCase() === actor.login.toLowerCase());
  return p && p.githubId === actor.githubId ? p.roles : [];
}

export function isListed(actor: Pick<Actor, 'login' | 'githubId'>, policy: Policy): boolean {
  return policy.people.some((x) => x.githubLogin.toLowerCase() === actor.login.toLowerCase() && x.githubId === actor.githubId);
}

/** Roles that the decision's own "required approver role" text names, matched through the policy's aliases. */
export function rolesNamed(text: string | undefined | null, policy: Policy): string[] {
  const t = (text ?? '').toLowerCase();
  return Object.entries(policy.roleAliases)
    .filter(([, al]) => al.some((a) => t.includes(a)))
    .map(([k]) => k);
}

/** The status the repository's own source states, ignoring any merged review record. Quality gates read this one. */
export const sourceStatusOf = (d: NormalizedDecision): NormStatus => d.review?.sourceStatus ?? d.status;
export const sourceRuleOf = (d: NormalizedDecision): string => d.review?.sourceStatusRule ?? d.statusRule;

export function isCritical(d: NormalizedDecision, policy: Policy): boolean {
  if (d.priority && policy.critical.priorities.includes(d.priority.value)) return true;
  return policy.critical.includeBlocked && sourceStatusOf(d) === 'Blocked';
}

export interface Authorisation {
  ok: boolean;
  code?: 'no-policy' | 'not-listed' | 'missing-role';
  reason?: string;
  roleCheck: RoleCheck;
}

export function authorise(actor: Pick<Actor, 'login' | 'githubId'>, action: ActionKind, d: NormalizedDecision, policy: Policy): Authorisation {
  const policySource = policy.source === 'canonical' ? 'canonical' : 'local-head-not-canonical';
  const held = rolesHeld(actor, policy);
  const named = rolesNamed(d.requiredApproverRole?.text, policy);
  const critical = isCritical(d, policy);
  const base: RoleCheck = { critical, required: [], held, namedRoles: named, outstanding: named.filter((r) => !held.includes(r)), policySource };
  if (action === 'comment') {
    // Anyone verified may comment; the comment still reaches the repository only through a reviewed pull request.
    return { ok: true, roleCheck: base };
  }
  if (!policy.people.length) return { ok: false, code: 'no-policy', reason: 'No approver is configured in the decision workflow policy, so nobody can decide.', roleCheck: base };
  if (!isListed(actor, policy)) return { ok: false, code: 'not-listed', reason: `${actor.login} is not a registered approver in ${POLICY_PATH}.`, roleCheck: base };
  const override = policy.critical.requiredRoles;
  const required = action === 'reopen' ? [...new Set([...policy.reopen.requiredRoles, ...override])] : critical ? override : [...new Set([...named, ...override])];
  const roleCheck = { ...base, required };
  if (!required.length) return { ok: false, code: 'no-policy', reason: 'The policy names no role that may take this action, so it is denied.', roleCheck };
  if (!required.some((r) => held.includes(r))) {
    return { ok: false, code: 'missing-role', reason: `${actor.login} does not hold a role this action needs (${required.join(' or ')}).`, roleCheck };
  }
  return { ok: true, roleCheck };
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
    if (action === 'comment') return { action, allowed: true, reason: null };
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
}

export interface Cleaned {
  option: OptionRef | null;
  rationale: string | null;
  comment: string | null;
  conditions: string[];
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
  return { ok: true, value: { option, rationale: rationale || null, comment: comment || null, conditions } };
}

export const isDecisionId = (s: string) => DECISION_ID.test(s);
