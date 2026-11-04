import type { NextRequest } from 'next/server';
import { guard, ok, problem } from '@/lib/api.ts';
import { denial } from '@/lib/deck/auth.ts';
import { reconcile } from '@/lib/github/reconcile.ts';
import { invalidateModel } from '@/lib/repo/index.ts';
import { invalidateQueue } from '@/lib/queue/server.ts';
import { requireSession, runtime } from '@/lib/workflow/http.ts';

export const dynamic = 'force-dynamic';

/** Re-check every open proposal against GitHub and list what GitHub holds that the Studio does not know about. Needs the permission to propose, because it can push and open pull requests. */
export function POST(req: NextRequest) {
  return guard(async () => {
    const s = requireSession(req);
    if (s instanceof Response) return s;
    const why = denial(req, 'propose');
    if (why) return problem(403, 'Not permitted', why, 'forbidden');
    const report = await reconcile(runtime(), { trigger: `manual:${s.user.login}` });
    if (report.anyApplied) {
      invalidateModel();
      invalidateQueue();
    }
    return ok(report);
  });
}
