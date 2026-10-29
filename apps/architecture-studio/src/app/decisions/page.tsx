import { Suspense } from 'react';
import { DecisionExplorer } from '@/components/decisions/decision-explorer.tsx';
import { RegisterHealth } from '@/components/decisions/register-health.tsx';
import { PageHeader } from '@/components/ui.tsx';
import { PageSkeleton } from '@/components/page-skeleton.tsx';
import { buildLookup } from '@/lib/lookup.ts';
import { getModel } from '@/lib/repo/index.ts';

export const metadata = { title: 'Decision Register' };
export const dynamic = 'force-dynamic';

export default async function DecisionsPage() {
  const m = await getModel();
  const r = m.register;
  // Commits the register can be compared with: remote-tracking branches, and the commit before this one.
  const refs = [...new Set([...m.repo.remoteRefs.map((x) => x.name), 'HEAD~1'])];
  return (
    <>
      <PageHeader title="Decision Register" lede={`${r.stats.byKind.adr} architecture decision records and ${r.stats.byKind['register-entry']} open register entries, normalized to one schema. Every field is copied from a source file with its line, or left empty and declared. Statuses are mapped by written rules and never promoted.`} />
      <RegisterHealth stats={r.stats} validation={r.validation} duplicates={r.duplicates} suggestionCount={r.suggestions.length} commit={r.commit} refs={refs} warnings={r.warnings} />
      <Suspense fallback={<PageSkeleton />}>
        <DecisionExplorer records={r.records} duplicates={r.duplicates} suggestions={r.suggestions} lookup={buildLookup(m)} />
      </Suspense>
    </>
  );
}
