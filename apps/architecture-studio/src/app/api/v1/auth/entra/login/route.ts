import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { guard } from '@/lib/api.ts';
import { authConfig } from '@/lib/auth/config.ts';
import { safeNext } from '@/lib/auth/login.ts';
import { runtime } from '@/lib/workflow/http.ts';

export const dynamic = 'force-dynamic';

/**
 * Starts Microsoft Entra ID sign-in. `?reauth=1` forces a fresh interactive login (needed to approve). The browser is sent to
 * Microsoft with a one-time state, nonce and PKCE challenge; a cookie ties the answer to this browser.
 */
export function GET(req: NextRequest) {
  return guard(async () => {
    const rt = runtime();
    const back = (code: string) => NextResponse.redirect(new URL(`/login?error=${code}`, req.url), { headers: { 'Cache-Control': 'no-store' } });
    if (!rt.entra) return back('not-configured');
    const reauth = req.nextUrl.searchParams.get('reauth') === '1';
    const policy = rt.service.policy();
    let started;
    try {
      started = await rt.entra.begin({ reauth, maxAgeSeconds: policy.session.approvalMaxAuthAgeMinutes * 60 });
    } catch {
      return back('idp-unreachable');
    }
    const res = NextResponse.redirect(started.url, { headers: { 'Cache-Control': 'no-store' } });
    const secure = authConfig().secureCookies;
    // Lax so it is sent when Microsoft redirects back; scoped to the callback only, short-lived.
    res.cookies.set('studio_oidc', started.bindingCookie, { httpOnly: true, sameSite: 'lax', secure, path: '/api/v1/auth/entra', maxAge: 600 });
    res.cookies.set('studio_next', safeNext(req.nextUrl.searchParams.get('next')), { httpOnly: true, sameSite: 'lax', secure, path: '/api/v1/auth/entra', maxAge: 600 });
    return res;
  }, { public: true });
}
