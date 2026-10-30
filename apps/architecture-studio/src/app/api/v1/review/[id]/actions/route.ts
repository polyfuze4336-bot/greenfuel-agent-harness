import type { NextRequest } from 'next/server';
import { guard, ok, problem } from '@/lib/api.ts';
import { getModel } from '@/lib/repo/index.ts';
import { requireSession, runtime, serviceProblem } from '@/lib/workflow/http.ts';

export const dynamic = 'force-dynamic';

/**
 * Submit ONE action on ONE decision. There is no bulk form of this route: it takes a single decision id in the path and a single
 * action in the body. The result is a proposal; the decision does not change until a person merges the pull request.
 */
export function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id: raw } = await ctx.params;
    const id = decodeURIComponent(raw);
    const { service } = runtime();
    const s = requireSession(req);
    if (s instanceof Response) {
      service.deps.store.audit({ at: new Date().toISOString(), actor: null, decisionId: id.slice(0, 20), action: 'submit', outcome: 'denied', code: s.status === 401 ? 'unauthenticated' : 'bad-request', detail: `HTTP ${s.status}`, proposalId: null });
      return s;
    }
    if (Number(req.headers.get('content-length') ?? 0) > 40_000) return problem(413, 'Request too large', 'The request is too large.');
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return problem(400, 'Invalid body', 'Send one JSON object describing one action.');
    const m = await getModel({ fresh: true });
    const d = m.register.records.find((r) => r.id === id);
    if (!d) return problem(404, 'Decision not found', `No decision ${id.slice(0, 20)} in the register.`);
    try {
      const { proposal, duplicate } = await service.submit(s.user, d, {
        action: body.action as never,
        expectedRevision: body.expectedRevision as string,
        idempotencyKey: body.idempotencyKey as string,
        optionKey: typeof body.optionKey === 'string' ? body.optionKey : null,
        rationale: typeof body.rationale === 'string' ? body.rationale : null,
        comment: typeof body.comment === 'string' ? body.comment : null,
        conditions: Array.isArray(body.conditions) ? (body.conditions as unknown[]).filter((c): c is string => typeof c === 'string') : null,
      });
      // Send it to GitHub straight away. If GitHub cannot be reached the proposal is kept and can be retried.
      const current = duplicate ? proposal : await service.sync(proposal.id);
      return ok({ duplicate, proposal: current });
    } catch (e) {
      return serviceProblem(e) ?? Promise.reject(e);
    }
  });
}
