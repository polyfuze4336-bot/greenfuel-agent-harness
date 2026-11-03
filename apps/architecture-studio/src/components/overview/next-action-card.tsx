'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, Compass } from 'lucide-react';
import type { ListItem } from '@/lib/next/overview.ts';
import type { NextAction } from '@/lib/next/types.ts';
import { Card } from '../ui.tsx';
import { ActionDrawer, ActionFacts, Why } from './action-list.tsx';

/** The one thing to do next, why, and the next few. The order comes from fixed rules over repository facts, not from a model. */
export function NextActionCard({ next, then, waiting, signedIn, readyForBaseline }: { next: NextAction | null; then: ListItem[]; waiting: ListItem[]; signedIn: boolean; readyForBaseline: boolean }) {
  const [open, setOpen] = useState<ListItem | null>(null);
  return (
    <Card className="mb-6 overflow-hidden" data-testid="next-action">
      <div className="px-5 pt-4 pb-4">
        <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-accent">
          <Compass aria-hidden className="size-4" />
          Next best action
        </p>
        {next ? (
          <>
            <h2 className="mt-1.5 text-[22px] leading-7 font-semibold tracking-[-0.015em]" data-testid="next-title">{next.title}</h2>
            <p className="mt-0.5 text-[14.5px] leading-6 text-ink-2" data-testid="next-detail">{next.detail}</p>
            <div className="mt-2.5">
              <ActionFacts action={next} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Link href={next.href} data-testid="start-review" className="inline-flex items-center gap-2 rounded-lg bg-selected px-3.5 py-2 text-[13.5px] font-medium text-selected-ink hover:opacity-90">
                {next.venue === 'studio' ? 'Review it' : 'Open it'}
                <ArrowRight aria-hidden className="size-4" />
              </Link>
              <details className="group min-w-0 flex-1">
                <summary className="cursor-pointer list-none text-[13px] font-medium text-accent hover:underline [&::-webkit-details-marker]:hidden" data-testid="next-why-toggle">
                  Why this one?
                </summary>
                <div className="mt-2">
                  <Why action={next} />
                </div>
              </details>
            </div>
          </>
        ) : (
          <div className="mt-1.5" data-testid="next-empty">
            <h2 className="text-[20px] leading-7 font-semibold">{readyForBaseline ? 'Nothing is left in the way' : 'Nothing needs you right now'}</h2>
            <p className="mt-0.5 text-[14px] leading-6 text-ink-2">
              {readyForBaseline
                ? 'Every mandatory decision and gate for the next phase is satisfied. Authorizing a baseline is a signed human act outside this page.'
                : signedIn
                  ? 'No decision, change or task waits on you. Items that wait on somebody else are listed below.'
                  : 'The repository has no open decision, change or task that ranks for action.'}
            </p>
          </div>
        )}
      </div>
      {then.length > 0 ? (
        <div className="border-t border-hairline bg-surface-2/40 px-5 py-3" data-testid="then">
          <p className="mb-1 text-[12px] font-medium text-ink-3">Then</p>
          <ol className="space-y-0.5">
            {then.map((it, i) => (
              <li key={it.key}>
                <button type="button" data-testid="then-row" onClick={() => setOpen(it)} className="flex w-full items-baseline gap-2.5 rounded-md px-1 py-1 text-left text-[13.5px] hover:bg-surface-2">
                  <span className="w-4 shrink-0 text-ink-3 tnum">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{it.title}</span>
                    <span className="text-ink-3"> · {it.detail}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {waiting.length > 0 ? (
        <div className="border-t border-hairline px-5 py-3" data-testid="waiting-others">
          <p className="mb-1 text-[12px] font-medium text-ink-3">Waiting on somebody else</p>
          <ul className="space-y-0.5">
            {waiting.map((it) => (
              <li key={it.key}>
                <button type="button" onClick={() => setOpen(it)} className="w-full truncate rounded-md px-1 py-1 text-left text-[13.5px] text-ink-2 hover:bg-surface-2">
                  {it.title} <span className="text-ink-3">· {it.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ActionDrawer item={open} onClose={() => setOpen(null)} />
    </Card>
  );
}
