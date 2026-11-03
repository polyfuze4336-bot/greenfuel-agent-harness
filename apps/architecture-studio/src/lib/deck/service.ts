// The pipeline, end to end: read the repository at a commit, check claims, apply a person's edits, build the PowerPoint, render and measure
// it, check quality, evaluate the gate, and write the audit record. A final deck is refused, with the reasons, until the gate is met.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Assets, type AssetReport } from './assets.ts';
import { applyFailures, checkClaims } from './claims.ts';
import { buildSlides } from './content.ts';
import { openDeckContext, type ContextOptions, type DeckContext, type UsedSource } from './context.ts';
import { GENERATOR, buildPptx } from './build.ts';
import { deckGate, rehearsalOf, type DeckGate } from './gate.ts';
import { refineLedger, renderedChecks, rubricChecks, staticChecks, summarize, type Finding } from './qa.ts';
import { powerpointAvailable, renderDeck } from './render.ts';
import { changedDecisions, contentHash, effective, inOrder, variantsOf, type DecisionChange } from './slides.ts';
import { DeckError, emptyDeckState, statusOf, type EffectiveStatus } from './store.ts';
import type { ClaimCheck, DeckState, Slide, Visual, VisualKind } from './types.ts';

export const GENERATION_SCHEMA = 'greenfuel.deck-generation/v1';
export type DeckMode = 'sample' | 'final';

const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');

/** The slide that records, on the deck itself, which commit and evidence it was made from. Its content depends only on the commit and the sources, so an approval of it stays valid until they change. */
function provenanceSlide(ctx: DeckContext, claimChecks: ClaimCheck[], slideCount: number): Slide {
  const used = ctx.used();
  const digest = sha256(used.map((u) => `${u.path}:${u.sha256}`).join('\n')).slice(0, 16);
  return {
    id: 'A13', tier: 'appendix', section: 'Provenance', title: 'This deck was generated from one commit and a recorded set of sources',
    message: 'A slide is only as good as the evidence it cites. The generation record beside the file lists every source with its hash.',
    visual: {
      kind: 'table', head: ['Item', 'Value'], widths: [4, 8], rows: [
        ['Repository commit', ctx.commit],
        ['Branch', ctx.branch ?? 'detached'],
        ['Slides', String(slideCount)],
        ['Sources read', `${used.length} files, digest ${digest}`],
        ['Claims checked', `${claimChecks.length} on the other slides; ${claimChecks.filter((c) => !c.ok).length} unsupported`],
        ['Rubric', 'derived traceability; the official PDF is not in the repository'],
      ],
    },
    claims: [{ id: 'A13-c1', text: 'The generation record names the sources it used.', sources: ['docs/capstone/RUBRIC-TRACEABILITY.md'], contains: ['No official score is assigned'] }],
    sources: [{ path: 'docs/capstone/RUBRIC-TRACEABILITY.md', chip: 'DESIGN' }],
    decisions: [], placeholders: [],
    notes: { say: 'The deck records the commit and the evidence it was generated from. If any cited source changes, the slides that rely on it change, and any approval given to the old content no longer applies.', honesty: 'The official rubric file is not in the repository; the deck uses the derived traceability.' },
    seconds: 15, rubric: ['B6'],
  };
}

export interface Prepared {
  ctx: DeckContext;
  generated: Slide[];
  effective: Slide[];
  hashes: Record<string, string>;
  statuses: Map<string, EffectiveStatus>;
  claimChecks: ClaimCheck[];
  sourceHashes: Record<string, string>;
  /** The register's status for every decision any slide leans on, as of this commit. */
  decisionStatus: Record<string, string>;
  /** The sources read to produce these slides, fixed once preparation ends, so the record and the provenance slide agree. */
  used: UsedSource[];
}

