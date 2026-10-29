import { guard, ok } from '@/lib/api.ts';
import { getModel } from '@/lib/repo/index.ts';

export const dynamic = 'force-dynamic';

/** The register's health: counts, schema validation, duplicate candidates, and warnings. Records are at /api/v1/decisions. */
export function GET() {
  return guard(async () => {
    const m = await getModel();
    const r = m.register;
    return ok({ commit: r.commit, stats: r.stats, validation: r.validation, duplicates: r.duplicates, suggestions: { count: r.suggestions.length, label: 'AI SUGGESTION', reviewState: 'unreviewed' }, warnings: r.warnings });
  });
}
