import { guard, ok, problem } from '@/lib/api.ts';
import { getModel } from '@/lib/repo/index.ts';

export const dynamic = 'force-dynamic';

export function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await ctx.params;
    const m = await getModel();
    const d = m.decisions.find((x) => x.id === id);
    if (!d) return problem(404, 'Decision not found', `No decision with id "${id.slice(0, 40)}" at commit ${m.repo.commitShort}.`);
    return ok({ commit: m.repo.commit, decision: d });
  });
}
