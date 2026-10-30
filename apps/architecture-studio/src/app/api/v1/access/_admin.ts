// Shared by the administration routes: the caller must be signed in, pass the origin and CSRF checks, and hold the permission.
import type { NextRequest } from 'next/server';
import { problem } from '@/lib/api.ts';
import { authorizeAccess } from '@/lib/auth/authorize.ts';
import { authContextFor } from '@/lib/auth/config.ts';
import type { Session } from '@/lib/auth/sessions.ts';
import { currentSession, requireSession, runtime } from '@/lib/workflow/http.ts';

export function requireAdmin(req: NextRequest, permission: 'access:review' | 'access:administer', opts: { csrf?: boolean } = {}): Session | Response {
  // A read (the review report) needs only the session. A change also needs the origin, the JSON content type and the CSRF token.
  const s = opts.csrf === false ? (currentSession(req) ?? problem(401, 'Sign in first', 'Every action needs a verified identity.', 'unauthenticated')) : requireSession(req, opts);
  if (s instanceof Response) return s;
  const rt = runtime();
  const a = authorizeAccess(s.user, permission, authContextFor(rt.service.policy()));
  if (!a.ok) {
    rt.service.deps.store.audit({ at: new Date().toISOString(), actor: s.user.login, decisionId: null, action: `access:${permission}`, outcome: 'denied', code: a.code ?? 'forbidden', detail: a.reason?.slice(0, 200) ?? null, proposalId: null });
    return problem(a.status === 401 ? 401 : 403, 'Not permitted', a.reason ?? 'Your role does not allow this.', a.code ?? 'forbidden');
  }
  return s;
}
