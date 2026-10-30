import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { guard, problem } from '@/lib/api.ts';
import { clearSessionCookie } from '@/lib/auth/login.ts';
import { COOKIE, runtime, sameOrigin } from '@/lib/workflow/http.ts';

export const dynamic = 'force-dynamic';

export function POST(req: NextRequest) {
  return guard(async () => {
    if (!sameOrigin(req)) return problem(403, 'Cross-origin request refused', 'Sign out from this application.', 'bad-origin');
    const { service, sessions } = runtime();
    const token = req.cookies.get(COOKIE)?.value;
    const s = sessions.get(token);
    if (s) {
      sessions.destroy(token);
      service.deps.store.audit({ at: new Date().toISOString(), actor: s.user.login, decisionId: null, action: 'signout', outcome: 'signout', code: null, detail: null, proposalId: null });
    }
    const res = NextResponse.json({ authenticated: false }, { headers: { 'Cache-Control': 'no-store' } });
    clearSessionCookie(res);
    return res;
  }, { public: true });
}
