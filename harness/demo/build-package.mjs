// BUILD: capstone deck (self-contained HTML, no network needed), speaker notes (Markdown) and the 50-question panel pack. Run: node harness/demo/build-package.mjs [--check]
// Outputs are generated from deck-data.mjs, qa.mjs and facts.mjs. Never edit the outputs by hand: tests/presentation.test.mjs compares them with a fresh build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFacts, root } from './facts.mjs';
import { buildSlides } from './deck-data.mjs';
import { QA, qaMarkdown } from './qa.mjs';
import { TAXONOMY } from '../agent-eval/score.mjs';

const out = path.join(root, 'docs', 'capstone', 'presentation');
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const CHIP = { 'CASE STUDY': 'c-case', CANDIDATE: 'c-cand', SCENARIO: 'c-scen', DESIGN: 'c-des', 'REAL RUN': 'c-real', MEASURED: 'c-meas', 'NOT BUILT': 'c-no', 'NOT RUN': 'c-no', 'NOT PROVIDED': 'c-no' };
const chip = (c) => `<span class="chip ${CHIP[c] ?? 'c-des'}">${esc(c)}</span>`;
const tone = (t) => ({ good: 'good', bad: 'bad', warn: 'warn' }[t] ?? '');

// ------------------------------------------------------------------ SVG diagrams
const box = (x, y, w, h, lines, cls = '') => `<g class="bx ${cls}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/>${lines.map((t, i) => `<text x="${x + w / 2}" y="${y + h / 2 + (i - (lines.length - 1) / 2) * 17 + 5}" text-anchor="middle" class="${i === 0 ? 'bt' : 'bs'}">${esc(t)}</text>`).join('')}</g>`;
const arrow = (x1, y1, x2, y2, label = '', cls = '') => { const mx = (x1 + x2) / 2; const my = (y1 + y2) / 2; return `<g class="ar ${cls}"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#ah)"/>${label ? `<text x="${mx}" y="${my - 6}" text-anchor="middle" class="al">${esc(label)}</text>` : ''}</g>`; };
const zone = (x, y, w, h, label, cls = '') => `<g class="zn ${cls}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14"/><text x="${x + 14}" y="${y + 22}" class="zl">${esc(label)}</text></g>`;
const defs = '<defs><marker id="ah" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="#0E7C86"/></marker></defs>';
const tb = (x, y, n) => `<g class="tbm"><circle cx="${x}" cy="${y}" r="13"/><text x="${x}" y="${y + 4}" text-anchor="middle">TB${n}</text></g>`;

