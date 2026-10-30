import { guard, ok } from '@/lib/api.ts';
import { lastReconcile } from '@/lib/github/reconcile.ts';
import { isOpen } from '@/lib/workflow/store.ts';
import { runtime } from '@/lib/workflow/http.ts';

export const dynamic = 'force-dynamic';

/** How the Studio is connected to GitHub, and where its proposals stand. Contains no credential of any kind. */
export function GET() {
  return guard(async () => {
    const rt = runtime();
    const open = rt.service.deps.store.list().filter((p) => isOpen(p.state));
    const byState: Record<string, number> = {};
    for (const p of open) byState[p.state] = (byState[p.state] ?? 0) + 1;
    return ok({
      mode: rt.mode,
      repo: rt.app?.config.repo ?? null,
      app: rt.app ? { appId: rt.app.config.appId, installationId: rt.app.config.installationId, tokenExpiresAt: rt.app.auth.tokenExpiresAt(), webhookConfigured: !!rt.app.config.webhookSecret } : null,
      rateLimit: rt.app?.api.rate ?? null,
      canonicalRef: rt.service.deps.canonicalRef,
      openProposals: { total: open.length, byState },
      lastReconcile: lastReconcile(),
    });
  });
}
