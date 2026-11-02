import { guard, ok } from '@/lib/api.ts';
import { authConfig } from '@/lib/auth/config.ts';
import { getModel } from '@/lib/repo/index.ts';

export const dynamic = 'force-dynamic';

/**
 * Re-reads the repository. This only discards the Studio's short-lived cache and rebuilds the read model from git
 * objects: it does not fetch, pull, write or change anything in the repository.
 */
export function POST() {
  return guard(async () => {
    // Anyone can call this in the public read-only mode, so it must not be a way to make the server rebuild on demand.
    const m = await getModel({ fresh: authConfig().mode !== 'public-readonly' });
    return ok({ refreshedAt: m.repo.generatedAt, commit: m.repo.commit });
  });
}
