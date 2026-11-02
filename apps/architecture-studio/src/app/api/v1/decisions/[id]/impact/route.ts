import type { NextRequest } from 'next/server';
import { guard, ok, problem } from '@/lib/api.ts';
import { impactFor } from '@/lib/impact/server.ts';
import { IMPACT_ACTIONS, type ImpactAction } from '@/lib/impact/types.ts';

export const dynamic = 'force-dynamic';

/** What would follow if this decision were approved, rejected, deferred or sent back for revision. Computed from explicit repository references; changes nothing. */
export function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await ctx.params;
    const action = (req.nextUrl.searchParams.get('action') ?? 'approve') as ImpactAction;
    if (!IMPACT_ACTIONS.includes(action)) return problem(400, 'Unknown action', `action must be one of ${IMPACT_ACTIONS.join(', ')}.`, 'bad-action');
    const r = await impactFor(decodeURIComponent(id), action);
    if (!r) return problem(404, 'Decision not found', `No decision with id "${id.slice(0, 40)}" at this commit.`);
    return ok(r);
  });
}
