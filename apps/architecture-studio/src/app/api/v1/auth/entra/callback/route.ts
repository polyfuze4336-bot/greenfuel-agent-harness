import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { guard } from '@/lib/api.ts';
import { establishSession, safeNext, setSessionCookie } from '@/lib/auth/login.ts';
import { runtime } from '@/lib/workflow/http.ts';

export const dynamic = 'force-dynamic';

/**
 * The return from Microsoft. State, nonce, PKCE, the browser cookie and every ID-token check happen in EntraClient.complete; if
 * any fails nothing is created. On success the session is new (the old token, if any, is never reused).
 */
export function GET(req: NextRequest) {
  return guard(async () => {
    const rt = runtime();
    const fail = (code: string, detail: string) => {
      rt.service.deps.store.audit({ at: new Date().toISOString(), actor: null, decisionId: null, action: 'signin', outcome: 'denied', code, detail: detail.slice(0, 300), proposalId: null });
      const res = NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(code)}`, req.url), { headers: { 'Cache-Control': 'no-store' } });
      res.cookies.set('studio_oidc', '', { path: '/api/v1/auth/entra', maxAge: 0 });
      return res;
    };
    if (!rt.entra) return fail('not-configured', 'Entra sign-in is not configured.');
    const q = req.nextUrl.searchParams;
    let result;
    try {
      result = await rt.entra.complete({ code: q.get('code'), state: q.get('state'), error: q.get('error'), bindingCookie: req.cookies.get('studio_oidc')?.value });
    } catch (e) {
      const o = e as { name?: string; code?: string; message?: string };
      return fail(o.name === 'EntraError' && o.code ? o.code : 'sign-in-failed', o.name === 'EntraError' ? (o.message ?? 'Sign-in failed.') : 'Sign-in failed.');
    }
    const est = establishSession(result.principal);
    if (!est.ok) return fail(est.code, est.message);
    const res = NextResponse.redirect(new URL(safeNext(req.cookies.get('studio_next')?.value), req.url), { headers: { 'Cache-Control': 'no-store' } });
    setSessionCookie(res, est);
    res.cookies.set('studio_oidc', '', { path: '/api/v1/auth/entra', maxAge: 0 });
    res.cookies.set('studio_next', '', { path: '/api/v1/auth/entra', maxAge: 0 });
    return res;
  }, { public: true });
}
