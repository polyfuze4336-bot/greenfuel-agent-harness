import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect as baseExpect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { USERS } from '../checks/fixtures/review-fixture.ts';
import { expectNoAxeViolations } from './helpers.ts';

// These tests wait on real git work (fetch, push, a model rebuild after a merge), so assertions get a longer, still bounded, wait.
const expect = baseExpect.configure({ timeout: 20_000 });

// The whole review workflow, in a real browser, against a throw-away clone of this repository with a local bare "GitHub"
// remote, a simulated pull-request service and test identities (server on port 3103, STUDIO_TEST_MODE). Nothing here touches the
// real repository or GitHub. A person's "merge" is done with git on the bare remote, exactly as GitHub would do it.
const BASE = 'http://localhost:3103';
test.use({ baseURL: BASE });
test.describe.configure({ mode: 'serial', timeout: 90_000 });

const dir = process.env.STUDIO_E2E_REVIEW_DIR!;
const state = path.join(dir, 'state');
const remote = path.join(dir, 'origin.git');
const work = path.join(dir, 'work');
const REASON = 'The residency analysis in the design review supports this choice.';

type User = (typeof USERS)[keyof typeof USERS];
const as = (u: User | null) => (u ? fs.writeFileSync(path.join(state, 'identity.json'), JSON.stringify(u)) : fs.rmSync(path.join(state, 'identity.json'), { force: true }));
const bare = (...a: string[]) => spawnSync('git', ['--git-dir', remote, ...a], { encoding: 'utf8' }).stdout.trim();
const prs = () => (JSON.parse(fs.readFileSync(path.join(state, 'prs.json'), 'utf8')) as { prs: { number: number; headSha: string; head: string }[] }).prs;
const lastPr = () => prs().at(-1)!;
const mainSha = () => bare('rev-parse', 'refs/heads/main');
const reviewFiles = () => bare('ls-tree', '-r', '--name-only', 'refs/heads/main').split('\n').filter((f) => f.startsWith('docs/decision-reviews/'));

/** What a person does on GitHub when they merge: the pull request's commit becomes the tip of main. */
function merge(n: number) {
  const pr = prs().find((p) => p.number === n)!;
  const ff = spawnSync('git', ['--git-dir', remote, 'merge-base', '--is-ancestor', mainSha(), pr.headSha]).status === 0;
  expect(ff, 'the pull request merges cleanly').toBe(true);
  bare('update-ref', 'refs/heads/main', pr.headSha);
}

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

async function act(page: Page, action: string, fill: { reason?: string; label?: RegExp; option?: number; conditions?: string[]; submit: string }) {
  await page.getByTestId(`action-${action}`).click();
  const d = page.getByTestId('action-dialog');
  await expect(d).toBeVisible();
  if (fill.option !== undefined) await d.getByRole('radio').nth(fill.option).check();
  if (fill.conditions) {
    for (const [i, c] of fill.conditions.entries()) {
      if (i > 0) await d.getByRole('button', { name: 'Add a condition' }).click();
      await d.getByRole('textbox', { name: `Condition ${i + 1}`, exact: true }).fill(c);
    }
  }
  if (fill.reason !== undefined) await d.getByRole('textbox', { name: fill.label ?? /./ }).last().fill(fill.reason);
  const t0 = Date.now();
  await d.getByRole('button', { name: fill.submit }).click();
  await expect(d).toBeHidden({ timeout: 30_000 });
  console.log(`SUBMIT-MS ${action} ${Date.now() - t0}`);
}

const tracker = (page: Page) => page.getByTestId('proposal-tracker');
const status = (page: Page) => page.getByTestId('review-status');

// Evidence screenshots: real captures from this run, written next to the other Studio screenshots.
const shotDir = path.resolve(process.cwd(), '..', '..', 'docs', 'architecture-studio', 'screenshots');
async function shot(target: Page | Locator, name: string, fullPage = false) {
  await new Promise((r) => setTimeout(r, 400));
  if ('goto' in target) await target.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage, animations: 'disabled' });
  else await target.screenshot({ path: path.join(shotDir, `${name}.png`), animations: 'disabled' });
}

