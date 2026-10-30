import type { Metadata } from 'next';
import { BaselineView } from '@/components/baseline/baseline-view.tsx';
import { PageHeader } from '@/components/ui.tsx';

export const metadata: Metadata = { title: 'Architecture baseline' };
export const dynamic = 'force-dynamic';

// A shell. Everything on it comes from /api/v1/baseline, which is computed from the repository by the readiness validator.
export default function BaselinePage() {
  return (
    <>
      <PageHeader title="Architecture baseline" lede="Whether the architecture has been decided and approved far enough to authorize a kind of work. A baseline is generated only when every gate is satisfied, and it is authorized only by a person with a signed approval. This page shows the state and never authorizes anything." />
      <BaselineView />
    </>
  );
}
