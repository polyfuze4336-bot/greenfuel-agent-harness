import { expect, test } from '@playwright/test';

test.describe('error handling', () => {
  test('an unreadable repository shows a clear, recoverable error instead of a blank page', async ({ page }) => {
    await page.goto('http://localhost:3101/decisions');
    const alert = page.getByTestId('error-panel');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('The repository could not be read');
    await expect(alert).toContainText('does not resolve to a commit');
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByText('STUDIO_REPO_ROOT')).toBeVisible();
  });

  test('the API answers failures as problem+json with a stable shape', async ({ request }) => {
    const res = await request.get('http://localhost:3101/api/v1/repository');
    expect(res.status()).toBe(503);
    expect(res.headers()['content-type']).toContain('application/problem+json');
    const body = await res.json();
    expect(body).toMatchObject({ title: 'Repository unavailable', status: 503, code: 'REF_NOT_FOUND' });
    expect(JSON.stringify(body)).not.toMatch(/[A-Z]:\\/);
  });

  test('bad input is rejected: path traversal, unknown kinds, long queries, unknown ids', async ({ request }) => {
    expect((await request.get('/api/v1/history?path=../../etc/passwd')).status()).toBe(400);
    expect((await request.get('/api/v1/history?path=%2Fetc%2Fpasswd')).status()).toBe(400);
    expect((await request.get('/api/v1/history?path=docs/nope.md')).status()).toBe(404);
    expect((await request.get('/api/v1/search?q=x&kind=bogus')).status()).toBe(400);
    expect((await request.get(`/api/v1/search?q=${'a'.repeat(200)}`)).status()).toBe(400);
    expect((await request.get('/api/v1/decisions/D-999')).status()).toBe(404);
  });

  test('the API is read-only: write methods are not accepted', async ({ request }) => {
    for (const path of ['/api/v1/decisions', '/api/v1/tasks', '/api/v1/approvals', '/api/v1/search', '/api/v1/repository', '/api/v1/register', '/api/v1/register/changes', '/api/v1/source']) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
        const res = await request.fetch(path, { method });
        expect(res.status(), `${method} ${path}`).toBe(405);
      }
    }
  });

  test('a failing file-history call is reported inside the panel and can be retried', async ({ page }) => {
    let fail = true;
    await page.route('**/api/v1/history**', (route) => (fail ? route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ detail: 'simulated git failure' }) }) : route.continue()));
    await page.goto('/decisions?id=D-001');
    const d = page.getByRole('dialog');
    await expect(d.getByRole('alert')).toContainText('simulated git failure');
    fail = false;
    await d.getByRole('button', { name: 'Retry' }).click();
    await expect(d.locator('ol li').first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('local-only hardening', () => {
  test('requests with a foreign Host header are refused (DNS-rebinding defence)', async ({ request }) => {
    for (const path of ['/', '/api/v1/decisions', '/api/v1/repository']) {
      const res = await request.get(`http://localhost:3100${path}`, { headers: { Host: 'evil.example.com' } });
      expect(res.status(), path).toBe(403);
      expect(await res.text()).not.toContain('ADR-');
    }
  });

  test('responses carry a strict CSP and hardening headers, and expose no framework banner', async ({ request }) => {
    const res = await request.get('/');
    const h = res.headers();
    expect(h['content-security-policy']).toContain("default-src 'self'");
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['content-security-policy']).toContain("connect-src 'self'");
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['x-powered-by']).toBeUndefined();
  });

  test('the pages run under the CSP without violations', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (m) => {
      if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 160));
    });
    await page.goto('/');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search' }).fill('D-003');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.goto('/decisions?id=D-003');
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(violations).toEqual([]);
  });
});

test.describe('loading states', () => {
  test('client navigation shows a skeleton while repository data loads', async ({ page }) => {
    await page.goto('http://localhost:3102/');
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /^Work Queue/ }).click();
    await expect(page.getByTestId('queue-loading')).toBeVisible();
    await expect(page.getByTestId('queue-loading')).toBeHidden({ timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Work Queue' })).toBeVisible();
  });
});

test.describe('empty states', () => {
  test('a search with no match explains itself and offers a way back', async ({ page }) => {
    await page.goto('/decisions');
    await page.getByRole('searchbox', { name: 'Search decisions' }).fill('zzzz-no-such-decision');
    await expect(page.getByText('No decisions match these filters')).toBeVisible();
    await expect(page.getByTestId('result-count')).toContainText('0 of 57');
    await page.getByRole('button', { name: 'Clear filters' }).last().click();
    await expect(page.getByTestId('decision-row')).toHaveCount(57);
  });

  test('queue, approvals, architecture and presentation explain empty filters', async ({ page }) => {
    await page.goto('/queue?q=zzzz-none');
    await expect(page.getByText('No items match these filters')).toBeVisible();
    await page.goto('/architecture?rq=zzzz-none&rk=zzzz-none&as=zzzz-none&dq=zzzz-none&ev=zzzz-none');
    await expect(page.getByText('No requirements match')).toBeVisible();
    await expect(page.getByText('No risks match')).toBeVisible();
    await expect(page.getByText('No assumptions match')).toBeVisible();
    await expect(page.getByText('No documents match')).toBeVisible();
    await expect(page.getByText('No evidence runs match')).toBeVisible();
    await page.goto('/presentation?sq=zzzz-none&qq=zzzz-none');
    await expect(page.getByText('No slides match')).toBeVisible();
    await expect(page.getByText('No questions match')).toBeVisible();
  });
});
