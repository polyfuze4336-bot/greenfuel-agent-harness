// Presentation pipeline checks. Run with: node --test checks/deck.check.ts
// The content and build tests read this repository at HEAD, so they also fail if a committed source stops supporting a slide's claim.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { before, describe, it } from 'node:test';
import PptxGenJS from 'pptxgenjs';
import { Assets } from '../src/lib/deck/assets.ts';
import { applyFailures, checkClaims } from '../src/lib/deck/claims.ts';
import { buildSlides } from '../src/lib/deck/content.ts';
import type { DeckContext } from '../src/lib/deck/context.ts';
import { deckGate, rehearsalOf } from '../src/lib/deck/gate.ts';
import { inspectPptx } from '../src/lib/deck/inspect.ts';
import { clip, parseTables, plain, verdictOf } from '../src/lib/deck/mdtable.ts';
import { TEXT_PAIRS, contrast, renderedChecks, staticChecks, summarize, visibleWords } from '../src/lib/deck/qa.ts';
import { powerpointAvailable, renderDeck } from '../src/lib/deck/render.ts';
import { emptyDeckState, generate, openDeckContext, prepare } from '../src/lib/deck/service.ts';
import { asVariant, contentHash, effective, variantsOf } from '../src/lib/deck/slides.ts';
import { DeckError, DeckStore, applyAction, statusOf, type DeckAction, type SlideFacts } from '../src/lib/deck/store.ts';
import { CHIP, COLOR, TONE, estimate } from '../src/lib/deck/theme.ts';
import type { Slide, Visual } from '../src/lib/deck/types.ts';

const repo = path.resolve(import.meta.dirname, '..', '..', '..');
const appDir = path.resolve(import.meta.dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'deck-check-'));
const git = (...a: string[]) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' }).stdout.trim();

let ctx: DeckContext;
before(() => {
  ctx = openDeckContext(repo, 'HEAD', { codeRoot: repo });
});

const stub = (files: Record<string, string>): Pick<DeckContext, 'read' | 'has' | 'commit'> => ({ read: (p) => files[p], has: (p) => p in files, commit: 'abc1234def' });
const slide = (o: Partial<Slide> = {}): Slide => ({ id: 'X01', tier: 'executive', section: 's', title: 'A title', message: 'm', visual: { kind: 'table', head: ['a'], rows: [['b']] }, claims: [], sources: [{ path: 'a.md' }], decisions: [], placeholders: [], notes: { say: 'word '.repeat(40) }, seconds: 30, rubric: ['B1'], ...o });

describe('markdown tables and text', () => {
  it('reads a table, strips markdown, and reads a verdict only from its opening words', () => {
    const t = parseTables('| A | B |\n|---|---|\n| **Meets:** fine | `x` [l](u) |\n| Does not meet | y |\n')[0]!;
    assert.deepEqual(t.head, ['A', 'B']);
    assert.equal(plain(t.rows[0]![1]!), 'x l');
    assert.equal(verdictOf(t.rows[0]![0]!), 'meets');
    assert.equal(verdictOf(t.rows[1]![0]!), 'does-not-meet');
    assert.equal(verdictOf('Conditional: maybe'), 'conditional');
    assert.equal(verdictOf('Something else'), 'other', 'nothing is guessed');
  });

  it('clips at a clause, always says it left something out, and never exceeds the limit', () => {
    assert.equal(clip('short', 20), 'short');
    const long = 'Zone redundancy where the tier supports it; the edge buffers and resends in order, and duplicates are ignored by the receiver';
    for (const n of [30, 45, 60, 80]) {
      const c = clip(long, n);
      assert.ok(c.length <= n, `${n}: ${c.length}`);
      assert.ok(c.endsWith('…'));
    }
    assert.equal(clip(long, 45), 'Zone redundancy where the tier supports it…');
  });

  it('estimates more lines for more text and for a narrower box', () => {
    assert.equal(estimate('hello', 14, 5).lines, 1);
    assert.ok(estimate('word '.repeat(60), 14, 5).lines > estimate('word '.repeat(60), 14, 10).lines);
  });
});

