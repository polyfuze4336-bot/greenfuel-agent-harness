import { guard, ok } from '@/lib/api.ts';
import { authConfig } from '@/lib/auth/config.ts';
import { getModel } from '@/lib/repo/index.ts';

export const dynamic = 'force-dynamic';

/**
 * Which code is running and which repository commit it is showing, with the record counts. It exists so that two copies of the Studio
 * (this computer, Azure) can be compared with a command instead of by eye. It reveals no secret and no repository content.
 */
export function GET() {
  return guard(async () => {
    const m = await getModel();
    return ok({
      build: process.env.STUDIO_BUILD_ID ?? 'unknown',
      authMode: authConfig().mode,
      data: { ref: m.repo.ref, commit: m.repo.commit, commitShort: m.repo.commitShort },
      counts: { decisions: m.register.records.length, adrs: m.register.stats.byKind.adr, registerEntries: m.register.stats.byKind['register-entry'], tasks: m.tasks.length, requirements: m.requirements.length, risks: m.risks.length, assumptions: m.assumptions.length },
    });
  });
}
