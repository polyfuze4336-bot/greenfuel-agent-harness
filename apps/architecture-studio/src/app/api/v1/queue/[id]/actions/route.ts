import type { NextRequest } from 'next/server';
import { guard, ok, problem } from '@/lib/api.ts';
import { invalidateModel } from '@/lib/repo/index.ts';
import { getQueue, invalidateQueue } from '@/lib/queue/server.ts';
import { requireSession, runtime, serviceProblem } from '@/lib/workflow/http.ts';

export const dynamic = 'force-dynamic';

const strings = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === 'string') : null);
const str = (v: unknown) => (typeof v === 'string' ? v : null);

/**
 * Submit ONE action on ONE work item. The result is a proposal: the item changes only after a person merges the pull request.
 * There is no bulk form of this route.
 */
export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id: raw } = await ctx.params;
    const id = decodeURIComponent(raw);
    const { work } = runtime();
    const s = requireSession(req);
    if (s instanceof Response) {
      work.deps.store.audit({ at: new Date().toISOString(), actor: null, decisionId: `work:${id.slice(0, 20)}`, action: 'submit', outcome: 'denied', code: s.status === 401 ? 'unauthenticated' : 'bad-request', detail: `HTTP ${s.status}`, proposalId: null });
      return s;
    }
    if (Number(req.headers.get('content-length') ?? 0) > 40_000) return problem(413, 'Request too large', 'The request is too large.');
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return problem(400, 'Invalid body', 'Send one JSON object describing one action.');
    const q = await getQueue();
    const item = q.snapshot.items.find((i) => i.id === id);
    if (!item) return problem(404, 'Work item not found', `No work item ${id.slice(0, 20)} in the queue.`);
    try {
      const { proposal, duplicate } = await work.submit(
        s.user,
        item,
        {
          action: body.action as never,
          expectedRevision: body.expectedRevision as string,
          idempotencyKey: body.idempotencyKey as string,
          assignee: str(body.assignee),
          priority: str(body.priority),
          dueDate: str(body.dueDate),
          rationale: str(body.rationale),
          comment: str(body.comment),
          evidence: strings(body.evidence),
          blockedBy: strings(body.blockedBy),
        },
        { evidenceRuns: q.evidenceRuns, knownItems: new Set(q.snapshot.items.map((i) => i.id)) },
      );
      const current = duplicate ? proposal : await work.sync(proposal.id);
      if (current.state === 'applied') {
        invalidateModel();
        invalidateQueue();
      }
      return ok({ duplicate, proposal: current });
    } catch (e) {
      return serviceProblem(e) ?? Promise.reject(e);
    }
  });
}
