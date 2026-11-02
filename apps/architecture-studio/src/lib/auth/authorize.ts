// Authorization. One place decides whether a person may take an action, and it is always the server that asks, never the page.
// A button that the browser hides or shows is a convenience; this module is the control.
//
// A person may approve only if ALL of these hold, and each is checked separately so the refusal can say which failed:
//   - their identity is verified and the identity provider assigns them a role (or, in development, they are enrolled);
//   - they are ENROLLED, with an active enrollment, for any role that can approve or administer;
//   - their role carries the approval permission for the record's DOMAIN (architecture, security, deployment);
//   - the record is a domain the Studio can approve at all (regulatory and unclassified records are not);
//   - they are DESIGNATED as an approver for that record;
//   - their sign-in is recent enough and, for Entra, used multi-factor;
//   - segregation of duties holds: they did not propose the revision they are approving, and a required independent
//     recommendation exists.
import type { AccessPolicy, Classification, SubjectKey } from './access-policy.ts';
import { classify, designatedOwners, enrolledRoles, findPerson, rolesNamed, subjectKeyOf, type Classifiable } from './access-policy.ts';
import { APPROVAL_CLASS, GRANTING, PRIVILEGED_ROLES, permissionForDecisionAction, permissionForWorkAction, permissionsOf, type DecisionAction, type Domain, type Permission, type Role, type WorkActionName } from './model.ts';

/** A verified human, however they signed in. Built by an identity provider; never by the browser. */
export interface Principal {
  provider: 'entra' | 'github';
  /** github: the numeric id. entra: `<tenant id>:<object id>`. */
  subject: string;
  tenantId: string | null;
  /** A display handle: the GitHub login, or the Entra user principal name. Not an identity. */
  login: string;
  name: string | null;
  /** The GitHub numeric id, when the provider is GitHub. */
  id: number | null;
  type: string;
  verifiedBy: 'github-api' | 'test-fixture' | 'entra-oidc';
  entraRoles: string[];
  entraGroups: string[];
  /** The identity provider said a second factor was used. */
  mfa: boolean;
  /** When the person last authenticated interactively, in epoch milliseconds. */
  authAt: number;
}

export const keyOf = (p: Pick<Principal, 'provider' | 'subject'>): SubjectKey => subjectKeyOf(p);

export interface AuthContext {
  policy: AccessPolicy;
  now: number;
  /** Development only: allow approvals by GitHub-CLI sign-in. Ignored unless the policy lists github among approval providers or this is set. */
  devApprovals: boolean;
  /** People an administrator has suspended with immediate effect. They hold no role at all. */
  suspended?: Set<string>;
}

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export type AuthCode =
  | 'policy-invalid'
  | 'no-access'
  | 'missing-permission'
  | 'domain-not-approvable'
  | 'not-designated'
  | 'provider-not-allowed'
  | 'reauth-required'
  | 'mfa-required'
  | 'sod-proposer'
  | 'sod-recommendation'
  | 'sod-submitter'
  | 'not-enrolled';

export interface Authz {
  ok: boolean;
  code?: AuthCode;
  reason?: string;
  /** 401 when signing in again would help, otherwise 403. */
  status: 200 | 401 | 403;
  domain: Domain | null;
  classification: Classification | null;
  roles: Role[];
  permission: Permission | 'none-in-studio' | null;
  checks: Check[];
  policyHash: string;
  /** Approval-class: this action settles or changes a status. */
  approvalClass: boolean;
}

