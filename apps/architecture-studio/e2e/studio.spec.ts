import { expect, test } from '@playwright/test';
import { ROUTES, ready } from './helpers.ts';

test.describe('navigation', () => {
  test('every primary destination loads, is marked current, and has one h1', async ({ page }) => {
    await ready(page, '/');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link')).toHaveCount(6);
    for (const r of ROUTES) {
      await nav.getByRole('link', { name: new RegExp(`^${r.nav.replace('&', '\\&')}`) }).click();
      await expect(page).toHaveURL(new RegExp(`${r.path === '/' ? '/$' : r.path}`));
      await expect(page.getByRole('heading', { level: 1, name: r.heading })).toBeVisible();
      await expect(nav.locator('a[aria-current="page"]')).toHaveCount(1);
      await expect(nav.locator('a[aria-current="page"]')).toContainText(r.nav.split(' ')[0]!);
      await expect(page.locator('h1')).toHaveCount(1);
    }
  });

  test('skip link moves focus to main content', async ({ page }) => {
    await ready(page, '/decisions');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });

  test('browser back and forward restore filter state from the URL', async ({ page }) => {
    await ready(page, '/decisions');
    await page.getByRole('button', { name: /^Open\b/ }).click();
    await expect(page).toHaveURL(/status=open/);
    await page.goto('/queue');
    await page.goBack();
    await expect(page.getByRole('button', { name: /^Open\b/ })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('overview shows repository-derived figures only', () => {
  test('numbers equal the API model, which equals the independent discovery snapshot', async ({ page, request }) => {
    const api = (await (await request.get('/api/v1/repository')).json()) as { metrics: any; repo: { commitShort: string } };
    const snap = JSON.parse(await (await request.get('/api/v1/decisions?type=register')).text()) as { count: number };
    await ready(page, '/');
    const m = api.metrics;
    const expectations: [RegExp, string][] = [
      [/Total decisions/, String(m.decisions.total)],
      [/Pending decisions/, String(m.decisions.pending)],
      [/Accepted decisions/, String(m.decisions.accepted)],
      [/Rejected decisions/, String(m.decisions.rejected)],
      [/Deferred decisions/, String(m.decisions.deferred)],
      [/Blocked tasks/, String(m.tasks.blocked)],
      [/Outstanding approvals/, String(m.approvals.outstanding)],
    ];
    for (const [label, value] of expectations) {
      const card = page.getByRole('link', { name: label });
      await expect(card).toBeVisible();
      await expect(card.locator('span.tnum').first()).toHaveText(value);
    }
    await expect(page.getByRole('link', { name: /Architecture readiness/ }).locator('span.tnum').first()).toHaveText('Not ready');
    await expect(page.getByTestId('readiness-label')).toHaveText('Not ready for approval');
    expect(snap.count).toBe(m.decisions.register);
    await expect(page.getByText(api.repo.commitShort, { exact: false }).first()).toBeVisible();
    // The independent discovery snapshot recorded these counts; the figures must agree.
    expect(m.decisions).toMatchObject({ total: 57, pending: 44, accepted: 13, rejected: 0, deferred: 0 });
  });

  test('each key figure links to the records behind it', async ({ page, request }) => {
    const t = ((await (await request.get('/api/v1/repository')).json()) as { metrics: { tasks: { blocked: number; total: number } } }).metrics.tasks;
    await ready(page, '/');
    await page.getByRole('link', { name: /Pending decisions/ }).click();
    await expect(page).toHaveURL(/\/decisions\?status=open,proposed/);
    await expect(page.getByTestId('result-count')).toContainText('44 of 57');
    await page.goto('/');
    await page.getByRole('link', { name: /Blocked tasks/ }).click();
    await expect(page.getByTestId('result-count')).toContainText(`${t.blocked} of ${t.total}`);
  });

  test('blockers are listed with their basis and link to detail', async ({ page }) => {
    await ready(page, '/');
    const section = page.locator('#blockers');
    await expect(section.getByRole('listitem')).toHaveCount(6);
    await expect(section).toContainText('No approver is enrolled');
    await expect(section).toContainText('Basis:');
  });
});

test.describe('Decision Register', () => {
  test('lists every decision, and filters, sorts and groups', async ({ page }) => {
    await ready(page, '/decisions');
    const rows = page.getByTestId('decision-row');
    await expect(rows).toHaveCount(57);

    await page.getByRole('button', { name: /^Proposed\b/ }).click();
    await expect(rows).toHaveCount(7);
    await page.getByRole('button', { name: /^Open\b/ }).click();
    await expect(rows).toHaveCount(44);
    await page.getByRole('button', { name: /^Open\b/ }).click();
    await page.getByRole('button', { name: /^Proposed\b/ }).click();
    await expect(rows).toHaveCount(57);

    await page.getByLabel('Type').selectOption('register');
    await expect(rows).toHaveCount(37);
    await page.getByLabel('Needed by').selectOption('M1');
    await expect(rows).toHaveCount(17);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(rows).toHaveCount(57);

    await page.getByLabel('Group by').selectOption('status');
    await expect(page.locator('th[scope="colgroup"]')).toHaveCount(3);
    await expect(page.locator('th[scope="colgroup"]').first()).toContainText('Open');
    await page.getByLabel('Group by').selectOption('none');

    const statusSort = page.getByRole('columnheader', { name: 'Status' });
    await statusSort.getByRole('button').click();
    await expect(statusSort).toHaveAttribute('aria-sort', 'ascending');
    await expect(rows.first()).toContainText('Open');
    await statusSort.getByRole('button').click();
    await expect(statusSort).toHaveAttribute('aria-sort', 'descending');
    await expect(rows.first()).toContainText('Accepted');
  });

  test('search narrows results across id, title and text', async ({ page }) => {
    await ready(page, '/decisions');
    await page.getByRole('searchbox', { name: 'Search decisions' }).fill('D-003');
    await expect(page.getByTestId('decision-row')).toHaveCount(1);
    await expect(page).toHaveURL(/q=D-003/);
    await page.getByRole('searchbox', { name: 'Search decisions' }).fill('port');
    await expect.poll(() => page.getByTestId('decision-row').count()).toBeGreaterThan(1);
    expect(await page.getByTestId('decision-row').count()).toBeLessThan(57);
  });

  test('opens a record in a panel, with provenance, and closes with Escape returning focus', async ({ page }) => {
    await ready(page, '/decisions?q=D-003');
    const open = page.getByTestId('decision-row').first().locator('[data-row-btn]');
    await open.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/id=D-003/);
    await expect(dialog.getByTestId('decision-detail').getByRole('heading', { level: 2 })).toContainText('Ports and jurisdictions');
    await expect(dialog.getByText('Status line, verbatim')).toBeVisible();
    await expect(dialog.getByText('No signed approval record exists')).toBeVisible();
    await expect(dialog.getByText('docs/context/DECISION-REGISTER.md')).toBeVisible();
    await expect(dialog.getByText('Recent commits touching this file')).toBeVisible();
    await expect(dialog.locator('ol li').first()).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).not.toHaveURL(/id=/);
    await expect(open).toBeFocused();
  });

  test('a Proposed ADR is never presented as approved; a grandfathered ADR is labelled unsigned', async ({ page }) => {
    await ready(page, '/decisions?id=ADR-0016');
    const d = page.getByRole('dialog');
    await expect(d).toContainText('Proposed');
    await expect(d).not.toContainText('Accepted by the owner');
    await page.goto('/decisions?id=ADR-0001');
    await expect(page.getByRole('dialog')).toContainText('unsigned');
    await expect(page.getByRole('dialog')).toContainText('No signed approval record exists');
  });

  test('keyboard: arrow keys move between rows and Enter opens one', async ({ page }) => {
    await ready(page, '/decisions');
    const btns = page.locator('[data-row-btn]');
    await btns.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(btns.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(btns.nth(2)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(btns.nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('the full-page record route works and unknown ids say so', async ({ page }) => {
    await ready(page, '/decisions/D-010');
    await expect(page.getByTestId('decision-detail')).toContainText('D-010');
    await page.goto('/decisions/D-999');
    await expect(page.getByText('That record is not at this commit')).toBeVisible();
  });
});

test.describe('Work Queue', () => {
  test('filters to blocked tasks and shows why', async ({ page, request }) => {
    const t = ((await (await request.get('/api/v1/repository')).json()) as { metrics: { tasks: { blocked: number; total: number } } }).metrics.tasks;
    await ready(page, '/queue');
    await expect(page.getByTestId('queue-row')).toHaveCount(t.total);
    await page.getByRole('button', { name: /^Blocked only/ }).click();
    await expect(page.getByTestId('queue-row')).toHaveCount(t.blocked);
    await page.getByTestId('queue-row').first().locator('[data-row-btn]').click();
    const d = page.getByRole('dialog');
    await expect(d.getByText('Why it is shown as blocked')).toBeVisible();
    await expect(d.getByText('Rule: the task is not closed')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByLabel('Source').selectOption('roadmap');
    await expect(page.getByTestId('result-count')).toContainText(`0 of ${t.total}`);
    await expect(page.getByText('No tasks match these filters')).toBeVisible();
  });

  test('roadmap items do not invent a status', async ({ page }) => {
    await ready(page, '/queue?family=roadmap');
    const rows = page.getByTestId('queue-row');
    await expect(rows).toHaveCount(18);
    await expect(rows.first()).toContainText('No status recorded');
  });
});

test.describe('Approvals', () => {
  test('states plainly that no approval can exist, and offers a request command without signing', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await ready(page, '/approvals');
    await expect(page.getByTestId('authority-enrolled')).toHaveText('0');
    await expect(page.getByTestId('authority-signed')).toHaveText('0');
    await expect(page.getByText('No approver is enrolled, so no signed approval of any class can exist.')).toBeVisible();
    const pending = page.getByTestId('pending-list').locator('> li');
    await expect(pending).toHaveCount(10);
    await page.getByRole('button', { name: /^Design reviews/ }).click();
    await expect(pending).toHaveCount(3);
    await page.getByRole('button', { name: /^Design reviews/ }).click();
    await page.getByRole('button', { name: /Copy request command/ }).first().click();
    await expect(page.getByText('Copied').first()).toBeVisible();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toMatch(/^node harness\/scripts\/approval\.mjs decision --type adr --id 0004 /);
    await expect(page.getByTestId('grandfathered-table').locator('tbody tr')).toHaveCount(13);
  });
});

test.describe('Architecture & Evidence', () => {
  test('reviews show declared and computed state, requirements open in a panel', async ({ page }) => {
    await ready(page, '/architecture');
    const reviews = page.getByTestId('review-list');
    await expect(reviews.getByText('Declared Blocked')).toHaveCount(3);
    await expect(reviews.getByText('Gate result: Blocked')).toHaveCount(3);
    await page.getByRole('searchbox', { name: 'Search requirements' }).fill('FR-001');
    await page.getByTestId('requirements-table').locator('tbody tr', { hasText: /^FR-001/ }).locator('[data-row-btn]').click();
    const d = page.getByRole('dialog');
    await expect(d.getByTestId('requirement-detail')).toContainText('FR-001');
    await expect(d.getByText('Acceptance criteria')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('risks, assumptions, evidence and documents filter', async ({ page }) => {
    await ready(page, '/architecture');
    await expect(page.getByTestId('risk-list').locator('> li')).toHaveCount(14);
    await page.getByRole('searchbox', { name: 'Search risks' }).fill('RK-001');
    await expect(page.getByTestId('risk-list').locator('> li')).toHaveCount(1);
    await expect(page.getByTestId('assumption-list').locator('> li')).toHaveCount(26);
    await page.getByRole('button', { name: /^Non-zero exit only/ }).click();
    await expect(page.getByTestId('evidence-table').locator('tbody tr')).toHaveCount(15);
    await page.getByRole('searchbox', { name: 'Search documents' }).fill('no-such-document-zzzz');
    await expect(page.getByText('No documents match')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search documents' }).fill('DECISION-INVENTORY');
    await expect(page.getByTestId('document-list').getByRole('listitem').first()).toContainText('docs/architecture-studio/DECISION-INVENTORY.md');
  });
});

test.describe('Presentation Studio', () => {
  test('does not claim any rehearsal, labels recordings as recordings', async ({ page }) => {
    await ready(page, '/presentation');
    await expect(page.getByText('0 of 10 criteria rehearsed')).toBeVisible();
    await expect(page.getByTestId('rehearsal-list').getByText('Not rehearsed')).toHaveCount(10);
    await expect(page.getByTestId('recording-list').getByText('Recorded, not live')).toHaveCount(9);
    await expect(page.getByTestId('slide-list').getByRole('listitem')).toHaveCount(28);
    await page.getByLabel('Part').selectOption('T');
    await expect(page.getByTestId('slide-list').getByRole('listitem').first()).toContainText('T');
    await page.getByRole('searchbox', { name: 'Search panel questions' }).fill('blockchain');
    await expect(page.getByTestId('qa-list').getByRole('listitem')).toHaveCount(1);
    await page.getByTestId('qa-list').locator('summary').click();
    await expect(page.getByText('Uncertain:')).toBeVisible();
  });
});
