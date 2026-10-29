// Tests for the capstone presentation package. They check mechanical honesty (numbers come from sources, evidence paths exist, dollar figures are labelled, nothing claims a rehearsal happened)
// and that the generated files are current. They do NOT and cannot verify that a presentation is good or that anyone has rehearsed it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildAll, outputs } from '../harness/demo/build-package.mjs';
import { QA, fill } from '../harness/demo/qa.mjs';
import { loadFacts, root } from '../harness/demo/facts.mjs';

const B = buildAll(); const norm = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const P = (...a) => path.join(root, ...a);
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
const strings = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.entries(v).filter(([k]) => !['type', 'tone', 'chip', 'detail'].includes(k)).flatMap(([, x]) => strings(x)) : []);

test('generated deck, notes and Q&A are current (regenerate with node harness/demo/build-package.mjs)', () => {
  for (const k of ['deck', 'notes', 'qa']) { assert.ok(fs.existsSync(outputs[k]), `${k} missing`); assert.equal(norm(outputs[k]), B[k], `${k} is stale`); }
});

test('deck structure: a core talk, a separate executive appendix and a separate technical appendix', () => {
  const sec = (s) => B.slides.filter((x) => x.section === s);
  assert.equal(sec('main').length, 13); assert.equal(sec('exec-appendix').length, 5); assert.equal(sec('tech-appendix').length, 10);
  assert.equal(new Set(B.slides.map((s) => s.id)).size, B.slides.length);
  assert.equal(B.slides[0].id, 'M01'); assert.match(B.slides.find((s) => s.id === 'M13').headline, /Decision/);
});

test('one idea per slide: bounded headline, message and visible text; every slide has a message and notes', () => {
  for (const s of B.slides) {
    assert.ok(words(s.headline) <= 16, `${s.id} headline too long`); assert.ok(words(s.message) <= 28, `${s.id} message too long`);
    const visible = words([s.headline, s.message, ...strings(s.visual)].join(' ')); assert.ok(visible <= (s.section === 'main' ? 115 : 135), `${s.id} has ${visible} visible words`);
    assert.ok(s.say && words(s.say) >= 8, `${s.id} needs speaker notes`); assert.ok(s.seconds > 0 && s.rubric.length > 0, s.id);
  }
});

test('every evidence path on every slide exists, and every chip is a known label', () => {
  const chips = new Set(['CASE STUDY', 'CANDIDATE', 'SCENARIO', 'DESIGN', 'REAL RUN', 'MEASURED', 'NOT BUILT', 'NOT RUN', 'NOT PROVIDED']);
  for (const s of B.slides) { assert.ok(s.evidence.length > 0, s.id); for (const e of s.evidence) { assert.ok(fs.existsSync(P(e.path)), `${s.id}: missing ${e.path}`); assert.ok(chips.has(e.chip), `${s.id}: chip ${e.chip}`); } }
});

test('every dollar figure on a slide sits on a slide that carries a SCENARIO label (no unlabelled money)', () => {
  const html = B.deck.split('<section').slice(1);
  for (const sec of html) { const text = sec.replace(/<aside[\s\S]*?<\/aside>/g, ''); if (text.includes('$')) assert.ok(/>SCENARIO</.test(text), `a slide with money has no SCENARIO chip: ${text.slice(0, 120)}`); }
});

test('numbers on slides are read from committed sources, so they match the facts', () => {
  const f = loadFacts(); const fmt = (n) => (Math.abs(n) >= 1e6 ? `$${(Math.abs(n) / 1e6).toFixed(1)}M` : '');
  assert.ok(B.deck.includes(String(Math.round(f.payback)))); assert.ok(B.deck.includes(String(Math.round(f.breakEven)))); assert.ok(B.deck.includes(f.tests.pass.toLocaleString('en-US')));
  assert.ok(B.deck.includes(fmt(f.opt3.tco3))); assert.ok(B.deck.includes(`${f.eval.passed} of ${f.eval.cases}`));
  assert.equal(f.labels.userProvided, 0, 'the deck says no business figure was provided; this must stay true or the deck must change');
  assert.ok(B.deck.includes('NOT RUN')); assert.ok(B.deck.includes('NOT BUILT'));
});

test('the deck never calls itself a verified delivery and states the demo is not the platform', () => {
  assert.ok(!/rehearsed and verified|delivery (has been|is) verified/i.test(B.deck + B.notes + B.qa));
  const m08 = B.slides.find((s) => s.id === 'M08'); assert.match(m08.message, /Real code on synthetic data/); assert.match(B.notes, /Nothing here has been rehearsed/);
});

test('speaker notes give per-slide timing and a cumulative total for the core talk only', () => {
  const main = B.slides.filter((s) => s.section === 'main'); const total = main.reduce((a, s) => a + s.seconds, 0);
  assert.ok(total >= 600 && total <= 1200, `core talk is ${total}s`); assert.match(B.notes, /Cumulative/); assert.match(B.notes, /slot length for the capstone panel is \*\*not known/);
  assert.equal(B.slides.find((s) => s.id === 'M08').seconds, 120, 'the demo slot is the 120-second demo');
});

