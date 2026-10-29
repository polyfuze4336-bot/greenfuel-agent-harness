import { guard, ok } from '@/lib/api.ts';
import { syncRegister } from '@/lib/intel/engine.ts';
import { openAdapter, stateStore } from '@/lib/repo/index.ts';

export const dynamic = 'force-dynamic';

/** The last synchronised baseline, if any. */
export function GET() {
  return guard(async () => {
    const s = stateStore().load();
    return ok({ baseline: s ? { commit: s.commit, ref: s.ref, savedAt: s.savedAt, records: s.records.length } : null });
  });
}

/**
 * Incremental synchronisation: re-parse only the source files whose git blob changed, report what changed in the
 * register since the last sync, and save the new baseline in the Studio's own cache folder. The repository is not touched.
 */
export function POST() {
  return guard(async () => {
    const { snapshot, changes } = syncRegister(openAdapter(), stateStore());
    return ok({ syncedAt: new Date().toISOString(), commit: snapshot.commit, stats: snapshot.stats, changes });
  });
}
