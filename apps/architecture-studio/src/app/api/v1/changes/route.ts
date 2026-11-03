import type { NextRequest } from 'next/server';
import { guard, ok } from '@/lib/api.ts';
import { lastReconcile } from '@/lib/github/reconcile.ts';
import { affectedTasks, baselineChanges, decisionHistory } from '@/lib/next/changes.ts';
import { getNextView } from '@/lib/next/server.ts';
import { currentSession, runtime } from '@/lib/workflow/http.ts';
import { isOpen } from '@/lib/workflow/store.ts';

export const dynamic = 'force-dynamic';

/** What is moving, what has gone stale and what a change touches, from the same facts the Changes page shows. Read-only. */
export function GET(req: NextRequest) {
  return guard(async () => {
    const v = await getNextView(currentSession(req));
    const proposals = runtime().service.deps.store.list();
    return ok({
      commit: v.commit,
      freshness: v.freshness,
      readiness: v.overview.readiness,
      progress: v.overview.progress,
      syncFailures: proposals.filter((p) => p.state === 'failed' || p.state === 'conflicted').map((p) => ({ id: p.id, subject: p.decisionId, action: p.action, state: p.state, error: p.lastError?.message ?? null, prNumber: p.prNumber })),
      pending: proposals.filter((p) => isOpen(p.state)).map((p) => ({ id: p.id, subject: p.decisionId, action: p.action, state: p.state, prNumber: p.prNumber, prUrl: p.prUrl })),
      lastReconcile: lastReconcile(),
      decisionHistory: decisionHistory(v.queue.model.register.records, 20),
      baselineChanges: baselineChanges(v.baseline.baselines),
      staleEvidence: v.stale,
      affectedTasks: affectedTasks(v.queue.snapshot.items),
    });
  });
}
