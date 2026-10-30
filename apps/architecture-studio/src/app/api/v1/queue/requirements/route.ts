import type { NextRequest } from 'next/server';
import { guard, ok, problem } from '@/lib/api.ts';
import { GitRepositoryAdapter, validateRef } from '@/lib/repo/git.ts';
import { repoRoot } from '@/lib/repo/index.ts';
import { requirementImpact, requirementsAt } from '@/lib/queue/snapshot.ts';
import { getQueue } from '@/lib/queue/server.ts';

export const dynamic = 'force-dynamic';

/**
 * Which decisions a requirement change touches. Compares the requirements at `from` (a branch, tag or commit) with the ones
 * being read now. Advisory: it flags decisions for review and changes nothing.
 */
export function GET(req: NextRequest) {
  return guard(async () => {
    const from = req.nextUrl.searchParams.get('from')?.trim() ?? '';
    if (!from) return problem(400, 'A ref is required', 'Pass ?from=<branch, tag or commit> to compare the requirements against.');
    let prev;
    try {
      prev = requirementsAt(new GitRepositoryAdapter(repoRoot(), validateRef(from)).open());
    } catch {
      return problem(400, 'Ref not readable', `${from.slice(0, 60)} is not a ref this repository can read.`, 'BAD_REF');
    }
    const q = await getQueue();
    return ok(requirementImpact(q.model, prev, from));
  });
}
