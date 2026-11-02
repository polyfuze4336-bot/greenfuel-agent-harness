import { expect, test } from '@playwright/test';
import { ALL_PAGES, ROUTES, expectNoAxeViolations, ready } from './helpers.ts';

test.describe('accessibility (axe, WCAG 2.1 A and AA)', () => {
  for (const r of ALL_PAGES) {
    test(`${r.heading}: no automatically detectable violations`, async ({ page }) => {
      await ready(page, r.path);
      await expectNoAxeViolations(page, r.heading);
    });
  }

  test('dark theme has no violations on the densest pages', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('studio:theme', 'dark'));
    for (const p of ['/', '/decisions', '/changes', '/approvals']) {
      await ready(page, p);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expectNoAxeViolations(page, `dark ${p}`);
    }
  });

  test('open overlays have no violations: detail panel, search, notifications, menus', async ({ page }) => {
    await ready(page, '/decisions?id=ADR-0004');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoAxeViolations(page, 'decision panel');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search' }).fill('residency');
    await expect(page.getByRole('option').first()).toBeVisible();
    await expectNoAxeViolations(page, 'search palette');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await expectNoAxeViolations(page, 'notifications');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: / account menu/ }).click();
    await expectNoAxeViolations(page, 'identity menu');
  });

  test('every interactive control has an accessible name and a visible focus ring', async ({ page }) => {
    await ready(page, '/decisions');
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll('button, a[href], input, select')].filter((el) => {
        const name = (el.getAttribute('aria-label') ?? '') + (el.textContent ?? '') + ((el as HTMLInputElement).labels?.[0]?.textContent ?? '') + (el.getAttribute('title') ?? '');
        return name.trim() === '';
      }).map((el) => el.outerHTML.slice(0, 100)),
    );
    expect(unnamed).toEqual([]);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('compare alternatives, source preview and the register health panel have no violations', async ({ page }) => {
    for (const p of ['/decisions/ADR-0004/compare', '/decisions/D-010/compare']) {
      await ready(page, p);
      await expectNoAxeViolations(page, p);
    }
    await ready(page, '/decisions');
    const section = page.getByTestId('register-health');
    await section.getByText('How complete is the register?').click();
    await section.getByText('Repository changes and synchronisation').click();
    await section.getByRole('button', { name: 'Sync now' }).click();
    await expect(section.getByText(/First synchronisation|unchanged/)).toBeVisible();
    await expectNoAxeViolations(page, 'register health');
    await ready(page, '/decisions?id=D-013');
    await expectNoAxeViolations(page, 'D-013 panel with AI suggestions');
    await page.getByRole('button', { name: 'Preview source' }).click();
    await expect(page.locator('tr[data-highlight="true"]')).toHaveCount(1);
    await expectNoAxeViolations(page, 'source preview');
  });

  test('colour is never the only status signal: every status pill carries text', async ({ page }) => {
    await ready(page, '/decisions');
    const bare = await page.locator('tbody td span.rounded-full').evaluateAll((els) => els.filter((e) => !(e.textContent ?? '').trim()).length);
    expect(bare).toBe(0);
  });

  test('reduced motion is respected', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await ready(page, '/decisions?id=D-001');
    const d = await page.getByTestId('detail-sheet').evaluate((el) => getComputedStyle(el).animationDuration);
    expect(parseFloat(d)).toBeLessThan(0.01);
  });
});

const SIZES = [
  { name: 'desktop 1440', width: 1440, height: 900, sidebar: true },
  { name: 'laptop 1280', width: 1280, height: 800, sidebar: true },
  { name: 'tablet landscape 1024', width: 1024, height: 768, sidebar: true },
  { name: 'tablet portrait 820', width: 820, height: 1180, sidebar: false },
  { name: 'tablet portrait 768', width: 768, height: 1024, sidebar: false },
  { name: 'phone 390', width: 390, height: 844, sidebar: false },
];

test.describe('responsive layout', () => {
  for (const s of SIZES) {
    test(`${s.name}: no horizontal page overflow on any page, correct navigation pattern`, async ({ page }) => {
      await page.setViewportSize({ width: s.width, height: s.height });
      for (const r of ALL_PAGES) {
        await ready(page, r.path);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over, `${r.path} overflows by ${over}px at ${s.width}`).toBeLessThanOrEqual(1);
      }
      const side = page.getByRole('navigation', { name: 'Primary' });
      if (s.sidebar) {
        await expect(side).toBeVisible();
        await expect(page.getByRole('button', { name: 'Open navigation' })).toBeHidden();
      } else {
        await expect(side).toBeHidden();
        await page.getByRole('button', { name: 'Open navigation' }).click();
        const nav = page.getByRole('dialog').getByRole('navigation', { name: 'Primary' });
        await expect(nav.getByRole('link')).toHaveCount(ROUTES.length);
        await nav.getByRole('link', { name: /^Changes/ }).click();
        await expect(page).toHaveURL(/\/changes/);
        await expect(page.getByRole('dialog')).toBeHidden();
      }
    });
  }

  test('tablet: the detail panel fits the viewport and the table stays usable', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await ready(page, '/decisions');
    await page.locator('[data-row-btn]').first().click();
    const sheet = page.getByTestId('detail-sheet');
    await expect(sheet).toBeVisible();
    // The sheet slides in; measure after the animation has settled.
    await expect.poll(async () => (await sheet.boundingBox())!.x + (await sheet.boundingBox())!.width).toBeLessThanOrEqual(821);
    expect((await sheet.boundingBox())!.x).toBeGreaterThanOrEqual(0);
  });
});
