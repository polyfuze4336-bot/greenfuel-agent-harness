// The Studio's view of the presentation pipeline: one prepared deck per commit, the people's slide decisions, and the latest build. Builds
// are written under the Studio's own state folder, never into the repository.
import crypto from 'node:crypto';
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

interface Recorded {
  mode: DeckMode;
  git: { commit: string };
  outputs: { pptx: { file: string; sha256: string } | null; pdf: { file: string; sha256: string } | null };
}

const sha256File = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/**
 * The latest build's own record, checked against the files. Nothing is served unless the file still has the hash the build recorded, and
 * whether it is a sample or a final deck is taken from that record, not from the pointer file, which anyone with access to the folder can edit.
 */
export function verifiedLatest(): { dir: string; rec: Recorded; commit: string } {
  const l = readLatest();
  if (!l) throw new DeckError('no-build', 404, 'Build the deck first.');
  const dir = path.join(buildsDir(), path.basename(l.id));
  let rec: Recorded;
  try {
    rec = JSON.parse(fs.readFileSync(path.join(dir, 'generation.json'), 'utf8')) as Recorded;
  } catch {
    throw new DeckError('no-record', 409, 'The latest build has no readable generation record, so it cannot be trusted.');
  }
  if (rec.mode !== l.mode || rec.git.commit !== l.commit) throw new DeckError('record-mismatch', 409, 'The pointer to the latest build disagrees with the build\'s own record.');
  return { dir, rec, commit: rec.git.commit };
}

/** A file from the latest build, or null. The name is never taken from the request, and a file that does not match its recorded hash is refused. */
export function latestFilePath(kind: 'pptx' | 'pdf' | { preview: number }): { file: string; type: string; name: string } | null {
  const { dir, rec, commit } = verifiedLatest();
  const tag = rec.mode === 'sample' ? '-SAMPLE' : '';
  if (typeof kind !== 'string') return { file: path.join(dir, 'render', `slide-${String(kind.preview).padStart(3, '0')}.png`), type: 'image/png', name: `slide-${kind.preview}.png` };
  const out = kind === 'pptx' ? rec.outputs.pptx : rec.outputs.pdf;
  if (!out) return null;
  const file = path.join(dir, out.file);
  if (!fs.existsSync(file)) throw new DeckError('output-missing', 409, `The ${kind} is recorded but its file is missing.`);
  if (sha256File(file) !== out.sha256) throw new DeckError('output-corrupted', 409, `The ${kind} does not match the hash recorded when it was built. It was changed or damaged, and it is not served.`);
  return { file, type: kind === 'pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : 'application/pdf', name: `greenfuel-capstone${tag}-${commit.slice(0, 7)}.${kind}` };
}