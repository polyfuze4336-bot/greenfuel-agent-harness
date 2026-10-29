'use client';

import type { ReactNode } from 'react';
import { Info, TriangleAlert } from 'lucide-react';
import type { Lookup } from '@/lib/lookup.ts';
import { adrTypeLabel } from '@/lib/format.ts';
import type { Decision } from '@/lib/repo/types.ts';
import { Meta, StatusPill, Tag } from '../ui.tsx';
import { RefChips, SourceBlock } from '../record-bits.tsx';

const KIND: Record<string, string> = {
  C: 'Stakeholder clarification: a fact only the business can supply',
  D: 'Verification: a regulatory or certification claim a qualified person must check',
  X: 'Architecture decision: options are known, choosing needs analysis and approval',
};
const kindText = (k: string) =>
  k
    .split(/[+]/)
    .map((p) => KIND[p.trim()] ?? p)
    .join('; ');

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 text-[13px] font-semibold text-ink-2">{title}</h3>
      {children}
    </section>
  );
}

export function DecisionDetail({ d, lookup, titleAs = 'h2' }: { d: Decision; lookup: Lookup; titleAs?: 'h1' | 'h2' }) {
  const Title = titleAs;
  const notes: ReactNode[] = [];
  if (d.flags.grandfathered) notes.push(<>Accepted by the owner's instruction in chat, before signed approvals existed. The harness exempts ADRs 0001 to 0015 from the signature rule, so this acceptance is <strong>unsigned</strong>.</>);
  if (d.flags.delegated) notes.push(<>The status line says the decision was made by the architect on the owner's instruction. Confirm it is the owner's own decision.</>);
  if (d.flags.partialScope) notes.push(<>Part of the scope is excluded or deferred. The Accepted label does not cover the whole subject.</>);
  for (const r of d.flags.review) if (!notes.length || !/delegated|architect|partial|excluded/i.test(r)) notes.push(r);

  return (
    <article data-testid="decision-detail" aria-label={`${d.id} ${d.title}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Tag>{d.id}</Tag>
        <StatusPill status={d.status} />
        <span className="text-[12.5px] text-ink-3">{d.type === 'adr' ? `Architecture decision record · ${adrTypeLabel(d.adrType)}` : `Open register entry · ${d.kind}`}</span>
      </div>
      <Title className="text-[22px] leading-[1.25] font-semibold">{d.title}</Title>

      <Block title="Status line, verbatim">
        <blockquote className="rounded-xl border-l-[3px] border-hairline-strong bg-surface-2 px-4 py-3 text-[13.5px] leading-6 text-ink-2">{d.statusRaw || 'No status recorded'}</blockquote>
        <p className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
          <Info aria-hidden className="size-4 shrink-0 text-ink-3" />
          {d.flags.signed ? 'A signed approval record exists for this decision. Verify it with approval.mjs verify.' : 'No signed approval record exists for this decision.'}
        </p>
      </Block>

      {notes.length > 0 ? (
        <Block title="Flagged for human review">
          <ul className="space-y-2">
            {notes.map((n, i) => (
              <li key={i} className="flex gap-2.5 rounded-xl px-3.5 py-2.5 text-[13.5px] leading-5" style={{ background: 'var(--s-open-bg)', color: 'var(--s-open-fg)' }}>
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      <Block title={d.type === 'adr' ? 'Decision, as recorded' : 'Why it matters'}>
        <p className="text-[14.5px] leading-6 text-ink">{d.summary || 'The record has no summary text.'}</p>
      </Block>

      {d.options.length > 0 ? (
        <Block title={d.type === 'adr' ? 'Options considered' : 'Known options (none is chosen)'}>
          <ol className="list-decimal space-y-1.5 pl-5 text-[14px] leading-6 text-ink-2 marker:text-ink-3">
            {d.options.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ol>
        </Block>
      ) : null}

      <Block title="Facts">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
          {d.milestone ? <Meta label="Needed by">{d.milestone}</Meta> : null}
          {d.kind ? <Meta label="Kind">{kindText(d.kind)}</Meta> : null}
          {d.owner ? <Meta label={d.type === 'adr' ? 'Deciders' : 'Owner role'}>{d.owner}</Meta> : null}
          {d.date ? <Meta label="Date">{d.date}</Meta> : null}
        </dl>
      </Block>

      <Block title="Design reviews it gates">
        <RefChips ids={d.refs.reviews} lookup={lookup} empty="No design review names this decision as blocking." />
      </Block>
      <Block title={`Requirements that trace to it (${d.refs.requirements.length})`}>
        <RefChips ids={d.refs.requirements} lookup={lookup} empty="No requirement traces to this decision." />
      </Block>
      <Block title="Risks">
        <RefChips ids={d.refs.risks} lookup={lookup} empty="No risk links to this decision." />
      </Block>
      <Block title="Assumptions it would replace">
        <RefChips ids={d.refs.assumptions} lookup={lookup} empty="No assumption names this decision." />
      </Block>
      <Block title="Owner tasks that mention it">
        <RefChips ids={d.refs.tasks} lookup={lookup} empty="No owner task mentions this decision." />
      </Block>
      {d.refs.decisions.length + d.refs.adrs.length > 0 ? (
        <Block title="Other decisions it cites">
          <RefChips ids={[...d.refs.adrs, ...d.refs.decisions]} lookup={lookup} />
        </Block>
      ) : null}

      <div className="mt-8 border-t border-hairline pt-6">
        <SourceBlock src={d.src} />
      </div>
    </article>
  );
}
