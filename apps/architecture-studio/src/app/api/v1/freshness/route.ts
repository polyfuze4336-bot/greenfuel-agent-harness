import { guard, ok } from '@/lib/api.ts';
import { freshness } from '@/lib/next/server.ts';

export const dynamic = 'force-dynamic';

/** How current this copy of the repository is: the commit being read, and when the clone last fetched from GitHub. Tiny, so it can be asked often. */
export function GET() {
  return guard(async () => ok(await freshness()), { public: true });
}
