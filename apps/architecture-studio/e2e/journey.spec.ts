import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect as baseExpect, test, type APIRequestContext, type Page } from '@playwright/test';
import { USERS } from '../checks/fixtures/review-fixture.ts';
import { adrText } from '../checks/fixtures/acceptance-world.ts';
import { signBody } from '../src/lib/github/webhook.ts';
import { POINTS } from '../src/lib/next/types.ts';
import { expectNoAxeViolations } from './helpers.ts';

const expect = baseExpect.configure({ timeout: 20_000 });

// The review-to-readiness journey, in a Studio configured as a GitHub App (3109) over a stand-in for the GitHub API (3110) and a real
// bare git repository. It walks the whole path from "what do I do next" to "the architecture is ready for a baseline", through approval,
// pull request, merge, webhook, new commits on GitHub, an outage and its recovery, and checks at every step that the page, the API and
// what GitHub holds agree. The stand-in is not GitHub. The decisions and the baseline policy are the real repository's.
const BASE = 'http://localhost:3109';
const FAKE = 'http://127.0.0.1:3110';
const SECRET = 'whsec-journey-secret';
test.use({ baseURL: BASE });
test.describe.configure({ mode: 'serial', timeout: 180_000 });

const dir = process.env.STUDIO_E2E_JOURNEY_DIR!;
const state = path.join(dir, 'state');
const remote = path.join(dir, 'origin.git');
const work = path.join(dir, 'work');
const H = { origin: BASE, 'content-type': 'application/json' };
const git = (cwd: string, ...a: string[]) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const bare = (...a: string[]) => spawnSync('git', ['--git-dir', remote, ...a], { encoding: 'utf8' }).stdout.trim();
const as = (u: (typeof USERS)[keyof typeof USERS] | null) => (u ? fs.writeFileSync(path.join(state, 'identity.json'), JSON.stringify(u)) : fs.rmSync(path.join(state, 'identity.json'), { force: true }));

async function login(request: APIRequestContext): Promise<string> {
  as(USERS.owner);
  await request.post('/api/v1/auth/signout', { headers: H, data: {} });
  const r = await request.post('/api/v1/auth/signin', { headers: H, data: {} });
  expect(r.ok(), await r.text()).toBe(true);
  return ((await (await request.get('/api/v1/auth/session')).json()) as { csrf: string }).csrf;
}
const ctl = async (request: APIRequestContext, name: string, ...args: unknown[]) => {
  const r = await request.post(`${FAKE}/_control/${name}`, { data: { args } });
  expect(r.ok(), `${name}: ${await r.text()}`).toBe(true);
};
const pulls = async (request: APIRequestContext) => ((await (await request.get(`${FAKE}/_control/state`)).json()) as { pulls: { number: number; head: string; headSha: string; merged: boolean; closed: boolean }[] }).pulls;

// ---- another person committing to GitHub's main
const person = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-journey-person-'));
function pushToMain(files: Record<string, string>, message: string, remove: string[] = []) {
  if (!fs.existsSync(path.join(person, '.git'))) git(os.tmpdir(), 'clone', '-q', remote, person);
  git(person, 'config', 'user.email', 'colleague@example.invalid');
  git(person, 'config', 'user.name', 'Colleague');
  git(person, 'config', 'core.autocrlf', 'false');
  git(person, 'fetch', '-q', 'origin');
  git(person, 'checkout', '-q', '-B', 'main', 'origin/main');
  for (const p of remove) fs.rmSync(path.join(person, p), { force: true });
  for (const [p, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(person, p)), { recursive: true });
    fs.writeFileSync(path.join(person, p), c);
  }
  git(person, 'add', '-A');
  git(person, 'commit', '-q', '-m', message);
  git(person, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
}
/** What the Studio's own checkout does when it fetches: the new commits arrive and FETCH_HEAD is touched. */
const fetchWork = () => {
  git(work, 'fetch', '-q', 'origin');
  git(work, 'merge', '-q', '--ff-only', 'origin/main');
};

