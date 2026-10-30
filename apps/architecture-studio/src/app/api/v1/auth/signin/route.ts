import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { guard, problem } from '@/lib/api.ts';
import { COOKIE, runtime, sameOrigin } from '@/lib/workflow/http.ts';
import { IdentityError } from '@/lib/workflow/identity.ts';
import { isTestMode } from '@/lib/workflow/runtime.ts';

export const dynamic = 'force-dynamic';

/**
 * Sign in as the GitHub account configured on this computer. GitHub confirms who that is (`gh api user`); nothing is typed in,
 * no token is read by the Studio. A Bot or Organization account, and any agent session, is refused.
 */
export function POST(req: NextRequest) {
  return guard(async () => {
    if (!sameOrigin(req)) return problem(403, 'Cross-origin request refused', 'Sign in from this application, in this browser.', 'bad-origin');
    const { service, sessions } = runtime();
    let user;
    try {
      user = await service.deps.identity.verify();
    } catch (e) {
      const err = e instanceof IdentityError ? e : new IdentityError('GH_UNAVAILABLE', 'GitHub could not confirm who you are.');
      service.deps.store.audit({ at: new Date().toISOString(), actor: null, decisionId: null, action: 'signin', outcome: 'denied', code: err.code, detail: err.message.slice(0, 300), proposalId: null });
      return problem(err.code === 'GH_UNAVAILABLE' ? 503 : 401, 'Sign-in refused', err.message, err.code);
    }
    const s = sessions.create(user);
    const policy = service.policy();
    const person = policy.people.find((p) => p.githubLogin.toLowerCase() === user.login.toLowerCase() && p.githubId === user.id);
    service.deps.store.audit({ at: new Date().toISOString(), actor: user.login, decisionId: null, action: 'signin', outcome: 'signin', code: null, detail: `verified by ${user.verifiedBy}${person ? `, roles ${person.roles.join('+') || 'none'}` : ', not a registered approver'}`, proposalId: null });
    const res = NextResponse.json({ authenticated: true, csrf: s.csrf, testMode: isTestMode(), user: { login: user.login, name: user.name, verifiedBy: user.verifiedBy, roles: person?.roles ?? [], listed: !!person } }, { headers: { 'Cache-Control': 'no-store' } });
    res.cookies.set(COOKIE, s.token, { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 8 * 60 * 60 });
    return res;
  });
}
