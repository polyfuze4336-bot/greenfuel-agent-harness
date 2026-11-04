// Repeatable measurements of the running Studio: page load (TTFB, FCP, LCP, CLS, long tasks), JavaScript and total transfer, interaction
// latency, API timings, and a crawl of every internal link. It only reads. Usage:
//   node scripts/audit.mjs [baseUrl] [--out file.json] [--runs 3]
// Conditions are recorded in the output: machine, browser, network (none throttled unless --throttle), cache state, and server build.
import fs from 'node:fs';
import os from 'node:os';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) ?? 'http://localhost:3100').replace(/\/$/, '');
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const out = opt('out', null);
const runs = Number(opt('runs', 3));
const throttle = args.includes('--throttle');

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const round = (n) => (n == null ? null : Math.round(n));

const PAGES = ['/', '/decisions', '/decisions?id=ADR-0020', '/changes', '/queue', '/presentation', '/presentation/deck', '/baseline'];

const browser = await chromium.launch({ channel: 'msedge' });
const version = await (await fetch(`${base}/api/v1/version`)).json();

async function measurePage(url, cold) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (throttle) {
    // A mid-range mobile profile: 1.6 Mbps down, 150 ms RTT, 4x CPU slowdown.
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  const scripts = [];
  let total = 0;
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', async (r) => {
    try {
      const sizes = await r.request().sizes();
      const t = sizes.responseBodySize + sizes.responseHeadersSize;
      total += t;
      if (r.request().resourceType() === 'script') scripts.push(sizes.responseBodySize);
    } catch {
      /* a response that ended with the page */
    }
  });
  await page.addInitScript(() => {
    window.__m = { lcp: 0, cls: 0, longTasks: 0, longMs: 0 };
    new PerformanceObserver((l) => l.getEntries().forEach((e) => (window.__m.lcp = e.startTime))).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && (window.__m.cls += e.value))).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => ((window.__m.longTasks += 1), (window.__m.longMs += e.duration)))).observe({ type: 'longtask', buffered: true });
  });
  const t0 = Date.now();
  await page.goto(base + url, { waitUntil: 'load', timeout: 120000 });
  await page.locator('main h1').first().waitFor({ timeout: 120000 });
  await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => {});
  const wall = Date.now() - t0;
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return { ttfb: n.responseStart, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, fcp: fcp?.startTime ?? null, ...window.__m };
  });
  await ctx.close();
  return { url, cold, wallMs: wall, ttfbMs: round(nav.ttfb), fcpMs: round(nav.fcp), lcpMs: round(nav.lcp), cls: Math.round(nav.cls * 1000) / 1000, longTasks: nav.longTasks, longTaskMs: round(nav.longMs), jsKB: Math.round(scripts.reduce((a, b) => a + b, 0) / 1024), scripts: scripts.length, totalKB: Math.round(total / 1024), consoleErrors: errors.length };
}

const report = { when: new Date().toISOString(), base, build: version.build, data: version.data?.commitShort, machine: { os: `${os.type()} ${os.release()}`, cpus: os.cpus().length, cpu: os.cpus()[0]?.model, memGB: Math.round(os.totalmem() / 2 ** 30) }, browser: `Microsoft Edge (Chromium) ${browser.version()}`, network: throttle ? 'throttled: 1.6 Mbps, 150 ms RTT, CPU x4' : 'not throttled', runs, pages: [], api: [], interactions: [], links: null };

// ---- pages: one cold-cache run each (new browser context), then the median of `runs` more
for (const url of PAGES) {
  const first = await measurePage(url, true);
  const more = [];
  for (let i = 0; i < runs; i++) more.push(await measurePage(url, false));
  const m = (k) => median(more.map((x) => x[k]));
  report.pages.push({ url, first, median: { wallMs: m('wallMs'), ttfbMs: m('ttfbMs'), fcpMs: m('fcpMs'), lcpMs: m('lcpMs'), cls: m('cls'), longTaskMs: m('longTaskMs'), jsKB: m('jsKB'), scripts: m('scripts'), totalKB: m('totalKB'), consoleErrors: Math.max(...more.map((x) => x.consoleErrors)) } });
}