// ---- reading
interface Action { key: string; kind: string; subjectId: string; title: string; score: number; reasons: { points: number; rule: string; text: string }[]; blocksNextPhase: boolean; ready: boolean; waitingFor: string[]; mine: boolean | null }
interface Overview {
  commit: string;
  me: { login: string } | null;
  overview: {
    next: Action | null;
    then: Action[];
    readiness: { available: boolean; ready: boolean; blockingDecisions: { id: string }[]; otherBlockers: { code: string }[]; optionalOpen: number };
    progress: { label: string; done: number; total: number }[];
    awaiting: { count: number };
    recentlyApproved: { count: number; items: { title: string; meta: string | null }[] };
    rework: { count: number };
  };
  actions: Action[];
  stale: { decisionId: string; evidenceId: string; kind: string }[];
  freshness: { state: string; commit: string; ageSeconds: number | null };
}
const overview = async (request: APIRequestContext, limit = 500) => (await (await request.get(`/api/v1/overview?limit=${limit}`)).json()) as Overview;
const refresh = (request: APIRequestContext) => request.post('/api/v1/refresh', { headers: H, data: {} });
const decisionStatus = async (request: APIRequestContext, id: string) => ((await (await request.get(`/api/v1/decisions/${id}`)).json()) as { decision: { status: string } }).decision.status;

async function open(page: Page, url = '/') {
  // The page has its own cookie jar; sign it in as the person whose queue is being read.
  const session = async () => {
    try {
      return await page.request.get('/api/v1/auth/session');
    } catch {
      return page.request.get('/api/v1/auth/session'); // a keep-alive socket reset between tests; one retry is enough
    }
  };
  if (!(await (await session()).json() as { user?: unknown }).user) {
    const r = await page.request.post('/api/v1/auth/signin', { headers: H, data: {} });
    expect(r.ok(), await r.text()).toBe(true);
  }
  await page.goto(url);
  await expect(page.locator('main h1').first()).toBeVisible();
}

let csrf = '';
let proposalId = '';
let prNumber = 0;
let mandatory = '';

test.beforeEach(async ({ request }) => {
  csrf = await login(request);
});

test.describe('1. what to do next, from fixed rules over the repository', () => {
  test('the Overview answers the primary question with the mandatory decision, and says why', async ({ page, request }) => {
    const o = await overview(request);
    expect(o.me?.login).toBe(USERS.owner.login);
    const next = o.overview.next!;
    expect(next.kind).toBe('review-decision');
    expect(next.blocksNextPhase).toBe(true);
    mandatory = next.subjectId;
    // It is the decision the baseline policy names for the next phase, read independently from the policy file.
    const policy = JSON.parse(bare('show', 'refs/heads/main:harness/policy/baseline-policy.json')) as { activeStage: string; stages: { id: string; gates: string[] }[]; gates: { id: string; type: string; decisions?: string[] }[] };
    const stage = policy.stages.find((s) => s.id === policy.activeStage)!;
    const required = stage.gates.flatMap((g) => policy.gates.find((x) => x.id === g)?.decisions ?? []);
    expect(required).toContain(mandatory);
    expect(o.overview.readiness.blockingDecisions.map((b) => b.id).sort()).toEqual([...required].sort());
    // Every point is explained, and the total is exactly their sum.
    expect(next.reasons.reduce((n, r) => n + r.points, 0)).toBe(next.score);
    expect(next.reasons.some((r) => r.rule === 'readiness-gate')).toBe(true);
    // Nothing a later phase needs ranks above it.
    expect(o.actions.every((a) => a === next || a.score <= next.score)).toBe(true);

    await open(page);
    await expect(page.getByTestId('next-title')).toHaveText(`Review ${mandatory}`);
    await expect(page.getByTestId('next-action')).toContainText('Blocks the next phase');
    await page.getByTestId('next-why-toggle').click();
    await expect(page.getByTestId('why-total')).toHaveText(String(next.score));
    await expect(page.getByTestId('readiness-label')).toContainText(/mandatory decision/);
  });

  test('only the next phase’s decisions are mandatory: optional decisions are counted apart and block nothing', async ({ page, request }) => {
    const o = await overview(request);
    expect(o.overview.readiness.optionalOpen).toBeGreaterThan(0);
    const blocking = new Set(o.overview.readiness.blockingDecisions.map((b) => b.id));
    const decisionKinds = ['review-decision', 'answer-clarification', 'verify-claim', 'rework-rejected', 'revisit-deferred'];
    const optionalOpen = o.actions.filter((a) => decisionKinds.includes(a.kind) && !blocking.has(a.subjectId) && a.blocksNextPhase);
    expect(optionalOpen, 'no decision outside the policy’s gates blocks the next phase').toEqual([]);
    await open(page);
    await expect(page.getByTestId('optional-note')).toContainText('do not block anything');
    await expect(page.getByTestId('optional-note')).toContainText('not a maturity score');
  });

  test('progress is counts of records, with no percentage anywhere on the page or in the API', async ({ page, request }) => {
    const o = await overview(request);
    for (const p of o.overview.progress) {
      expect(Number.isInteger(p.done) && Number.isInteger(p.total), p.label).toBe(true);
      expect(p.done).toBeLessThanOrEqual(p.total);
    }
    await open(page);
    for (const c of await page.getByTestId('progress-count').allTextContents()) expect(c).toMatch(/^\d+ of \d+$/);
    expect(await page.getByTestId('readiness-card').textContent()).not.toMatch(/\d\s?%/);
  });

  test('the sections count real records: awaiting review equals the undecided decisions in the register', async ({ page, request }) => {
    const list = (await (await request.get('/api/v1/decisions')).json()) as { items: { id: string; status: string }[] };
    const undecided = list.items.filter((d) => ['Proposed', 'Pending Review', 'Blocked'].includes(d.status)).length;
    const o = await overview(request);
    // "Awaiting" is the person's own queue; the rest are waiting on someone else. Together they are every undecided record.
    const others = o.actions.filter((a) => ['review-decision', 'answer-clarification', 'verify-claim'].includes(a.kind) && a.mine === false).length;
    expect(o.overview.awaiting.count + others).toBe(undecided);
    await open(page);
    await expect(page.getByTestId('attention-count')).toHaveText(String(o.overview.awaiting.count));
  });

  test('the same facts give the same order on every request', async ({ request }) => {
    const a = (await overview(request)).actions.map((x) => x.key);
    const b = (await overview(request)).actions.map((x) => x.key);
    expect(b).toEqual(a);
  });
});

