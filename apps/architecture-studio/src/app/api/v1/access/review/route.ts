import type { NextRequest } from 'next/server';
import { guard, ok } from '@/lib/api.ts';
import { authConfig, suspensions } from '@/lib/auth/config.ts';
import { buildAccessReport } from '@/lib/auth/review.ts';
import { classify, designatedOwners } from '@/lib/auth/access-policy.ts';
import { getModel } from '@/lib/repo/index.ts';
import { runtime } from '@/lib/workflow/http.ts';
import { requireAdmin } from '../_admin.ts';

export const dynamic = 'force-dynamic';

/** Who can do what, and what looks wrong. Needs the access:review permission (Administrator). Read-only. */
export function GET(req: NextRequest) {
  return guard(async () => {
    const s = requireAdmin(req, 'access:review', { csrf: false });
    if (s instanceof Response) return s;
    const rt = runtime();
    const policy = rt.service.policy();
    const report = buildAccessReport({ policy, pinned: !!authConfig().policyPin, now: Date.now(), audit: rt.service.deps.store.readAudit({ limit: 500 }), sessions: rt.sessions.list(), suspensions: suspensions().list() });
    // How the decisions fall into approval domains, and how many have nobody designated.
    const model = await getModel();
    const by: Record<string, { total: number; noDesignatedApprover: number }> = {};
    for (const d of model.register.records) {
      const rec = { id: d.id, kind: d.kind, approverText: d.requiredApproverRole?.text ?? null };
      const c = classify(policy, rec);
      const row = (by[c.domain] ??= { total: 0, noDesignatedApprover: 0 });
      row.total++;
      if (c.domain !== 'regulatory' && c.domain !== 'unclassified' && designatedOwners(policy, c.domain, rec).length === 0) row.noDesignatedApprover++;
    }
    return ok({ ...report, decisionsByDomain: by });
  });
}
