// The Studio's view of the presentation pipeline: one prepared deck per commit, the people's slide decisions, and the latest build. Builds
// are written under the Studio's own state folder, never into the repository.
import fs from 'node:fs';
import path from 'node:path';
import { authConfig, getTrust } from '../auth/config.ts';
import { openAdapter, repoRoot } from '../repo/index.ts';
import { canonicalRefName } from '../workflow/runtime.ts';
import { GitRepositoryAdapter } from '../repo/git.ts';
import { DeckError, DeckStore, applyAction, type DeckAction } from './store.ts';
import { generate, openDeckContext, prepare, viewOf, type BuildOutput, type DeckMode, type DeckModel, type Prepared } from './service.ts';
import type { DeckContext } from './context.ts';
import type { DeckState } from './types.ts';

export interface LatestBuild {
  id: string;
  mode: DeckMode;
  generatedAt: string;
  commit: string;
  builtBy: string;
  rendered: boolean;
  previews: number;
  qa: BuildOutput['qa'];
  findings: BuildOutput['findings'];
  pptxBytes: number;
  pdfBytes: number | null;
  /** The content hash of each slide when it was built, so a preview of a slide that has changed since can be labelled stale. */
  slideHashes: Record<string, string>;
}

export const deckDir = (): string => process.env.STUDIO_DECK_DIR?.trim() || path.join(process.env.STUDIO_CACHE_DIR?.trim() || path.resolve(process.cwd(), '.studio-cache'), 'deck');
const buildsDir = () => path.join(deckDir(), 'builds');
const latestFile = () => path.join(deckDir(), 'latest.json');
const assetsDir = () => path.resolve(process.cwd(), 'deck-assets');
export const store = () => new DeckStore(path.join(deckDir(), 'state.json'));

const g = globalThis as unknown as { __studioDeck?: { key: string; ctx: DeckContext }; __studioDeckBuilding?: boolean };

export function invalidateDeck() {
  g.__studioDeck = undefined;
}

/** The repository read at the commit the Studio is reading. Cached until a commit moves or the working tree changes. */
export function getContext(): DeckContext {
  const root = repoRoot();
  const adapter = openAdapter();
  const ref = canonicalRefName();
  let canonicalCommit: string | null = null;
  try {
    canonicalCommit = new GitRepositoryAdapter(root, ref).open().commit;
  } catch {
    canonicalCommit = null;
  }
  const key = [adapter.commit, adapter.uncommittedCount(), canonicalCommit ?? 'none', authConfig().mode].join('|');
  if (g.__studioDeck?.key === key) return g.__studioDeck.ctx;
  const cfg = authConfig();
  const ctx = openDeckContext(root, adapter.ref, { codeRoot: root, trust: getTrust(), allowDevKeys: cfg.mode !== 'entra', reviewsRef: canonicalCommit ? ref : undefined });
  g.__studioDeck = { key, ctx };
  return ctx;
}

export function readLatest(): LatestBuild | null {
  try {
    return JSON.parse(fs.readFileSync(latestFile(), 'utf8')) as LatestBuild;
  } catch {
    return null;
  }
}

export interface DeckView {
  model: DeckModel;
  latest: LatestBuild | null;
}

export function getDeckView(): DeckView {
  const ctx = getContext();
  const state = store().read();
  const prep = prepare(ctx, state);
  const latest = readLatest();
  // The quality item of the gate reflects the latest rendered build, if it was of this commit.
  const qa = latest && latest.commit === ctx.commit ? latest.findings : null;
  return { model: viewOf(prep, state, qa, !!latest?.rendered && latest.commit === ctx.commit), latest };
}

/** Applies one person's action to one slide. */
export function act(a: DeckAction & { expectedRevision: number }, actor: string): DeckState {
  const ctx = getContext();
  const st = store();
  const current = st.read();
  const prep = prepare(ctx, current);
  const facts = new Map(prep.effective.map((s, i) => [s.id, { id: s.id, contentHash: prep.hashes[s.id]!, placeholders: s.placeholders.length, visual: prep.generated[i]!.visual }]));
  return st.mutate(a.expectedRevision, (s) => {
    // After an edit the slide's hash changes; recompute it from the edited state so the event records the new content.
    const rehash = (slideId: string, one: DeckState['slides'][string]) => prepare(ctx, { ...s, slides: { ...s.slides, [slideId]: one } }).hashes[slideId]!;
    applyAction(s, a, facts, actor, new Date(), rehash);
  });
}

export async function build(mode: DeckMode, actor: string): Promise<LatestBuild> {
  if (g.__studioDeckBuilding) throw new DeckError('busy', 409, 'A build is already running.');
  g.__studioDeckBuilding = true;
  try {
    const ctx = getContext();
    const state = store().read();
    const prep: Prepared = prepare(ctx, state);
    const out = await generate(ctx, { mode, outDir: buildsDir(), assetsDir: assetsDir(), state });
    const latest: LatestBuild = {
      id: out.id, mode, generatedAt: out.generatedAt, commit: out.commit, builtBy: actor, rendered: out.rendered, previews: out.previews,
      qa: out.qa, findings: out.findings, pptxBytes: out.pptx.bytes, pdfBytes: out.pdf?.bytes ?? null, slideHashes: prep.hashes,
    };
    fs.mkdirSync(deckDir(), { recursive: true });
    fs.writeFileSync(latestFile(), JSON.stringify(latest, null, 2));
    // Keep the five most recent builds.
    const dirs = fs.readdirSync(buildsDir()).filter((d) => d.startsWith('deck-') && !d.endsWith('.staging')).sort().reverse();
    for (const d of dirs.slice(5)) fs.rmSync(path.join(buildsDir(), d), { recursive: true, force: true });
    return latest;
  } finally {
    g.__studioDeckBuilding = false;
  }
}

/** A file from the latest build, or null. The name is never taken from the request. */
export function latestFilePath(kind: 'pptx' | 'pdf' | { preview: number }): { file: string; type: string; name: string } | null {
  const l = readLatest();
  if (!l) return null;
  const dir = path.join(buildsDir(), l.id);
  const tag = l.mode === 'sample' ? '-SAMPLE' : '';
  if (kind === 'pptx') return { file: path.join(dir, 'deck.pptx'), type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', name: `greenfuel-capstone${tag}-${l.commit.slice(0, 7)}.pptx` };
  if (kind === 'pdf') return l.pdfBytes ? { file: path.join(dir, 'render', 'deck.pdf'), type: 'application/pdf', name: `greenfuel-capstone${tag}-${l.commit.slice(0, 7)}.pdf` } : null;
  return { file: path.join(dir, 'render', `slide-${String(kind.preview).padStart(3, '0')}.png`), type: 'image/png', name: `slide-${kind.preview}.png` };
}
