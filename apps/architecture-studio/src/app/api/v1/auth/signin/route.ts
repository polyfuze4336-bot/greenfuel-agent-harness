import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { guard, problem } from '@/lib/api.ts';
import { authConfig } from '@/lib/auth/config.ts';
import { establishSession, setSessionCookie } from '@/lib/auth/login.ts';
import { runtime, sameOrigin } from '@/lib/workflow/http.ts';
import { isTestMode } from '@/lib/workflow/runtime.ts';

export const dynamic = 'force-dynamic';

/**
 * Development sign-in: the GitHub account configured on this computer, confirmed by GitHub. It exists only outside Entra mode and
 * is labelled as development everywhere. In Entra mode this route refuses, so there is no weaker way in.
 */
export function POST(req: NextRequest) {
  return guard(async () => {
    if (authConfig().mode === 'entra') return problem(404, 'Not available', 'This server signs people in with Microsoft Entra ID.', 'use-entra');
    if (!sameOrigin(req)) return problem(403, 'Cross-origin request refused', 'Sign in from this application, in this browser.', 'bad-origin');
    const { service } = runtime();
    let user;
    try {
      user = await service.deps.identity.verify();
    } catch (e) {
      // Not `instanceof`: the error comes from a service created in another route's bundle.
      const o = e as { name?: string; code?: string; message?: string } | null;
      const code = o?.name === 'IdentityError' && typeof o.code === 'string' ? o.code : 'GH_UNAVAILABLE';
      const message = o?.name === 'IdentityError' && o.message ? o.message : 'GitHub could not confirm who you are.';
      service.deps.store.audit({ at: new Date().toISOString(), actor: null, decisionId: null, action: 'signin', outcome: 'denied', code, detail: message.slice(0, 300), proposalId: null });
      return problem(code === 'GH_UNAVAILABLE' ? 503 : 401, 'Sign-in refused', message, code);
    }
    const e = establishSession(user);
    if (!e.ok) return problem(403, 'Sign-in refused', e.message, e.code);
    const res = NextResponse.json({ authenticated: true, csrf: e.session.csrf, testMode: isTestMode(), mode: 'github-dev', user: { login: user.login, name: user.name, verifiedBy: user.verifiedBy, roles: e.roles, listed: true, provider: user.provider } }, { headers: { 'Cache-Control': 'no-store' } });
    setSessionCookie(res, e);
    return res;
  }, { public: true });
}
