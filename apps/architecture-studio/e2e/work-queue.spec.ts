import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect as baseExpect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { USERS } from '../checks/fixtures/review-fixture.ts';
import { expectNoAxeViolations } from './helpers.ts';

const expect = baseExpect.configure({ timeout: 20_000 });

// The Work Queue write path and its dependency logic, in a real browser, against the throw-away clone with a local bare "GitHub"
// remote and a simulated pull-request service (server on port 3103, STUDIO_TEST_MODE). A person's merge is done with git on the
// bare remote, as GitHub would. Nothing here touches the real repository or GitHub.
const BASE = 'http://localhost:3103';
test.use({ baseURL: BASE });
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const dir = process.env.STUDIO_E2E_REVIEW_DIR!;
const state = path.join(dir, 'state');
const remote = path.join(dir, 'origin.git');
const work = path.join(dir, 'work');

type User = (typeof USERS)[keyof typeof USERS];
const as = (u: User | null) => (u ? fs.writeFileSync(path.join(state, 'identity.json'), JSON.stringify(u)) : fs.rmSync(path.join(state, 'identity.json'), { force: true }));
const bare = (...a: string[]) => spawnSync('git', ['--git-dir', remote, ...a], { encoding: 'utf8' }).stdout.trim();
const prs = () => (JSON.parse(fs.readFileSync(path.join(state, 'prs.json'), 'utf8')) as { prs: { number: number; headSha: string; head: string }[] }).prs;
const lastPr = () => prs().at(-1)!;
const mainSha = () => bare('rev-parse', 'refs/heads/main');
const workFiles = (id: string) => bare('ls-tree', '-r', '--name-only', 'refs/heads/main').split('\n').filter((f) => f.startsWith(`docs/work-items/${id}/`));

function merge(n: number) {
  const pr = prs().find((p) => p.number === n)!;
  const ff = spawnSync('git', ['--git-dir', remote, 'merge-base', '--is-ancestor', mainSha(), pr.headSha]).status === 0;
  expect(ff, 'the pull request merges cleanly').toBe(true);
  bare('update-ref', 'refs/heads/main', pr.headSha);
}

const shotDir = path.resolve(process.cwd(), '..', '..', 'docs', 'architecture-studio', 'screenshots');
async function shot(target: Page | Locator, name: string, fullPage = false) {
  await new Promise((r) => setTimeout(r, 450));
  if ('goto' in target) await target.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage, animations: 'disabled' });
  else await target.screenshot({ path: path.join(shotDir, `${name}.png`), animations: 'disabled' });
}

async function openItem(page: Page, id: string) {
  await page.goto(`/queue?id=${id}`);
  await expect(page.getByTestId('item-detail')).toBeVisible();
  await expect(page.getByTestId('work-assign')).toBeVisible();
  // Actions load after the item: wait until the signed-in state is settled.
  await expect(page.getByRole('status', { name: 'Loading actions' })).toBeHidden();
}

async function signIn(page: Page, u: User) {
  as(u);
  const btn = page.getByTestId('sign-in').first();
  if (await btn.isVisible()) await btn.click();
  await expect(page.getByTestId('identity')).toContainText(`@${u.login}`);
}

/** Switch account the way a person would: change who GitHub reports, then reload so the Studio asks GitHub again. */
async function switchTo(page: Page, id: string, u: User) {
  await page.request.post('/api/v1/auth/signout', { headers: { 'content-type': 'application/json', origin: BASE }, data: {} });
  as(u);
  await openItem(page, id);
  await signIn(page, u);
}

const tracker = (page: Page) => page.getByTestId('proposal-tracker');
const dlg = (page: Page) => page.getByTestId('work-action-dialog');
const statusOf = (page: Page) => page.getByTestId('field-status');

