// A person's editorial decisions on slides: approve, reject, retitle, choose another visual, regenerate. This is deck-editing state, kept
// apart from the repository: it authorizes nothing outside the deck, and it is not an architecture approval.
//
// Rules the code enforces, not the screen:
//   - an approval or rejection is bound to the content hash it was given against; if the slide changes, it no longer applies ("stale");
//   - a slide that still carries a review placeholder can be approved only with a written acknowledgement;
//   - a rejection needs a reason;
//   - every change needs the revision the caller saw, so two people cannot silently overwrite each other;
//   - every change is an event with the person who made it.
import fs from 'node:fs';
import path from 'node:path';
import { variantsOf } from './slides.ts';
import { emptySlideState, type DeckState, type SlideState, type Visual, type VisualKind } from './types.ts';

export class DeckError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'DeckError';
    this.code = code;
    this.status = status;
  }
}

export type DeckAction =
  | { action: 'approve'; slideId: string; contentHash: string; reason?: string }
  | { action: 'reject'; slideId: string; contentHash: string; reason: string }
  | { action: 'reset'; slideId: string }
  | { action: 'retitle'; slideId: string; title: string }
  | { action: 'edit-notes'; slideId: string; notes: string }
  | { action: 'move'; slideId: string; direction: 'up' | 'down' }
  | { action: 'reset-order'; slideId?: string }
  | { action: 'choose-visual'; slideId: string; visual: VisualKind }
  | { action: 'regenerate'; slideId: string };

export interface SlideFacts {
  id: string;
  /** Hash of the slide as it is now, with the person's edits applied. */
  contentHash: string;
  placeholders: number;
  visual: Visual;
  /** The register's status for each decision the slide leans on, as of now. */
  decisions: Record<string, string>;
}

export type EffectiveStatus = 'draft' | 'approved' | 'rejected' | 'stale-approved' | 'stale-rejected';

/** What a stored decision means against the slide's current content. A decision given to older content is shown as stale and never counts. */
export function statusOf(st: SlideState | undefined, currentHash: string): EffectiveStatus {
  if (!st || st.status === 'draft') return 'draft';
  if (st.decidedHash !== currentHash) return st.status === 'approved' ? 'stale-approved' : 'stale-rejected';
  return st.status;
}

export const emptyDeckState = (): DeckState => ({ version: 1, slides: {}, revision: 0 });

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** Spoken script: keeps line breaks, drops every other control character. */
const cleanNotes = (s: string, max: number) => s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
export const NOTES_MAX = 4000;
const undecided = { status: 'draft' as const, decidedHash: null, decidedBy: null, reason: null, decidedDecisions: null };

