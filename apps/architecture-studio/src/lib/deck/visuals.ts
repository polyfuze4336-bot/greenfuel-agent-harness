// One renderer per visual kind. Each draws only inside the body zone and returns nothing; layout is arithmetic on the grid, so the same
// data always produces the same slide. Diagrams are drawn from data and fixed geometry, never generated freehand.
import type { Canvas } from './draw.ts';
import { COLOR, FONT, GRID, TONE, estimate, type Tone } from './theme.ts';
import type { Chip, Item, Verdict, Visual } from './types.ts';
import { CHIP } from './theme.ts';

const X = GRID.mx;
const W = GRID.cw;
const Y = GRID.bodyY;
const B = GRID.bodyB;

type V<K extends Visual['kind']> = Extract<Visual, { kind: K }>;

/** A one- or two-line note under a visual. Returns the height it took so the visual above can be sized to fit. */
function foot(cv: Canvas, text: string | undefined): number {
  if (!text) return 0;
  const h = Math.max(0.3, estimate(text, 12, W).heightIn + 0.04);
  cv.text('foot-note', text, X, B - h, W, h, { fontSize: 12, color: COLOR.ink2 });
  return h + 0.12;
}

const statusColor = (t: string) => {
  const s = t.toLowerCase();
  if (/^(not |none|blocked|rejected|no run|missing|forbidden)/.test(s) || s.includes('not run') || s.includes('not built')) return COLOR.red;
  if (/^(proposed|pending|deferred|conditional|provisional|candidate|undecided)/.test(s)) return COLOR.amber;
  if (/^(approved|measured|accepted|real run|met|allowed)/.test(s)) return COLOR.green;
  return COLOR.ink;
};

export const VERDICT_STYLE: Record<Verdict, { fg: string; bg: string }> = {
  meets: TONE.good,
  conditional: TONE.warn,
  'does-not-meet': TONE.bad,
  unknown: TONE.neutral,
  other: { fg: COLOR.ink3, bg: COLOR.paper },
};

