import { expect, test, type Page } from '@playwright/test';

// Product polish checks (acceptance criteria UX-01 and UX-02): a quiet console on every page, and no raw Markdown markers in any decision.
const PAGES = ['/', '/decisions', '/queue', '/queue/blocking', '/approvals', '/architecture', '/baseline', '/access', '/presentation', '/presentation/deck', '/decisions/ADR-0016', '/decisions/ADR-0016/review', '/decisions/ADR-0016/compare'];

function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`console ${m.type()}: ${m.text().slice(0, 200)}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message.slice(0, 200)}`));
  return problems;
}

test.describe('polish', () => {
  test('no browser console errors or warnings, and no hydration errors, on any page', async ({ page }) => {
    const problems = watch(page);
    for (const p of PAGES) {
      await page.goto(p, { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      expect(problems, `console problems on ${p}`).toEqual([]);
    }
  });

  test('no decision shows raw Markdown markers, and no decision page fails to render', async ({ page, request }) => {
    test.setTimeout(240_000);
    const res = await request.get('/api/v1/decisions');
    const body = (await res.json()) as { decisions?: { id: string }[]; items?: { id: string }[] };
    const ids = (body.decisions ?? body.items ?? []).map((d) => d.id);
    expect(ids.length).toBeGreaterThan(40);
    const problems = watch(page);
    const raw: string[] = [];
    for (const id of ids) {
      await page.goto(`/decisions/${id}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1 }), `decision ${id}`).toBeVisible({ timeout: 20_000 });
      const text = await page.locator('main').innerText();
      if (/\*\*[^*\n]+\*\*/.test(text) || /(^|\s)`[^`\n]+`/.test(text)) raw.push(id);
    }
    expect(raw, 'decisions whose text still shows ** or ` markers').toEqual([]);
    expect(problems).toEqual([]);
  });
});
