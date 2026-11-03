'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import type { ListItem } from '@/lib/next/overview.ts';
import type { NextAction, Venue } from '@/lib/next/types.ts';
import { Sheet } from '../explorer-kit.tsx';
import { Card, NeutralPill } from '../ui.tsx';

export const VENUE_LABEL: Record<Venue, string> = {
  studio: 'Decide in the Studio',
  github: 'On GitHub',
  business: 'Needs an answer from the business',
  'qualified-person': 'Needs a qualified person',
  repository: 'Repository work',
  evidence: 'Evidence',
};

/** The rules that put an action where it is, with their points. The score is exactly their sum. */
export function Why({ action }: { action: NextAction }) {
  return (
    <div data-testid="why">
      <ul className="divide-y divide-hairline rounded-xl border border-hairline">
        {action.reasons.map((r, i) => (
          <li key={i} className="flex items-start gap-3 px-3.5 py-2 text-[13px] leading-5">
            <span className={`w-10 shrink-0 text-right font-semibold tnum ${r.points < 0 ? 'text-[var(--s-rejected-fg)]' : 'text-ink'}`}>{r.points > 0 ? `+${r.points}` : r.points}</span>
            <span className="min-w-0 flex-1">
              {r.text}
              <span className="ml-2 font-mono text-[11px] text-ink-3">{r.rule}</span>
            </span>
          </li>
        ))}
        <li className="flex items-center gap-3 bg-surface-2 px-3.5 py-2 text-[13px] font-semibold">
          <span className="w-10 shrink-0 text-right tnum" data-testid="why-total">{action.score}</span>
          <span>Total. Higher comes first. The rules are fixed and no model is involved.</span>
        </li>
      </ul>
    </div>
  );
}

export function ActionFacts({ action }: { action: NextAction }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <NeutralPill>{VENUE_LABEL[action.venue]}</NeutralPill>
      {action.blocksNextPhase ? <NeutralPill title="A gate of the next implementation phase needs it">Blocks the next phase</NeutralPill> : null}
      {action.neededLater ? <NeutralPill title="Only a later phase needs it">Needed later</NeutralPill> : null}
      {action.unlocks.decisions > 0 ? <NeutralPill>Unlocks {action.unlocks.decisions} decision{action.unlocks.decisions === 1 ? '' : 's'}</NeutralPill> : null}
      {action.unlocks.mustRequirements > 0 ? <NeutralPill>{action.unlocks.mustRequirements} Must requirement{action.unlocks.mustRequirements === 1 ? '' : 's'}</NeutralPill> : null}
      {!action.ready && action.waitingFor.length ? <NeutralPill title={action.waitingFor.join(', ')}>Depends on {action.waitingFor.length} undecided</NeutralPill> : null}
    </div>
  );
}

/** One place that explains an action and takes you to it: a side panel, so the page behind keeps its place. */
export function ActionDrawer({ item, onClose }: { item: ListItem | null; onClose: () => void }) {
  const a = item?.action ?? null;
  return (
    <Sheet open={!!item} onClose={onClose} title={a ? 'Why this is here' : 'Details'}>
      {item ? (
        <div data-testid="action-drawer">
          <h2 className="text-[20px] leading-7 font-semibold">{item.title}</h2>
          <p className="mt-1 text-[14px] leading-5 text-ink-2">{item.detail}</p>
          {a ? (
            <div className="mt-3">
              <ActionFacts action={a} />
            </div>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href={item.href} data-testid="drawer-open" onClick={onClose} className="inline-flex items-center gap-1.5 rounded-lg bg-selected px-3.5 py-2 text-[13.5px] font-medium text-selected-ink hover:opacity-90">
              {a ? 'Open it' : 'Open the decision'}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
          {a ? (
            <section className="mt-6">
              <h3 className="mb-2 text-[13px] font-semibold text-ink-2">Why it ranks here</h3>
              <Why action={a} />
              {a.waitingFor.length ? <p className="mt-3 text-[12.5px] text-ink-3">Waits for: {a.waitingFor.join(', ')}.</p> : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}

/** A short list: a title, a count, three rows, and a way to see the rest. Each row opens its drawer. */
export function ActionList({ id, title, count, items, empty, viewAll, tone }: { id: string; title: string; count: number; items: ListItem[]; empty: string; viewAll?: { href: string; label: string }; tone?: 'warn' }) {
  const [open, setOpen] = useState<ListItem | null>(null);
  return (
    <section id={id} aria-labelledby={`${id}-h`} data-testid={id} className="min-w-0 scroll-mt-24">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id={`${id}-h`} className="text-[15px] font-semibold">
          {title} <span className={`ml-1 text-[13px] font-medium tnum ${tone === 'warn' && count > 0 ? 'text-[var(--s-rejected-fg)]' : 'text-ink-3'}`} data-testid={`${id}-count`}>{count}</span>
        </h2>
        {viewAll && count > items.length ? (
          <Link href={viewAll.href} className="inline-flex items-center gap-0.5 text-[12.5px] font-medium text-accent hover:underline">
            {viewAll.label}
            <ArrowUpRight aria-hidden className="size-3.5" />
          </Link>
        ) : null}
      </div>
      <Card className="overflow-hidden">
        {items.length === 0 ? (
          <p className="px-4 py-3.5 text-[13.5px] text-ink-3" data-testid={`${id}-empty`}>{empty}</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {items.map((it) => (
              <li key={it.key}>
                <button type="button" data-testid="action-row" onClick={() => setOpen(it)} className="group flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] leading-5 font-medium">{it.title}</span>
                    <span className="block truncate text-[12.5px] leading-5 text-ink-3">{it.detail}</span>
                  </span>
                  {it.meta ? <span className="shrink-0 pt-0.5 text-[12.5px] text-ink-3 tnum">{it.meta}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ActionDrawer item={open} onClose={() => setOpen(null)} />
    </section>
  );
}
