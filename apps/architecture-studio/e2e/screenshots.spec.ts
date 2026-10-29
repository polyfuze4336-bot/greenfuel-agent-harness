import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { repoRoot, ready } from './helpers.ts';

// Produces the evidence screenshots. They are real captures of the running application reading this repository.
const dir = path.join(repoRoot, 'docs', 'architecture-studio', 'screenshots');
const shot = async (page: Page, name: string, fullPage = false) => {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage, animations: 'disabled' });
};

test.describe.configure({ mode: 'serial' });

test('desktop 1440: the six destinations', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page, '/');
  await shot(page, '01-overview', true);
  await ready(page, '/decisions');
  await shot(page, '02-decision-register');
  await page.getByLabel('Group by').selectOption('status');
  await shot(page, '03-decision-register-grouped');
  await ready(page, '/decisions?id=ADR-0016');
  await expect(page.getByRole('dialog').locator('ol li').first()).toBeVisible({ timeout: 10_000 });
  await shot(page, '04-decision-detail-proposed-adr');
  await ready(page, '/decisions?id=ADR-0001');
  await expect(page.getByRole('dialog').locator('ol li').first()).toBeVisible({ timeout: 10_000 });
  await shot(page, '05-decision-detail-unsigned-accepted');
  await ready(page, '/queue?blocked=1');
  await shot(page, '06-work-queue-blocked');
  await ready(page, '/queue?id=T14');
  await shot(page, '07-work-queue-detail');
  await ready(page, '/approvals');
  await shot(page, '08-approvals', true);
  await ready(page, '/architecture');
  await shot(page, '09-architecture-reviews');
  await ready(page, '/architecture?rq=NFR-001#requirements');
  await page.getByTestId('requirements-table').locator('[data-row-btn]').first().click();
  await shot(page, '10-requirement-detail');
  await ready(page, '/presentation');
  await shot(page, '11-presentation-studio', true);
});

test('desktop 1440: shell controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page, '/');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search' }).fill('residency');
  await expect(page.getByRole('option').first()).toBeVisible();
  await shot(page, '12-global-search');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await shot(page, '13-notifications');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Repository sync status/ }).click();
  await shot(page, '14-sync-status');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: / account menu/ }).click();
  await shot(page, '15-identity-menu');
  await page.keyboard.press('Escape');
});

test('states: empty, error, loading, dark', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page, '/decisions?q=zzzz-no-such-decision');
  await shot(page, '16-empty-state');
  await page.goto('http://localhost:3101/');
  await expect(page.getByTestId('error-panel')).toBeVisible();
  await shot(page, '17-error-state');
  await page.goto('http://localhost:3102/');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /^Decision Register/ }).click();
  await expect(page.getByTestId('page-skeleton')).toBeVisible();
  await shot(page, '18-loading-skeleton');
  await page.addInitScript(() => localStorage.setItem('studio:theme', 'dark'));
  await ready(page, '/decisions');
  await shot(page, '19-dark-theme');
});

test('tablet: landscape 1024, portrait 820, and the navigation sheet', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await ready(page, '/');
  await shot(page, '20-tablet-landscape-overview');
  await ready(page, '/decisions');
  await shot(page, '21-tablet-landscape-register');
  await page.setViewportSize({ width: 820, height: 1180 });
  await ready(page, '/decisions');
  await shot(page, '22-tablet-portrait-register');
  await page.locator('[data-row-btn]').first().click();
  await shot(page, '23-tablet-portrait-detail');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await shot(page, '24-tablet-portrait-navigation');
});

test('decision intelligence: register health, provenance, compare, source preview, sync', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page, '/decisions');
  const health = page.getByTestId('register-health');
  await health.getByText('How complete is the register?').click();
  await health.getByText(/Duplicate and overlap candidates/).click();
  await shot(page, '25-register-health', true);
  await ready(page, '/decisions?id=ADR-0004');
  await page.getByRole('dialog').getByText(/Field provenance/).click();
  await shot(page, '26-adr-0004-detail-provenance');
  await ready(page, '/decisions/ADR-0004/compare');
  await expect(page.getByTestId('compare-table')).toBeVisible();
  await shot(page, '27-compare-alternatives-adr-0004', true);
  await ready(page, '/decisions/D-010/compare');
  await expect(page.getByTestId('compare-table')).toBeVisible();
  await shot(page, '28-compare-alternatives-d-010-ai-suggestions', true);
  await ready(page, '/decisions?id=D-013');
  await page.getByRole('button', { name: 'Preview source' }).click();
  await expect(page.locator('tr[data-highlight="true"]')).toHaveCount(1);
  await shot(page, '29-source-preview');
  await page.keyboard.press('Escape');
  await ready(page, '/decisions');
  const h2 = page.getByTestId('register-health');
  await h2.getByText('Repository changes and synchronisation').click();
  await h2.getByRole('button', { name: 'Sync now' }).click();
  await h2.getByRole('button', { name: 'Sync now' }).click();
  await expect(h2.getByTestId('changes-result')).toContainText('57 unchanged');
  await h2.getByLabel('Compare with').selectOption('origin/main');
  await h2.getByRole('button', { name: 'Show changes' }).click();
  await expect(h2.getByTestId('changes-result')).toContainText(/\d+ added/);
  await page.waitForTimeout(350);
  await h2.screenshot({ path: path.join(dir, '30-sync-and-changes.png'), animations: 'disabled' });
});