// ---- API timings (first = whatever the server had cached, then the median of five)
const API = ['/api/v1/version', '/api/v1/freshness', '/api/v1/overview', '/api/v1/decisions', '/api/v1/decisions/ADR-0020', '/api/v1/decisions/ADR-0020/impact', '/api/v1/queue', '/api/v1/changes', '/api/v1/baseline', '/api/v1/search?q=residency', '/api/v1/deck'];
for (const path of API) {
  const t = [];
  let status = 0;
  let bytes = 0;
  for (let i = 0; i < 6; i++) {
    const s = performance.now();
    const r = await fetch(base + path);
    const b = await r.arrayBuffer();
    t.push(performance.now() - s);
    status = r.status;
    bytes = b.byteLength;
  }
  report.api.push({ path, status, kb: Math.round(bytes / 1024), firstMs: round(t[0]), medianMs: round(median(t.slice(1))), maxMs: round(Math.max(...t.slice(1))) });
}
{
  // GitHub data retrieval: a fetch of the canonical branch, as the refresh button does.
  const s = performance.now();
  const r = await fetch(base + '/api/v1/refresh', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: '{}' });
  report.refresh = { status: r.status, ms: round(performance.now() - s) };
}

// ---- interactions
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(base + '/decisions', { waitUntil: 'networkidle', timeout: 120000 });
  await page.getByTestId('decision-table').waitFor();
  const rows = await page.getByTestId('decision-row').count();
  const time = async (label, fn) => {
    const s = performance.now();
    await fn();
    report.interactions.push({ label, ms: round(performance.now() - s) });
  };
  await time(`search narrows the register (${rows} rows)`, async () => {
    await page.getByRole('searchbox').first().fill('residency');
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="decision-row"]').length < n, rows, { timeout: 10000 });
  });
  await page.getByRole('searchbox').first().fill('');
  await time('open a decision from the register', async () => {
    await page.getByTestId('decision-row').first().click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('dialog').locator('ol li').first().waitFor({ timeout: 30000 });
  });
  await page.keyboard.press('Escape');
  await time('client navigation Decisions to Changes (no reload)', async () => {
    await page.evaluate(() => (window.__same = 1));
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /^Changes/ }).click();
    await page.locator('main h1', { hasText: 'Changes' }).waitFor({ timeout: 60000 });
  });
  await time('client navigation Changes to Overview', async () => {
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /^Overview/ }).click();
    await page.getByTestId('next-action').waitFor({ timeout: 60000 });
  });
  report.interactions.push({ label: 'same document after navigating (no full reload)', ms: (await page.evaluate(() => window.__same)) === 1 ? 0 : -1 });
  await time('open the "why this is here" drawer', async () => {
    await page.getByTestId('next-why-toggle').click();
    await page.getByTestId('why-total').first().waitFor();
  });
  await ctx.close();
}

// ---- every internal link on every page must resolve
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const seen = new Map();
  for (const url of PAGES.concat(['/approvals', '/architecture', '/queue/blocking', '/access'])) {
    await page.goto(base + url, { waitUntil: 'load', timeout: 120000 });
    await page.locator('main h1').first().waitFor({ timeout: 120000 }).catch(() => {});
    for (const h of await page.locator('a[href]').evaluateAll((els) => els.map((e) => e.getAttribute('href')))) if (h && h.startsWith('/') && !seen.has(h.split('#')[0])) seen.set(h.split('#')[0], url);
  }
  const bad = [];
  for (const [h, from] of seen) {
    const r = await fetch(base + h, { redirect: 'manual' });
    if (r.status >= 400) bad.push({ href: h, status: r.status, from });
  }
  report.links = { checked: seen.size, broken: bad };
  await ctx.close();
}

await browser.close();
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
