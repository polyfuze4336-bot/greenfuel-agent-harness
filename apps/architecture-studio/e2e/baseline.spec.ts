import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, ready } from './helpers.ts';

// Build authorization page, against the real repository on the normal server (3100). The page only displays; there is nothing to write.
test.describe('build authorization', () => {
  test('shows the real measures and says why the application area is blocked', async ({ page }) => {
    await ready(page, '/baseline');
    await expect(page.getByTestId('baseline-view')).toBeVisible();
    await expect(page.getByTestId('verdict-state')).toHaveText('blocked');
    await expect(page.getByTestId('verdict')).toContainText('Blocked');

    const reasons = page.getByTestId('reasons').locator('li');
    expect(await reasons.count()).toBeGreaterThan(0);
    await expect(page.getByTestId('reasons')).toContainText(/phase is 0/i);

    // Every measure the request names is present, with a count taken from the repository.
    const measures = page.getByTestId('measures').locator('tbody tr');
    expect(await measures.count()).toBeGreaterThanOrEqual(10);
    for (const row of await measures.all()) expect(await row.getAttribute('data-count')).toMatch(/^\d+$/);

    // The commit the figures come from is shown, so a number can be traced.
    await expect(page.getByText(/at commit [0-9a-f]{7}/)).toBeVisible();
  });

  test('switching area changes the verdict, the gates and the required decisions', async ({ page }) => {
    await ready(page, '/baseline');
    const before = await page.getByTestId('gates').locator('tbody tr').count();
    await page.getByTestId('area-infrastructure').click();
    await expect(page.getByTestId('area-infrastructure')).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/area=infrastructure/);
    await expect(page.getByTestId('verdict')).toContainText('Infrastructure');
    await expect(page.getByTestId('required-decisions')).toBeVisible();
    expect(await page.getByTestId('gates').locator('tbody tr').count()).toBeGreaterThan(before);
    // The area survives a reload.
    await page.reload();
    await expect(page.getByTestId('area-infrastructure')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a blocking reason links to the record it names', async ({ page }) => {
    await ready(page, '/baseline?area=application');
    const link = page.getByTestId('reasons').getByRole('link', { name: /^ADR-\d{4}$/ }).first();
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toMatch(/^\/decisions\/ADR-\d{4}$/);
  });

  test('says plainly that the Studio does not authorize and CI cannot stop local edits', async ({ page }) => {
    await ready(page, '/baseline');
    const steps = page.getByTestId('authorize-steps');
    await expect(steps).toContainText('The Studio does not generate, authorize or reopen a baseline');
    await expect(steps).toContainText('cannot stop an edit on a local computer');
    await expect(page.getByTestId('no-baselines')).toContainText('No baseline exists');
    await expect(page.getByRole('button', { name: /^(approve|authorize|sign)/i })).toHaveCount(0);
  });

  test('keyboard: area buttons and measure details are reachable and operable', async ({ page }) => {
    await ready(page, '/baseline');
    const second = page.getByTestId('area-infrastructure');
    await second.focus();
    await page.keyboard.press('Enter');
    await expect(second).toHaveAttribute('aria-pressed', 'true');
    const summary = page.getByTestId('measures').locator('summary').first();
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('measures').locator('details').first()).toHaveAttribute('open', '');
  });

  test('the API answers read-only and refuses writes', async ({ request }) => {
    const ok = await request.get('/api/v1/baseline');
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(body.policy.valid).toBe(true);
    expect(body.readiness.areas.map((a: { id: string }) => a.id)).toEqual(['application', 'infrastructure', 'deployment']);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) expect((await request.fetch('/api/v1/baseline', { method })).status(), method).toBe(405);
  });

  test('links to it exist from the overview and the work queue', async ({ page }) => {
    await ready(page, '/');
    await expect(page.getByTestId('baseline-link')).toBeVisible();
    await ready(page, '/queue/blocking');
    await expect(page.getByTestId('baseline-link')).toBeVisible();
  });

  test('an unreadable repository gives a recoverable error, not an authorization', async ({ page }) => {
    await page.goto('http://localhost:3101/baseline');
    const alert = page.getByTestId('error-panel');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('The repository could not be read');
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByTestId('verdict')).toHaveCount(0);
  });

  test('when the readiness API fails the page shows the failure and retries, and never a verdict', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/v1/baseline', async (route) => {
      calls += 1;
      if (calls === 1) return route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Unavailable', status: 503, detail: 'The readiness computation failed.' }) });
      return route.continue();
    });
    await page.goto('/baseline');
    const alert = page.getByTestId('baseline-error');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('The readiness computation failed.');
    await expect(page.getByTestId('verdict')).toHaveCount(0);
    await alert.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId('verdict')).toBeVisible();
    expect(calls).toBe(2);
  });

  test('no accessibility violations', async ({ page }) => {
    await ready(page, '/baseline');
    await expect(page.getByTestId('baseline-view')).toBeVisible();
    await expectNoAxeViolations(page, 'baseline');
  });
});