test('Q&A: exactly 50 questions, each with a response, evidence, uncertainty and concede-or-verify guidance', () => {
  assert.equal(QA.length, 50); assert.deepEqual(QA.map((q) => q.id), Array.from({ length: 50 }, (_, i) => `Q${String(i + 1).padStart(2, '0')}`));
  for (const q of QA) { for (const k of ['q', 'a', 'unc', 'con']) assert.ok(words(q[k]) >= 4, `${q.id}.${k}`); assert.ok(q.ev.length >= 1); for (const p of q.ev) assert.ok(fs.existsSync(P(p)), `${q.id}: missing ${p}`); }
  const f = loadFacts(); for (const q of QA) for (const k of ['q', 'a', 'unc', 'con']) assert.ok(!/\{\w+\}/.test(fill(q[k], f)), `${q.id}.${k} has an unresolved token`);
  assert.ok(!/\{\w+\}/.test(B.qa));
});

test('Q&A covers cost, security, AI necessity, scalability, sovereignty, disaster recovery, alternatives and commercial viability', () => {
  const areas = new Set(QA.map((q) => q.area)); for (const a of ['Cost', 'Security', 'AI necessity', 'Scalability', 'Sovereignty', 'Disaster recovery', 'Alternatives', 'Commercial']) assert.ok(areas.has(a), a);
  for (const a of ['Cost', 'Security', 'Commercial', 'Alternatives', 'AI necessity']) assert.ok(QA.filter((q) => q.area === a).length >= 3, a);
});

test('every question is linked from the slide where it is likely to be asked, and the notes list them', () => {
  const linked = new Set(B.slides.flatMap((s) => s.ifAsked ?? [])); for (const q of QA) assert.ok(linked.has(q.id), `${q.id} is not linked from any slide`);
});

test('Q&A answers concede openly where the evidence is thin (no answer claims compliance or residency)', () => {
  const t = QA.map((q) => q.a).join(' ');
  assert.ok(!/is compliant|are compliant|guarantees residency|satisfies residency|fully secure|proven safe/i.test(t));
  for (const id of ['Q01', 'Q19', 'Q24', 'Q25', 'Q28', 'Q41', 'Q48']) assert.match(QA.find((q) => q.id === id).con + QA.find((q) => q.id === id).unc, /Concede|concede|Say|Offer|name|Name|not|unverified|undecided|Dates|All of it/i);
});

test('scorecard: all ten B and C criteria are present with their rubric wording, and every one is NOT REHEARSED with no score', () => {
  const card = norm(P('docs', 'capstone', 'presentation', 'REHEARSAL-PLAN-AND-SCORECARD.md')); const trace = norm(P('docs', 'capstone', 'RUBRIC-TRACEABILITY.md'));
  for (const c of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'C1', 'C2', 'C3']) {
    assert.match(card, new RegExp(`### ${c}\\. `)); const sec = card.split(new RegExp(`### ${c}\\. `))[1].split('\n### ')[0];
    const quote = (sec.match(/\*\*Excellent expects:\*\* "([^"]+)"/) ?? [])[1]; assert.ok(quote, `${c} has no quote`); assert.ok(trace.includes(quote), `${c}: the quote is not in RUBRIC-TRACEABILITY`);
    assert.match(sec, /Status:\*\* NOT REHEARSED/); assert.ok(!/\b(score|scored)\s*[:=]\s*\d/i.test(sec), `${c} must not carry a score`);
  }
  assert.match(card, /Nothing in this package verifies presentation delivery/); assert.match(card, /is \*\*not in the workspace now\*\*/);
});

test('backup demo rules: a recording is never presented as live, and the tooling enforces a banner', () => {
  const b = norm(P('docs', 'capstone', 'presentation', 'BACKUP-DEMO.md')); assert.match(b, /never presented as live/); assert.match(b, /RECORDED RUN: THIS IS A RECORDING, NOT A LIVE EXECUTION/);
  const e = norm(P('docs', 'capstone', 'presentation', 'DEMO-EXECUTIVE.md')); assert.match(e, /Fallback ladder|fallback ladder/); assert.match(e, /recording, not live/);
  const d = norm(P('docs', 'capstone', 'presentation', 'DEMO-DEEP-DIVE.md')); for (const s of ['agents', 'tamper', 'isolation', 'outage', 'lineage', 'approval', 'observability', 'azure']) assert.ok(d.includes(`\`${s}\``), s);
  assert.equal((d.match(/Does not show/g) ?? []).length, 8, 'each deep dive says what it does not show');
});

test('package index lists every file and names what the package does not do', () => {
  const r = norm(P('docs', 'capstone', 'presentation', 'README.md')); for (const f of ['deck/index.html', 'SPEAKER-NOTES.md', 'NARRATIVE.md', 'DEMO-EXECUTIVE.md', 'DEMO-DEEP-DIVE.md', 'BACKUP-DEMO.md', 'QA-PANEL-50.md', 'REHEARSAL-PLAN-AND-SCORECARD.md']) assert.ok(r.includes(f), f);
  assert.match(r, /It does not claim the platform exists/); assert.match(r, /prepared, not rehearsed/);
});
