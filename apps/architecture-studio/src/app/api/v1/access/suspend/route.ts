import type { NextRequest } from 'next/server';
import { guard, ok, problem } from '@/lib/api.ts';
import { keyOf } from '@/lib/auth/authorize.ts';
import { suspensions } from '@/lib/auth/config.ts';
import { runtime } from '@/lib/workflow/http.ts';
import { requireAdmin } from '../_admin.ts';

export const dynamic = 'force-dynamic';

const SUBJECT = /^(?:github:[1-9]\d{0,12}|entra:[0-9a-f-]{36}:[0-9a-f-]{36})$/i;

/**
 * Suspend (or lift the suspension of) a person with immediate effect: their sessions end and every later request is refused.
 * An administrator cannot suspend or reinstate themselves. This does not change the policy; revoking the enrollment is still a reviewed change.
 */
export function POST(req: NextRequest) {
  return guard(async () => {
    const s = requireAdmin(req, 'access:administer');
    if (s instanceof Response) return s;
    const body = (await req.json().catch(() => null)) as { subject?: unknown; reason?: unknown; lift?: unknown } | null;
    const subject = typeof body?.subject === 'string' ? body.subject.trim().toLowerCase() : '';
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
    if (!SUBJECT.test(subject)) return problem(400, 'Invalid subject', 'Name the person by subject, like github:<id> or entra:<tenant>:<object id>.', 'invalid');
    const rt = runtime();
    const audit = (action: string, detail: string) => rt.service.deps.store.audit({ at: new Date().toISOString(), actor: s.user.login, decisionId: null, action, outcome: 'accepted', code: null, detail, proposalId: null, facts: { newValue: subject } });
    if (subject === keyOf(s.user)) return problem(403, 'Not permitted', 'You cannot change your own suspension.', 'self-suspend');
    if (body?.lift === true) {
      const lifted = suspensions().lift(subject);
      if (lifted) audit('access-unsuspend', `Lifted suspension of ${subject}`);
      return ok({ lifted });
    }
    if (reason.length < 10) return problem(400, 'A reason is required', 'Say why, in at least 10 characters.', 'invalid');
    suspensions().suspend({ subject, by: s.user.login, reason, at: new Date().toISOString() });
    const ended = rt.sessions.revokeSubject(subject);
    audit('access-suspend', `Suspended ${subject}: ${reason}. ${ended} session(s) ended.`);
    return ok({ suspended: true, sessionsEnded: ended });
  });
}
