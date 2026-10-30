import { Suspense } from 'react';
import { QueueExplorer } from '@/components/queue/queue-explorer.tsx';
import { PageSkeleton } from '@/components/page-skeleton.tsx';
import { PageHeader } from '@/components/ui.tsx';

export const metadata = { title: 'Work Queue' };
export const dynamic = 'force-dynamic';

export default function QueuePage() {
  return (
    <>
      <PageHeader title="Work Queue" lede="Everything that must be completed before the application build, derived from the repository’s own tasks, decisions, risks, security findings, gaps and validation procedures. Rubric evidence gaps are kept apart from engineering work." />
      <Suspense fallback={<PageSkeleton />}>
        <QueueExplorer />
      </Suspense>
    </>
  );
}
