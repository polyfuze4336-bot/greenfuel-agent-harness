import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import { after, describe, it } from 'node:test';
import { GitHubApi } from '../src/lib/github/api.ts';
import { APP_PERMISSIONS, AppAuth, appConfigFromEnv, signAppJwt } from '../src/lib/github/app-auth.ts';
import { AppGitHub, AppPublisher } from '../src/lib/github/app-github.ts';
import { reconcile } from '../src/lib/github/reconcile.ts';
import { DeliveryLog, isHandledEvent, signBody, targetOf, verifySignature } from '../src/lib/github/webhook.ts';
import { eventPath } from '../src/lib/workflow/events.ts';
import { GitHubError } from '../src/lib/workflow/github.ts';
import { FixtureIdentity, type VerifiedUser } from '../src/lib/workflow/identity.ts';
import { PublishError } from '../src/lib/workflow/publish.ts';
import { ReviewService, ServiceError } from '../src/lib/workflow/review.ts';
import { ReviewStore, type Proposal } from '../src/lib/workflow/store.ts';
import { WorkService } from '../src/lib/workflow/work.ts';
import { USERS, git, makeDecision, makeFixture, type Fixture } from './fixtures/review-fixture.ts';
import { FakeGitHub, makeAppKeys } from './fixtures/fake-github.ts';
import type { NormalizedDecision } from '../src/lib/intel/schema.ts';
import type { ActionKind } from '../src/lib/workflow/events.ts';

// The GitHub App path end to end, against a stand-in for the GitHub REST API (checks/fixtures/fake-github.ts) that runs over a
// real bare git repository. It exercises the Studio's code for real; what it cannot show is how real GitHub behaves, and no test
// here claims to. Nothing is sent to github.com.

const REPO = 'acme/greenfuel';
const fixtures: Fixture[] = [];
const fakes: FakeGitHub[] = [];
after(async () => {
  for (const f of fakes) await f.stop();
  for (const f of fixtures) f.cleanup();
});

async function appWorld(opts: { fx?: Fixture } = {}) {
  const fx = opts.fx ?? makeFixture();
  if (!opts.fx) fixtures.push(fx);
  fx.setIdentity(USERS.owner);
  const keys = makeAppKeys(fx.dir);
  const fake = new FakeGitHub({ remoteGitDir: fx.remote, repo: REPO, appId: '12345', installationId: '678', publicKeyPem: keys.publicKeyPem });
  const apiUrl = await fake.start();
  fakes.push(fake);
  const sleeps: number[] = [];
  const auth = new AppAuth({ appId: '12345', installationId: '678', repo: REPO, apiUrl, privateKeyPem: keys.privateKeyPem });
  const api = new GitHubApi({ baseUrl: apiUrl, tokens: auth, sleep: async (ms) => void sleeps.push(ms), maxWaitMs: 5000 });
  const github = new AppGitHub(api, REPO);
  const publisher = new AppPublisher({ api, tokens: auth, repo: REPO, root: fx.work, gitUrl: fx.remote });
  const identity = new FixtureIdentity(path.join(fx.state, 'identity.json'));
  let t = Date.parse('2026-10-30T00:00:00Z');
  const mk = (name: string) => {
    const store = new ReviewStore(path.join(fx.state, name));
    const svc = new ReviewService({ root: fx.work, readRef: 'HEAD', canonicalRef: 'origin/main', store, github, publisher, identity, now: () => new Date((t += 1000)) });
    return { store, svc, work: new WorkService(svc.deps, svc) };
  };
  const a = mk('review-a');
  let n = 0;
  const key = () => `key-${++n}-abcdefgh`;
  const owner = async (): Promise<VerifiedUser> => {
    fx.setIdentity(USERS.owner);
    return identity.verify();
  };
  const submit = async (w: ReturnType<typeof mk>, d: NormalizedDecision, action: ActionKind, extra: Record<string, unknown> = {}, expectedRevision?: string) => {
    const u = await owner();
    const v = w.svc.view(d, u);
    return w.svc.submit(u, d, { action, expectedRevision: expectedRevision ?? v.revision, idempotencyKey: key(), ...extra });
  };
  return { fx, keys, fake, apiUrl, auth, api, github, publisher, sleeps, mk, a, key, owner, submit };
}

const code = (c: string) => (e: unknown) => e instanceof ServiceError && e.code === c;
const REASON = 'The residency analysis in the design review supports this choice.';
const branchesCreated = (f: FakeGitHub) => f.refWrites().filter((l) => l.method === 'POST').map((l) => (l.body as { ref: string }).ref);

