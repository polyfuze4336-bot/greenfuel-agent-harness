import { guard, ok } from '@/lib/api.ts';
import { getModel } from '@/lib/repo/index.ts';

export const dynamic = 'force-dynamic';

export function GET() {
  return guard(async () => {
    const m = await getModel();
    return ok({ repo: m.repo, metrics: m.metrics, blockers: m.blockers, attention: m.attention, warnings: m.warnings });
  });
}
