import { guard, ok, problem } from '@/lib/api.ts';
import { examinerFor } from '@/lib/examiner/server.ts';

export const dynamic = 'force-dynamic';

/** The Architecture Examiner's challenge to one decision: a rule-based dossier, the ready prompt for the critic agents, and any AI challenge committed for it. Changes nothing. */
export function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await ctx.params;
    const d = await examinerFor(decodeURIComponent(id));
    if (!d) return problem(404, 'Decision not found', `No decision with id "${id.slice(0, 40)}" at this commit.`);
    return ok(d);
  });
}
