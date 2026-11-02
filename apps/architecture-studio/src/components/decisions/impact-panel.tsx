'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Info, RotateCw } from 'lucide-react';
import { ACTION_LABEL, IMPACT_ACTIONS, KIND_LABEL, type ImpactAction, type ImpactItem, type ImpactKind, type ImpactResult } from '@/lib/impact/types.ts';
import { AiBadge, NeutralPill, SourceLink, Skeleton, Tag } from '../ui.tsx';

const ACTION_VERB: Record<ImpactAction, string> = { approve: 'Approve', reject: 'Reject', defer: 'Defer', revise: 'Revise' };

const KIND_ORDER: ImpactKind[] = ['decision', 'requirement', 'security', 'sovereignty', 'data-flow', 'component', 'infrastructure', 'cost', 'task', 'test', 'risk', 'review', 'slide', 'document'];

function Item({ it }: { it: ImpactItem }) {
  return (
    <li className="py-2 text-[13px] leading-5" data-testid="impact-item">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {it.kind === 'decision' ? (
          <Link href={`/decisions?id=${encodeURIComponent(it.id)}`} className="font-mono text-[12px] text-accent hover:underline">{it.id}</Link>
        ) : it.id.includes('/') || it.id.includes(':') ? null : (
          <Tag>{it.id}</Tag>
        )}
        <span className="min-w-0 flex-1 text-ink">{it.title}</span>
        {it.status ? <NeutralPill>{it.status}</NeutralPill> : null}
      </div>
      <p className="mt-0.5 text-[12px] text-ink-3">
        {it.relation}
        {it.via ? <> · through <span className="font-mono">{it.via}</span></> : null}
      </p>
      {it.src ? <div className="mt-0.5"><SourceLink src={it.src} /></div> : null}
    </li>
  );
}

/** Items grouped by kind. Each group is closed until asked for: the counts come first. */
function Groups({ items, testid }: { items: ImpactItem[]; testid: string }) {
  const by = new Map<ImpactKind, ImpactItem[]>();
  for (const it of items) by.set(it.kind, [...(by.get(it.kind) ?? []), it]);
  return (
    <div data-testid={testid} className="divide-y divide-hairline rounded-xl border border-hairline">
      {KIND_ORDER.filter((k) => by.has(k)).map((k) => (
        <details key={k} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 text-[13.5px] [&::-webkit-details-marker]:hidden">
            <span className="font-medium">{KIND_LABEL[k]}</span>
            <span className="tnum text-ink-3">{by.get(k)!.length}</span>
          </summary>
          <ul className="divide-y divide-hairline border-t border-hairline px-3.5">{by.get(k)!.map((it) => <Item key={`${it.kind}:${it.id}`} it={it} />)}</ul>
        </details>
      ))}
    </div>
  );
}

function Block({ title, count, children, note }: { title: string; count?: number; children: React.ReactNode; note?: string }) {
  return (
    <section className="mt-5">
      <h3 className="mb-1.5 flex items-baseline justify-between text-[13px] font-semibold text-ink-2">
        {title}
        {count !== undefined ? <span className="tnum font-normal text-ink-3">{count}</span> : null}
      </h3>
      {note ? <p className="mb-2 text-[12px] leading-5 text-ink-3">{note}</p> : null}
      {children}
    </section>
  );
}

function Limited<T>({ items, n, render, testid }: { items: T[]; n: number; render: (x: T, i: number) => React.ReactNode; testid?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, n);
  return (
    <div data-testid={testid}>
      <ul className="space-y-1.5">{shown.map((x, i) => render(x, i))}</ul>
      {items.length > n ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-[12.5px] font-medium text-accent hover:underline">
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      ) : null}
    </div>
  );
}

