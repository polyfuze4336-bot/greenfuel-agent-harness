import type { NextRequest } from 'next/server';
import { guard, ok, problem } from '@/lib/api.ts';
import { buildGraph, impactOf, dependentsOf } from '@/lib/queue/graph.ts';
import { getQueue } from '@/lib/queue/server.ts';
import { currentSession, runtime } from '@/lib/workflow/http.ts';

export const dynamic = 'force-dynamic';

/** One work item: what the actions would do for the signed-in person, its history, and what depends on it. */
export function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id: raw } = await ctx.params;
    const id = decodeURIComponent(raw);
    const q = await getQueue();
    const item = q.snapshot.items.find((i) => i.id === id);
    if (!item) return problem(404, 'Work item not found', `No work item ${id.slice(0, 20)} in the queue.`);
    const { work } = runtime();
    const session = currentSession(req);
    const view = work.view(item, session?.user ?? null, q.canonical);
    const items = new Map(q.snapshot.items.map((i) => [i.id, i]));
    const graph = buildGraph(q.snapshot.items, q.snapshot.edges, q.snapshot.refNodes);
    const dependents = dependentsOf(graph, id).map((d) => ({ ...d, title: items.get(d.id)?.title ?? q.snapshot.refNodes.find((r) => r.id === d.id)?.title ?? d.id, status: items.get(d.id)?.status ?? null }));
    // For a decision, show what each outcome would touch before anyone decides.
    const ctxImpact = { graph, items, artefactsFor: () => [] };
    const scenarios =
      item.kind === 'decision'
        ? {
            ifRejected: { ...impactOf(ctxImpact, id, 'rejected'), artefacts: q.snapshot.impacts.find((x) => x.decisionId === id)?.artefacts ?? [] },
            ifDeferred: impactOf(ctxImpact, id, 'deferred-critical'),
          }
        : null;
    return ok({
      item,
      view,
      dependents,
      scenarios,
      activeImpact: q.snapshot.impacts.find((x) => x.decisionId === id) ?? null,
      audit: work.deps.store.readAudit({ decisionId: `work:${id}`, limit: 15 }),
    });
  });
}
