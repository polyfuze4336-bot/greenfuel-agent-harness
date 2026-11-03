import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect as baseExpect, test, type APIRequestContext, type Page } from '@playwright/test';
import { USERS } from '../checks/fixtures/review-fixture.ts';
import { signBody } from '../src/lib/github/webhook.ts';

const expect = baseExpect.configure({ timeout: 20_000 });

// The GitHub App path in a real browser: a Studio configured with a GitHub App (port 3104) talking to a stand-in for the GitHub
// REST API (port 3105) that runs over a real bare git repository. The stand-in is steerable (checks, merges, failures, expired
// credentials) through /_control/. It is NOT GitHub: these tests prove how the Studio behaves, not how GitHub behaves, and
// nothing here reaches github.com.
const BASE = 'http://localhost:3104';
const FAKE = 'http://127.0.0.1:3105';
const SECRET = 'whsec-e2e-secret';
test.use({ baseURL: BASE });
test.describe.configure({ mode: 'serial', timeout: 150_000 });

const dir = process.env.STUDIO_E2E_APP_DIR!;
const state = path.join(dir, 'state');
const remote = path.join(dir, 'origin.git');
const bare = (...a: string[]) => spawnSync('git', ['--git-dir', remote, ...a], { encoding: 'utf8' }).stdout.trim();

type User = (typeof USERS)[keyof typeof USERS];
const as = (u: User | null) => (u ? fs.writeFileSync(path.join(state, 'identity.json'), JSON.stringify(u)) : fs.rmSync(path.join(state, 'identity.json'), { force: true }));

const ctl = async (request: APIRequestContext, name: string, ...args: unknown[]) => {
  const r = await request.post(`${FAKE}/_control/${name}`, { data: { args } });
  expect(r.ok(), `${name}: ${await r.text()}`).toBe(true);
};
interface FakeState {
  pulls: { number: number; head: string; merged: boolean; closed: boolean; headSha: string }[];
  refWrites: string[];
  tokensIssued: number;
  nonGetMethods: string[];
}
const fake = async (request: APIRequestContext) => (await (await request.get(`${FAKE}/_control/state`)).json()) as FakeState;
const prFor = async (request: APIRequestContext, id: string) => (await fake(request)).pulls.find((p) => p.head.startsWith(`decision-review/${id}/`))!;

async function open(page: Page, id: string) {
  await page.goto(`/decisions/${id}/review`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('review-rail').getByRole('heading', { name: 'Your identity' })).toBeVisible();
}
async function signIn(page: Page, u: User = USERS.owner) {
  as(u);
  const btn = page.getByTestId('sign-in');
  if (await btn.isVisible()) await btn.click();
  await expect(page.getByTestId('identity')).toContainText(`@${u.login}`);
}
const tracker = (page: Page) => page.getByTestId('proposal-tracker');
const status = (page: Page) => page.getByTestId('review-status');

/** Submit one action through the dialog. */
async function act(page: Page, action: string, text: string | undefined, submit: string) {
  await page.getByTestId(`action-${action}`).click();
  const d = page.getByTestId('action-dialog');
  await expect(d).toBeVisible();
  if (text !== undefined) await d.getByRole('textbox').last().fill(text);
  await d.getByRole('button', { name: submit }).click();
  await expect(d).toBeHidden({ timeout: 40_000 });
}
const check = async (page: Page) => tracker(page).getByRole('button', { name: /Check GitHub status|Send to GitHub/ }).click();

const shotDir = path.resolve(process.cwd(), '..', '..', 'docs', 'architecture-studio', 'screenshots');
async function shot(page: Page, name: string) {
  await new Promise((r) => setTimeout(r, 450));
  await page.screenshot({ path: path.join(shotDir, `${name}.png`), animations: 'disabled' });
}

/** A signed-in API session for a second "person" acting on the same Studio. */
async function apiSession(request: APIRequestContext) {
  as(USERS.owner);
  const r = await request.post('/api/v1/auth/signin', { headers: { 'content-type': 'application/json', origin: BASE }, data: {} });
  return ((await r.json()) as { csrf: string }).csrf;
}
const apiAct = (request: APIRequestContext, csrf: string, id: string, body: Record<string, unknown>) =>
  request.post(`/api/v1/review/${id}/actions`, { headers: { 'content-type': 'application/json', origin: BASE, 'x-studio-csrf': csrf }, data: body });
