// Slide-level logic that is not drawing: which alternative visuals a slide offers, what a slide is after a person's edits, and the hash
// that ties an approval to exactly the content that was approved.
import crypto from 'node:crypto';
import { itemsToTable } from './visuals.ts';
import type { Slide, SlideState, Visual, VisualKind } from './types.ts';

const hasNumbers = (v: Extract<Visual, { kind: 'bars' | 'stats' }>) => v.items.every((i) => typeof i.value === 'number');

/** The visual kinds a slide can be shown as, the first being what it is now. Only conversions that lose nothing are offered. */
export function variantsOf(v: Visual): VisualKind[] {
  switch (v.kind) {
    case 'bars':
      return v.items.length <= 4 ? ['bars', 'stats', 'table'] : ['bars', 'table'];
    case 'stats':
      return hasNumbers(v) ? ['stats', 'bars', 'table'] : ['stats', 'table'];
    case 'matrix':
    case 'cards':
    case 'timeline':
      return [v.kind, 'table'];
    case 'trust-chain':
      return ['trust-chain', 'flow'];
    default:
      return [v.kind];
  }
}

export function asVariant(v: Visual, kind: VisualKind): Visual {
  if (kind === v.kind) return v;
  if (!variantsOf(v).includes(kind)) return v;
  if ((v.kind === 'bars' || v.kind === 'stats') && kind === 'table') return { kind: 'table', ...itemsToTable(v.items), widths: [6, 3, 3], tone: 2, foot: v.foot };
  if (v.kind === 'bars' && kind === 'stats') return { kind: 'stats', items: v.items, foot: v.foot };
  if (v.kind === 'stats' && kind === 'bars') return { kind: 'bars', title: 'Values', items: v.items, unit: 'count', foot: v.foot };
  if (v.kind === 'matrix' && kind === 'table') return { kind: 'table', head: ['', ...v.cols], rows: v.rows.map((r) => [r.label, ...r.cells.map((c) => c.text)]), foot: v.foot };
  if (v.kind === 'cards' && kind === 'table') return { kind: 'table', head: ['Item', 'Detail', 'Verdict'], rows: v.items.map((i) => [i.title, i.line, i.verdict]), widths: [4, 5, 3] };
  if (v.kind === 'timeline' && kind === 'table') return { kind: 'table', head: ['When', 'Step', 'Detail'], rows: v.steps.map((s) => [s.t, s.label, s.sub ?? '']), foot: v.foot };
  if (v.kind === 'trust-chain' && kind === 'flow') return { kind: 'flow', stages: v.steps.map((s) => ({ label: s.label, sub: s.sub })) };
  return v;
}

/** The slide as it will be built: the generated slide with a person's title, visual and spoken-script choices applied. */
export function effective(s: Slide, st?: SlideState): Slide {
  if (!st) return s;
  return {
    ...s,
    title: st.titleOverride?.trim() || s.title,
    visual: st.visualKind ? asVariant(s.visual, st.visualKind) : s.visual,
    notes: st.notesOverride?.trim() ? { ...s.notes, say: st.notesOverride.trim() } : s.notes,
  };
}

/**
 * The generated slides in the order a person chose. Slides the order does not name keep their generated place after the named ones, names that
 * are not slides are ignored, and the first slide always stays first, so a stored order can never drop, duplicate or lose a slide.
 */
export function inOrder<T extends { id: string }>(slides: T[], order: string[] | undefined): T[] {
  if (!order?.length || slides.length < 2) return slides;
  const rank = new Map<string, number>();
  for (const id of order) if (!rank.has(id)) rank.set(id, rank.size);
  const [first, ...rest] = slides;
  const named = rest.filter((s) => rank.has(s.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [first!, ...named, ...rest.filter((s) => !rank.has(s.id))];
}

export interface DecisionChange {
  id: string;
  was: string;
  now: string;
}

/** The decisions a slide leans on whose status differs from the one it was approved or rejected against. Empty when nothing is recorded to compare. */
export function changedDecisions(st: SlideState | undefined, now: Record<string, string>): DecisionChange[] {
  const was = st?.decidedDecisions;
  if (!was) return [];
  return Object.keys({ ...was, ...now }).sort().filter((id) => (was[id] ?? 'not recorded') !== (now[id] ?? 'not in register')).map((id) => ({ id, was: was[id] ?? 'not recorded', now: now[id] ?? 'not in register' }));
}

const canon = (o: unknown): string =>
  JSON.stringify(o, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val));

/**
 * Hash of everything an audience or a reviewer sees on, or hears about, a slide, including the status the register gives each decision the
 * slide leans on. A change to any of it invalidates an earlier approval; its position in the deck is not part of it.
 */
export function contentHash(s: Slide, sourceHashes: Record<string, string>, decisionStatus: Record<string, string>): string {
  const srcs = [...new Set([...s.sources.map((x) => x.path), ...s.claims.flatMap((c) => c.sources)])].sort().map((p) => [p, sourceHashes[p] ?? 'missing']);
  const decisions = s.decisions.map((id) => [id, decisionStatus[id] ?? 'not in register']);
  const body = { id: s.id, title: s.title, message: s.message, visual: s.visual, notes: s.notes, decisions, placeholders: s.placeholders, srcs };
  return crypto.createHash('sha256').update(canon(body)).digest('hex');
}