async function act(page: Page, action: string, fill: { text?: string; assignee?: string; due?: string; priority?: string; blockedBy?: string; evidence?: string[]; submit: string }) {
  await page.getByTestId(`work-${action}`).click();
  const d = dlg(page);
  await expect(d).toBeVisible();
  if (fill.assignee) await d.getByLabel('Assign to').selectOption(fill.assignee);
  if (fill.due) await d.getByLabel('Due date (only if agreed)').fill(fill.due);
  if (fill.priority) await d.getByLabel('New priority').selectOption(fill.priority);
  if (fill.blockedBy) await d.getByLabel('Blocked by (item ids, optional)').fill(fill.blockedBy);
  for (const [i, e] of (fill.evidence ?? []).entries()) {
    if (i > 0) await d.getByRole('button', { name: 'Add evidence' }).click();
    await d.getByRole('textbox', { name: `Evidence ${i + 1}`, exact: true }).fill(e);
  }
  if (fill.text !== undefined) await d.locator('#wk-rationale').fill(fill.text);
  await d.getByRole('button', { name: fill.submit }).click();
  await expect(d).toBeHidden({ timeout: 30_000 });
}

/** A person merges the pull request on GitHub; the Studio then verifies it on the canonical branch. */
async function mergeAndVerify(page: Page) {
  if ((await tracker(page).getAttribute('data-state')) !== 'awaiting-merge') {
    await tracker(page).getByRole('button', { name: /Send to GitHub|Check GitHub status/ }).click();
    await expect(tracker(page)).toHaveAttribute('data-state', 'awaiting-merge');
  }
  merge(lastPr().number);
  // Checking is a real git fetch and model rebuild; if the click lands mid-render or the check is slow, ask again.
  await expect(async () => {
    if (await tracker(page).isVisible()) await tracker(page).getByRole('button', { name: 'Check GitHub status' }).click({ timeout: 5_000 }).catch(() => undefined);
    await expect(tracker(page)).toBeHidden({ timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
}

const TASK = 'T14';
const TASK2 = 'T15';

test.describe('work item actions', () => {
  test('signed out, and as a person who is not registered, the actions explain why they are unavailable', async ({ page }) => {
    as(null);
    await openItem(page, TASK);
    await expect(page.getByTestId('work-assign')).toHaveAttribute('title', /Sign in/);
    await signIn(page, USERS.outsider);
    await expect(page.getByTestId('work-assign')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('work-assign')).toHaveAttribute('title', /does not allow this/i);
    // A viewer reads; commenting needs the contributor role.
    await expect(page.getByTestId('work-comment')).toHaveAttribute('aria-disabled', 'true');
    await shot(page, '40-queue-item-unregistered');
  });

  test('assign: an unmerged request changes nothing; the owner and due date appear only after the merge', async ({ page, request }) => {
    await openItem(page, TASK);
    await signIn(page, USERS.owner);
    await shot(page, '41-queue-item-actions');
    await page.getByTestId('work-assign').click();
    const d = dlg(page);
    await d.getByLabel('Due date (only if agreed)').fill('2031-01-05');
    await shot(page, '42-queue-assign-dialog');
    await d.getByRole('button', { name: 'Submit assignment' }).click();
    await expect(d).toBeHidden();
    await expect(tracker(page)).toHaveAttribute('data-state', 'pull-request-created');
    const q0 = (await (await request.get('/api/v1/queue/' + TASK)).json()) as { item: { assignee: string | null; dueDate: string | null } };
    expect(q0.item.assignee).toBeNull();
    expect(q0.item.dueDate).toBeNull();
    // One change at a time.
    await expect(page.getByTestId('work-comment')).toHaveAttribute('aria-disabled', 'true');
    const file = JSON.parse(bare('show', `${lastPr().head}:docs/work-items/${TASK}/0001-assign.json`)) as { assignee: string; dueDate: string; actor: { login: string } };
    expect(file).toMatchObject({ assignee: 'test-owner', dueDate: '2031-01-05', actor: { login: 'test-owner' } });
    await mergeAndVerify(page);
    await expect(page.getByTestId('item-detail')).toContainText('@test-owner');
    await expect(page.getByTestId('item-detail')).toContainText('2031-01-05');
    await expect(page.getByTestId('work-timeline')).toContainText('Assign');
    expect(workFiles(TASK)).toEqual([`docs/work-items/${TASK}/0001-assign.json`]);
  });

  test('My tasks shows the item that was assigned, with the signed-in account', async ({ page }) => {
    as(USERS.owner);
    await page.goto('/queue?view=mine');
    await page.getByTestId('mine-sign-in').click();
    await expect(page.getByTestId('queue-table')).toBeVisible();
    await expect(page.getByTestId('queue-row').filter({ hasText: TASK }).first()).toBeVisible();
    await shot(page, '43-queue-my-tasks');
    await expect(page.getByTestId('count-mine')).not.toHaveText('0');
  });

  test('prioritize needs a reason and the new priority is attributed', async ({ page }) => {
    await openItem(page, TASK);
    await signIn(page, USERS.owner);
    await page.getByTestId('work-prioritize').click();
    const d = dlg(page);
    await d.getByLabel('New priority').selectOption('Critical');
    await expect(d.getByTestId('work-submit')).toBeDisabled();
    await d.locator('#wk-rationale').fill('short');
    await expect(d.getByTestId('work-submit')).toBeDisabled();
    await d.locator('#wk-rationale').fill('It gates the branch protection decision.');
    await d.getByTestId('work-submit').click();
    await expect(d).toBeHidden();
    await mergeAndVerify(page);
    await expect(page.getByTestId('item-detail')).toContainText('Set by @test-owner');
    await expect(page.getByTestId('item-detail')).toContainText('Critical');
  });

  test('comment, mark blocked (with a block reference that must exist), clarification and clearing', async ({ page }) => {
    await openItem(page, TASK);
    await signIn(page, USERS.owner);
    await act(page, 'comment', { text: 'Waiting for the repository admin.', submit: 'Submit comment' });
    await mergeAndVerify(page);
    await expect(page.getByTestId('work-timeline')).toContainText('Waiting for the repository admin.');

    await page.getByTestId('work-mark-blocked').click();
    const d = dlg(page);
    await d.getByLabel('Blocked by (item ids, optional)').fill('NOPE-99');
    await d.locator('#wk-rationale').fill('Needs the admin to enable branch protection.');
    await expect(d.getByText('Not in the queue: NOPE-99')).toBeVisible();
    await expect(d.getByTestId('work-submit')).toBeDisabled();
    await d.getByLabel('Blocked by (item ids, optional)').fill('T15');
    await d.getByTestId('work-submit').click();
    await expect(d).toBeHidden();
    await mergeAndVerify(page);
    await expect(statusOf(page)).toHaveText('Blocked');
    await expect(page.getByText('Marked blocked', { exact: true })).toBeVisible();
    // While blocked, completion actions are closed.
    await expect(page.getByTestId('work-submit-for-review')).toHaveAttribute('aria-disabled', 'true');
    await shot(page.getByTestId('detail-sheet'), '44-queue-item-blocked');

    await act(page, 'unblock', { text: 'The admin enabled it.', submit: 'Clear block' });
    await mergeAndVerify(page);
    await expect(statusOf(page)).toHaveText('Open');

    await act(page, 'request-clarification', { text: 'Which branches does the rule cover?', submit: 'Request clarification' });
    await mergeAndVerify(page);
    await expect(statusOf(page)).toHaveText('Awaiting clarification');
    await act(page, 'unblock', { text: 'Owner confirmed: main only.', submit: 'Clear block' });
    await mergeAndVerify(page);
    await expect(statusOf(page)).toHaveText('Open');
    expect(workFiles(TASK).length).toBe(7);
  });

  test('submit for review needs evidence that exists in the repository', async ({ page }) => {
    await openItem(page, TASK);
    await signIn(page, USERS.owner);
    await page.getByTestId('work-submit-for-review').click();
    const d = dlg(page);
    await expect(d.getByTestId('work-submit')).toBeDisabled();
    await d.getByRole('textbox', { name: 'Evidence 1', exact: true }).fill('docs/no/such/file.md');
    await d.getByTestId('work-submit').click();
    await expect(d.getByRole('alert')).toContainText('does not exist');
    await d.getByRole('textbox', { name: 'Evidence 1', exact: true }).fill('EV-9999');
    await d.getByTestId('work-submit').click();
    await expect(d.getByRole('alert')).toContainText('not an evidence record');
    await d.getByRole('textbox', { name: 'Evidence 1', exact: true }).fill('docs/state/TODO.md');
    await d.getByTestId('work-submit').click();
    await expect(d).toBeHidden();
    await mergeAndVerify(page);
    await expect(statusOf(page)).toHaveText('In review');
    await shot(page.getByTestId('detail-sheet'), '45-queue-item-in-review');
  });

  test('the person who submitted cannot approve their own completion; a second approver can, and only then is it Done', async ({ page, request }) => {
    await openItem(page, TASK);
    await signIn(page, USERS.owner);
    await expect(page.getByTestId('work-approve-completion')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('work-approve-completion')).toHaveAttribute('title', /submitted|independent|own/i);
    expect(((await (await request.get('/api/v1/queue/' + TASK)).json()) as { item: { status: string } }).item.status).toBe('In review');

    await switchTo(page, TASK, USERS.owner2);
    await page.getByTestId('work-approve-completion').click();
    await expect(dlg(page)).toContainText('docs/state/TODO.md');
    await shot(page, '46-queue-approve-completion-dialog');
    await dlg(page).getByTestId('work-submit').click();
    await expect(dlg(page)).toBeHidden();
    // Not Done until the record is merged on the canonical branch.
    await expect(statusOf(page)).toHaveText('In review');
    await mergeAndVerify(page);
    await expect(statusOf(page)).toHaveText('Done');
    await expect(page.getByTestId('item-detail')).toContainText('approved by @test-owner2');
    await page.goto('/queue?view=completed&q=' + TASK);
    await expect(page.getByTestId('queue-row')).toHaveCount(1);
    await shot(page, '47-queue-completed');
  });

  test('reopen needs a reason and returns completed work to open without erasing the record', async ({ page }) => {
    await openItem(page, TASK);
    await signIn(page, USERS.owner);
    await expect(page.getByTestId('work-assign')).toHaveAttribute('aria-disabled', 'true');
    await act(page, 'reopen', { text: 'The branch rule was reverted.', submit: 'Reopen' });
    await mergeAndVerify(page);
    await expect(statusOf(page)).toHaveText('Open');
    await expect(page.getByText('Reopened', { exact: true })).toBeVisible();
    await expect(page.getByTestId('work-timeline')).toContainText('Approve completion');
  });

  test('reject completion returns the item to open and says why', async ({ page }) => {
    await openItem(page, TASK2);
    await signIn(page, USERS.owner);
    await act(page, 'submit-for-review', { evidence: ['docs/state/STATE.md'], submit: 'Submit for review' });
    await mergeAndVerify(page);
    await switchTo(page, TASK2, USERS.owner2);
    await page.getByTestId('work-reject-completion').click();
    await expect(dlg(page).getByTestId('work-submit')).toBeDisabled();
    await dlg(page).locator('#wk-rationale').fill('The state file does not show the rule in force.');
    await dlg(page).getByTestId('work-submit').click();
    await expect(dlg(page)).toBeHidden();
    await mergeAndVerify(page);
    await expect(statusOf(page)).toHaveText('Open');
    await expect(page.getByText('Completion rejected', { exact: true })).toBeVisible();
  });

  test('a duplicate submission and a stale view are refused', async ({ request }) => {
    as(USERS.owner);
    const session = (await (await request.post('/api/v1/auth/signin', { headers: { 'content-type': 'application/json', origin: BASE }, data: {} })).json()) as { csrf: string };
    const post = (body: Record<string, unknown>) => request.post('/api/v1/queue/T16/actions', { headers: { 'content-type': 'application/json', origin: BASE, 'x-studio-csrf': session.csrf }, data: body });
    const view = (await (await request.get('/api/v1/queue/T16')).json()) as { view: { revision: string } };
    const body = { action: 'comment', comment: 'First comment.', expectedRevision: view.view.revision, idempotencyKey: 'dup-key-12345678' };
    const a = await post(body);
    expect(a.status()).toBe(200);
    const b = await post(body);
    expect(((await b.json()) as { duplicate: boolean }).duplicate).toBe(true);
    const stale = await post({ ...body, comment: 'Second.', idempotencyKey: 'other-key-12345678' });
    expect(stale.status()).toBe(409);
    expect(((await stale.json()) as { code: string }).code).toMatch(/stale-revision|proposal-open/);
  });
});

test.describe('decisions change what is blocked, and only what is linked', () => {
  type Q = { items: { id: string; kind: string; status: string; critical: boolean; reviewNeeded: unknown[]; derivedBlocks: unknown[] }[]; edges: { from: string; to: string; type: string }[] };
  const USED = new Set(['D-003', 'D-033', 'D-034', 'ADR-0020']);

  async function pick(request: APIRequestContext, test: (d: { scenarios: { ifRejected: { requiring: { id: string }[] }; ifDeferred: { mustRemainBlocked: string[] } } }) => boolean) {
    const q = (await (await request.get('/api/v1/queue')).json()) as Q;
    const cands = [...new Set(q.edges.filter((e) => e.type === 'requires' && /^D-\d+$/.test(e.to)).map((e) => e.to))].filter((id) => !USED.has(id) && q.items.find((i) => i.id === id)?.status === 'Open');
    for (const id of cands) {
      const review = (await (await request.get('/api/v1/review/' + id)).json()) as { view: { open: unknown; governance: { domain: string } } };
      if (review.view.open) continue; // another test left a request in flight on this decision
      if (review.view.governance.domain !== 'architecture') continue; // only the architecture owner decides these; security and regulatory records need other approval
      const d = (await (await request.get('/api/v1/queue/' + id)).json()) as never;
      if (test(d)) return { id, q };
    }
    throw new Error('no suitable decision found in the data');
  }

  async function decide(page: Page, id: string, action: 'reject' | 'defer', reason: string, submit: string) {
    await page.goto(`/decisions/${id}/review`);
    await expect(page.getByTestId('review-rail').getByRole('heading', { name: 'Your identity' })).toBeVisible();
    as(USERS.owner);
    const btn = page.getByTestId('sign-in');
    if (await btn.isVisible()) await btn.click();
    await expect(page.getByTestId('identity')).toContainText('@test-owner');
    await page.getByTestId(`action-${action}`).click();
    const d = page.getByTestId('action-dialog');
    await d.getByRole('textbox').fill(reason);
    await d.getByRole('button', { name: submit }).click();
    await expect(d).toBeHidden({ timeout: 30_000 });
    await page.getByTestId('proposal-tracker').getByRole('button', { name: /Send to GitHub|Check GitHub status/ }).click();
    await expect(page.getByTestId('proposal-tracker')).toHaveAttribute('data-state', 'awaiting-merge');
    merge(lastPr().number);
    await page.getByTestId('proposal-tracker').getByRole('button', { name: 'Check GitHub status' }).click();
    await expect(page.getByTestId('proposal-tracker')).toBeHidden();
  }

  test('a rejected decision lists the work that requires it and flags it for review, without changing any status', async ({ page, request }) => {
    const { id, q } = await pick(request, (d) => d.scenarios.ifRejected.requiring.length > 0);
    const before = (await (await request.get('/api/v1/queue/' + id)).json()) as { scenarios: { ifRejected: { requiring: { id: string }[]; mentioning: { id: string }[] } } };
    // Build-blockers such as BLK-5 ("N decisions are needed by milestone M1") are derived from the decisions still open, so a decision that
    // has just been decided leaves them by design (src/lib/repo/build.ts). Every other kind of dependent must stay exactly as previewed.
    const requiring = before.scenarios.ifRejected.requiring.map((r) => r.id).filter((r) => !/^BLK-/.test(r));
    const unrelated = q.items.filter((i) => !requiring.includes(i.id) && !before.scenarios.ifRejected.mentioning.some((m) => m.id === i.id) && i.id !== id && i.kind !== 'decision');
    const statusBefore = new Map(q.items.map((i) => [i.id, i.status]));

    await page.goto(`/queue?id=${id}`);
    await expect(page.getByTestId('impact-panel')).toContainText('If rejected');
    await shot(page, '48-queue-decision-impact-preview');
    await decide(page, id, 'reject', 'Violates the residency constraint HC-01.', 'Submit rejection');

    const after = (await (await request.get('/api/v1/queue')).json()) as Q & { impacts: { decisionId: string; rule: string; requiring: { id: string }[] }[] };
    expect(after.items.find((i) => i.id === id)?.status).toBe('Rejected');
    const impact = after.impacts.find((i) => i.decisionId === id)!;
    expect(impact.rule).toBe('rejected');
    expect(impact.requiring.map((r) => r.id).filter((r) => !/^BLK-/.test(r)).sort()).toEqual([...requiring].sort());
    for (const r of requiring) {
      const it = after.items.find((i) => i.id === r)!;
      if (it.status !== 'Done') expect(it.reviewNeeded.length, `${r} is flagged`).toBeGreaterThan(0);
      expect(it.status, `${r} keeps its status`).toBe(statusBefore.get(r));
    }
    for (const u of unrelated) {
      const it = after.items.find((i) => i.id === u.id)!;
      expect(it.status, `${u.id} is untouched`).toBe(statusBefore.get(u.id));
      expect(it.derivedBlocks, `${u.id} is not blocked`).toEqual([]);
    }
    await page.goto('/queue/blocking');
    await expect(page.getByTestId('impact-list')).toContainText(id);
    await shot(page, '49-queue-blocking-after-rejection', true);
  });

  test('a critical decision that is deferred blocks the implementation work that requires it', async ({ page, request }) => {
    const { id, q } = await pick(request, (d) => d.scenarios.ifDeferred.mustRemainBlocked.length > 0);
    expect(q.items.find((i) => i.id === id)?.critical).toBe(true);
    const preview = (await (await request.get('/api/v1/queue/' + id)).json()) as { scenarios: { ifDeferred: { mustRemainBlocked: string[]; requiring: { id: string }[] } } };
    await decide(page, id, 'defer', 'Postponed until the sovereignty review finishes.', 'Submit deferral');
    const after = (await (await request.get('/api/v1/queue')).json()) as Q & { impacts: { decisionId: string; rule: string; mustRemainBlocked: string[] }[] };
    const impact = after.impacts.find((i) => i.decisionId === id)!;
    expect(impact.rule).toBe('deferred-critical');
    expect(impact.mustRemainBlocked.sort()).toEqual([...preview.scenarios.ifDeferred.mustRemainBlocked].sort());
    for (const b of impact.mustRemainBlocked) {
      const it = after.items.find((i) => i.id === b)!;
      expect(it.derivedBlocks.length, `${b} is blocked by the deferral`).toBeGreaterThan(0);
    }
    await page.goto(`/queue?view=blocked&q=${impact.mustRemainBlocked[0]}`);
    await expect(page.getByTestId('queue-row')).toHaveCount(1);
    await page.getByTestId('queue-row').locator('[data-row-btn]').click();
    await expect(page.getByTestId('item-detail')).toContainText('Blocked by a deferred critical decision');
    await shot(page, '50-queue-blocked-by-deferral');
  });

  test('a changed requirement flags the decisions it is linked to, and nothing else', async ({ page, request }) => {
    const q = (await (await request.get('/api/v1/queue')).json()) as { items: { id: string; kind: string; relatedRequirements: string[] }[] };
    const reqFile = path.join('docs', 'context', 'REQUIREMENTS.md');
    const text = fs.readFileSync(path.join(work, reqFile), 'utf8');
    const target = q.items.filter((i) => i.kind === 'decision').flatMap((d) => d.relatedRequirements.map((r) => ({ req: r, decision: d.id }))).find((x) => new RegExp(`^\\| ${x.req} \\|`, 'm').test(text));
    test.skip(!target, 'no decision links to a requirement in REQUIREMENTS.md at this commit');
    // Make an earlier version of the requirements on a branch, without touching the working copy.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-reqs-'));
    const g = (...a: string[]) => spawnSync('git', a, { cwd: tmp, encoding: 'utf8' });
    g('clone', '-q', '--local', '--no-hardlinks', work, '.');
    g('config', 'user.email', 'fixture@example.invalid');
    g('config', 'user.name', 'Fixture');
    g('config', 'commit.gpgsign', 'false');
    const changed = text.replace(new RegExp(`^(\\| ${target!.req} \\|[^|]*\\|)([^|]*)\\|`, 'm'), (_m, head: string) => `${head} Earlier wording of the title |`);
    expect(changed).not.toBe(text);
    fs.writeFileSync(path.join(tmp, reqFile), changed);
    g('commit', '-q', '-am', 'earlier requirements');
    g('push', '-q', work, 'HEAD:refs/heads/earlier-requirements');

    await page.goto('/queue/blocking');
    const box = page.getByTestId('requirement-check');
    await box.getByLabel('Compare against').fill('earlier-requirements');
    await box.getByRole('button', { name: 'Find affected decisions' }).click();
    const res = page.getByTestId('requirement-result');
    await expect(res).toContainText(target!.req);
    await expect(page.getByTestId('flagged-decisions')).toContainText(target!.decision);
    await shot(page.getByTestId('requirement-check'), '51-queue-requirement-change');
    // Only decisions that link to a changed requirement are listed.
    const flagged = await page.getByTestId('flagged-decisions').locator('li').count();
    const body = (await (await request.get('/api/v1/queue/requirements?from=earlier-requirements')).json()) as { changes: { id: string }[]; flagged: { decisionId: string }[] };
    expect(body.changes.map((c) => c.id)).toEqual([target!.req]);
    expect(flagged).toBe(body.flagged.length);
    expect(body.flagged.length).toBeLessThan(q.items.filter((i) => i.kind === 'decision').length);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

test.describe('the build-blocking view and states', () => {
  test('the graph and ready list follow the analysis, and the page has no accessibility violations', async ({ page }) => {
    as(null);
    await page.goto('/queue/blocking');
    await expect(page.getByTestId('dependency-graph')).toBeVisible();
    await shot(page, '52-queue-blocking', true);
    await expectNoAxeViolations(page, '/queue/blocking');
    await page.goto('/queue');
    await expect(page.getByTestId('queue-table')).toBeVisible();
    await expectNoAxeViolations(page, '/queue');
    await page.goto('/queue?id=D-019');
    await expect(page.getByTestId('item-detail')).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading actions' })).toBeHidden();
    await expectNoAxeViolations(page, '/queue?id=D-019');
    await shot(page, '53-queue-item-detail-decision');
  });

  test('a work-item API request without a session or from another origin is refused', async ({ request }) => {
    const noSession = await request.post('/api/v1/queue/T16/actions', { headers: { 'content-type': 'application/json', origin: BASE }, data: { action: 'comment' } });
    expect(noSession.status()).toBe(401);
    const crossOrigin = await request.post('/api/v1/queue/T16/actions', { headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, data: { action: 'comment' } });
    expect(crossOrigin.status()).toBe(403);
    const missing = await request.get('/api/v1/queue/NO-SUCH');
    expect(missing.status()).toBe(404);
  });
});