describe('design: contrast', () => {
  for (const [k, v] of [...Object.entries(CHIP), ...Object.entries(TONE)]) it(`chip or status text  meets 4.5:1 on its own background`, () => assert.ok(contrast(v.fg, v.bg) >= 4.5, ``));
  for (const p of TEXT_PAIRS) it(`${p.use}: ${p.fg} on ${p.bg} meets ${p.min}:1`, () => assert.ok(contrast(COLOR[p.fg], COLOR[p.bg]) >= p.min, `${contrast(COLOR[p.fg], COLOR[p.bg]).toFixed(2)}`));
});

describe('claims are checked against their sources', () => {
  const slides = (contains?: string[], sources = ['a.md']) => [slide({ claims: [{ id: 'c1', text: 't', sources, contains }] })];
  it('passes when the source exists and says it', () => assert.equal(checkClaims(stub({ 'a.md': 'The Premium is Scenario' }) as DeckContext, slides(['premium is scenario'])).every((c) => c.ok), true));
  it('fails when a source is missing', () => {
    const r = checkClaims(stub({}) as DeckContext, slides(undefined, ['gone.md']));
    assert.ok(r.some((c) => !c.ok && /does not exist/.test(c.problems.join())));
  });
  it('fails when the source does not say what the claim relies on', () => {
    const r = checkClaims(stub({ 'a.md': 'nothing relevant' }) as DeckContext, slides(['41 of 42']));
    assert.equal(r.find((c) => c.claimId === 'c1')!.ok, false);
  });
  it('fails a claim that cites nothing', () => assert.equal(checkClaims(stub({ 'a.md': 'x' }) as DeckContext, slides(undefined, []))[0]!.ok, false));
  it('turns an unsupported claim into a visible placeholder instead of letting the slide present it', () => {
    const s = slides(['absent']);
    const out = applyFailures(s, checkClaims(stub({ 'a.md': 'x' }) as DeckContext, s));
    assert.equal(out[0]!.placeholders.length, 1);
    assert.match(out[0]!.placeholders[0]!.why, /absent/);
  });
});

describe('the deck content at HEAD', () => {
  let slides: Slide[];
  before(() => {
    slides = buildSlides(ctx);
  });
  it('covers the requested structure: executive story, technical defence and appendix', () => {
    assert.ok(slides.length >= 36);
    for (const t of ['executive', 'technical', 'appendix'] as const) assert.ok(slides.filter((s) => s.tier === t).length >= 10, t);
    assert.deepEqual(new Set(slides.map((s) => s.id)).size, slides.length, 'ids are unique');
  });
  it('every claim is supported by a committed source', () => {
    const bad = checkClaims(ctx, slides).filter((c) => !c.ok);
    assert.deepEqual(bad.map((b) => `${b.claimId}: ${b.problems.join(' ')}`), []);
  });
  it('every slide has speaker notes, sources, timing and a rubric mapping', () => {
    for (const s of slides) {
      assert.ok(s.notes.say.split(/\s+/).length >= (s.tier === 'appendix' ? 20 : 35), `${s.id} notes`);
      assert.ok(s.sources.length > 0, `${s.id} sources`);
      assert.ok(s.seconds > 0, `${s.id} seconds`);
      assert.ok(s.rubric.length > 0, `${s.id} rubric`);
    }
  });
  it('shows decisions with the register status, and none of the target-architecture ADRs as approved', () => {
    const shown = new Set(slides.flatMap((s) => s.decisions));
    for (const id of ['ADR-0016', 'ADR-0017', 'ADR-0018', 'ADR-0019']) {
      assert.ok(shown.has(id), id);
      assert.notEqual(ctx.decisions.find((d) => d.id === id)?.status, 'Approved');
    }
  });
  it('replaces missing evidence with placeholders and never with a figure', () => {
    const ph = slides.flatMap((s) => s.placeholders.map((p) => p.id));
    for (const id of ['PH-PERF', 'PH-DR', 'PH-OBS', 'PH-VOLUME', 'PH-TIME', 'PH-REHEARSAL']) assert.ok(ph.includes(id), id);
    const perf = slides.find((s) => s.id === 'T07')!;
    assert.equal(perf.visual.kind, 'review');
    assert.ok(!/\d+\s?(ms|req\/s|rps)/i.test(JSON.stringify(perf.visual)), 'no invented performance figure');
  });
  it('takes every number on the cost, value and evaluation slides from the sources', () => {
    const f = ctx.facts;
    const text = JSON.stringify(['E03', 'E04', 'E12', 'E13'].map((id) => slides.find((s) => s.id === id)!.visual));
    assert.ok(text.includes(String(f.eval.passed)) && text.includes(String(f.eval.cases)));
    assert.ok(text.includes(Math.round(f.certToday).toLocaleString('en-US')));
  });
  it('labels every charted or large figure with an evidence class', () => {
    for (const s of slides) if (s.visual.kind === 'bars' || s.visual.kind === 'stats') for (const i of s.visual.items) assert.ok(i.chip, `${s.id}: ${i.label}`);
  });
});

