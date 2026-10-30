import type { NextRequest } from 'next/server';
import { guard, ok, problem } from '@/lib/api.ts';
import { denial } from '@/lib/deck/auth.ts';
import { act, getDeckView } from '@/lib/deck/server.ts';
import { DeckError, type DeckAction } from '@/lib/deck/store.ts';
import { currentSession, requireSession } from '@/lib/workflow/http.ts';

export const dynamic = 'force-dynamic';

const ACTIONS = new Set(['approve', 'reject', 'reset', 'retitle', 'choose-visual', 'regenerate']);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * ONE editorial action on ONE slide. Editing needs the permission to propose; approving or rejecting needs the permission to recommend.
 * There is no bulk form. An approval is bound to the content hash the person saw; if the slide changed, it is refused as stale.
 */
export function POST(req: NextRequest) {
  return guard(async () => {
    const s = requireSession(req);
    if (s instanceof Response) return s;
    if (Number(req.headers.get('content-length') ?? 0) > 20_000) return problem(413, 'Request too large', 'The request is too large.');
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return problem(400, 'Invalid body', 'Send one JSON object describing one action.');
    const action = str(body.action);
    if (!ACTIONS.has(action)) return problem(400, 'Unknown action', 'The action is not one the deck supports.');
    const need = action === 'approve' || action === 'reject' ? 'recommend' : 'propose';
    const why = denial(req, need);
    if (why) return problem(403, 'Not permitted', why, 'forbidden');
    if (typeof body.expectedRevision !== 'number' || !Number.isInteger(body.expectedRevision)) return problem(400, 'Revision required', 'Send the revision of the deck you were looking at.');
    const slideId = str(body.slideId);
    const input = { action, slideId, contentHash: str(body.contentHash), reason: str(body.reason), title: str(body.title), visual: str(body.visual) } as unknown as DeckAction;
    try {
      const actor = `${currentSession(req)!.user.login}`;
      const state = act({ ...input, expectedRevision: body.expectedRevision }, actor);
      return ok({ revision: state.revision, ...getDeckView() });
    } catch (e) {
      if (e instanceof DeckError || (e as { name?: string })?.name === 'DeckError') {
        const d = e as DeckError;
        return problem(d.status, d.code, d.message, d.code);
      }
      throw e;
    }
  });
}
