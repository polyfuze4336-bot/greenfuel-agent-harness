import type { NextRequest } from 'next/server';
import { guard, ok, problem } from '@/lib/api.ts';
import { STATUSES } from '@/lib/intel/schema.ts';
import { getModel } from '@/lib/repo/index.ts';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return guard(async () => {
    const m = await getModel();
    const q = req.nextUrl.searchParams;
    const status = q.get('status');
    const type = q.get('type');
    const milestone = q.get('milestone');
    if (status && !(STATUSES as readonly string[]).includes(status)) return problem(400, 'Unknown status', `status must be one of ${STATUSES.join(', ')}.`);
    const kind = type === 'adr' ? 'adr' : type === 'register' ? 'register-entry' : null;
    const items = m.register.records.filter((d) => (!status || d.status === status) && (!kind || d.kind === kind) && (!milestone || d.milestone === milestone));
    return ok({ commit: m.repo.commit, count: items.length, items });
  });
}
