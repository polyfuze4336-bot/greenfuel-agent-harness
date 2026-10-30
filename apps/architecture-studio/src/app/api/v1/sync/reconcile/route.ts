import type { NextRequest } from 'next/server';
import { guard, ok } from '@/lib/api.ts';
import { reconcile } from '@/lib/github/reconcile.ts';
import { invalidateModel } from '@/lib/repo/index.ts';
import { invalidateQueue } from '@/lib/queue/server.ts';
import { requireSession, runtime } from '@/lib/workflow/http.ts';

export const dynamic = 'force-dynamic';

/** Re-check every open proposal against GitHub and list what GitHub holds that the Studio does not know about. */
export function POST(req: NextRequest) {
  return guard(async () => {
    const s = requireSession(req);
    if (s instanceof Response) return s;
    const report = await reconcile(runtime(), { trigger: `manual:${s.user.login}` });
    if (report.anyApplied) {
      invalidateModel();
      invalidateQueue();
    }
    return ok(report);
  });
}