describe('GitHub App authentication', () => {
  it('signs a valid RS256 JWT that GitHub-style verification accepts, valid for at most ten minutes', async () => {
    const w = await appWorld();
    const jwt = w.auth.jwt();
    const [h, b] = jwt.split('.');
    assert.equal(JSON.parse(Buffer.from(h!, 'base64url').toString()).alg, 'RS256');
    const c = JSON.parse(Buffer.from(b!, 'base64url').toString()) as { iss: string; iat: number; exp: number };
    assert.equal(c.iss, '12345');
    assert.ok(c.exp - c.iat <= 10 * 60);
    const tampered = `${h}.${Buffer.from(JSON.stringify({ ...c, iss: '99' })).toString('base64url')}.${jwt.split('.')[2]}`;
    const bad = await fetch(`${w.apiUrl}/app/installations/678/access_tokens`, { method: 'POST', headers: { authorization: `Bearer ${tampered}`, 'content-type': 'application/json' }, body: JSON.stringify({ repositories: ['greenfuel'], permissions: APP_PERMISSIONS }) });
    assert.equal(bad.status, 401, 'a JWT whose claims were altered is refused');
  });

  it('exchanges it for an installation token scoped to one repository and the minimum permissions, and caches it', async () => {
    const w = await appWorld();
    const t1 = await w.auth.token();
    const t2 = await w.auth.token();
    assert.equal(t1, t2);
    assert.equal(w.fake.tokensIssued, 1);
    const req = w.fake.log.find((l) => l.path.includes('access_tokens'))!;
    assert.deepEqual((req.body as { repositories: string[] }).repositories, ['greenfuel']);
    assert.deepEqual((req.body as { permissions: object }).permissions, { contents: 'write', pull_requests: 'write', checks: 'read', statuses: 'read', metadata: 'read' });
    assert.equal(w.fake.log.filter((l) => l.auth === 'jwt').length, 1, 'the JWT is used only for the token exchange');
  });

  it('never exposes the private key: not in JSON, not when inspected, not in anything sent to GitHub', async () => {
    const w = await appWorld();
    await w.auth.token();
    const d = makeDecision({ id: 'ADR-0201' });
    const { proposal } = await w.submit(w.a, d, 'approve');
    await w.a.svc.sync(proposal.id);
    const pem = fs.readFileSync(w.keys.privateKeyFile, 'utf8');
    const body = pem.split('\n')[1]!;
    assert.ok(!JSON.stringify(w.auth).includes(body));
    assert.ok(!inspect(w.auth).includes(body));
    assert.ok(!JSON.stringify(w.fake.log).includes(body) && !JSON.stringify(w.fake.log).includes('PRIVATE KEY'));
    assert.ok(!JSON.stringify(w.a.store.list()).includes(body));
    assert.ok(!JSON.stringify(w.a.store.readAudit({ limit: 500 })).includes(body));
    assert.ok(!JSON.stringify(w.a.store.list()).includes('ghs_'), 'no installation token is stored');
  });

  it('reads configuration from the environment, and is off unless every setting is present', () => {
    assert.equal(appConfigFromEnv({}), null);
    assert.equal(appConfigFromEnv({ STUDIO_GITHUB_APP_ID: '1' }), null);
    const c = appConfigFromEnv({ STUDIO_GITHUB_APP_ID: '1', STUDIO_GITHUB_APP_INSTALLATION_ID: '2', STUDIO_GITHUB_REPO: 'o/r', STUDIO_GITHUB_APP_PRIVATE_KEY_FILE: 'k.pem' })!;
    assert.equal(c.apiUrl, 'https://api.github.com');
    assert.equal(c.gitUrl, 'https://github.com/o/r.git');
    assert.throws(() => appConfigFromEnv({ STUDIO_GITHUB_APP_ID: 'x', STUDIO_GITHUB_APP_INSTALLATION_ID: '2', STUDIO_GITHUB_REPO: 'o/r', STUDIO_GITHUB_APP_PRIVATE_KEY_FILE: 'k' }));
    assert.throws(() => appConfigFromEnv({ STUDIO_GITHUB_APP_ID: '1', STUDIO_GITHUB_APP_INSTALLATION_ID: '2', STUDIO_GITHUB_REPO: 'not a repo', STUDIO_GITHUB_APP_PRIVATE_KEY_FILE: 'k' }));
  });

  it('refuses a private key that is not a key, without echoing it', () => {
    assert.throws(() => new AppAuth({ appId: '1', installationId: '2', repo: REPO, apiUrl: 'http://x', privateKeyPem: 'SECRET-NOT-A-KEY' }), (e: unknown) => e instanceof GitHubError && !e.message.includes('SECRET'));
  });

  it('signAppJwt backdates the issue time a minute to absorb clock drift', async () => {
    const w = await appWorld();
    const key = (await import('node:crypto')).createPrivateKey(w.keys.privateKeyPem);
    const c = JSON.parse(Buffer.from(signAppJwt(key, '1', 1_000_000).split('.')[1]!, 'base64url').toString()) as { iat: number; exp: number };
    assert.equal(c.iat, 1_000_000 - 60);
    assert.equal(c.exp, 1_000_000 + 540);
  });
});

