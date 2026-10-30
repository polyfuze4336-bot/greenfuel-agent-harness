// The administrative review: a plain account of who can do what, whether that is still justified, and what looks wrong. Pure: it is
// given the policy, the audit entries and the live sessions, and returns a report. It changes nothing.
import type { AccessPolicy } from './access-policy.ts';
import { enrolledRoles } from './access-policy.ts';
import { PRIVILEGED_ROLES, ROLE_LABEL, type Role } from './model.ts';
import type { Suspension } from './suspensions.ts';

export interface ReviewedPerson {
  subject: string;
  login: string;
  holder: string;
  provider: string;
  roles: Role[];
  status: 'active' | 'revoked' | 'not yet active' | 'suspended';
  enrolledAt: string;
  revokedAt: string | null;
  basis: string;
  requestedBy: string | null;
  approvedBy: string | null;
  reference: string;
  designatedFor: string[];
  approvalsRecorded: number;
  deniedAttempts: number;
  flags: string[];
}

export interface AccessReport {
  generatedAt: string;
  policy: { hash: string; source: string; pinned: boolean; pinMismatch: boolean; problems: string[] };
  people: ReviewedPerson[];
  findings: { severity: 'attention' | 'info'; text: string }[];
  suspensions: Suspension[];
  sessions: { subject: string; login: string; provider: string; createdAt: number; lastSeenAt: number; absoluteExpiresAt: number }[];
  lastAttestation: { at: string; by: string; policyHash: string | null } | null;
}

interface AuditLike {
  at: string;
  actor: string | null;
  action: string;
  outcome: string;
  code: string | null;
  facts?: { newValue?: string | null };
}

