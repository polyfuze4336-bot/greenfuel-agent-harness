import { guard, ok, problem } from '@/lib/api.ts';
import { compareAlternatives } from '@/lib/intel/compare.ts';
import { duplicatesFor } from '@/lib/intel/duplicates.ts';
import { getModel } from '@/lib/repo/index.ts';

export const dynamic = 'force-dynamic';

export function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await ctx.params;
    const m = await getModel();
    const d = m.register.records.find((x) => x.id === id);
    if (!d) return problem(404, 'Decision not found', `No decision with id "${id.slice(0, 40)}" at commit ${m.repo.commitShort}.`);
    return ok({
      commit: m.repo.commit,
      decision: d,
      duplicates: duplicatesFor(d.id, m.register.duplicates),
      suggestions: m.register.suggestions.filter((s) => s.decisionId === d.id),
      alternatives: compareAlternatives(d, m.register.suggestions),
    });
  });
}