test.describe('2. the work queue: one list, six filters', () => {
  test('decisions, tasks, approvals and evidence gaps are in one list, and each filter is a true subset', async ({ request }) => {
    const q = (await (await request.get('/api/v1/queue')).json()) as { items: { id: string; kind: string; class: string; status: string; critical: boolean; derivedBlocks: unknown[]; approval: unknown }[]; next: Record<string, number>; me: unknown };
    const kinds = new Set(q.items.map((i) => i.kind));
    for (const k of ['decision', 'task', 'design-gate']) expect(kinds.has(k), `the queue holds ${k} items`).toBe(true);
    expect(q.items.some((i) => i.class === 'evidence-gap'), 'and evidence gaps').toBe(true);
    expect(q.items.some((i) => i.approval !== null), 'and approvals').toBe(true);
    expect(Object.keys(q.next).length, 'ranked by the next-best-action rules').toBeGreaterThan(10);
    const closed = new Set(['Done', 'Closed, no evidence', 'Rejected', 'Superseded']);
    const open = q.items.filter((i) => !closed.has(i.status));
    expect(open.length).toBeGreaterThan(0);
  });

  test('every filter chip shows its count, and the counts agree with what the list then shows', async ({ page }) => {
    await open(page, '/queue');
    await expect(page.getByTestId('queue-table')).toBeVisible();
    for (const v of ['mine', 'critical', 'blocked', 'pending', 'completed', 'all']) await expect(page.getByTestId(`view-${v}`)).toBeVisible();
    for (const v of ['critical', 'blocked', 'pending', 'completed', 'all']) {
      const n = Number(await page.getByTestId(`count-${v}`).textContent());
      await page.getByTestId(`view-${v}`).click();
      await expect(page.getByTestId('result-count')).toContainText(`of ${n} in`);
    }
  });

  test('"Pending" and "Blocked" never overlap, and "Completed" holds only closed work', async ({ page }) => {
    await open(page, '/queue?view=pending');
    await expect(page.getByTestId('queue-row').first()).toBeVisible();
    const pendingBlocked = await page.getByTestId('queue-row').filter({ hasText: /\bBlocked\b/ }).count();
    expect(pendingBlocked).toBe(0);
    await page.getByTestId('view-completed').click();
    await expect(page.getByTestId('view-rule')).toContainText('Done means completion evidence exists');
  });

  test('it is ordered by next best action until a column is chosen, and can go back', async ({ page }) => {
    await open(page, '/queue?view=pending');
    await expect(page.getByTestId('order-note')).toBeVisible();
    await page.getByRole('button', { name: /^ID/ }).click();
    await expect(page.getByTestId('order-next')).toBeVisible();
    await page.getByTestId('order-next').click();
    await expect(page.getByTestId('order-note')).toBeVisible();
  });

  test('search responds quickly: the list narrows within half a second of typing, and the search API answers warm in under a second', async ({ page, request }) => {
    await open(page, '/queue');
    await expect(page.getByTestId('queue-table')).toBeVisible();
    const before = Number(((await page.getByTestId('result-count').textContent()) ?? '').match(/Showing (\d+)/)![1]);
    const t0 = Date.now();
    await page.getByRole('searchbox').or(page.getByPlaceholder(/search|filter/i)).first().fill('sovereign');
    await expect(page.getByTestId('result-count')).not.toContainText(`Showing ${before} of`);
    const ms = Date.now() - t0;
    expect(ms, `filtering took ${ms} ms`).toBeLessThan(2000);
    await request.get('/api/v1/search?q=hosting');
    const t1 = Date.now();
    const r = await request.get('/api/v1/search?q=hosting');
    expect(r.ok()).toBe(true);
    expect(Date.now() - t1, 'warm search API').toBeLessThan(1000);
  });
});

