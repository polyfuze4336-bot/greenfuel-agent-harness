import type { NextRequest } from 'next/server';
import { guard, ok } from '@/lib/api.ts';
import { effectiveRoles } from '@/lib/auth/authorize.ts';
import { authConfig, authContextFor, getTrust } from '@/lib/auth/config.ts';
import { currentSession, runtime } from '@/lib/workflow/http.ts';
import { isTestMode } from '@/lib/workflow/runtime.ts';

export const dynamic = 'force-dynamic';

/** Who is signed in, if anyone, and how. Answers 200 either way so the page can ask without an error. Public: it reveals only the caller's own session. */
export function GET(req: NextRequest) {
  return guard(async () => {
    const rt = runtime();
    const s = currentSession(req);
    const cfg = authConfig();
    const policy = rt.service.policy();
    const ctx = authContextFor(policy);
    const trust = getTrust();
    const base = {
      mode: cfg.mode,
      testMode: isTestMode(),
      canonicalRef: rt.service.deps.canonicalRef,
      devApprovals: ctx.devApprovals,
      entraConfigured: !!rt.entra,
      authProblems: cfg.problems,
      policy: { source: policy.source, configured: policy.people.length > 0, problems: policy.problems, hash: policy.hash, pinMismatch: policy.pinMismatch },
      signing: { ready: !!trust.signer, problem: trust.signerProblem },
    };
    if (!s) return ok({ authenticated: false, ...base });
    const { roles, notes } = effectiveRoles(s.user, ctx);
    const person = policy.people.find((p) => p.subject === `${s.user.provider}:${s.user.subject}`.toLowerCase());
    const approvalWindowEndsAt = s.user.authAt + policy.session.approvalMaxAuthAgeMinutes * 60_000;
    return ok({
      authenticated: true,
      csrf: s.csrf,
      user: { login: s.user.login, name: s.user.name, provider: s.user.provider, verifiedBy: s.user.verifiedBy, roles, listed: !!person, mfa: s.user.mfa, notes },
      session: { createdAt: s.createdAt, idleExpiresAt: s.lastSeenAt + s.idleMs, absoluteExpiresAt: s.absoluteExpiresAt, approvalWindowEndsAt },
      ...base,
    });
  }, { public: true });
}
