// The Studio's view of build readiness: the validator run against the repository the Studio reads, cached until a commit moves. It reads
// review records from the canonical branch (as the rest of the Studio does) and checks their signatures with the server's own trust.
import { authConfig, getTrust } from '../auth/config.ts';
import { openAdapter, repoRoot } from '../repo/index.ts';
import { canonicalRefName } from '../workflow/runtime.ts';
import { GitRepositoryAdapter } from '../repo/git.ts';
import { loadReadinessInput } from './input.ts';
import { computeReadiness, type Readiness } from './readiness.ts';
import { evaluateAreas, loadBaselineStates, type AreaGate, type BaselineState } from './state.ts';

export interface BaselineView {
  commit: string;
  canonicalRef: string;
  /** Null when the canonical ref cannot be read: review records and approvals are then read from the browsed ref only. */
  canonicalCommit: string | null;
  signatures: Readiness['signatures'];
  policy: { valid: boolean; problems: string[]; hash: string; activeStage: string };
  readiness: Readiness;
  gates: AreaGate[];
  baselines: BaselineState[];
  generatedAt: string;
}

const shared = globalThis as unknown as { __studioBaseline?: { key: string; view: BaselineView } | null };

export function invalidateBaseline() {
  shared.__studioBaseline = null;
}

export function getBaselineView(): BaselineView {
  const root = repoRoot();
  const adapter = openAdapter();
  const ref = canonicalRefName();
  let canonicalCommit: string | null = null;
  try {
    canonicalCommit = new GitRepositoryAdapter(root, ref).open().commit;
  } catch {
    canonicalCommit = null;
  }
  const key = [adapter.commit, canonicalCommit ?? 'none', authConfig().mode].join('|');
  const hit = shared.__studioBaseline;
  if (hit?.key === key) return hit.view;

  const cfg = authConfig();
  const lo = { codeRoot: root, trust: getTrust(), allowDevKeys: cfg.mode !== 'entra', reviewsRef: canonicalCommit ? ref : undefined };
  const cur = loadReadinessInput(root, adapter.ref, lo);
  const readiness = computeReadiness(cur.input);
  // The live page does not re-make every baseline from its source commit; the gate and the verify command do.
  const baselines = loadBaselineStates(root, cur, readiness, { ...lo, reproduce: false });
  const view: BaselineView = {
    commit: cur.input.commit,
    canonicalRef: ref,
    canonicalCommit,
    signatures: readiness.signatures,
    policy: { valid: cur.input.policy.valid, problems: cur.input.policy.problems, hash: cur.input.policy.hash, activeStage: cur.input.policy.activeStage },
    readiness,
    gates: evaluateAreas(readiness, baselines, cur.input.policy),
    baselines,
    generatedAt: new Date().toISOString(),
  };
  shared.__studioBaseline = { key, view };
  return view;
}