/** The roles a person holds right now. Revocation and enrollment dates are applied here, on every request, never cached in a session. */
export function effectiveRoles(p: Principal, ctx: AuthContext): { roles: Role[]; notes: string[] } {
  const { policy, now } = ctx;
  const notes: string[] = [];
  if (policy.pinMismatch || policy.source === 'missing') return { roles: [], notes: ['The access policy is not trusted.'] };
  if (ctx.suspended?.has(keyOf(p))) return { roles: [], notes: ['Suspended by an administrator.'] };
  const enrolled = enrolledRoles(findPerson(policy, keyOf(p)), now);
  const person = findPerson(policy, keyOf(p));
  if (person && enrolled.length === 0) notes.push(person.revokedAt !== null && person.revokedAt <= now ? 'Enrollment revoked.' : 'Enrollment not yet active.');
  let roles: Role[];
  if (p.provider === 'entra') {
    if (!policy.authentication.tenantId || p.tenantId?.toLowerCase() !== policy.authentication.tenantId) return { roles: [], notes: ['The sign-in is not from the configured tenant.'] };
    const assigned = new Set<Role>();
    for (const r of p.entraRoles) if (policy.authentication.entraRoleMap[r]) assigned.add(policy.authentication.entraRoleMap[r]!);
    for (const g of p.entraGroups) if (policy.authentication.entraGroupMap[g.toLowerCase()]) assigned.add(policy.authentication.entraGroupMap[g.toLowerCase()]!);
    // Privileged roles need the identity provider AND the enrollment. Either alone is not enough.
    roles = [...assigned].filter((r) => !PRIVILEGED_ROLES.includes(r) || enrolled.includes(r));
    for (const r of assigned) if (PRIVILEGED_ROLES.includes(r) && !enrolled.includes(r)) notes.push(`The identity provider assigns ${r} but there is no active enrollment for it.`);
    for (const r of enrolled) if (PRIVILEGED_ROLES.includes(r) && !assigned.has(r)) notes.push(`Enrolled as ${r} but the identity provider no longer assigns it.`);
  } else {
    // Development sign-in through GitHub: roles come from the enrollment alone, and anyone else may only read.
    roles = enrolled.length ? [...enrolled] : ['viewer'];
  }
  if (roles.length && !roles.includes('viewer')) roles.push('viewer');
  return { roles: [...new Set(roles)], notes };
}

function base(ctx: AuthContext, over: Partial<Authz>): Authz {
  return { ok: false, status: 403, domain: null, classification: null, roles: [], permission: null, checks: [], policyHash: ctx.policy.hash, approvalClass: false, ...over };
}

function stepUp(p: Principal, ctx: AuthContext): { code: AuthCode; reason: string; check: Check[] } | null {
  const maxAge = ctx.policy.session.approvalMaxAuthAgeMinutes * 60_000;
  const age = ctx.now - p.authAt;
  const fresh = age <= maxAge;
  const mfaNeeded = p.provider === 'entra' && ctx.policy.session.requireMfaForApproval;
  const checks: Check[] = [{ name: 'recent sign-in', pass: fresh, detail: `${Math.max(0, Math.round(age / 1000))}s ago, at most ${Math.round(maxAge / 1000)}s allowed for approvals` }];
  if (mfaNeeded) checks.push({ name: 'multi-factor sign-in', pass: p.mfa, detail: p.mfa ? 'the identity provider reported a second factor' : 'no second factor was reported' });
  if (!fresh) return { code: 'reauth-required', reason: 'Approving needs a recent sign-in. Sign in again to approve.', check: checks };
  if (mfaNeeded && !p.mfa) return { code: 'mfa-required', reason: 'Approving needs a sign-in that used multi-factor authentication.', check: checks };
  return null;
}

function providerAllowed(p: Principal, ctx: AuthContext): boolean {
  if (ctx.policy.authentication.approvalProviders.includes(p.provider)) return true;
  // The one development allowance: a GitHub-CLI sign-in may approve only when the operator explicitly turned it on.
  return p.provider === 'github' && ctx.devApprovals;
}