describe('alternative visuals and edits', () => {
  it('offers only conversions that keep every item', () => {
    const bars: Visual = { kind: 'bars', title: 't', items: [{ label: 'a', value: 1, text: '1', chip: 'SCENARIO' }, { label: 'b', value: 2, text: '2', chip: 'SCENARIO' }] };
    assert.deepEqual(variantsOf(bars), ['bars', 'stats', 'table']);
    const t = asVariant(bars, 'table');
    assert.equal(t.kind === 'table' && t.rows.length, 2);
    assert.equal(asVariant(bars, 'matrix' as never), bars, 'an unsupported variant changes nothing');
    assert.deepEqual(variantsOf({ kind: 'cells' }), ['cells']);
  });
  it('applies a title and a visual, and the content hash follows both and the source hashes', () => {
    const s = slide({ visual: { kind: 'bars', title: 't', items: [{ label: 'a', value: 1, text: '1', chip: 'SCENARIO' }] } });
    const base = contentHash(s, { 'a.md': '1' });
    const st = { ...emptyDeckState().slides, X01: { ...{ status: 'draft' as const, decidedHash: null, decidedBy: null, reason: null, events: [] }, titleOverride: 'New title', visualKind: 'table' as const } };
    const e = effective(s, st.X01);
    assert.equal(e.title, 'New title');
    assert.equal(e.visual.kind, 'table');
    assert.notEqual(contentHash(e, { 'a.md': '1' }), base);
    assert.notEqual(contentHash(s, { 'a.md': '2' }), base, 'changed evidence changes the hash');
    assert.equal(contentHash(s, { 'a.md': '1' }), base, 'and the hash is stable');
  });
});