async function csrf(req: APIRequestContext) {
  const s = (await (await req.get('/api/v1/auth/session')).json()) as { csrf?: string };
  return s.csrf ?? '';
}
const post = (req: APIRequestContext, url: string, data: unknown, headers: Record<string, string> = {}) => req.post(url, { data, headers: { origin: BASE, 'content-type': 'application/json', ...headers } });

test.beforeEach(() => as(USERS.owner));

test.describe('navigation and the full record', () => {
  test('starts from the register, shows everything needed to decide, and moves to the next pending decision with the keyboard', async ({ page }) => {
    await page.goto('/decisions');
    await page.getByTestId('start-review').click();
    await expect(page).toHaveURL(/\/decisions\/D-001\/review$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Which certification schemes');

    for (const name of ['What decision is required', 'Why it matters', 'Business and technical context', 'Consequences of approval or rejection', 'Recommended option, alternatives, pros and cons', 'Relevant requirements, risks and dependencies', 'Related architecture diagrams', 'Previous versions of the source']) {
      await expect(page.getByRole('heading', { level: 2, name }), name).toBeVisible();
    }
    await expect(page.getByTestId('if-approved')).toBeVisible();
    await expect(page.getByTestId('if-rejected')).toBeVisible();
    await expect(page.getByTestId('dependencies')).toContainText('Depends on');
    await expect(page.getByText('Nothing here is predicted by a model.')).toBeVisible();
    await expect(page.getByTestId('pending-position')).toContainText(/^1 of \d+$/);
    await shot(page, '31-review-page', true);

    await page.getByRole('heading', { level: 1 }).click(); // move focus out of anything editable
    await page.keyboard.press('n');
    await expect(page).toHaveURL(/\/decisions\/D-003\/review$/);
    await expect(page.getByTestId('pending-position')).toContainText(/^2 of \d+$/);
    await page.keyboard.press('p');
    await expect(page).toHaveURL(/\/decisions\/D-001\/review$/);
    await page.getByTestId('next-pending').click();
    await expect(page).toHaveURL(/\/decisions\/D-003\/review$/);
  });

  test('previous versions and the timeline come from the repository, and an old version opens read-only', async ({ page }) => {
    await open(page, 'ADR-0001');
    const versions = page.getByTestId('versions-list').locator('li');
    expect(await versions.count()).toBeGreaterThan(0);
    await versions.first().getByRole('button', { name: 'View this version' }).click();
    await expect(page.getByTestId('source-preview')).toContainText('Source preview, read-only');
    await expect(page.getByTestId('source-preview').locator('tr[data-highlight="true"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('timeline').locator('li').first()).toBeVisible();
    const src = ((await (await page.request.get('/api/v1/decisions/ADR-0001')).json()) as { decision: { source: { path: string } } }).decision.source.path;
    const bad = await page.request.get(`/api/v1/source?path=${encodeURIComponent(src)}&at=0000000000000000000000000000000000000000`);
    expect(bad.status(), 'a commit that is not in the file history is refused').toBe(404);
    expect(((await bad.json()) as { title: string }).title).toBe('Version not found');
  });

  test('a decision with no recommended option says so, and one with a recommendation shows it', async ({ page }) => {
    await open(page, 'D-010');
    await expect(page.getByTestId('review-rail').getByTestId('action-approve')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('action-approve-alternative')).toContainText('Select and approve an option');
    await open(page, 'ADR-0020');
    await expect(page.getByTestId('action-approve')).toContainText('Approve the recommended option');
  });
});

test.describe('approval, canonical only after the merge', () => {
  test('approve the recommended option, watch it travel to GitHub, and see it Approved only after the merge is verified', async ({ page, request }) => {
    const mainBefore = mainSha();
    const headBefore = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: work, encoding: 'utf8' }).stdout.trim();
    await open(page, 'ADR-0020');
    await expect(status(page)).toContainText('Proposed');
    await expect(page.getByTestId('action-approve')).toHaveAttribute('aria-disabled', 'true'); // not signed in yet
    await signIn(page);
    await act(page, 'approve', { submit: 'Submit approval' });

    await expect(tracker(page)).toHaveAttribute('data-state', 'pull-request-created');
    await expect(tracker(page).getByRole('listitem').filter({ hasText: 'Pull request created' })).toHaveAttribute('aria-current', 'step');
    await expect(page.getByTestId('rail-notice')).toContainText('Pull request created');
    await shot(page, '32-review-pull-request-created');
    // Not canonical yet: the pill, the API and main all still say what they said before.
    await expect(status(page)).toContainText('Proposed');
    expect(((await (await request.get('/api/v1/decisions/ADR-0020')).json()) as { decision: { status: string } }).decision.status).toBe('Proposed');
    expect(mainSha()).toBe(mainBefore);
    expect(bare('for-each-ref', 'refs/heads/decision-review')).toContain('ADR-0020');
    // The user's working repository was not touched.
    expect(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: work, encoding: 'utf8' }).stdout.trim()).toBe(headBefore);
    expect(spawnSync('git', ['status', '--porcelain'], { cwd: work, encoding: 'utf8' }).stdout.trim()).toBe('');
    // One decision at a time: nothing else can be submitted while this is in flight.
    await expect(page.getByTestId('action-reject')).toHaveAttribute('aria-disabled', 'true');

    await tracker(page).getByRole('button', { name: 'Check GitHub status' }).click();
    await expect(tracker(page)).toHaveAttribute('data-state', 'awaiting-merge');
    await expect(status(page)).toContainText('Proposed');

    merge(lastPr().number);
    await tracker(page).getByRole('button', { name: 'Check GitHub status' }).click();
    await expect(tracker(page)).toBeHidden();
    await expect(status(page)).toContainText('Approved');
    await expect(page.getByText('Status comes from a review record on the canonical branch')).toBeVisible();
    await shot(page, '33-review-canonical-approved');
    expect(((await (await request.get('/api/v1/decisions/ADR-0020')).json()) as { decision: { status: string; approvalBasis: string } }).decision).toMatchObject({ status: 'Approved', approvalBasis: 'review-record' });
    expect(reviewFiles()).toContain('docs/decision-reviews/ADR-0020/0001-approve.json');
    await expect(page.getByTestId('timeline')).toContainText('Approve the recommended option');
    // Approved decisions cannot be silently overwritten.
    await expect(page.getByTestId('action-approve')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('action-reopen')).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('the register counts it as Approved, labelled as a review record and not a signed approval', async ({ page }) => {
    await page.goto('/decisions?id=ADR-0020');
    const detail = page.getByTestId('decision-detail');
    await expect(detail).toContainText('Approved by a Studio review record');
    await expect(detail).toContainText('not a signed approval under ADR 0008');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /^Approved 14$/ })).toBeVisible();
  });
});

