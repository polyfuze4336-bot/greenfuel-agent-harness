// The access policy: who is enrolled, with which roles, who owns which decisions, how decisions are classified into approval
// domains, and the rules that keep duties apart. It is data in harness/policy/access-policy.json.
//
// It is a control-plane file: changing it changes who can approve, so it is changed by a reviewed repository change, never by a
// Studio action. The server can additionally PIN the policy by hash (STUDIO_ACCESS_POLICY_SHA256), so a change that reached the
// repository without the operator's knowledge is refused rather than trusted. A missing, unreadable or invalid policy grants
// nothing: every entry that fails validation is dropped and reported.
import crypto from 'node:crypto';
import { DEFAULT_CONFLICTING_ROLES, DOMAIN_PRECEDENCE, PRIVILEGED_ROLES, isDomain, isRole, type Domain, type Role } from './model.ts';

export const ACCESS_POLICY_PATH = 'harness/policy/access-policy.json';

export type Provider = 'entra' | 'github';

/** `github:<numeric id>` or `entra:<tenant id>:<object id>`. Never a name or an email, which can change hands. */
export type SubjectKey = string;
const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SUBJECT_RE = new RegExp(`^(?:github:[1-9]\\d{0,12}|entra:${GUID}:${GUID})$`, 'i');

export const subjectKeyOf = (u: { provider: Provider; subject: string }): SubjectKey => `${u.provider}:${u.subject}`.toLowerCase();

export interface Enrollment {
  /** bootstrap: the first enrollments, which nobody else could approve. approved: requested and approved by two other enrolled administrators. */
  basis: 'bootstrap' | 'approved';
  requestedBy: SubjectKey | null;
  approvedBy: SubjectKey | null;
  /** Where the evidence is: a pull request, a ticket, a dated instruction. Free text, shown to the reviewer. */
  reference: string;
}

export interface PolicyPerson {
  subject: SubjectKey;
  provider: Provider;
  tenantId: string | null;
  login: string;
  holder: string;
  roles: Role[];
  enrolledAt: number;
  revokedAt: number | null;
  revokedReason: string | null;
  enrollment: Enrollment;
}

export interface ClassificationRule {
  domain: Domain;
  kinds: string[];
  idMatches: string[];
  approverTextMatches: string[];
}

export interface OwnershipEntry {
  domain: Domain;
  scope: { all: true } | { ids: string[] } | { approverTextMatches: string[] };
  owners: SubjectKey[];
}

export interface AccessPolicy {
  version: number;
  source: 'canonical' | 'local-head-not-canonical' | 'missing';
  /** sha256 of the policy text, so every approval can say which policy it was made under. */
  hash: string;
  /** True when the server pinned a hash and this policy does not match it. Such a policy grants nothing. */
  pinMismatch: boolean;
  authentication: {
    tenantId: string | null;
    clientId: string | null;
    /** Providers whose approvals count. Production lists only entra. */
    approvalProviders: Provider[];
    entraRoleMap: Record<string, Role>;
    entraGroupMap: Record<string, Role>;
  };
  session: { idleMinutes: number; absoluteHours: number; approvalMaxAuthAgeMinutes: number; requireMfaForApproval: boolean };
  roleAliases: Record<string, string[]>;
  critical: { priorities: string[]; includeBlocked: boolean };
  classification: { rules: ClassificationRule[]; overrides: Record<string, Domain> };
  ownership: OwnershipEntry[];
  segregation: { enforce: boolean; conflictingRoles: [Role, Role][]; authorBindings: { gitEmail: string; subject: SubjectKey }[]; requireIndependentRecommendation: boolean };
  people: PolicyPerson[];
  problems: string[];
}

export function emptyAccessPolicy(source: AccessPolicy['source'], problem?: string): AccessPolicy {
  return {
    version: 2,
    source,
    hash: '',
    pinMismatch: false,
    authentication: { tenantId: null, clientId: null, approvalProviders: ['entra'], entraRoleMap: {}, entraGroupMap: {} },
    session: { idleMinutes: 30, absoluteHours: 8, approvalMaxAuthAgeMinutes: 15, requireMfaForApproval: true },
    roleAliases: {},
    critical: { priorities: ['Must'], includeBlocked: true },
    classification: { rules: [], overrides: {} },
    ownership: [],
    segregation: { enforce: true, conflictingRoles: DEFAULT_CONFLICTING_ROLES, authorBindings: [], requireIndependentRecommendation: false },
    people: [],
    problems: problem ? [problem] : [],
  };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const when = (v: unknown): number | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : null);

export const hashPolicyText = (text: string) => crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');