export function ImpactPanel({ id }: { id: string }) {
  const [action, setAction] = useState<ImpactAction>('approve');
  const [cache, setCache] = useState<Partial<Record<ImpactAction, ImpactResult>>>({});
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const data = cache[action];

  useEffect(() => {
    setCache({});
  }, [id]);
  useEffect(() => {
    if (cache[action]) return;
    const ctl = new AbortController();
    setError(null);
    fetch(`/api/v1/decisions/${encodeURIComponent(id)}/impact?action=${action}`, { signal: ctl.signal, credentials: 'same-origin' })
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as (ImpactResult & { detail?: string }) | null;
        if (!r.ok || !body || !('summary' in body)) throw new Error(body?.detail ?? `HTTP ${r.status}`);
        setCache((c) => ({ ...c, [action]: body }));
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError') setError(e instanceof Error ? e.message : 'Could not load the impact.');
      });
    return () => ctl.abort();
  }, [id, action, attempt, cache]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <div data-testid="impact-panel">
      <div role="group" aria-label="If this decision is" className="inline-flex rounded-xl border border-hairline-strong bg-surface-2 p-0.5">
        {IMPACT_ACTIONS.map((a) => (
          <button key={a} type="button" aria-pressed={a === action} data-testid={`impact-${a}`} onClick={() => setAction(a)} className={`rounded-[10px] px-3 py-1.5 text-[13px] font-medium transition-colors ${a === action ? 'bg-selected text-selected-ink' : 'text-ink-2 hover:text-ink'}`}>
            {ACTION_VERB[a]}
          </button>
        ))}
      </div>

      {error ? (
        <div role="alert" className="mt-4 flex items-center gap-3 rounded-xl bg-[var(--s-rejected-bg)] px-3.5 py-3 text-[13px] text-[var(--s-rejected-fg)]">
          <AlertTriangle aria-hidden className="size-4 shrink-0" />
          <span className="flex-1">The impact could not be loaded: {error}</span>
          <button type="button" onClick={retry} className="inline-flex items-center gap-1 font-medium underline">
            <RotateCw aria-hidden className="size-3.5" />
            Retry
          </button>
        </div>
      ) : !data ? (
        <div role="status" aria-busy="true" aria-label="Loading impact" data-testid="impact-loading" className="mt-4 space-y-2">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <>
          <p className="mt-4 text-[14px] leading-6 text-ink" data-testid="impact-status">
            If <span className="font-mono">{data.decisionId}</span> is {ACTION_LABEL[action].toLowerCase()}
            {data.statusAfter ? <>: <strong>{data.statusNow}</strong> <ArrowRight aria-hidden className="inline size-3.5 align-[-2px]" /> <strong>{data.statusAfter}</strong>.</> : <>: its status stays <strong>{data.statusNow}</strong>.</>}
          </p>
          <p className="mt-1 flex items-start gap-1.5 text-[12px] leading-5 text-ink-3">
            <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {data.statusNote} Built only from explicit repository references.
          </p>

          <dl data-testid="impact-summary" className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-4">
            {([['Directly affected', data.summary.direct, 'direct'], ['Potentially affected', data.summary.potential, 'potential'], ['Blocking', data.summary.blocking, 'blocking'], ['Follow-up work', data.summary.followUp, 'followup']] as const).map(([k, v, key]) => (
              <div key={k} className="bg-surface px-3 py-2.5">
                <dt className="text-[11.5px] text-ink-3">{k}</dt>
                <dd className="text-[20px] leading-7 font-semibold tnum" data-testid={`impact-count-${key}`}>{v}</dd>
              </div>
            ))}
          </dl>

          {data.cycles.length || data.unresolved.length ? (
            <div role="note" data-testid="impact-warnings" className="mt-4 space-y-1.5 rounded-xl px-3.5 py-3 text-[13px] leading-5" style={{ background: 'var(--s-open-bg)', color: 'var(--s-open-fg)' }}>
              {data.cycles.map((c) => (
                <p key={c.join('>')}><strong>Dependency cycle:</strong> <span className="font-mono">{c.join(' → ')}</span>. Reported, not followed.</p>
              ))}
              {data.unresolved.length ? <p><strong>References that point at nothing:</strong> {data.unresolved.slice(0, 6).map((u) => u.id).join(', ')}. They are listed, not guessed at.</p> : null}
            </div>
          ) : null}

          <Block title="Follow-up work" count={data.followUp.length}>
            {data.followUp.length ? (
              <Limited testid="impact-followup" items={data.followUp} n={4} render={(f, i) => (
                <li key={i} className="text-[13px] leading-5 text-ink">
                  {f.text}
                  <span className="mt-0.5 block text-[12px] text-ink-3">Because: {f.because}{f.src ? <> · <SourceLink src={f.src} /></> : null}</span>
                </li>
              )} />
            ) : (
              <p className="text-[13px] text-ink-3">None follows from a recorded reference.</p>
            )}
          </Block>

          <Block title="Blocking dependencies" count={data.blocking.length} note="What this decision rests on that is not settled, and what is waiting for it.">
            {data.blocking.length ? (
              <Limited testid="impact-blocking" items={data.blocking} n={4} render={(b) => (
                <li key={`${b.direction}-${b.id}`} className="text-[13px] leading-5">
                  <Tag>{b.id}</Tag> <span className="text-ink">{b.title}</span> <NeutralPill>{b.status}</NeutralPill>
                  <span className="block text-[12px] text-ink-3">{b.direction === 'rests-on' ? 'This decision rests on it' : 'Waiting for this decision'}</span>
                </li>
              )} />
            ) : (
              <p className="text-[13px] text-ink-3">None recorded.</p>
            )}
          </Block>

          <Block title="Directly affected" count={data.direct.length} note="A record names this decision, or this decision names it.">
            {data.direct.length ? <Groups items={data.direct} testid="impact-direct" /> : <p className="text-[13px] text-ink-3">No record cites this decision.</p>}
          </Block>

          <Block title="Potentially affected" count={data.potential.length} note="Reached only through another decision that rests on this one. Look, do not assume.">
            {data.potential.length ? <Groups items={data.potential} testid="impact-potential" /> : <p className="text-[13px] text-ink-3">Nothing is reached through other decisions.</p>}
          </Block>

          {data.rework.length ? (
            <Block title="Possible rework" count={data.rework.length} note="Records that treat this decision as established. They may need to change.">
              <Groups items={data.rework} testid="impact-rework" />
            </Block>
          ) : null}

          <Block title="Estimated impact">
            <p className="text-[13px] leading-5 text-ink-2" data-testid="impact-estimate">{data.estimate.counts}</p>
            <p className="mt-1 text-[12px] leading-5 text-ink-3">{data.estimate.note}</p>
            {data.estimate.cost ? (
              <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] leading-5 text-ink-2">
                <span className="font-medium">Cost as the decision states it: </span>
                {data.estimate.cost.text} <SourceLink src={data.estimate.cost.src} />
              </p>
            ) : null}
          </Block>

          <Block title="Suggested by AI, unverified" count={data.unverified.length} note="Relationships an AI proposes. They are not counted above and do not make anything affected until a repository record states the link.">
            {data.unverified.length ? (
              <ul className="space-y-2" data-testid="impact-unverified">
                {data.unverified.map((u) => (
                  <li key={u.id} className="rounded-xl border border-dashed border-hairline-strong px-3.5 py-2.5 text-[13px] leading-5">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <AiBadge />
                      {u.nowExplicit ? <NeutralPill>Now explicit in the repository</NeutralPill> : <NeutralPill>Unverified</NeutralPill>}
                    </div>
                    <span className="font-mono text-[12px]">{u.targetId}</span>: {u.relation}
                    <span className="mt-1 block text-[12px] text-ink-3">Why: {u.rationale} Written by {u.generatedBy.tool} on {u.generatedBy.date}. <SourceLink src={u.src} /></span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-3">No AI suggestion about this decision&rsquo;s relationships exists.</p>
            )}
          </Block>

          {data.notes.length ? (
            <ul className="mt-5 list-disc space-y-1 pl-5 text-[12px] leading-5 text-ink-3">{data.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          ) : null}
          <p className="mt-4 text-[11.5px] text-ink-3">At commit <span className="font-mono">{data.commit.slice(0, 7)}</span>.</p>
        </>
      )}
    </div>
  );
}
