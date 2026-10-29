'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, History, RotateCw } from 'lucide-react';
import { utcDate } from '@/lib/format.ts';
import type { Lookup } from '@/lib/lookup.ts';
import { Skeleton, SourceLink } from './ui.tsx';

interface Entry {
  sha: string;
  short: string;
  date: string;
  author: string;
  subject: string;
}

export function FileHistory({ path }: { path: string }) {
  const [state, setState] = useState<{ s: 'loading' } | { s: 'error'; message: string } | { s: 'ok'; entries: Entry[] }>({ s: 'loading' });
  const [n, setN] = useState(0);
  const load = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    const ctl = new AbortController();
    setState({ s: 'loading' });
    fetch(`/api/v1/history?path=${encodeURIComponent(path)}`, { signal: ctl.signal })
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as { entries?: Entry[]; detail?: string } | null;
        if (!r.ok || !body?.entries) throw new Error(body?.detail ?? `HTTP ${r.status}`);
        setState({ s: 'ok', entries: body.entries });
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError') setState({ s: 'error', message: e instanceof Error ? e.message : 'Could not load history.' });
      });
    return () => ctl.abort();
  }, [path, n]);

  if (state.s === 'loading')
    return (
      <div role="status" aria-busy="true" aria-label="Loading file history" className="space-y-2">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
    );
  if (state.s === 'error')
    return (
      <div role="alert" className="flex items-center gap-3 rounded-xl bg-[var(--s-rejected-bg)] px-3.5 py-3 text-[13px] text-[var(--s-rejected-fg)]">
        <AlertCircle aria-hidden className="size-4 shrink-0" />
        <span className="flex-1">History unavailable: {state.message}</span>
        <button type="button" onClick={load} className="inline-flex items-center gap-1 font-medium underline">
          <RotateCw aria-hidden className="size-3.5" />
          Retry
        </button>
      </div>
    );
  if (state.entries.length === 0) return <p className="text-[13px] text-ink-3">No commits touch this file at the commit being read.</p>;
  return (
    <ol className="space-y-2">
      {state.entries.map((e) => (
        <li key={e.sha} className="flex gap-3 text-[13px]">
          <History aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
          <span className="min-w-0">
            <span className="block">{e.subject}</span>
            <span className="block text-[12px] text-ink-3">
              <span className="font-mono">{e.short}</span> · {e.author} · {utcDate(e.date)}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function RefChips({ ids, lookup, empty }: { ids: string[]; lookup: Lookup; empty?: string }) {
  if (ids.length === 0) return empty ? <p className="text-[13.5px] text-ink-3">{empty}</p> : null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {ids.map((id) => {
        const e = lookup[id];
        return (
          <li key={id}>
            {e ? (
              <Link href={e.href} title={e.title} className="inline-flex items-center rounded-md border border-hairline bg-surface-2 px-1.5 py-px font-mono text-[12px] leading-5 text-accent hover:border-accent">
                {id}
              </Link>
            ) : (
              <span title="Not found as a record at this commit" className="inline-flex items-center rounded-md border border-dashed border-hairline-strong px-1.5 py-px font-mono text-[12px] leading-5 text-ink-3">
                {id}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function SourceBlock({ src, label = 'Source in the repository' }: { src: { path: string; line: number }; label?: string }) {
  return (
    <div>
      <h3 className="mb-2 text-[13px] font-semibold text-ink-2">{label}</h3>
      <p className="mb-1 font-mono text-[12.5px] break-all text-ink-2">{src.path}</p>
      <SourceLink src={src} />
      <h3 className="mt-5 mb-2 text-[13px] font-semibold text-ink-2">Recent commits touching this file</h3>
      <FileHistory path={src.path} />
    </div>
  );
}
