import type { NextRequest } from 'next/server';
import { guard, ok, problem } from '@/lib/api.ts';
import { isHandledEvent, targetOf, verifySignature } from '@/lib/github/webhook.ts';
import { reconcile } from '@/lib/github/reconcile.ts';
import { invalidateModel } from '@/lib/repo/index.ts';
import { invalidateQueue } from '@/lib/queue/server.ts';
import { runtime } from '@/lib/workflow/http.ts';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 1_000_000;

/**
 * GitHub webhook receiver. It does not use the session: GitHub is the caller, and the signature over the exact raw body, made
 * with the shared secret, is the credential. A verified delivery only names what to re-check; the re-check asks GitHub itself,
 * so nothing in the payload can change what the Studio shows.
 */
export function POST(req: NextRequest) {
  return guard(async () => {
    const rt = runtime();
    const cfg = rt.app?.config;
    if (!cfg?.webhookSecret) return problem(503, 'Webhooks are not configured', 'Set STUDIO_GITHUB_WEBHOOK_SECRET to receive GitHub webhooks.', 'webhook-not-configured');
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return problem(413, 'Payload too large', 'The delivery is larger than the Studio accepts.');
    const raw = await req.text();
    if (raw.length > MAX_BYTES) return problem(413, 'Payload too large', 'The delivery is larger than the Studio accepts.');

    const delivery = req.headers.get('x-github-delivery') ?? '';
    const event = req.headers.get('x-github-event') ?? '';
    const audit = (code: string, detail: string, outcome: 'denied' | 'sync' = 'sync') =>
      rt.service.deps.store.audit({ at: new Date().toISOString(), actor: null, decisionId: null, action: `webhook:${event.slice(0, 30) || 'unknown'}`, outcome, code, detail: detail.slice(0, 300), proposalId: null });

    if (!verifySignature(cfg.webhookSecret, raw, req.headers.get('x-hub-signature-256'))) {
      audit('bad-signature', `Rejected a delivery with a missing or wrong signature (delivery ${delivery.slice(0, 40)})`, 'denied');
      return problem(401, 'Signature check failed', 'The delivery was not signed with the shared secret.', 'bad-signature');
    }
    if (!/^[A-Za-z0-9-]{8,64}$/.test(delivery) || !/^[a-z_]{3,40}$/.test(event)) return problem(400, 'Bad delivery headers', 'The delivery id or event name is missing or malformed.');
    if (rt.deliveries.seen(delivery)) return ok({ duplicate: true });

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return problem(400, 'Bad payload', 'The body is not JSON.');
    }
    const target = targetOf(event, payload);
    if (target.repo && target.repo.toLowerCase() !== cfg.repo.toLowerCase()) {
      rt.deliveries.record(delivery);
      return ok({ ignored: 'another repository' });
    }
    if (!isHandledEvent(event) || event === 'ping') {
      rt.deliveries.record(delivery);
      return ok({ ignored: event === 'ping' ? 'ping acknowledged' : 'event not used' });
    }

    const canonicalBranch = rt.service.deps.canonicalRef.split('/').slice(1).join('/');
    const wide = target.pushedRef === `refs/heads/${canonicalBranch}`;
    const report = await reconcile(rt, { trigger: `webhook:${event}`, ...(wide ? {} : { prNumbers: target.prNumbers, headShas: target.headShas }) });
    if (report.anyApplied || wide) {
      invalidateModel();
      invalidateQueue();
    }
    // A delivery is remembered only once it was handled, so a failed one can be redelivered.
    if (report.failures.some((f) => f.retryable)) return problem(503, 'Could not process the delivery', 'GitHub could not be reached to re-check. Redeliver it, or use Reconcile.', 'retry');
    rt.deliveries.record(delivery);
    audit('webhook-handled', `${event}${target.action ? `/${target.action}` : ''} re-checked ${report.checked} proposal(s); ${report.advanced.length} advanced`);
    return ok({ handled: true, checked: report.checked, advanced: report.advanced });
  });
}
