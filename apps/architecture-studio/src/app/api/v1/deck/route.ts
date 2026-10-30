import type { NextRequest } from 'next/server';
import { guard, ok } from '@/lib/api.ts';
import { deckRights } from '@/lib/deck/auth.ts';
import { getDeckView } from '@/lib/deck/server.ts';

export const dynamic = 'force-dynamic';

/** The deck as the repository and the people's decisions make it now: slides, claim checks, gate, and the latest build. Read-only. */
export function GET(req: NextRequest) {
  return guard(async () => ok({ ...getDeckView(), me: deckRights(req) }));
}
