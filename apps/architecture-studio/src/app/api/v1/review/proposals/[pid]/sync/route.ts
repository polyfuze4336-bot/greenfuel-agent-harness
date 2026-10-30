import type { NextRequest } from 'next/server';
import { guard, ok } from '@/lib/api.ts';
import { requireSession, runtime, serviceProblem } from '@/lib/workflow/http.ts';

export const dynamic = 'force-dynamic';

/** Move a proposal forward and report where it stands: push, open the pull request, or check whether it was merged. */
export function POST(req: NextRequest, ctx: { params: Promise<{ pid: string }> }) {
  return guard(async () => {
    const s = requireSession(req);
    if (s instanceof Response) return s;
    const { pid } = await ctx.params;
    try {
      const proposal = await runtime().service.sync(decodeURIComponent(pid));
      return ok({ proposal });
    } catch (e) {
      return serviceProblem(e) ?? Promise.reject(e);
    }
  });
}
