import { guard, ok } from '@/lib/api.ts';
import { getBaselineView } from '@/lib/baseline/server.ts';

export const dynamic = 'force-dynamic';

/**
 * Build readiness for every area, the baselines on the repository and what blocks each area. Read-only: the Studio does not generate,
 * authorize or reopen a baseline; a human does that with the CLI and a signed approval, and this shows the result.
 */
export function GET() {
  return guard(async () => ok(getBaselineView()));
}
