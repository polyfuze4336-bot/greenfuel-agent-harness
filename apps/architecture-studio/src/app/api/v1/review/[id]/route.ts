import type { NextRequest } from 'next/server';
import { guard, ok, problem } from '@/lib/api.ts';
import { pendingOrder } from '@/lib/workflow/runtime.ts';
import { timelineOf } from '@/lib/workflow/context.ts';
import { currentSession, runtime } from '@/lib/workflow/http.ts';
import { openAdapter, getModel } from '@/lib/repo/index.ts';
import { GitRepositoryAdapter } from '@/lib/repo/git.ts';
import { eventPath } from '@/lib/workflow/events.ts';

export const dynamic = 'force-dynamic';

/** Everything the review rail needs: current state, what each action would do, history, and where to go next. */
export function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id: raw } = await ctx.params;
    const id = decodeURIComponent(raw);
    const m = await getModel();
    const d = m.register.records.find((r) => r.id === id);
    if (!d) return problem(404, 'Decision not found', `No decision ${id.slice(0, 20)} in the register.`);
    const { service } = runtime();
    const session = currentSession(req);
    const view = service.view(d, session?.user ?? null);
    const proposals = service.deps.store.forDecision(id);
    const commits = openAdapter().log(8, [d.source.path]);
    // The commit on the canonical branch that carries each review record: the answer to which GitHub commit this decision came from.
    const eventCommits: Record<string, { sha: string; date: string; subject: string }> = {};
    try {
      const canon = new GitRepositoryAdapter(service.deps.root, service.deps.canonicalRef).open();
      for (const e of view.canonical.state.events) {
        const p = eventPath(e.decisionId, e.seq, e.action);
        const c = canon.log(1, [p], canon.commit)[0];
        if (c) eventCommits[p] = { sha: c.sha, date: c.date, subject: c.subject };
      }
    } catch {
      /* the canonical ref is unreadable: the timeline simply has no commit to show */
    }
    const order = pendingOrder(m.register.records, (x) => !!service.deps.store.openFor(x), service.policy());
    const at = order.findIndex((r) => r.id === id);
    const pick = (r: (typeof order)[number] | undefined) => (r ? { id: r.id, title: r.title } : null);
    const next = at >= 0 ? order[at + 1] : order[0];
    const prev = at > 0 ? order[at - 1] : undefined;
    return ok({
      view,
      status: d.status,
      timeline: timelineOf(d, view.canonical.state, proposals, commits, eventCommits),
      audit: service.deps.store.readAudit({ decisionId: id, limit: 15 }),
      next: pick(next),
      previous: pick(prev),
      pending: { total: order.length, position: at >= 0 ? at + 1 : null },
    });
  });
}
