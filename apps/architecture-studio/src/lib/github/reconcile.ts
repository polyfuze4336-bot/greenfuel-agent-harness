// Sync reconciliation: bring every open proposal up to date with what GitHub says now, and report anything GitHub holds that the
// Studio does not know about. It is the one routine behind the "Reconcile now" button, the periodic timer and the webhook, so
// all three behave the same. Every step it takes is the ordinary sync step, which checks before it acts, so running it twice,
// or while a person is also clicking, is safe.
import type { GitHubPort } from '../workflow/github.ts';
import type { ReviewService } from '../workflow/review.ts';
import { isOpen, type Proposal } from '../workflow/store.ts';
import type { WorkService } from '../workflow/work.ts';

export interface ReconcileReport {
  at: string;
  trigger: string;
  canonicalCommit: string | null;
  checked: number;
  advanced: { proposal: string; subject: string; from: string; to: string }[];
  unchanged: number;
  failures: { proposal: string; message: string; retryable: boolean; retryAfterMs: number | null }[];
  /** Pull requests the Studio's branch names say it opened, that no local proposal accounts for. Reported, never adopted. */
  orphans: { number: number; url: string; head: string; state: string }[];
  orphanCheck: 'done' | 'not-supported' | { failed: string };
  anyApplied: boolean;
}

const g = globalThis as unknown as { __studioReconcile?: ReconcileReport | null };
export const lastReconcile = () => g.__studioReconcile ?? null;

export interface ReconcileTarget {
  service: ReviewService;
  work: WorkService;
  github: GitHubPort;
}

export async function reconcile(t: ReconcileTarget, opts: { trigger: string; prNumbers?: number[]; headShas?: string[] } = { trigger: 'manual' }): Promise<ReconcileReport> {
  const store = t.service.deps.store;
  const narrowed = (opts.prNumbers?.length ?? 0) + (opts.headShas?.length ?? 0) > 0;
  const open = store.list().filter((p) => isOpen(p.state) && (!narrowed || (p.prNumber !== null && opts.prNumbers?.includes(p.prNumber)) || (p.headSha !== null && opts.headShas?.includes(p.headSha))));
  const report: ReconcileReport = { at: new Date().toISOString(), trigger: opts.trigger, canonicalCommit: null, checked: open.length, advanced: [], unchanged: 0, failures: [], orphans: [], orphanCheck: 'not-supported', anyApplied: false };

  for (const p of open) {
    try {
      const next: Proposal = await ((p.family ?? 'decision') === 'work' ? t.work : t.service).sync(p.id);
      if (next.state !== p.state) report.advanced.push({ proposal: p.id, subject: p.decisionId, from: p.state, to: next.state });
      else report.unchanged++;
      if (next.state === 'applied') report.anyApplied = true;
      if (next.lastError?.retryable && next.state === p.state) report.failures.push({ proposal: p.id, message: next.lastError.message, retryable: true, retryAfterMs: null });
    } catch (e) {
      const x = e as { message?: string; retryable?: boolean; retryAfterMs?: number | null };
      report.failures.push({ proposal: p.id, message: String(x.message ?? 'Unexpected error').slice(0, 240), retryable: x.retryable ?? true, retryAfterMs: x.retryAfterMs ?? null });
    }
  }

  if (!narrowed && t.github.listStudio) {
    try {
      const known = new Set(store.list().map((p) => p.branch));
      const all = await t.github.listStudio();
      report.orphans = all.filter((pr) => pr.head && !known.has(pr.head)).map((pr) => ({ number: pr.number, url: pr.url, head: pr.head!, state: pr.state }));
      report.orphanCheck = 'done';
    } catch (e) {
      report.orphanCheck = { failed: String((e as Error).message).slice(0, 200) };
    }
  }
  report.canonicalCommit = t.service.canonical().commit;
  g.__studioReconcile = report;
  return report;
}
