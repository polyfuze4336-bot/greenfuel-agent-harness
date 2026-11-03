import { expect, test } from '@playwright/test';
import { ROUTES, SECTION_PAGES, ready } from './helpers.ts';

test.describe('navigation', () => {
  test('every primary destination loads, is marked current, and has one h1', async ({ page }) => {
    await ready(page, '/');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link')).toHaveCount(4);
    for (const r of ROUTES) {
      await nav.getByRole('link', { name: new RegExp(`^${r.nav.replace('&', '\\&')}`) }).click();
      await expect(page).toHaveURL(new RegExp(`${r.path === '/' ? '/$' : r.path}`));
      await expect(page.getByRole('heading', { level: 1, name: r.heading })).toBeVisible();
      await expect(nav.locator('a[aria-current="page"]')).toHaveCount(1);
      await expect(nav.locator('a[aria-current="page"]')).toContainText(r.nav.split(' ')[0]!);
      await expect(page.locator('h1')).toHaveCount(1);
    }
  });

  test('pages inside a destination are reached from its section tabs and keep the destination current', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Primary' });
    for (const s of SECTION_PAGES) {
      await ready(page, s.path);
      await expect(page.getByRole('heading', { level: 1, name: s.heading })).toBeVisible();
      await expect(nav.locator('a[aria-current="page"]')).toHaveText(new RegExp(`^${s.nav}`));
      const tabs = page.getByRole('navigation', { name: 'Section' });
      await expect(tabs).toBeVisible();
      await expect(tabs.locator('a[aria-current="page"]')).toHaveText(s.tab);
    }
    await ready(page, '/decisions');
    await page.getByRole('navigation', { name: 'Section' }).getByRole('link', { name: 'Work queue' }).click();
    await expect(page).toHaveURL(/\/queue$/);
    await page.getByRole('navigation', { name: 'Section' }).getByRole('link', { name: 'Register' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Decisions' })).toBeVisible();
  });

  test('a single record shows no section tabs, and the home page has none', async ({ page }) => {
    await ready(page, '/decisions/ADR-0016');
    await expect(page.getByRole('navigation', { name: 'Section' })).toHaveCount(0);
    await ready(page, '/');
    await expect(page.getByRole('navigation', { name: 'Section' })).toHaveCount(0);
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
    await page.getByRole('button', { name: /^Proposed\b/ }).click();
    await expect(page).toHaveURL(/status=Proposed/);
    await page.goto('/queue');
    await page.goBack();
    await expect(page.getByRole('button', { name: /^Proposed\b/ })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('overview shows repository-derived figures only', () => {
  test('numbers equal the API model, which equals the independent discovery snapshot', async ({ page, request }) => {
    const api = (await (await request.get('/api/v1/repository')).json()) as { metrics: any; repo: { commitShort: string } };
    const snap = JSON.parse(await (await request.get('/api/v1/decisions?type=register')).text()) as { count: number };
    const o = (await (await request.get('/api/v1/overview')).json()) as { overview: { progress: { done: number; total: number }[]; readiness: { ready: boolean; blockingDecisions: unknown[] } } };
    await ready(page, '/');
    const m = api.metrics;
    // Progress is counts of records, and each count on the page is the API's.
    expect(await page.getByTestId('progress-count').allTextContents()).toEqual(o.overview.progress.map((p) => `${p.done} of ${p.total}`));
    if (!o.overview.readiness.ready) await expect(page.getByTestId('readiness-label')).toContainText(`${o.overview.readiness.blockingDecisions.length} mandatory decision`);
    expect(snap.count).toBe(m.decisions.register);
    await expect(page.getByTestId('freshness-commit')).toHaveText(api.repo.commitShort);
    // The independent discovery snapshot recorded these counts; the figures must agree.
    expect(m.decisions).toMatchObject({ total: 58, pending: 45, accepted: 13, rejected: 0, deferred: 0 });
  });

  test('each list links to the records behind it', async ({ page }) => {
    await ready(page, '/');
    await page.locator('#attention a[href^="/decisions?status="]').click();
    await expect(page).toHaveURL(/\/decisions\?status=Proposed,Pending(%20| )Review,Blocked/);
    await expect(page.getByTestId('result-count')).toContainText('45 of 58');
    await ready(page, '/');
    await page.locator('#tasks a[href^="/queue"]').click();
    await expect(page).toHaveURL(/\/queue\?view=pending/);
    await expect(page.getByTestId('queue-table')).toBeVisible();
  });

  test('blockers are listed with the rules behind their place and link to detail', async ({ page, request }) => {
    const o = (await (await request.get('/api/v1/overview')).json()) as { overview: { blockers: { count: number } } };
    await ready(page, '/');
    const section = page.locator('#blockers');
    await expect(page.getByTestId('blockers-count')).toHaveText(String(o.overview.blockers.count));
    await expect(section).toContainText('Enroll an architecture-class approver');
    await section.getByTestId('action-row').first().click();
    await expect(page.getByTestId('action-drawer')).toBeVisible();
    await expect(page.getByTestId('action-drawer').getByTestId('why-total')).toBeVisible();
  });
});

test.describe('Decision Register', () => {
  test('lists every decision, and filters, sorts and groups', async ({ page }) => {
    await ready(page, '/decisions');
    const rows = page.getByTestId('decision-row');
    await expect(rows).toHaveCount(58);

    await page.getByRole('button', { name: /^Proposed\b/ }).click();
    await expect(rows).toHaveCount(2);
    await page.getByRole('button', { name: /^Blocked\b/ }).click();
    await expect(rows).toHaveCount(8);
    await page.getByRole('button', { name: /^Pending Review\b/ }).click();
    await expect(rows).toHaveCount(45);
    await page.getByRole('button', { name: /^Pending Review\b/ }).click();
    await page.getByRole('button', { name: /^Blocked\b/ }).click();
    await page.getByRole('button', { name: /^Proposed\b/ }).click();
    await expect(rows).toHaveCount(58);

    await page.getByTestId('more-filters').click();
    await page.getByLabel('Type').selectOption('register-entry');
    await expect(rows).toHaveCount(37);
    await page.getByLabel('Needed by').selectOption('M1');
    await expect(rows).toHaveCount(17);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(rows).toHaveCount(58);

    await page.getByLabel('Group by').selectOption('status');
    await expect(page.locator('th[scope="colgroup"]')).toHaveCount(4);
    await expect(page.locator('th[scope="colgroup"]').first()).toContainText('Proposed');
    await page.getByLabel('Group by').selectOption('none');

    const statusSort = page.getByRole('columnheader', { name: 'Status' });
    await statusSort.getByRole('button').click();
    await expect(statusSort).toHaveAttribute('aria-sort', 'ascending');
    await expect(rows.first()).toContainText('Proposed');
    await statusSort.getByRole('button').click();
    await expect(statusSort).toHaveAttribute('aria-sort', 'descending');
    await expect(rows.first()).toContainText('Blocked');
  });

  test('search narrows results across id, title and text', async ({ page }) => {
    await ready(page, '/decisions');
    await page.getByRole('searchbox', { name: 'Search decisions' }).fill('D-003');
    await expect(page.getByTestId('decision-row')).toHaveCount(1);
    await expect(page).toHaveURL(/q=D-003/);
    await page.getByRole('searchbox', { name: 'Search decisions' }).fill('port');
    await expect.poll(() => page.getByTestId('decision-row').count()).toBeGreaterThan(1);
    expect(await page.getByTestId('decision-row').count()).toBeLessThan(58);
  });

  test('opens a record in a panel, with provenance, and closes with Escape returning focus', async ({ page }) => {
    await ready(page, '/decisions?q=D-003');
    const open = page.getByTestId('decision-row').first().locator('[data-row-btn]');
    await open.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/id=D-003/);
    await expect(dialog.getByTestId('decision-detail').getByRole('heading', { level: 2 })).toContainText('Ports and jurisdictions');
    await expect(dialog.getByText('Status, verbatim from the source')).toBeVisible();
    await expect(dialog.getByText('No approval is recorded for this decision.')).toBeVisible();
    await expect(dialog.getByText('Source in the repository')).toBeVisible();
    await expect(dialog.getByText('Change history of this file, newest first')).toBeVisible();
    await expect(dialog.locator('ol li').first()).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).not.toHaveURL(/id=/);
    await expect(open).toBeFocused();
  });

  test('a Proposed ADR is never presented as approved; a grandfathered ADR is labelled unsigned', async ({ page }) => {
    await ready(page, '/decisions?id=ADR-0016');
    const d = page.getByRole('dialog');
    await expect(d).toContainText('Blocked');
    await expect(d.getByText('Status, verbatim from the source')).toBeVisible();
    await expect(d.locator('blockquote')).toHaveText('Proposed');
    await expect(d).not.toContainText('Approved on the owner');
    await page.goto('/decisions?id=ADR-0001');
    await expect(page.getByRole('dialog')).toContainText(/unsigned/i);
    await expect(page.getByRole('dialog')).toContainText('No signed approval record exists');
  });

  test('keyboard: arrow keys move between rows and Enter opens one', async ({ page }) => {
    await ready(page, '/decisions');
    await page.waitForLoadState('networkidle'); // the row handlers are attached when the page hydrates
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
  test('shows every view with the same counts as the API, and each view applies its stated rule', async ({ page, request }) => {
    const q = (await (await request.get('/api/v1/queue')).json()) as { items: { id: string; class: string }[]; counts: Record<string, number>; views: { id: string }[] };
    await ready(page, '/queue');
    await expect(page.getByTestId('queue-table')).toBeVisible();
    for (const v of q.views) {
      if (v.id === 'mine') continue;
      await page.getByTestId(`view-${v.id}`).click();
      await expect(page.getByTestId(`count-${v.id}`)).toHaveText(String(q.counts[v.id]));
      await expect(page.getByTestId('result-count')).toContainText(`of ${q.counts[v.id]} in`);
      await expect(page.getByTestId('view-rule')).not.toBeEmpty();
    }
    await page.getByTestId('view-all').click();
    expect(q.counts.all! + q.counts.evidence!).toBe(q.items.length);
  });

  test('rubric evidence gaps are kept out of All tasks and shown in their own view', async ({ page, request }) => {
    const q = (await (await request.get('/api/v1/queue')).json()) as { items: { id: string; class: string }[] };
    const gap = q.items.find((i) => i.class === 'evidence-gap' && /^RC-/.test(i.id))!;
    await ready(page, '/queue?q=' + gap.id);
    await expect(page.getByText('No items match these filters')).toBeVisible();
    await page.goto(`/queue?view=evidence&q=${gap.id}`);
    await expect(page.getByTestId('queue-row')).toHaveCount(1);
  });

  test('the old blocked link still lands on the blocked view', async ({ page, request }) => {
    const q = (await (await request.get('/api/v1/queue')).json()) as { counts: Record<string, number> };
    await ready(page, '/queue?blocked=1');
    await expect(page.getByTestId('view-blocked')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('queue-row')).toHaveCount(q.counts.blocked!);
  });

  test('an item shows every requested field, with gaps stated rather than filled', async ({ page }) => {
    await ready(page, '/queue?id=T14');
    const d = page.getByTestId('item-detail');
    await expect(d).toBeVisible();
    for (const label of ['Status', 'Priority', 'Owner', 'Due date', 'Acceptance criteria', 'Evidence required', 'Completion evidence', 'Related decisions', 'Related requirements']) {
      await expect(d.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(d.getByText('Dependencies', { exact: true })).toBeVisible();
    await expect(d.getByText('GitHub reference')).toBeVisible();
    await expect(d.getByText('does not invent one')).toBeVisible();
    await expect(d.getByTestId('work-assign')).toBeVisible();
  });

  test('actions need a signed-in, registered person: signed out they explain why', async ({ page }) => {
    await ready(page, '/queue?id=T14');
    await expect(page.getByTestId('item-detail')).toBeVisible();
    const assign = page.getByTestId('work-assign');
    await expect(assign).toHaveAttribute('aria-disabled', 'true');
    await expect(assign).toHaveAttribute('title', /Sign in/);
  });

  test('My tasks asks you to sign in rather than guessing who you are', async ({ page }) => {
    await ready(page, '/queue?view=mine');
    await expect(page.getByText('Sign in to see your tasks')).toBeVisible();
  });

  test('search and filters narrow the list, the count follows, and clearing restores it', async ({ page }) => {
    await ready(page, '/queue');
    await expect(page.getByTestId('queue-table')).toBeVisible();
    const total = await page.getByTestId('queue-row').count();
    await page.getByRole('searchbox', { name: 'Search the queue' }).fill('branch protection');
    await expect.poll(async () => page.getByTestId('queue-row').count()).toBeLessThan(total);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByTestId('queue-row')).toHaveCount(total);
    await page.getByRole('button', { name: /^Blocks the build/ }).click();
    await expect(page).toHaveURL(/build=1/);
    await expect.poll(async () => page.getByTestId('queue-row').count()).toBeLessThan(total);
  });

  test('keyboard: arrow keys move between rows and Enter opens the item', async ({ page }) => {
    await ready(page, '/queue');
    const first = page.getByTestId('queue-row').first().locator('[data-row-btn]');
    await first.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('queue-row').nth(1).locator('[data-row-btn]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('item-detail')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('item-detail')).toBeHidden();
  });

  test('What is blocking the build? lists ready work, waiting work and the graph from the same analysis', async ({ page, request }) => {
    const q = (await (await request.get('/api/v1/queue')).json()) as { blocking: { analysis: { unresolvedCount: number; ready: unknown[] }; nodes: unknown[] } };
    await ready(page, '/queue/blocking');
    await expect(page.getByTestId('blocking-count')).toHaveText(String(q.blocking.analysis.unresolvedCount));
    await expect(page.getByTestId('ready-count')).toHaveText(String(q.blocking.analysis.ready.length));
    await expect(page.getByTestId('ready-item')).toHaveCount(q.blocking.analysis.ready.length);
    await expect(page.getByTestId('graph-node')).toHaveCount(q.blocking.nodes.length);
    await expect(page.getByText('HC-11').first()).toBeVisible();
    await page.getByTestId('ready-item').first().getByRole('button').first().click();
    await expect(page.getByTestId('item-detail')).toBeVisible();
  });

  test('a graph node opens its item from the keyboard', async ({ page }) => {
    await ready(page, '/queue/blocking');
    const node = page.getByTestId('graph-hit').first();
    await node.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('item-detail')).toBeVisible();
  });

  test('a requirement-change check explains an unreadable ref and a clean comparison', async ({ page }) => {
    await ready(page, '/queue/blocking');
    const box = page.getByTestId('requirement-check');
    await box.getByLabel('Compare against').fill('no-such-ref-xyz');
    await box.getByRole('button', { name: 'Find affected decisions' }).click();
    await expect(box.getByRole('alert')).toContainText('not a ref');
    await box.getByLabel('Compare against').fill('HEAD');
    await box.getByRole('button', { name: 'Find affected decisions' }).click();
    await expect(page.getByTestId('requirement-result')).toContainText('No requirement differs');
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
    await expect(pending).toHaveCount(11);
    await page.getByRole('button', { name: /^Design reviews/ }).click();
    await expect(pending).toHaveCount(3);
    await page.getByRole('button', { name: /^Design reviews/ }).click();
    await expect(pending).toHaveCount(11); // wait for the filter to clear before taking the first row
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
