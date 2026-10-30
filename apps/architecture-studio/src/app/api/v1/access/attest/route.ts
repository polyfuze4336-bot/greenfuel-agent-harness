import type { NextRequest } from 'next/server';
import { guard, ok, problem } from '@/lib/api.ts';
import { runtime } from '@/lib/workflow/http.ts';
import { requireAdmin } from '../_admin.ts';

export const dynamic = 'force-dynamic';

/** Records that the administrator reviewed the access policy as it stands, with the policy hash, who looked and when. It changes no access. */
export function POST(req: NextRequest) {
  return guard(async () => {
    const s = requireAdmin(req, 'access:review');
    if (s instanceof Response) return s;
    const body = (await req.json().catch(() => null)) as { note?: unknown } | null;
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : '';
    const rt = runtime();
    const policy = rt.service.policy();
    if (policy.pinMismatch) return problem(409, 'Policy not trusted', 'The access policy does not match the pinned hash, so there is nothing trustworthy to attest.', 'policy-invalid');
    const e = rt.service.deps.store.audit({ at: new Date().toISOString(), actor: s.user.login, decisionId: null, action: 'access-review', outcome: 'accepted', code: null, detail: note || 'Access policy reviewed', proposalId: null, facts: { newValue: policy.hash } });
    return ok({ recorded: true, policyHash: policy.hash, at: e.at });
  });
}
