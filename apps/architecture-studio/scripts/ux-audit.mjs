// Walks the ten questions of the final review as a user would, against a running Studio, and records what happened: time to answer, what was
// on screen, accessibility violations (axe), console errors, and a screenshot. It only reads. Usage: node scripts/ux-audit.mjs [baseUrl] [outDir]
import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';

const base = (process.argv[2] ?? 'http://localhost:3100').replace(/\/$/, '');
const out = path.resolve(process.argv[3] ?? 'ux-audit');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const results = [];
const errors = [];

async function open(size, url, ready) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${url}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${url}: ${e}`));
  const t = Date.now();
  await page.goto(base + url, { waitUntil: 'load', timeout: 120000 });
  await (ready ? ready(page) : page.locator('main h1').first().waitFor({ timeout: 120000 }));
  return { ctx, page, ms: Date.now() - t };
}
const shot = (page, name, full = false) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: full });
async function axe(page, label) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return r.violations.map((v) => `${label}: ${v.id} (${v.impact}) x${v.nodes.length}`);
}
const D = { width: 1440, height: 900 };
const M = { width: 390, height: 844 };
const rec = (q, answer, detail) => results.push({ q, answer, ...detail });

// 1. open and see what needs attention
{
  const { ctx, page, ms } = await open(D, '/', (p) => p.getByTestId('next-action').waitFor({ timeout: 120000 }));
  const title = await page.getByTestId('next-title').innerText();
  const attention = await page.getByTestId('attention-count').innerText();
  const blockers = await page.getByTestId('blockers-count').innerText();
  rec(1, 'Open the application and see what requires attention', { ready: true, ms, nextAction: title, awaitingReview: attention, blockers, firstScreenHasAction: await page.getByTestId('start-review').isVisible() });
  await shot(page, '01-overview-desktop', true);
  const violations = await axe(page, 'overview');
  results.push({ axe: 'overview', violations });
  await ctx.close();
}
// 2. find any decision within seconds
{
  const { ctx, page } = await open(D, '/');
  await page.keyboard.press('Control+k');
  const box = page.getByRole('combobox', { name: 'Search' });
  const out2 = [];
  for (const q of ['tamper', 'residency', 'ADR-0016', 'D-009', 'quality manager']) {
    await box.fill('');
    const t = Date.now();
    await box.fill(q);
    await page.getByRole('option').first().waitFor({ timeout: 15000 }).catch(() => {});
    const n = await page.getByRole('option').count();
    out2.push({ q, ms: Date.now() - t, results: n, first: n ? (await page.getByRole('option').first().innerText()).replace(/\s+/g, ' ').slice(0, 90) : null });
  }
  rec(2, 'Find any decision within seconds', { searches: out2 });
  await box.fill('ADR-0016');
  await page.getByRole('option').first().waitFor();
  await shot(page, '02-global-search', false);
  await page.keyboard.press('Enter');
  await page.waitForURL(/decisions/, { timeout: 30000 }).catch(() => {});
  results[results.length - 1].openedUrl = page.url().replace(base, '');
  await ctx.close();
}
// 3. context of a decision
{
  const { ctx, page, ms } = await open(D, '/decisions?id=ADR-0016', async (p) => {
    await p.getByRole('dialog').waitFor({ timeout: 120000 });
    await p.getByRole('dialog').locator('ol li').first().waitFor({ timeout: 60000 });
  });
  const dlg = page.getByRole('dialog');
  const headings = await dlg.locator('h2,h3').allInnerTexts();
  const words = (await dlg.innerText()).split(/\s+/).length;
  rec(3, 'Understand business and technical context', { ms, sections: headings.map((h) => h.trim()).filter(Boolean), wordsInPanel: words });
  await shot(page, '03-decision-detail', false);
  results.push({ axe: 'decision detail', violations: await axe(page, 'decision-detail') });
  // 5. challenge
  const challenge = page.getByRole('button', { name: /Challenge this decision/i });
  const has = (await challenge.count()) > 0;
  let ch = { available: has };
  if (has) {
    const t = Date.now();
    await challenge.first().click();
    await page.getByTestId('examiner-panel').first().waitFor({ timeout: 90000 }).catch(() => {});
    ch = { available: true, ms: Date.now() - t, headline: (await page.getByTestId('examiner-headline').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160), sections: (await page.getByTestId('examiner-sections').first().locator('summary,h3,h4').allInnerTexts().catch(() => [])).map((s) => s.replace(/\s+/g, ' ').trim()).slice(0, 14) };
    await shot(page, '05-challenge', false);
  }
  rec(5, 'Challenge the proposed architecture', ch);
  // 6. impact
  const impact = page.getByTestId('impact-panel').first();
  let im = { present: (await impact.count()) > 0 };
  if (im.present) {
    await impact.scrollIntoViewIfNeeded().catch(() => {});
    im.text = (await impact.innerText()).replace(/\s+/g, ' ').slice(0, 300);
    await shot(page, '06-impact', false);
  }
  rec(6, 'Understand the impact of approval or rejection', im);
  await ctx.close();
}
// 4. compare alternatives
{
  const { ctx, page, ms } = await open(D, '/decisions/ADR-0016/compare');
  const words = (await page.locator('main').innerText()).split(/\s+/).length;
  rec(4, 'Compare alternatives without excessive reading', { ms, wordsOnPage: words, columns: await page.locator('main table th, main [role="columnheader"]').count() });
  await shot(page, '04-compare', true);
  results.push({ axe: 'compare', violations: await axe(page, 'compare') });
  await ctx.close();
}
// 7. approve or reject with minimal effort
{
  const { ctx, page, ms } = await open(D, '/decisions/ADR-0020/review');
  const controls = await page.locator('main button:visible, main [role="button"]:visible, main input:visible, main textarea:visible, main select:visible').count();
  const actions = (await page.locator('main button:visible').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 14);
  const session = await (await fetch(`${base}/api/v1/auth/session`)).json();
  rec(7, 'Approve or reject with minimal effort', { ms, signedIn: session.authenticated, mode: session.mode, visibleControls: controls, buttons: actions });
  await shot(page, '07-review', true);
  results.push({ axe: 'review', violations: await axe(page, 'review') });
  await ctx.close();
}
// 8. confirm GitHub was updated (what the page offers; the real write is the owner's)
{
  const { ctx, page, ms } = await open(D, '/changes');
  rec(8, 'Confirm GitHub was actually updated', { ms, sections: (await page.locator('main h2').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim()), freshness: await page.getByTestId('freshness').innerText().catch(() => null), pendingEmptyState: await page.getByText('Nothing is waiting on GitHub').isVisible().catch(() => false) });
  await shot(page, '08-changes', true);
  results.push({ axe: 'changes', violations: await axe(page, 'changes') });
  await ctx.close();
}
// 9. what blocks the build
{
  const { ctx, page, ms } = await open(D, '/queue/blocking');
  rec(9, 'Understand what blocks the build', { ms, headings: (await page.locator('main h1,main h2').allInnerTexts()).map((s) => s.trim()).slice(0, 8) });
  await shot(page, '09-blocking', false);
  results.push({ axe: 'blocking', violations: await axe(page, 'blocking') });
  await ctx.close();
}
// 10. generate an evidence-linked presentation
{
  const { ctx, page, ms } = await open(D, '/presentation/deck', (p) => p.getByTestId('deck-studio').waitFor({ timeout: 120000 }));
  rec(10, 'Generate an evidence-linked presentation', { ms, slides: await page.getByTestId('slide-list').locator('li').count(), gate: (await page.getByTestId('deck-gate').locator('li').allInnerTexts()).map((s) => s.split('\n')[0]).slice(0, 8), buildButtonEnabled: await page.getByTestId('build-sample').isEnabled() });
  await shot(page, '10-presentation-deck', false);
  results.push({ axe: 'deck', violations: await axe(page, 'deck') });
  await ctx.close();
}
// responsive: the four destinations on a phone, with horizontal overflow measured
for (const [name, url] of [['overview', '/'], ['decisions', '/decisions'], ['changes', '/changes'], ['presentation', '/presentation'], ['queue', '/queue']]) {
  const { ctx, page } = await open(M, url);
  await page.waitForLoadState('networkidle').catch(() => {});
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const small = await page.evaluate(() => [...document.querySelectorAll('button,a,input,select')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 24 || r.width < 24); }).length);
  results.push({ responsive: name, horizontalOverflowPx: overflow, controlsUnder24px: small });
  await shot(page, `mobile-${name}`, false);
  await ctx.close();
}
await browser.close();
const report = { when: new Date().toISOString(), base, consoleErrors: errors, results };
fs.writeFileSync(path.join(out, 'ux-audit.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
