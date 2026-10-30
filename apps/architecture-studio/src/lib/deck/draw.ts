// Drawing primitives. Every object placed on a slide is named and recorded in a ledger (its box, its text, its size), so quality checks can
// reason about the layout, and so the preview and the file can be compared. Everything drawn here is a native, editable PowerPoint object:
// text boxes, shapes, tables and charts. Nothing is flattened into a picture, except an approved photograph from the asset manifest.
import type PptxGenJS from 'pptxgenjs';
import { COLOR, CHIP, FONT, TONE, estimate, type Tone } from './theme.ts';
import type { Assets } from './assets.ts';

export type Slide = ReturnType<PptxGenJS['addSlide']>;

export interface LedgerItem {
  slide: string;
  name: string;
  kind: 'text' | 'shape' | 'chart' | 'table' | 'image';
  role: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize?: number;
  bold?: boolean;
  text?: string;
  /** For text: the height the text is estimated to need. PowerPoint's own measurement replaces it after rendering. */
  needs?: number;
  /** A decorative backing object (a card behind text) is allowed to be overlapped by the text it carries. */
  backing?: boolean;
}

export interface TextOpts {
  fontSize?: number;
  bold?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  font?: string;
  charSpacing?: number;
  lineSpacingMultiple?: number;
  italic?: boolean;
}

export type Run = { text: string; options?: Record<string, unknown> };

export class Canvas {
  private n = 0;
  readonly pptx: PptxGenJS;
  readonly s: Slide;
  readonly id: string;
  readonly ledger: LedgerItem[];
  readonly assets: Assets;
  constructor(pptx: PptxGenJS, s: Slide, id: string, ledger: LedgerItem[], assets: Assets) {
    this.pptx = pptx;
    this.s = s;
    this.id = id;
    this.ledger = ledger;
    this.assets = assets;
  }

  private name(role: string) {
    return `${this.id}:${role}:${++this.n}`;
  }

  text(role: string, text: string | Run[], x: number, y: number, w: number, h: number, o: TextOpts = {}) {
    const fs = o.fontSize ?? 14;
    const name = this.name(role);
    const plain = typeof text === 'string' ? text : text.map((r) => r.text).join('');
    this.s.addText(text as never, {
      x, y, w, h,
      fontFace: o.font ?? (o.bold ? FONT.semi : FONT.sans),
      fontSize: fs,
      bold: false,
      color: o.color ?? COLOR.ink,
      align: o.align ?? 'left',
      valign: o.valign ?? 'top',
      margin: 0,
      wrap: true,
      fit: 'none',
      charSpacing: o.charSpacing,
      lineSpacingMultiple: o.lineSpacingMultiple ?? 1.0,
      italic: o.italic,
      objectName: name,
    } as never);
    this.ledger.push({ slide: this.id, name, kind: 'text', role, x, y, w, h, fontSize: fs, bold: !!o.bold, text: plain, needs: estimate(plain, fs, w, { bold: o.bold }).heightIn });
    return name;
  }

  rect(role: string, x: number, y: number, w: number, h: number, o: { fill?: string; line?: string; lineW?: number; dash?: boolean; radius?: number; transparency?: number; backing?: boolean } = {}) {
    const name = this.name(role);
    this.s.addShape((o.radius ? 'roundRect' : 'rect') as never, {
      x, y, w, h,
      fill: o.fill ? { color: o.fill, transparency: o.transparency ?? 0 } : { type: 'none' },
      line: o.line ? { color: o.line, width: o.lineW ?? 0.75, dashType: o.dash ? 'dash' : 'solid' } : { type: 'none' },
      rectRadius: o.radius,
      objectName: name,
    } as never);
    this.ledger.push({ slide: this.id, name, kind: 'shape', role, x, y, w, h, backing: o.backing ?? true });
    return name;
  }

  ellipse(role: string, x: number, y: number, w: number, h: number, fill: string, transparency = 0) {
    const name = this.name(role);
    this.s.addShape('ellipse' as never, { x, y, w, h, fill: { color: fill, transparency }, line: { type: 'none' }, objectName: name } as never);
    this.ledger.push({ slide: this.id, name, kind: 'shape', role, x, y, w, h, backing: true });
  }

