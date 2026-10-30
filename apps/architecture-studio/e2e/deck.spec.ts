import fs from 'node:fs';
import path from 'node:path';
import { expect as baseExpect, test, type Page } from '@playwright/test';
import { USERS } from '../checks/fixtures/review-fixture.ts';
import { expectNoAxeViolations } from './helpers.ts';

const expect = baseExpect.configure({ timeout: 20_000 });

// The Presentation Studio deck builder. Reading is tested on the normal server (3100). Everything that changes something is tested on the
// test-mode server (3103) against a throw-away clone, with test identities of different roles. Nothing here touches the real repository's
// state: slide decisions and builds live in that server's own state folder.
const WRITE = 'http://localhost:3103';
const dir = process.env.STUDIO_E2E_REVIEW_DIR!;
const state = path.join(dir, 'state');
type User = (typeof USERS)[keyof typeof USERS];
const as = (u: User | null) => (u ? fs.writeFileSync(path.join(state, 'identity.json'), JSON.stringify(u)) : fs.rmSync(path.join(state, 'identity.json'), { force: true }));
const shotDir = path.resolve(process.cwd(), '..', '..', 'docs', 'architecture-studio', 'screenshots');
async function shot(page: Page, name: string) {
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(shotDir, `${name}.png`), animations: 'disabled' });
}

async function signInAs(page: Page, u: User) {
  as(u);
  await page.request.post(`${WRITE}/api/v1/auth/signout`, { headers: { 'content-type': 'application/json', origin: WRITE }, data: {} });
  await page.goto(`${WRITE}/presentation/deck`);
  await expect(page.getByTestId('deck-studio')).toBeVisible();
  const btn = page.getByTestId('deck-signin');
  if (await btn.isVisible()) await btn.click();
  await expect(page.getByTestId('deck-identity')).toContainText(u.login);
}

const slide = (page: Page, id: string) => page.getByTestId(`slide-${id}`).click();

