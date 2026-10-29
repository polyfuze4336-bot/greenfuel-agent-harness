'use client';

import Link from 'next/link';
import { Inbox } from 'lucide-react';
import { useQueryState } from '@/lib/use-query-state.ts';
import { approvalCommand } from '@/lib/links.ts';
import type { Lookup } from '@/lib/lookup.ts';
import type { PendingApproval } from '@/lib/repo/types.ts';
import { ChipGroup } from '../explorer-kit.tsx';
import { RefChips } from '../record-bits.tsx';
import { Card, CopyButton, EmptyState, NeutralPill, SourceLink, Tag } from '../ui.tsx';

export function PendingApprovals({ items, lookup }: { items: PendingApproval[]; lookup: Lookup }) {
  const qs = useQueryState();
  const kinds = qs.list('kind');
  const shown = items.filter((p) => kinds.length === 0 || kinds.includes(p.kind));
  const count = (k: string) => items.filter((p) => p.kind === k).length;
  const toggle = (k: string) => qs.set({ kind: (kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k]).join(',') || null });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ChipGroup label="Kind" selected={kinds} onToggle={toggle} options={[{ value: 'adr', label: 'Proposed ADRs', count: count('adr') }, { value: 'design-review', label: 'Design reviews', count: count('design-review') }]} />
        <p role="status" aria-live="polite" data-testid="result-count" className="text-[13px] text-ink-3">
          Showing <span className="font-medium text-ink tnum">{shown.length}</span> of <span className="tnum">{items.length}</span>
        </p>
      </div>
      <Card className="overflow-hidden">
        {items.length === 0 ? (
          <EmptyState icon={Inbox} title="Nothing is waiting for approval">No Proposed ADR and no design review that is not Approved exists at this commit.</EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState icon={Inbox} title="No outstanding approvals of this kind" />
        ) : (
          <ul className="divide-y divide-hairline" data-testid="pending-list">
            {shown.map((p) => (
              <li key={p.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <Tag>{p.id}</Tag>
                      <NeutralPill>{p.kind === 'adr' ? 'Proposed ADR' : 'Design review'}</NeutralPill>
                    </div>
                    <p className="text-[15px] font-medium">{p.title}</p>
                    <p className="mt-1 text-[13px] leading-5 text-ink-2">
                      <span className="text-ink-3">Needs: </span>
                      {p.required}
                    </p>
                    <p className="text-[13px] leading-5 text-ink-2">
                      <span className="text-ink-3">State: </span>
                      {p.state}
                    </p>
                    {p.blockedBy.length > 0 ? (
                      <div className="mt-3">
                        <p className="mb-1.5 text-[12.5px] text-ink-3">{p.kind === 'adr' ? `Cites ${p.blockedBy.length} decisions that are still Open` : `Blocked by ${p.blockedBy.length} open decisions`}</p>
                        <RefChips ids={p.blockedBy} lookup={lookup} />
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                    <CopyButton text={approvalCommand(p.kind, p.id)} label="Copy request command" />
                    <Link href={p.kind === 'adr' ? `/decisions?id=${p.id}` : p.href} className="text-[13px] font-medium text-accent hover:underline">
                      {p.kind === 'adr' ? 'Open the decision' : 'Open the review'}
                    </Link>
                    {p.src ? <SourceLink src={p.src} /> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
