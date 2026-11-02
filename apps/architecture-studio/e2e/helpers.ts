import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const repoRoot = path.resolve(process.cwd(), '..', '..');
export const gitOut = (...a: string[]) => spawnSync('git', a, { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();

export const ROUTES = [
  { path: '/', heading: 'Overview', nav: 'Overview' },
  { path: '/decisions', heading: 'Decisions', nav: 'Decisions' },
  { path: '/changes', heading: 'Changes', nav: 'Changes' },
  { path: '/presentation', heading: 'Presentation', nav: 'Presentation' },
] as const;

/** Pages inside a destination. They keep their own addresses and are reached from a section tab, not from the primary navigation. */
export const SECTION_PAGES = [
  { path: '/queue', heading: 'Work Queue', tab: 'Work queue', nav: 'Decisions' },
  { path: '/architecture', heading: 'Architecture & Evidence', tab: 'Architecture & evidence', nav: 'Decisions' },
  { path: '/approvals', heading: 'Approvals', tab: 'Approvals', nav: 'Changes' },
  { path: '/baseline', heading: 'Architecture baseline', tab: 'Readiness', nav: 'Changes' },
] as const;

/** Every page that is a destination or part of one. */
export const ALL_PAGES = [...ROUTES, ...SECTION_PAGES] as const;

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