// ---------------------------------------------------------------------------------------------------------------- flow
export function flow(cv: Canvas, v: V<'flow'>) {
  const n = v.stages.length;
  const gap = 0.34;
  const w = (W - (n - 1) * gap) / n;
  const hasBreaks = !!v.breaks?.length;
  const bh = hasBreaks ? 1.55 : 1.9;
  const y = Y + 0.1;
  v.stages.forEach((st, i) => {
    const x = X + i * (w + gap);
    cv.rect('stage-card', x, y, w, bh, { fill: COLOR.paper, line: COLOR.line, radius: 0.06 });
    cv.rect('stage-accent', x, y, w, 0.06, { fill: COLOR.ocean });
    cv.text('stage-no', String(i + 1), x + 0.16, y + 0.17, 0.4, 0.3, { fontSize: 12, bold: true, color: COLOR.teal });
    cv.text('stage-label', st.label, x + 0.16, y + 0.44, w - 0.32, 0.58, { fontSize: n > 5 ? 14 : 16, bold: true });
    if (st.sub) cv.text('stage-sub', st.sub, x + 0.16, y + bh - 0.48, w - 0.32, 0.4, { fontSize: 11.5, color: COLOR.ink2 });
    if (i < n - 1) cv.line('stage-arrow', x + w + 0.04, y + bh / 2, x + w + gap - 0.04, y + bh / 2, { color: COLOR.ink3, w: 1.5, arrow: true });
  });
  if (hasBreaks) {
    const by = y + bh + 0.38;
    cv.text('breaks-title', (v.breaksTitle ?? 'Where it breaks').toUpperCase(), X, by - 0.02, W, 0.26, { fontSize: 11, bold: true, color: COLOR.amber, charSpacing: 1 });
    const k = v.breaks!.length;
    const bw = (W - (k - 1) * 0.4) / k;
    v.breaks!.forEach((t, i) => {
      const x = X + i * (bw + 0.4);
      cv.rect('break-rule', x, by + 0.34, bw, 0.03, { fill: COLOR.amber });
      cv.text('break-text', t, x, by + 0.46, bw, 0.9, { fontSize: 15 });
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------- stats
export function stats(cv: Canvas, v: V<'stats'>) {
  const n = v.items.length;
  const fh = foot(cv, v.foot);
  const gap = 0.3;
  const w = (W - (n - 1) * gap) / n;
  const h = Math.min(2.7, B - Y - fh - 0.2);
  v.items.forEach((it, i) => {
    const x = X + i * (w + gap);
    const y = Y + 0.08;
    cv.rect('stat-card', x, y, w, h, { fill: COLOR.paper, line: COLOR.line, radius: 0.06 });
    const text = it.text ?? String(it.value ?? '');
    let fs = 48;
    while (fs > 26 && estimate(text, fs, w - 0.4, { bold: true }).lines > 1) fs -= 2;
    cv.text('stat-value', text, x + 0.22, y + 0.28, w - 0.44, 0.95, { fontSize: fs, bold: true, color: COLOR.ocean, valign: 'middle' });
    cv.text('stat-label', it.label, x + 0.22, y + 1.3, w - 0.44, h - 1.9, { fontSize: 14, color: COLOR.ink2 });
    if (it.chip) cv.chip(it.chip, x + 0.22, y + h - 0.42);
  });
}

// ---------------------------------------------------------------------------------------------------------------- bars (native chart)
export function bars(cv: Canvas, v: V<'bars'>) {
  const fh = foot(cv, v.foot);
  const chips = [...new Set(v.items.map((i) => i.chip).filter(Boolean))] as Chip[];
  cv.text('chart-title', v.title, X, Y, W - 1.8, 0.3, { fontSize: 14, bold: true });
  if (chips.length === 1) cv.chip(chips[0]!, X + W - cv.chipWidth(chips[0]!), Y + 0.01);
  const cy = Y + 0.4;
  const ch = Math.max(1.8, B - cy - fh - 0.05);
  const count = v.unit === 'count';
  const labels = v.items.map((i) => (count && i.text && i.text !== String(i.value) ? `${i.label}  ·  ${i.text}` : i.label));
  const name = `${cv.id}:chart:1`;
  cv.s.addChart('bar' as never, [{ name: v.title, labels, values: v.items.map((i) => i.value ?? 0) }], {
    x: X, y: cy, w: W, h: ch,
    barDir: 'bar', barGapWidthPct: 38,
    catAxisOrientation: 'maxMin',
    catAxisLabelFontFace: FONT.sans, catAxisLabelFontSize: 13, catAxisLabelColor: COLOR.ink,
    valAxisHidden: true, valGridLine: { style: 'none' }, catGridLine: { style: 'none' },
    catAxisLineShow: false,
    showValue: true, dataLabelFontFace: FONT.semi, dataLabelFontSize: 13, dataLabelColor: COLOR.ink, dataLabelPosition: 'outEnd',
    dataLabelFormatCode: v.unit === 'USD' ? '$#,##0' : '#,##0',
    chartColors: [COLOR.ocean], showLegend: false, showTitle: false,
    altText: `${v.title}: ${v.items.map((i) => `${i.label} ${i.text ?? i.value}`).join('; ')}`,
    objectName: name,
  } as never);
  cv.ledger.push({ slide: cv.id, name, kind: 'chart', role: 'chart', x: X, y: cy, w: W, h: ch });
}

// ---------------------------------------------------------------------------------------------------------------- cards
export function cards(cv: Canvas, v: V<'cards'>) {
  const n = v.items.length;
  const gap = 0.3;
  const w = (W - (n - 1) * gap) / n;
  const h = B - Y - 0.15;
  v.items.forEach((it, i) => {
    const x = X + i * (w + gap);
    const t = TONE[it.tone as Tone] ?? TONE.neutral;
    cv.rect('card', x, Y + 0.08, w, h, { fill: COLOR.paper, line: COLOR.line, radius: 0.06 });
    cv.rect('card-accent', x, Y + 0.08, 0.07, h, { fill: t.fg });
    cv.text('card-title', it.title, x + 0.28, Y + 0.3, w - 0.5, 0.9, { fontSize: 16, bold: true });
    cv.text('card-line', it.line, x + 0.28, Y + 1.25, w - 0.5, 1.1, { fontSize: 13.5, color: COLOR.ink2 });
    cv.text('card-verdict', it.verdict, x + 0.28, Y + h - 0.7, w - 0.5, 0.6, { fontSize: 13, bold: true, color: t.fg });
  });
}

// ---------------------------------------------------------------------------------------------------------------- table
const hair = { type: 'solid', pt: 0.5, color: COLOR.line };
const none = { type: 'none' };

export function table(cv: Canvas, v: V<'table'>) {
  const fh = foot(cv, v.foot);
  const avail = B - Y - fh - 0.05;
  const toneCols = Array.isArray(v.tone) ? v.tone : v.tone !== undefined ? [v.tone] : [];
  const ratios = v.widths ?? v.head.map(() => 1);
  const total = ratios.reduce((a, b) => a + b, 0);
  const colW = ratios.map((r) => (r / total) * W);
  // Choose the largest size at which every row fits the zone, by estimate; PowerPoint's own measurement is checked after rendering.
  // Choose the largest type, then the most generous padding, at which every row still fits the zone. Few rows get larger type and more
  // air; many rows shrink. Compact tables (registers) stay at the smallest readable size.
  const heightAt = (size: number, pad: number) => 0.34 + v.rows.reduce((acc, r) => acc + Math.max(...r.map((c, i) => estimate(c, size, colW[i]! - 0.2).heightIn)) + pad, 0);
  const startFs = v.compact ? 11 : v.rows.length <= 5 ? 16 : v.rows.length <= 7 ? 14.5 : 13.5;
  const padMax = v.compact ? 0.06 : v.rows.length <= 6 ? 0.3 : 0.2;
  let fs = startFs;
  let pad = padMax;
  search: for (let size = startFs; size >= 11; size -= 0.5) {
    for (const p of v.compact ? [padMax] : [padMax, 0.14, 0.08]) {
      if (heightAt(size, p) <= avail * 0.9) {
        fs = size;
        pad = p;
        break search;
      }
    }
    fs = 11;
    pad = v.compact ? padMax : 0.08;
  }
  const heightAtChosen = (size: number) => heightAt(size, pad);
  const head = v.head.map((h) => ({ text: h.toUpperCase(), options: { fontFace: FONT.semi, fontSize: 11, color: COLOR.ink3, bold: false, align: 'left', valign: 'bottom', border: [none, none, { type: 'solid', pt: 1, color: COLOR.ink }, none], charSpacing: 0.8 } }));
  const rows = v.rows.map((r) =>
    r.map((c, i) => ({
      text: c,
      options: {
        fontFace: i === 0 ? FONT.semi : FONT.sans,
        fontSize: fs,
        color: toneCols.includes(i) ? statusColor(c) : i === 0 ? COLOR.ink : COLOR.ink2,
        bold: false,
        valign: 'middle',
        border: [none, none, hair, none],
      },
    })),
  );
  const name = `${cv.id}:table:1`;
  cv.s.addTable([head, ...rows] as never, { x: X, y: Y, w: W, colW, fontFace: FONT.sans, fontSize: fs, margin: [pad / 2, 0.12, pad / 2, 0.0], autoPage: false, objectName: name } as never);
  cv.ledger.push({ slide: cv.id, name, kind: 'table', role: 'table', x: X, y: Y, w: W, h: heightAtChosen(fs), fontSize: fs, needs: heightAtChosen(fs) });
}

// ---------------------------------------------------------------------------------------------------------------- matrix
export function matrix(cv: Canvas, v: V<'matrix'>) {
  const fh = foot(cv, v.foot);
  const avail = B - Y - fh - 0.05;
  const first = Math.min(3.6, W * 0.3);
  const rest = (W - first) / v.cols.length;
  const rowH = Math.min(0.36, (avail - 0.4) / Math.max(1, v.rows.length));
  const fs = rowH < 0.31 ? 11 : 12;
  const head = [
    { text: '', options: { border: [none, none, { type: 'solid', pt: 1, color: COLOR.ink }, none] } },
    ...v.cols.map((c) => ({ text: c.toUpperCase(), options: { fontFace: FONT.semi, fontSize: 11, color: COLOR.ink3, align: 'center', valign: 'bottom', border: [none, none, { type: 'solid', pt: 1, color: COLOR.ink }, none], charSpacing: 0.4 } })),
  ];
  const white = { type: 'solid', pt: 1.5, color: COLOR.paper };
  const body = v.rows.map((r) => [
    { text: r.label, options: { fontFace: FONT.semi, fontSize: fs, color: COLOR.ink, valign: 'middle', border: [none, none, hair, none] } },
    ...r.cells.map((c) => {
      const st = VERDICT_STYLE[c.verdict];
      return { text: c.text, options: { fontFace: FONT.semi, fontSize: fs - 0.5, color: st.fg, fill: { color: st.bg }, align: 'center', valign: 'middle', border: [white, white, white, white] } };
    }),
  ]);
  const name = `${cv.id}:table:1`;
  cv.s.addTable([head, ...body] as never, { x: X, y: Y, w: W, colW: [first, ...v.cols.map(() => rest)], rowH: [0.4, ...v.rows.map(() => rowH)], margin: [0.02, 0.08, 0.02, 0], autoPage: false, objectName: name } as never);
  cv.ledger.push({ slide: cv.id, name, kind: 'table', role: 'matrix', x: X, y: Y, w: W, h: 0.4 + rowH * v.rows.length, fontSize: fs, needs: 0.4 + rowH * v.rows.length });
}

// ---------------------------------------------------------------------------------------------------------------- timeline
export function timeline(cv: Canvas, v: V<'timeline'>) {
  const fh = foot(cv, v.foot);
  const n = v.steps.length;
  const slot = W / n;
  const ly = Y + 1.05;
  cv.line('timeline-axis', X + slot / 2, ly, X + W - slot / 2, ly, { color: COLOR.ink3, w: 1.5 });
  v.steps.forEach((st, i) => {
    const cx = X + slot * i + slot / 2;
    cv.text('step-time', st.t, cx - slot / 2 + 0.05, ly - 0.62, slot - 0.1, 0.4, { fontSize: 15, bold: true, color: COLOR.teal, align: 'center' });
    cv.ellipse('step-dot', cx - 0.1, ly - 0.1, 0.2, 0.2, i === n - 1 ? COLOR.amber : COLOR.ocean);
    cv.text('step-label', st.label, cx - slot / 2 + 0.06, ly + 0.28, slot - 0.12, 0.9, { fontSize: n > 7 ? 12 : 14, bold: true, align: 'center' });
    if (st.sub) cv.text('step-sub', st.sub, cx - slot / 2 + 0.06, ly + 1.2, slot - 0.12, 0.75, { fontSize: 11.5, color: COLOR.ink2, align: 'center' });
  });
  void fh;
}

// ---------------------------------------------------------------------------------------------------------------- cells (the recommended architecture)
export function cells(cv: Canvas, v: V<'cells'>) {
  const fh = foot(cv, v.foot);
  const top = Y;
  cv.rect('group-plane', X, top, W, 0.46, { fill: COLOR.mist, line: COLOR.line, radius: 0.05 });
  cv.text('group-plane-text', [{ text: 'Group plane  ', options: { bold: true, fontFace: FONT.semi } }, { text: 'signed methodology and policy go down; only approved-flow metadata comes up (undecided, D-011)' }], X + 0.2, top, W - 0.4, 0.46, { fontSize: 12, valign: 'middle' });
  const cy = top + 0.66;
  const ch = B - cy - fh - 0.04;
  const aw = 6.9;
  cv.rect('cell-a', X, cy, aw, ch, { fill: COLOR.paper, line: COLOR.teal, lineW: 1.5, dash: true, radius: 0.08 });
  cv.text('cell-a-title', 'SOVEREIGN CELL · PORT JURISDICTION A', X + 0.2, cy + 0.1, aw - 0.4, 0.26, { fontSize: 11, bold: true, color: COLOR.teal, charSpacing: 1 });
  // Three rows share what is left under the cell title; the heights follow the cell, so the diagram never spills out of it.
  const inner = ch - 0.46 - 0.14;
  const gap = 0.13;
  const unit = (inner - 2 * gap) / 10;
  const h1 = unit * 3.4;
  const h2 = unit * 3.4;
  const h3 = unit * 3.2;
  const r1 = cy + 0.46;
  const r2 = r1 + h1 + gap;
  const r3 = r2 + h2 + gap;
  const box = (role: string, x: number, y: number, w: number, h: number, title: string, sub: string, fill: string = COLOR.mist, fg: string = COLOR.ink) => {
    cv.rect(role, x, y, w, h, { fill, radius: 0.05 });
    cv.text(`${role}-title`, title, x + 0.12, y + 0.06, w - 0.24, 0.28, { fontSize: 12, bold: true, color: fg });
    cv.text(`${role}-sub`, sub, x + 0.12, y + 0.34, w - 0.24, Math.max(0.2, h - 0.38), { fontSize: 11, color: fg === COLOR.ink ? COLOR.ink2 : fg });
  };
  const bw = (aw - 0.4 - 0.4) / 3;
  box('edge', X + 0.2, r1, bw, h1, 'Edge buffer', 'capture, sign, queue');
  box('verify', X + 0.2 + bw + 0.2, r1, bw, h1, 'Verify and receipt', 'duplicates ignored');
  box('ledger', X + 0.2 + 2 * (bw + 0.2), r1, bw, h1, 'Evidence ledger', 'append-only');
  cv.line('a1', X + 0.2 + bw + 0.01, r1 + h1 / 2, X + 0.2 + bw + 0.19, r1 + h1 / 2, { color: COLOR.ink3, arrow: true });
  cv.line('a2', X + 0.2 + 2 * bw + 0.21, r1 + h1 / 2, X + 0.2 + 2 * bw + 0.39, r1 + h1 / 2, { color: COLOR.ink3, arrow: true });
  box('core', X + 0.2, r2, aw - 0.4, h2, 'Deterministic services: software computes, signs, enforces', 'calculation under a versioned method · certificate signing · approvals · audit', COLOR.deep, COLOR.paper);
  const hw = (aw - 0.4 - 0.2) / 2;
  box('agents', X + 0.2, r3, hw, h3, 'Bounded agents (optional)', 'draft and explain; never approve', COLOR.seafoam, COLOR.navy);
  box('tenant', X + 0.2 + hw + 0.2, r3, hw, h3, 'Per-shipowner access', 'isolation enforced by the cell');
  const bx = X + aw + 0.25;
  const gw = 2.4;
  cv.rect('cell-b', bx, cy, gw, ch, { fill: COLOR.sand, line: COLOR.teal, lineW: 1, dash: true, radius: 0.08 });
  cv.text('cell-b-title', 'CELL · JURISDICTION B', bx + 0.15, cy + 0.1, gw - 0.3, 0.26, { fontSize: 11, bold: true, color: COLOR.teal, charSpacing: 1 });
  cv.text('cell-b-text', 'Same contract; hosting may differ: an Azure region or a local host, decided per port.', bx + 0.15, cy + 0.46, gw - 0.3, Math.max(0.6, ch - 1.45), { fontSize: 12, color: COLOR.ink2 });
  cv.text('cell-n-text', 'One cell per jurisdiction, not per port.', bx + 0.15, cy + ch - 0.62, gw - 0.3, 0.5, { fontSize: 12, bold: true, color: COLOR.ink2 });
  const ox = bx + gw + 0.25;
  const ow = X + W - ox;
  const oh = (ch - 0.16) / 2;
  box('portal', ox, cy, ow, oh, 'Shipowner', 'verifies offline, public key only');
  box('certbody', ox, cy + oh + 0.16, ow, oh, 'Certification body', 'only after quality-manager approval');
}

// ---------------------------------------------------------------------------------------------------------------- edge-flow (data-flow schematic)
export function edgeFlow(cv: Canvas, v: V<'edge-flow'>) {
  const fh = foot(cv, v.foot);
  const toneOf = (id: string): Tone => v.flows.find((f) => f.id === id)?.tone ?? 'neutral';
  const badge = (id: string, cx: number, cy: number) => {
    const t = TONE[toneOf(id)];
    cv.chip(id, cx - 0.27, cy - 0.13, t, { fontSize: 10, h: 0.26, w: 0.54 });
  };
  const arrow = (id: string, x1: number, y1: number, x2: number, y2: number) => {
    cv.line('flow-arrow', x1, y1, x2, y2, { color: TONE[toneOf(id)].fg, w: 1.75, arrow: true });
    badge(id, (x1 + x2) / 2, (y1 + y2) / 2);
  };
  const H = B - Y - fh - 0.05;
  const inW = 8.2;
  cv.rect('jurisdiction', X, Y, inW, H, { fill: COLOR.paper, line: COLOR.teal, lineW: 1.5, dash: true, radius: 0.08 });
  cv.text('jurisdiction-label', 'INSIDE THE PORT JURISDICTION', X + 0.2, Y + 0.1, 5, 0.24, { fontSize: 11, bold: true, color: COLOR.teal, charSpacing: 1 });
  const nw = 1.55;
  const ng = (inW - 0.4 - 4 * nw) / 3;
  const nx = (i: number) => X + 0.2 + i * (nw + ng);
  const nh = 0.62;
  const ya = Y + 0.6;
  const yb = Y + H - nh - 0.25;
  const node = (label: string, i: number, y: number, fill: string = COLOR.mist) => {
    cv.rect('node', nx(i), y, nw, nh, { fill, radius: 0.05 });
    cv.text('node-text', label, nx(i) + 0.08, y, nw - 0.16, nh, { fontSize: 12, bold: true, align: 'center', valign: 'middle' });
  };
  node('Device', 0, ya);
  node('Edge buffer', 1, ya);
  node('Cell verifier', 2, ya);
  node('Evidence store and ledger', 3, ya, COLOR.seafoam);
  arrow('F-1', nx(0) + nw, ya + nh / 2, nx(1), ya + nh / 2);
  arrow('F-2', nx(1) + nw, ya + nh / 2, nx(2), ya + nh / 2);
  arrow('F-3', nx(2) + nw, ya + nh / 2, nx(3), ya + nh / 2);
  node('Agents', 0, yb);
  node('In-jurisdiction inference', 1, yb);
  node('Logs and diagnostics', 2, yb);
  node('Backup and replica', 3, yb);
  arrow('F-6', nx(0) + nw, yb + nh / 2, nx(1), yb + nh / 2);
  arrow('F-5', nx(2) + nw / 2, ya + nh, nx(2) + nw / 2, yb);
  arrow('F-4', nx(3) + nw / 2, ya + nh, nx(3) + nw / 2, yb);
  // outside the jurisdiction
  const ox = X + inW + 0.55;
  const ow = X + W - ox;
  cv.text('outside-label', 'OUTSIDE', ox, Y + 0.1, 3, 0.24, { fontSize: 11, bold: true, color: COLOR.ink3, charSpacing: 1 });
  const oh = 0.62;
  const gap = (H - 0.5 - 4 * oh) / 3;
  const outs: [string, string][] = [['Group plane', 'F-7'], ['Shipowner portal', 'F-9'], ['Certification body', 'F-10'], ['Operators and vendors', 'F-11']];
  outs.forEach(([label, id], i) => {
    const y = Y + 0.45 + i * (oh + gap);
    const t = TONE[toneOf(id)];
    cv.rect('out-node', ox, y, ow, oh, { fill: COLOR.sand, line: id === 'F-11' ? COLOR.red : COLOR.line, radius: 0.05, dash: id === 'F-11' });
    cv.text('out-text', label, ox + 0.1, y, ow - 0.2, oh, { fontSize: 12, bold: true, valign: 'middle', color: id === 'F-11' ? COLOR.red : COLOR.ink });
    if (id === 'F-11') {
      cv.line('flow-arrow', X + inW + 0.5, y + oh / 2, ox - 0.02, y + oh / 2, { color: t.fg, w: 1.75, dash: true });
      badge(id, X + inW + 0.25, y + oh / 2);
    } else {
      cv.line('flow-arrow', X + inW + 0.02, y + oh / 2, ox - 0.02, y + oh / 2, { color: t.fg, w: 1.75, arrow: true });
      badge(id, X + inW + 0.28, y + oh / 2);
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------- trust-chain
export function trustChain(cv: Canvas, v: V<'trust-chain'>) {
  const fh = foot(cv, v.foot);
  const n = v.steps.length;
  const gap = 0.3;
  const w = (W - (n - 1) * gap) / n;
  const y = Y + 0.05;
  const h = 1.9;
  v.steps.forEach((st, i) => {
    const x = X + i * (w + gap);
    cv.rect('link-card', x, y, w, h, { fill: COLOR.paper, line: COLOR.line, radius: 0.06 });
    cv.rect('link-accent', x, y, w, 0.06, { fill: i === n - 1 ? COLOR.green : COLOR.ocean });
    cv.text('link-no', String(i + 1), x + 0.16, y + 0.16, 0.4, 0.28, { fontSize: 12, bold: true, color: COLOR.teal });
    cv.text('link-label', st.label, x + 0.16, y + 0.5, w - 0.32, 0.7, { fontSize: 14, bold: true });
    cv.text('link-sub', st.sub, x + 0.16, y + 1.25, w - 0.32, 0.55, { fontSize: 11.5, color: COLOR.ink2 });
    if (i < n - 1) {
      cv.rect('chain-link', x + w + 0.02, y + h / 2 - 0.07, gap - 0.04, 0.14, { fill: COLOR.teal, radius: 0.07 });
    }
  });
  const by = y + h + 0.3;
  const bh = Math.max(0.75, B - by - fh - 0.1);
  cv.rect('tamper-band', X, by, W, Math.min(bh, 1.0), { fill: COLOR.amberBg, radius: 0.05 });
  cv.text('tamper-text', [{ text: 'Tampering is detected, not prevented. ', options: { bold: true, fontFace: FONT.semi } }, { text: 'Change any event, receipt, manifest or certificate and a signature or hash no longer matches. An independent external anchor is an open decision (ADR 0018).' }], X + 0.25, by, W - 0.5, Math.min(bh, 1.0), { fontSize: 14, color: COLOR.ink, valign: 'middle' });
}

// ---------------------------------------------------------------------------------------------------------------- autonomy
export function autonomy(cv: Canvas, v: V<'autonomy'>) {
  const fh = foot(cv, v.foot);
  const rowH = 0.52;
  const nameW = 3.0;
  const sq = 0.36;
  const gx = X + nameW;
  for (let l = 0; l <= 5; l++) cv.text('level-head', `L${l}`, gx + l * (sq + 0.08), Y, sq, 0.24, { fontSize: 11, bold: true, color: l === 5 ? COLOR.red : COLOR.ink3, align: 'center' });
  const whyX = gx + 6 * (sq + 0.08) + 0.3;
  cv.text('why-head', 'WHY THIS CEILING', whyX, Y, W - (whyX - X), 0.24, { fontSize: 11, bold: true, color: COLOR.ink3, charSpacing: 1 });
  v.agents.forEach((a, i) => {
    const y = Y + 0.34 + i * rowH;
    cv.line('agent-rule', X, y, X + W, y, { color: COLOR.line, w: 0.5 });
    cv.text('agent-name', a.name, X, y + 0.08, nameW - 0.1, rowH - 0.12, { fontSize: 13.5, bold: true, valign: 'middle' });
    for (let l = 0; l <= 5; l++) {
      const x = gx + l * (sq + 0.08);
      const on = l <= a.level && l > 0;
      cv.rect('level-cell', x, y + (rowH - sq) / 2, sq, sq, { fill: on ? (l === a.level ? COLOR.ocean : COLOR.seafoam) : COLOR.paper, line: l === 5 ? COLOR.red : on ? undefined : COLOR.line, radius: 0.04 });
    }
    cv.text('agent-why', a.why, whyX, y + 0.04, W - (whyX - X), rowH - 0.08, { fontSize: 12.5, color: COLOR.ink2, valign: 'middle' });
  });
  const ly = Y + 0.34 + v.agents.length * rowH + 0.12;
  const legend = v.levels.map((l) => `${l.id} ${l.meaning.split(/[.:]/)[0]}`).join('   ·   ');
  cv.text('levels-legend', legend, X, ly, W, 0.4, { fontSize: 11.5, color: COLOR.ink2 });
}

// ---------------------------------------------------------------------------------------------------------------- topology (Azure services for one cell)
const SERVICES: { row: number; col: number; name: string; sub: string; azure: string; mono: string }[] = [
  { row: 0, col: 0, name: 'Microsoft Entra ID', sub: 'human and workload identity', azure: 'entra', mono: 'EN' },
  { row: 0, col: 1, name: 'Container Apps ingress', sub: 'API gateway: APIM candidate', azure: 'containerapps', mono: 'GW' },
  { row: 0, col: 2, name: 'Azure Policy and RBAC', sub: 'location and access guardrails', azure: 'policy', mono: 'PL' },
  { row: 1, col: 0, name: 'Azure Container Apps', sub: 'services and agent runtime', azure: 'containerapps', mono: 'CA' },
  { row: 1, col: 1, name: 'Azure Service Bus', sub: 'ordered, deduplicated intake', azure: 'servicebus', mono: 'SB' },
  { row: 1, col: 2, name: 'Foundry model', sub: 'optional, in-jurisdiction only', azure: 'foundry', mono: 'AI' },
  { row: 2, col: 0, name: 'Azure PostgreSQL', sub: 'ledger and mass balance', azure: 'postgres', mono: 'PG' },
  { row: 2, col: 1, name: 'Blob Storage, immutable', sub: 'evidence and certificates', azure: 'blob', mono: 'BL' },
  { row: 2, col: 2, name: 'Key Vault Managed HSM', sub: 'keys held in the jurisdiction', azure: 'keyvault', mono: 'KV' },
  { row: 3, col: 0, name: 'Azure Monitor', sub: 'one workspace per cell', azure: 'monitor', mono: 'MO' },
  { row: 3, col: 1, name: 'Confidential Ledger', sub: 'anchor undecided (ADR 0018)', azure: 'ledger', mono: 'CL' },
  { row: 3, col: 2, name: 'Container Registry', sub: 'signed images, promotion', azure: 'acr', mono: 'CR' },
];
export function topology(cv: Canvas, v: V<'topology'>) {
  const fh = foot(cv, v.foot);
  const edgeW = 1.55;
  const gx = X + edgeW + 0.25;
  const gw = W - edgeW - 0.25;
  const gh = B - Y - fh - 0.05;
  cv.rect('azure-cell', gx, Y, gw, gh, { fill: COLOR.paper, line: COLOR.teal, lineW: 1.5, dash: true, radius: 0.08 });
  cv.text('azure-cell-title', 'ONE AZURE CELL PER PORT JURISDICTION  ·  DESIGN ONLY, NOTHING DEPLOYED', gx + 0.2, Y + 0.08, gw - 0.4, 0.24, { fontSize: 11, bold: true, color: COLOR.teal, charSpacing: 1 });
  const cols = 3;
  const rows = 4;
  const gap = 0.14;
  const tw = (gw - 0.4 - gap * (cols - 1)) / cols;
  const top = Y + 0.4;
  const th = (gh - 0.5 - gap * (rows - 1)) / rows;
  for (const s of SERVICES) {
    const x = gx + 0.2 + s.col * (tw + gap);
    const y = top + s.row * (th + gap);
    cv.rect('svc-tile', x, y, tw, th, { fill: COLOR.mist, radius: 0.05 });
    const icon = cv.assets.resolve(`azure-${s.azure}`, 'azure-icon');
    const ix = x + 0.1;
    const iy = y + (th - 0.42) / 2;
    if (icon) {
      cv.image('svc-icon', icon.absPath, ix, iy, 0.42, 0.42, s.name);
    } else {
      cv.rect('svc-mono', ix, iy, 0.42, 0.42, { fill: COLOR.ocean, radius: 0.08 });
      cv.text('svc-mono-text', s.mono, ix, iy, 0.42, 0.42, { fontSize: 11, bold: true, color: COLOR.paper, align: 'center', valign: 'middle' });
    }
    cv.text('svc-name', s.name, x + 0.62, y + 0.05, tw - 0.7, 0.28, { fontSize: 12, bold: true });
    cv.text('svc-sub', s.sub, x + 0.62, y + 0.35, tw - 0.7, th - 0.37, { fontSize: 11, color: COLOR.ink2 });
  }
  cv.rect('edge-box', X, Y + 0.5, edgeW, 1.3, { fill: COLOR.sand, line: COLOR.line, radius: 0.06 });
  cv.text('edge-title', 'Edge buffer', X + 0.12, Y + 0.6, edgeW - 0.24, 0.3, { fontSize: 12.5, bold: true });
  cv.text('edge-sub', 'Arc or IoT candidate; platform undecided (D-018)', X + 0.12, Y + 0.93, edgeW - 0.24, 0.85, { fontSize: 11, color: COLOR.ink2 });
  cv.line('edge-arrow', X + edgeW + 0.02, Y + 1.15, gx - 0.02, Y + 1.15, { color: COLOR.ink3, arrow: true, w: 1.5 });
  cv.rect('group-box', X, Y + 1.95, edgeW, 1.2, { fill: COLOR.sand, line: COLOR.line, radius: 0.06 });
  cv.text('group-title', 'Group plane', X + 0.12, Y + 2.05, edgeW - 0.24, 0.3, { fontSize: 12.5, bold: true });
  cv.text('group-sub', 'signed policy down; approved flows up', X + 0.12, Y + 2.38, edgeW - 0.24, 0.7, { fontSize: 11, color: COLOR.ink2 });
}

// ---------------------------------------------------------------------------------------------------------------- review placeholder
export function review(cv: Canvas, v: V<'review'>) {
  const h = B - Y - 0.1;
  cv.rect('review-panel', X, Y + 0.05, W, h, { fill: COLOR.amberBg, line: COLOR.amber, lineW: 1.25, dash: true, radius: 0.06 });
  cv.chip('REVIEW PLACEHOLDER', X + 0.3, Y + 0.3, { fg: COLOR.paper, bg: COLOR.amber }, { w: 2.1, fontSize: 10.5, h: 0.3 });
  cv.text('review-need-label', 'EVIDENCE NEEDED', X + 0.3, Y + 0.8, 4, 0.22, { fontSize: 11, bold: true, color: COLOR.amber, charSpacing: 1 });
  cv.text('review-need', v.need, X + 0.3, Y + 1.05, W - 0.6, 0.8, { fontSize: 18, bold: true });
  if (v.have?.length) {
    cv.text('review-have-label', 'WHAT THE REPOSITORY HOLDS INSTEAD', X + 0.3, Y + 1.95, 6, 0.22, { fontSize: 11, bold: true, color: COLOR.amber, charSpacing: 1 });
    const body = v.have.map((t) => `•  ${t}`).join('\n');
    cv.text('review-have', body, X + 0.3, Y + 2.22, W - 0.6, h - 2.3, { fontSize: 13.5, color: COLOR.ink2, lineSpacingMultiple: 1.1 });
  }
}

export function itemsToTable(items: Item[]): { head: string[]; rows: string[][] } {
  return { head: ['Item', 'Value', 'Evidence class'], rows: items.map((i) => [i.label, i.text ?? String(i.value ?? ''), i.chip ?? '']) };
}

export { CHIP };
