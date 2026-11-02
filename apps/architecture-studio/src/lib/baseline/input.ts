// Reads a repository at a ref and assembles the facts the readiness validator needs. Everything comes from git objects at that ref
// (plus the harness approval rules, run from `codeRoot`), so the same commit always gives the same input.
import { GitRepositoryAdapter } from '../repo/git.ts';
import { buildModel } from '../repo/build.ts';
import { applyReviewOverlay } from '../workflow/overlay.ts';
import { loadReviewStates } from '../workflow/review.ts';
import { loadWorkStates } from '../workflow/work.ts';
import { buildQueue } from '../queue/snapshot.ts';
import { ACCESS_POLICY_PATH, classify, parseAccessPolicy } from '../auth/access-policy.ts';
import { emptyTrust, trustFrom, type Trust } from '../auth/signing.ts';
import type { Authenticity } from '../auth/authenticity.ts';
import type { FragmentCache } from '../intel/engine.ts';
import { canonicalJson, sha256 } from '../workflow/events.ts';
import type { NormalizedDecision } from '../intel/schema.ts';
import { harnessFacts } from './facts.ts';
import { BASELINE_POLICY_PATH, parseBaselinePolicy } from './policy.ts';
import type { ReadinessInput } from './readiness.ts';

export interface LoadOptions {
  /** Where the harness code to run lives. In CI this is the trusted base checkout, so a change cannot weaken its own gate. */
  codeRoot: string;
  /** Public keys the Studio's server signs review records with. Without them signatures cannot be checked, and the result says so. */
  trustedSigningKeys?: { publicKeyPem: string; notAfter?: string | null }[];
  /** A separate ref to read review records and work items from (the Studio reads them from the canonical branch). Defaults to the ref itself. */
  reviewsRef?: string;
  fragmentCache?: FragmentCache;
  /** Use this trust to check signatures instead of building one from `trustedSigningKeys`. The running Studio passes its own. */
  trust?: Trust;
  /** Whether a development signing key is accepted. The running Studio allows it outside Entra mode only. */
  allowDevKeys?: boolean;
}

export interface Loaded {
  input: ReadinessInput;
  adapter: GitRepositoryAdapter;
}

const lf = (t: string) => t.replace(/\r\n/g, '\n');

/**
 * What a decision says, as one hash. An ADR is its own file, so its text is the file with the status line neutralised, which is how
 * the harness binds a signed approval to an ADR: accepting it does not change the hash, editing it does. A register entry is a row in
 * a shared file, so it is the fields the row defines. Links to and from other records are left out: being cited is not being edited.
 */
export function textHashOf(d: NormalizedDecision, read: (p: string) => string | undefined): string {
  if (d.kind === 'adr') {
    const text = read(d.source.path);
    if (text !== undefined) return sha256(lf(text).replace(/^- \*\*Status:\*\*.*$/m, '- **Status:** Proposed'));
  }
  const opts = d.options.map((o) => ({ key: o.key, name: o.name, summary: o.summary, disposition: o.disposition, recommended: o.recommended, pros: o.pros.map((c) => c.text), cons: o.cons.map((c) => c.text) }));
  return sha256(canonicalJson({ id: d.id, kind: d.kind, title: d.title, description: d.description, why: d.businessJustification, category: d.category, milestone: d.milestone, approver: d.requiredApproverRole?.text ?? null, owner: d.decisionOwner, options: opts, dependsOn: d.dependsOn, supersedes: d.supersedes }));
}

export function authenticityFor(read: (p: string) => string | undefined, o: Pick<LoadOptions, 'trustedSigningKeys' | 'trust' | 'allowDevKeys'>): Authenticity {
  const policy = parseAccessPolicy(read(ACCESS_POLICY_PATH), 'canonical', null);
  if (o.trust) return { trust: o.trust, policy, allowDevKeys: !!o.allowDevKeys, signatures: 'verify' };
  const keys = o.trustedSigningKeys ?? [];
  if (keys.length) return { trust: trustFrom({ extra: keys }), policy, allowDevKeys: false, signatures: 'verify' };
  return { trust: emptyTrust(), policy, allowDevKeys: false, signatures: 'skip' };
}

export function loadReadinessInput(root: string, ref: string, o: LoadOptions): Loaded {
  const adapter = new GitRepositoryAdapter(root, ref).open();
  const reviews = o.reviewsRef ? new GitRepositoryAdapter(root, o.reviewsRef).open() : adapter;
  const auth = authenticityFor((p) => reviews.read(p), o);
  const model = buildModel(adapter, o.fragmentCache ?? new Map());
  const reviewStates = loadReviewStates(reviews, auth);
  const register = applyReviewOverlay(model.register, reviewStates, reviews.ref);
  const withReviews = { ...model, register };

  const accessPolicy = parseAccessPolicy(adapter.read(ACCESS_POLICY_PATH), 'canonical', null);
  const work = loadWorkStates(reviews, auth);
  const queue = buildQueue(withReviews, adapter, { work, roleAliases: accessPolicy.roleAliases, completionRoles: ['architecture-owner'], canonicalRef: reviews.ref });

  const domains: Record<string, string> = {};
  for (const d of register.records) domains[d.id] = classify(accessPolicy, { id: d.id, kind: d.kind, approverText: d.requiredApproverRole?.text ?? null, natures: d.natures }).domain;
  const assumptionRefs: Record<string, string[]> = {};
  for (const d of model.decisions) assumptionRefs[d.id] = d.refs.assumptions;
  const t14 = model.tasks.find((t) => t.id === 'T14');

  return {
    adapter,
    input: {
      commit: adapter.commit,
      ref: adapter.ref,
      policy: parseBaselinePolicy(adapter.read(BASELINE_POLICY_PATH)),
      decisions: register.records,
      reviewStates,
      requirements: model.requirements,
      assumptions: model.assumptions,
      assumptionRefs,
      items: queue.items,
      edges: queue.edges,
      designReviews: model.reviews,
      harness: harnessFacts(adapter, o.codeRoot),
      textHash: Object.fromEntries(register.records.map((d) => [d.id, textHashOf(d, (p) => adapter.read(p))])),
      domains,
      branchProtectionInForce: !!t14 && ['done', 'decided', 'approved', 'agreed'].includes(t14.status),
      signatures: auth.signatures === 'skip' ? 'not-verified' : 'verified',
    },
  };
}