describe('approval and rejection pull requests', () => {
  it('approves through a pull request created by the app; main is untouched until a person merges, then it is applied and refreshed', async () => {
    const w = await appWorld();
    const d = makeDecision({ id: 'ADR-0301' });
    const mainBefore = git(w.fx.remote, 'rev-parse', 'refs/heads/main');
    const { proposal } = await w.submit(w.a, d, 'approve');
    assert.equal(proposal.state, 'locally-submitted');
    assert.equal(w.fake.pulls.length, 0, 'nothing is sent until the sync');

    const sent = await w.a.svc.sync(proposal.id);
    assert.equal(sent.state, 'pull-request-created');
    assert.equal(w.fake.pulls.length, 1);
    assert.equal(git(w.fx.remote, 'rev-parse', 'refs/heads/main'), mainBefore, 'the canonical branch was not touched');
    assert.deepEqual(branchesCreated(w.fake), [`refs/heads/${sent.branch}`], 'the app created one new branch under its own prefix, and wrote no other ref');
    assert.equal(git(w.fx.remote, 'diff-tree', '--no-commit-id', '--name-only', '-r', sent.headSha!), eventPath('ADR-0301', 1, 'approve'), 'the commit holds exactly the one record file');
    assert.equal(w.a.svc.canonical().states.get('ADR-0301'), undefined, 'a pull request is not a decision');

    assert.equal((await w.a.svc.sync(proposal.id)).state, 'awaiting-merge');
    w.fake.merge(sent.prNumber!);
    const done = await w.a.svc.sync(proposal.id);
    assert.equal(done.state, 'applied');
    assert.equal(w.a.svc.canonical().states.get('ADR-0301')!.effectiveStatus, 'Approved');
    assert.equal(done.resultCommit, git(w.fx.remote, 'rev-parse', 'refs/heads/main'), 'the resulting commit is the one on the canonical branch');
    assert.ok(w.fake.log.every((l) => !(l.method === 'PATCH' || l.method === 'PUT' || l.method === 'DELETE')), 'the app never updates, merges or deletes anything');
  });

  it('rejects through a pull request, with the rationale in the record, and is Rejected only after the merge', async () => {
    const w = await appWorld();
    const d = makeDecision({ id: 'ADR-0302' });
    const { proposal } = await w.submit(w.a, d, 'reject', { rationale: REASON });
    await w.a.svc.sync(proposal.id);
    const file = JSON.parse(git(w.fx.remote, 'show', `${proposal.branch}:${eventPath('ADR-0302', 1, 'reject')}`)) as { rationale: string; action: string };
    assert.equal(file.action, 'reject');
    assert.equal(file.rationale, REASON);
    assert.equal(w.a.svc.canonical().states.get('ADR-0302'), undefined);
    w.fake.merge((await w.a.svc.sync(proposal.id)).prNumber!);
    assert.equal((await w.a.svc.sync(proposal.id)).state, 'applied');
    assert.equal(w.a.svc.canonical().states.get('ADR-0302')!.effectiveStatus, 'Rejected');
  });

  it('the audit log records user, action, decision, old and new value, source commit, pull request, result commit and validation', async () => {
    const w = await appWorld();
    const d = makeDecision({ id: 'ADR-0303' });
    const { proposal } = await w.submit(w.a, d, 'approve');
    const sent = await w.a.svc.sync(proposal.id);
    w.fake.setChecks(sent.headSha!, [{ name: 'validate', status: 'completed', conclusion: 'success' }]);
    await w.a.svc.sync(proposal.id);
    w.fake.merge(sent.prNumber!);
    await w.a.svc.sync(proposal.id);
    const entries = w.a.store.readAudit({ decisionId: 'ADR-0303', limit: 50 }).reverse();
    const accepted = entries.find((e) => e.outcome === 'accepted')!;
    assert.equal(accepted.actor, 'test-owner');
    assert.equal(accepted.action, 'approve');
    assert.equal(accepted.decisionId, 'ADR-0303');
    assert.equal(accepted.facts?.oldValue, d.status);
    assert.equal(accepted.facts?.newValue, 'Approved');
    assert.equal(accepted.facts?.sourceCommit, d.source.commit);
    assert.match(accepted.at, /^2026-10-30T/);
    const pr = entries.find((e) => e.code === 'pull-request-created')!;
    assert.equal(pr.facts?.pullRequest, sent.prNumber);
    assert.equal(pr.facts?.resultCommit, sent.headSha);
    const v = entries.find((e) => e.code === 'validation-success')!;
    assert.equal(v.facts?.validation, 'success');
    const applied = entries.find((e) => e.code === 'applied')!;
    assert.equal(applied.facts?.pullRequest, sent.prNumber);
    assert.equal(applied.facts?.resultCommit, git(w.fx.remote, 'rev-parse', 'refs/heads/main'));
    assert.equal(applied.facts?.validation, 'success');
    assert.equal(w.a.store.verifyAudit(), null, 'the hash chain still verifies with the new fields');
  });
});