/** Everything an approval-class action needs beyond holding the permission. */
function approvalGate(p: Principal, ctx: AuthContext, domain: Domain, rec: Classifiable, checks: Check[], granting: boolean, sod: { proposers: SubjectKey[]; recommenders: { subject: SubjectKey; recommendation: string | null }[]; submitter: SubjectKey | null }): { code: AuthCode; reason: string } | null {
  const me = keyOf(p);
  const allowedProvider = providerAllowed(p, ctx);
  checks.push({ name: 'approval provider', pass: allowedProvider, detail: allowedProvider ? `${p.provider} sign-ins may approve` : `${p.provider} sign-ins cannot approve under this policy` });
  if (!allowedProvider) return { code: 'provider-not-allowed', reason: `Approvals made through a ${p.provider} sign-in are not accepted by this policy.` };

  const owners = designatedOwners(ctx.policy, domain, rec);
  const designated = owners.includes(me);
  checks.push({ name: 'designated approver', pass: designated, detail: designated ? `designated for ${domain} on ${rec.id}` : owners.length ? `${rec.id} is designated to other people` : `nobody is designated for ${domain} on ${rec.id}` });
  if (!designated) return { code: 'not-designated', reason: `You are not designated to approve ${domain} decisions like ${rec.id}. Ownership is set in the access policy.` };

  const su = stepUp(p, ctx);
  if (su) {
    checks.push(...su.check);
    return { code: su.code, reason: su.reason };
  }
  checks.push({ name: 'recent sign-in', pass: true, detail: 'within the approval window' });

  if (ctx.policy.segregation.enforce) {
    if (sod.submitter) {
      const same = sod.submitter === me;
      checks.push({ name: 'not the submitter', pass: !same, detail: same ? 'you submitted this for review' : 'someone else submitted it' });
      if (same) return { code: 'sod-submitter', reason: 'You submitted this work for review, so a different person must approve or reject it.' };
    }
    {
      const same = sod.proposers.includes(me);
      checks.push({ name: 'not the proposer', pass: !same, detail: same ? 'you proposed this revision or authored the record' : 'you did not propose it' });
      if (same) return { code: 'sod-proposer', reason: 'You proposed this revision or authored this record, so a different person must approve it.' };
    }
    if (granting && ctx.policy.segregation.requireIndependentRecommendation) {
      const ok = sod.recommenders.some((r) => r.subject !== me && r.recommendation !== 'reject');
      checks.push({ name: 'independent recommendation', pass: ok, detail: ok ? 'an architect other than you recommended it' : 'no recommendation from another person' });
      if (!ok) return { code: 'sod-recommendation', reason: 'This policy needs a recommendation from another person before an approval.' };
    }
  }
  return null;
}

export interface DecisionRequest {
  principal: Principal;
  action: DecisionAction;
  rec: Classifiable;
  proposers: SubjectKey[];
  recommenders: { subject: SubjectKey; recommendation: string | null }[];
}

export function authorizeDecision(r: DecisionRequest, ctx: AuthContext): Authz {
  const { principal: p, action, rec } = r;
  const { roles } = effectiveRoles(p, ctx);
  const cls = classify(ctx.policy, rec);
  const permission = permissionForDecisionAction(action, cls.domain);
  const approvalClass = APPROVAL_CLASS.includes(action);
  const checks: Check[] = [];
  const fail = (code: AuthCode, reason: string, status: 401 | 403 = 403) => base(ctx, { code, reason, status, domain: cls.domain, classification: cls, roles, permission, checks, approvalClass });

  if (ctx.policy.pinMismatch || ctx.policy.source === 'missing') return fail('policy-invalid', ctx.policy.problems[0] ?? 'The access policy is not trusted.');
  checks.push({ name: 'has a role', pass: roles.length > 0, detail: roles.length ? roles.join(', ') : 'no role from the identity provider or the enrollment' });
  if (!roles.length) return fail('no-access', 'You have no role in the Architecture Studio.');

  if (permission === 'none-in-studio') {
    checks.push({ name: 'approvable here', pass: false, detail: `${cls.domain} records are not approved in the Studio` });
    const why =
      cls.domain === 'regulatory'
        ? 'This is a regulatory or certification-scheme matter. Approving it, or approving a filing, is a separate process with its own approver; the Studio has no role for it and cannot record it. An architecture approval never authorises a filing or a deployment.'
        : cls.domain === 'clarification'
          ? 'This is a stakeholder clarification: a fact only the business can supply. It is answered by recording the fact in the repository, by the named role. It is not approved here, and its options are possible answers, not architecture options.'
          : 'This record is not classified, so the Studio cannot tell which approval it needs. Classify it in the access policy first.';
    return fail('domain-not-approvable', why);
  }
  const has = permissionsOf(roles).has(permission);
  checks.push({ name: `permission ${permission}`, pass: has, detail: has ? 'granted by your role' : `none of your roles (${roles.join(', ')}) carries it` });
  if (!has) return fail('missing-permission', `Your role does not allow this. It needs ${permission}.`);

  if (approvalClass) {
    const gate = approvalGate(p, ctx, cls.domain, rec, checks, GRANTING.includes(action), { proposers: r.proposers, recommenders: r.recommenders, submitter: null });
    if (gate) return fail(gate.code, gate.reason, gate.code === 'reauth-required' ? 401 : 403);
  }
  return base(ctx, { ok: true, status: 200, domain: cls.domain, classification: cls, roles, permission, checks, approvalClass });
}

