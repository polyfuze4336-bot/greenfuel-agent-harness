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
import { WorkService } from './work.ts';
import { GitHubApi } from '../github/api.ts';
import { AppAuth, appConfigFromEnv, type AppConfig } from '../github/app-auth.ts';
import { AppGitHub, AppPublisher } from '../github/app-github.ts';
import { DeliveryLog } from '../github/webhook.ts';
import { EntraClient } from '../auth/entra.ts';
import { authConfig } from '../auth/config.ts';
import type { GitHubPort } from './github.ts';
import type { Publisher } from './publish.ts';
import type { NormalizedDecision } from '../intel/schema.ts';

export const canonicalRefName = () => process.env.STUDIO_CANONICAL_REF?.trim() || 'origin/main';
export const isTestMode = () => process.env.STUDIO_TEST_MODE === '1';

export type GitHubMode = 'app' | 'cli' | 'test';

interface Runtime {
  key: string;
  service: ReviewService;
  work: WorkService;
  sessions: SessionStore;
  /** How the Studio talks to GitHub: as a GitHub App, as the signed-in user through the CLI, or against a simulated GitHub. */
  mode: GitHubMode;
  github: GitHubPort;
  app: { config: AppConfig; auth: AppAuth; api: GitHubApi } | null;
  deliveries: DeliveryLog;
  /** Microsoft Entra ID sign-in. Present only in entra mode, and only when it is fully configured. */
  entra: EntraClient | null;
}

const g = globalThis as unknown as { __studioReview?: Runtime };

export function reviewRuntime(root: string, readRef: string): Runtime {
  const cache = process.env.STUDIO_CACHE_DIR?.trim() || path.resolve(process.cwd(), '.studio-cache');
  const appCfg = appConfigFromEnv();
  const auth = authConfig();
  const key = [auth.mode, auth.entra?.clientId ?? '', auth.entra?.authority ?? '', root, readRef, canonicalRefName(), cache, isTestMode(), process.env.STUDIO_TEST_FIXTURE_DIR ?? '', appCfg?.repo ?? '', appCfg?.apiUrl ?? ''].join('|');
  if (g.__studioReview?.key === key) return g.__studioReview;
  const test = isTestMode();
  const fixtures = process.env.STUDIO_TEST_FIXTURE_DIR?.trim() ?? '';
  if (test && !fixtures) throw new Error('STUDIO_TEST_MODE needs STUDIO_TEST_FIXTURE_DIR.');
  // Writing to GitHub: a GitHub App when it is configured, otherwise the simulated service (test) or the CLI as the signed-in user.
  let app: Runtime['app'] = null;
  let github: GitHubPort;
  let publisher: Publisher;
  if (appCfg) {
    const auth = AppAuth.fromConfig(appCfg);
    const api = new GitHubApi({ baseUrl: appCfg.apiUrl, tokens: auth });
    app = { config: appCfg, auth, api };
    github = new AppGitHub(api, appCfg.repo);
    publisher = new AppPublisher({ api, tokens: auth, repo: appCfg.repo, root, gitUrl: appCfg.gitUrl });
  } else {
    github = test ? new LocalGitHub(path.join(fixtures, 'prs.json'), process.env.STUDIO_TEST_REMOTE_GIT_DIR ?? '') : new GhCliGitHub(root);
    publisher = new GitPublisher(root);
  }
  const service = new ReviewService({
    root,
    readRef,
    canonicalRef: canonicalRefName(),
    store: new ReviewStore(path.join(cache, 'review')),
    github,
    publisher,
    identity: test ? new FixtureIdentity(path.join(fixtures, 'identity.json')) : new GhCliIdentity(),
  });
  g.__studioReview = {
    key,
    service,
    work: new WorkService(service.deps, service),
    sessions: g.__studioReview?.sessions ?? new SessionStore(),
    mode: app ? 'app' : test ? 'test' : 'cli',
    github,
    app,
    deliveries: new DeliveryLog(path.join(cache, 'webhook-deliveries.json')),
    entra: auth.entra ? new EntraClient(auth.entra) : null,
  };
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
