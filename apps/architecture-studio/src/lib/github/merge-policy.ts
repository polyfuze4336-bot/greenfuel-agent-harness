// What GitHub itself says protects the canonical branch. The Studio never merges and never writes to the canonical branch, so it cannot
// bypass a merge policy. But it can be pointed at a repository that has none, where anybody with write access could land an approval
// without review. This reads the branch's active rules so the Studio can say so, and refuse to open a status-changing pull request
// until the repository requires pull requests. It reads rulesets only: classic branch protection needs a permission the app does not
// have, so a repository that relies on it reports as "absent" and the operator can acknowledge that with STUDIO_MERGE_POLICY=warn.
import type { GitHubApi } from './api.ts';

export type MergePolicyState = 'enforced' | 'partial' | 'absent' | 'unknown';

export interface MergePolicy {
  state: MergePolicyState;
  requiresPullRequest: boolean | null;
  requiresStatusChecks: boolean | null;
  requiredChecks: string[];
  blocksForcePush: boolean | null;
  branch: string;
  checkedAt: string;
  /** In words, for the person who has to act on it. */
  detail: string;
}

/** require: refuse status-changing pull requests unless a pull request is required (the default). warn: show it, do not refuse. off: not checked. */
export type MergePolicyMode = 'require' | 'warn' | 'off';
export const mergePolicyMode = (): MergePolicyMode => {
  const v = process.env.STUDIO_MERGE_POLICY?.trim().toLowerCase();
  return v === 'warn' || v === 'off' ? v : 'require';
};

interface RawRule {
  type: string;
  parameters?: { required_status_checks?: { context?: string }[] };
}

export function interpretRules(rules: RawRule[], branch: string, now: Date): MergePolicy {
  const pr = rules.some((r) => r.type === 'pull_request');
  const checks = [...new Set(rules.filter((r) => r.type === 'required_status_checks').flatMap((r) => (r.parameters?.required_status_checks ?? []).map((c) => c.context ?? '').filter(Boolean)))];
  const hasChecks = checks.length > 0;
  const noForce = rules.some((r) => r.type === 'non_fast_forward');
  const state: MergePolicyState = pr && hasChecks ? 'enforced' : pr ? 'partial' : 'absent';
  const detail =
    state === 'enforced'
      ? `${branch} requires a pull request and ${checks.length} passing check${checks.length === 1 ? '' : 's'} (${[...new Set(checks)].join(', ')}).`
      : state === 'partial'
        ? `${branch} requires a pull request but no passing status check. A pull request could be merged without validation.`
        : `No active ruleset on ${branch} requires a pull request. Anyone with write access could change it directly. Classic branch protection is not readable with this app's permissions, so it is not counted here.`;
  return { state, requiresPullRequest: pr, requiresStatusChecks: hasChecks, requiredChecks: checks, blocksForcePush: noForce, branch, checkedAt: now.toISOString(), detail };
}

export const unknownPolicy = (branch: string, now: Date, why: string): MergePolicy => ({ state: 'unknown', requiresPullRequest: null, requiresStatusChecks: null, requiredChecks: [], blocksForcePush: null, branch, checkedAt: now.toISOString(), detail: `The merge policy of ${branch} could not be read: ${why}` });

export class MergePolicyReader {
  private memo: { at: number; value: MergePolicy } | null = null;
  private readonly api: GitHubApi;
  private readonly repo: string;
  private readonly branch: string;
  private readonly ttlMs: number;
  private readonly now: () => Date;
  constructor(api: GitHubApi, repo: string, branch: string, ttlMs = 60_000, now: () => Date = () => new Date()) {
    this.api = api;
    this.repo = repo;
    this.branch = branch;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  /** Never throws. A failure to read is "unknown", which is shown but does not by itself stop an action. */
  async read(force = false): Promise<MergePolicy> {
    const t = this.now().getTime();
    if (!force && this.memo && t - this.memo.at < this.ttlMs) return this.memo.value;
    let value: MergePolicy;
    try {
      const r = await this.api.request<RawRule[]>('GET', `/repos/${this.repo}/rules/branches/${encodeURIComponent(this.branch)}`);
      value = Array.isArray(r.data) ? interpretRules(r.data, this.branch, this.now()) : unknownPolicy(this.branch, this.now(), 'GitHub returned an unexpected answer.');
    } catch (e) {
      value = unknownPolicy(this.branch, this.now(), e instanceof Error ? e.message : 'GitHub could not be reached.');
    }
    // An unreadable answer is not kept, so the next request asks again.
    if (value.state !== 'unknown') this.memo = { at: t, value };
    return value;
  }
}
