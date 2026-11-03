import Link from 'next/link';
import { ArrowRight, CircleCheck, OctagonAlert } from 'lucide-react';
import type { OverviewModel } from '@/lib/next/overview.ts';
import { Card } from '../ui.tsx';

/** Readiness for the next implementation phase, from the baseline policy: the mandatory decisions and gates, how many are done, and what is not required. */
export function ReadinessCard({ o, compact = false }: { o: OverviewModel; compact?: boolean }) {
  const r = o.readiness;
  const gates = r.otherBlockers.length;
  const label = !r.available
    ? 'The baseline policy defines no implementation phase'
    : r.ready
      ? `Ready to authorize a baseline: every mandatory decision and gate for ${r.stageTitle} is satisfied`
      : `${r.blockingDecisions.length} mandatory decision${r.blockingDecisions.length === 1 ? '' : 's'} and ${gates} gate${gates === 1 ? '' : 's'} stand in the way of ${r.stageTitle}`;
  return (
    <Card className="mb-6 px-5 py-4" data-testid="readiness-card">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {r.ready ? <CircleCheck aria-hidden className="size-5 text-[var(--s-accepted-fg)]" /> : <OctagonAlert aria-hidden className="size-5 text-[var(--s-rejected-fg)]" />}
        <div className="min-w-[16rem] flex-1">
          <p className="text-[12.5px] font-medium text-ink-2">Architecture readiness for the next phase</p>
          <p data-testid="readiness-label" className="text-[18px] leading-6 font-semibold tracking-[-0.01em]">{label}</p>
        </div>
        <Link href="/baseline" data-testid="baseline-link" className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-accent hover:underline">
          Build authorization
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>

      {r.available && !r.ready ? (
        <ul className="mt-3 space-y-1.5" data-testid="mandatory-blockers">
          {r.blockingDecisions.slice(0, compact ? 5 : 3).map((b) => (
            <li key={b.id} className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
              <Link href={b.href} className="font-mono text-[12.5px] font-medium text-accent hover:underline">{b.id}</Link>
              <span className="min-w-0 flex-1">{b.title}</span>
              <span className="text-[12.5px] text-ink-3">{b.gates.join('; ') || 'required by a gate'} · {b.state}</span>
            </li>
          ))}
          {r.otherBlockers.slice(0, compact ? 6 : 3).map((b) => (
            <li key={b.code} className="text-[13.5px] text-ink-2">
              <span className="mr-2 rounded bg-surface-2 px-1.5 py-px font-mono text-[11.5px] text-ink-3">{b.code}</span>
              {b.text}
            </li>
          ))}
        </ul>
      ) : null}

      {o.progress.length > 0 ? (
        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="progress">
          {o.progress.map((p) => (
            <div key={p.label} title={p.basis}>
              <dt className="flex items-baseline justify-between gap-2 text-[12.5px] text-ink-2">
                {p.label}
                <span className="font-medium text-ink tnum" data-testid="progress-count">{p.done} of {p.total}</span>
              </dt>
              <dd className="mt-1">
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${p.done} of ${p.total}`}>
                  <div className="h-full rounded-full bg-accent" style={{ width: p.total ? `${(p.done / p.total) * 100}%` : '0%' }} />
                </div>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {r.available ? (
        <p className="mt-3 text-[12.5px] leading-5 text-ink-3" data-testid="optional-note">
          {r.optionalOpen} other decision{r.optionalOpen === 1 ? ' is' : 's are'} open and no phase requires {r.optionalOpen === 1 ? 'it' : 'them'}. They do not block anything. Counts are of records, not a maturity score.
        </p>
      ) : null}
    </Card>
  );
}
