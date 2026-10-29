import { expect, test } from '@playwright/test';
import { ROUTES, gitOut, ready } from './helpers.ts';

test.describe('read-only proof', () => {
  test('a full tour issues only GET requests (plus the cache-reset POST) and leaves the repository untouched', async ({ page }) => {
    const before = { head: gitOut('rev-parse', 'HEAD'), status: gitOut('status', '--porcelain'), refs: gitOut('for-each-ref'), branch: gitOut('branch', '--show-current') };
    const writes: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.origin !== 'http://localhost:3100') writes.push(`EXTERNAL ${r.method()} ${r.url()}`);
      else if (r.method() !== 'GET' && !(r.method() === 'POST' && (u.pathname === '/api/v1/refresh' || u.pathname === '/api/v1/register/sync'))) writes.push(`${r.method()} ${u.pathname}`);
    });
    for (const r of ROUTES) await ready(page, r.path);
    await ready(page, '/decisions?id=D-003');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search' }).fill('D-003');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Repository sync status/ }).click();
    await page.getByRole('button', { name: 'Re-read repository' }).click();
    await expect(page.getByText('Repository re-read.')).toBeVisible();
    expect(writes).toEqual([]);
    expect({ head: gitOut('rev-parse', 'HEAD'), status: gitOut('status', '--porcelain'), refs: gitOut('for-each-ref'), branch: gitOut('branch', '--show-current') }).toEqual(before);
  });

  test('there is no control that writes: no form, no submit, no editable record field', async ({ page }) => {
    for (const r of ROUTES) {
      await ready(page, r.path);
      expect(await page.locator('form, input[type=submit], button[type=submit], textarea, [contenteditable=true]').count(), r.path).toBe(0);
    }
  });

  test('no third-party request is made by any page (fonts, analytics, CDNs)', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => {
      if (!r.url().startsWith('http://localhost:3100') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url());
    });
    for (const r of ROUTES) await ready(page, r.path);
    expect(external).toEqual([]);
  });
});

test.describe('traceability to GitHub', () => {
  test('records link to a permalink only when a pushed commit holds the identical file', async ({ page, request }) => {
    const repo = (await (await request.get('/api/v1/repository')).json()) as { repo: { githubUrl: string } };
    await ready(page, '/decisions?q=D-003');
    const link = page.getByTestId('decision-row').first().getByRole('link', { name: /DECISION-REGISTER\.md:\d+ on GitHub/ });
    await expect(link).toBeVisible();
    const href = (await link.getAttribute('href')) ?? '';
    expect(href).toMatch(new RegExp(`^${repo.repo.githubUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/blob/[0-9a-f]{40}/docs/context/DECISION-REGISTER\\.md#L\\d+$`));
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
  });

  test('a file that exists only in an unpushed commit is labelled Local only, never linked', async ({ page }) => {
    // Expected state is computed independently with git: is an identical blob on any remote-tracking ref?
    const p = 'docs/architecture-studio/DECISION-INVENTORY.md';
    const local = gitOut('rev-parse', `HEAD:${p}`);
    const remotes = gitOut('for-each-ref', '--format=%(refname:short)', 'refs/remotes').split('\n').filter((r) => r && !r.endsWith('/HEAD'));
    const pushed = remotes.some((r) => gitOut('rev-parse', '--verify', '--quiet', `${r}:${p}`) === local);
    await ready(page, '/architecture?dq=DECISION-INVENTORY');
    const item = page.getByTestId('document-list').getByRole('listitem').first();
    await expect(item).toContainText(p);
    if (pushed) {
      await expect(item.locator('a[href*="github.com"]')).toHaveCount(1);
    } else {
      await expect(item.getByText('Local only')).toBeVisible();
      await expect(item.locator('a[href*="github.com"]')).toHaveCount(0);
    }
  });

  test('the sync popover says plainly that the commit is not on GitHub', async ({ page, request }) => {
    const repo = (await (await request.get('/api/v1/repository')).json()) as { repo: { commitOnGitHub: boolean } };
    await ready(page, '/');
    await page.getByRole('button', { name: /Repository sync status/ }).click();
    await expect(page.getByRole('dialog')).toContainText(repo.repo.commitOnGitHub ? 'this commit is on a remote branch' : 'exists only on this machine');
  });
});
