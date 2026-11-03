'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueueSnapshot } from '@/lib/queue/snapshot.ts';
import type { Me, View } from '@/lib/queue/views.ts';

export interface QueueData extends QueueSnapshot {
  views: { id: View; label: string; rule: string }[];
  canonical: { ref: string; commit: string | null; available: boolean };
  policy: { source: string; completionRoles: string[]; independent: boolean; people: { login: string; holder: string; roles: string[] }[] };
  me: (Me & { listed: boolean }) | null;
  /** Each ranked item's score from the Next Best Action rules. The queue is ordered by it unless a column is chosen. */
  next: Record<string, number>;
}

export interface SessionInfo {
  authenticated: boolean;
  csrf?: string;
  testMode: boolean;
  mode?: 'entra' | 'github-dev';
  canonicalRef: string;
  user?: { login: string; name: string | null; provider?: string; roles: string[]; listed: boolean; verifiedBy: string };
}

export type Problem = { detail?: string; code?: string; title?: string };

export async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: (T & Problem) | null }> {
  const r = await fetch(url, { credentials: 'same-origin', ...init });
  const body = (await r.json().catch(() => null)) as (T & Problem) | null;
  return { ok: r.ok, status: r.status, body };
}

/** Loads the queue and the signed-in session together, so "My tasks" and the action rights never disagree about who is signed in. */
export function useQueue() {
  const [data, setData] = useState<QueueData | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setError(null);
    try {
      const [q, s] = await Promise.all([api<QueueData>('/api/v1/queue'), api<SessionInfo>('/api/v1/auth/session')]);
      if (mine !== seq.current) return;
      if (q.ok && q.body) setData(q.body);
      else setError(q.body?.detail ?? `The queue could not be loaded (HTTP ${q.status}).`);
      if (s.ok && s.body) setSession(s.body);
    } catch {
      if (mine === seq.current) setError('The Studio server could not be reached.');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sessionRef = useRef<SessionInfo | null>(null);
  sessionRef.current = session;
  const signIn = useCallback(async () => {
    if (sessionRef.current?.mode === 'entra') {
      window.location.assign(`/api/v1/auth/entra/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return null;
    }
    const r = await api<SessionInfo>('/api/v1/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    await load();
    return r.ok ? null : (r.body?.detail ?? `Sign-in failed (HTTP ${r.status}).`);
  }, [load]);

  return { data, session, error, loading, reload: load, signIn };
}
