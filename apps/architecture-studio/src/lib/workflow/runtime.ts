// Builds the review service from the environment, once per server process.
//
// Test mode (STUDIO_TEST_MODE=1) swaps two things and nothing else: the identity comes from a file instead of GitHub, and pull
// requests are kept in a local file instead of on GitHub. The UI shows a banner while it is on. It exists so the whole workflow
// can be exercised against a throw-away repository without touching a real one.
import path from 'node:path';
import { GhCliGitHub, LocalGitHub } from './github.ts';
import { FixtureIdentity, GhCliIdentity, SessionStore } from './identity.ts';
import { GitPublisher } from './publish.ts';
import { ReviewService } from './review.ts';
import { ReviewStore } from './store.ts';
import type { NormalizedDecision } from '../intel/schema.ts';

export const canonicalRefName = () => process.env.STUDIO_CANONICAL_REF?.trim() || 'origin/main';
export const isTestMode = () => process.env.STUDIO_TEST_MODE === '1';

interface Runtime {
  key: string;
  service: ReviewService;
  sessions: SessionStore;
}

const g = globalThis as unknown as { __studioReview?: Runtime };

export function reviewRuntime(root: string, readRef: string): Runtime {
  const cache = process.env.STUDIO_CACHE_DIR?.trim() || path.resolve(process.cwd(), '.studio-cache');
  const key = [root, readRef, canonicalRefName(), cache, isTestMode(), process.env.STUDIO_TEST_FIXTURE_DIR ?? ''].join('|');
  if (g.__studioReview?.key === key) return g.__studioReview;
  const test = isTestMode();
  const fixtures = process.env.STUDIO_TEST_FIXTURE_DIR?.trim() ?? '';
  if (test && !fixtures) throw new Error('STUDIO_TEST_MODE needs STUDIO_TEST_FIXTURE_DIR.');
  const service = new ReviewService({
    root,
    readRef,
    canonicalRef: canonicalRefName(),
    store: new ReviewStore(path.join(cache, 'review')),
    github: test ? new LocalGitHub(path.join(fixtures, 'prs.json'), process.env.STUDIO_TEST_REMOTE_GIT_DIR ?? '') : new GhCliGitHub(root),
    publisher: new GitPublisher(root),
    identity: test ? new FixtureIdentity(path.join(fixtures, 'identity.json')) : new GhCliIdentity(),
  });
  g.__studioReview = { key, service, sessions: g.__studioReview?.sessions ?? new SessionStore() };
  return g.__studioReview;
}

const PRIORITY_RANK: Record<string, number> = { Must: 0, Should: 1, Could: 2 };

/** Decisions waiting for a person, in the order to review them: Must first, then ADRs before register entries, Blocked last. */
export function pendingOrder(records: NormalizedDecision[], hasOpenProposal: (id: string) => boolean): NormalizedDecision[] {
  const waiting = records.filter((r) => (r.status === 'Proposed' || r.status === 'Pending Review' || r.status === 'Blocked') && !hasOpenProposal(r.id));
  return waiting.sort((a, b) => {
    const blocked = Number(a.status === 'Blocked') - Number(b.status === 'Blocked');
    if (blocked) return blocked;
    const pa = PRIORITY_RANK[a.priority?.value ?? ''] ?? 3;
    const pb = PRIORITY_RANK[b.priority?.value ?? ''] ?? 3;
    if (pa !== pb) return pa - pb;
    if (a.kind !== b.kind) return a.kind === 'adr' ? -1 : 1;
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });
}
