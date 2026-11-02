import type { NextRequest } from 'next/server';
import { guard, ok } from '@/lib/api.ts';
import { getModel } from '@/lib/repo/index.ts';
import { runtime } from '@/lib/workflow/http.ts';
import { pendingOrder } from '@/lib/workflow/runtime.ts';

export const dynamic = 'force-dynamic';

/** The next decision waiting for a person, after the given one (or the first). */
export function GET(req: NextRequest) {
  return guard(async () => {
    const after = req.nextUrl.searchParams.get('after');
    const m = await getModel();
    const { service } = runtime();
    const order = pendingOrder(m.register.records, (x) => !!service.deps.store.openFor(x), service.policy());
    const at = after ? order.findIndex((r) => r.id === after) : -1;
    const next = order[at + 1] ?? null;
    return ok({ total: order.length, next: next ? { id: next.id, title: next.title } : null });
  });
}
