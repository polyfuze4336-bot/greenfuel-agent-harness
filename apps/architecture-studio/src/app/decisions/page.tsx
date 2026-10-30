import { Suspense } from 'react';
import Link from 'next/link';
import { Gavel } from 'lucide-react';
import { DecisionExplorer } from '@/components/decisions/decision-explorer.tsx';
import { RegisterHealth } from '@/components/decisions/register-health.tsx';
import { PageHeader } from '@/components/ui.tsx';
import { PageSkeleton } from '@/components/page-skeleton.tsx';
import { buildLookup } from '@/lib/lookup.ts';
import { getModel } from '@/lib/repo/index.ts';
import { runtime } from '@/lib/workflow/http.ts';
import { pendingOrder } from '@/lib/workflow/runtime.ts';

export const metadata = { title: 'Decision Register' };
export const dynamic = 'force-dynamic';

export default async function DecisionsPage() {
  const m = await getModel();
  const r = m.register;
  const store = runtime().service.deps.store;
  const queue = pendingOrder(r.records, (id) => !!store.openFor(id));
  // Commits the register can be compared with: remote-tracking branches, and the commit before this one.
  const refs = [...new Set([...m.repo.remoteRefs.map((x) => x.name), 'HEAD~1'])];
  return (
    <>
      <PageHeader title="Decision Register" lede={`${r.stats.byKind.adr} architecture decision records and ${r.stats.byKind['register-entry']} open register entries, normalized to one schema. Every field is copied from a source file with its line, or left empty and declared. Statuses are mapped by written rules and never promoted.`}>
        {queue[0] ? (
          <Link href={`/decisions/${queue[0].id}/review`} data-testid="start-review" className="inline-flex items-center gap-2 rounded-lg bg-navy px-3.5 py-2 text-[13.5px] font-medium text-white hover:opacity-90">
            <Gavel aria-hidden className="size-4" />
            Review pending decisions ({queue.length})
          </Link>
        ) : null}
      </PageHeader>
      <RegisterHealth stats={r.stats} validation={r.validation} duplicates={r.duplicates} suggestionCount={r.suggestions.length} commit={r.commit} refs={refs} warnings={r.warnings} />
      <Suspense fallback={<PageSkeleton />}>
        <DecisionExplorer records={r.records} duplicates={r.duplicates} suggestions={r.suggestions} lookup={buildLookup(m)} />
      </Suspense>
    </>
  );
}