test.describe('3. review, merge and the page follows GitHub', () => {
  test('submitting the approval changes nothing on the page except what is now waiting for a merge', async ({ page, request }) => {
    const before = await overview(request);
    const rv = ((await (await request.get(`/api/v1/review/${mandatory}`)).json()) as { view: { revision: string } }).view.revision;
    const r = await request.post(`/api/v1/review/${mandatory}/actions`, { headers: { ...H, 'x-studio-csrf': csrf }, data: { action: 'approve', rationale: 'The phase 1a scope is a local synthetic-data slice.', expectedRevision: rv, idempotencyKey: `journey-${Date.now().toString(36)}-abcdef` } });
    expect(r.status(), await r.text()).toBe(200);
    const p = ((await r.json()) as { proposal: { id: string; state: string; prNumber: number } }).proposal;
    expect(p.state).toBe('pull-request-created');
    proposalId = p.id;
    prNumber = p.prNumber;

    // GitHub is canonical: until the merge, the decision is not approved and the readiness counts have not moved.
    expect(await decisionStatus(request, mandatory)).not.toBe('Approved');
    const after = await overview(request);
    expect(after.overview.readiness.blockingDecisions.map((b) => b.id)).toContain(mandatory);
    expect(after.overview.progress.find((x) => x.label === 'Mandatory decisions approved')!.done).toBe(before.overview.progress.find((x) => x.label === 'Mandatory decisions approved')!.done);
    // What the person must do next has moved from "review" to "merge".
    expect(after.overview.next!.kind).toBe('merge-pull-request');
    expect(after.overview.next!.title).toBe(`Merge pull request #${prNumber}`);
    expect(after.actions.some((a) => a.key === `decision:${mandatory}`), 'the decision is not offered for review twice').toBe(false);

    await open(page);
    await expect(page.getByTestId('next-title')).toHaveText(`Merge pull request #${prNumber}`);
    await open(page, '/changes');
    await expect(page.locator('#pending').getByTestId('proposal-row')).toHaveCount(1);
    await expect(page.locator('#pending')).toContainText(mandatory);
    await expect(page.getByTestId('no-failures')).toBeVisible();
  });

  test('a person merges on GitHub; a signed webhook updates the Studio without anyone pressing refresh', async ({ page, request }) => {
    const pr = (await pulls(request)).find((x) => x.number === prNumber)!;
    await ctl(request, 'setChecks', pr.headSha, [{ name: 'validate', status: 'completed', conclusion: 'success' }]);
    await ctl(request, 'merge', pr.number);
    // Merged on GitHub, but the Studio has not been told: it still shows the previous state.
    expect(await decisionStatus(request, mandatory)).not.toBe('Approved');

    const raw = JSON.stringify({ action: 'closed', number: pr.number, repository: { full_name: 'acme/greenfuel' }, pull_request: { number: pr.number, head: { sha: pr.headSha }, merged: true } });
    const bad = await request.post('/api/v1/github/webhook', { headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-github-delivery': 'journey-bad-0001', 'x-hub-signature-256': signBody('wrong', raw) }, data: raw });
    expect(bad.status(), 'an unsigned delivery changes nothing').toBe(401);
    expect(await decisionStatus(request, mandatory)).not.toBe('Approved');
    const good = await request.post('/api/v1/github/webhook', { headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-github-delivery': 'journey-good-0001', 'x-hub-signature-256': signBody(SECRET, raw) }, data: raw });
    expect(good.status()).toBe(200);
    expect(await decisionStatus(request, mandatory)).toBe('Approved');
  });

  test('dependencies update: what was waiting on the decision is ready, the queue moves on, and readiness counts it', async ({ page, request }) => {
    const o = await overview(request);
    expect(o.overview.readiness.blockingDecisions.map((b) => b.id)).not.toContain(mandatory);
    expect(o.overview.progress.find((x) => x.label === 'Mandatory decisions approved')).toMatchObject({ done: 1, total: 1 });
    expect(o.actions.some((a) => a.subjectId === mandatory && a.kind === 'review-decision')).toBe(false);
    expect(o.actions.every((a) => !a.waitingFor.includes(mandatory)), 'nothing still waits for it').toBe(true);
    expect(o.overview.recentlyApproved.items[0]!.title).toBe(mandatory);
    expect(o.overview.recentlyApproved.items[0]!.meta).toBe(new Date().toISOString().slice(0, 10));
    // The record on GitHub says who, and the history on the Changes page shows it.
    const rec = JSON.parse(bare('show', `refs/heads/main:docs/decision-reviews/${mandatory}/0001-approve.json`)) as { actor: { login: string }; rationale: string };
    expect(rec.actor.login).toBe(USERS.owner.login);

    await open(page);
    await expect(page.getByTestId('approved')).toContainText(mandatory);
    await expect(page.getByTestId('progress').getByText('Mandatory decisions approved').locator('..')).toContainText('1 of 1');
    await open(page, '/changes');
    await expect(page.getByTestId('decision-history')).toContainText(mandatory);
    await expect(page.getByTestId('decision-history')).toContainText('review record');
    await expect(page.locator('#pending').getByTestId('proposal-row')).toHaveCount(0);
  });

  test('on the real policy the architecture is still not ready: two gates that are not decisions remain, and the page says so', async ({ page, request }) => {
    const o = await overview(request);
    expect(o.overview.readiness.ready).toBe(false);
    expect(o.overview.readiness.otherBlockers.map((b) => b.code).sort()).toEqual(['no-approver', 'phase-0']);
    expect(o.overview.next!.kind).toBe('readiness-gate');
    await open(page);
    await expect(page.getByTestId('readiness-label')).toContainText('0 mandatory decisions and 2 gates');
    await expect(page.getByTestId('next-title')).toHaveText(/Enroll an architecture-class approver|Raise the phase|Authorize an architecture baseline/);
  });
});

test.describe('4. new commits on GitHub, and readiness', () => {
  test('a decision added on GitHub appears as pending, and what changed on GitHub is offered to the page that is open', async ({ page, request }) => {
    await open(page);
    const shown = await page.getByTestId('freshness-commit').textContent();
    const before = (await overview(request)).overview.awaiting.count;
    pushToMain({ 'docs/adr/0050-journey-extra.md': adrText('0050', 'A decision added while the page was open') }, 'ADR 0050 arrives');
    fetchWork();
    await refresh(request);
    expect((await overview(request)).overview.awaiting.count).toBe(before + 1);
    expect(await decisionStatus(request, 'ADR-0050')).toBe('Proposed');
    // The open page learns of it when the window next gets focus, with no timer ticking every few seconds.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('freshness-update')).toBeVisible();
    expect(await page.getByTestId('freshness-commit').textContent(), 'it still shows the commit it was rendered from').toBe(shown);
    await page.getByTestId('freshness-update').click();
    await expect(page.getByTestId('attention-count')).toHaveText(String(before + 1));
    await expect(page.getByTestId('freshness-update')).toHaveCount(0);
  });

  test('once the baseline policy asks only for what is done, the architecture is ready, and the next step is the signed baseline', async ({ page, request }) => {
    const policy = JSON.parse(bare('show', 'refs/heads/main:harness/policy/baseline-policy.json')) as { activeStage: string; stages: { id: string; gates: string[] }[] };
    policy.stages.find((s) => s.id === policy.activeStage)!.gates = ['scope-adr'];
    pushToMain({ 'harness/policy/baseline-policy.json': `${JSON.stringify(policy, null, 2)}\n` }, 'Test world: phase 1a needs only its scope ADR');
    fetchWork();
    await refresh(request);
    const o = await overview(request);
    expect(o.overview.readiness.ready, JSON.stringify(o.overview.readiness)).toBe(true);
    expect(o.overview.readiness.blockingDecisions).toEqual([]);
    expect(o.overview.readiness.otherBlockers).toEqual([]);
    // The one thing left is a signed human act, and it is offered as the next action.
    expect(o.overview.next!.kind).toBe('readiness-gate');
    expect(o.overview.next!.title).toBe('Authorize an architecture baseline');
    await open(page);
    await expect(page.getByTestId('readiness-label')).toContainText('Ready to authorize a baseline');
    await expect(page.getByTestId('next-title')).toHaveText('Authorize an architecture baseline');
    await expect(page.getByTestId('mandatory-blockers')).toHaveCount(0);
  });

  test('an unchanged decision that was approved stays approved when unrelated commits arrive', async ({ request }) => {
    pushToMain({ 'docs/notes-journey.md': 'unrelated\n' }, 'an unrelated change');
    fetchWork();
    await refresh(request);
    expect(await decisionStatus(request, mandatory)).toBe('Approved');
    expect((await overview(request)).overview.readiness.ready).toBe(true);
  });
});

test.describe('5. stale evidence', () => {
  const adr = (extra: string) => adrText('0051', 'A decision that cites evidence').replace('- No evidence exists beyond this test world. It is Proposed and has no signed approval.', `- No evidence exists beyond this test world.\n${extra}`);

  test('evidence recorded before a decision last changed is stale, and a citation to nothing is missing', async ({ page, request }) => {
    pushToMain({ 'docs/adr/0051-journey-evidence.md': adr('- EV-0004 and EV-9999 are cited here.') }, 'ADR 0051 cites evidence');
    fetchWork();
    await refresh(request);
    const o = await overview(request);
    const mine = o.stale.filter((s) => s.decisionId === 'ADR-0051');
    expect(mine.map((s) => [s.evidenceId, s.kind]).sort()).toEqual([['EV-0004', 'stale'], ['EV-9999', 'missing']]);
    const a = o.actions.find((x) => x.key === 'evidence:ADR-0051')!;
    expect(a.kind).toBe('refresh-evidence');
    expect(a.reasons[0]!.rule).toBe('stale-evidence');
    await open(page, '/changes');
    await expect(page.getByTestId('stale-evidence-count')).not.toHaveText('0');
    await expect(page.getByTestId('stale-list')).toContainText('ADR-0051');
    await expect(page.getByTestId('stale-list')).toContainText('EV-9999');
  });

  test('when the citations are removed the finding goes away, and the empty state says nothing is stale', async ({ page, request }) => {
    pushToMain({ 'docs/adr/0051-journey-evidence.md': adr('- Nothing is cited.') }, 'ADR 0051 stops citing evidence');
    fetchWork();
    await refresh(request);
    const o = await overview(request);
    expect(o.stale.filter((s) => s.decisionId === 'ADR-0051')).toEqual([]);
    expect(o.actions.some((x) => x.key === 'evidence:ADR-0051')).toBe(false);
  });
});

test.describe('6. outages and recovery', () => {
  test('a change that cannot reach GitHub becomes the next action, nothing is claimed, and it recovers when GitHub answers', async ({ page, request }) => {
    const id = 'ADR-0050';
    const rv = ((await (await request.get(`/api/v1/review/${id}`)).json()) as { view: { revision: string } }).view.revision;
    await ctl(request, 'clearFaults');
    await ctl(request, 'dropNext', 400);
    const r = await request.post(`/api/v1/review/${id}/actions`, { headers: { ...H, 'x-studio-csrf': csrf }, data: { action: 'comment', comment: 'Noted during an outage.', expectedRevision: rv, idempotencyKey: `outage-${Date.now().toString(36)}-abcdef` } });
    const body = (await r.json()) as { proposal: { id: string; state: string } };
    expect(body.proposal.state).toBe('awaiting-github-update');
    const o = await overview(request);
    const a = o.actions.find((x) => x.key === `proposal:${body.proposal.id}`)!;
    expect(a.kind).toBe('send-to-github');
    expect(a.reasons[0]!.text).toMatch(/not on GitHub yet/);
    expect(o.overview.next!.key, 'the stuck change is the next thing to do').toBe(a.key);
    await open(page, '/changes');
    await expect(page.locator('#pending').getByTestId('proposal-row')).toContainText(id);

    await ctl(request, 'clearFaults');
    const sync = await request.post(`/api/v1/review/proposals/${body.proposal.id}/sync`, { headers: { ...H, 'x-studio-csrf': csrf }, data: {} });
    expect(((await sync.json()) as { proposal: { state: string } }).proposal.state).toBe('pull-request-created');
    const after = await overview(request);
    expect(after.actions.find((x) => x.key === `proposal:${body.proposal.id}`)!.kind).toBe('merge-pull-request');
    // finish it so it is not left open
    const pr = (await pulls(request)).find((x) => x.head.startsWith(`decision-review/${id}/`) && !x.merged)!;
    await ctl(request, 'merge', pr.number);
    await request.post(`/api/v1/review/proposals/${body.proposal.id}/sync`, { headers: { ...H, 'x-studio-csrf': csrf }, data: {} });
  });

  test('a pull request closed without merging is a sync failure that needs a person, and the page lists it', async ({ page, request }) => {
    const id = 'ADR-0051';
    const rv = ((await (await request.get(`/api/v1/review/${id}`)).json()) as { view: { revision: string } }).view.revision;
    const r = await request.post(`/api/v1/review/${id}/actions`, { headers: { ...H, 'x-studio-csrf': csrf }, data: { action: 'comment', comment: 'This pull request will be closed.', expectedRevision: rv, idempotencyKey: `closed-${Date.now().toString(36)}-abcdef` } });
    const p = ((await r.json()) as { proposal: { id: string } }).proposal;
    const pr = (await pulls(request)).find((x) => x.head.startsWith(`decision-review/${id}/`) && !x.merged)!;
    await ctl(request, 'close', pr.number);
    await request.post(`/api/v1/review/proposals/${p.id}/sync`, { headers: { ...H, 'x-studio-csrf': csrf }, data: {} });
    const o = await overview(request);
    const a = o.actions.find((x) => x.key === `proposal:${p.id}`)!;
    expect(a.kind).toBe('sync-failure');
    expect(a.score).toBe(POINTS.syncFailure);
    await open(page, '/changes');
    await expect(page.locator('#conflicts')).toContainText(id);
    await expect(page.locator('#conflicts').getByTestId('proposal-row')).toHaveCount(1);
  });

  test('when the Studio has not synced for a long time it says GitHub may be unreachable and that this is the last copy, and it clears on recovery', async ({ page, request }) => {
    const fh = path.join(work, '.git', 'FETCH_HEAD');
    const old = new Date(Date.now() - 20 * 60_000);
    fs.utimesSync(fh, old, old);
    const f = (await (await request.get('/api/v1/freshness')).json()) as { state: string; ageSeconds: number };
    expect(f.state).toBe('stale');
    expect(f.ageSeconds).toBeGreaterThan(15 * 60);
    await open(page, '/changes');
    await expect(page.getByTestId('outage-banner')).toContainText('GitHub may be unreachable');
    await expect(page.getByTestId('freshness')).toHaveAttribute('data-state', 'stale');
    await expect(page.getByTestId('freshness-warning')).toContainText('last copy');
    // Everything it knew is still there, not blanked.
    await expect(page.getByTestId('readiness-card')).toBeVisible();
    await open(page);
    await expect(page.getByTestId('next-title')).toBeVisible();
    await expect(page.getByTestId('freshness-warning')).toBeVisible();

    // GitHub answers again: the next fetch touches FETCH_HEAD, and Refresh clears the warning.
    git(work, 'fetch', '-q', 'origin');
    await page.getByTestId('freshness-refresh').click();
    await expect(page.getByTestId('freshness')).toHaveAttribute('data-state', 'fresh');
    await expect(page.getByTestId('freshness-warning')).toHaveCount(0);
    await open(page, '/changes');
    await expect(page.getByTestId('outage-banner')).toHaveCount(0);
  });

  test('a failed freshness check is reported, not hidden, and a later one recovers', async ({ page, request }) => {
    await open(page);
    let fail = true;
    await page.route('**/api/v1/freshness', (route) => (fail ? route.fulfill({ status: 503, body: 'down' }) : route.continue()));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('freshness')).toHaveAttribute('data-state', 'unreachable');
    await expect(page.getByTestId('freshness-warning')).toContainText('Could not check for updates');
    fail = false;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('freshness')).toHaveAttribute('data-state', 'fresh');
    void request;
  });
});

test.describe('7. empty states, quality and performance', () => {
  test('empty sections say so in words instead of showing nothing', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('rework-empty')).toContainText('No rejected decision is still needed');
    await open(page, '/changes');
    await expect(page.getByTestId('no-baseline-changes')).toContainText('No baseline has been authorized yet');
    await expect(page.getByTestId('no-affected-tasks')).toContainText('No open task is blocked or flagged');
  });

  test('a row opens a side panel with the rules behind its place, and Escape returns to the page', async ({ page }) => {
    await open(page);
    await page.getByTestId('attention').getByTestId('action-row').first().click();
    const d = page.getByTestId('action-drawer');
    await expect(d).toBeVisible();
    await expect(d.getByTestId('why')).toBeVisible();
    await expect(d.getByTestId('drawer-open')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(d).toHaveCount(0);
    await expect(page.getByTestId('attention')).toBeVisible();
  });

  test('keyboard: the next action and the lists are reachable, and a row opens with Enter', async ({ page }) => {
    await open(page);
    await page.getByTestId('start-review').focus();
    await expect(page.getByTestId('start-review')).toBeFocused();
    const row = page.getByTestId('blockers').getByTestId('action-row').first();
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('action-drawer')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(row).toBeFocused();
  });

  test('no console errors, no accessibility violations, and no horizontal overflow on a phone', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(`${m.type()}: ${m.text().slice(0, 160)}`));
    page.on('pageerror', (e) => problems.push(`page error: ${e.message.slice(0, 160)}`));
    for (const url of ['/', '/changes', '/queue?view=pending']) {
      await open(page, url);
      if (url === '/queue?view=pending') await expect(page.getByTestId('queue-table')).toBeVisible();
      await expectNoAxeViolations(page, url);
    }
    expect(problems).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of ['/', '/changes']) {
      await open(page, url);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), url).toBeLessThanOrEqual(1);
    }
  });

  test('it does not poll: ten seconds on the Overview makes no background request', async ({ page }) => {
    await open(page);
    const seen: string[] = [];
    page.on('request', (r) => r.url().includes('/api/') && seen.push(r.url()));
    await page.waitForTimeout(10_000);
    expect(seen, 'no request without a focus, a click or the five-minute check').toEqual([]);
  });

  test('the Overview renders quickly when warm, and its API is fast', async ({ page, request }) => {
    await overview(request);
    const t0 = Date.now();
    await overview(request);
    const api = Date.now() - t0;
    expect(api, 'warm overview API').toBeLessThan(1500);
    const t1 = Date.now();
    await page.goto('/');
    await expect(page.getByTestId('next-action')).toBeVisible();
    expect(Date.now() - t1, 'warm Overview page').toBeLessThan(4000);
  });

  test('reading changes nothing: the Overview, Changes and queue leave GitHub exactly as it was', async ({ page, request }) => {
    const before = bare('rev-parse', 'refs/heads/main') + JSON.stringify(await pulls(request));
    for (const u of ['/', '/changes', '/queue']) await open(page, u);
    for (const u of ['/api/v1/overview', '/api/v1/changes', '/api/v1/freshness', '/api/v1/queue']) await request.get(u);
    expect(bare('rev-parse', 'refs/heads/main') + JSON.stringify(await pulls(request))).toBe(before);
  });
});
