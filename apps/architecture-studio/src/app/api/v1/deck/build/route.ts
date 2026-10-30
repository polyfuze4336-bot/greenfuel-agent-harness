import type { NextRequest } from 'next/server';
import { guard, ok, problem } from '@/lib/api.ts';
import { denial } from '@/lib/deck/auth.ts';
import { build } from '@/lib/deck/server.ts';
import { DeckError } from '@/lib/deck/store.ts';
import { currentSession, requireSession } from '@/lib/workflow/http.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Builds the PowerPoint (and, with Microsoft PowerPoint installed, the PDF and previews) from the repository at the commit the Studio reads.
 * A sample build needs the permission to propose. A final build needs the permission to recommend and is refused until the gate is met.
 */
export function POST(req: NextRequest) {
  return guard(async () => {
    const s = requireSession(req);
    if (s instanceof Response) return s;
    const body = (await req.json().catch(() => null)) as { mode?: unknown } | null;
    const mode = body?.mode === 'final' ? 'final' : body?.mode === 'sample' || body?.mode === undefined ? 'sample' : null;
    if (!mode) return problem(400, 'Unknown mode', 'The mode must be sample or final.');
    const why = denial(req, mode === 'final' ? 'recommend' : 'propose');
    if (why) return problem(403, 'Not permitted', why, 'forbidden');
    try {
      return ok({ build: await build(mode, currentSession(req)!.user.login) });
    } catch (e) {
      if (e instanceof DeckError || (e as { name?: string })?.name === 'DeckError') {
        const d = e as DeckError;
        return problem(d.status, d.code, d.message, d.code);
      }
      return problem(500, 'Build failed', (e as Error).message.slice(0, 300), 'build-failed');
    }
  });
}
