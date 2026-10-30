'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TriangleAlert } from 'lucide-react';
import { ErrorPanel } from '../error-panel.tsx';
import { Skeleton } from '../ui.tsx';
import { type QueueData } from './queue-data.tsx';

export const QUEUE_TABS = [
  { href: '/queue', label: 'Work queue' },
  { href: '/queue/blocking', label: 'What is blocking the build?' },
] as const;

/** Two views of the same data. Plain links, so each is a page with its own address. */
export function QueueTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Queue views" className="mb-5 flex gap-1 border-b border-hairline">
      {QUEUE_TABS.map((t) => {
        const on = pathname === t.href;
        return (
          <Link key={t.href} href={t.href} aria-current={on ? 'page' : undefined} className={`-mb-px border-b-2 px-3 py-2 text-[14px] font-medium transition-colors ${on ? 'border-navy text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function QueueLoading() {
  return (
    <div data-testid="queue-loading" role="status" aria-busy="true" aria-label="Loading the work queue" className="space-y-3">
      <Skeleton className="h-9 w-full max-w-[640px]" />
      <div className="flex gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-8 w-28" />
        ))}
      </div>
      <div className="space-y-2 pt-2">
        {Array.from({ length: 9 }, (_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
      <span className="sr-only">Reading the repository</span>
    </div>
  );
}

export function QueueError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <ErrorPanel title="The work queue could not be loaded" message={message} onRetry={onRetry} />;
}

/** Where the data came from, and anything the sources contradict. Nothing here is decoration. */
export function SourceStrip({ data }: { data: QueueData }) {
  const total = data.sources.reduce((n, s) => n + s.count, 0);
  return (
    <div className="mb-4 space-y-2 text-[12.5px] leading-5 text-ink-3" data-testid="queue-source-strip">
      <p>
        {data.items.length} items derived from {data.sources.length} repository files at commit <span className="font-mono">{data.commit.slice(0, 8)}</span>
        {data.canonical.available ? (
          <>
            ; merged work records read from {data.canonical.ref} at <span className="font-mono">{data.canonical.commit?.slice(0, 8)}</span>
          </>
        ) : (
          <> ; {data.canonical.ref} cannot be read, so no merged work record is applied</>
        )}
        . {total} source rows, {data.edges.length} relationships ({data.edges.filter((e) => e.type === 'requires').length} state that one thing must come first).
      </p>
      {data.workProblems.length ? (
        <p role="alert" className="flex gap-2 rounded-lg px-3 py-2" style={{ background: 'var(--s-open-bg)', color: 'var(--s-open-fg)' }}>
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{data.workProblems.length} work-item record(s) on the canonical branch are inconsistent and were not applied: {data.workProblems.slice(0, 2).join('; ')}</span>
        </p>
      ) : null}
    </div>
  );
}
