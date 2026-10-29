'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, FileText, ListChecks, Scale, Search, ShieldAlert, Lightbulb, X, ListTree } from 'lucide-react';
import type { SearchHit, SearchKind } from '@/lib/search.ts';

const KINDS: { v: SearchKind | 'all'; label: string }[] = [
  { v: 'all', label: 'All' },
  { v: 'decision', label: 'Decisions' },
  { v: 'task', label: 'Tasks' },
  { v: 'requirement', label: 'Requirements' },
  { v: 'risk', label: 'Risks' },
  { v: 'assumption', label: 'Assumptions' },
  { v: 'document', label: 'Documents' },
];

const KIND_ICON: Record<SearchKind, typeof Scale> = { decision: Scale, task: ListChecks, requirement: ListTree, risk: ShieldAlert, assumption: Lightbulb, document: FileText };

type State = { s: 'idle' } | { s: 'loading' } | { s: 'error'; message: string } | { s: 'done'; hits: SearchHit[] };

export function SearchPalette({ totals }: { totals: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<SearchKind | 'all'>('all');
  const [state, setState] = useState<State>({ s: 'idle' });
  const [active, setActive] = useState(0);
  const [retry, setRetry] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]');
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setState({ s: 'idle' });
      return;
    }
    setState({ s: 'loading' });
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/search?q=${encodeURIComponent(term)}${kind === 'all' ? '' : `&kind=${kind}`}`, { signal: ctl.signal });
        if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { detail?: string } | null)?.detail ?? `The search service answered HTTP ${res.status}.`);
        const body = (await res.json()) as { hits: SearchHit[] };
        setState({ s: 'done', hits: body.hits });
        setActive(0);
      } catch (e) {
        if ((e as { name?: string }).name === 'AbortError') return;
        setState({ s: 'error', message: e instanceof Error ? e.message : 'Search failed.' });
      }
    }, 140);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, kind, retry]);

  const go = useCallback(
    (h: SearchHit) => {
      setOpen(false);
      router.push(h.href);
    },
    [router],
  );

  const hits = state.s === 'done' ? state.hits : [];
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(hits.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && hits[active]) {
      e.preventDefault();
      go(hits[active]!);
    }
  };

  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setQ(''); setKind('all'); } }}>
      <Dialog.Trigger asChild>
        <button type="button" className="flex h-9 w-full max-w-[440px] items-center gap-2.5 rounded-lg border border-hairline-strong bg-surface px-3 text-left text-[13.5px] text-ink-2 transition-colors hover:bg-surface-2">
          <Search aria-hidden className="size-4 shrink-0" />
          <span className="flex-1 truncate">Search decisions, tasks, requirements</span>
          <kbd className="hidden rounded border border-hairline-strong bg-surface-2 px-1.5 font-mono text-[11px] text-ink-3 md:inline">Ctrl K</kbd>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-50 bg-navy/40 backdrop-blur-[2px]" />
        <Dialog.Content aria-describedby={undefined} onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }} className="anim-pop fixed top-[10vh] left-1/2 z-50 flex max-h-[76vh] w-[680px] max-w-[calc(100vw-24px)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl bg-surface" style={{ boxShadow: 'var(--shadow-sheet)' }}>
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <div className="flex items-center gap-3 border-b border-hairline px-4">
            <Search aria-hidden className="size-[18px] text-ink-3" />
            <input
              ref={inputRef}
              role="combobox"
              data-palette-input
              aria-expanded={hits.length > 0}
              aria-controls={listId}
              aria-activedescendant={hits.length ? `${listId}-${active}` : undefined}
              aria-label="Search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search by id, title or text, for example D-003 or residency"
              className="h-14 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-3"
              autoComplete="off"
              spellCheck={false}
            />
            {q ? (
              <button type="button" aria-label="Clear search" onClick={() => { setQ(''); inputRef.current?.focus(); }} className="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-surface-2">
                <X aria-hidden className="size-4" />
              </button>
            ) : null}
          </div>
          <div role="group" aria-label="Filter results by type" className="flex flex-wrap gap-1.5 border-b border-hairline px-4 py-2.5">
            {KINDS.map((k) => (
              <button key={k.v} type="button" aria-pressed={kind === k.v} onClick={() => setKind(k.v)} className={`rounded-full px-2.5 py-1 text-[12.5px] font-medium transition-colors ${kind === k.v ? 'bg-navy text-white' : 'bg-surface-2 text-ink-2 hover:bg-hairline'}`}>
                {k.label}
              </button>
            ))}
          </div>
          <div tabIndex={0} role="group" aria-label="Results" className="min-h-[160px] flex-1 overflow-y-auto">
            {state.s === 'idle' ? (
              <p className="px-5 py-10 text-center text-[14px] text-ink-2">Search {totals} records read from the repository: decisions, tasks, requirements, risks, assumptions and documents.</p>
            ) : state.s === 'loading' ? (
              <ul aria-busy="true" aria-label="Searching" className="space-y-1 p-3">
                {[0, 1, 2, 3].map((i) => (
                  <li key={i} className="skeleton h-12" />
                ))}
              </ul>
            ) : state.s === 'error' ? (
              <div role="alert" className="flex flex-col items-center gap-3 px-5 py-10 text-center">
                <AlertCircle aria-hidden className="size-6 text-[var(--s-rejected-fg)]" />
                <p className="text-[14px] text-ink-2">{state.message}</p>
                <button type="button" onClick={() => setRetry((n) => n + 1)} className="rounded-lg border border-hairline-strong px-3 py-1.5 text-[13.5px] font-medium hover:bg-surface-2">
                  Try again
                </button>
              </div>
            ) : hits.length === 0 ? (
              <div role="status" className="px-5 py-10 text-center">
                <p className="text-[15px] font-medium">No records match “{q.trim()}”</p>
                <p className="mt-1 text-[13.5px] text-ink-3">Try an id such as D-003, FR-012 or T14, or fewer words.{kind !== 'all' ? ' Or search all types.' : ''}</p>
              </div>
            ) : (
              <ul id={listId} role="listbox" aria-label="Search results" className="p-1.5">
                {hits.map((h, i) => {
                  const I = KIND_ICON[h.kind];
                  return (
                    <li key={`${h.kind}:${h.id}`} id={`${listId}-${i}`} role="option" aria-selected={i === active} onMouseMove={() => setActive(i)} onClick={() => go(h)} className={`flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 ${i === active ? 'bg-accent-soft' : ''}`}>
                      <I aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="shrink-0 font-mono text-[12.5px] font-medium whitespace-nowrap text-ink">{h.kind === 'document' ? h.id.split('/').pop() : h.id}</span>
                          <span className="truncate text-[13.5px] text-ink-2">{h.title}</span>
                        </span>
                        <span className="block text-[12px] text-ink-3">{h.subtitle}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-hairline px-4 py-2 text-[12px] text-ink-3">
            <span aria-live="polite">{state.s === 'done' ? `${hits.length} result${hits.length === 1 ? '' : 's'}${hits.length >= 40 ? ' (first 40)' : ''}` : ''}</span>
            <span className="hidden sm:inline">↑ ↓ to move · Enter to open · Esc to close</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
