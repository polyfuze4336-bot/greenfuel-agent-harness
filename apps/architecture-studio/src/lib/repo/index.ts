import { GitRepositoryAdapter, GitError } from './git.ts';
import { buildModel } from './build.ts';
import type { StudioModel } from './types.ts';

export { GitError };

const TTL_MS = 5_000;
let cached: { key: string; at: number; model: StudioModel } | null = null;

/** The ref the Studio reads. HEAD by default; STUDIO_REF reads another branch, tag or commit. */
export function configuredRef(): string {
  return process.env.STUDIO_REF?.trim() || 'HEAD';
}

export function repoRoot(): string {
  return process.env.STUDIO_REPO_ROOT?.trim() || GitRepositoryAdapter.findRoot(process.cwd());
}

export function openAdapter(): GitRepositoryAdapter {
  return new GitRepositoryAdapter(repoRoot(), configuredRef()).open();
}

/** Build (or reuse, for a few seconds) the read model. `fresh` forces a re-read of the repository. */
export async function getModel(opts: { fresh?: boolean } = {}): Promise<StudioModel> {
  const delay = Number(process.env.STUDIO_E2E_DELAY_MS ?? 0);
  if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  const key = `${repoRoot()}::${configuredRef()}`;
  if (!opts.fresh && cached && cached.key === key && Date.now() - cached.at < TTL_MS) return cached.model;
  const model = buildModel(openAdapter());
  cached = { key, at: Date.now(), model };
  return model;
}