export function buildAccessReport(a: {
  policy: AccessPolicy;
  pinned: boolean;
  now: number;
  audit: AuditLike[];
  sessions: AccessReport['sessions'];
  suspensions: Suspension[];
}): AccessReport {
  const { policy, now } = a;
  const suspended = new Set(a.suspensions.map((s) => s.subject.toLowerCase()));
  const findings: AccessReport['findings'] = [];
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  const people: ReviewedPerson[] = policy.people.map((p) => {
    const active = enrolledRoles(p, now).length > 0 || (p.revokedAt === null && p.enrolledAt <= now);
    const status: ReviewedPerson['status'] = suspended.has(p.subject) ? 'suspended' : p.revokedAt !== null && p.revokedAt <= now ? 'revoked' : p.enrolledAt > now ? 'not yet active' : 'active';
    const mine = a.audit.filter((e) => e.actor?.toLowerCase() === p.login.toLowerCase());
    const designatedFor = policy.ownership.filter((o) => o.owners.includes(p.subject)).map((o) => `${o.domain}${'all' in o.scope ? ' (all)' : 'ids' in o.scope ? ` (${o.scope.ids.length} ids)` : ' (by stated approver)'}`);
    const flags: string[] = [];
    if (p.enrollment.basis === 'bootstrap' && p.roles.some((r) => PRIVILEGED_ROLES.includes(r))) flags.push('Bootstrap enrollment: no second person approved it.');
    if (status === 'active' && p.roles.some((r) => r !== 'viewer' && PRIVILEGED_ROLES.includes(r)) && !p.enrollment.reference) flags.push('No reference recorded for the enrollment.');
    if (status === 'suspended' && p.revokedAt === null) flags.push('Suspended, but the enrollment is not revoked in the policy. Revoke it by a reviewed change.');
    if (status === 'active' && p.roles.some((r) => ['security-reviewer', 'architecture-owner', 'deployment-approver'].includes(r)) && designatedFor.length === 0) flags.push('Holds an approver role but is not designated to approve anything.');
    void active;
    return {
      subject: p.subject,
      login: p.login,
      holder: p.holder,
      provider: p.provider,
      roles: p.roles,
      status,
      enrolledAt: iso(p.enrolledAt),
      revokedAt: p.revokedAt === null ? null : iso(p.revokedAt),
      basis: p.enrollment.basis,
      requestedBy: p.enrollment.requestedBy,
      approvedBy: p.enrollment.approvedBy,
      reference: p.enrollment.reference,
      designatedFor,
      approvalsRecorded: mine.filter((e) => e.outcome === 'accepted' && /^(approve|reject|defer|reopen|approve-)/.test(e.action)).length,
      deniedAttempts: mine.filter((e) => e.outcome === 'denied').length,
      flags,
    };
  });

  const activeAdmins = people.filter((p) => p.status === 'active' && p.roles.includes('administrator'));
  const activeApprovers = people.filter((p) => p.status === 'active' && p.roles.some((r) => ['security-reviewer', 'architecture-owner', 'deployment-approver'].includes(r)));
  if (!policy.people.length) findings.push({ severity: 'attention', text: 'Nobody is enrolled, so nobody can approve anything.' });
  if (policy.people.length && !activeAdmins.length) findings.push({ severity: 'attention', text: 'No active Administrator is enrolled, so access cannot be reviewed or suspended from the Studio.' });
  if (activeAdmins.length === 1) findings.push({ severity: 'attention', text: 'There is only one Administrator. Two are needed for any enrollment to be requested and approved by different people.' });
  if (policy.people.length && !activeApprovers.length) findings.push({ severity: 'attention', text: 'Nobody holds an approver role, so no decision can be approved.' });
  for (const d of ['architecture', 'security', 'deployment'] as const) {
    if (!policy.ownership.some((o) => o.domain === d && o.owners.some((k) => people.some((p) => p.subject === k && p.status === 'active')))) {
      findings.push({ severity: d === 'architecture' ? 'attention' : 'info', text: `Nobody active is designated to approve ${d} records, so none can be approved.` });
    }
  }
  for (const o of policy.ownership) {
    for (const k of o.owners) {
      const p = people.find((x) => x.subject === k);
      if (!p) findings.push({ severity: 'attention', text: `${k} is designated for ${o.domain} but is not enrolled. The designation does nothing.` });
      else if (p.status !== 'active') findings.push({ severity: 'attention', text: `${p.login} is designated for ${o.domain} but their enrollment is ${p.status}.` });
    }
  }
  if (policy.authentication.approvalProviders.includes('github')) findings.push({ severity: 'attention', text: 'The policy accepts approvals from GitHub sign-ins. That is a development setting; production should list only entra.' });
  if (!policy.authentication.tenantId) findings.push({ severity: 'info', text: 'No Entra tenant is set in the policy, so no Entra sign-in can hold a role yet.' });
  if (!a.pinned) findings.push({ severity: 'info', text: 'The access policy is not pinned by this server (STUDIO_ACCESS_POLICY_SHA256). A change that reaches the repository is trusted as soon as the Studio reads it.' });
  if (!policy.segregation.enforce) findings.push({ severity: 'attention', text: 'Segregation of duties is switched off in the policy.' });
  for (const s of a.suspensions) {
    const p = policy.people.find((x) => x.subject === s.subject);
    if (p && p.revokedAt === null) findings.push({ severity: 'attention', text: `${p.login} is suspended (${s.reason}) but still enrolled in the policy.` });
  }
  const bad = a.audit.filter((e) => e.outcome === 'denied' && e.action !== 'signin');
  const byActor = new Map<string, number>();
  for (const e of bad) if (e.actor) byActor.set(e.actor, (byActor.get(e.actor) ?? 0) + 1);
  for (const [who, n] of byActor) if (n >= 5) findings.push({ severity: 'attention', text: `${who} has ${n} refused attempts in the recent audit log.` });
  for (const p of policy.problems) findings.push({ severity: 'attention', text: `Policy problem: ${p}` });
  for (const r of Object.keys(ROLE_LABEL) as Role[]) void r;

  const att = a.audit.find((e) => e.action === 'access-review' && e.outcome === 'accepted');
  return {
    generatedAt: new Date(now).toISOString(),
    policy: { hash: policy.hash, source: policy.source, pinned: a.pinned, pinMismatch: policy.pinMismatch, problems: policy.problems },
    people,
    findings,
    suspensions: a.suspensions,
    sessions: a.sessions,
    lastAttestation: att ? { at: att.at, by: att.actor ?? 'unknown', policyHash: att.facts?.newValue ?? null } : null,
  };
}
