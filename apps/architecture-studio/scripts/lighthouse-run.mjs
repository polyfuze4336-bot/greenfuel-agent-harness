// Runs Lighthouse (performance, accessibility, best practices) against a list of pages through an Edge that is already listening on a debugging
// port, and prints one line per page. Usage: node scripts/lighthouse-run.mjs <baseUrl> <outDir> <desktop|mobile> [port]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [base, outDir, form = 'desktop', port = '9333'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const pages = [['home', '/'], ['decisions', '/decisions'], ['decision-review', '/decisions/ADR-0020/review'], ['changes', '/changes'], ['presentation', '/presentation'], ['deck-builder', '/presentation/deck']];
const rows = [];
for (const [name, p] of pages) {
  const file = path.join(outDir, `${name}-${form}.json`);
  const args = ['--yes', 'lighthouse@12', base + p, `--port=${port}`, '--only-categories=performance,accessibility,best-practices', '--output=json', `--output-path=${file}`, '--quiet'];
  if (form === 'desktop') args.push('--preset=desktop');
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { encoding: 'utf8', shell: process.platform === 'win32' });
  if (!fs.existsSync(file)) {
    rows.push({ page: p, error: (r.stderr || r.stdout || '').slice(0, 160) });
    continue;
  }
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const a = j.audits;
  rows.push({
    page: p,
    perf: Math.round(j.categories.performance.score * 100),
    a11y: Math.round(j.categories.accessibility.score * 100),
    best: Math.round(j.categories['best-practices'].score * 100),
    fcpMs: Math.round(a['first-contentful-paint'].numericValue),
    lcpMs: Math.round(a['largest-contentful-paint'].numericValue),
    tbtMs: Math.round(a['total-blocking-time'].numericValue),
    cls: Math.round(a['cumulative-layout-shift'].numericValue * 1000) / 1000,
    siMs: Math.round(a['speed-index'].numericValue),
    ttfbMs: Math.round(a['server-response-time'].numericValue),
    transferKB: Math.round(a['total-byte-weight'].numericValue / 1024),
    lh: j.lighthouseVersion,
    ua: j.environment?.hostUserAgent?.slice(0, 70),
    throttling: j.configSettings?.throttlingMethod,
  });
}
fs.writeFileSync(path.join(outDir, `summary-${form}.json`), JSON.stringify(rows, null, 2));
console.table(rows.map(({ lh, ua, throttling, ...r }) => r));
console.log(rows[0]?.lh ? `lighthouse ${rows[0].lh}; ${rows[0].ua}; throttling ${rows[0].throttling}` : '');
