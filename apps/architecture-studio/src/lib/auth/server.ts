// Server-side access checks that need the request: who is signed in, and whether they may read at all.
// In Entra mode every API response and every page is behind this, so "Viewer" is a real server-side role and not a hidden menu.
import { cookies } from 'next/headers';
import { authorizeAccess } from './authorize.ts';
import { authConfig, authContextFor } from './config.ts';
import type { Session } from './sessions.ts';
import { COOKIE, runtime } from '../workflow/http.ts';

export async function serverSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return runtime().sessions.get(token);
}

const json = (status: number, title: string, detail: string, code: string) =>
  Response.json({ type: 'about:blank', title, status, detail, code }, { status, headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store' } });

/** Throws unless the caller may read. For pages and data loaders, which cannot return a response. Entra mode only. */
export async function assertMayRead(): Promise<void> {
  const denied = await readGate();
  if (denied) {
    const e = new Error('Sign in to read the Architecture Studio.');
    e.name = 'AccessDeniedError';
    throw e;
  }
}

/** Null if the caller may read. Otherwise the response to send. A no-op outside Entra mode, which is development only and loopback only. */
export async function readGate(): Promise<Response | null> {
  if (authConfig().mode !== 'entra') return null;
  const rt = runtime();
  const token = (await cookies()).get(COOKIE)?.value;
  const s = rt.sessions.get(token);
  const a = authorizeAccess(s?.user ?? null, 'read', authContextFor(rt.service.policy()));
  if (a.ok) return null;
  if (!s) {
    const why = rt.sessions.whyEnded(token);
    return json(401, 'Sign in required', why === 'idle' ? 'Your session ended after a period of inactivity. Sign in again.' : why === 'absolute' ? 'Your session reached its maximum length. Sign in again.' : why === 'revoked' ? 'Your session was revoked. Sign in again.' : 'Sign in with Microsoft to use the Architecture Studio.', why === 'unknown' ? 'unauthenticated' : `session-${why}`);
  }
  // Signed in, but no longer allowed to read (for example the role was removed). End the session rather than keep a dead one.
  rt.sessions.revokeSubject(`${s.user.provider}:${s.user.subject}`);
  return json(403, 'No access', a.reason ?? 'You have no role in the Architecture Studio.', a.code ?? 'no-access');
}
