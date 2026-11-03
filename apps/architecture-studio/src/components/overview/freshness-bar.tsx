'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, RefreshCw } from 'lucide-react';
import type { Freshness } from '@/lib/next/server.ts';

const FIVE_MINUTES = 5 * 60_000;

const ago = (seconds: number | null): string | null => {
  if (seconds === null) return null;
  if (seconds < 90) return 'just now';
  const m = Math.round(seconds / 60);
  return m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

/**
 * How current this page is, in one line. It asks the server, which only reads a file, when the window gets focus and every five minutes:
 * no timer ticks every few seconds. If GitHub has a newer commit than the page shows, it says so and offers to update. If the clone has not
 * fetched for longer than three sync intervals, it says GitHub may be unreachable and that this is the last copy it has.
 */
export function FreshnessBar({ initial }: { initial: Freshness }) {
  const router = useRouter();
  const [f, setF] = useState<Freshness>(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState({ commit: initial.commit, short: initial.commitShort });

  // router.refresh() re-renders the server component with a new `initial`: that is what the page now shows.
  useEffect(() => {
    setShown({ commit: initial.commit, short: initial.commitShort });
    setF(initial);
  }, [initial]);

  const check = useCallback(async (): Promise<Freshness | null> => {
    try {
      const r = await fetch('/api/v1/freshness', { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as Freshness;
      setF(j);
      setFailed(false);
      return j;
    } catch {
      setFailed(true);
      return null;
    }
  }, []);

  useEffect(() => {
    const onFocus = () => document.visibilityState === 'visible' && void check();
    const timer = setInterval(() => document.visibilityState === 'visible' && void check(), FIVE_MINUTES);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [check]);

  const newer = f.commit !== shown.commit;
  async function refresh() {
    setBusy(true);
    try {
      await fetch('/api/v1/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', credentials: 'same-origin' });
      await check();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const stale = f.state === 'stale' || failed;
  const age = ago(f.ageSeconds);
  return (
    <div data-testid="freshness" data-state={failed ? 'unreachable' : f.state} data-newer={newer} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
      {stale ? <CircleAlert aria-hidden className="size-4 text-[var(--s-open-fg)]" /> : <CircleCheck aria-hidden className="size-4 text-[var(--s-accepted-fg)]" />}
      <span>
        From GitHub commit <span className="font-mono text-ink-2" data-testid="freshness-commit">{shown.short}</span>
        {f.state === 'unknown' ? ' · this checkout does not fetch' : age ? <> · synced <span data-testid="freshness-age">{age}</span></> : null}
      </span>
      {stale ? (
        <span role="status" data-testid="freshness-warning" className="font-medium text-[var(--s-open-fg)]">
          {failed ? 'Could not check for updates.' : `No sync for ${Math.round((f.ageSeconds ?? 0) / 60)} min. GitHub may be unreachable.`} This is the last copy the Studio has.
        </span>
      ) : null}
      {newer ? (
        <button type="button" data-testid="freshness-update" onClick={refresh} className="font-medium text-accent hover:underline">
          New commits on GitHub ({f.commitShort}). Update
        </button>
      ) : null}
      <button type="button" data-testid="freshness-refresh" onClick={refresh} disabled={busy} aria-label="Refresh from the repository" className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-surface-2 disabled:opacity-60">
        <RefreshCw aria-hidden className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />
        Refresh
      </button>
    </div>
  );
}