test.describe('deck builder: reading', () => {
  test('shows every slide, the counts, and the gate with its reasons', async ({ page }) => {
    await page.goto('/presentation/deck');
    await expect(page.getByTestId('deck-studio')).toBeVisible();
    const total = Number((await page.getByTestId('count-slides').locator('b').innerText()).replace(/\D/g, ''));
    expect(total).toBeGreaterThanOrEqual(36);
    expect(await page.getByTestId('slide-list').locator('li').count()).toBe(total);
    await expect(page.getByTestId('count-approved')).toContainText('0 approved');
    await expect(page.getByTestId('count-placeholders')).not.toContainText('0 review');
    // The gate is honest: today a final deck is not possible, and each reason is stated.
    for (const id of ['baseline', 'decisions', 'slides']) await expect(page.getByTestId(`gate-${id}`)).toHaveAttribute('data-met', 'false');
    await expect(page.getByTestId('gate-claims')).toHaveAttribute('data-met', 'true');
    await expect(page.getByTestId('gate-baseline')).toContainText('No baseline is authorized');
    await expect(page.getByTestId('gate-decisions')).toContainText('ADR-0016');
    await shot(page, 'deck-builder-overview');
  });

  test('a slide shows its sources, its checked claims, decision status, notes and placeholders', async ({ page }) => {
    await page.goto('/presentation/deck?slide=E07');
    const d = page.getByTestId('slide-detail');
    await expect(d).toHaveAttribute('data-slide-id', 'E07');
    await expect(page.getByTestId('title-input')).toHaveValue(/sovereign cells/i);
    await expect(page.getByTestId('slide-sources').getByRole('link').first()).toHaveAttribute('href', /github\.com\/.*\/blob\/[0-9a-f]{40}\//);
    await expect(page.getByTestId('slide-claims').locator('[data-ok="true"]').first()).toBeVisible();
    await expect(page.getByTestId('slide-decisions')).toContainText('ADR-0016');
    await expect(page.getByTestId('slide-decisions')).toContainText('Blocked');
    await page.getByText('Speaker notes, timing and rubric').click();
    await expect(page.getByTestId('slide-notes')).toContainText('Say plainly');

    await page.goto('/presentation/deck?slide=T07');
    await expect(page.getByTestId('slide-placeholders')).toContainText('PH-PERF');
    await expect(page.getByTestId('slide-placeholders')).toContainText('Needed from');
  });

  test('nothing can be edited without signing in, and exports are unavailable before a build', async ({ page }) => {
    await page.goto('/presentation/deck?slide=E04');
    await expect(page.getByTestId('deck-signin')).toBeVisible();
    for (const id of ['build-sample', 'build-final', 'approve', 'reject', 'regenerate', 'title-save']) await expect(page.getByTestId(id)).toBeDisabled();
    await expect(page.getByTestId('export-pptx')).toHaveAttribute('aria-disabled', 'true');
    const res = await page.request.post('/api/v1/deck/actions', { headers: { 'content-type': 'application/json', origin: 'http://localhost:3100' }, data: { action: 'approve', slideId: 'E04' } });
    expect(res.status()).toBe(401);
    expect((await page.request.get('/api/v1/deck/export/pptx')).status()).toBe(404);
  });

  test('filters and search work, keyboard moves through the list, and the URL keeps the selection', async ({ page }) => {
    await page.goto('/presentation/deck');
    await page.getByTestId('filter-tier').selectOption('appendix');
    const n = await page.getByTestId('slide-list').locator('li').count();
    expect(n).toBeGreaterThanOrEqual(10);
    await expect(page.getByTestId('slide-list').locator('li').first()).toContainText('A01');
    await page.getByTestId('filter-tier').selectOption('');
    await page.getByTestId('slide-search').fill('sovereign cells');
    await expect(page.getByTestId('slide-E07')).toBeVisible();
    await page.getByTestId('slide-search').fill('zzzz-no-such-slide');
    await expect(page.getByText('No slide matches')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByTestId('slide-E02').click();
    await expect(page).toHaveURL(/slide=E02/);
    await page.getByTestId('slide-E02').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('slide-detail')).toHaveAttribute('data-slide-id', 'E03');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('slide-detail')).toHaveAttribute('data-slide-id', 'E02');
  });

  test('every presentation criterion is mapped, and live-only ones say so', async ({ page }) => {
    await page.goto('/presentation/deck');
    const t = page.getByTestId('rubric-coverage');
    await expect(t).toContainText('B1');
    await expect(t).toContainText('B5');
    await expect(t).toContainText('not verified until a person rehearses');
  });

  test('the Presentation Studio page links to the builder', async ({ page }) => {
    await page.goto('/presentation');
    await page.getByTestId('open-deck-builder').click();
    await expect(page).toHaveURL(/\/presentation\/deck/);
  });

  test('an unreadable repository gives a recoverable error', async ({ page }) => {
    await page.goto('http://localhost:3101/presentation/deck');
    // The application shell reports an unreadable repository for every page, so the builder never starts.
    const alert = page.getByTestId('error-panel');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('The repository could not be read');
    await expect(page.getByTestId('slide-list')).toHaveCount(0);
  });

  test('loading shows a skeleton, and a failing API shows the failure and retries', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/v1/deck', async (route) => {
      calls += 1;
      if (calls === 1) return route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ status: 503, detail: 'The deck could not be prepared right now.' }) });
      return route.continue();
    });
    await page.goto('/presentation/deck');
    await expect(page.getByTestId('deck-error')).toContainText('could not be prepared right now');
    await page.getByTestId('deck-error').getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId('deck-studio')).toBeVisible();
  });

  test('no accessibility violations, and the layout holds at tablet width', async ({ page }) => {
    await page.goto('/presentation/deck?slide=E07');
    await expect(page.getByTestId('slide-detail')).toBeVisible();
    await expectNoAxeViolations(page, 'deck builder');
    await page.setViewportSize({ width: 820, height: 1100 });
    await expect(page.getByTestId('slide-list')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow, 'no horizontal scrolling at 820px').toBe(false);
    await shot(page, 'deck-builder-tablet');
  });
});

