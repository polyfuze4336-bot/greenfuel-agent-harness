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

/** The slide as it will be built: the generated slide with a person's title and visual choice applied. */
export function effective(s: Slide, st?: SlideState): Slide {
  if (!st) return s;
  return { ...s, title: st.titleOverride?.trim() || s.title, visual: st.visualKind ? asVariant(s.visual, st.visualKind) : s.visual };
}

const canon = (o: unknown): string =>
  JSON.stringify(o, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val));

/** Hash of everything an audience or a reviewer sees on, or hears about, a slide. A change to any of it invalidates an earlier approval. */
export function contentHash(s: Slide, sourceHashes: Record<string, string>): string {
  const srcs = [...new Set([...s.sources.map((x) => x.path), ...s.claims.flatMap((c) => c.sources)])].sort().map((p) => [p, sourceHashes[p] ?? 'missing']);
  const body = { id: s.id, title: s.title, message: s.message, visual: s.visual, notes: s.notes, decisions: s.decisions, placeholders: s.placeholders, srcs };
  return crypto.createHash('sha256').update(canon(body)).digest('hex');
}
