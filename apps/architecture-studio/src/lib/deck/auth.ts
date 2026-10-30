// Server-side authorization for the Presentation Studio. Editing a slide needs the permission to propose; approving or rejecting one, or
// building a final deck, needs the permission to recommend. Both come from the person's enrolled role, checked on every request. Nothing
// the browser sends can raise them, and no AI agent has a session.
import type { NextRequest } from 'next/server';
import { permissionsOf, type Permission } from '../auth/model.ts';
import { effectiveRoles } from '../auth/authorize.ts';
import { authContextFor } from '../auth/config.ts';
import { currentSession, runtime } from '../workflow/http.ts';

export type DeckPermission = Extract<Permission, 'propose' | 'recommend'>;

export function deckRights(req: NextRequest): { login: string | null; canEdit: boolean; canApprove: boolean } {
  const session = currentSession(req);
  if (!session) return { login: null, canEdit: false, canApprove: false };
  const ctx = authContextFor(runtime().service.policy());
  const perms = permissionsOf(effectiveRoles(session.user, ctx).roles);
  return { login: session.user.login, canEdit: perms.has('propose'), canApprove: perms.has('recommend') };
}

/** Null when allowed; otherwise a message that says what is missing. */
export function denial(req: NextRequest, need: DeckPermission): string | null {
  const r = deckRights(req);
  if (!r.login) return 'Sign in first.';
  if (need === 'propose' && !r.canEdit) return 'Your role cannot edit the deck. It needs the permission to propose.';
  if (need === 'recommend' && !r.canApprove) return 'Your role cannot approve or reject slides. It needs the permission to recommend.';
  return null;
}