describe('review decisions on slides', () => {
  const facts = (hash = 'h1', placeholders = 0): Map<string, SlideFacts> => new Map([['X01', { id: 'X01', contentHash: hash, placeholders, visual: { kind: 'bars', title: 't', items: [{ label: 'a', value: 1, chip: 'SCENARIO' }] } }]]);
  const run = (s: ReturnType<typeof emptyDeckState>, a: DeckAction, f = facts(), actor = 'person') => applyAction(s, a, f, actor, new Date('2026-10-30T10:00:00Z'), () => 'h2');
  const code = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      return (e as DeckError).code;
    }
    return null;
  };

  it('approves at the hash the person saw, and records who', () => {
    const s = emptyDeckState();
    run(s, { action: 'approve', slideId: 'X01', contentHash: 'h1' });
    assert.equal(statusOf(s.slides.X01, 'h1'), 'approved');
    assert.equal(s.slides.X01!.decidedBy, 'person');
    assert.equal(s.slides.X01!.events[0]!.actor, 'person');
  });
  it('refuses an approval given to content that has since changed', () => {
    assert.equal(code(() => run(emptyDeckState(), { action: 'approve', slideId: 'X01', contentHash: 'old' })), 'stale');
  });
  it('shows an earlier approval as out of date once the slide changes, and it does not count', () => {
    const s = emptyDeckState();
    run(s, { action: 'approve', slideId: 'X01', contentHash: 'h1' });
    assert.equal(statusOf(s.slides.X01, 'h2'), 'stale-approved');
  });
  it('editing a slide withdraws its approval', () => {
    const s = emptyDeckState();
    run(s, { action: 'approve', slideId: 'X01', contentHash: 'h1' });
    run(s, { action: 'retitle', slideId: 'X01', title: 'A better title' });
    assert.equal(s.slides.X01!.status, 'draft');
    assert.equal(s.slides.X01!.titleOverride, 'A better title');
  });
  it('requires a reason to reject', () => {
    assert.equal(code(() => run(emptyDeckState(), { action: 'reject', slideId: 'X01', contentHash: 'h1', reason: '' })), 'reason-required');
    const s = emptyDeckState();
    run(s, { action: 'reject', slideId: 'X01', contentHash: 'h1', reason: 'Wrong figure' });
    assert.equal(statusOf(s.slides.X01, 'h1'), 'rejected');
  });
  it('approving a slide that shows a placeholder needs a written acknowledgement', () => {
    assert.equal(code(() => run(emptyDeckState(), { action: 'approve', slideId: 'X01', contentHash: 'h1' }, facts('h1', 1))), 'acknowledge-placeholder');
    const s = emptyDeckState();
    run(s, { action: 'approve', slideId: 'X01', contentHash: 'h1', reason: 'Present as a stated gap' }, facts('h1', 1));
    assert.equal(s.slides.X01!.reason, 'Present as a stated gap');
  });
  it('refuses an unknown slide, an unusable title, a lossy visual, and an unnamed actor', () => {
    assert.equal(code(() => run(emptyDeckState(), { action: 'reset', slideId: 'NOPE' })), 'unknown-slide');
    assert.equal(code(() => run(emptyDeckState(), { action: 'retitle', slideId: 'X01', title: ' x ' })), 'bad-title');
    assert.equal(code(() => run(emptyDeckState(), { action: 'choose-visual', slideId: 'X01', visual: 'matrix' })), 'bad-visual');
    assert.equal(code(() => run(emptyDeckState(), { action: 'reset', slideId: 'X01' }, facts(), ' ')), 'no-actor');
  });
  it('strips control characters from a title and bounds its length', () => {
    const s = emptyDeckState();
    run(s, { action: 'retitle', slideId: 'X01', title: `Line\none\u0007 ${'x'.repeat(400)}` });
    assert.ok(!/[\u0000-\u001f]/.test(s.slides.X01!.titleOverride!));
    assert.ok(s.slides.X01!.titleOverride!.length <= 160);
  });
  it('regenerate discards edits and the decision', () => {
    const s = emptyDeckState();
    run(s, { action: 'retitle', slideId: 'X01', title: 'Edited' });
    run(s, { action: 'regenerate', slideId: 'X01' });
    assert.equal(s.slides.X01!.titleOverride, null);
    assert.equal(s.slides.X01!.events.at(-1)!.action, 'regenerate');
  });
  it('the store refuses a change made against an old revision, so two people cannot overwrite each other', () => {
    const store = new DeckStore(path.join(tmp(), 'state.json'));
    store.mutate(0, (s) => run(s, { action: 'reset', slideId: 'X01' }));
    assert.equal(store.read().revision, 1);
    assert.equal(code(() => store.mutate(0, (s) => run(s, { action: 'reset', slideId: 'X01' }))), 'conflict');
    assert.equal(store.read().revision, 1);
  });
  it('an unreadable or foreign state file is treated as empty, not trusted', () => {
    const f = path.join(tmp(), 'state.json');
    fs.writeFileSync(f, '{"version":2,"slides":{"X01":{"status":"approved"}}}');
    assert.deepEqual(new DeckStore(f).read(), emptyDeckState());
    fs.writeFileSync(f, 'not json');
    assert.deepEqual(new DeckStore(f).read(), emptyDeckState());
  });
});

