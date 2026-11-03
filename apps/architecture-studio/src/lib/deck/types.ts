// The model the presentation pipeline works in. A slide is data: a message, a visual described by data, claims that each name their
// sources, and speaker notes. Nothing here says how it is drawn; build.ts draws it, so the same slide can be previewed, checked and exported.

/** What kind of evidence backs a statement. Shown on slides so an audience can tell a measurement from a scenario or a design. */
export type Chip = 'CASE STUDY' | 'CANDIDATE' | 'SCENARIO' | 'DESIGN' | 'REAL RUN' | 'MEASURED' | 'NOT BUILT' | 'NOT RUN' | 'NOT PROVIDED' | 'REVIEW';

export type Tier = 'executive' | 'technical' | 'appendix';
export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

export interface SourceRef {
  /** Repository path. */
  path: string;
  chip?: Chip;
}

/** One statement a slide makes that an audience could challenge. It is checked against the sources it cites. */
export interface Claim {
  id: string;
  text: string;
  sources: string[];
  /** Strings that must appear in the cited sources. If one does not, the claim is unsupported. */
  contains?: string[];
}

/** Evidence the slide needs and the repository does not hold. It is shown on the slide and must be resolved by a person before the final deck. */
export interface Placeholder {
  id: string;
  what: string;
  why: string;
  neededFrom: string;
}

export interface Item {
  label: string;
  /** A number to chart. Only ever taken from a source. */
  value?: number;
  /** How the value is written. */
  text?: string;
  sub?: string;
  chip?: Chip;
  tone?: Tone;
}

export type Verdict = 'meets' | 'conditional' | 'does-not-meet' | 'unknown' | 'other';

export interface Box {
  id: string;
  label: string;
  sub?: string;
  tone?: Tone;
  /** An Azure service this box stands for, looked up in the icon registry. */
  azure?: string;
}

export type Visual =
  | { kind: 'hero'; sub: string; meta?: string; image?: string }
  | { kind: 'flow'; stages: { label: string; sub?: string; chip?: Chip }[]; breaks?: string[]; breaksTitle?: string }
  | { kind: 'stats'; items: Item[]; foot?: string }
  | { kind: 'bars'; title: string; items: Item[]; unit?: string; foot?: string }
  | { kind: 'cards'; items: { title: string; line: string; verdict: string; tone: Tone }[] }
  | { kind: 'table'; head: string[]; rows: string[][]; widths?: number[]; tone?: number | number[]; compact?: boolean; foot?: string }
  | { kind: 'matrix'; cols: string[]; rows: { label: string; cells: { verdict: Verdict; text: string }[] }[]; foot?: string }
  | { kind: 'timeline'; steps: { t: string; label: string; sub?: string }[]; foot?: string }
  | { kind: 'cells'; foot?: string }
  | { kind: 'edge-flow'; flows: { id: string; from: string; to: string; data: string; position: string; tone: Tone }[]; foot?: string }
  | { kind: 'trust-chain'; steps: { label: string; sub: string }[]; foot?: string }
  | { kind: 'autonomy'; agents: { name: string; level: number; why: string }[]; levels: { id: string; meaning: string }[]; foot?: string }
  | { kind: 'topology'; foot?: string }
  | { kind: 'review'; need: string; have?: string[] };

export type VisualKind = Visual['kind'];

export interface Slide {
  id: string;
  tier: Tier;
  /** The running section label above the title. */
  section: string;
  /** The one message. */
  title: string;
  /** One supporting line. */
  message: string;
  visual: Visual;
  claims: Claim[];
  sources: SourceRef[];
  /** Decision ids this slide leans on; their status is read from the register, never written by hand. */
  decisions: string[];
  placeholders: Placeholder[];
  notes: { say: string; next?: string; ifAsked?: string[]; honesty?: string };
  seconds: number;
  /** Rubric criteria this slide serves (B1 to B7, and C1 to C3 where it matters). */
  rubric: string[];
}

export interface ClaimCheck {
  claimId: string;
  slideId: string;
  ok: boolean;
  problems: string[];
}

/** A person's editorial decision on a slide. It is not an architecture approval and authorizes nothing outside the deck. */
export type SlideStatus = 'draft' | 'approved' | 'rejected';

export interface SlideEvent {
  at: string;
  actor: string;
  action: 'approve' | 'reject' | 'reset' | 'retitle' | 'choose-visual' | 'regenerate' | 'edit-notes' | 'move' | 'comment';
  /** The content hash the action applied to. */
  contentHash: string;
  detail?: string;
}

export interface SlideState {
  status: SlideStatus;
  /** The hash the approval or rejection was given against. If the slide changes afterwards, the decision no longer applies. */
  decidedHash: string | null;
  decidedBy: string | null;
  titleOverride: string | null;
  visualKind: VisualKind | null;
  /** A person's replacement for the spoken script. Not claim-checked: the person who wrote it answers for it. */
  notesOverride?: string | null;
  /** The status of every decision the slide leans on when it was approved or rejected, so a later change can be named, not just detected. */
  decidedDecisions?: Record<string, string> | null;
  reason: string | null;
  events: SlideEvent[];
}

export interface DeckState {
  version: 1;
  slides: Record<string, SlideState>;
  /** The order of the slides when a person has moved any. Absent means the generated order. The title slide always stays first. */
  order?: string[];
  /** Bumped on every change, so two people editing at once cannot silently overwrite each other. */
  revision: number;
}

export const emptySlideState = (): SlideState => ({ status: 'draft', decidedHash: null, decidedBy: null, titleOverride: null, visualKind: null, notesOverride: null, decidedDecisions: null, reason: null, events: [] });
