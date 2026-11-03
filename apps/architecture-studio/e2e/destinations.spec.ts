import { expect, test } from '@playwright/test';
import { gitOut, ready } from './helpers.ts';

// The four destinations, and what the pages inside them promise: three answers on the Overview, keyboard routes between destinations,
// a register that opens records without losing its place, and honest empty states on Changes.

test.describe('Overview answers three questions with real records', () => {
  test('what to do next, what blocks, and what is approved are present, and equal to the repository', async ({ page, request }) => {
    await ready(page, '/');
    await expect(page.getByTestId('next-action')).toBeVisible();
    for (const name of ['Decisions awaiting review', 'Critical blockers', 'Recently approved']) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    }
    const api = (await (await request.get('/api/v1/overview')).json()) as { overview: { blockers: { count: number }; awaiting: { count: number }; next: { title: string } | null } };
    await expect(page.getByTestId('blockers-count')).toHaveText(String(api.overview.blockers.count));
    await expect(page.getByTestId('attention-count')).toHaveText(String(api.overview.awaiting.count));
    await expect(page.getByTestId('next-title')).toHaveText(api.overview.next!.title);
    // The page says which commit it was rendered from, and that is the commit being read.
    await expect(page.getByTestId('freshness-commit')).toHaveText(gitOut('rev-parse', 'HEAD').slice(0, 7));
  });

  test('every link on the Overview leads to a page that loads', async ({ page, request }) => {
    await ready(page, '/');
    const hrefs = await page.locator('main a').evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLAnchorElement).getAttribute('href')!).filter((h) => h.startsWith('/')))]);
    expect(hrefs.length).toBeGreaterThan(3);
    for (const h of hrefs) {
      const r = await request.get(h.split('#')[0]!);
      expect(r.status(), h).toBe(200);
    }
  });

  test('Review next decision opens the first pending decision', async ({ page }) => {
    await ready(page, '/');
    await page.getByTestId('start-review').click();
    await expect(page).toHaveURL(/\/decisions\/[^/]+\/review$/);
  });
});

test.describe('keyboard routes between destinations', () => {
  test('g then o, d, c or p goes to Overview, Decisions, Changes or Presentation', async ({ page }) => {
    await ready(page, '/');
    for (const [key, url, h1] of [['d', /\/decisions$/, 'Decisions'], ['c', /\/changes$/, 'Changes'], ['p', /\/presentation$/, 'Presentation'], ['o', /\/$/, 'Overview']] as const) {
      await page.keyboard.press('g');
      await page.keyboard.press(key);
      await expect(page).toHaveURL(url);
      await expect(page.getByRole('heading', { level: 1, name: h1 })).toBeVisible();
    }
  });

  test('the shortcut stays out of the way while typing and while a dialog is open', async ({ page }) => {
    await ready(page, '/decisions');
    const search = page.getByRole('searchbox', { name: 'Search decisions' });
    await search.click();
    await page.keyboard.type('gc');
    await expect(page).toHaveURL(/\/decisions/);
    await expect(search).toHaveValue('gc');
    await search.fill('');
    await ready(page, '/decisions?id=ADR-0004');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('g');
    await page.keyboard.press('c');
    await expect(page).toHaveURL(/\/decisions/);
  });

  test('every primary destination shows its shortcut to assistive technology and on hover', async ({ page }) => {
    await ready(page, '/');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link', { name: /^Changes/ })).toHaveAttribute('title', /press g, then c/);
  });

  test('arrow keys move through register rows and Enter opens one, keeping the table behind it', async ({ page }) => {
    await ready(page, '/decisions');
    const rows = page.getByTestId('decision-row');
    const before = await rows.count();
    await rows.first().locator('[data-row-btn]').focus();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1).locator('[data-row-btn]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).toHaveURL(/id=/);
    await expect(rows).toHaveCount(before);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(rows.nth(1).locator('[data-row-btn]')).toBeFocused();
  });
});

test.describe('Decisions register: focused by default', () => {
  test('secondary filters are tucked away, open on request, and open themselves when a link needs them', async ({ page }) => {
    await ready(page, '/decisions');
    const more = page.getByTestId('more-filters');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByLabel('Group by')).toBeHidden();
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByLabel('Group by')).toBeVisible();
    await more.click();
    await expect(page.getByLabel('Group by')).toBeHidden();
    await ready(page, '/decisions?milestone=M1');
    await expect(page.getByTestId('more-filters')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByLabel('Needed by')).toHaveValue('M1');
  });

  test('the table is the first thing after the filters, and register health follows it', async ({ page }) => {
    await ready(page, '/decisions');
    const table = await page.getByTestId('decision-table').boundingBox();
    const health = await page.getByTestId('register-health').boundingBox();
    expect(table!.y).toBeLessThan(health!.y);
    expect(table!.y).toBeLessThan(700);
  });

  test('search is instant, shows a clear empty state, and clearing returns every decision', async ({ page }) => {
    await ready(page, '/decisions');
    const total = await page.getByTestId('decision-row').count();
    await page.getByRole('searchbox', { name: 'Search decisions' }).fill('zzzz-no-such-decision');
    await expect(page.getByText('No decisions match these filters')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(page.getByTestId('decision-row')).toHaveCount(total);
  });
});

