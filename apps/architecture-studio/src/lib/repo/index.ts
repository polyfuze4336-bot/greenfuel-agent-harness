import path from 'node:path';
import { GitRepositoryAdapter, GitError, validateRef } from './git.ts';
import { buildModel } from './build.ts';
import { FileStateStore, type FragmentCache } from '../intel/engine.ts';
import { applyReviewOverlay } from '../workflow/overlay.ts';
import { canonicalRefName } from '../workflow/runtime.ts';
import { appConfigFromEnv } from '../github/app-auth.ts';
import { loadReviewStates } from '../workflow/review.ts';
import type { StudioModel } from './types.ts';

export { GitError };

const TTL_MS = 5_000;
// Route handlers and pages are bundled separately, so a module-level variable would be a different copy in each.
// The cache lives on globalThis so that invalidating it in one place is seen everywhere.
const shared = globalThis as unknown as { __studioModel?: { key: string; at: number; model: StudioModel } | null };
// Parsed source files, keyed by path and git blob id. Surviving across requests is what makes re-reading incremental.
const fragmentCache: FragmentCache = new Map();

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

/** Build (or reuse, for a few seconds) the read model. `fresh` forces a re-read of the repository. */
export async function getModel(opts: { fresh?: boolean } = {}): Promise<StudioModel> {
  const delay = Number(process.env.STUDIO_E2E_DELAY_MS ?? 0);
  if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  const key = `${repoRoot()}::${configuredRef()}`;
  const hit = shared.__studioModel;
  if (!opts.fresh && hit && hit.key === key && Date.now() - hit.at < TTL_MS) return hit.model;
  const model = withReviews(buildModel(openAdapter(), fragmentCache));
  shared.__studioModel = { key, at: Date.now(), model };
  return model;
}