describe('concurrent modification', () => {
  it('another person decided first: the stale submission is refused with the current state, and nothing is written to GitHub', async () => {
    const w = await appWorld();
    const b = w.mk('review-b');
    const d = makeDecision({ id: 'ADR-0311' });
    const u = await w.owner();
    const openedByA = w.a.svc.view(d, u).revision;

    const { proposal } = await w.submit(b, d, 'approve');
    const sent = await b.svc.sync(proposal.id);
    w.fake.merge(sent.prNumber!);
    await b.svc.sync(proposal.id);
    const writesBefore = w.fake.log.filter((l) => l.method === 'POST').length;

    await assert.rejects(w.submit(w.a, d, 'reject', { rationale: REASON }, openedByA), (e: unknown) => {
      assert.ok(e instanceof ServiceError);
      assert.equal(e.code, 'stale-revision');
      assert.equal(e.status, 409);
      const c = e.extra.conflict as { current: { status: string; lastEvent: { action: string; by: string } }; proposed: { action: string; rationale: string } };
      assert.equal(c.current.status, 'Approved', 'the current value is shown');
      assert.equal(c.current.lastEvent.action, 'approve');
      assert.equal(c.proposed.action, 'reject', 'the proposed value is shown');
      assert.equal(c.proposed.rationale, REASON);
      assert.match(String(e.extra.currentRevision), /^[0-9a-f]{32}$/);
      return true;
    });
    assert.equal(w.fake.log.filter((l) => l.method === 'POST').length, writesBefore, 'no write reached GitHub');
    assert.ok(w.a.store.readAudit({ limit: 20 }).some((e) => e.outcome === 'stale'), 'the refusal is in the audit log');
    assert.equal(w.a.svc.canonical().states.get('ADR-0311')!.effectiveStatus, 'Approved', 'the newer content was not overwritten');
  });

  it('the source record changed on GitHub after it was read: refused as source-changed, with both blobs', async () => {
    const w = await appWorld();
    w.fx.commitToMain({ 'docs/adr/x.md': '# v1\n' });
    git(w.fx.work, 'fetch', '-q', 'origin');
    const blob = git(w.fx.work, 'rev-parse', 'origin/main:docs/adr/x.md');
    const d = makeDecision({ id: 'ADR-0312', source: { path: 'docs/adr/x.md', line: 1, commit: git(w.fx.work, 'rev-parse', 'origin/main'), blob } });
    const u = await w.owner();
    const rev = w.a.svc.view(d, u).revision;
    w.fx.commitToMain({ 'docs/adr/x.md': '# v2, edited by someone else\n' });
    await assert.rejects(w.submit(w.a, d, 'approve', {}, rev), (e: unknown) => {
      assert.ok(e instanceof ServiceError && e.code === 'source-changed');
      const c = e.extra.conflict as { current: { source: { canonicalBlob: string; readBlob: string } } };
      assert.equal(c.current.source.readBlob, blob);
      assert.notEqual(c.current.source.canonicalBlob, blob);
      return true;
    });
    assert.equal(w.fake.pulls.length, 0);
    assert.deepEqual(w.fake.refWrites(), []);
  });

  it('GitHub moved between submitting and sending: the sync reports a conflict and writes nothing', async () => {
    const w = await appWorld();
    const b = w.mk('review-b');
    const d = makeDecision({ id: 'ADR-0313' });
    const mine = (await w.submit(w.a, d, 'reject', { rationale: REASON })).proposal;
    const theirs = (await w.submit(b, d, 'approve')).proposal;
    const sent = await b.svc.sync(theirs.id);
    w.fake.merge(sent.prNumber!);
    await b.svc.sync(theirs.id);
    const writes = w.fake.refWrites().length;
    const r = await w.a.svc.sync(mine.id);
    assert.equal(r.state, 'conflicted');
    assert.equal(r.lastError?.code === 'CANONICAL_MOVED' || r.lastError?.code === 'SEQUENCE_TAKEN', true);
    assert.equal(w.fake.refWrites().length, writes, 'the stale proposal pushed nothing');
    assert.equal(w.a.svc.canonical().states.get('ADR-0313')!.effectiveStatus, 'Approved');
    assert.ok(w.a.store.readAudit({ decisionId: 'ADR-0313', limit: 20 }).some((e) => e.code === 'conflicted'));
  });
});