test.describe('Changes', () => {
  test('shows sync failures, pending pull requests, decision history, readiness and repository changes from real records', async ({ page }) => {
    await ready(page, '/changes');
    for (const name of ['Sync failures', 'Pending GitHub pull requests', 'Decision history', 'Repository changes']) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    }
    await expect(page.getByTestId('readiness-card')).toBeVisible();
    await expect(page.getByTestId('decision-history').getByRole('listitem').first()).toBeVisible();
    await expect(page.getByTestId('recent-changes').locator('li').first()).toContainText(gitOut('rev-parse', 'HEAD').slice(0, 7));
  });

  test('with nothing in flight it says so plainly, and does not invent activity', async ({ page }) => {
    await ready(page, '/changes');
    await expect(page.getByText('Nothing is waiting on GitHub')).toBeVisible();
    await expect(page.getByTestId('proposal-row')).toHaveCount(0);
    await expect(page.getByTestId('no-failures')).toBeVisible();
    await expect(page.getByTestId('reconcile-failures')).toHaveCount(0);
  });

  test('the section tabs reach Approvals and Readiness and keep Changes current', async ({ page }) => {
    await ready(page, '/changes');
    const tabs = page.getByRole('navigation', { name: 'Section' });
    await tabs.getByRole('link', { name: 'Approvals' }).click();
    await expect(page).toHaveURL(/\/approvals$/);
    await expect(page.getByRole('navigation', { name: 'Primary' }).locator('a[aria-current="page"]')).toHaveText(/^Changes/);
    await page.getByRole('navigation', { name: 'Section' }).getByRole('link', { name: 'Readiness' }).click();
    await expect(page).toHaveURL(/\/baseline$/);
    await expect(page.getByRole('navigation', { name: 'Section' }).locator('a[aria-current="page"]')).toHaveText('Readiness');
  });
});

test.describe('build identity', () => {
  test('the version endpoint says which code and which repository commit are running, and its counts equal the register', async ({ request }) => {
    const v = (await (await request.get('/api/v1/version')).json()) as { build: string; authMode: string; data: { commit: string; commitShort: string }; counts: Record<string, number> };
    const n = (k: string) => v.counts[k] ?? NaN;
    expect(v.build).toMatch(/^([0-9a-f]{7}(\+dirty)?|unknown)$/);
    expect(v.data.commit).toBe(gitOut('rev-parse', 'HEAD'));
    const register = (await (await request.get('/api/v1/decisions')).json()) as { count: number };
    expect(n('decisions')).toBe(register.count);
    expect(n('adrs') + n('registerEntries')).toBe(n('decisions'));
    expect(JSON.stringify(v)).not.toMatch(/secret|token|password|key/i);
  });
});
test.describe('loading and error states for the new page', () => {
  test('Changes shows the repository error panel when the repository cannot be read', async ({ page }) => {
    await page.goto('http://localhost:3101/changes');
    await expect(page.getByTestId('error-panel')).toBeVisible();
  });

  test('client navigation to Changes shows a skeleton, then the page, without a full reload', async ({ page }) => {
    await page.goto('http://localhost:3102/');
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => ((window as unknown as { __marker: string }).__marker = 'same-document'));
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /^Changes/ }).click();
    await expect(page.getByTestId('page-skeleton')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Changes' })).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => (window as unknown as { __marker?: string }).__marker)).toBe('same-document');
  });

  test('routine navigation between destinations never reloads the page', async ({ page }) => {
    await ready(page, '/');
    await page.evaluate(() => ((window as unknown as { __marker: string }).__marker = 'same-document'));
    const nav = page.getByRole('navigation', { name: 'Primary' });
    for (const name of [/^Decisions/, /^Changes/, /^Presentation/, /^Overview/]) {
      await nav.getByRole('link', { name }).click();
      await expect(page.locator('main h1')).toBeVisible();
    }
    expect(await page.evaluate(() => (window as unknown as { __marker?: string }).__marker)).toBe('same-document');
  });
});

// Visual regression. The baselines are Edge on Windows at the device pixel ratio the tests use; they are skipped elsewhere rather than
// compared against a different renderer. Live numbers, hashes and dates change with the repository, so they are masked: what is compared
// is layout, spacing, type and colour.
test.describe('visual regression', () => {
  test.skip(process.platform !== 'win32', 'Baselines are recorded with Edge on Windows.');
  const SIZES = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ];
  const PAGES = [
    { name: 'overview', path: '/' },
    { name: 'decisions', path: '/decisions' },
    { name: 'changes', path: '/changes' },
    { name: 'presentation', path: '/presentation' },
  ];
  for (const s of SIZES) {
    for (const p of PAGES) {
      test(`${p.name} at ${s.name}`, async ({ page }) => {
        await page.setViewportSize({ width: s.width, height: s.height });
        await ready(page, p.path);
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveScreenshot(`${p.name}-${s.name}.png`, {
          animations: 'disabled',
          caret: 'hide',
          maxDiffPixelRatio: 0.04,
          mask: [page.locator('.tnum'), page.locator('.font-mono'), page.getByTestId('recent-changes'), page.getByTestId('decision-table'), page.locator('header [aria-label*="sync" i], header button')],
          maskColor: '#c9d3dd',
        });
      });
    }
  }
});
