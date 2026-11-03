import type { NextRequest } from 'next/server';
import { guard, ok } from '@/lib/api.ts';
import { getNextView } from '@/lib/next/server.ts';
import { currentSession } from '@/lib/workflow/http.ts';

export const dynamic = 'force-dynamic';

/** What to do next, and why, from deterministic rules over repository facts. No model is involved. Read-only. */
export function GET(req: NextRequest) {
  return guard(async () => {
    const v = await getNextView(currentSession(req));
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit')) || 60, 1), 500);
    return ok({ commit: v.commit, canonicalCommit: v.canonicalCommit, me: v.me ? { login: v.me.login, roles: v.me.roles } : null, overview: v.overview, actions: v.actions.slice(0, limit), totalActions: v.actions.length, stale: v.stale, freshness: v.freshness });
  });
}
