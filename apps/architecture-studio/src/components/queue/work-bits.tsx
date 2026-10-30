'use client';

import type { Priority, WorkStatus } from '@/lib/queue/types.ts';
import { TonePill, type ToneName } from '../ui.tsx';

const TONE: Record<WorkStatus, ToneName> = {
  Open: 'open',
  Unmarked: 'neutral',
  Blocked: 'blocked',
  'Awaiting clarification': 'open',
  'In review': 'proposed',
  Deferred: 'deferred',
  Done: 'accepted',
  'Closed, no evidence': 'neutral',
  Rejected: 'rejected',
  Superseded: 'neutral',
};

export const WorkStatusPill = ({ status, title }: { status: WorkStatus; title?: string }) => (
  <TonePill name={TONE[status]} title={title}>
    {status}
  </TonePill>
);

const PRI: Record<Priority, string> = {
  Critical: 'border-[var(--s-blocked-fg)] text-[var(--s-blocked-fg)]',
  High: 'border-hairline-strong text-ink',
  Medium: 'border-hairline text-ink-2',
  Low: 'border-hairline text-ink-3',
};

/** Priority as text with a border, never colour alone. A missing priority says so. */
export function PriorityTag({ priority }: { priority: Priority | null }) {
  if (!priority) return <span className="text-[12.5px] text-ink-3">Not stated</span>;
  return <span className={`inline-flex items-center rounded-md border px-1.5 py-px text-[12px] leading-5 font-semibold ${PRI[priority]}`}>{priority}</span>;
}
