import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const repoRoot = path.resolve(process.cwd(), '..', '..');
export const gitOut = (...a: string[]) => spawnSync('git', a, { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();

export const ROUTES = [
  { path: '/', heading: 'Overview', nav: 'Overview' },
  { path: '/decisions', heading: 'Decision Register', nav: 'Decision Register' },
  { path: '/queue', heading: 'Work Queue', nav: 'Work Queue' },
  { path: '/approvals', heading: 'Approvals', nav: 'Approvals' },
  { path: '/architecture', heading: 'Architecture & Evidence', nav: 'Architecture & Evidence' },
  { path: '/presentation', heading: 'Presentation Studio', nav: 'Presentation Studio' },
] as const;

/** Fails on any WCAG 2.x A or AA violation axe can detect automatically. */
export async function expectNoAxeViolations(page: Page, label: string) {
  // Let entrance animations finish so contrast is measured at full opacity.
  await page.waitForTimeout(400);
  // axe-core/playwright resolves its own playwright-core copy, so the Page types differ nominally.
  const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s): ${v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} ${(n.any[0]?.message ?? '').slice(0, 110)}`).join(' | ')}`);
  expect(summary, `${label}: axe violations`).toEqual([]);
}

export async function ready(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('main h1').first()).toBeVisible();
}