test.describe('deck builder: acting, with real roles', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  test('a viewer cannot edit or approve, and the server refuses even if the controls are bypassed', async ({ page }) => {
    await signInAs(page, USERS.outsider);
    await slide(page, 'E04');
    for (const id of ['approve', 'reject', 'title-save', 'build-sample']) await expect(page.getByTestId(id)).toBeDisabled();
    const csrf = (await (await page.request.get(`${WRITE}/api/v1/auth/session`)).json()).csrf as string;
    const rev = (await (await page.request.get(`${WRITE}/api/v1/deck`)).json()).model.revision as number;
    const res = await page.request.post(`${WRITE}/api/v1/deck/actions`, { headers: { 'content-type': 'application/json', origin: WRITE, 'x-studio-csrf': csrf }, data: { action: 'reset', slideId: 'E04', expectedRevision: rev } });
    expect(res.status()).toBe(403);
    expect((await page.request.post(`${WRITE}/api/v1/deck/build`, { headers: { 'content-type': 'application/json', origin: WRITE, 'x-studio-csrf': csrf }, data: { mode: 'sample' } })).status()).toBe(403);
  });

  test('a contributor can edit a title and choose a visual but cannot approve', async ({ page }) => {
    await signInAs(page, USERS.contrib);
    await slide(page, 'E04');
    await expect(page.getByTestId('approve')).toBeDisabled();
    await expect(page.getByTestId('cannot-approve')).toBeVisible();
    const title = page.getByTestId('title-input');
    await title.fill('Base case: real value, no three-year payback');
    await page.getByTestId('title-save').click();
    await expect(page.getByTestId('slide-E04')).toContainText('no three-year payback');
    await expect(page.getByTestId('slide-E04')).toContainText('edited');
    await page.getByRole('radio', { name: 'Table' }).click();
    await expect(page.getByRole('radio', { name: 'Table' })).toBeChecked();
    await expect(page.getByTestId('slide-history')).toBeHidden(); // closed until opened
    await page.getByText(/History \(\d+\)/).click();
    await expect(page.getByTestId('slide-history')).toBeVisible();
    await expect(page.getByTestId('slide-history')).toContainText('test-contrib');
    // regenerate takes the slide back to what the sources produce
    await page.getByTestId('regenerate').click();
    await expect(page.getByTestId('slide-E04')).not.toContainText('edited');
    await expect(page.getByTestId('title-input')).toHaveValue('Base case: real value, but no three-year payback');
  });

  test('an owner approves a slide, and the approval is bound to its content', async ({ page }) => {
    await signInAs(page, USERS.owner);
    await slide(page, 'E05');
    await page.getByTestId('approve').click();
    await expect(page.getByTestId('slide-E05')).toContainText('Approved');
    await expect(page.getByTestId('count-approved')).toContainText('1 approved');
    await expect(page.getByTestId('slide-review')).toContainText('Approved by test-owner');
    // changing the slide withdraws the approval; it is a draft again and the count drops
    await page.getByTestId('title-input').fill("Today's process fails where it can be assessed");
    await page.getByTestId('title-save').click();
    await expect(page.getByTestId('slide-E05')).toContainText('Draft');
    await expect(page.getByTestId('count-approved')).toContainText('0 approved');
    await page.getByTestId('approve').click();
    await expect(page.getByTestId('count-approved')).toContainText('1 approved');
    await page.getByTestId('reset').click();
    await expect(page.getByTestId('count-approved')).toContainText('0 approved');
  });

  test('rejecting needs a reason, and approving a slide with a placeholder needs an acknowledgement', async ({ page }) => {
    await signInAs(page, USERS.owner);
    await slide(page, 'E06');
    await page.getByTestId('reject').click();
    await expect(page.getByTestId('reject-confirm')).toBeDisabled();
    await page.getByTestId('review-reason').fill('The cost note needs the source');
    await page.getByTestId('reject-confirm').click();
    await expect(page.getByTestId('slide-review')).toContainText('Rejected by test-owner: The cost note needs the source');

    await slide(page, 'T07');
    await expect(page.getByTestId('slide-placeholders')).toBeVisible();
    await page.getByTestId('approve').click();
    await expect(page.getByTestId('deck-notice')).toContainText('written acknowledgement');
    await page.getByTestId('review-reason').fill('Present as a stated gap, not a result');
    await page.getByTestId('approve').click();
    await expect(page.getByTestId('slide-review')).toContainText('Approved by test-owner');
    await expect(page.getByTestId('slide-review')).toContainText('Present as a stated gap');
  });

  test('a stale or conflicting submission is refused, not silently applied', async ({ page }) => {
    await signInAs(page, USERS.owner);
    const csrf = (await (await page.request.get(`${WRITE}/api/v1/auth/session`)).json()).csrf as string;
    const view = await (await page.request.get(`${WRITE}/api/v1/deck`)).json();
    const post = (data: object) => page.request.post(`${WRITE}/api/v1/deck/actions`, { headers: { 'content-type': 'application/json', origin: WRITE, 'x-studio-csrf': csrf }, data });
    const s = view.model.slides.find((x: { id: string }) => x.id === 'E08');
    expect((await post({ action: 'approve', slideId: 'E08', contentHash: 'f'.repeat(64), expectedRevision: view.model.revision })).status(), 'stale content').toBe(409);
    expect((await post({ action: 'reset', slideId: 'E08', expectedRevision: view.model.revision - 1 })).status(), 'old revision').toBe(409);
    expect((await post({ action: 'approve', slideId: 'E08', contentHash: s.contentHash })).status(), 'no revision').toBe(400);
    expect((await post({ action: 'approve-all', slideId: 'E08', expectedRevision: view.model.revision })).status(), 'no bulk or unknown actions').toBe(400);
    expect((await post({ action: 'choose-visual', slideId: 'E08', visual: 'matrix', expectedRevision: view.model.revision })).status(), 'lossy visual').toBe(422);
    expect((await page.request.post(`${WRITE}/api/v1/deck/actions`, { headers: { 'content-type': 'application/json', origin: 'http://evil.example', 'x-studio-csrf': csrf }, data: { action: 'reset', slideId: 'E08', expectedRevision: view.model.revision } })).status(), 'cross-origin').toBe(403);
    expect((await page.request.post(`${WRITE}/api/v1/deck/actions`, { headers: { 'content-type': 'application/json', origin: WRITE }, data: { action: 'reset', slideId: 'E08', expectedRevision: view.model.revision } })).status(), 'missing CSRF token').toBe(403);
  });

  test('builds a sample deck, previews its slides, and exports it as PowerPoint and PDF', async ({ page }) => {
    await signInAs(page, USERS.owner);
    await slide(page, 'E07');
    await expect(page.getByTestId('preview-missing')).toContainText('No preview yet');
    await page.getByTestId('build-sample').click();
    await expect(page.getByTestId('deck-notice')).toContainText('Building the sample deck');
    await expect(page.getByTestId('latest-build')).toContainText('SAMPLE', { timeout: 120_000 });
    await expect(page.getByTestId('latest-build')).toContainText('rendered by PowerPoint');
    await expect(page.getByTestId('latest-build')).toContainText('A sample is not approved for presentation');
    await slide(page, 'E07');
    const img = page.getByTestId('slide-preview');
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 1000)).toBe(true);
    await shot(page, 'deck-builder-slide');

    for (const [kind, magic, type] of [['pptx', 'PK', 'presentationml'], ['pdf', '%PDF', 'pdf']] as const) {
      const res = await page.request.get(`${WRITE}/api/v1/deck/export/${kind}`);
      expect(res.status(), kind).toBe(200);
      expect(res.headers()['content-type']).toContain(type);
      expect(res.headers()['content-disposition']).toContain('SAMPLE');
      expect((await res.body()).subarray(0, magic.length).toString()).toBe(magic);
    }
    // a change after the build makes that slide's preview out of date, and it says so
    await page.getByTestId('title-input').fill('Recommend sovereign cells and bounded agents');
    await page.getByTestId('title-save').click();
    await expect(page.getByTestId('preview-missing')).toContainText('changed after the latest build');
  });

  test('a final deck is refused, with the reasons, and nothing is exported as final', async ({ page }) => {
    await signInAs(page, USERS.owner);
    await page.getByTestId('build-final').click();
    await expect(page.getByTestId('deck-notice')).toContainText('A final deck is refused', { timeout: 120_000 });
    await expect(page.getByTestId('deck-notice')).toContainText('architecture baseline');
    await expect(page.getByTestId('latest-build')).toContainText('SAMPLE');
    // a contributor may not even ask for a final deck
    await signInAs(page, USERS.contrib);
    await expect(page.getByTestId('build-final')).toBeDisabled();
  });
});
