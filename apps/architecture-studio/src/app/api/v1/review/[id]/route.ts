import type { NextRequest } from 'next/server';
import { guard, ok, problem } from '@/lib/api.ts';
import { pendingOrder } from '@/lib/workflow/runtime.ts';
import { timelineOf } from '@/lib/workflow/context.ts';
import { currentSession, runtime } from '@/lib/workflow/http.ts';
import { openAdapter, getModel } from '@/lib/repo/index.ts';

export const dynamic = 'force-dynamic';

/** Everything the review rail needs: current state, what each action would do, history, and where to go next. */
export function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id: raw } = await ctx.params;
    const id = decodeURIComponent(raw);
    const m = await getModel({ fresh: true });
    const d = m.register.records.find((r) => r.id === id);
    if (!d) return problem(404, 'Decision not found', `No decision ${id.slice(0, 20)} in the register.`);
    const { service } = runtime();
    const session = currentSession(req);
    const view = service.view(d, session?.user ?? null);
    const proposals = service.deps.store.forDecision(id);
    const commits = openAdapter().log(8, [d.source.path]);
    const order = pendingOrder(m.register.records, (x) => !!service.deps.store.openFor(x));
    const at = order.findIndex((r) => r.id === id);
    const pick = (r: (typeof order)[number] | undefined) => (r ? { id: r.id, title: r.title } : null);
    const next = at >= 0 ? order[at + 1] : order[0];
    const prev = at > 0 ? order[at - 1] : undefined;
    return ok({
      view,
      status: d.status,
      timeline: timelineOf(d, view.canonical.state, proposals, commits),
      audit: service.deps.store.readAudit({ decisionId: id, limit: 15 }),
      next: pick(next),
      previous: pick(prev),
      pending: { total: order.length, position: at >= 0 ? at + 1 : null },
    });
  });
}