export function applyAction(state: DeckState, a: DeckAction, slides: Map<string, SlideFacts>, actor: string, now: Date, nextHash: (slideId: string, st: SlideState) => string): void {
  if (!actor.trim()) throw new DeckError('no-actor', 401, 'Every change needs a named person.');
  if (a.action === 'reset-order') {
    delete state.order;
    return;
  }
  const facts = slides.get(a.slideId!);
  if (!facts) throw new DeckError('unknown-slide', 404, `There is no slide ${a.slideId}.`);
  const slideId = a.slideId!;
  const st = (state.slides[slideId] ??= emptySlideState());
  const log = (action: SlideState['events'][number]['action'], hash: string, detail?: string) => st.events.push({ at: now.toISOString(), actor, action, contentHash: hash, detail });

  switch (a.action) {
    case 'approve': {
      if (a.contentHash !== facts.contentHash) throw new DeckError('stale', 409, 'The slide changed after you opened it. Reload and review the current version.');
      const reason = clean(a.reason ?? '', 500);
      if (facts.placeholders > 0 && reason.length < 10) throw new DeckError('acknowledge-placeholder', 422, 'This slide shows a review placeholder. Approving it means presenting the gap; say so in a written acknowledgement.');
      Object.assign(st, { status: 'approved', decidedHash: facts.contentHash, decidedBy: actor, reason: reason || null, decidedDecisions: { ...facts.decisions } });
      log('approve', facts.contentHash, reason || undefined);
      return;
    }
    case 'reject': {
      if (a.contentHash !== facts.contentHash) throw new DeckError('stale', 409, 'The slide changed after you opened it. Reload and review the current version.');
      const reason = clean(a.reason, 500);
      if (reason.length < 5) throw new DeckError('reason-required', 422, 'A rejection needs a reason.');
      Object.assign(st, { status: 'rejected', decidedHash: facts.contentHash, decidedBy: actor, reason, decidedDecisions: { ...facts.decisions } });
      log('reject', facts.contentHash, reason);
      return;
    }
    case 'reset': {
      Object.assign(st, undecided);
      log('reset', facts.contentHash);
      return;
    }
    case 'retitle': {
      const title = clean(a.title, 160);
      if (title.length < 3) throw new DeckError('bad-title', 422, 'A title needs at least three characters.');
      st.titleOverride = title;
      Object.assign(st, undecided);
      log('retitle', nextHash(slideId, st), title);
      return;
    }
    case 'edit-notes': {
      const notes = cleanNotes(typeof a.notes === 'string' ? a.notes : '', NOTES_MAX);
      if (notes.length < 10) throw new DeckError('bad-notes', 422, 'Speaker notes need at least ten characters. To go back to the generated script, regenerate the slide.');
      st.notesOverride = notes;
      Object.assign(st, undecided);
      log('edit-notes', nextHash(slideId, st), `${notes.length} characters`);
      return;
    }
    case 'move': {
      if (a.direction !== 'up' && a.direction !== 'down') throw new DeckError('bad-move', 422, 'Move a slide up or down.');
      const order = [...slides.keys()];
      const i = order.indexOf(slideId);
      const j = a.direction === 'up' ? i - 1 : i + 1;
      if (i === 0 || j === 0) throw new DeckError('title-fixed', 422, 'The title slide stays first.');
      if (j >= order.length) throw new DeckError('bad-move', 422, 'This slide is already last.');
      [order[i], order[j]] = [order[j]!, order[i]!];
      state.order = order;
      // Its content is unchanged, so an approval stays valid: only the place in the story moves.
      log('move', facts.contentHash, `${a.direction} to position ${j + 1}`);
      return;
    }
    case 'choose-visual': {
      if (!variantsOf(facts.visual).includes(a.visual)) throw new DeckError('bad-visual', 422, `This slide cannot be shown as ${a.visual}; it would lose information.`);
      st.visualKind = a.visual;
      Object.assign(st, undecided);
      log('choose-visual', nextHash(slideId, st), a.visual);
      return;
    }
    case 'regenerate': {
      // Discard edits and take the slide as the current repository sources produce it. Its place in the order is kept.
      Object.assign(st, undecided, { titleOverride: null, visualKind: null, notesOverride: null });
      log('regenerate', nextHash(slideId, st));
      return;
    }
  }
}

/** A JSON file, replaced atomically. One server process writes it; the revision check protects against two browsers. */
export class DeckStore {
  readonly file: string;
  constructor(file: string) {
    this.file = file;
  }

  read(): DeckState {
    try {
      const s = JSON.parse(fs.readFileSync(this.file, 'utf8')) as DeckState;
      return s.version === 1 && s.slides && typeof s.revision === 'number' ? s : emptyDeckState();
    } catch {
      return emptyDeckState();
    }
  }

  write(state: DeckState) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, this.file);
  }

  /** Applies one action if the caller saw the current revision. Returns the new state. */
  mutate(expectedRevision: number, fn: (s: DeckState) => void): DeckState {
    const s = this.read();
    if (s.revision !== expectedRevision) throw new DeckError('conflict', 409, 'Someone else changed the deck. Reload to see the current state.');
    fn(s);
    s.revision += 1;
    this.write(s);
    return s;
  }
}