  /** A straight line, optionally with an arrowhead at the end. */
  line(role: string, x1: number, y1: number, x2: number, y2: number, o: { color?: string; w?: number; arrow?: boolean; dash?: boolean } = {}) {
    const name = this.name(role);
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    this.s.addShape('line' as never, {
      x, y, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
      flipH: x2 < x1, flipV: y2 < y1,
      line: { color: o.color ?? COLOR.line, width: o.w ?? 1, dashType: o.dash ? 'dash' : 'solid', endArrowType: o.arrow ? 'triangle' : undefined },
      objectName: name,
    } as never);
    this.ledger.push({ slide: this.id, name, kind: 'shape', role, x, y, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), backing: true });
  }

  poly(role: string, x: number, y: number, w: number, h: number, pts: [number, number][], fill: string, transparency = 0) {
    const name = this.name(role);
    const points = pts.map(([px, py], i) => (i === 0 ? { x: px, y: py, moveTo: true } : { x: px, y: py })).concat([{ close: true } as never]);
    this.s.addShape('custGeom' as never, { x, y, w, h, fill: { color: fill, transparency }, line: { type: 'none' }, points, objectName: name } as never);
    this.ledger.push({ slide: this.id, name, kind: 'shape', role, x, y, w, h, backing: true });
  }

  /** A small rounded label for an evidence class or status. Text is part of the shape so it stays editable as one object. */
  chip(label: string, x: number, y: number, tone?: { fg: string; bg: string }, o: { fontSize?: number; h?: number; w?: number } = {}) {
    const t = tone ?? CHIP[label] ?? TONE.neutral;
    const fs = o.fontSize ?? 10;
    const w = o.w ?? Math.max(0.5, (label.length * fs * 0.6) / 72 + 0.22);
    const h = o.h ?? 0.26;
    const name = this.name('chip');
    this.s.addText(label, {
      x, y, w, h, shape: 'roundRect', rectRadius: 0.08, fill: { color: t.bg }, line: { type: 'none' },
      fontFace: FONT.semi, fontSize: fs, color: t.fg, align: 'center', valign: 'middle', margin: 0, charSpacing: 0.4, objectName: name, fit: 'none', wrap: false,
    } as never);
    this.ledger.push({ slide: this.id, name, kind: 'text', role: 'chip', x, y, w, h, fontSize: fs, bold: true, text: label, needs: (fs * 1.2) / 72 });
    return w;
  }

  tone(t: Tone) {
    return TONE[t];
  }

  chipWidth(label: string, fontSize = 10) {
    return Math.max(0.5, (label.length * fontSize * 0.6) / 72 + 0.22);
  }

  /** An approved, hash-verified picture. The only kind of image the deck contains. */
  image(role: string, file: string, x: number, y: number, w: number, h: number, alt: string, sizing?: 'cover') {
    const name = this.name(role);
    this.s.addImage({ path: file, x, y, w, h, altText: alt, objectName: name, ...(sizing ? { sizing: { type: 'cover', w, h } } : {}) } as never);
    this.ledger.push({ slide: this.id, name, kind: 'image', role, x, y, w, h });
  }
}

/** The original vessel artwork: layered sea and sky, a tanker built from native shapes. Deterministic, editable, and free of any licence. */
export function drawVessel(cv: Canvas, x: number, y: number, w: number, h: number) {
  const px = (fx: number) => x + fx * w;
  const py = (fy: number) => y + fy * h;
  // sky
  cv.rect('art-sky', x, y, w, h * 0.62, { fill: '123B5C', backing: true });
  cv.rect('art-sky2', x, y + h * 0.38, w, h * 0.24, { fill: '1B5E85', transparency: 0.35 });
  cv.ellipse('art-sun', px(0.66), py(0.16), w * 0.2, w * 0.2, '9ED8D2', 0.55);
  cv.ellipse('art-sun-core', px(0.705), py(0.16) + w * 0.045, w * 0.11, w * 0.11, 'D9F1EE', 0.2);
  // sea
  cv.rect('art-sea', x, y + h * 0.62, w, h * 0.38, { fill: '0B2A44' });
  cv.rect('art-sea-b1', x, y + h * 0.7, w, h * 0.1, { fill: '134A6E', transparency: 0.4 });
  cv.rect('art-sea-b2', x, y + h * 0.82, w, h * 0.08, { fill: '1F7A8C', transparency: 0.55 });
  cv.rect('art-sea-b3', x, y + h * 0.92, w, h * 0.08, { fill: '2FA4A0', transparency: 0.7 });
  // hull: a custom polygon, bow to the right
  const hx = px(0.08);
  const hw = w * 0.82;
  const hy = py(0.5);
  const hh = h * 0.18;
  cv.poly('art-hull', hx, hy, hw, hh, [[0, 0], [hw, 0], [hw * 0.93, hh], [hw * 0.04, hh]], '0A1F33');
  cv.rect('art-hull-stripe', hx + hw * 0.012, hy + hh * 0.18, hw * 0.968, hh * 0.1, { fill: '2FA4A0' });
  cv.rect('art-deck', hx, hy - h * 0.025, hw, h * 0.025, { fill: '24425C' });
  // cargo tank domes
  for (let i = 0; i < 5; i++) cv.ellipse(`art-dome-${i}`, hx + hw * (0.34 + i * 0.1), hy - h * 0.055, hw * 0.06, h * 0.05, 'C9D6E0', 0.15);
  // accommodation block and bridge aft
  cv.rect('art-acc', hx + hw * 0.07, hy - h * 0.15, hw * 0.13, h * 0.125, { fill: 'E8EEF2' });
  cv.rect('art-bridge', hx + hw * 0.085, hy - h * 0.205, hw * 0.1, h * 0.055, { fill: 'C9D6E0' });
  cv.rect('art-funnel', hx + hw * 0.025, hy - h * 0.135, hw * 0.035, h * 0.11, { fill: '2FA4A0' });
  // reflection
  cv.rect('art-reflection', hx + hw * 0.05, hy + hh + h * 0.02, hw * 0.88, h * 0.03, { fill: '2FA4A0', transparency: 0.75 });
}

export const wrapLen = (text: string, perLine: number) => Math.ceil(text.length / perLine);
