import type { NextRequest } from 'next/server';
import { guard, ok } from '@/lib/api.ts';
import { currentSession, runtime } from '@/lib/workflow/http.ts';
import { isTestMode } from '@/lib/workflow/runtime.ts';

export const dynamic = 'force-dynamic';

/** Who is signed in, if anyone. Answers 200 either way so the page can ask without an error. */
export function GET(req: NextRequest) {
  return guard(async () => {
    const s = currentSession(req);
    const { service } = runtime();
    const policy = service.policy();
    const base = { testMode: isTestMode(), canonicalRef: service.deps.canonicalRef, policy: { source: policy.source, configured: policy.people.length > 0, problems: policy.problems } };
    if (!s) return ok({ authenticated: false, ...base });
    const person = policy.people.find((p) => p.githubLogin.toLowerCase() === s.user.login.toLowerCase() && p.githubId === s.user.id);
    return ok({ authenticated: true, csrf: s.csrf, user: { login: s.user.login, name: s.user.name, verifiedBy: s.user.verifiedBy, roles: person?.roles ?? [], listed: !!person }, ...base });
  });
}
