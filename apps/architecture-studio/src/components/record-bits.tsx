'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, History, RotateCw } from 'lucide-react';
import { utcDate } from '@/lib/format.ts';
import type { Lookup } from '@/lib/lookup.ts';
import { Skeleton, SourceLink, useGitHub } from './ui.tsx';

interface Entry {
  sha: string;
  short: string;
  date: string;
  author: string;
  subject: string;
  onGitHub?: boolean;
}

/** A commit's short id, linked to GitHub only when GitHub has that commit. Otherwise it is shown as local, never as a dead link. */
function CommitRef({ e }: { e: Entry }) {
  const { githubUrl } = useGitHub();
  if (githubUrl && e.onGitHub) {
    return (
      <a href={`/commit/`} target="_blank" rel="noreferrer noopener" aria-label={`Commit  on GitHub (opens in a new tab)`} className="font-mono text-accent hover:underline">
        {e.short}
      </a>
    );
  }
  return (
    <span className="font-mono" title="This commit is not on GitHub yet">
      {e.short} <span className="font-sans text-[10.5px] font-semibold tracking-wide text-[var(--s-open-fg)] uppercase">local</span>
    </span>
  );
}

export function FileHistory({ path, limit = 5 }: { path: string; limit?: number }) {
  const [state, setState] = useState<{ s: 'loading' } | { s: 'error'; message: string } | { s: 'ok'; entries: Entry[] }>({ s: 'loading' });
  const [n, setN] = useState(0);
  const load = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    const ctl = new AbortController();
    setState({ s: 'loading' });
    fetch(`/api/v1/history?path=${encodeURIComponent(path)}&limit=${limit}`, { signal: ctl.signal })
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as { entries?: Entry[]; detail?: string } | null;
        if (!r.ok || !body?.entries) throw new Error(body?.detail ?? `HTTP ${r.status}`);
        setState({ s: 'ok', entries: body.entries });
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError') setState({ s: 'error', message: e instanceof Error ? e.message : 'Could not load history.' });
      });
    return () => ctl.abort();
  }, [path, n, limit]);

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
      {state.entries.map((e, i) => (
        <li key={e.sha} className="flex gap-3 text-[13px]" data-testid="file-commit">
          <History aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
          <span className="min-w-0">
            <span className="block">{e.subject}{i === 0 ? <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">Last modified</span> : null}</span>
            <span className="block text-[12px] text-ink-3">
              <CommitRef e={e} /> · {e.author} · {utcDate(e.date)}
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
      <h3 className="mt-5 mb-1 text-[13px] font-semibold text-ink-2">Change history of this file, newest first</h3>
      {src.path === 'docs/context/DECISION-REGISTER.md' ? <p className="mb-2 text-[12px] text-ink-3">This one file holds every open register entry, so these are changes to the register as a whole.</p> : null}
      <FileHistory path={src.path} limit={20} />
    </div>
  );
}

/** The newest commit that changed a record's source file, shown at the top of the record. */
export function LastModified({ path }: { path: string }) {
  const [e, setE] = useState<Entry | null | 'error'>(null);
  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/v1/history?path=${encodeURIComponent(path)}&limit=1`, { signal: ctl.signal })
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as { entries?: Entry[] } | null;
        if (!r.ok || !body?.entries) throw new Error('history');
        setE(body.entries[0] ?? 'error');
      })
      .catch((x: unknown) => {
        if ((x as { name?: string }).name !== 'AbortError') setE('error');
      });
    return () => ctl.abort();
  }, [path]);
  if (e === null) return <p className="mt-1 h-5 text-[12.5px] text-ink-3" aria-busy="true" data-testid="last-modified">Reading history…</p>;
  if (e === 'error') return <p className="mt-1 text-[12.5px] text-ink-3" data-testid="last-modified">Last modified commit: unknown (history could not be read).</p>;
  return (
    <p className="mt-1 text-[12.5px] text-ink-3" data-testid="last-modified">
      Last modified in <CommitRef e={e} /> on {utcDate(e.date)}: {e.subject}
    </p>
  );
}
