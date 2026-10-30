// Assembles the PowerPoint file from slide data. Every slide gets the same frame: a section label, one title, one supporting line, a body
// drawn by its visual, a band for review placeholders and decision status, and a footer that names its sources. Speaker notes carry the
// script, the evidence, the honest limit and the timing.
import path from 'node:path';
import PptxGenJS from 'pptxgenjs';
import type { Assets } from './assets.ts';
import type { DeckContext } from './context.ts';
import { Canvas, drawVessel, type LedgerItem } from './draw.ts';
import { COLOR, FONT, GRID, SLIDE, TONE, estimate } from './theme.ts';
import type { Slide } from './types.ts';
import * as V from './visuals.ts';

export const GENERATOR = { name: 'greenfuel-architecture-studio/presentation', version: 1 } as const;

export interface BuildInput {
  ctx: DeckContext;
  slides: Slide[];
  mode: 'sample' | 'final';
  assets: Assets;
  title: string;
  generatedAt: string;
}

export interface BuildResult {
  buffer: Buffer;
  ledger: LedgerItem[];
}

const SAMPLE_TAG = 'SAMPLE · NOT APPROVED FOR PRESENTATION';

const statusTone = (status: string) => (/^approved/i.test(status) ? TONE.good : /^(blocked|rejected)/i.test(status) ? TONE.bad : /^(proposed|pending|deferred)/i.test(status) ? TONE.warn : TONE.neutral);

function notesText(s: Slide, ctxCommit: string): string {
  const lines = [s.notes.say.trim()];
  if (s.notes.next) lines.push(`\nNEXT: ${s.notes.next}`);
  if (s.notes.ifAsked?.length) lines.push(`IF ASKED: ${s.notes.ifAsked.join(', ')} (docs/capstone/presentation/QA-PANEL-50.md)`);
  if (s.notes.honesty) lines.push(`\nSAY PLAINLY: ${s.notes.honesty}`);
  if (s.placeholders.length) lines.push(`\nREVIEW PLACEHOLDERS: ${s.placeholders.map((p) => `${p.id} ${p.what} (needed from ${p.neededFrom})`).join('; ')}`);
  lines.push(`\nTIME: about ${s.seconds} seconds.   RUBRIC: ${s.rubric.join(', ') || 'none'}.`);
  lines.push(`SOURCES: ${[...new Set(s.sources.map((x) => `${x.path}${x.chip ? ` [${x.chip}]` : ''}`))].join('; ')}`);
  lines.push(`GENERATED FROM COMMIT ${ctxCommit.slice(0, 12)}.`);
  return lines.join('\n');
}

function header(cv: Canvas, s: Slide) {
  cv.text('kicker', s.section.toUpperCase(), GRID.mx, GRID.kickerY, 8, 0.24, { fontSize: 11, bold: true, color: COLOR.teal, charSpacing: 1.2 });
  let fs = 28;
  while (fs > 22 && estimate(s.title, fs, GRID.cw, { bold: true, lineSpacing: 1.12 }).lines > 2) fs -= 2;
  const lines = estimate(s.title, fs, GRID.cw, { bold: true, lineSpacing: 1.12 }).lines;
  const th = lines * fs * 0.95 * 1.22 / 72 + 0.05;
  cv.text('title', s.title, GRID.mx, GRID.titleY, GRID.cw, th, { fontSize: fs, bold: true, color: COLOR.ink, lineSpacingMultiple: 0.95 });
  // The supporting line sits directly under the title, so a one-line title does not leave a hole above it.
  const my = GRID.titleY + th + 0.12;
  cv.text('message', s.message, GRID.mx, my, GRID.cw, Math.min(GRID.messageH, GRID.bodyY - my - 0.08), { fontSize: 15, color: COLOR.ink2 });
}

function band(cv: Canvas, s: Slide, ctx: DeckContext) {
  const chips = s.decisions.slice(0, 4).map((id) => {
    const d = ctx.decisions.find((x) => x.id === id);
    return { id, label: `${id}  ${d?.status ?? 'not in register'}`, tone: statusTone(d?.status ?? '') };
  });
  let right = GRID.mx + GRID.cw;
  for (const c of [...chips].reverse()) {
    const w = cv.chipWidth(c.label, 10.5);
    right -= w;
    cv.chip(c.label, right, GRID.bandY + 0.04, c.tone, { fontSize: 10.5, h: 0.3, w });
    right -= 0.1;
  }
  if (s.placeholders.length) {
    const max = Math.max(3, right - GRID.mx - 0.2);
    cv.chip('REVIEW', GRID.mx, GRID.bandY + 0.04, { fg: COLOR.paper, bg: COLOR.amber }, { fontSize: 10.5, h: 0.3, w: 0.8 });
    const more = s.placeholders.length > 1 ? `  (+${s.placeholders.length - 1} more)` : '';
    cv.text('placeholder-text', `Evidence missing: ${s.placeholders[0]!.what}${more}`, GRID.mx + 0.95, GRID.bandY + 0.04, max - 0.95, 0.3, { fontSize: 11.5, color: COLOR.amber, valign: 'middle' });
  }
}