const apiSync = (request: APIRequestContext, csrf: string, pid: string) => request.post(`/api/v1/review/proposals/${pid}/sync`, { headers: { 'content-type': 'application/json', origin: BASE, 'x-studio-csrf': csrf }, data: {} });
const revisionOf = async (request: APIRequestContext, id: string) => ((await (await request.get(`/api/v1/review/${id}`)).json()) as { view: { revision: string } }).view.revision;

test.describe('connection and secrets', () => {
  test('the Studio says it is connected as a GitHub App, and no endpoint or page carries a credential', async ({ page, request }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Repository sync status/ }).click();
    const panel = page.getByTestId('github-sync');
    await expect(panel.getByTestId('github-mode')).toHaveText('GitHub App');
    await expect(panel).toContainText('acme/greenfuel');
    await expect(panel).toContainText('webhook configured');
    await shot(page, '60-github-sync-status');
    const pem = fs.readFileSync(path.join(dir, 'app-private-key.pem'), 'utf8').split('\n')[1]!;
    for (const url of ['/api/v1/sync/status', '/api/v1/auth/session', '/api/v1/repository']) {
      const body = await (await request.get(url)).text();
      expect(body, url).not.toContain('PRIVATE KEY');
      expect(body, url).not.toContain(pem);
      expect(body, url).not.toMatch(/ghs_[0-9a-f]{20}/);
    }
  });

  test('the browser bundle holds no GitHub App code or key reference', async () => {
    const root = path.resolve(process.cwd(), '.next', 'static');
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|map|css)$/.test(e.name)) {
          const t = fs.readFileSync(p, 'utf8');
          if (/STUDIO_GITHUB_APP_PRIVATE_KEY_FILE|createPrivateKey|BEGIN (RSA )?PRIVATE KEY|STUDIO_GITHUB_WEBHOOK_SECRET|x-access-token/.test(t)) hits.push(p);
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});

test.describe('approval and rejection pull requests', () => {
  test('approve: a pull request is opened by the app, checks and review are reported, and it is Approved only after the merge', async ({ page, request }) => {
    await open(page, 'ADR-0020');
    await signIn(page);
    const writesBefore = (await fake(request)).refWrites.length; // other specs may have used this stand-in first
    await act(page, 'approve', undefined, 'Submit approval');
    await expect(tracker(page)).toHaveAttribute('data-state', 'pull-request-created');
    await expect(status(page)).toContainText('Proposed');
    const pr = await prFor(request, 'ADR-0020');
    expect(pr).toBeTruthy();
    const s = await fake(request);
    expect(s.refWrites.slice(writesBefore)).toEqual([`refs/heads/${pr.head}`]);
    expect(bare('rev-parse', 'refs/heads/main')).not.toBe(pr.headSha);
    expect(bare('diff-tree', '--no-commit-id', '--name-only', '-r', pr.headSha)).toBe('docs/decision-reviews/ADR-0020/0001-approve.json');

    await ctl(request, 'setChecks', pr.headSha, [{ name: 'validate', status: 'completed', conclusion: 'success' }]);
    await ctl(request, 'setReviews', pr.number, [{ state: 'APPROVED', user: { id: 7 } }]);
    await check(page);
    await expect(page.getByTestId('validation')).toContainText('checks passed, 1 approving review');
    await expect(page.getByTestId('validation')).toHaveAttribute('data-state', 'success');
    await expect(tracker(page)).toHaveAttribute('data-state', 'awaiting-merge');
    await expect(status(page)).toContainText('Proposed'); // passing checks are not an approval
    await shot(page, '61-github-validation-passed');

    await ctl(request, 'merge', pr.number);
    await check(page);
    await expect(tracker(page)).toBeHidden();
    await expect(status(page)).toContainText('Approved');
    await expect(page.getByTestId('timeline')).toContainText('Approve the recommended option');
    await shot(page, '62-github-canonical-approved');
    expect((await fake(request)).nonGetMethods.sort()).toEqual(['GET', 'POST']);
  });

  test('reject: the rationale travels in the record, and the decision is Rejected only after the merge', async ({ page, request }) => {
    await open(page, 'D-034');
    await signIn(page);
    await act(page, 'reject', 'Violates the residency constraint HC-01.', 'Submit rejection');
    await expect(tracker(page)).toHaveAttribute('data-state', 'pull-request-created');
    await expect(status(page)).toContainText('Pending Review');
    const pr = await prFor(request, 'D-034');
    const rec = JSON.parse(bare('show', `${pr.head}:docs/decision-reviews/D-034/0001-reject.json`)) as { rationale: string; actor: { login: string } };
    expect(rec).toMatchObject({ rationale: 'Violates the residency constraint HC-01.', actor: { login: 'test-owner' } });
    await ctl(request, 'merge', pr.number);
    await check(page);
    await expect(status(page)).toContainText('Rejected');
    await expect(page.getByTestId('timeline')).toContainText('Violates the residency constraint HC-01.');
  });
});