export function parseAccessPolicy(text: string | undefined, source: AccessPolicy['source'], pin: string | null = null): AccessPolicy {
  if (text === undefined) return emptyAccessPolicy('missing', `${ACCESS_POLICY_PATH} does not exist, so nobody can act.`);
  const hash = hashPolicyText(text);
  const p = emptyAccessPolicy(source);
  p.hash = hash;
  if (pin && pin.toLowerCase() !== hash) {
    p.pinMismatch = true;
    p.problems.push(`The access policy does not match the hash pinned by this server (${pin.slice(0, 12)}…). It was not trusted: nobody can act until the pin and the policy agree.`);
    return p;
  }
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text) as Record<string, unknown>;
  } catch {
    p.problems.push(`${ACCESS_POLICY_PATH} is not valid JSON, so nobody can act.`);
    return p;
  }
  if (o.version !== 2) {
    p.problems.push(`${ACCESS_POLICY_PATH} has version ${String(o.version)}; this Studio reads version 2. Nobody can act.`);
    return p;
  }

  const a = obj(o.authentication);
  p.authentication.tenantId = typeof a.tenantId === 'string' && new RegExp(`^${GUID}$`, 'i').test(a.tenantId) ? a.tenantId.toLowerCase() : null;
  p.authentication.clientId = typeof a.clientId === 'string' && a.clientId.trim() ? a.clientId.trim() : null;
  const providers = strings(a.approvalProviders).filter((x): x is Provider => x === 'entra' || x === 'github');
  p.authentication.approvalProviders = providers.length ? providers : ['entra'];
  for (const [k, v] of Object.entries(obj(a.entraRoleMap))) if (isRole(v)) p.authentication.entraRoleMap[k] = v;
  for (const [k, v] of Object.entries(obj(a.entraGroupMap))) if (isRole(v) && new RegExp(`^${GUID}$`, 'i').test(k)) p.authentication.entraGroupMap[k.toLowerCase()] = v;

  const s = obj(o.session);
  p.session = {
    idleMinutes: clamp(s.idleMinutes, 1, 240, 30),
    absoluteHours: clamp(s.absoluteHours, 1, 24, 8),
    approvalMaxAuthAgeMinutes: clamp(s.approvalMaxAuthAgeMinutes, 1, 60, 15),
    requireMfaForApproval: s.requireMfaForApproval !== false,
  };

  for (const [k, v] of Object.entries(obj(o.roleAliases))) p.roleAliases[k] = strings(v).map((x) => x.toLowerCase());
  const c = obj(o.critical);
  p.critical = { priorities: strings(c.priorities).length ? strings(c.priorities) : ['Must'], includeBlocked: c.includeBlocked !== false };

  // classification
  const cl = obj(o.classification);
  for (const raw of Array.isArray(cl.rules) ? cl.rules : []) {
    const r = obj(raw);
    if (!isDomain(r.domain) || r.domain === 'unclassified') {
      p.problems.push('A classification rule names no valid domain and was ignored.');
      continue;
    }
    const idMatches = strings(r.idMatches).filter((m) => {
      try {
        if (m.length > 80) return false;
        new RegExp(m);
        return true;
      } catch {
        return false;
      }
    });
    p.classification.rules.push({ domain: r.domain, kinds: strings(r.kinds), idMatches, approverTextMatches: strings(r.approverTextMatches).map((x) => x.toLowerCase()) });
  }
  for (const [id, d] of Object.entries(obj(cl.overrides))) if (isDomain(d)) p.classification.overrides[id] = d;

  // segregation
  const sg = obj(o.segregation);
  p.segregation.enforce = sg.enforce !== false;
  p.segregation.requireIndependentRecommendation = sg.requireIndependentRecommendation === true;
  const pairs = (Array.isArray(sg.conflictingRoles) ? sg.conflictingRoles : []).filter((x): x is [Role, Role] => Array.isArray(x) && x.length === 2 && isRole(x[0]) && isRole(x[1]));
  p.segregation.conflictingRoles = pairs.length ? pairs : DEFAULT_CONFLICTING_ROLES;
  for (const b of Array.isArray(sg.authorBindings) ? sg.authorBindings : []) {
    const r = obj(b);
    if (typeof r.gitEmail === 'string' && typeof r.subject === 'string' && SUBJECT_RE.test(r.subject)) p.segregation.authorBindings.push({ gitEmail: r.gitEmail.toLowerCase(), subject: r.subject.toLowerCase() });
  }

  // people
  const seen = new Set<string>();
  const drafts: PolicyPerson[] = [];
  for (const raw of Array.isArray(o.people) ? o.people : []) {
    const r = obj(raw);
    const subject = typeof r.subject === 'string' ? r.subject.trim().toLowerCase() : '';
    const label = subject || '(no subject)';
    if (!SUBJECT_RE.test(subject)) {
      p.problems.push(`A person entry needs a subject like github:<id> or entra:<tenant id>:<object id>: ${label} was ignored. Names and emails are not identities.`);
      continue;
    }
    if (r.kind !== 'human') {
      p.problems.push(`${label} is not marked kind "human". Agents, bots and service principals can never be enrolled; the entry was ignored.`);
      continue;
    }
    if (typeof r.holder !== 'string' || !r.holder.trim() || typeof r.login !== 'string' || !r.login.trim()) {
      p.problems.push(`${label} needs a holder name and a login; it was ignored.`);
      continue;
    }
    if (seen.has(subject)) {
      p.problems.push(`${label} appears twice; the second entry was ignored.`);
      continue;
    }
    const enrolledAt = when(r.enrolledAt);
    if (enrolledAt === null) {
      p.problems.push(`${label} has no valid enrolledAt date; it was ignored.`);
      continue;
    }
    const e = obj(r.enrollment);
    const basis = e.basis === 'approved' ? 'approved' : e.basis === 'bootstrap' ? 'bootstrap' : null;
    if (!basis) {
      p.problems.push(`${label} has no enrollment basis (bootstrap or approved); it was ignored.`);
      continue;
    }
    const roles = strings(r.roles).filter(isRole);
    const bad = strings(r.roles).filter((x) => !isRole(x));
    if (bad.length) p.problems.push(`${label} lists unknown role(s) ${bad.join(', ')}; they were ignored.`);
    seen.add(subject);
    const provider: Provider = subject.startsWith('entra:') ? 'entra' : 'github';
    drafts.push({
      subject,
      provider,
      tenantId: provider === 'entra' ? subject.split(':')[1]! : null,
      login: r.login.trim(),
      holder: r.holder.trim(),
      roles: [...new Set(roles)],
      enrolledAt,
      revokedAt: when(r.revokedAt),
      revokedReason: typeof r.revokedReason === 'string' ? r.revokedReason : null,
      enrollment: { basis, requestedBy: typeof e.requestedBy === 'string' ? e.requestedBy.toLowerCase() : null, approvedBy: typeof e.approvedBy === 'string' ? e.approvedBy.toLowerCase() : null, reference: typeof e.reference === 'string' ? e.reference : '' },
    });
  }

  const byKey = new Map(drafts.map((d) => [d.subject, d]));
  const isActiveAdmin = (k: SubjectKey | null, at: number) => {
    const x = k ? byKey.get(k) : undefined;
    return !!x && x.roles.includes('administrator') && x.enrolledAt <= at;
  };
  for (const d of drafts) {
    const privileged = d.roles.filter((r) => PRIVILEGED_ROLES.includes(r));
    // Privileged enrollment must not be self-serving.
    if (privileged.length && d.enrollment.basis === 'approved') {
      const { requestedBy, approvedBy } = d.enrollment;
      const why =
        !requestedBy || !approvedBy
          ? 'needs a requester and an approver'
          : requestedBy === d.subject || approvedBy === d.subject
            ? 'was requested or approved by the person enrolled: no one may grant themselves access'
            : requestedBy === approvedBy
              ? 'needs two different people to request and approve it'
              : !isActiveAdmin(requestedBy, d.enrolledAt) || !isActiveAdmin(approvedBy, d.enrolledAt)
                ? 'must be requested and approved by two enrolled administrators'
                : null;
      if (why) {
        p.problems.push(`${d.subject}: the enrollment ${why}. Its privileged role(s) (${privileged.join(', ')}) were removed.`);
        d.roles = d.roles.filter((r) => !PRIVILEGED_ROLES.includes(r));
      }
    }
    // Roles one person may not hold together are both removed: the policy does not pick a side.
    for (const [x, y] of p.segregation.conflictingRoles) {
      if (d.roles.includes(x) && d.roles.includes(y)) {
        p.problems.push(`${d.subject} holds both ${x} and ${y}, which one person may not. Both were removed.`);
        d.roles = d.roles.filter((r) => r !== x && r !== y);
      }
    }
    p.people.push(d);
  }

  // ownership
  for (const raw of Array.isArray(o.ownership) ? o.ownership : []) {
    const r = obj(raw);
    const sc = obj(r.scope);
    const owners = strings(r.owners).map((x) => x.toLowerCase()).filter((x) => SUBJECT_RE.test(x));
    if (!isDomain(r.domain) || r.domain === 'regulatory' || r.domain === 'clarification' || r.domain === 'unclassified') {
      p.problems.push('An ownership entry names a domain the Studio cannot approve for, and was ignored.');
      continue;
    }
    const scope: OwnershipEntry['scope'] | null = sc.all === true ? { all: true } : strings(sc.ids).length ? { ids: strings(sc.ids) } : strings(sc.approverTextMatches).length ? { approverTextMatches: strings(sc.approverTextMatches).map((x) => x.toLowerCase()) } : null;
    if (!scope || !owners.length) {
      p.problems.push(`An ownership entry for ${r.domain} needs a scope and at least one owner; it was ignored.`);
      continue;
    }
    p.ownership.push({ domain: r.domain, scope, owners });
  }
  if (!p.people.length) p.problems.push('Nobody is enrolled, so nobody can approve anything.');
  return p;
}

