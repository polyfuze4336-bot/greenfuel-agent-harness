import { Suspense } from 'react';
import { QueueExplorer } from '@/components/queue/queue-explorer.tsx';
import { PageSkeleton } from '@/components/page-skeleton.tsx';
import { PageHeader } from '@/components/ui.tsx';
import { buildLookup } from '@/lib/lookup.ts';
import { getModel } from '@/lib/repo/index.ts';

export const metadata = { title: 'Work Queue' };
export const dynamic = 'force-dynamic';

export default async function QueuePage() {
  const m = await getModel();
  const t = m.metrics.tasks;
  return (
    <>
      <PageHeader title="Work Queue" lede={`${t.ownerTodo} owner tasks from docs/state/TODO.md and ${t.total - t.ownerTodo} items from the implementation roadmap. Roadmap rows record no status, so none is shown for them.`} />
      <Suspense fallback={<PageSkeleton />}>
        <QueueExplorer tasks={m.tasks} lookup={buildLookup(m)} />
      </Suspense>
    </>
  );
}
