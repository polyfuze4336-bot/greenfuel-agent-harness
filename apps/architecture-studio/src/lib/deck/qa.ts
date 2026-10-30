// Automated visual and content quality checks. Two kinds, kept apart in the report:
//   - static checks, from the layout ledger and the slide data (they run anywhere, with estimated text sizes);
//   - rendered checks, from PowerPoint's own measurement of the saved file (the authority on overflow).
// A check reports a finding; it never repairs the slide. Severity "error" blocks a final export.
import type { LedgerItem } from './draw.ts';
import { COLOR, GRID, MIN_FONT, SLIDE } from './theme.ts';
import type { ClaimCheck, Slide, Visual } from './types.ts';

export interface Finding {
  slide: string;
  severity: 'error' | 'warn' | 'info';
  rule: string;
  message: string;
}

export interface RenderedShape {
  name: string;
  type: number;
  left: number;
  top: number;
  width: number;
  height: number;
  hasText: boolean;
  textHeight: number;
  textWidth: number;
  fontSize: number;
  marginTop: number;
  marginBottom: number;
  hasTable?: boolean;
}

export interface RenderedLayout {
  slideWidth: number;
  slideHeight: number;
  powerpointVersion: string;
  slides: { index: number; shapes: RenderedShape[]; notesLength: number }[];
}

export interface QaLimits {
  /** Words visible on a slide above which it is reported as dense. */
  warnWords: number;
  errorWords: number;
  minNotesWords: number;
  minNotesWordsAppendix: number;
}

export const DEFAULT_LIMITS: QaLimits = { warnWords: 150, errorWords: 200, minNotesWords: 35, minNotesWordsAppendix: 20 };

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

function visualStrings(v: Visual): string[] {
  switch (v.kind) {
    case 'hero': return [v.sub, v.meta ?? ''];
    case 'flow': return [...v.stages.flatMap((s) => [s.label, s.sub ?? '']), ...(v.breaks ?? [])];
    case 'stats': return [...v.items.flatMap((i) => [i.text ?? '', i.label]), v.foot ?? ''];
    case 'bars': return [v.title, ...v.items.map((i) => `${i.label} ${i.text ?? ''}`), v.foot ?? ''];
    case 'cards': return v.items.flatMap((i) => [i.title, i.line, i.verdict]);
    case 'table': return [...v.head, ...v.rows.flat(), v.foot ?? ''];
    case 'matrix': return [...v.cols, ...v.rows.map((r) => r.label), v.foot ?? ''];
    case 'timeline': return [...v.steps.flatMap((s) => [s.t, s.label, s.sub ?? '']), v.foot ?? ''];
    case 'edge-flow': return [v.foot ?? ''];
    case 'trust-chain': return [...v.steps.flatMap((s) => [s.label, s.sub]), v.foot ?? ''];
    case 'autonomy': return [...v.agents.flatMap((a) => [a.name, a.why]), ...v.levels.map((l) => l.meaning), v.foot ?? ''];
    case 'review': return [v.need, ...(v.have ?? [])];
    default: return [(v as { foot?: string }).foot ?? ''];
  }
}

/** The words a person would read on the slide. Notes and footers are not counted: they are not on the screen as body text. */
export const visibleWords = (s: Slide) => words(`${s.title} ${s.message} ${visualStrings(s.visual).join(' ')}`);

const overlap = (a: LedgerItem, b: LedgerItem) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