test.describe('validation, rejected pull requests and failures', () => {
  test('failed CI is shown and the decision stays unchanged; the Studio offers no merge', async ({ page, request }) => {
    await open(page, 'D-033');
    await signIn(page);
    await act(page, 'comment', 'Waiting on the sovereignty lead.', 'Submit comment');
    const pr = await prFor(request, 'D-033');
    await ctl(request, 'setChecks', pr.headSha, [{ name: 'validate', status: 'completed', conclusion: 'failure' }, { name: 'infra-validate', status: 'completed', conclusion: 'success' }]);
    await check(page);
    const v = page.getByTestId('validation');
    await expect(v).toHaveAttribute('data-state', 'failure');
    await expect(v).toContainText('checks failed (validate)');
    await expect(tracker(page)).toHaveAttribute('data-state', 'awaiting-merge');
    await expect(page.getByTestId('timeline')).not.toContainText('Waiting on the sovereignty lead.');
    await expect(page.getByRole('button', { name: /merge/i })).toHaveCount(0);
    await shot(page, '63-github-validation-failed');
    const audit = (await (await request.get('/api/v1/review/D-033')).json()) as { audit: { code: string; facts?: { validation: string; pullRequest: number } }[] };
    expect(audit.audit.some((a) => a.code === 'validation-failure' && a.facts?.validation === 'failure' && a.facts.pullRequest === pr.number)).toBe(true);
  });

  test('a pull request closed without merging is reported as Failed and the decision is unchanged', async ({ page, request }) => {
    await open(page, 'D-029');
    await signIn(page);
    await act(page, 'comment', 'A note that will be discarded.', 'Submit comment');
    const pr = await prFor(request, 'D-029');
    await ctl(request, 'close', pr.number);
    await check(page);
    await expect(tracker(page)).toHaveAttribute('data-state', 'failed');
    await expect(tracker(page)).toContainText('closed without merging');
    await expect(page.getByTestId('timeline')).not.toContainText('A note that will be discarded.');
    await shot(page, '64-github-pr-closed');
  });

  test('a network failure is reported as retryable, nothing is claimed, and sending again completes it once', async ({ page, request }) => {
    await open(page, 'D-032');
    await signIn(page);
    const before = (await fake(request)).pulls.length;
    await ctl(request, 'dropNext', 200);
    await act(page, 'comment', 'Noting this during an outage.', 'Submit comment');
    await expect(tracker(page)).toHaveAttribute('data-state', 'awaiting-github-update');
    await expect(tracker(page)).toContainText('Could not reach GitHub');
    await expect(tracker(page)).toContainText('retried');
    expect((await fake(request)).pulls.length).toBe(before);
    await shot(page, '65-github-network-failure');
    await ctl(request, 'dropNext', -100000);
    await check(page);
    await expect(tracker(page)).toHaveAttribute('data-state', 'pull-request-created');
    expect((await fake(request)).pulls.length).toBe(before + 1);
  });

  test('expired credentials are renewed transparently', async ({ page, request }) => {
    await open(page, 'D-030');
    await signIn(page);
    const before = (await fake(request)).tokensIssued;
    await ctl(request, 'expireTokens');
    await act(page, 'comment', 'Submitted after the token expired.', 'Submit comment');
    await expect(tracker(page)).toHaveAttribute('data-state', 'pull-request-created');
    expect((await fake(request)).tokensIssued).toBeGreaterThan(before);
  });

  test('revoked credentials are reported as such and nothing is lost: fixing them lets the same request through', async ({ page, request }) => {
    await open(page, 'D-028');
    await signIn(page);
    await ctl(request, 'expireTokens');
    await ctl(request, 'breakAuth', true);
    await act(page, 'comment', 'Submitted while the app was suspended.', 'Submit comment');
    await expect(tracker(page)).toHaveAttribute('data-state', 'awaiting-github-update');
    await expect(tracker(page)).toContainText('credentials');
    await expect(tracker(page)).toContainText('nothing was lost');
    await ctl(request, 'breakAuth', false);
    await check(page);
    await expect(tracker(page)).toHaveAttribute('data-state', 'pull-request-created');
  });

  test('a duplicate request returns the proposal it already made, and only one pull request exists', async ({ request }) => {
    const csrf = await apiSession(request);
    const body = { action: 'comment', comment: 'Duplicate test.', expectedRevision: await revisionOf(request, 'D-031'), idempotencyKey: 'dup-key-e2e-12345' };
    const a = (await (await apiAct(request, csrf, 'D-031', body)).json()) as { duplicate: boolean; proposal: { id: string } };
    const b = (await (await apiAct(request, csrf, 'D-031', body)).json()) as { duplicate: boolean; proposal: { id: string } };
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.proposal.id).toBe(a.proposal.id);
    expect((await fake(request)).pulls.filter((p) => p.head.startsWith('decision-review/D-031/')).length).toBe(1);
  });
});

