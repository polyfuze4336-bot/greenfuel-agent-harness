import type { NextRequest } from 'next/server';
import { guard, ok } from '@/lib/api.ts';
import { getModel } from '@/lib/repo/index.ts';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return guard(async () => {
    const m = await getModel();
    const q = req.nextUrl.searchParams;
    const status = q.get('status');
    const blocked = q.get('blocked');
    const items = m.tasks.filter((t) => (!status || t.status === status) && (blocked === null || String(t.blocked) === blocked));
    return ok({ commit: m.repo.commit, count: items.length, items });
  });
}