describe('failure handling', () => {
  it('a network failure keeps the proposal, says so, and a later retry completes it without duplicates', async () => {
    const w = await appWorld();
    const d = makeDecision({ id: 'ADR-0321' });
    const { proposal } = await w.submit(w.a, d, 'approve');
    w.fake.dropNext(50);
    const failed = await w.a.svc.sync(proposal.id);
    assert.equal(failed.state, 'awaiting-github-update');
    assert.equal(failed.lastError?.code, 'NETWORK');
    assert.equal(failed.lastError?.retryable, true);
    assert.equal(w.fake.pulls.length, 0);
    w.fake.dropNext(-1000);
    const ok = await w.a.svc.sync(proposal.id);
    assert.equal(ok.state, 'pull-request-created');
    assert.equal(w.fake.pulls.length, 1);
    assert.equal(branchesCreated(w.fake).length, 1, 'one branch, however many attempts');
    assert.equal(ok.lastError, null);
  });

  it('a dropped connection on a write is not retried blindly, and the next attempt does not create a second pull request', async () => {
    const w = await appWorld();
    const d = makeDecision({ id: 'ADR-0322' });
    const { proposal } = await w.submit(w.a, d, 'approve');
    // let the GETs through, drop the first POST
    let seen = 0;
    const real = w.api;
    const orig = real.request.bind(real);
    real.request = (async (...args: Parameters<typeof orig>) => {
      if (args[0] === 'POST' && seen++ === 0) throw new GitHubError('Could not reach GitHub (network error or timeout). Nothing was lost; try again.', true, { code: 'NETWORK' });
      return orig(...args);
    }) as typeof orig;
    const first = await w.a.svc.sync(proposal.id);
    assert.equal(first.lastError?.code, 'NETWORK');
    const second = await w.a.svc.sync(proposal.id);
    assert.equal(second.state, 'pull-request-created');
    assert.equal(w.fake.pulls.length, 1);
  });

  it('expired credentials: the installation token is renewed once and the request succeeds', async () => {
    const w = await appWorld();
    const d = makeDecision({ id: 'ADR-0323' });
    await w.auth.token();
    w.fake.expireTokens();
    const { proposal } = await w.submit(w.a, d, 'approve');
    const sent = await w.a.svc.sync(proposal.id);
    assert.equal(sent.state, 'pull-request-created');
    assert.equal(w.fake.tokensIssued, 2, 'one renewal');
  });

  it('revoked credentials are reported as a credential problem that a person can fix, not as success and not as lost work', async () => {
    const w = await appWorld();
    const d = makeDecision({ id: 'ADR-0324' });
    await w.auth.token();
    w.fake.expireTokens();
    w.fake.breakAuth();
    const { proposal } = await w.submit(w.a, d, 'approve');
    const r = await w.a.svc.sync(proposal.id);
    assert.equal(r.lastError?.code, 'AUTH');
    assert.equal(r.lastError?.retryable, true);
    assert.match(r.lastError!.message, /nothing was lost/i);
    assert.notEqual(r.state, 'applied');
    assert.equal(w.fake.pulls.length, 0);
    w.fake.breakAuth(false);
    assert.equal((await w.a.svc.sync(proposal.id)).state, 'pull-request-created', 'resumes once the credentials are fixed');
  });

  it('a duplicate request returns the proposal it already made', async () => {
    const w = await appWorld();
    const d = makeDecision({ id: 'ADR-0325' });
    const u = await w.owner();
    const req = { action: 'approve' as const, expectedRevision: w.a.svc.view(d, u).revision, idempotencyKey: 'same-key-12345678' };
    const one = await w.a.svc.submit(u, d, req);
    const two = await w.a.svc.submit(u, d, req);
    assert.equal(two.duplicate, true);
    assert.equal(two.proposal.id, one.proposal.id);
    await w.a.svc.sync(one.proposal.id);
    await w.a.svc.sync(one.proposal.id);
    assert.equal(w.fake.pulls.length, 1);
    assert.equal(branchesCreated(w.fake).length, 1);
  });

  it('creating the same pull request twice (a lost response) returns the existing one', async () => {
    const w = await appWorld();
    const d = makeDecision({ id: 'ADR-0326' });
    const { proposal } = await w.submit(w.a, d, 'approve');
    const sent = await w.a.svc.sync(proposal.id);
    const again = await w.github.createPullRequest({ base: 'main', head: sent.branch, title: 'x', body: 'y' });
    assert.equal(again.number, sent.prNumber);
    assert.equal(w.fake.pulls.length, 1);
  });

  it('failed CI is shown as failed and the proposal stays open; the Studio does not merge, and passing checks and a review then show as passing', async () => {
    const w = await appWorld();
    const d = makeDecision({ id: 'ADR-0327' });
    const { proposal } = await w.submit(w.a, d, 'approve');
    const sent = await w.a.svc.sync(proposal.id);
    w.fake.setChecks(sent.headSha!, [{ name: 'validate', status: 'completed', conclusion: 'failure' }, { name: 'infra-validate', status: 'completed', conclusion: 'success' }]);
    const failing = await w.a.svc.sync(proposal.id);
    assert.equal(failing.state, 'awaiting-merge');
    assert.equal(failing.validation?.state, 'failure');
    assert.deepEqual(failing.validation?.checks.filter((c) => c.state === 'failure').map((c) => c.name), ['validate']);
    assert.equal(w.a.svc.canonical().states.get('ADR-0327'), undefined);
    assert.ok(w.a.store.readAudit({ decisionId: 'ADR-0327', limit: 30 }).some((e) => e.code === 'validation-failure' && e.facts?.validation === 'failure'));

    w.fake.setChecks(sent.headSha!, [{ name: 'validate', status: 'in_progress', conclusion: null }]);
    assert.equal((await w.a.svc.sync(proposal.id)).validation?.state, 'pending');
    w.fake.setChecks(sent.headSha!, [{ name: 'validate', status: 'completed', conclusion: 'success' }]);
    w.fake.setReviews(sent.prNumber!, [{ state: 'APPROVED', user: { id: 7 } }, { state: 'CHANGES_REQUESTED', user: { id: 8 } }, { state: 'APPROVED', user: { id: 8 } }]);
    const ok = await w.a.svc.sync(proposal.id);
    assert.equal(ok.validation?.state, 'success');
    assert.deepEqual(ok.validation?.reviews, { approvals: 2, changesRequested: 0 }, 'only each reviewer’s latest review counts');
    assert.equal(ok.state, 'awaiting-merge', 'passing checks are not a merge');
    assert.ok(w.fake.log.every((l) => !/merge/.test(l.path)), 'there is no merge call');
  });

  it('a pull request closed without merging is Failed, applies nothing, and is audited', async () => {
    const w = await appWorld();
    const d = makeDecision({ id: 'ADR-0328' });
    const { proposal } = await w.submit(w.a, d, 'approve');
    const sent = await w.a.svc.sync(proposal.id);
    w.fake.close(sent.prNumber!);
    const r = await w.a.svc.sync(proposal.id);
    assert.equal(r.state, 'failed');
    assert.equal(r.lastError?.code, 'PR_CLOSED');
    assert.equal(w.a.svc.canonical().states.get('ADR-0328'), undefined);
    assert.ok(w.a.store.readAudit({ decisionId: 'ADR-0328', limit: 30 }).some((e) => e.code === 'pr-closed-unmerged'));
    // and the decision is free to be decided again
    const again = await w.submit(w.a, d, 'approve');
    assert.equal(again.proposal.state, 'locally-submitted');
  });
});