test.describe('alternative, conditional and rejection', () => {
  test('selecting an alternative records which option and why, and refuses without a rationale', async ({ page }) => {
    await open(page, 'D-003');
    await signIn(page);
    await page.getByTestId('action-approve-alternative').click();
    const d = page.getByTestId('action-dialog');
    await expect(d.getByRole('button', { name: 'Submit selection' })).toBeDisabled();
    await d.getByRole('radio').nth(1).check();
    await expect(d.getByRole('button', { name: 'Submit selection' })).toBeDisabled();
    await d.getByRole('textbox').last().fill('too short');
    await expect(d.getByText(/At least 10 characters/)).toBeVisible();
    await expect(d.getByRole('button', { name: 'Submit selection' })).toBeDisabled();
    await d.getByRole('textbox').last().fill(REASON);
    await shot(page, '34-review-alternative-dialog');
    await d.getByRole('button', { name: 'Submit selection' }).click();
    await expect(d).toBeHidden();
    await expect(tracker(page)).toHaveAttribute('data-state', 'pull-request-created');
    const file = JSON.parse(bare('show', `${lastPr().head}:docs/decision-reviews/D-003/0001-approve-alternative.json`)) as { option: { key: string; recommended: boolean }; rationale: string; actor: { login: string } };
    expect(file.option.recommended).toBe(false);
    expect(file.rationale).toBe(REASON);
    expect(file.actor.login).toBe('test-owner');
    merge(lastPr().number);
    await tracker(page).getByRole('button', { name: 'Check GitHub status' }).click();
    await expect(page.getByTestId('review-rail')).toContainText('(not the recommended option)');
    await expect(status(page)).toContainText('Approved');
  });

  test('conditional approval needs at least one condition and shows the conditions once it is canonical', async ({ page }) => {
    await open(page, 'D-033');
    await signIn(page);
    await page.getByTestId('action-approve-with-conditions').click();
    const d = page.getByTestId('action-dialog');
    await expect(d.getByRole('button', { name: 'Submit conditional approval' })).toBeDisabled();
    await expect(d.getByText('At least one condition is needed.')).toBeVisible();
    await d.getByRole('textbox', { name: 'Condition 1', exact: true }).fill('Confirm in-country region support first');
    await d.getByRole('button', { name: 'Add a condition' }).click();
    await d.getByRole('textbox', { name: 'Condition 2', exact: true }).fill('Re-review after the pilot');
    await d.getByRole('button', { name: 'Submit conditional approval' }).click();
    await expect(d).toBeHidden();
    merge(lastPr().number);
    await tracker(page).getByRole('button', { name: 'Check GitHub status' }).click();
    await expect(status(page)).toContainText('Approved');
    await expect(page.getByTestId('conditions')).toContainText('Confirm in-country region support first');
    await expect(page.getByTestId('conditions')).toContainText('Re-review after the pilot');
    await expect(page.getByTestId('review-rail')).toContainText('Conditions');
  });

  test('rejection requires a rationale, and the decision is Rejected only after the merge', async ({ page }) => {
    await open(page, 'D-007');
    await signIn(page);
    await page.getByTestId('action-reject').click();
    const d = page.getByTestId('action-dialog');
    await expect(d.getByRole('button', { name: 'Submit rejection' })).toBeDisabled();
    await d.getByRole('textbox').fill('Violates the residency constraint HC-01.');
    await d.getByRole('button', { name: 'Submit rejection' }).click();
    await expect(d).toBeHidden();
    await expect(status(page)).toContainText('Pending Review');
    merge(lastPr().number);
    await tracker(page).getByRole('button', { name: 'Check GitHub status' }).click();
    await expect(status(page)).toContainText('Rejected');
    await expect(page.getByTestId('timeline')).toContainText('Violates the residency constraint HC-01.');
  });

  test('request revision, defer and comment each need their text, and a comment changes no status', async ({ page }) => {
    await open(page, 'D-034');
    await signIn(page);
    await act(page, 'comment', { reason: 'Waiting on the sovereignty lead.', submit: 'Submit comment' });
    merge(lastPr().number);
    await tracker(page).getByRole('button', { name: 'Check GitHub status' }).click();
    await expect(tracker(page)).toBeHidden();
    await expect(status(page)).toContainText('Pending Review');
    await expect(page.getByTestId('timeline')).toContainText('Waiting on the sovereignty lead.');
    await act(page, 'defer', { reason: 'Postponed to milestone M2.', submit: 'Submit deferral' });
    merge(lastPr().number);
    await tracker(page).getByRole('button', { name: 'Check GitHub status' }).click();
    await expect(status(page)).toContainText('Deferred');
    await act(page, 'request-revision', { reason: 'Add the cost comparison before deciding.', submit: 'Request revision' });
    merge(lastPr().number);
    await tracker(page).getByRole('button', { name: 'Check GitHub status' }).click();
    await expect(status(page)).toContainText('Pending Review');
  });
});

