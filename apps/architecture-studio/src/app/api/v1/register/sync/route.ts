import { guard, ok, problem } from '@/lib/api.ts';
import { authConfig } from '@/lib/auth/config.ts';
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
 * The baseline is one file shared by everyone who uses this server, so on a read-only deployment, where anyone can ask, it is not
 * writable: a stranger could otherwise reset what every visitor sees as "changed since the last sync".
 */
export function POST() {
  return guard(async () => {
    if (authConfig().mode === 'public-readonly') return problem(403, 'Read-only deployment', 'This deployment is read-only, so the register baseline cannot be reset here. Use the Studio running on your own computer.', 'read-only');
    const { snapshot, changes } = syncRegister(openAdapter(), stateStore());
    return ok({ syncedAt: new Date().toISOString(), commit: snapshot.commit, stats: snapshot.stats, changes });
  });
}
