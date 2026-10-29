import { Suspense } from 'react';
import { DecisionExplorer } from '@/components/decisions/decision-explorer.tsx';
import { PageHeader } from '@/components/ui.tsx';
import { PageSkeleton } from '@/components/page-skeleton.tsx';
import { buildLookup } from '@/lib/lookup.ts';
import { getModel } from '@/lib/repo/index.ts';

export const metadata = { title: 'Decision Register' };
export const dynamic = 'force-dynamic';

export default async function DecisionsPage() {
  const m = await getModel();
  return (
    <>
      <PageHeader title="Decision Register" lede={`${m.metrics.decisions.adrs} architecture decision records and ${m.metrics.decisions.register} open register entries. Status is exactly what each file says; the Studio never promotes a Proposed record.`} />
      <Suspense fallback={<PageSkeleton />}>
        <DecisionExplorer decisions={m.decisions} lookup={buildLookup(m)} />
      </Suspense>
    </>
  );
}
