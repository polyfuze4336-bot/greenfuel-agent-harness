#!/usr/bin/env node
// The Presentation Studio's pipeline on the command line. Reads the repository at a commit and builds an editable PowerPoint with speaker
// notes, source references and an audit record.
//
//   node apps/architecture-studio/scripts/deck.ts outline [--ref HEAD]
//   node apps/architecture-studio/scripts/deck.ts check   [--ref HEAD]                      claims, quality of the content, and the gate
//   node apps/architecture-studio/scripts/deck.ts build   [--mode sample|final] [--out DIR] [--no-render] [--state FILE|none]
//   node apps/architecture-studio/scripts/deck.ts verify  <deck folder>                     re-hash the outputs and inspect the file
//
// A sample deck is always buildable and is marked as a sample. A final deck is refused (exit 2) until the gate is met.
// Exit codes: 0 ok, 2 refused or not ready (with the reasons), 1 error or bad usage.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { inspectPptx } from '../src/lib/deck/inspect.ts';
import { DeckStore } from '../src/lib/deck/store.ts';
import { emptyDeckState, generate, openDeckContext, prepare, viewOf, type DeckMode } from '../src/lib/deck/service.ts';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (n: string, d = ''): string => {
  const i = argv.indexOf(`--${n}`);
  return i > 0 && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--') ? argv[i + 1]! : d;
};
const flag = (n: string) => argv.includes(`--${n}`);

const appDir = path.resolve(import.meta.dirname, '..');
const root = path.resolve(opt('root', path.resolve(appDir, '..', '..')));
const ref = opt('ref', 'HEAD');
const deckDir = process.env.STUDIO_DECK_DIR?.trim() || path.join(process.env.STUDIO_CACHE_DIR?.trim() || path.join(appDir, '.studio-cache'), 'deck');

function stateFor(): ReturnType<typeof emptyDeckState> {
  const s = opt('state', path.join(deckDir, 'state.json'));
  return s === 'none' ? emptyDeckState() : new DeckStore(s).read();
}

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const sayGate = (items: { met: boolean; blocking: boolean; id: string; detail: string; hint?: string }[]) => {
  for (const g of items) console.log(`  ${g.met ? 'met   ' : g.blocking ? 'UNMET ' : 'info  '} ${g.id.padEnd(13)} ${g.detail}${!g.met && g.hint ? ` (${g.hint})` : ''}`);
};

async function main(): Promise<number> {
  if (cmd === 'verify') {
    const dir = path.resolve(argv[1] ?? '');
    const rec = JSON.parse(fs.readFileSync(path.join(dir, 'generation.json'), 'utf8')) as { id: string; mode: string; outputs: { pptx: { file: string; sha256: string }; pdf: { file: string; sha256: string } | null }; slides: unknown[]; git: { commit: string } };
    const problems: string[] = [];
    const pptx = fs.readFileSync(path.join(dir, rec.outputs.pptx.file));
    if (sha(pptx) !== rec.outputs.pptx.sha256) problems.push('deck.pptx does not match the recorded hash');
    if (rec.outputs.pdf && sha(fs.readFileSync(path.join(dir, rec.outputs.pdf.file))) !== rec.outputs.pdf.sha256) problems.push('the PDF does not match the recorded hash');
    const ins = await inspectPptx(pptx);
    if (ins.slides !== rec.slides.length) problems.push(`the file has ${ins.slides} slides; the record lists ${rec.slides.length}`);
    if (ins.notesSlides !== ins.slides) problems.push(`${ins.slides - ins.notesSlides} slides have no speaker notes`);
    console.log(`${rec.id} (${rec.mode}) from commit ${rec.git.commit.slice(0, 7)}: ${ins.slides} slides, ${ins.notesSlides} with notes, ${ins.charts} native charts, ${ins.perSlide.reduce((n, s) => n + s.tables, 0)} native tables, ${ins.media.length} pictures.`);
    for (const p of problems) console.log(`PROBLEM: ${p}`);
    return problems.length ? 2 : 0;
  }

  const ctx = openDeckContext(root, ref, { codeRoot: root });
  const state = stateFor();

  if (cmd === 'outline') {
    const prep = prepare(ctx, state);
    for (const s of prep.effective) console.log(`${s.id.padEnd(4)} ${s.tier.padEnd(9)} ${String(s.seconds).padStart(3)}s ${s.visual.kind.padEnd(11)} ${s.title}${s.placeholders.length ? '   [REVIEW PLACEHOLDER]' : ''}`);
    return 0;
  }

  if (cmd === 'check') {
    const prep = prepare(ctx, state);
    const m = viewOf(prep, state, null, false);
    console.log(`Commit ${ctx.commit.slice(0, 7)}: ${m.totals.slides} slides, ${prep.claimChecks.length} claim checks (${m.totals.unsupportedClaims} unsupported), ${m.totals.placeholders} placeholders.`);
    for (const k of prep.claimChecks.filter((x) => !x.ok)) console.log(`  CLAIM ${k.slideId} ${k.claimId}: ${k.problems.join(' ')}`);
    console.log('Gate for a final deck (the quality item needs a rendered build):');
    sayGate(m.gate.items);
    return m.gate.finalAllowed ? 0 : 2;
  }

  if (cmd === 'build') {
    const mode = (opt('mode', 'sample') as DeckMode);
    if (mode !== 'sample' && mode !== 'final') throw new Error('--mode must be sample or final');
    const out = path.resolve(opt('out', path.join(deckDir, 'builds')));
    fs.mkdirSync(out, { recursive: true });
    try {
      const r = await generate(ctx, { mode, outDir: out, render: flag('no-render') ? false : undefined, assetsDir: path.join(appDir, 'deck-assets'), state });
      console.log(`${mode.toUpperCase()} deck ${r.id}\n  ${r.dir}\n  ${r.pptx.bytes.toLocaleString()} bytes, sha256 ${r.pptx.sha256.slice(0, 16)}; ${r.rendered ? `rendered by PowerPoint, ${r.previews} previews, PDF ${r.pdf?.bytes.toLocaleString()} bytes` : 'NOT RENDERED'}`);
      console.log(`  quality: ${r.qa.errors} errors, ${r.qa.warnings} warnings, ${r.qa.info} notes`);
      for (const f of r.findings.filter((x) => x.severity !== 'info')) console.log(`    ${f.severity.toUpperCase()} ${f.slide} ${f.rule}: ${f.message}`);
      console.log('  gate for a final deck:');
      sayGate(r.gate.items);
      return 0;
    } catch (e) {
      const err = e as { code?: string; message: string };
      if (err.code === 'gate-blocked') {
        console.log(`REFUSED: ${err.message}`);
        return 2;
      }
      throw e;
    }
  }

  console.log('Usage: deck.ts outline | check | build [--mode sample|final] [--out DIR] [--no-render] [--state FILE|none] | verify <folder>');
  return 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`ERROR: ${(e as Error).message}`);
    process.exit(1);
  },
);