describe('the gate for a final deck', () => {
  const baseInput = () => {
    const slides = [slide({ decisions: ['ADR-1'] })];
    return {
      ctx: { baselines: [{ id: 'BL-0001', status: 'approved', currentness: 'current' }], decisions: [{ id: 'ADR-1', status: 'Approved' }], uncommitted: 0, commit: 'abcdef1234' } as unknown as DeckContext,
      slides,
      statuses: new Map([['X01', 'approved' as const]]),
      claimChecks: [{ claimId: 'c', slideId: 'X01', ok: true, problems: [] }],
      qa: [],
      rendered: true,
      rehearsal: { rehearsed: 0, total: 10 },
    };
  };
  it('is open only when every blocking item is met', () => assert.equal(deckGate(baseInput()).finalAllowed, true));
  const flips: [string, (i: ReturnType<typeof baseInput>) => void][] = [
    ['baseline', (i) => ((i.ctx as { baselines: unknown[] }).baselines = [])],
    ['decisions', (i) => ((i.ctx as { decisions: { status: string }[] }).decisions[0]!.status = 'Blocked')],
    ['claims', (i) => (i.claimChecks[0]!.ok = false)],
    ['slides', (i) => i.statuses.set('X01', 'stale-approved' as never)],
    ['qa', (i) => ((i as { rendered: boolean }).rendered = false)],
    ['clean-tree', (i) => ((i.ctx as { uncommitted: number }).uncommitted = 2)],
  ];
  for (const [id, mutate] of flips)
    it(`is closed when "${id}" is not met`, () => {
      const i = baseInput();
      mutate(i);
      const g = deckGate(i);
      assert.equal(g.finalAllowed, false);
      assert.equal(g.items.find((x) => x.id === id)!.met, false);
    });
  it('a draft or rejected slide does not count as approved', () => {
    for (const st of ['draft', 'rejected'] as const) {
      const i = baseInput();
      i.statuses.set('X01', st as never);
      assert.equal(deckGate(i).finalAllowed, false);
    }
  });
  it('rehearsal and placeholders are reported but do not block', () => {
    const i = baseInput();
    i.slides[0]!.placeholders = [{ id: 'P', what: 'w', why: 'y', neededFrom: 'n' }];
    const g = deckGate(i);
    assert.equal(g.finalAllowed, true);
    assert.equal(g.items.find((x) => x.id === 'placeholders')!.met, false);
  });
  it('reads the rehearsal scorecard: NOT REHEARSED never counts', () => {
    assert.deepEqual(rehearsalOf('- **Status:** NOT REHEARSED. a\n- **Status:** Rehearsed by A on 1 Nov\n- other'), { rehearsed: 1, total: 2 });
  });
  it('on this repository the gate is closed, and says why', () => {
    const prep = prepare(ctx, emptyDeckState());
    const g = deckGate({ ctx, slides: prep.effective, statuses: prep.statuses, claimChecks: prep.claimChecks, qa: null, rendered: false, rehearsal: rehearsalOf(ctx.read('docs/capstone/presentation/REHEARSAL-PLAN-AND-SCORECARD.md')) });
    assert.equal(g.finalAllowed, false);
    for (const id of ['baseline', 'decisions', 'slides', 'qa']) assert.equal(g.items.find((x) => x.id === id)!.met, false, id);
    assert.equal(g.items.find((x) => x.id === 'rehearsal')!.met, false);
  });
});

describe('assets need a source, a licence, an approver and a matching hash', () => {
  const world = (mut: (e: Record<string, unknown>, dir: string) => void = () => {}) => {
    const dir = tmp();
    const file = path.join(dir, 'p.png');
    fs.writeFileSync(file, 'PNGDATA');
    const e: Record<string, unknown> = { id: 'hero', kind: 'photo', file: 'p.png', title: 'Tanker', creator: 'A. Photographer', source: 'https://example.invalid/p', licence: 'Licensed, invoice 1', sha256: crypto.createHash('sha256').update('PNGDATA').digest('hex'), approved: true, approvedBy: 'A. Owner', approvedAt: '2026-10-30' };
    mut(e, dir);
    return new Assets(dir, { version: 1, assets: [e as never] });
  };
  it('uses an approved, licensed, hash-matching asset', () => assert.ok(world().resolve('hero', 'photo')));
  it('falls back when there is no entry', () => assert.equal(new Assets(tmp(), { version: 1, assets: [] }).resolve('hero', 'photo'), null));
  for (const [name, mut] of [
    ['it is not approved', (e: Record<string, unknown>) => (e.approved = false)],
    ['no person approved it', (e: Record<string, unknown>) => delete e.approvedBy],
    ['the licence is not recorded', (e: Record<string, unknown>) => (e.licence = '')],
    ['the source is not recorded', (e: Record<string, unknown>) => (e.source = '')],
    ['the file was changed after approval', (e: Record<string, unknown>, d: string) => fs.writeFileSync(path.join(d, 'p.png'), 'TAMPERED')],
    ['the file is outside the assets folder', (e: Record<string, unknown>) => (e.file = '../../etc/passwd')],
    ['the file is missing', (e: Record<string, unknown>, d: string) => fs.rmSync(path.join(d, 'p.png'))],
  ] as [string, (e: Record<string, unknown>, d: string) => void][])
    it(`falls back when ${name}`, () => {
      const a = world(mut);
      assert.equal(a.resolve('hero', 'photo'), null);
      assert.equal(a.report[0]!.outcome, 'fallback');
    });
  it('the repository ships no photograph and no Azure icon: nothing is assumed to be licensed', () => {
    const m = Assets.load(path.join(appDir, 'deck-assets'));
    assert.deepEqual(m.assets, []);
  });
});

