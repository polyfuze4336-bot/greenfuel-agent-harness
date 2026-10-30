import { guard, ok } from '@/lib/api.ts';
import { getQueue } from '@/lib/queue/server.ts';
import { VIEWS, VIEW_LABEL, VIEW_RULE } from '@/lib/queue/views.ts';
import { currentSession, runtime } from '@/lib/workflow/http.ts';
import { effectiveRoles, keyOf } from '@/lib/auth/authorize.ts';
import { authContextFor } from '@/lib/auth/config.ts';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

/** The whole Work Queue: every item with its source, the graph edges, the build-blocking analysis and decision impacts. */
export function GET(req: NextRequest) {
  return guard(async () => {
    const q = await getQueue();
    const rt = runtime();
    const policy = rt.service.policy();
    const session = currentSession(req);
    const ctx = authContextFor(policy);
    const roles = session ? effectiveRoles(session.user, ctx).roles : [];
    return ok({
      ...q.snapshot,
      views: VIEWS.map((v) => ({ id: v, label: VIEW_LABEL[v], rule: VIEW_RULE[v] })),
      canonical: { ref: q.snapshot.canonicalRef, commit: q.canonicalCommit, available: q.canonicalAvailable },
      policy: { source: policy.source, completionRoles: ['architecture-owner'], independent: policy.segregation.enforce, people: policy.people.filter((p) => p.revokedAt === null).map((p) => ({ login: p.login, holder: p.holder, roles: p.roles })) },
      me: session ? { login: session.user.login, roles, listed: policy.people.some((p) => p.subject === keyOf(session.user)) } : null,
    });
  });
}
