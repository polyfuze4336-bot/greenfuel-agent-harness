import { expect, test } from '@playwright/test';
import { ready } from './helpers.ts';

test.describe('global search', () => {
  test('opens with Ctrl+K and with /, navigates results by keyboard, and Escape closes', async ({ page }) => {
    await ready(page, '/');
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog');
    const box = dialog.getByRole('combobox', { name: 'Search' });
    await expect(box).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.keyboard.press('/');
    await expect(box).toBeFocused();
    await box.fill('residency');
    const options = dialog.getByRole('option');
    await expect(options.first()).toBeVisible();
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(box).toHaveAttribute('aria-activedescendant', /.+/);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('searching by id finds the record, Enter opens it', async ({ page }) => {
    await ready(page, '/');
    await page.getByRole('button', { name: /Search decisions, tasks, requirements/ }).click();
    await page.getByRole('combobox', { name: 'Search' }).fill('D-003');
    await expect(page.getByRole('option').first()).toContainText('D-003');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/decisions\?id=D-003/);
    await expect(page.getByTestId('decision-detail')).toContainText('D-003');
  });

  test('type filters work and an empty result is explained', async ({ page }) => {
    await ready(page, '/');
    await page.keyboard.press('Control+k');
    await page.getByRole('group', { name: 'Filter results by type' }).getByRole('button', { name: 'Tasks' }).click();
    await page.getByRole('combobox', { name: 'Search' }).fill('T14');
    await expect(page.getByRole('option').first()).toContainText('T14');
    await page.getByRole('combobox', { name: 'Search' }).fill('zzzz-no-such-record');
    await expect(page.getByText('No records match')).toBeVisible();
  });

  test('a failing search service shows an error and can be retried', async ({ page }) => {
    await ready(page, '/');
    let fail = true;
    await page.route('**/api/v1/search**', (route) => (fail ? route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Repository unavailable', detail: 'simulated outage' }) }) : route.continue()));
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search' }).fill('D-003');
    await expect(page.getByRole('alert')).toContainText('simulated outage');
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('option').first()).toContainText('D-003');
  });
});

test.describe('notifications', () => {
  test('are derived from the repository, can be marked read, and stay read after reload', async ({ page }) => {
    await ready(page, '/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const bell = page.getByRole('button', { name: /^Notifications, \d+ unread/ });
    const before = Number(/(\d+) unread/.exec((await bell.getAttribute('aria-label')) ?? '')?.[1]);
    expect(before).toBeGreaterThanOrEqual(6);
    await bell.click();
    const pop = page.getByRole('dialog');
    await expect(pop).toContainText('Derived from the repository');
    await expect(pop).toContainText('No approver is enrolled');
    await pop.getByRole('button', { name: 'Mark all as read' }).click();
    await expect(page.getByRole('button', { name: 'Notifications, 0 unread' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Notifications, 0 unread' })).toBeVisible();
  });

  test('selecting one navigates to its subject', async ({ page }) => {
    await ready(page, '/');
    const dialog = page.getByRole('dialog');
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await dialog.getByRole('link', { name: /design reviews are Blocked/ }).click();
    await expect(page).toHaveURL(/\/architecture#reviews/);
  });
});

test.describe('repository sync status', () => {
  test('shows the commit, GitHub state and re-reads without changing anything', async ({ page }) => {
    await ready(page, '/');
    await page.getByRole('button', { name: /Repository sync status/ }).click();
    const pop = page.getByRole('dialog');
    await expect(pop).toContainText('Repository, read-only');
    await expect(pop).toContainText('On GitHub');
    await expect(pop).toContainText('never fetches, pulls or writes');
    const [res] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/v1/refresh')), pop.getByRole('button', { name: 'Re-read repository' }).click()]);
    expect(res.status()).toBe(200);
    expect(res.request().method()).toBe('POST');
    await expect(pop.getByText('Repository re-read.')).toBeVisible();
  });
});

test.describe('identity menu', () => {
  test('is honest that it is a local git identity, and the theme choice applies and persists', async ({ page }) => {
    await ready(page, '/');
    await page.getByRole('button', { name: / account menu/ }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toContainText('Local git identity');
    await expect(menu).toContainText('not an authenticated user');
    await menu.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: / account menu/ }).click();
    await page.getByRole('menuitemradio', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('keyboard shortcuts dialog opens from the menu and closes with Escape', async ({ page }) => {
    await ready(page, '/');
    await page.getByRole('button', { name: / account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('links to the GitHub repository', async ({ page }) => {
    await ready(page, '/');
    await page.getByRole('button', { name: / account menu/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Open repository on GitHub' })).toHaveAttribute('href', /^https:\/\/github\.com\/[^/]+\/greenfuel-agent-harness$/);
  });
});