describe('rate limits and server errors', () => {
  it('waits out a short Retry-After and then succeeds, without failing the proposal', async () => {
    const w = await appWorld();
    const d = makeDecision({ id: 'ADR-0331' });
    const { proposal } = await w.submit(w.a, d, 'approve');
    w.fake.rateLimitNext(1, { status: 429, retryAfter: 2 });
    const r = await w.a.svc.sync(proposal.id);
    assert.equal(r.state, 'pull-request-created');
    assert.ok(w.sleeps.includes(2000), 'it waited the time GitHub asked for');
  });

  it('a long rate limit is reported with when to try again, keeps the proposal open and is not a failure', async () => {
    const w = await appWorld();
    const d = makeDecision({ id: 'ADR-0332' });
    const { proposal } = await w.submit(w.a, d, 'approve');
    w.fake.rateLimitNext(100, { status: 403, resetInSeconds: 3600 });
    const r = await w.a.svc.sync(proposal.id);
    assert.equal(r.state, 'awaiting-github-update');
    assert.equal(r.lastError?.code, 'RATE_LIMIT');
    assert.equal(r.lastError?.retryable, true);
    assert.match(r.lastError!.message, /try again in \d+ seconds/i);
    assert.equal(w.fake.pulls.length, 0);
    assert.ok(w.api.rate?.limited, 'the limit is remembered for the status display');
  });

  it('retries a GET after a server error, but reports a server error on a write', async () => {
    const w = await appWorld();
    w.fake.failNext(2, 502, 'Bad Gateway');
    const p = await w.github.findByHead('nothing');
    assert.equal(p, null);
    assert.ok(w.sleeps.length >= 2);
    w.fake.failNext(1, 500);
    await assert.rejects(w.api.request('POST', `/repos/${REPO}/git/blobs`, { content: 'x', encoding: 'utf-8' }), (e: unknown) => e instanceof GitHubError && e.code === 'SERVER' && e.retryable);
  });

  it('error messages never contain a token', async () => {
    const w = await appWorld();
    const tok = await w.auth.token();
    w.fake.failNext(1, 422, 'Validation Failed');
    await assert.rejects(w.api.request('POST', `/repos/${REPO}/git/blobs`, {}), (e: unknown) => e instanceof Error && !e.message.includes(tok));
  });
});