export function findPerson(policy: AccessPolicy, key: SubjectKey): PolicyPerson | undefined {
  return policy.people.find((x) => x.subject === key.toLowerCase());
}

/** The roles an enrollment grants at a moment: none before it started or after it was revoked. */
export function enrolledRoles(person: PolicyPerson | undefined, atMs: number): Role[] {
  if (!person || person.enrolledAt > atMs || (person.revokedAt !== null && person.revokedAt <= atMs)) return [];
  return person.roles;
}

export interface Classifiable {
  id: string;
  kind: string;
  approverText: string | null;
  /** What the record asks for, from the register's Kind column. When present it takes precedence over the approver's role text. */
  natures?: readonly string[];
}

export interface Classification {
  domain: Domain;
  basis: string;
}

/**
 * What kind of approval a record needs. A person never chooses this. It comes from the repository record's own stated approver
 * and id through the policy's rules, and the most restrictive match wins, so a record that touches a filing is never treated as
 * a plain architecture decision.
 */
export function classify(policy: AccessPolicy, rec: Classifiable): Classification {
  const override = policy.classification.overrides[rec.id];
  if (override) return { domain: override, basis: `The policy classifies ${rec.id} explicitly as ${override}.` };
  const text = (rec.approverText ?? '').toLowerCase();
  const hits = new Map<Domain, string>();
  // The nature of a record is stated by the register, not guessed from who owns it. A stakeholder clarification owned by the
  // programme owner is still a clarification, and a regulatory verification is never an architecture approval.
  if (rec.natures) {
    if (rec.kind === 'register-entry' && rec.natures.length === 0) return { domain: 'unclassified', basis: 'The register states no recognised Kind for this entry, so the Studio cannot tell what it asks for and does not guess.' };
    if (rec.natures.includes('regulatory-verification')) hits.set('regulatory', 'its register Kind includes D, a regulatory or certification claim that a qualified person must verify');
    if (rec.natures.includes('stakeholder-clarification')) hits.set('clarification', 'its register Kind includes C, a stakeholder clarification: a fact only the business can supply');
  }
  for (const r of policy.classification.rules) {
    let why: string | null = null;
    if (r.kinds.includes(rec.kind)) why = `its kind is ${rec.kind}`;
    else if (r.idMatches.some((m) => new RegExp(m).test(rec.id))) why = `its id matches ${r.idMatches.join(' or ')}`;
    else {
      const t = r.approverTextMatches.find((m) => text.includes(m));
      if (t) why = `its stated approver names "${t}"`;
    }
    if (why && !hits.has(r.domain)) hits.set(r.domain, why);
  }
  for (const d of DOMAIN_PRECEDENCE) if (hits.has(d)) return { domain: d, basis: `${d}: ${hits.get(d)}${hits.size > 1 ? ' (the most restrictive of several matches)' : ''}.` };
  return { domain: 'unclassified', basis: 'No classification rule matches this record, so it is not approvable until the policy classifies it.' };
}

/** The people designated to approve a record in a domain. Holding the role is not enough: they must be designated too. */
export function designatedOwners(policy: AccessPolicy, domain: Domain, rec: Classifiable): SubjectKey[] {
  const text = (rec.approverText ?? '').toLowerCase();
  const out = new Set<SubjectKey>();
  for (const o of policy.ownership) {
    if (o.domain !== domain) continue;
    const hit = 'all' in o.scope ? true : 'ids' in o.scope ? o.scope.ids.includes(rec.id) : o.scope.approverTextMatches.some((m) => text.includes(m));
    if (hit) for (const k of o.owners) out.add(k);
  }
  return [...out];
}

/** Role names a free-text "owner" or "approver" field mentions, through the policy's aliases. Display and "My tasks" only: it grants nothing. */
export function rolesNamed(text: string | undefined | null, policy: Pick<AccessPolicy, 'roleAliases'>): string[] {
  const t = (text ?? '').toLowerCase();
  return Object.entries(policy.roleAliases)
    .filter(([, al]) => al.some((a) => t.includes(a)))
    .map(([k]) => k);
}
