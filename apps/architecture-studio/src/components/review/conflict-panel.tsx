'use client';

import { useState } from 'react';
import { GitCompareArrows } from 'lucide-react';
import { btnPrimary } from '../ui.tsx';

/** What GitHub now holds, as the server reports it when a submission is refused for a conflict. */
export interface Conflict {
  kind: 'stale-revision' | 'source-changed' | string;
  current: {
    status: string | null;
    canonicalCommit: string | null;
    lastEvent: { id: string; action: string; by: string; at: string; text: string | null } | null;
    openProposal: { id: string; state: string; action: string } | null;
    source: { path: string; canonicalBlob: string | null; readBlob: string | null } | null;
  };
  proposed: { action: string; option: string | null; conditions: string[] | null; rationale: string | null; comment: string | null };
}

/** What the person was looking at when they opened the item. */
export interface Original {
  status: string | null;
  canonicalCommit: string | null;
  lastEvent: { action: string; by: string; at: string; text: string | null } | null;
  sourcePath?: string | null;
  sourceBlob?: string | null;
}

const short = (s: string | null | undefined) => (s ? s.slice(0, 8) : 'not available');

function Column({ title, tone, children, testId }: { title: string; tone?: 'current'; children: React.ReactNode; testId: string }) {
  return (
    <section data-testid={testId} aria-label={title} className={`min-w-0 rounded-xl border p-3 text-[13px] leading-5 ${tone === 'current' ? 'border-[var(--s-open-fg)]' : 'border-hairline'}`}>
      <h3 className="mb-1.5 text-[12px] font-semibold tracking-wide text-ink-3 uppercase">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

const Line = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <p className="break-words">
    <span className="text-ink-3">{k}: </span>
    {v}
  </p>
);

/**
 * Shown when GitHub changed after the person opened the item. It lays out three values side by side, the one they opened, the
 * one that is there now, and the one they are proposing, and it will not send anything until they say they have read the
 * current one. Nothing is overwritten and nothing is sent by showing it.
 */
export function ConflictPanel({ conflict, original, busy, onReapply, onDiscard }: { conflict: Conflict; original: Original; busy: boolean; onReapply: () => void; onDiscard: () => void }) {
  const [ack, setAck] = useState(false);
  const c = conflict.current;
  const p = conflict.proposed;
  const event = (e: { action: string; by: string; at: string; text: string | null } | null) => (e ? `${e.action} by @${e.by}${e.text ? `: “${e.text.slice(0, 160)}”` : ''}` : 'no recorded action');
  return (
    <section data-testid="conflict-view" role="alert" aria-label="Conflict: GitHub changed after you opened this" className="mt-4 rounded-2xl border border-[var(--s-open-fg)] p-4" style={{ background: 'var(--s-open-bg)' }}>
      <p className="flex items-center gap-2 text-[14px] font-semibold" style={{ color: 'var(--s-open-fg)' }}>
        <GitCompareArrows aria-hidden className="size-4" />
        {conflict.kind === 'source-changed' ? 'The source record changed on GitHub' : 'This changed on GitHub after you opened it'}
      </p>
      <p className="mt-1 text-[13px] leading-5 text-ink-2">Nothing was sent, and the newer content was not overwritten. Compare the three values, then decide whether your action still makes sense.</p>
      <div className="mt-3 grid gap-2.5 bg-surface p-0 sm:grid-cols-3">
        <Column title="Original (what you opened)" testId="conflict-original">
          <Line k="Status" v={original.status ?? 'not stated'} />
          <Line k="Last action" v={event(original.lastEvent)} />
          <Line k="Canonical commit" v={<span className="font-mono">{short(original.canonicalCommit)}</span>} />
          {conflict.kind === 'source-changed' ? <Line k="Source version" v={<span className="font-mono">{short(original.sourceBlob)}</span>} /> : null}
        </Column>
        <Column title="Current (on GitHub now)" tone="current" testId="conflict-current">
          <Line k="Status" v={c.status ?? 'not stated'} />
          <Line k="Last action" v={event(c.lastEvent)} />
          <Line k="Canonical commit" v={<span className="font-mono">{short(c.canonicalCommit)}</span>} />
          {c.openProposal ? <Line k="In flight" v={`${c.openProposal.action} (${c.openProposal.state})`} /> : null}
          {conflict.kind === 'source-changed' && c.source ? <Line k="Source version" v={<span className="font-mono">{short(c.source.canonicalBlob)}</span>} /> : null}
        </Column>
        <Column title="Proposed (your action)" testId="conflict-proposed">
          <Line k="Action" v={p.action} />
          {p.option ? <Line k="Option" v={p.option} /> : null}
          {p.conditions?.length ? <Line k="Conditions" v={p.conditions.join('; ')} /> : null}
          {p.rationale || p.comment ? <Line k="Text" v={`“${(p.rationale ?? p.comment ?? '').slice(0, 200)}”`} /> : null}
        </Column>
      </div>
      <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-[13.5px] leading-5">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
        <span>I have read the current state above and still want to submit my action against it.</span>
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" data-testid="conflict-reapply" className={btnPrimary} disabled={!ack || busy} onClick={onReapply}>
          Re-apply to the current state
        </button>
        <button type="button" data-testid="conflict-discard" className="inline-flex items-center rounded-lg border border-hairline-strong bg-surface px-3 py-1.5 text-[13.5px] font-medium hover:bg-surface-2" onClick={onDiscard}>
          Discard my action and reload
        </button>
      </div>
    </section>
  );
}