function footer(cv: Canvas, s: Slide) {
  const names = [...new Set(s.sources.map((x) => path.posix.basename(x.path)))];
  const shown = names.slice(0, 4).join('   ·   ') + (names.length > 4 ? `   ·   +${names.length - 4} more` : '');
  cv.text('sources', `Sources   ${shown}`, GRID.mx, GRID.footY + 0.06, 10.6, 0.38, { fontSize: 9, color: COLOR.ink3 });
}

function hero(cv: Canvas, s: Slide, v: Extract<Slide['visual'], { kind: 'hero' }>, assets: Assets) {
  const artX = 7.5;
  const artW = SLIDE.w - artX;
  const photo = v.image ? assets.resolve(v.image, 'photo') : null;
  if (photo) cv.image('hero-photo', photo.absPath, artX, 0, artW, SLIDE.h, photo.entry.title, 'cover');
  else drawVessel(cv, artX, 0, artW, SLIDE.h);
  cv.text('kicker', s.section.toUpperCase(), 0.8, 0.9, 6.4, 0.26, { fontSize: 11.5, bold: true, color: COLOR.seafoam, charSpacing: 1.5 });
  const tl = estimate(s.title, 40, 6.4, { bold: true, lineSpacing: 1.12 }).lines;
  const th = (tl * 40 * 0.95 * 1.22) / 72 + 0.08;
  cv.text('title', s.title, 0.8, 1.45, 6.4, th, { fontSize: 40, bold: true, color: COLOR.paper, lineSpacingMultiple: 0.95 });
  const my = 1.45 + th + 0.35;
  cv.text('message', s.message, 0.8, my, 6.3, 1.15, { fontSize: 18, color: COLOR.seafoam });
  cv.rect('hero-rule', 0.8, 5.3, 0.9, 0.04, { fill: COLOR.teal });
  cv.text('hero-sub', v.sub, 0.8, 5.5, 6.3, 0.35, { fontSize: 15, bold: true, color: COLOR.paper });
  if (v.meta) cv.text('hero-meta', v.meta, 0.8, 5.95, 6.3, 0.7, { fontSize: 12, color: 'AFC3D1' });
}

function body(cv: Canvas, s: Slide) {
  const v = s.visual;
  switch (v.kind) {
    case 'flow': return V.flow(cv, v);
    case 'stats': return V.stats(cv, v);
    case 'bars': return V.bars(cv, v);
    case 'cards': return V.cards(cv, v);
    case 'table': return V.table(cv, v);
    case 'matrix': return V.matrix(cv, v);
    case 'timeline': return V.timeline(cv, v);
    case 'cells': return V.cells(cv, v);
    case 'edge-flow': return V.edgeFlow(cv, v);
    case 'trust-chain': return V.trustChain(cv, v);
    case 'autonomy': return V.autonomy(cv, v);
    case 'topology': return V.topology(cv, v);
    case 'review': return V.review(cv, v);
    case 'hero': return;
  }
}

export async function buildPptx(inp: BuildInput): Promise<BuildResult> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = inp.title;
  pptx.subject = `Generated from commit ${inp.ctx.commit}`;
  pptx.author = 'Architecture Decision Studio (software draft; a person owns and presents it)';
  pptx.company = '';
  pptx.revision = '1';
  pptx.theme = { headFontFace: FONT.semi, bodyFontFace: FONT.sans };

  const sample = inp.mode === 'sample';
  const marker = sample ? [{ text: { text: SAMPLE_TAG, options: { x: 8.2, y: 0.38, w: 4.43, h: 0.24, fontFace: FONT.semi, fontSize: 9, color: COLOR.amber, align: 'right', charSpacing: 1 } } }] : [];
  pptx.defineSlideMaster({
    title: 'CONTENT',
    background: { color: COLOR.sand },
    objects: [{ line: { x: GRID.mx, y: 6.93, w: GRID.cw, h: 0, line: { color: COLOR.line, width: 0.75 } } }, ...marker],
    slideNumber: { x: 12.0, y: 7.04, w: 0.63, h: 0.26, fontFace: FONT.sans, fontSize: 9, color: COLOR.ink3, align: 'right' },
  } as never);
  pptx.defineSlideMaster({ title: 'HERO', background: { color: COLOR.navy }, objects: sample ? [{ text: { text: SAMPLE_TAG, options: { x: 0.8, y: 7.0, w: 6.4, h: 0.26, fontFace: FONT.semi, fontSize: 9, color: 'E3B65B', charSpacing: 1 } } }] : [] } as never);

  const ledger: LedgerItem[] = [];
  for (const s of inp.slides) {
    const isHero = s.visual.kind === 'hero';
    const slide = pptx.addSlide({ masterName: isHero ? 'HERO' : 'CONTENT' });
    const cv = new Canvas(pptx, slide, s.id, ledger, inp.assets);
    if (s.visual.kind === 'hero') hero(cv, s, s.visual, inp.assets);
    else {
      header(cv, s);
      body(cv, s);
      band(cv, s, inp.ctx);
      footer(cv, s);
    }
    slide.addNotes(notesText(s, inp.ctx.commit));
  }
  const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  return { buffer: out, ledger };
}