const luminance = (hex: string) => {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

/** Foreground and background pairs the design actually uses for text. Each must meet WCAG AA for its size. */
export const TEXT_PAIRS: { fg: keyof typeof COLOR; bg: keyof typeof COLOR; min: number; use: string }[] = [
  { fg: 'ink', bg: 'sand', min: 4.5, use: 'titles and body on the page' },
  { fg: 'ink2', bg: 'sand', min: 4.5, use: 'supporting text on the page' },
  { fg: 'ink3', bg: 'sand', min: 4.5, use: 'footers and kickers on the page' },
  { fg: 'teal', bg: 'sand', min: 4.5, use: 'section labels' },
  { fg: 'amber', bg: 'sand', min: 4.5, use: 'review text on the page' },
  { fg: 'amber', bg: 'amberBg', min: 4.5, use: 'review placeholder panel' },
  { fg: 'green', bg: 'greenBg', min: 4.5, use: 'verdict: meets' },
  { fg: 'red', bg: 'redBg', min: 4.5, use: 'verdict: does not meet' },
  { fg: 'grey', bg: 'greyBg', min: 4.5, use: 'verdict: unknown' },
  { fg: 'paper', bg: 'navy', min: 4.5, use: 'title slide text' },
  { fg: 'seafoam', bg: 'navy', min: 4.5, use: 'title slide message' },
  { fg: 'ink', bg: 'paper', min: 4.5, use: 'cards' },
  { fg: 'ink2', bg: 'paper', min: 4.5, use: 'card text' },
  { fg: 'ocean', bg: 'paper', min: 4.5, use: 'large figures' },
  { fg: 'paper', bg: 'deep', min: 4.5, use: 'deterministic-services band' },
];

/** Replaces estimated sizes with what PowerPoint measured, so overlap checks use the real table heights. */
export function refineLedger(ledger: LedgerItem[], slideIds: string[], layout: RenderedLayout): LedgerItem[] {
  const byName = new Map<string, RenderedShape>();
  layout.slides.forEach((ls, i) => {
    for (const sh of ls.shapes) byName.set(`${slideIds[i]}|${sh.name}`, sh);
  });
  return ledger.map((l) => {
    const m = byName.get(`${l.slide}|${l.name}`);
    if (!m) return l;
    if (l.kind === 'table') return { ...l, h: m.height / 72, needs: m.height / 72 };
    if (l.kind === 'text' && m.hasText) return { ...l, needs: (m.textHeight + m.marginTop + m.marginBottom) / 72 };
    return l;
  });
}

export function staticChecks(slides: Slide[], ledger: LedgerItem[], claimChecks: ClaimCheck[], limits: QaLimits = DEFAULT_LIMITS): Finding[] {
  const out: Finding[] = [];
  const f = (slide: string, severity: Finding['severity'], rule: string, message: string) => out.push({ slide, severity, rule, message });
  const ids = new Set<string>();
  const titles = new Set<string>();
  const left = GRID.mx - 0.02;
  const right = GRID.mx + GRID.cw + 0.02;

  for (const s of slides) {
    if (ids.has(s.id)) f(s.id, 'error', 'unique-id', 'Slide id is used twice.');
    ids.add(s.id);
    if (titles.has(s.title)) f(s.id, 'warn', 'unique-title', 'Another slide has the same title.');
    titles.add(s.title);

    // Appendix slides are reference material read at leisure, so they may carry more; the executive and technical story may not.
    const scale = s.tier === 'appendix' ? 1.5 : 1;
    const w = visibleWords(s);
    if (w > limits.errorWords * scale) f(s.id, 'error', 'density', `${w} words on screen; the limit is ${Math.round(limits.errorWords * scale)}. Split the slide.`);
    else if (w > limits.warnWords * scale) f(s.id, 'warn', 'density', `${w} words on screen; over ${Math.round(limits.warnWords * scale)} is dense for one idea.`);

    if (words(s.notes.say) < (s.tier === 'appendix' ? limits.minNotesWordsAppendix : limits.minNotesWords)) f(s.id, 'error', 'notes', `Speaker notes have ${words(s.notes.say)} words; at least ${s.tier === 'appendix' ? limits.minNotesWordsAppendix : limits.minNotesWords} are needed.`);
    if (s.sources.length === 0) f(s.id, 'error', 'sources', 'The slide cites no source.');
    if (s.claims.length === 0 && s.visual.kind !== 'hero') f(s.id, 'warn', 'claims', 'The slide makes no checkable claim.');
    if (s.placeholders.length) f(s.id, 'info', 'placeholder', `${s.placeholders.length} review placeholder(s): ${s.placeholders.map((p) => p.id).join(', ')}.`);

    // Every figure that is charted or shown large must say what kind of evidence it is.
    if (s.visual.kind === 'bars' || s.visual.kind === 'stats') for (const i of s.visual.items) if (!i.chip) f(s.id, 'error', 'evidence-class', `"${i.label}" is shown without an evidence class.`);

    const mine = ledger.filter((l) => l.slide === s.id);
    const hero = s.visual.kind === 'hero';
    for (const l of mine) {
      if (!hero && (l.x < left || l.x + l.w > right) && l.kind !== 'chart') f(s.id, 'error', 'margin', `${l.role} (${l.name}) leaves the page margins.`);
      if (l.y + l.h > SLIDE.h + 0.01 || l.x + l.w > SLIDE.w + 0.01 || l.x < -0.01 || l.y < -0.01) f(s.id, 'error', 'bounds', `${l.role} (${l.name}) is outside the slide.`);
      if (l.kind === 'text' && l.fontSize !== undefined) {
        const min = l.role === 'sources' ? MIN_FONT.footer : l.role === 'chip' ? 10 : MIN_FONT.body;
        if (l.fontSize < min) f(s.id, 'error', 'min-font', `${l.role} is ${l.fontSize}pt; the minimum is ${min}pt.`);
        if (l.needs !== undefined && l.needs > l.h * 1.08 + 0.02) f(s.id, 'warn', 'overflow-estimate', `${l.role} may need ${l.needs.toFixed(2)}in but has ${l.h.toFixed(2)}in (estimate).`);
      }
      if (l.kind === 'image' && l.w * l.h > SLIDE.w * SLIDE.h * 0.6) f(s.id, 'error', 'flattened', 'A picture covers most of the slide. Slides must be built from editable elements.');
    }
    const content = mine.filter((l) => (l.kind === 'text' || l.kind === 'table' || l.kind === 'chart') && !l.backing);
    for (let i = 0; i < content.length; i++)
      for (let j = i + 1; j < content.length; j++) {
        const a = content[i]!;
        const b = content[j]!;
        if (a.role === 'chip' || b.role === 'chip') continue;
        const o = overlap(a, b);
        if (o > 0.03) f(s.id, 'error', 'overlap', `${a.role} overlaps ${b.role} by ${o.toFixed(2)} sq in.`);
      }
    if (mine.filter((l) => l.kind === 'image').length > 1) f(s.id, 'warn', 'images', 'More than one picture on a slide.');
  }
  for (const k of claimChecks) if (!k.ok) f(k.slideId, 'error', 'claim', `${k.claimId}: ${k.problems.join(' ')}`);
  return out;
}

export function renderedChecks(slides: Slide[], layout: RenderedLayout | null, pngSizes: number[]): Finding[] {
  const out: Finding[] = [];
  const f = (slide: string, severity: Finding['severity'], rule: string, message: string) => out.push({ slide, severity, rule, message });
  if (!layout) {
    f('deck', 'warn', 'not-rendered', 'The deck was not rendered, so overflow was only estimated.');
    return out;
  }
  if (layout.slides.length !== slides.length) f('deck', 'error', 'slide-count', `The file has ${layout.slides.length} slides; expected ${slides.length}.`);
  slides.forEach((s, i) => {
    const ls = layout.slides[i];
    if (!ls) return;
    const sizeKb = (pngSizes[i] ?? 0) / 1024;
    if (sizeKb < 12) f(s.id, 'error', 'blank-render', `The rendered image is ${sizeKb.toFixed(1)} KB; the slide may be blank.`);
    if (ls.notesLength < 20) f(s.id, 'error', 'notes-in-file', 'The saved file has no speaker notes for this slide.');
    for (const sh of ls.shapes) {
      if (sh.hasText) {
        const need = sh.textHeight + sh.marginTop + sh.marginBottom;
        if (need > sh.height + 2) f(s.id, 'error', 'overflow', `Text in ${sh.name} needs ${(need / 72).toFixed(2)}in; the box is ${(sh.height / 72).toFixed(2)}in (measured by PowerPoint).`);
        if (sh.textWidth > sh.width + 6) f(s.id, 'error', 'overflow-width', `Text in ${sh.name} is wider than its box (measured by PowerPoint).`);
      }
      if (sh.left < -1 || sh.top < -1 || sh.left + sh.width > layout.slideWidth + 1 || sh.top + sh.height > layout.slideHeight + 1) f(s.id, 'error', 'off-slide', `${sh.name} extends beyond the slide.`);
      // A table grows to fit its text, so its measured bottom must still clear the footer band.
      if (/:(table|matrix):/.test(sh.name) && sh.top + sh.height > (GRID.bodyB + 0.06) * 72) f(s.id, 'error', 'table-overflow', `The table ends at ${((sh.top + sh.height) / 72).toFixed(2)}in; the body zone ends at ${GRID.bodyB}in.`);
    }
  });
  return out;
}

/** Every Section B criterion must be served by at least one slide, or be named as live-only. */
export function rubricChecks(slides: Slide[], criteria: string[]): Finding[] {
  const out: Finding[] = [];
  for (const c of criteria) if (!slides.some((s) => s.rubric.includes(c))) out.push({ slide: 'deck', severity: 'info', rule: 'rubric', message: `No slide serves ${c}; it is assessed live and cannot be evidenced by the deck.` });
  return out;
}

export function summarize(findings: Finding[]) {
  return { errors: findings.filter((x) => x.severity === 'error').length, warnings: findings.filter((x) => x.severity === 'warn').length, info: findings.filter((x) => x.severity === 'info').length };
}