test.describe('concurrent changes', () => {
  test('GitHub changed after the decision was opened: a conflict view shows original, current and proposed, and sends nothing until the person reconciles', async ({ page, request }) => {
    await open(page, 'D-037');
    await signIn(page);
    await expect(status(page)).toContainText('Pending Review');

    // Meanwhile another person comments on the same decision, and it is merged on GitHub.
    const csrf = await apiSession(request);
    const made = (await (await apiAct(request, csrf, 'D-037', { action: 'comment', comment: 'A colleague added context first.', expectedRevision: await revisionOf(request, 'D-037'), idempotencyKey: 'colleague-key-1234' })).json()) as { proposal: { id: string } };
    const pr = await prFor(request, 'D-037');
    await ctl(request, 'merge', pr.number);
    expect((await (await apiSync(request, csrf, made.proposal.id)).json()).proposal.state).toBe('applied');
    const writes = (await fake(request)).refWrites.length;

    // This person, still looking at the old state, defers.
    await page.getByTestId('action-defer').click();
    const d = page.getByTestId('action-dialog');
    await d.getByRole('textbox').last().fill('Postponed to milestone M2.');
    await d.getByRole('button', { name: 'Submit deferral' }).click();
    const cv = d.getByTestId('conflict-view');
    await expect(cv).toBeVisible();
    await expect(cv.getByTestId('conflict-original')).toContainText('Pending Review');
    await expect(cv.getByTestId('conflict-current')).toContainText('comment by @test-owner');
    await expect(cv.getByTestId('conflict-current')).toContainText('A colleague added context first.');
    await expect(cv.getByTestId('conflict-proposed')).toContainText('defer');
    await expect(cv.getByTestId('conflict-proposed')).toContainText('Postponed to milestone M2.');
    await shot(page, '66-github-conflict-view');
    expect((await fake(request)).refWrites.length, 'nothing was sent').toBe(writes);
    await expect(page.getByTestId('timeline')).toBeVisible();

    // The person must say they have read it before the request can be re-applied.
    await expect(cv.getByTestId('conflict-reapply')).toBeDisabled();
    await expect(d.getByRole('button', { name: 'Submit deferral' })).toBeDisabled();
    await cv.getByRole('checkbox').check();
    await cv.getByTestId('conflict-reapply').click();
    await expect(d).toBeHidden({ timeout: 40_000 });
    await expect(tracker(page)).toHaveAttribute('data-state', 'pull-request-created');
    expect((await fake(request)).refWrites.length).toBe(writes + 1);
    const audit = (await (await request.get('/api/v1/review/D-037')).json()) as { audit: { outcome: string; action: string }[] };
    expect(audit.audit.some((a) => a.outcome === 'stale' && a.action === 'defer'), 'the refusal is in the audit log').toBe(true);
  });

  test('discarding after a conflict reloads the current state and sends nothing', async ({ page, request }) => {
    await open(page, 'D-035');
    await signIn(page);
    const csrf = await apiSession(request);
    const made = (await (await apiAct(request, csrf, 'D-035', { action: 'comment', comment: 'First, from elsewhere.', expectedRevision: await revisionOf(request, 'D-035'), idempotencyKey: 'colleague-key-5678' })).json()) as { proposal: { id: string } };
    await ctl(request, 'merge', (await prFor(request, 'D-035')).number);
    await apiSync(request, csrf, made.proposal.id);
    const writes = (await fake(request)).refWrites.length;
    await page.getByTestId('action-defer').click();
    const d = page.getByTestId('action-dialog');
    await d.getByRole('textbox').last().fill('Not yet, wait for the pilot.');
    await d.getByRole('button', { name: 'Submit deferral' }).click();
    await d.getByTestId('conflict-discard').click();
    await expect(page.getByTestId('timeline')).toContainText('First, from elsewhere.');
    expect((await fake(request)).refWrites.length).toBe(writes);
  });
});