/** Everything that can be known without building the file: the slides, their hashes, their review status and their claim checks. */
export function prepare(ctx: DeckContext, state: DeckState): Prepared {
  ctx.read('docs/capstone/presentation/REHEARSAL-PLAN-AND-SCORECARD.md');
  const gen0 = buildSlides(ctx);
  let checks = checkClaims(ctx, gen0);
  const gen1 = applyFailures(gen0, checks);
  const prov = provenanceSlide(ctx, checks, gen1.length + 1);
  // The person's order applies to both lists, so `generated[i]` and `effective[i]` are always the same slide.
  const generated = inOrder([...gen1, prov], state.order);
  checks = [...checks, ...checkClaims(ctx, [prov])];
  const sourceHashes = Object.fromEntries(ctx.used().map((u) => [u.path, u.sha256]));
  const decisionStatus = Object.fromEntries([...new Set(generated.flatMap((s) => s.decisions))].map((d) => [d, ctx.decisions.find((x) => x.id === d)?.status ?? 'not in register']));
  const eff = generated.map((s) => effective(s, state.slides[s.id]));
  const hashes = Object.fromEntries(eff.map((s) => [s.id, contentHash(s, sourceHashes, decisionStatus)]));
  const statuses = new Map(eff.map((s) => [s.id, statusOf(state.slides[s.id], hashes[s.id]!)]));
  return { ctx, generated, effective: eff, hashes, statuses, claimChecks: checks, sourceHashes, decisionStatus, used: ctx.used() };
}

export interface BuildOutput {
  id: string;
  mode: DeckMode;
  dir: string;
  generatedAt: string;
  commit: string;
  pptx: { file: string; sha256: string; bytes: number };
  pdf: { file: string; sha256: string; bytes: number } | null;
  previews: number;
  rendered: boolean;
  qa: { errors: number; warnings: number; info: number };
  gate: DeckGate;
  findings: Finding[];
}

export interface GenerateOptions {
  mode: DeckMode;
  outDir: string;
  /** Render with PowerPoint (PDF, previews, measurement). Default true when PowerPoint is installed. */
  render?: boolean;
  assetsDir: string;
  state: DeckState;
  title?: string;
}

