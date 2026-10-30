import { Suspense } from 'react';
import { BlockingView } from '@/components/queue/blocking-view.tsx';
import { PageSkeleton } from '@/components/page-skeleton.tsx';
import { PageHeader } from '@/components/ui.tsx';

export const metadata = { title: 'What is blocking the build?' };
export const dynamic = 'force-dynamic';

export default function BlockingPage() {
  return (
    <>
      <PageHeader title="What is blocking the build?" lede="The work the application build waits for, in the order it can be unblocked. Built only from dependencies the repository’s own documents state." />
      <Suspense fallback={<PageSkeleton />}>
        <BlockingView />
      </Suspense>
    </>
  );
}