function svgArch(detail) {
  const parts = [defs,
    zone(250, 20, 560, 330, 'Port-jurisdiction cell (one per port)', 'cell'), zone(850, 20, 230, 190, 'Group plane (thin)', 'grp'),
    box(30, 70, 190, 70, ['Barge or terminal edge', 'meter, signs, buffers'], 'edge'), box(30, 190, 190, 60, ['Intermittent link', 'store and forward'], 'soft'),
    box(275, 55, 240, 62, ['Ingestion and verifier', 'order, replay, signatures'], 'core'), box(545, 55, 240, 62, ['Evidence store and ledger', 'append-only, local'], 'core'),
    box(275, 140, 240, 62, ['Deterministic calculation', 'versioned methodology'], 'core'), box(545, 140, 240, 62, ['Certificate and approval', 'signs after human approval'], 'core'),
    box(275, 225, 240, 55, ['Bounded agents (optional)', 'draft and explain only'], 'ai'), box(545, 225, 240, 55, ['Audit log', 'hash-chained'], 'core'),
    box(875, 55, 180, 56, ['Signed methodology', 'and policy'], 'soft'), box(875, 130, 180, 56, ['Approved flows only', 'hashes and totals'], 'soft'),
    box(250, 385, 270, 50, ['Shipowner portal', 'per-tenant, own data only'], 'out'), box(540, 385, 270, 50, ['Certification body', 'only after human approval'], 'out'),
    box(850, 250, 230, 110, ['Azure, where verified', 'else local or on-premises', 'host for the cell'], 'azure'),
    arrow(220, 100, 275, 85), arrow(220, 220, 275, 100), arrow(515, 86, 545, 86), arrow(395, 117, 395, 140), arrow(665, 117, 665, 140), arrow(515, 170, 545, 170), arrow(395, 202, 395, 225),
    arrow(875, 83, 785, 83, 'signed', 'g'), arrow(785, 160, 875, 158, 'approved only', 'g'), arrow(500, 350, 400, 385), arrow(700, 350, 700, 385), arrow(830, 300, 810, 300, '', 'g')];
  if (detail) parts.push(tb(235, 90, 1), tb(235, 215, 2), tb(395, 297, 3), tb(330, 365, 4), tb(835, 110, 5), tb(615, 365, 6));
  return `<svg viewBox="0 0 1100 450" role="img" aria-label="Recommended architecture">${parts.join('')}</svg>`;
}
function svgLifecycle() {
  const st = [['DRAFT', 'agent or person drafts'], ['EVIDENCE_PENDING', 'submitted'], ['VALIDATED', 'validator service only'], ['APPROVED', 'human quality manager signs'], ['ISSUED', 'issuer service signs']];
  const parts = [defs]; st.forEach((s, i) => { parts.push(box(20 + i * 205, 60, 180, 70, s, i === 3 ? 'human' : 'core')); if (i < 4) parts.push(arrow(200 + i * 205, 95, 225 + i * 205, 95)); });
  parts.push(box(655, 210, 180, 60, ['SUPERSEDED', 'by a new version'], 'soft'), box(860, 210, 180, 60, ['REVOKED', 'human approval, reason'], 'soft'), arrow(930, 130, 760, 210), arrow(950, 130, 950, 210));
  parts.push(box(20, 210, 600, 90, ['Rules enforced', 'an edit after validation returns to DRAFT and discards approval', 'issued content is immutable; one live certificate per delivery'], 'ai'));
  return `<svg viewBox="0 0 1100 330" role="img" aria-label="Certificate lifecycle">${parts.join('')}</svg>`;
}
function svgChain() {
  const parts = [defs]; for (let i = 0; i < 5; i++) { parts.push(box(20 + i * 205, 130, 180, 64, [`Event ${i + 1}`, i === 0 ? 'transfer-start' : i === 4 ? 'transfer-end' : 'meter reading'], 'core')); if (i < 4) parts.push(arrow(200 + i * 205, 162, 225 + i * 205, 162, 'prev hash')); parts.push(box(20 + i * 205, 235, 180, 48, ['Signed receipt', 'cell clock'], 'soft'), arrow(110 + i * 205, 194, 110 + i * 205, 235)); }
  parts.push(box(20, 20, 380, 60, ['Evidence manifest hash', 'of all event hashes'], 'ai'), box(640, 20, 400, 60, ['Certificate', 'signed; binds manifest, calculation, approval'], 'out'), arrow(400, 50, 640, 50, 'bound by hash'), arrow(210, 80, 210, 130));
  parts.push(box(20, 320, 1020, 44, ['A verifier needs only these files and a trust set it supplies. Keys inside a file are ignored.'], 'soft'));
  return `<svg viewBox="0 0 1100 390" role="img" aria-label="Evidence chain">${parts.join('')}</svg>`;
}

