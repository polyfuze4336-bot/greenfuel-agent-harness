// Starting and ending sessions. Shared by the development sign-in and the Entra callback so both apply the same rules.
import { NextResponse } from 'next/server';
import type { Principal } from './authorize.ts';
import { effectiveRoles } from './authorize.ts';
import { authConfig, authContextFor } from './config.ts';
import type { Role } from './model.ts';
import type { SessionWithToken } from './sessions.ts';
import { COOKIE, runtime } from '../workflow/http.ts';

export type Established = { ok: true; session: SessionWithToken; roles: Role[]; absoluteSeconds: number } | { ok: false; code: string; message: string };

/** Creates a session for a verified person, or refuses. A person with no role at all gets no session. */
export function establishSession(principal: Principal): Established {
  const rt = runtime();
  const policy = rt.service.policy();
  const ctx = authContextFor(policy);
  const { roles, notes } = effectiveRoles(principal, ctx);
  const audit = (outcome: 'signin' | 'denied', code: string | null, detail: string) => rt.service.deps.store.audit({ at: new Date().toISOString(), actor: principal.login, decisionId: null, action: 'signin', outcome, code, detail: detail.slice(0, 300), proposalId: null });
  if (policy.pinMismatch) {
    audit('denied', 'policy-invalid', policy.problems[0] ?? 'The access policy is not trusted.');
    return { ok: false, code: 'policy-invalid', message: 'The access policy is not trusted by this server, so nobody can sign in.' };
  }
  if (!roles.length) {
    audit('denied', 'no-access', `No role for ${principal.provider}:${principal.subject}. ${notes.join(' ')}`);
    return { ok: false, code: 'no-access', message: 'You are signed in to Microsoft but have no role in the Architecture Studio.' };
  }
  const session = rt.sessions.create(principal, { idleMinutes: policy.session.idleMinutes, absoluteHours: policy.session.absoluteHours });
  audit('signin', null, `${principal.verifiedBy}; roles ${roles.join('+')}; mfa ${principal.mfa ? 'yes' : 'no'}${notes.length ? `; ${notes.join(' ')}` : ''}`);
  return { ok: true, session, roles, absoluteSeconds: policy.session.absoluteHours * 3600 };
}

/** The cookie. Lax, not Strict: Strict is withheld on the redirect that returns from Microsoft and would look like a failed sign-in. CSRF is covered by the origin check and the per-session header. */
export function setSessionCookie(res: NextResponse, e: Extract<Established, { ok: true }>) {
  res.cookies.set(COOKIE, e.session.token, { httpOnly: true, sameSite: 'lax', secure: authConfig().secureCookies, path: '/', maxAge: e.absoluteSeconds });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: authConfig().secureCookies, path: '/', maxAge: 0 });
}

/** Only a path on this site: no scheme, no host, no protocol-relative form. */
export const safeNext = (v: string | null | undefined): string => (v && /^\/(?!\/)[A-Za-z0-9\-._~/%?=&#]*$/.test(v) && !v.startsWith('/api/') ? v : '/');