describe('quality checks catch what they claim to', () => {
  const li = (o: Record<string, unknown>) => ({ slide: 'X01', name: 'n', kind: 'text', role: 'body', x: 1, y: 3, w: 3, h: 1, fontSize: 14, ...o }) as never;
  const rules = (ledger: unknown[], s = [slide()]) => staticChecks(s, ledger as never, []).filter((f) => f.severity === 'error').map((f) => f.rule);
  it('flags overlapping text', () => assert.ok(rules([li({ name: 'a' }), li({ name: 'b', y: 3.5 })]).includes('overlap')));
  it('does not flag text on a backing shape', () => assert.ok(!rules([li({ kind: 'shape', backing: true, role: 'card' }), li({ name: 'b' })]).includes('overlap')));
  it('flags text below the minimum size', () => assert.ok(rules([li({ fontSize: 9 })]).includes('min-font')));
  it('flags content outside the margins and outside the slide', () => {
    assert.ok(rules([li({ x: 0.1 })]).includes('margin'));
    assert.ok(rules([li({ y: 7.4, h: 0.5 })]).includes('bounds'));
  });
  it('flags a slide made of one big picture', () => assert.ok(rules([li({ kind: 'image', x: 0, y: 0, w: 13, h: 7.4 })], [slide({ visual: { kind: 'hero', sub: 's' } })]).includes('flattened')));
  it('flags missing notes, missing sources and an uncharted evidence class', () => {
    const r = staticChecks([slide({ notes: { say: 'too short' }, sources: [], visual: { kind: 'stats', items: [{ label: 'x', text: '1' }] } })], [], []).map((f) => f.rule);
    for (const x of ['notes', 'sources', 'evidence-class']) assert.ok(r.includes(x), x);
  });
  it('flags a dense slide, and allows more words in the appendix', () => {
    const long: Visual = { kind: 'table', head: ['a'], rows: Array.from({ length: 40 }, () => ['w '.repeat(5)]) };
    assert.ok(visibleWords(slide({ visual: long })) > 190);
    assert.ok(rules([], [slide({ visual: long })]).includes('density'));
    assert.ok(!rules([], [slide({ visual: long, tier: 'appendix' })]).includes('density'));
  });
  it('flags an unsupported claim', () => assert.ok(staticChecks([slide()], [], [{ claimId: 'c', slideId: 'X01', ok: false, problems: ['p'] }]).some((f) => f.rule === 'claim' && f.severity === 'error')));
  it('flags a deck that was not rendered, and summarizes', () => {
    assert.equal(renderedChecks([slide()], null, [])[0]!.rule, 'not-rendered');
    assert.deepEqual(summarize([{ slide: 'a', severity: 'error', rule: 'r', message: 'm' }, { slide: 'a', severity: 'info', rule: 'r', message: 'm' }]), { errors: 1, warnings: 0, info: 1 });
  });
});