// ------------------------------------------------------------------ slide renderers
function visual(s, f) {
  const v = s.visual;
  switch (v.type) {
    case 'title': return `<div class="title"><div class="tsub">${esc(v.sub)}</div><div class="tmeta">${esc(v.meta)}</div></div>`;
    case 'flow': return `<div class="flow">${v.stages.map((x, i) => `<div class="stage">${esc(x)}</div>${i < v.stages.length - 1 ? '<div class="farrow">&#8594;</div>' : ''}`).join('')}</div><div class="breaks">${v.breaks.map((b) => `<div class="brk">${esc(b)}</div>`).join('')}</div>`;
    case 'stats': return `<div class="stats">${v.items.map((i) => `<div class="stat"><div class="big">${esc(i.big)}</div><div class="slab">${esc(i.label)}</div>${chip(i.chip)}</div>`).join('')}</div>`;
    case 'statsBars': { const max = Math.max(...v.bars.map((b) => b.value)); return `<div class="stats">${v.items.map((i) => `<div class="stat"><div class="big">${esc(i.big)}</div><div class="slab">${esc(i.label)}</div>${chip(i.chip)}</div>`).join('')}</div><div class="bars"><div class="btitle">${esc(v.barsTitle)} ${chip('SCENARIO')}</div>${v.bars.map((b) => `<div class="brow"><span class="bl">${esc(b.label)}</span><span class="bar"><i style="width:${Math.max(2, (b.value / max) * 100).toFixed(1)}%"></i></span><span class="bv">${esc(b.text)}</span></div>`).join('')}</div>`; }
    case 'bars': { const max = Math.max(...v.bars.map((b) => b.value)); return `<div class="bars wide"><div class="btitle">${esc(v.title)} ${chip('SCENARIO')}</div>${v.bars.map((b) => `<div class="brow"><span class="bl">${esc(b.label)}</span><span class="bar"><i style="width:${((b.value / max) * 100).toFixed(1)}%"></i></span><span class="bv">${esc(b.text)}</span></div>`).join('')}</div><div class="foot">${esc(v.foot)}</div>`; }
    case 'cards': return `<div class="cards">${v.items.map((c) => `<div class="card ${tone(c.tone)}"><div class="ct">${esc(c.title)}</div><div class="cl">${esc(c.line)}</div><div class="cv">${esc(c.verdict)}</div></div>`).join('')}</div>`;
    case 'arch': return `<div class="svgwrap">${svgArch(v.detail)}</div>`;
    case 'lifecycle': return `<div class="svgwrap">${svgLifecycle()}</div>`;
    case 'chain': return `<div class="svgwrap">${svgChain()}</div>`;
    case 'table': return `<table class="tbl"><thead><tr>${v.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${v.rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i === v.tone ? `st ${/no approver|Revisit/i.test(c) ? 'warn' : /NOT|NONE|OPEN|DONE/.test(c) && !/Tested|Built/.test(c) ? 'bad' : /Tested|Built/.test(c) ? 'good' : 'warn'}` : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>${v.foot ? `<div class="foot">${esc(v.foot)}</div>` : ''}`;
    case 'timeline': return `<div class="tl">${v.steps.map((x) => `<div class="tls"><div class="tlt">${esc(x.t)}</div><div class="tll">${esc(x.label)}</div><div class="tlsub">${esc(x.sub)}</div></div>`).join('')}</div><div class="foot">${esc(v.foot)}</div>`;
    case 'arms': return `<div class="arms">${v.rows.map((r) => `<div class="arm ${r.tone}"><span class="an">${esc(r.arm)}</span><span class="av">${esc(r.value)}</span></div>`).join('')}</div><div class="foot">${esc(v.foot)}</div>`;
    default: return '';
  }
}
const slideHtml = (s, i, n, f) => `<section class="slide ${s.section} ${s.visual.type === 'title' ? 'is-title' : ''}" id="${s.id}" data-n="${i + 1}"><div class="inner"><div class="kick">${esc(s.kicker)}</div><h1>${esc(s.headline)}</h1><p class="msg">${esc(s.message)}</p><div class="vis">${visual(s, f)}</div><div class="ev">${s.evidence.map((e) => `${chip(e.chip)} <code>${esc(e.path)}</code>`).join(' &nbsp; ')}</div></div><div class="pg">${esc(s.id)} &middot; ${i + 1}/${n}</div><aside class="notes"><b>Say (${s.seconds}s):</b> ${esc(s.say)}${s.next ? `<br><b>Next:</b> ${esc(s.next)}` : ''}${s.ifAsked ? `<br><b>If asked:</b> ${esc(s.ifAsked.join(', '))}` : ''}</aside></section>`;

