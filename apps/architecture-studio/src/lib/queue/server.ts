// Server-side access to the Work Queue snapshot. Cached on globalThis (routes and pages are bundled separately) and keyed by the
// commits that determine it: the commit being read, and the canonical commit that holds merged review and work-item records.
// A request that finds the same commits reuses everything, including the read model, so reading the queue does not re-read git.
import type { StudioModel } from '../repo/types.ts';
import { GitRepositoryAdapter } from '../repo/git.ts';
import { getModel, openAdapter, repoRoot } from '../repo/index.ts';
import { runtime } from '../workflow/http.ts';
import { loadWorkStates } from '../workflow/work.ts';
import type { WorkState } from '../workflow/work-events.ts';
import { buildQueue, type QueueSnapshot } from './snapshot.ts';

export interface CanonicalWork {
  available: boolean;
  ref: string;
  commit: string | null;
  error: string | null;
  states: Map<string, WorkState>;
  adapter: GitRepositoryAdapter | null;
}

export interface QueueRead {
  model: StudioModel;
  snapshot: QueueSnapshot;
  evidenceRuns: Map<string, { exitCode: number | null }>;
  canonical: CanonicalWork;
  canonicalCommit: string | null;
  canonicalAvailable: boolean;
}

const shared = globalThis as unknown as { __studioQueue?: { key: string; read: QueueRead } | null };

export async function getQueue(): Promise<QueueRead> {
  const rt = runtime();
  const policy = rt.service.policy();
  const ref = rt.work.deps.canonicalRef;
  let adapter: GitRepositoryAdapter | null = null;
  try {
    adapter = new GitRepositoryAdapter(repoRoot(), ref).open();
  } catch {
    adapter = null;
  }
  const head = openAdapter().commit;
  const key = [head, adapter?.commit ?? 'none', policy.source, policy.work.completionRoles.join(','), policy.work.requireIndependentApproval].join('|');
  const hit = shared.__studioQueue;
  if (hit?.key === key) return hit.read;

  // The model also folds in merged review records from the canonical ref, so it is re-read whenever either commit changed.
  const model = await getModel({ fresh: true });
  const canonical: CanonicalWork = adapter
    ? { available: true, ref, commit: adapter.commit, error: null, states: loadWorkStates(adapter), adapter }
    : { available: false, ref, commit: null, error: `The canonical ref ${ref} cannot be read.`, states: new Map(), adapter: null };
  const snapshot = buildQueue(model, openAdapter(head), {
    work: canonical.states,
    roleAliases: policy.roleAliases,
    completionRoles: policy.work.completionRoles,
    canonicalRef: ref,
  });
  const read: QueueRead = {
    model,
    snapshot,
    evidenceRuns: new Map(model.evidence.runs.map((r) => [r.id, { exitCode: r.exitCode }])),
    canonical,
    canonicalCommit: canonical.commit,
    canonicalAvailable: canonical.available,
  };
  shared.__studioQueue = { key, read };
  return read;
}

export function invalidateQueue() {
  shared.__studioQueue = null;
}