test.describe('webhooks and reconciliation', () => {
  const payload = (n: number, sha: string, repo = 'acme/greenfuel') => JSON.stringify({ action: 'closed', number: n, repository: { full_name: repo }, pull_request: { number: n, head: { sha }, merged: true } });
  const send = (request: APIRequestContext, raw: string, o: { id?: string; event?: string; sig?: string | null; host?: string } = {}) =>
    request.post('/api/v1/github/webhook', {
      headers: { 'content-type': 'application/json', 'x-github-event': o.event ?? 'pull_request', 'x-github-delivery': o.id ?? 'deliv-0001-aaaa', ...(o.sig === null ? {} : { 'x-hub-signature-256': o.sig ?? signBody(SECRET, raw) }), ...(o.host ? { host: o.host } : {}) },
      data: raw,
    });

  test('a signed webhook makes the Studio re-check and apply a merge; unsigned, forged, replayed and foreign deliveries do not', async ({ page, request }) => {
    await open(page, 'D-027');
    await signIn(page);
    await act(page, 'comment', 'Noted before the webhook test.', 'Submit comment');
    const pr = await prFor(request, 'D-027');
    await ctl(request, 'merge', pr.number);
    const raw = payload(pr.number, pr.headSha);

    expect((await send(request, raw, { id: 'deliv-bad-0001', sig: null })).status(), 'no signature').toBe(401);
    expect((await send(request, raw, { id: 'deliv-bad-0002', sig: signBody('wrong-secret', raw) })).status(), 'wrong secret').toBe(401);
    expect((await send(request, raw + ' ', { id: 'deliv-bad-0003', sig: signBody(SECRET, raw) })).status(), 'body changed after signing').toBe(401);
    const stillOpen = (await (await request.get('/api/v1/review/D-027')).json()) as { view: { open: { state: string } | null } };
    expect(stillOpen.view.open, 'rejected deliveries change nothing').not.toBeNull();

    const foreign = await send(request, payload(1, 'b'.repeat(40), 'someone/else'), { id: 'deliv-foreign-01' });
    expect(((await foreign.json()) as { ignored?: string }).ignored).toBe('another repository');

    const good = await send(request, raw, { id: 'deliv-good-0001' });
    expect(good.status()).toBe(200);
    expect(((await good.json()) as { advanced: { to: string }[] }).advanced.map((a) => a.to)).toEqual(['applied']);
    await page.reload();
    await expect(page.getByTestId('timeline')).toContainText('Noted before the webhook test.');
    const replay = await send(request, raw, { id: 'deliv-good-0001' });
    expect(((await replay.json()) as { duplicate: boolean }).duplicate).toBe(true);

    const audit = (await (await request.get('/api/v1/sync/status')).json()) as { lastReconcile: { trigger: string } | null };
    expect(audit.lastReconcile?.trigger).toBe('webhook:pull_request');
  });

  test('a tunnel host can reach the webhook and nothing else', async ({ request }) => {
    const hook = await send(request, payload(1, 'c'.repeat(40)), { id: 'deliv-tunnel-01', host: 'hooks.example.test' });
    expect(hook.status(), 'reaches the route, which accepts it').toBe(200);
    for (const p of ['/api/v1/decisions', '/api/v1/queue', '/', '/api/v1/sync/status']) {
      const r = await request.get(p, { headers: { host: 'hooks.example.test' } });
      expect(r.status(), p).toBe(403);
    }
    const wrongMethod = await request.get('/api/v1/github/webhook', { headers: { host: 'hooks.example.test' } });
    expect(wrongMethod.status()).toBe(403);
  });

  test('Reconcile with GitHub moves a merged proposal forward without opening the decision', async ({ page, request }) => {
    await open(page, 'D-026');
    await signIn(page);
    await act(page, 'comment', 'Reconcile me.', 'Submit comment');
    await ctl(request, 'merge', (await prFor(request, 'D-026')).number);
    await page.goto('/');
    await page.getByRole('button', { name: /Repository sync status/ }).click();
    await page.getByTestId('reconcile').click();
    await expect(page.getByTestId('reconcile-note')).toContainText(/Checked \d+ open proposal\(s\); [1-9]\d* moved forward/);
    await expect(page.getByTestId('github-sync')).toContainText('manual:test-owner');
    await shot(page, '67-github-reconciled');
    await page.keyboard.press('Escape');
    await open(page, 'D-026');
    await expect(page.getByTestId('timeline')).toContainText('Reconcile me.');
  });
});
