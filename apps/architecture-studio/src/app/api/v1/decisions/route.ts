import type { NextRequest } from 'next/server';
import { guard, ok } from '@/lib/api.ts';
import { getModel } from '@/lib/repo/index.ts';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return guard(async () => {
    const m = await getModel();
    const q = req.nextUrl.searchParams;
    const status = q.get('status');
    const type = q.get('type');
    const milestone = q.get('milestone');
    const items = m.decisions.filter((d) => (!status || d.status === status) && (!type || d.type === type) && (!milestone || d.milestone === milestone));
    return ok({ commit: m.repo.commit, count: items.length, items });
  });
}
