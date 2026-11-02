import path from 'node:path';
import { GitRepositoryAdapter, GitError, repositoryFingerprint, validateRef } from './git.ts';
import { buildModel } from './build.ts';
import { FileStateStore, type FragmentCache } from '../intel/engine.ts';
import { applyReviewOverlay } from '../workflow/overlay.ts';
import { canonicalRefName } from '../workflow/runtime.ts';
import { appConfigFromEnv } from '../github/app-auth.ts';
import { loadReviewStates } from '../workflow/review.ts';
import type { StudioModel } from './types.ts';

export { GitError };

// How often the repository is asked whether anything changed. A check is three git calls; a rebuild is far more. The model itself
// never expires on a clock: it is rebuilt only when the fingerprint of the repository (HEAD, every branch ref, uncommitted files,
// last fetch) differs from the one it was built from.
const CHECK_MS = 1_000;
// Route handlers and pages are bundled separately, so a module-level variable would be a different copy in each.
// The caches live on globalThis so that invalidating one in one place is seen everywhere.
const shared = globalThis as unknown as { __studioModel?: { key: string; fp: string; checkedAt: number; model: StudioModel } | null; __studioFragments?: FragmentCache };
// Parsed source files, keyed by path and git blob id. Surviving across requests is what makes re-reading incremental.
const fragmentCache: FragmentCache = (shared.__studioFragments ??= new Map());
/** The ref the Studio reads. HEAD by default; STUDIO_REF reads another branch, tag or commit. */
export function configuredRef(): string {
  // With the GitHub App configured, GitHub is the authority, so read the canonical branch unless told otherwise.
  return process.env.STUDIO_REF?.trim() || (appConfigFromEnv() ? canonicalRefName() : 'HEAD');
}

export function repoRoot(): string {
  return process.env.STUDIO_REPO_ROOT?.trim() || GitRepositoryAdapter.findRoot(process.cwd());
}

export function openAdapter(ref: string = configuredRef()): GitRepositoryAdapter {
  return new GitRepositoryAdapter(repoRoot(), validateRef(ref)).open();
}

/** Where the last synchronised register is kept. This is the Studio's own folder, never the repository. */
export function stateStore(): FileStateStore {
  return new FileStateStore(process.env.STUDIO_CACHE_DIR?.trim() || path.resolve(process.cwd(), '.studio-cache'));
}

/**
 * Shows merged review records on top of the register. The reviews are read from the canonical ref (origin/main by default),
 * not from the branch being browsed, so a decision is canonical only once its review event is on the canonical branch.
 */
function withReviews(model: StudioModel): StudioModel {
  const ref = canonicalRefName();
  try {
    const canon = new GitRepositoryAdapter(repoRoot(), validateRef(ref)).open();
    return { ...model, register: applyReviewOverlay(model.register, loadReviewStates(canon), ref) };
  } catch {
    return model;
  }
}

/** Forget the cached read model, so the next read reflects a change just made (for example a verified merge). */
export function invalidateModel() {
  shared.__studioModel = null;
}

/** Build (or reuse) the read model. `fresh` forces a re-read of the repository. */
export async function getModel(opts: { fresh?: boolean } = {}): Promise<StudioModel> {
  // In Entra mode the repository content is not produced for anyone who may not read it. Layouts and pages are rendered
  // independently of one another, so withholding it here is what stops it reaching the page payload.
  const { authConfig } = await import('../auth/config.ts');
  if (authConfig().mode === 'entra') await (await import('../auth/server.ts')).assertMayRead();
  const delay = Number(process.env.STUDIO_E2E_DELAY_MS ?? 0);
  if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  const key = `${repoRoot()}::${configuredRef()}`;
  const hit = shared.__studioModel;
  const now = Date.now();
  if (!opts.fresh && hit && hit.key === key && now - hit.checkedAt < CHECK_MS) return hit.model;
  const fp = await repositoryFingerprint(repoRoot());
  // Re-read the cache after the await: another request may have rebuilt for this same fingerprint in the meantime.
  const cur = shared.__studioModel;
  if (!opts.fresh && cur && cur.key === key && cur.fp === fp) {
    cur.checkedAt = Date.now();
    return cur.model;
  }
  const model = withReviews(buildModel(openAdapter(), fragmentCache));
  shared.__studioModel = { key, fp, checkedAt: Date.now(), model };
  return model;
}