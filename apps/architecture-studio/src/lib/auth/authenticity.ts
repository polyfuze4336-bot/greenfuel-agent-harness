// Is a record in the repository really an approval? Read-time checks, applied to every review and work-item record before it can
// change what the Studio shows. A record that fails is reported as a problem and ignored; it never becomes a status.
import { ACCESS_POLICY_PATH, enrolledRoles, findPerson, parseAccessPolicy, subjectKeyOf, type AccessPolicy } from './access-policy.ts';
import { authConfig, getTrust } from './config.ts';
import type { Domain, Role } from './model.ts';
import { verifyRecordSignature, type RecordSignature, type Trust } from './signing.ts';

export interface RecordFacts {
  actor: { provider: 'entra' | 'github'; subject: string };
  createdAt: string;
  eventHash: string;
  signature: RecordSignature | null;
  roleCheck: { domain: string };
  /** Settles or changes a status. These also need the actor to have been enrolled at the time. */
  approvalClass: boolean;
}

const ROLE_FOR_DOMAIN: Partial<Record<Domain, Role>> = { architecture: 'architecture-owner', security: 'security-reviewer', deployment: 'deployment-approver' };

export interface Authenticity {
  trust: Trust;
  policy: AccessPolicy;
  allowDevKeys: boolean;
  /**
   * verify (the default, and the only mode the running Studio uses): every record needs a signature the server's trust accepts.
   * skip: only the architecture baseline tool in CI uses it, where the server's public key is not available. The hash chain, the
   * enrollment-at-the-time check and everything else still apply, but a forged signature is NOT detected, so whoever reads the result must
   * say so. It is chosen in code by the caller, never by repository data.
   */
  signatures?: 'verify' | 'skip';
}

/** The trust and the policy as found at a ref, so the policy that governed a record is the one on the branch the record is on. */
export function authenticityAt(read: (path: string) => string | undefined): Authenticity {
  const cfg = authConfig();
  return { trust: getTrust(), policy: parseAccessPolicy(read(ACCESS_POLICY_PATH), 'canonical', cfg.policyPin), allowDevKeys: cfg.mode === 'github-dev' };
}

/** Null if the record counts, otherwise the reason it does not. */
export function checkRecord(a: Authenticity, r: RecordFacts): string | null {
  const at = Date.parse(r.createdAt);
  if (a.signatures !== 'skip') {
    const sig = verifyRecordSignature(a.trust, r.signature, r.eventHash, at, { allowDevKeys: a.allowDevKeys });
    if (sig) return sig;
  }
  if (!r.approvalClass) return null;
  if (a.policy.pinMismatch || a.policy.source === 'missing') return 'there is no trusted access policy to say who may approve';
  const key = subjectKeyOf(r.actor);
  const person = findPerson(a.policy, key);
  if (!person) return `${key} is not an enrolled approver`;
  const role = ROLE_FOR_DOMAIN[r.roleCheck.domain as Domain];
  if (!role) return `a ${r.roleCheck.domain} record is not something the Studio can approve`;
  if (!enrolledRoles(person, at).includes(role)) return `${key} was not enrolled as ${role} when this was recorded (enrolled ${new Date(person.enrolledAt).toISOString().slice(0, 10)}${person.revokedAt !== null ? `, revoked ${new Date(person.revokedAt).toISOString().slice(0, 10)}` : ''})`;
  return null;
}