export interface WorkRequest {
  principal: Principal;
  action: WorkActionName;
  itemId: string;
  submitter: SubjectKey | null;
}

export function authorizeWork(r: WorkRequest, ctx: AuthContext): Authz {
  const { principal: p, action } = r;
  const { roles } = effectiveRoles(p, ctx);
  const permission = permissionForWorkAction(action);
  const approvalClass = permission.startsWith('approve:');
  const rec: Classifiable = { id: r.itemId, kind: 'work', approverText: null };
  const cls: Classification = { domain: 'architecture', basis: 'Work completion is an architecture approval.' };
  const checks: Check[] = [];
  const fail = (code: AuthCode, reason: string, status: 401 | 403 = 403) => base(ctx, { code, reason, status, domain: 'architecture', classification: cls, roles, permission, checks, approvalClass });
  if (ctx.policy.pinMismatch || ctx.policy.source === 'missing') return fail('policy-invalid', ctx.policy.problems[0] ?? 'The access policy is not trusted.');
  checks.push({ name: 'has a role', pass: roles.length > 0, detail: roles.join(', ') || 'none' });
  if (!roles.length) return fail('no-access', 'You have no role in the Architecture Studio.');
  const has = permissionsOf(roles).has(permission);
  checks.push({ name: `permission ${permission}`, pass: has, detail: has ? 'granted by your role' : 'not granted by your role' });
  if (!has) return fail('missing-permission', `Your role does not allow this. It needs ${permission}.`);
  if (approvalClass) {
    const gate = approvalGate(p, ctx, 'architecture', rec, checks, false, { proposers: [], recommenders: [], submitter: action === 'approve-completion' || action === 'reject-completion' ? r.submitter : null });
    if (gate) return fail(gate.code, gate.reason, gate.code === 'reauth-required' ? 401 : 403);
  }
  return base(ctx, { ok: true, status: 200, domain: 'architecture', classification: cls, roles, permission, checks, approvalClass });
}

/** Reading, and the access-administration pages. */
export function authorizeAccess(p: Principal | null, permission: 'read' | 'access:review' | 'access:administer', ctx: AuthContext): Authz {
  if (!p) return base(ctx, { code: 'no-access', reason: 'Sign in first.', status: 401, permission });
  const { roles } = effectiveRoles(p, ctx);
  const checks: Check[] = [{ name: `permission ${permission}`, pass: permissionsOf(roles).has(permission), detail: roles.join(', ') || 'no role' }];
  if (ctx.policy.pinMismatch && permission !== 'read') return base(ctx, { code: 'policy-invalid', reason: ctx.policy.problems[0], roles, permission, checks });
  if (!permissionsOf(roles).has(permission)) return base(ctx, { code: roles.length ? 'missing-permission' : 'no-access', reason: roles.length ? `Your role does not allow this. It needs ${permission}.` : 'You have no role in the Architecture Studio.', roles, permission, checks });
  return base(ctx, { ok: true, status: 200, roles, permission, checks });
}

/** The statement written into every approval record: what was checked, under which policy, and the strength of the sign-in. */
export function roleCheckOf(a: Authz, p: Principal, ctx: AuthContext, decisionText: string | null) {
  return {
    critical: false,
    required: a.permission && a.permission !== 'none-in-studio' ? [a.permission] : [],
    held: a.roles,
    namedRoles: rolesNamed(decisionText, ctx.policy),
    outstanding: [] as string[],
    policySource: (ctx.policy.source === 'canonical' ? 'canonical' : 'local-head-not-canonical') as 'canonical' | 'local-head-not-canonical',
    domain: a.domain ?? 'architecture',
    policyHash: a.policyHash,
    checks: a.checks.filter((c) => c.pass).map((c) => c.name),
    authAgeSeconds: Math.max(0, Math.round((ctx.now - p.authAt) / 1000)),
    mfa: p.mfa,
  };
}