const CSS = `:root{--navy:#0B2540;--teal:#0E7C86;--sea:#E6F2F1;--sand:#F6F3EC;--ink:#13202B;--mute:#52606D;--amber:#B26A00;--red:#B3261E;--green:#1B7F4B}*{box-sizing:border-box}body{margin:0;background:#dfe6ea;font-family:"Segoe UI",system-ui,-apple-system,Helvetica,Arial,sans-serif;color:var(--ink)}
.slide{width:1280px;height:720px;margin:24px auto;background:linear-gradient(160deg,#fff 0%,var(--sand) 100%);position:relative;overflow:hidden;border-radius:6px;box-shadow:0 6px 30px rgba(11,37,64,.18)}.slide .inner{padding:44px 64px 0}
.slide.is-title{background:linear-gradient(150deg,var(--navy),#12456b 60%,var(--teal));color:#fff}.is-title h1{font-size:58px;margin-top:120px;max-width:900px}.is-title .msg{color:#cfe8ea}.tsub{font-size:26px;margin-top:30px}.tmeta{margin-top:12px;color:#bcd3dc;font-size:17px}.is-title .ev,.is-title .kick{color:#9fc4cc}
.kick{font-size:14px;letter-spacing:.14em;text-transform:uppercase;color:var(--teal);font-weight:600}h1{font-size:38px;line-height:1.12;margin:8px 0 10px;color:var(--navy);font-weight:650;max-width:1100px}.msg{font-size:21px;color:var(--mute);margin:0 0 20px;max-width:1050px}
.vis{min-height:380px}.ev{position:absolute;left:64px;right:64px;bottom:34px;font-size:12px;color:var(--mute)}.ev code{font-size:11.5px;background:#fff;padding:1px 5px;border-radius:4px;border:1px solid #dde3e8}.pg{position:absolute;right:20px;bottom:10px;font-size:11px;color:#8a98a5}
.chip{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.05em;padding:2px 7px;border-radius:10px;color:#fff;vertical-align:middle}.c-case{background:#5B6B7A}.c-cand{background:#3F5FA8}.c-scen{background:var(--amber)}.c-des{background:#6B4FA3}.c-real{background:var(--green)}.c-meas{background:var(--teal)}.c-no{background:var(--red)}
.flow{display:flex;align-items:center;gap:10px;margin-top:24px}.stage{flex:1;background:var(--navy);color:#fff;padding:22px 10px;border-radius:12px;text-align:center;font-size:18px;font-weight:600}.farrow{color:var(--teal);font-size:30px}.breaks{display:flex;gap:16px;margin-top:34px}.brk{flex:1;border:2px dashed var(--amber);border-radius:12px;padding:18px;font-size:19px;color:var(--amber);font-weight:600;text-align:center;background:#fffaf0}
.stats{display:flex;gap:22px}.stat{flex:1;background:#fff;border:1px solid #dbe3e8;border-radius:14px;padding:22px 20px;box-shadow:0 2px 8px rgba(11,37,64,.06)}.big{font-size:44px;font-weight:700;color:var(--navy);line-height:1.05}.slab{font-size:16px;color:var(--mute);margin:8px 0 10px;min-height:44px}
.bars{margin-top:22px}.btitle{font-size:15px;font-weight:600;color:var(--navy);margin-bottom:8px}.brow{display:flex;align-items:center;gap:12px;margin:7px 0}.bl{width:230px;font-size:16px}.bar{flex:1;background:#e5ecef;border-radius:6px;height:22px;display:block}.bar i{display:block;height:22px;background:linear-gradient(90deg,var(--teal),#2aa3ac);border-radius:6px}.bv{width:90px;font-weight:700;font-size:16px;text-align:right}.bars.wide{margin-top:34px}.bars.wide .brow{margin:16px 0}.bars.wide .bar{height:34px}.bars.wide .bar i{height:34px}.bars.wide .bl{width:260px;font-size:19px}.bars.wide .bv{font-size:22px;width:110px}
.cards{display:flex;gap:20px;margin-top:20px}.card{flex:1;background:#fff;border:1px solid #dbe3e8;border-left:8px solid #9aa8b3;border-radius:12px;padding:22px}.card.good{border-left-color:var(--green)}.card.bad{border-left-color:var(--red)}.card.warn{border-left-color:var(--amber)}.ct{font-size:20px;font-weight:700;color:var(--navy)}.cl{font-size:17px;margin:12px 0;color:var(--ink)}.cv{font-size:16px;font-weight:600;color:var(--mute)}
.svgwrap svg{width:100%;height:auto;max-height:410px}.bx rect{fill:#fff;stroke:var(--navy);stroke-width:1.5}.bx.core rect{fill:#EAF3F7}.bx.ai rect{fill:#F1ECFA;stroke:#6B4FA3}.bx.edge rect{fill:var(--navy)}.bx.edge text{fill:#fff}.bx.out rect{fill:#E8F5EE;stroke:var(--green)}.bx.soft rect{fill:#F6F3EC;stroke:#9aa8b3}.bx.azure rect{fill:#fff;stroke:var(--teal);stroke-dasharray:6 4}.bx.human rect{fill:#FFF3DD;stroke:var(--amber);stroke-width:2.5}.bt{font-size:14px;font-weight:700;fill:var(--navy)}.bs{font-size:12px;fill:var(--mute)}.ar line{stroke:var(--teal);stroke-width:2}.ar.g line{stroke-dasharray:5 4}.al{font-size:11px;fill:var(--teal)}.zn rect{fill:none;stroke:var(--navy);stroke-width:2;stroke-dasharray:9 6}.zn.grp rect{stroke:#6B4FA3}.zl{font-size:13px;font-weight:700;fill:var(--navy)}.tbm circle{fill:var(--amber)}.tbm text{font-size:10px;font-weight:700;fill:#fff}
.tbl{width:100%;border-collapse:collapse;font-size:18px;margin-top:10px;background:#fff;border-radius:10px;overflow:hidden}.tbl th{background:var(--navy);color:#fff;text-align:left;padding:12px 16px;font-size:15px}.tbl td{padding:12px 16px;border-bottom:1px solid #e6ecef}.tbl td.st{font-weight:700}.tbl td.good{color:var(--green)}.tbl td.bad{color:var(--red)}.tbl td.warn{color:var(--amber)}
.tl{display:flex;gap:10px;margin-top:26px}.tls{flex:1;background:#fff;border-top:6px solid var(--teal);border-radius:10px;padding:16px 12px;box-shadow:0 2px 8px rgba(11,37,64,.07)}.tlt{font-size:26px;font-weight:700;color:var(--teal)}.tll{font-size:17px;font-weight:700;margin:6px 0}.tlsub{font-size:14px;color:var(--mute)}
.arms{margin-top:14px}.arm{display:flex;justify-content:space-between;background:#fff;border-left:8px solid #9aa8b3;border-radius:10px;padding:18px 22px;margin:12px 0;font-size:20px}.arm.good{border-left-color:var(--green)}.arm.bad{border-left-color:var(--red)}.an{font-weight:700;color:var(--navy)}.av{font-weight:600}.arm.bad .av{color:var(--red)}
.foot{margin-top:18px;font-size:16px;color:var(--mute);font-style:italic}.notes{display:none;position:absolute;left:0;right:0;bottom:0;background:rgba(11,37,64,.94);color:#fff;padding:14px 64px;font-size:14px;line-height:1.45;max-height:42%;overflow:auto}body.shownotes .notes{display:block}
.hud{position:fixed;right:14px;top:10px;background:rgba(11,37,64,.85);color:#fff;font-size:12px;padding:6px 10px;border-radius:8px;z-index:9}@media print{body{background:#fff}.slide{margin:0;box-shadow:none;border-radius:0;page-break-after:always;break-after:page}.hud{display:none}.notes{display:none!important}@page{size:1280px 720px;margin:0}}
body.present .slide{display:none;margin:0 auto;position:fixed;inset:0;margin:auto;zoom:var(--zp,1)}body.present .slide.cur{display:block}body.present{background:#000}.slide{zoom:var(--z,1)}`;
const JS = `const S=[...document.querySelectorAll('.slide')];let i=0;const fit=()=>{const r=document.documentElement.style;r.setProperty('--z',Math.min(1,(innerWidth-40)/1280));r.setProperty('--zp',Math.min(innerWidth/1280,innerHeight/720))};addEventListener('resize',fit);fit();const go=(n)=>{i=Math.max(0,Math.min(S.length-1,n));S.forEach((s,k)=>s.classList.toggle('cur',k===i));if(document.body.classList.contains('present')){location.hash=S[i].id}};
addEventListener('keydown',(e)=>{if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown')go(i+1);else if(e.key==='ArrowLeft'||e.key==='PageUp')go(i-1);else if(e.key==='n'||e.key==='N')document.body.classList.toggle('shownotes');else if(e.key==='p'||e.key==='P'){document.body.classList.toggle('present');go(i)}else if(e.key==='Home')go(0);else if(e.key==='End')go(S.length-1)});
const h=location.hash.slice(1);if(h){const k=S.findIndex(s=>s.id===h);if(k>=0)i=k}go(i);`;