describe('the sample deck, built from this repository', () => {
  let out: string;
  let rec: Record<string, any>;
  before(async () => {
    out = tmp();
    const r = await generate(ctx, { mode: 'sample', outDir: out, render: false, assetsDir: path.join(appDir, 'deck-assets'), state: emptyDeckState() });
    rec = JSON.parse(fs.readFileSync(path.join(r.dir, 'generation.json'), 'utf8'));
  });

  it('is editable: native slides, notes, charts and tables; no pictures; live text', async () => {
    const dir = path.join(out, fs.readdirSync(out)[0]!);
    const ins = await inspectPptx(fs.readFileSync(path.join(dir, 'deck.pptx')));
    assert.equal(ins.slides, rec.slides.length);
    assert.equal(ins.notesSlides, ins.slides, 'every slide has speaker notes');
    assert.ok(ins.charts >= 4, `${ins.charts} native charts`);
    assert.ok(ins.perSlide.reduce((n, s) => n + s.tables, 0) >= 10, 'native tables');
    assert.deepEqual(ins.media, [], 'nothing is flattened to a picture');
    for (const s of ins.perSlide) assert.ok(s.textRuns >= 3, `slide ${s.index} has live text`);
    assert.match(ins.coreSubject ?? '', new RegExp(ctx.commit));
  });
  it('is marked as a sample and records the commit, the sources with hashes, the gate and the outputs', () => {
    assert.equal(rec.mode, 'sample');
    assert.match(rec.honesty, /SAMPLE/);
    assert.equal(rec.git.commit, ctx.commit);
    assert.equal(rec.schema, 'greenfuel.deck-generation/v1');
    const src = rec.sources.find((s: { path: string }) => s.path === 'PROBLEMSTATEMENT.md');
    const raw = spawnSync('git', ['show', `${ctx.commit}:PROBLEMSTATEMENT.md`], { cwd: repo }).stdout;
    assert.equal(src.sha256, crypto.createHash('sha256').update(raw).digest('hex'), 'the recorded hash is the hash of the file at the commit');
    assert.equal(rec.gate.find((g: { id: string }) => g.id === 'baseline').met, false);
    assert.equal(rec.outputs.pptx.sha256.length, 64);
    assert.equal(rec.render.performed, false);
  });
  it('records every slide with its content hash, review state and claim results', () => {
    for (const s of rec.slides) {
      assert.equal(s.contentHash.length, 64);
      assert.equal(s.review, 'draft');
      assert.ok(s.claims.every((c: { ok: boolean }) => c.ok), s.id);
    }
    assert.deepEqual(rec.decisions.filter((d: { id: string; status: string }) => d.id === 'ADR-0016').map((d: { status: string }) => d.status), [ctx.decisions.find((d) => d.id === 'ADR-0016')!.status]);
  });
  it('a final deck is refused, with the reasons, and leaves nothing behind', async () => {
    const dir = tmp();
    await assert.rejects(generate(ctx, { mode: 'final', outDir: dir, render: false, assetsDir: path.join(appDir, 'deck-assets'), state: emptyDeckState() }), (e: DeckError) => e.code === 'gate-blocked' && /approved/.test(e.message));
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});

describe('rendering and measurement with Microsoft PowerPoint', { skip: !powerpointAvailable() && 'Microsoft PowerPoint is not installed here' }, () => {
  it('renders the whole sample deck: PDF, one image per slide, and no layout error measured by PowerPoint', async () => {
    const out = tmp();
    const r = await generate(ctx, { mode: 'sample', outDir: out, render: true, assetsDir: path.join(appDir, 'deck-assets'), state: emptyDeckState() });
    assert.equal(r.rendered, true);
    assert.deepEqual(r.findings.filter((f) => f.severity === 'error').map((f) => `${f.slide} ${f.rule}: ${f.message}`), []);
    assert.equal(fs.readFileSync(path.join(r.dir, 'render', 'deck.pdf')).subarray(0, 4).toString(), '%PDF');
    const rec = JSON.parse(fs.readFileSync(path.join(r.dir, 'generation.json'), 'utf8'));
    assert.equal(r.previews, rec.slides.length);
    assert.equal(r.gate.items.find((g) => g.id === 'qa')!.met, true);
  });

  it('the detector is real: text that does not fit its box is reported as overflow', async () => {
    const dir = tmp();
    const p = new PptxGenJS();
    p.layout = 'LAYOUT_WIDE';
    const s = p.addSlide();
    s.addText('Overflowing text. '.repeat(40), { x: 1, y: 1, w: 3, h: 0.5, fontSize: 18, margin: 0, objectName: 'X01:body:1' } as never);
    s.addNotes('A note long enough to count as present in the saved file, for the check.');
    const file = path.join(dir, 't.pptx');
    fs.writeFileSync(file, (await p.write({ outputType: 'nodebuffer' })) as Buffer);
    const r = await renderDeck(file, path.join(dir, 'out'));
    const f = renderedChecks([slide({ id: 'X01' })], r.layout, r.pngs.map((x) => fs.statSync(x).size));
    assert.ok(f.some((x) => x.rule === 'overflow' && x.severity === 'error'), JSON.stringify(f.map((x) => x.rule)));
  });
});
