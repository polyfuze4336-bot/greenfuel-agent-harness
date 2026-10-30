// HTTP guards for the routes that change anything. A request is accepted only if all of these hold:
//   - it comes from this origin (so another web page cannot make the browser call the API);
//   - it carries the session cookie AND the matching CSRF header;
//   - the session is alive.
// The session only says which GitHub account is configured on this computer; see identity.ts for what that does not prove.
import type { NextRequest } from 'next/server';
import { problem } from '../api.ts';
import type { Session } from './identity.ts';
import { reviewRuntime } from './runtime.ts';
import { configuredRef, repoRoot } from '../repo/index.ts';
import { ServiceError } from './review.ts';

export const COOKIE = 'studio_session';

export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function runtime() {
  return reviewRuntime(repoRoot(), configuredRef());
}

export function currentSession(req: NextRequest): Session | null {
  return runtime().sessions.get(req.cookies.get(COOKIE)?.value);
}

/** For a state-changing request. Returns the session or a ready 4xx response. */
export function requireSession(req: NextRequest, opts: { csrf?: boolean } = {}): Session | Response {
  if (!sameOrigin(req)) return problem(403, 'Cross-origin request refused', 'Changes are accepted only from this application, in this browser.', 'bad-origin');
  if (!(req.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) return problem(415, 'JSON required', 'Send application/json.', 'bad-content-type');
  const s = currentSession(req);
  if (!s) return problem(401, 'Sign in first', 'Every action needs a verified GitHub identity.', 'unauthenticated');
  if (opts.csrf !== false && req.headers.get('x-studio-csrf') !== s.csrf) return problem(403, 'Missing or wrong CSRF token', 'Reload the page and try again.', 'bad-csrf');
  return s;
}

export function serviceProblem(e: unknown): Response | null {
  if (e instanceof ServiceError) return Response.json({ type: 'about:blank', title: e.code, status: e.status, detail: e.message, code: e.code, ...e.extra }, { status: e.status, headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store' } });
  return null;
}
