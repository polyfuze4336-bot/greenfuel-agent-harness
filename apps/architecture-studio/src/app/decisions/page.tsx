import { Suspense } from 'react';
import Link from 'next/link';
import { Gavel } from 'lucide-react';
import { DecisionExplorer } from '@/components/decisions/decision-explorer.tsx';
import { RegisterHealth } from '@/components/decisions/register-health.tsx';
import { PageHeader } from '@/components/ui.tsx';
import { PageSkeleton } from '@/components/page-skeleton.tsx';
import { toRow } from '@/lib/intel/row.ts';
import { getModel } from '@/lib/repo/index.ts';
import { runtime } from '@/lib/workflow/http.ts';
import { pendingOrder } from '@/lib/workflow/runtime.ts';

export const metadata = { title: 'Decisions' };
export const dynamic = 'force-dynamic';

export default async function DecisionsPage() {
  const m = await getModel();
  const r = m.register;
  const store = runtime().service.deps.store;
  const queue = pendingOrder(r.records, (id) => !!store.openFor(id), runtime().service.policy());
  // Commits the register can be compared with: remote-tracking branches, and the commit before this one.
  const refs = [...new Set([...m.repo.remoteRefs.map((x) => x.name), 'HEAD~1'])];
  return (
    <>
      <PageHeader title="Decisions" lede={`${r.stats.byKind.adr} architecture decision records and ${r.stats.byKind['register-entry']} open register entries. Every field comes from a source file, or is shown as empty.`}>
        {queue[0] ? (
          <Link href={`/decisions/${queue[0].id}/review`} data-testid="start-review" className="inline-flex items-center gap-2 rounded-lg bg-selected px-3.5 py-2 text-[13.5px] font-medium text-selected-ink hover:opacity-90">
            <Gavel aria-hidden className="size-4" />
            Review architecture decisions ({queue.length})
          </Link>
        ) : null}
      </PageHeader>
      <Suspense fallback={<PageSkeleton />}>
        <DecisionExplorer rows={r.records.map(toRow)} duplicates={r.duplicates} suggestionIds={[...new Set(r.suggestions.map((s) => s.decisionId))]} />
      </Suspense>
      <div className="mt-10">
        <RegisterHealth stats={r.stats} validation={r.validation} duplicates={r.duplicates} suggestionCount={r.suggestions.length} commit={r.commit} refs={refs} warnings={r.warnings} />
      </div>
    </>
  );
}
