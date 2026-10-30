// Server-side sessions. The cookie holds only a random token; everything else lives here, on the server, where the browser cannot
// change it. A session ends for any of these reasons, and each is checked on every request:
//   - idle: no request for the idle limit;
//   - absolute: the absolute lifetime has passed, however active it was;
//   - signed out, or revoked by an administrator;
//   - the person's enrollment was revoked (roles are recomputed from the policy on every request, never copied into the session).
// The token is stored only as a hash, so reading the server's memory or a dump of this object does not yield a usable cookie.
import crypto from 'node:crypto';
import type { Principal } from './authorize.ts';

export interface Session {
  /** The sha256 of the cookie token. The token itself is never kept. */
  id: string;
  csrf: string;
  user: Principal;
  createdAt: number;
  lastSeenAt: number;
  idleMs: number;
  absoluteExpiresAt: number;
}

export interface SessionWithToken extends Session {
  token: string;
}

export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export type EndReason = 'idle' | 'absolute' | 'signed-out' | 'revoked' | 'unknown';

export class SessionStore {
  private readonly map = new Map<string, Session>();
  private readonly ended = new Map<string, EndReason>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** A new session with a new token. A sign-in never reuses a token, so a token planted before sign-in is worthless. */
  create(user: Principal, limits: { idleMinutes: number; absoluteHours: number }): SessionWithToken {
    const token = crypto.randomBytes(32).toString('base64url');
    const t = this.now();
    const s: Session = { id: hashToken(token), csrf: crypto.randomBytes(24).toString('base64url'), user, createdAt: t, lastSeenAt: t, idleMs: limits.idleMinutes * 60_000, absoluteExpiresAt: t + limits.absoluteHours * 3_600_000 };
    this.map.set(s.id, s);
    return { ...s, token };
  }

  /** The live session for a token, refreshing its idle clock, or null. */
  get(token: string | undefined): Session | null {
    if (!token) return null;
    const id = hashToken(token);
    const s = this.map.get(id);
    if (!s) return null;
    const t = this.now();
    if (t >= s.absoluteExpiresAt) return this.end(id, 'absolute');
    if (t - s.lastSeenAt >= s.idleMs) return this.end(id, 'idle');
    s.lastSeenAt = t;
    return s;
  }

  /** Why a token no longer works, for a useful message. */
  whyEnded(token: string | undefined): EndReason {
    return (token && this.ended.get(hashToken(token))) || 'unknown';
  }

  private end(id: string, why: EndReason): null {
    this.map.delete(id);
    this.ended.set(id, why);
    if (this.ended.size > 500) this.ended.delete(this.ended.keys().next().value as string);
    return null;
  }

  destroy(token: string | undefined) {
    if (token) this.end(hashToken(token), 'signed-out');
  }

  /** Ends every session of a person, for example when an administrator revokes them. Returns how many ended. */
  revokeSubject(subjectKey: string): number {
    let n = 0;
    for (const [id, s] of this.map) {
      if (`${s.user.provider}:${s.user.subject}`.toLowerCase() === subjectKey.toLowerCase()) {
        this.end(id, 'revoked');
        n++;
      }
    }
    return n;
  }

  count(): number {
    return this.map.size;
  }

  /** For the administrative review: who is signed in, never the tokens. */
  list(): { subject: string; login: string; provider: string; createdAt: number; lastSeenAt: number; absoluteExpiresAt: number }[] {
    return [...this.map.values()].map((s) => ({ subject: `${s.user.provider}:${s.user.subject}`, login: s.user.login, provider: s.user.provider, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, absoluteExpiresAt: s.absoluteExpiresAt }));
  }
}
