'use client';

import { useState } from 'react';
import { Swords, Waypoints } from 'lucide-react';
import { Sheet } from '../explorer-kit.tsx';
import { Card } from '../ui.tsx';
import { ExaminerPanel } from '../decisions/examiner-panel.tsx';
import { ImpactPanel } from '../decisions/impact-panel.tsx';

/** Two short ways to look before deciding. Neither is required reading: the review actions are not behind them. */
export function ReviewAids({ id }: { id: string }) {
  const [open, setOpen] = useState<null | 'impact' | 'challenge'>(null);
  const b = 'inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-surface-2';
  return (
    <Card className="mb-4 px-4 py-3.5" data-testid="review-aids">
      <h2 className="text-[13px] font-semibold text-ink-2">Before you decide</h2>
      <p className="mt-1 text-[12.5px] leading-5 text-ink-3">What would follow, and the strongest case against. Both are built from the repository and labelled by what kind of statement each line is.</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button type="button" onClick={() => setOpen('impact')} data-testid="review-impact" className={b}>
          <Waypoints aria-hidden className="size-3.5" />
          See the impact
        </button>
        <button type="button" onClick={() => setOpen('challenge')} data-testid="review-challenge" className={b}>
          <Swords aria-hidden className="size-3.5" />
          Challenge this decision
        </button>
      </div>
      <Sheet open={open === 'impact'} onClose={() => setOpen(null)} title={`Impact of a decision on ${id}`}>
        <ImpactPanel id={id} />
      </Sheet>
      <Sheet open={open === 'challenge'} onClose={() => setOpen(null)} title={`Architecture Examiner: ${id}`}>
        <ExaminerPanel id={id} />
      </Sheet>
    </Card>
  );
}