export function buildDeckHtml(slides, f) {
  const n = slides.length;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Green-Fuel Bunkering Certification Platform: capstone deck</title><meta name="viewport" content="width=1280"><style>${CSS}</style></head><body><div class="hud">P present &middot; arrows move &middot; N notes &middot; print for PDF</div>${slides.map((s, i) => slideHtml(s, i, n, f)).join('\n')}<script>${JS}</script></body></html>\n`;
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
export function notesMarkdown(slides) {
  const main = slides.filter((s) => s.section === 'main'); const total = main.reduce((a, s) => a + s.seconds, 0);
  const L = ['<!-- Generated by harness/demo/build-package.mjs from deck-data.mjs. Do not edit by hand. -->', '# Speaker notes and timing', '',
    'The slot length for the capstone panel is **not known to this package**: take it from the official guide. The core talk below runs about ' + mmss(total) + ' including the 2-minute live demo; the appendices are for questions only and are not presented unless asked. Scale by dropping slides, not by speaking faster (rubric B5).', '',
    '**Rule for every slide:** say what is real, what is scenario and what is not built. Never describe a recording as live. Nothing here has been rehearsed with a human yet.', '',
    '| Slide | Headline | Seconds | Cumulative |', '|---|---|---|---|'];
  let c = 0; for (const s of main) { c += s.seconds; L.push(`| ${s.id} | ${s.headline} | ${s.seconds} | ${mmss(c)} |`); }
  L.push('', '## Main talk', '');
  for (const s of main) { L.push(`### ${s.id}. ${s.headline}`, '', `*${s.kicker}. ${s.seconds} seconds. Rubric: ${s.rubric.join(', ')}.*`, '', `**Key message:** ${s.message}`, '', `**Say:** ${s.say}`, ''); if (s.next) L.push(`**Transition:** ${s.next}`, ''); if (s.ifAsked) L.push(`**If asked:** panel questions ${s.ifAsked.join(', ')} in [QA-PANEL-50](QA-PANEL-50.md).`, ''); L.push(`**Evidence:** ${s.evidence.map((e) => `\`${e.path}\` (${e.chip})`).join('; ')}`, ''); }
  for (const [sec, title] of [['exec-appendix', 'Executive appendix (for questions only)'], ['tech-appendix', 'Technical appendix (for questions only)']]) {
    L.push(`## ${title}`, ''); for (const s of slides.filter((x) => x.section === sec)) L.push(`### ${s.id}. ${s.headline}`, '', `${s.say}`, '', `**Evidence:** ${s.evidence.map((e) => `\`${e.path}\` (${e.chip})`).join('; ')}`, '');
  }
  return `${L.join('\n')}\n`;
}

export function buildAll() {
  const f = loadFacts(); f.taxonomy = Object.keys(TAXONOMY).length; const slides = buildSlides(f);
  return { f, slides, deck: buildDeckHtml(slides, f), notes: notesMarkdown(slides), qa: qaMarkdown(f, slides) };
}
export const outputs = { deck: path.join(out, 'deck', 'index.html'), notes: path.join(out, 'SPEAKER-NOTES.md'), qa: path.join(out, 'QA-PANEL-50.md') };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const b = buildAll();
  if (process.argv.includes('--check')) { const bad = Object.entries({ deck: b.deck, notes: b.notes, qa: b.qa }).filter(([k, v]) => !fs.existsSync(outputs[k]) || fs.readFileSync(outputs[k], 'utf8').replace(/\r\n/g, '\n') !== v); if (bad.length) { console.error(`stale: ${bad.map(([k]) => k).join(', ')}`); process.exit(1); } console.log('presentation outputs are current'); }
  else { for (const k of ['deck', 'notes', 'qa']) { fs.mkdirSync(path.dirname(outputs[k]), { recursive: true }); fs.writeFileSync(outputs[k], b[k]); } console.log(`wrote deck (${b.slides.length} slides), speaker notes, ${QA.length} questions`); }
}
