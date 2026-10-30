'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Eye, RotateCw, X } from 'lucide-react';
import type { Src } from '@/lib/intel/schema.ts';
import { Skeleton, SourceLink } from './ui.tsx';

interface Preview {
  path: string;
  commit: string;
  blob: string;
  totalLines: number;
  start: number;
  end: number;
  highlight: number;
  lines: { n: number; text: string }[];
}

/** Read-only view of a repository file at the commit being read, centred on the cited line. */
export function SourcePreviewButton({ src, label = 'Preview source', at }: { src: Src; label?: string; at?: string }) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState(20);
  const [state, setState] = useState<{ s: 'loading' } | { s: 'error'; message: string } | { s: 'ok'; data: Preview }>({ s: 'loading' });
  const [n, setN] = useState(0);
  const mark = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    setState((s) => (s.s === 'ok' ? s : { s: 'loading' }));
    fetch(`/api/v1/source?path=${encodeURIComponent(src.path)}&line=${src.line}&context=${context}${at ? `&at=${at}` : ''}`, { signal: ctl.signal })
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as (Preview & { detail?: string }) | null;
        if (!r.ok || !body?.lines) throw new Error(body?.detail ?? `HTTP ${r.status}`);
        setState({ s: 'ok', data: body });
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError') setState({ s: 'error', message: e instanceof Error ? e.message : 'Could not load the file.' });
      });
    return () => ctl.abort();
  }, [open, src.path, src.line, context, n, at]);

  useEffect(() => {
    if (state.s === 'ok') mark.current?.scrollIntoView({ block: 'center' });
  }, [state]);

  const more = useCallback(() => setContext((c) => Math.min(c + 40, 200)), []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-surface px-2.5 py-1 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-surface-2">
          <Eye aria-hidden className="size-3.5" />
          {label}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-[60] bg-navy/50" />
        <Dialog.Content aria-describedby={undefined} data-testid="source-preview" className="anim-pop fixed top-[6vh] left-1/2 z-[60] flex max-h-[88vh] w-[920px] max-w-[calc(100vw-24px)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl bg-surface" style={{ boxShadow: 'var(--shadow-sheet)' }}>
          <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-3.5">
            <div className="min-w-0">
              <Dialog.Title className="text-[15px] font-semibold">Source preview, read-only</Dialog.Title>
              <p className="mt-0.5 font-mono text-[12px] break-all text-ink-2">{src.path}</p>
              {state.s === 'ok' ? (
                <p className="mt-0.5 text-[12px] text-ink-3">
                  Commit <span className="font-mono">{state.data.commit.slice(0, 12)}</span> · blob <span className="font-mono">{state.data.blob.slice(0, 10)}</span> · lines {state.data.start} to {state.data.end} of {state.data.totalLines}
                </p>
              ) : null}
              <div className="mt-1.5">
                <SourceLink src={src} />
              </div>
            </div>
            <Dialog.Close aria-label="Close preview" className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-2">
              <X aria-hidden className="size-4" />
            </Dialog.Close>
          </div>
          <div tabIndex={0} role="region" aria-label="Source lines" className="min-h-[200px] flex-1 overflow-auto bg-surface-2">
            {state.s === 'loading' ? (
              <div role="status" aria-busy="true" aria-label="Loading source" className="space-y-2 p-5">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-5" />
                ))}
              </div>
            ) : state.s === 'error' ? (
              <div role="alert" className="flex items-center gap-3 p-6 text-[13.5px] text-[var(--s-rejected-fg)]">
                <AlertCircle aria-hidden className="size-5 shrink-0" />
                <span className="flex-1">The source could not be shown: {state.message}</span>
                <button type="button" onClick={() => setN((x) => x + 1)} className="inline-flex items-center gap-1 font-medium underline">
                  <RotateCw aria-hidden className="size-3.5" />
                  Retry
                </button>
              </div>
            ) : (
              <table className="w-full border-collapse font-mono text-[12.5px] leading-[20px]">
                <caption className="sr-only">Lines {state.data.start} to {state.data.end} of {state.data.path}. Line {state.data.highlight} is highlighted.</caption>
                <tbody>
                  {state.data.lines.map((l) => {
                    const hit = l.n === state.data.highlight;
                    return (
                      <tr key={l.n} ref={hit ? mark : undefined} data-highlight={hit ? 'true' : undefined} className={hit ? 'bg-[var(--s-open-bg)]' : ''}>
                        <td className="w-[1%] border-r border-hairline px-3 text-right align-top whitespace-nowrap text-ink-3 select-none">{l.n}</td>
                        <td className="px-3 align-top break-words whitespace-pre-wrap text-ink">{l.text || ' '}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-hairline px-5 py-2.5 text-[12.5px] text-ink-3">
            <span>The Studio cannot edit this file.</span>
            <button type="button" onClick={more} disabled={context >= 200 || state.s !== 'ok'} className="rounded-md px-2 py-1 font-medium text-accent hover:bg-accent-soft disabled:text-ink-3 disabled:hover:bg-transparent">
              Show more context
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
