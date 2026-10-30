// The access model: roles, what each may do, and the approval domains that keep one kind of approval from authorising another.
// Pure data and functions. Nothing here reads a file, a clock or the network.
//
// Three ideas carry the design:
//   1. A role grants PERMISSIONS, and approval permissions are per DOMAIN. Approving an architecture decision is a different
//      permission from approving a security gate, a deployment, or a regulatory filing.
//   2. Nothing grants approval across domains. The Administrator role manages access; it holds no approval permission at all.
//   3. A regulatory or certification-scheme filing approval is not a Studio permission. The Studio has no role for it, so it
//      cannot record one.

export const ROLES = ['viewer', 'contributor', 'architect', 'security-reviewer', 'architecture-owner', 'deployment-approver', 'administrator'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  viewer: 'Viewer',
  contributor: 'Contributor',
  architect: 'Architect',
  'security-reviewer': 'Security Reviewer',
  'architecture-owner': 'Architecture Owner',
  'deployment-approver': 'Deployment Approver',
  administrator: 'Administrator',
};

/** Roles that can approve something. Holding one needs an active enrollment, not just an identity-provider assignment. */
export const APPROVER_ROLES: Role[] = ['security-reviewer', 'architecture-owner', 'deployment-approver'];
/** Roles that need an active enrollment. The Administrator manages access, so it is enrolled too. */
export const PRIVILEGED_ROLES: Role[] = [...APPROVER_ROLES, 'administrator'];

/**
 * The domain a decision is governed by.
 *   architecture : an architecture decision or the completion of architecture work.
 *   security     : a security-specific gate.
 *   deployment   : an Azure deployment gate.
 *   regulatory   : a regulatory or certification-scheme matter, including filings. Not approvable in the Studio.
 *   unclassified : no rule or designation says what it is. Not approvable until it is classified.
 */
export const DOMAINS = ['architecture', 'security', 'deployment', 'regulatory', 'unclassified'] as const;
export type Domain = (typeof DOMAINS)[number];

/** Most restrictive first. When a record matches several rules, the first listed domain wins. */
export const DOMAIN_PRECEDENCE: Domain[] = ['regulatory', 'deployment', 'security', 'architecture'];

export const DOMAIN_LABEL: Record<Domain, string> = {
  architecture: 'Architecture',
  security: 'Security gate',
  deployment: 'Azure deployment gate',
  regulatory: 'Regulatory or certification-scheme matter',
  unclassified: 'Not classified',
};

export type Permission = 'read' | 'comment' | 'propose' | 'recommend' | 'approve:architecture' | 'approve:security' | 'approve:deployment' | 'access:review' | 'access:administer';

/** The domains the Studio can record an approval for, and the permission each needs. */
export const APPROVAL_PERMISSION: Partial<Record<Domain, Permission>> = {
  architecture: 'approve:architecture',
  security: 'approve:security',
  deployment: 'approve:deployment',
};

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  viewer: ['read'],
  contributor: ['read', 'comment', 'propose'],
  architect: ['read', 'comment', 'propose', 'recommend'],
  'security-reviewer': ['read', 'comment', 'recommend', 'approve:security'],
  'architecture-owner': ['read', 'comment', 'propose', 'recommend', 'approve:architecture'],
  'deployment-approver': ['read', 'comment', 'approve:deployment'],
  // Deliberately no approve:* here. An administrator who also holds an approver role gets that role's approval, nothing more.
  administrator: ['read', 'comment', 'access:review', 'access:administer'],
};

export const permissionsOf = (roles: Role[]): Set<Permission> => new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r]));

/** Role pairs one person may not hold together. They would let a person approve across a separation the design relies on. */
export const DEFAULT_CONFLICTING_ROLES: [Role, Role][] = [
  ['architecture-owner', 'deployment-approver'],
  ['security-reviewer', 'deployment-approver'],
  ['administrator', 'architecture-owner'],
  ['administrator', 'security-reviewer'],
  ['administrator', 'deployment-approver'],
];

export const isRole = (s: unknown): s is Role => typeof s === 'string' && (ROLES as readonly string[]).includes(s);
export const isDomain = (s: unknown): s is Domain => typeof s === 'string' && (DOMAINS as readonly string[]).includes(s);

/** Decision actions, grouped by what they need. */
export type DecisionAction = 'approve' | 'approve-alternative' | 'approve-with-conditions' | 'reject' | 'request-revision' | 'defer' | 'comment' | 'reopen' | 'recommend';

/** Actions that settle or change the status of a decision. These are approval-class: they need the domain's approval permission. */
export const APPROVAL_CLASS: DecisionAction[] = ['approve', 'approve-alternative', 'approve-with-conditions', 'reject', 'defer', 'reopen'];
/** The subset that grants approval. Segregation and recommendation rules apply to these. */
export const GRANTING: DecisionAction[] = ['approve', 'approve-alternative', 'approve-with-conditions'];

export function permissionForDecisionAction(a: DecisionAction, domain: Domain): Permission | 'none-in-studio' {
  if (a === 'comment') return 'comment';
  if (a === 'request-revision') return 'propose';
  if (a === 'recommend') return 'recommend';
  return APPROVAL_PERMISSION[domain] ?? 'none-in-studio';
}

export type WorkActionName = 'assign' | 'prioritize' | 'comment' | 'mark-blocked' | 'unblock' | 'request-clarification' | 'submit-for-review' | 'approve-completion' | 'reject-completion' | 'reopen';

/**
 * Work items. Completion is an architecture approval: it can close architecture work, and it cannot authorise a filing or a
 * deployment, because those have their own domains and their own roles.
 */
export function permissionForWorkAction(a: WorkActionName): Permission {
  if (a === 'comment') return 'comment';
  if (a === 'approve-completion' || a === 'reject-completion' || a === 'reopen') return 'approve:architecture';
  return 'propose';
}
