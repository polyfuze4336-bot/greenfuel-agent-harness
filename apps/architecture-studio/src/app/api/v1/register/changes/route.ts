import type { NextRequest } from 'next/server';
import { guard, ok, problem } from '@/lib/api.ts';
import { diffRegisters } from '@/lib/intel/diff.ts';
import { buildRegister, changesBetween } from '@/lib/intel/engine.ts';
import { openAdapter, stateStore } from '@/lib/repo/index.ts';
import { validateRef } from '@/lib/repo/git.ts';

export const dynamic = 'force-dynamic';

/**
 * Repository changes, read-only. With ?from=<ref> the register at that ref is compared with the register being read.
 * Without it, the register is compared with the last synchronised baseline. Nothing is saved by this route.
 */
export function GET(req: NextRequest) {
  return guard(async () => {
    const from = req.nextUrl.searchParams.get('from');
    const to = openAdapter();
    if (from) {
      try {
        validateRef(from);
      } catch {
        return problem(400, 'Invalid ref', 'from must be a plain branch, tag or commit name.');
      }
      let a;
      try {
        a = openAdapter(from);
      } catch {
        return problem(404, 'Ref not found', `"${from.slice(0, 60)}" does not resolve to a commit in this repository.`);
      }
      return ok({ mode: 'ref', changes: changesBetween(a, to) });
    }
    const base = stateStore().load();
    if (!base) return ok({ mode: 'baseline', baseline: null, changes: null });
    const now = buildRegister(to).snapshot;
    return ok({ mode: 'baseline', baseline: { commit: base.commit, savedAt: base.savedAt }, changes: diffRegisters(base.records, now.records, base.commit, to.commit) });
  });
}