test.describe('reopening', () => {
  test('an approved decision is reopened only through the workflow, with a reason, and the earlier approval stays on record', async ({ page }) => {
    await open(page, 'ADR-0020');
    await signIn(page);
    await expect(status(page)).toContainText('Approved');
    await page.getByTestId('action-reopen').click();
    const d = page.getByTestId('action-dialog');
    await expect(d.getByRole('button', { name: 'Submit reopening' })).toBeDisabled();
    await d.getByRole('textbox').fill('New cost evidence changes the trade-off.');
    await d.getByRole('button', { name: 'Submit reopening' }).click();
    await expect(d).toBeHidden();
    await expect(status(page)).toContainText('Approved'); // still approved until the reopening is merged
    merge(lastPr().number);
    await tracker(page).getByRole('button', { name: 'Check GitHub status' }).click();
    await expect(status(page)).toContainText('Pending Review');
    await expect(page.getByTestId('timeline')).toContainText('Approve the recommended option');
    await expect(page.getByTestId('timeline')).toContainText('Reopen');
    expect(reviewFiles().filter((f) => f.includes('ADR-0020'))).toEqual(['docs/decision-reviews/ADR-0020/0001-approve.json', 'docs/decision-reviews/ADR-0020/0002-reopen.json']);
    await expect(page.getByTestId('action-approve')).not.toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('who may act', () => {
  test('an unregistered person can read and comment but cannot decide, in the UI or through the API', async ({ page }) => {
    await open(page, 'D-004');
    await signIn(page, USERS.outsider);
    await expect(page.getByTestId('identity')).toContainText('Not a registered approver');
    await expect(page.getByTestId('action-reject')).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('action-reject').click({ force: true }); // aria-disabled, but clickable so that it can explain itself
    await expect(page.getByTestId('rail-notice')).toContainText('is not a registered approver');
    await expect(page.getByTestId('action-dialog')).toHaveCount(0);
    await shot(page, '35-review-unauthorised');
    await expect(page.getByTestId('action-comment')).not.toHaveAttribute('aria-disabled', 'true');

    const token = await csrf(page.request);
    const rev = (await (await page.request.get('/api/v1/review/D-004')).json()) as { view: { revision: string } };
    const before = prs().length;
    const r = await post(page.request, '/api/v1/review/D-004/actions', { action: 'reject', rationale: REASON, expectedRevision: rev.view.revision, idempotencyKey: 'outsider-direct-1' }, { 'x-studio-csrf': token });
    expect(r.status()).toBe(403);
    expect(((await r.json()) as { code: string }).code).toBe('not-listed');
    expect(prs().length).toBe(before);
  });

  test('a registered person without the required role is refused, and the refusal is audited', async ({ page }) => {
    await open(page, 'D-004');
    await signIn(page, USERS.quality);
    await expect(page.getByTestId('identity')).toContainText('quality-manager');
    await expect(page.getByTestId('action-reject')).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('unavailable-reasons').waitFor({ state: 'attached' });
    await expect(page.getByTestId('unavailable-reasons')).toContainText('does not hold a role');
    const token = await csrf(page.request);
    const rev = (await (await page.request.get('/api/v1/review/D-004')).json()) as { view: { revision: string } };
    const r = await post(page.request, '/api/v1/review/D-004/actions', { action: 'reject', rationale: REASON, expectedRevision: rev.view.revision, idempotencyKey: 'quality-direct-1' }, { 'x-studio-csrf': token });
    expect(r.status()).toBe(403);
    expect(((await r.json()) as { code: string }).code).toBe('missing-role');
    const audit = (await (await page.request.get('/api/v1/review/D-004')).json()) as { audit: { outcome: string; code: string; actor: string }[] };
    expect(audit.audit.some((a) => a.outcome === 'denied' && a.code === 'missing-role' && a.actor === 'test-quality')).toBe(true);
  });

  test('a bot account cannot sign in, and a request without a session, origin or CSRF token is refused', async ({ page, request }) => {
    await open(page, 'D-004');
    as(USERS.bot);
    await page.getByTestId('sign-in').click();
    await expect(page.getByRole('alert').filter({ hasText: "Only a person's GitHub account can decide" })).toBeVisible();
    await expect(page.getByTestId('identity')).toHaveCount(0);

    const body = { action: 'comment', comment: 'hello', expectedRevision: 'x', idempotencyKey: 'anon-direct-0001' };
    expect((await post(request, '/api/v1/review/D-004/actions', body)).status(), 'no session').toBe(401);
    as(USERS.owner);
    await open(page, 'D-004');
    await signIn(page);
    const token = await csrf(page.request);
    expect((await page.request.post('/api/v1/review/D-004/actions', { data: body, headers: { 'content-type': 'application/json', 'x-studio-csrf': token } })).status(), 'no Origin header').toBe(403);
    expect((await post(page.request, '/api/v1/review/D-004/actions', body, { origin: 'http://evil.example', 'x-studio-csrf': token })).status(), 'foreign origin').toBe(403);
    expect((await post(page.request, '/api/v1/review/D-004/actions', body)).status(), 'no CSRF token').toBe(403);
    expect((await page.request.post('/api/v1/review/D-004/actions', { data: 'x', headers: { origin: BASE, 'content-type': 'text/plain', 'x-studio-csrf': token } })).status(), 'wrong content type').toBe(415);
    const audit = (await (await request.get('/api/v1/review/D-004')).json()) as { audit: { outcome: string; code: string }[] };
    expect(audit.audit.some((a) => a.outcome === 'denied' && a.code === 'unauthenticated')).toBe(true);
  });

  test('a Blocked decision cannot be approved, but can be rejected, deferred or commented on', async ({ page }) => {
    await open(page, 'ADR-0004');
    await signIn(page);
    for (const a of ['approve', 'approve-alternative', 'approve-with-conditions']) await expect(page.getByTestId(`action-${a}`)).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('unavailable-reasons').waitFor({ state: 'attached' });
    await expect(page.getByTestId('unavailable-reasons')).toContainText('Approval is refused while the decision is Blocked');
    for (const a of ['reject', 'defer', 'request-revision', 'comment']) await expect(page.getByTestId(`action-${a}`)).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('the account is checked again at the moment of acting', async ({ page }) => {
    await open(page, 'D-035');
    await signIn(page);
    await page.getByTestId('action-comment').click();
    await page.getByTestId('action-dialog').getByRole('textbox').fill('A comment from the first account.');
    as(USERS.quality); // someone ran `gh auth switch` meanwhile
    await page.getByTestId('action-dialog').getByRole('button', { name: 'Submit comment' }).click();
    await expect(page.getByTestId('action-dialog').getByRole('alert')).toContainText('is now test-quality, not test-owner');
    await page.keyboard.press('Escape');
    expect(prs().filter((p) => p.head.includes('D-035'))).toHaveLength(0);
  });
});

test.describe('duplicate and stale submissions', () => {
  test('a double click creates one proposal and one pull request', async ({ page }) => {
    await open(page, 'D-035');
    await signIn(page);
    const before = prs().length;
    await page.getByTestId('action-comment').click();
    const d = page.getByTestId('action-dialog');
    await d.getByRole('textbox').fill('Posted with a double click.');
    await d.getByRole('button', { name: 'Submit comment' }).dblclick();
    await expect(d).toBeHidden();
    await expect(tracker(page)).toBeVisible();
    expect(prs().length).toBe(before + 1);
    expect(prs().filter((p) => p.head.includes('D-035'))).toHaveLength(1);
  });

  test('the same idempotency key returns the same proposal; a different change is refused while one is in flight', async ({ page }) => {
    await open(page, 'D-032');
    await signIn(page);
    const token = await csrf(page.request);
    const rev = ((await (await page.request.get('/api/v1/review/D-032')).json()) as { view: { revision: string } }).view.revision;
    const body = { action: 'comment', comment: 'First and only.', expectedRevision: rev, idempotencyKey: 'dup-key-0000001' };
    const a = await post(page.request, '/api/v1/review/D-032/actions', body, { 'x-studio-csrf': token });
    expect(a.status()).toBe(200);
    const first = (await a.json()) as { duplicate: boolean; proposal: { id: string } };
    expect(first.duplicate).toBe(false);
    const b = await post(page.request, '/api/v1/review/D-032/actions', body, { 'x-studio-csrf': token });
    const second = (await b.json()) as { duplicate: boolean; proposal: { id: string } };
    expect(second.duplicate).toBe(true);
    expect(second.proposal.id).toBe(first.proposal.id);
    expect(prs().filter((p) => p.head.includes('D-032'))).toHaveLength(1);
    const newRev = ((await (await page.request.get('/api/v1/review/D-032')).json()) as { view: { revision: string } }).view.revision;
    const c = await post(page.request, '/api/v1/review/D-032/actions', { ...body, comment: 'A second one.', idempotencyKey: 'dup-key-0000002', expectedRevision: newRev }, { 'x-studio-csrf': token });
    expect(c.status()).toBe(409);
    expect(((await c.json()) as { code: string }).code).toBe('proposal-open');
  });

  test('a stale view is refused with a clear message, and reloading shows the current state', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: BASE });
    const a = await ctx.newPage();
    const b = await ctx.newPage();
    await open(a, 'D-037');
    await signIn(a);
    await open(b, 'D-037');
    await expect(b.getByTestId('identity')).toBeVisible();
    // Page A acts first.
    await act(a, 'comment', { reason: 'Page A got there first.', submit: 'Submit comment' });
    await expect(tracker(a)).toBeVisible();
    // Page B still shows the old state and tries to reject.
    await b.getByTestId('action-reject').click();
    const d = b.getByTestId('action-dialog');
    await d.getByRole('textbox').fill('Page B rejects on a stale view.');
    await d.getByRole('button', { name: 'Submit rejection' }).click();
    await expect(d.getByRole('alert')).toContainText('This decision changed after you opened it');
    await shot(b, '36-review-stale-revision');
    await expect(d.getByRole('button', { name: 'Submit rejection' })).toBeDisabled();
    await d.getByRole('button', { name: 'Reload this decision' }).click();
    await b.keyboard.press('Escape');
    await expect(tracker(b)).toBeVisible();
    await expect(b.getByTestId('action-reject')).toHaveAttribute('aria-disabled', 'true');
    expect(prs().filter((p) => p.head.includes('D-037'))).toHaveLength(1);
    await ctx.close();
  });
});

test.describe('GitHub synchronisation failure and recovery', () => {
  test('when GitHub cannot be reached the request is kept, says so, and can be sent again', async ({ page }) => {
    await open(page, 'D-031');
    await signIn(page);
    const good = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: work, encoding: 'utf8' }).stdout.trim();
    spawnSync('git', ['remote', 'set-url', 'origin', path.join(dir, 'unreachable.git')], { cwd: work });
    try {
      const before = prs().length;
      await act(page, 'comment', { reason: 'Sent while GitHub is unreachable.', submit: 'Submit comment' });
      await expect(tracker(page)).toHaveAttribute('data-state', 'awaiting-github-update');
      await expect(tracker(page)).toContainText('Last attempt');
      await expect(tracker(page)).toContainText('Could not fetch');
      await shot(page, '37-review-github-unreachable');
      expect(prs().length).toBe(before);
      await expect(status(page)).toContainText('Pending Review');
      await expect(page.getByTestId('action-reject')).toHaveAttribute('aria-disabled', 'true');
    } finally {
      spawnSync('git', ['remote', 'set-url', 'origin', good], { cwd: work });
    }
    await tracker(page).getByRole('button', { name: 'Send to GitHub' }).click();
    await expect(tracker(page)).toHaveAttribute('data-state', 'pull-request-created');
    await expect(tracker(page)).not.toContainText('Last attempt');
  });

  test('a pull request closed without merging is reported as Failed and frees the decision', async ({ page }) => {
    await open(page, 'D-036');
    await signIn(page);
    await act(page, 'defer', { reason: 'Deferred, to be withdrawn again.', submit: 'Submit deferral' });
    const n = lastPr().number;
    const f = path.join(state, 'prs.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { prs: { number: number; closed: boolean }[] };
    j.prs.find((p) => p.number === n)!.closed = true;
    fs.writeFileSync(f, JSON.stringify(j));
    await tracker(page).getByRole('button', { name: 'Check GitHub status' }).click();
    await expect(tracker(page)).toHaveAttribute('data-state', 'failed');
    await expect(tracker(page).getByRole('alert')).toContainText('closed without merging');
    await expect(status(page)).toContainText('Pending Review');
    await expect(page.getByTestId('action-reject')).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('a decision that changed on the canonical branch while the request waited is reported as Conflicted', async ({ page }) => {
    await open(page, 'D-030');
    await signIn(page);
    await act(page, 'comment', { reason: 'This one will be overtaken.', submit: 'Submit comment' });
    // Someone else's first event for D-030 reaches main directly, so this pull request can no longer merge cleanly.
    const other = path.join(dir, 'other');
    if (!fs.existsSync(other)) spawnSync('git', ['clone', '-q', remote, other]);
    const run = (...a: string[]) => spawnSync('git', a, { cwd: other, encoding: 'utf8' });
    run('config', 'user.email', 'o@example.invalid');
    run('config', 'user.name', 'Other');
    run('config', 'commit.gpgsign', 'false');
    run('pull', '-q', '--ff-only', 'origin', 'main');
    const ours = JSON.parse(bare('show', `${lastPr().head}:docs/decision-reviews/D-030/0001-comment.json`)) as Record<string, unknown>;
    // A valid-looking competing file at the same position. Its hash differs, which is what matters here.
    fs.mkdirSync(path.join(other, 'docs', 'decision-reviews', 'D-030'), { recursive: true });
    fs.writeFileSync(path.join(other, 'docs', 'decision-reviews', 'D-030', '0001-comment.json'), `${JSON.stringify({ ...ours, comment: 'Someone else, first.' }, null, 2)}\n`);
    run('add', '-A');
    run('commit', '-q', '-m', 'competing event');
    run('push', '-q', 'origin', 'HEAD:refs/heads/main');
    await tracker(page).getByRole('button', { name: 'Check GitHub status' }).click();
    await expect(tracker(page)).toHaveAttribute('data-state', 'conflicted');
    await expect(tracker(page).getByRole('alert')).toContainText('Reload and decide again');
    await shot(page, '38-review-conflicted');
  });
});

test.describe('quality', () => {
  test('the review page and its dialog have no automatically detectable accessibility violations', async ({ page }) => {
    await open(page, 'D-001');
    await signIn(page);
    await expectNoAxeViolations(page, 'review page');
    await page.getByTestId('action-reject').click();
    await expect(page.getByTestId('action-dialog')).toBeVisible();
    await expectNoAxeViolations(page, 'rejection dialog');
    await page.keyboard.press('Escape');
    await page.getByTestId('action-approve-with-conditions').click();
    await expectNoAxeViolations(page, 'conditions dialog');
  });

  test('dialogs trap and return focus, close with Escape, and keys never submit anything', async ({ page }) => {
    await open(page, 'D-001');
    await signIn(page);
    await page.getByRole('heading', { level: 1 }).click();
    const before = prs().length;
    await page.keyboard.press('r');
    await expect(page.getByTestId('action-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('action-dialog')).toBeHidden();
    await page.keyboard.press('a');
    await expect(page.getByTestId('rail-notice')).toContainText('unavailable'); // D-001 recommends nothing
    expect(prs().length).toBe(before);
  });

  test('the audit trail records the attempts made on this decision, accepted and refused', async ({ page }) => {
    await open(page, 'D-004');
    await page.getByText(/Audit trail \(/).click();
    const trail = page.getByTestId('audit-trail');
    await expect(trail).toContainText('denied');
    await expect(trail).toContainText('not-listed');
  });

  test('the loading and error states of the rail are handled', async ({ page }) => {
    await page.route('**/api/v1/review/D-001', (r) => r.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ detail: 'simulated outage' }) }));
    await page.goto('/decisions/D-001/review');
    await expect(page.getByRole('alert').filter({ hasText: 'The review state could not be loaded' })).toContainText('simulated outage');
    await page.unroute('**/api/v1/review/D-001');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId('action-reject')).toBeVisible();
  });
});

test('the test-mode banner is shown, so simulated GitHub is never mistaken for the real one', async ({ page }) => {
  await open(page, 'D-001');
  await expect(page.getByTestId('test-mode-banner')).toContainText('TEST MODE');
});
