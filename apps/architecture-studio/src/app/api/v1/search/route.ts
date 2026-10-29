import type { NextRequest } from 'next/server';
import { guard, ok, problem } from '@/lib/api.ts';
import { getModel } from '@/lib/repo/index.ts';
import { search, type SearchKind } from '@/lib/search.ts';

export const dynamic = 'force-dynamic';

const KINDS: SearchKind[] = ['decision', 'task', 'requirement', 'risk', 'assumption', 'document'];

export function GET(req: NextRequest) {
  return guard(async () => {
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
    if (q.length > 120) return problem(400, 'Query too long', 'Search queries are limited to 120 characters.');
    const kind = req.nextUrl.searchParams.get('kind');
    if (kind && !KINDS.includes(kind as SearchKind)) return problem(400, 'Unknown kind', `kind must be one of ${KINDS.join(', ')}.`);
    const m = await getModel();
    const hits = search(m, q, kind ? [kind as SearchKind] : undefined);
    return ok({ commit: m.repo.commit, query: q, count: hits.length, hits });
  });
}