describe('what the app is allowed to do', () => {
  it('refuses any branch outside its two prefixes and never moves an existing branch', async () => {
    const w = await appWorld();
    const sha = git(w.fx.remote, 'rev-parse', 'refs/heads/main');
    for (const b of ['main', 'release/1', 'decision-review/../main', 'decision-review/x']) await assert.rejects(w.publisher.push('origin', sha, b), (e: unknown) => e instanceof PublishError && e.code === 'BAD_INPUT');
    assert.deepEqual(w.fake.refWrites(), [], 'no request was even made');
    const d = makeDecision({ id: 'ADR-0341' });
    const { proposal } = await w.submit(w.a, d, 'approve');
    const sent = await w.a.svc.sync(proposal.id);
    const other = git(w.fx.remote, 'rev-parse', 'refs/heads/main');
    await assert.rejects(w.publisher.push('origin', other, sent.branch), (e: unknown) => e instanceof PublishError && e.code === 'PUSH_REJECTED');
    assert.equal(git(w.fx.remote, 'rev-parse', `refs/heads/${sent.branch}`), sent.headSha, 'the existing branch is unchanged');
    await w.publisher.push('origin', sent.headSha!, sent.branch); // the same commit again is simply already done
  });

  it('refuses to write any file outside the review-record folders, and never overwrites one', async () => {
    const w = await appWorld();
    const base = git(w.fx.remote, 'rev-parse', 'refs/heads/main');
    const mk = (p: string) => w.publisher.buildCommit({ baseSha: base, files: [{ path: p, content: 'x' }], author: { name: 'a', email: 'a@x.invalid' }, message: 'm', now: new Date() });
    for (const p of ['docs/adr/0001.md', '.github/workflows/x.yml', 'harness/policy/decision-workflow.json', 'docs/decision-reviews/../adr/x.json']) await assert.rejects(mk(p), (e: unknown) => e instanceof PublishError && e.code === 'BAD_INPUT');
    const d = makeDecision({ id: 'ADR-0342' });
    const { proposal } = await w.submit(w.a, d, 'approve');
    const sent = await w.a.svc.sync(proposal.id);
    w.fake.merge(sent.prNumber!);
    await w.a.svc.sync(proposal.id);
    await assert.rejects(w.publisher.buildCommit({ baseSha: git(w.fx.remote, 'rev-parse', 'refs/heads/main'), files: [{ path: eventPath('ADR-0342', 1, 'approve'), content: 'tampered' }], author: { name: 'a', email: 'a@x.invalid' }, message: 'm', now: new Date() }), (e: unknown) => e instanceof PublishError && /already exists/.test(e.message));
  });

  it('fetches the canonical branch through the app publisher', async () => {
    const w = await appWorld();
    w.fx.commitToMain({ 'note.txt': 'hello' });
    assert.equal(await w.publisher.fetchCanonical('origin/main'), git(w.fx.remote, 'rev-parse', 'refs/heads/main'));
  });

  it('work-item actions travel the same way', async () => {
    const w = await appWorld();
    const u = await w.owner();
    const item = { id: 'T900', kind: 'task', status: 'Open', source: { path: 'docs/state/TODO.md', line: 1 }, contentHash: 'h', assignee: null, priority: null, sourceStatus: 'open' } as never;
    const view = w.a.work.view(item, u);
    const { proposal } = await w.a.work.submit(u, item, { action: 'comment', comment: 'Noting this.', expectedRevision: view.revision, idempotencyKey: w.key() }, { evidenceRuns: new Map(), knownItems: new Set() });
    const sent = await w.a.work.sync(proposal.id);
    assert.equal(sent.state, 'pull-request-created');
    assert.match(sent.branch, /^work-item\/T900\//);
    assert.deepEqual(branchesCreated(w.fake), [`refs/heads/${sent.branch}`]);
  });
});

describe('webhooks', () => {
  const secret = 'whsec-test-secret';
  const body = JSON.stringify({ action: 'closed', number: 7, repository: { full_name: REPO }, pull_request: { number: 7, head: { sha: 'a'.repeat(40) } } });

  it('accepts only a correct signature over the exact raw body', () => {
    assert.equal(verifySignature(secret, body, signBody(secret, body)), true);
    assert.equal(verifySignature(secret, body + ' ', signBody(secret, body)), false, 'a changed body');
    assert.equal(verifySignature('other-secret', body, signBody(secret, body)), false, 'a different secret');
    assert.equal(verifySignature(secret, body, null), false);
    assert.equal(verifySignature(secret, body, ''), false);
    assert.equal(verifySignature(secret, body, 'sha256=abc'), false, 'too short');
    assert.equal(verifySignature(secret, body, `sha1=${'a'.repeat(40)}`), false, 'the old sha1 scheme');
    assert.equal(verifySignature(secret, body, signBody(secret, body).toUpperCase().replace('SHA256=', 'sha256=')), true, 'hex case does not matter');
    assert.equal(verifySignature('', body, signBody('', body)), false, 'no secret configured means nothing verifies');
  });

  it('extracts only identifiers from a payload and ignores everything else', () => {
    const t = targetOf('pull_request', JSON.parse(body));
    assert.deepEqual({ prs: t.prNumbers, shas: t.headShas, repo: t.repo, action: t.action }, { prs: [7], shas: ['a'.repeat(40)], repo: REPO, action: 'closed' });
    const junk = targetOf('check_run', { check_run: { head_sha: '<script>', check_suite: { pull_requests: [{ number: -3 }, { number: '5' }, { number: 9 }] } }, ref: 'x' });
    assert.deepEqual(junk.prNumbers, [9]);
    assert.deepEqual(junk.headShas, []);
    assert.equal(targetOf('push', { ref: 'refs/heads/main' }).pushedRef, 'refs/heads/main');
    assert.equal(isHandledEvent('pull_request'), true);
    assert.equal(isHandledEvent('workflow_run'), false);
  });

  it('remembers deliveries so a replay is recognised, keeping a bounded list', () => {
    const w = path.join(fs.mkdtempSync(path.join(process.env.TEMP ?? '.', 'whl-')), 'd.json');
    const log = new DeliveryLog(w, 3);
    assert.equal(log.seen('d-1'), false);
    log.record('d-1');
    assert.equal(log.seen('d-1'), true);
    for (const id of ['d-2', 'd-3', 'd-4']) log.record(id);
    assert.equal(log.seen('d-1'), false, 'oldest dropped');
    assert.equal(log.seen('d-4'), true);
    fs.rmSync(path.dirname(w), { recursive: true, force: true });
  });
});

describe('reconciliation', () => {
  it('advances open proposals from what GitHub says, reports pull requests it does not know about, and does not adopt them', async () => {
    const w = await appWorld();
    const d1 = makeDecision({ id: 'ADR-0351' });
    const d2 = makeDecision({ id: 'ADR-0352' });
    const p1 = (await w.submit(w.a, d1, 'approve')).proposal;
    const p2 = (await w.submit(w.a, d2, 'reject', { rationale: REASON })).proposal;
    const s1 = await w.a.svc.sync(p1.id);
    const s2 = await w.a.svc.sync(p2.id);
    w.fake.merge(s1.prNumber!);
    w.fake.close(s2.prNumber!);
    // a pull request created by someone else with the Studio's branch naming, with no local proposal
    const foreign = w.fx.pushBranch('decision-review/ADR-0999/0001-approve-deadbeef', { [eventPath('ADR-0999', 1, 'approve')]: '{}' });
    await w.github.createPullRequest({ base: 'main', head: 'decision-review/ADR-0999/0001-approve-deadbeef', title: 't', body: 'b' });
    assert.ok(foreign);

    const report = await reconcile({ service: w.a.svc, work: w.a.work, github: w.github }, { trigger: 'test' });
    assert.equal(report.checked, 2);
    assert.deepEqual(report.advanced.map((a) => `${a.subject}:${a.to}`).sort(), ['ADR-0351:applied', 'ADR-0352:failed']);
    assert.equal(report.anyApplied, true);
    assert.deepEqual(report.orphans.map((o) => o.head), ['decision-review/ADR-0999/0001-approve-deadbeef']);
    assert.equal(report.orphanCheck, 'done');
    assert.equal(w.a.svc.canonical().states.get('ADR-0999'), undefined, 'an unknown pull request is never adopted');
    const again = await reconcile({ service: w.a.svc, work: w.a.work, github: w.github }, { trigger: 'test' });
    assert.equal(again.checked, 0, 'nothing is open any more, and running it again is harmless');
  });

  it('can be narrowed to the pull request a webhook named, and reports (rather than hides) a failure', async () => {
    const w = await appWorld();
    const d1 = makeDecision({ id: 'ADR-0353' });
    const d2 = makeDecision({ id: 'ADR-0354' });
    const p1 = (await w.submit(w.a, d1, 'approve')).proposal;
    const p2 = (await w.submit(w.a, d2, 'approve')).proposal;
    const s1 = await w.a.svc.sync(p1.id);
    await w.a.svc.sync(p2.id);
    const only = await reconcile({ service: w.a.svc, work: w.a.work, github: w.github }, { trigger: 'webhook', prNumbers: [s1.prNumber!] });
    assert.equal(only.checked, 1);
    w.fake.rateLimitNext(100, { status: 429, retryAfter: 3600 });
    const limited = await reconcile({ service: w.a.svc, work: w.a.work, github: w.github }, { trigger: 'test' });
    assert.ok(limited.failures.length > 0 && limited.failures.every((f) => f.retryable));
    assert.equal(typeof limited.orphanCheck === 'object' && 'failed' in limited.orphanCheck, true, 'the orphan check says it could not run');
  });
});