export async function generate(ctx: DeckContext, o: GenerateOptions): Promise<BuildOutput> {
  const prep = prepare(ctx, o.state);
  const assets = new Assets(o.assetsDir);
  const generatedAt = new Date().toISOString();
  const id = `deck-${ctx.commit.slice(0, 7)}-${generatedAt.replace(/[-:]/g, '').slice(0, 15)}`;
  const stage = path.join(o.outDir, `${id}.staging`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  try {
    const built = await buildPptx({ ctx, slides: prep.effective, mode: o.mode, assets, title: o.title ?? 'Green-Fuel Bunkering Certification Platform: capstone defence', generatedAt });
    const pptxFile = path.join(stage, 'deck.pptx');
    fs.writeFileSync(pptxFile, built.buffer);

    const want = o.render ?? powerpointAvailable();
    let findings: Finding[] = [];
    let rendered = false;
    let pdf: BuildOutput['pdf'] = null;
    let previews = 0;
    let ledger = built.ledger;
    if (want) {
      const r = await renderDeck(pptxFile, path.join(stage, 'render'));
      rendered = true;
      previews = r.pngs.length;
      ledger = refineLedger(built.ledger, prep.effective.map((s) => s.id), r.layout);
      findings = renderedChecks(prep.effective, r.layout, r.pngs.map((p) => fs.statSync(p).size));
      const pdfBytes = fs.readFileSync(r.pdf);
      pdf = { file: 'render/deck.pdf', sha256: sha256(pdfBytes), bytes: pdfBytes.length };
    } else findings = renderedChecks(prep.effective, null, []);
    findings = [...staticChecks(prep.effective, ledger, prep.claimChecks), ...findings, ...rubricChecks(prep.effective, ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7'])];

    const gate = deckGate({ ctx, slides: prep.effective, statuses: prep.statuses, claimChecks: prep.claimChecks, qa: findings, rendered, rehearsal: rehearsalOf(ctx.read('docs/capstone/presentation/REHEARSAL-PLAN-AND-SCORECARD.md')) });
    if (o.mode === 'final' && !gate.finalAllowed) {
      throw new DeckError('gate-blocked', 422, `A final deck is refused: ${gate.items.filter((x) => x.blocking && !x.met).map((x) => x.title).join('; ')}.`);
    }

    const qa = summarize(findings);
    const record = {
      schema: GENERATION_SCHEMA,
      id, mode: o.mode, generatedAt, generator: GENERATOR,
      git: { commit: ctx.commit, branch: ctx.branch, uncommittedTrackedFiles: ctx.uncommitted },
      baseline: { authorized: ctx.baselines.filter((b) => b.status === 'approved').map((b) => ({ id: b.id, version: b.version, currentness: b.currentness, commit: b.commit })), policyGates: ctx.gates.map((g) => ({ area: g.area, state: g.state })), signatures: ctx.signatures },
      rubric: { source: 'docs/capstone/RUBRIC-TRACEABILITY.md (derived from the official guide)', officialFileInRepository: false, criteria: ctx.rubric.length },
      decisions: [...new Set(prep.effective.flatMap((s) => s.decisions))].map((d) => ({ id: d, status: ctx.decisions.find((x) => x.id === d)?.status ?? 'not in register' })),
      sources: prep.used,
      slides: prep.effective.map((s) => ({ id: s.id, tier: s.tier, title: s.title, visual: s.visual.kind, contentHash: prep.hashes[s.id], review: prep.statuses.get(s.id), decidedBy: o.state.slides[s.id]?.decidedBy ?? null, placeholders: s.placeholders.map((p) => p.id), claims: s.claims.map((c) => ({ id: c.id, ok: prep.claimChecks.find((k) => k.claimId === c.id)?.ok ?? false })), seconds: s.seconds })),
      claims: { checked: prep.claimChecks.length, unsupported: prep.claimChecks.filter((c) => !c.ok).length },
      reviewStateRevision: o.state.revision,
      order: o.state.order ?? null,
      assets: assets.report as AssetReport[],
      outputs: { pptx: { file: 'deck.pptx', sha256: sha256(built.buffer), bytes: built.buffer.length }, pdf },
      render: { performed: rendered, tool: rendered ? 'Microsoft PowerPoint (COM automation)' : null, slidePreviews: previews },
      qa, gate: gate.items,
      honesty: o.mode === 'sample' ? 'SAMPLE. Not approved for presentation. The gate result above says what is missing.' : 'Final: every blocking gate item was met when this file was generated.',
    };
    fs.writeFileSync(path.join(stage, 'generation.json'), JSON.stringify(record, null, 2));
    fs.writeFileSync(path.join(stage, 'qa.json'), JSON.stringify({ summary: qa, findings }, null, 2));
    const dir = path.join(o.outDir, id);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(stage, dir);
    return { id, mode: o.mode, dir, generatedAt, commit: ctx.commit, pptx: record.outputs.pptx, pdf, previews, rendered, qa, gate, findings };
  } catch (e) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw e;
  }
}

export interface SlideView {
  id: string;
  tier: Slide['tier'];
  section: string;
  title: string;
  generatedTitle: string;
  message: string;
  visualKind: VisualKind;
  generatedVisualKind: VisualKind;
  variants: VisualKind[];
  visual: Visual;
  notes: Slide['notes'];
  seconds: number;
  rubric: string[];
  sources: Slide['sources'];
  claims: { id: string; text: string; sources: string[]; ok: boolean; problems: string[] }[];
  decisions: { id: string; status: string }[];
  placeholders: Slide['placeholders'];
  contentHash: string;
  status: EffectiveStatus;
  decidedBy: string | null;
  reason: string | null;
  edited: boolean;
  /** The speaker script is a person's, not the generated one. It is not claim-checked. */
  notesEdited: boolean;
  /** Decisions this slide leans on whose status differs from the one it was reviewed against. A reason the review is stale, named. */
  changedDecisions: DecisionChange[];
  events: DeckState['slides'][string]['events'];
}

export interface DeckModel {
  commit: string;
  branch: string | null;
  uncommitted: number;
  generatedAt: string;
  revision: number;
  /** A person has moved slides, so the order differs from the generated one. */
  reordered: boolean;
  slides: SlideView[];
  totals: { slides: number; approved: number; rejected: number; draft: number; stale: number; placeholders: number; unsupportedClaims: number; secondsByTier: Record<string, number> };
  rubricCoverage: { id: string; title: string; mode: string; slides: string[] }[];
  gate: DeckGate;
  powerpoint: boolean;
}

export function viewOf(prep: Prepared, state: DeckState, qa: Finding[] | null, rendered: boolean): DeckModel {
  const { ctx } = prep;
  const slides: SlideView[] = prep.effective.map((s, i) => {
    const g = prep.generated[i]!;
    const st = state.slides[s.id];
    return {
      id: s.id, tier: s.tier, section: s.section, title: s.title, generatedTitle: g.title, message: s.message,
      visualKind: s.visual.kind, generatedVisualKind: g.visual.kind, variants: variantsOf(g.visual), visual: s.visual,
      notes: s.notes, seconds: s.seconds, rubric: s.rubric, sources: s.sources,
      claims: s.claims.map((c) => { const k = prep.claimChecks.find((x) => x.claimId === c.id); return { id: c.id, text: c.text, sources: c.sources, ok: k?.ok ?? false, problems: k?.problems ?? [] }; }),
      decisions: s.decisions.map((d) => ({ id: d, status: ctx.decisions.find((x) => x.id === d)?.status ?? 'not in register' })),
      placeholders: s.placeholders, contentHash: prep.hashes[s.id]!, status: prep.statuses.get(s.id)!,
      decidedBy: st?.decidedBy ?? null, reason: st?.reason ?? null, edited: !!(st?.titleOverride || st?.visualKind || st?.notesOverride), notesEdited: !!st?.notesOverride,
      changedDecisions: /^stale/.test(prep.statuses.get(s.id)!) ? changedDecisions(st, prep.decisionStatus) : [], events: st?.events ?? [],
    };
  });
  const by = (f: (s: SlideView) => boolean) => slides.filter(f).length;
  const tiers: Record<string, number> = {};
  for (const s of slides) tiers[s.tier] = (tiers[s.tier] ?? 0) + s.seconds;
  return {
    commit: ctx.commit, branch: ctx.branch, uncommitted: ctx.uncommitted, generatedAt: ctx.generatedAt, revision: state.revision, reordered: !!state.order?.length, slides,
    totals: { slides: slides.length, approved: by((s) => s.status === 'approved'), rejected: by((s) => s.status === 'rejected'), draft: by((s) => s.status === 'draft'), stale: by((s) => /^stale/.test(s.status)), placeholders: slides.reduce((n, s) => n + s.placeholders.length, 0), unsupportedClaims: prep.claimChecks.filter((c) => !c.ok).length, secondsByTier: tiers },
    rubricCoverage: ctx.rubric.filter((r) => /^[BC]/.test(r.id)).map((r) => ({ id: r.id, title: r.title, mode: r.mode, slides: slides.filter((s) => s.rubric.includes(r.id)).map((s) => s.id) })),
    gate: deckGate({ ctx, slides: prep.effective, statuses: prep.statuses, claimChecks: prep.claimChecks, qa, rendered, rehearsal: rehearsalOf(ctx.read('docs/capstone/presentation/REHEARSAL-PLAN-AND-SCORECARD.md')) }),
    powerpoint: powerpointAvailable(),
  };
}

export { emptyDeckState, openDeckContext };
export type { ContextOptions };
