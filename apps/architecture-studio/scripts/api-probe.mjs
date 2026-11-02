// Black-box API security and latency probe. Run against a live Studio:
//   node scripts/api-probe.mjs http://localhost:3100 [out.json]
// It sends only requests that must be refused (no session, wrong origin, hostile paths) plus GET reads for latency. It changes no repository
// data. The one exception it deliberately avoids is the development sign-in with the right origin, which would open a development session.
// Every result is a measured response, not an assumption.
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const base = (process.argv[2] ?? 'http://localhost:3100').replace(/\/$/, '');
const out = process.argv[3];
const apiDir = path.join(import.meta.dirname, '..', 'src', 'app', 'api');
const results = [];
const record = (area, name, pass, detail) => results.push({ area, name, pass, detail });

function routes(dir, rel = '') {
  const list = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) list.push(...routes(path.join(dir, e.name), `${rel}/${e.name}`));
    else if (e.name === 'route.ts') {
      const src = fs.readFileSync(path.join(dir, e.name), 'utf8');
      const methods = [...src.matchAll(/export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
      list.push({ url: rel.replace(/\[[^\]]+\]/g, 'x'), methods });
    }
  }
  return list;
}
const all = routes(apiDir);
const f = async (url, init = {}) => {
  const t = performance.now();
  const r = await fetch(`${base}${url}`, { redirect: 'manual', ...init });
  const body = await r.text();
  return { status: r.status, headers: r.headers, body, ms: performance.now() - t };
};
const leaks = (body) => /node_modules|\bat \w+.*\(.*:\d+:\d+\)|[A-Z]:\\Users|\/home\/|stack/i.test(body);

// 1. Every state-changing route refuses a request with no session, whatever the origin.
const mutating = all.flatMap((r) => r.methods.filter((m) => m !== 'GET').map((m) => ({ ...r, method: m })));
for (const r of mutating) {
  for (const origin of [undefined, 'https://evil.example', base]) {
    if (origin === base && r.url === '/api/v1/auth/signin') continue;
    const res = await f(r.url, { method: r.method, headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: '{}' });
    const isWebhook = r.url.includes('/webhook');
    const refused = res.status >= 400 && res.status < 500;
    const cacheOnly = ['/api/v1/refresh', '/api/v1/register/sync'].includes(r.url);
    record('unauthenticated-writes', `${r.method} ${r.url} origin=${origin ?? 'none'}`, refused || (cacheOnly && res.status < 300), { status: res.status, note: isWebhook ? 'needs a valid HMAC signature' : cacheOnly ? 'cache refresh only, changes no repository data' : undefined, leaks: leaks(res.body) });
  }
}

// 2. Methods: a read route must not accept writes.
for (const r of all.filter((x) => x.methods.length === 1 && x.methods[0] === 'GET' && !x.url.includes('auth/entra'))) {
  const res = await f(r.url, { method: 'DELETE', headers: { origin: base } });
  record('methods', `DELETE ${r.url}`, res.status === 405 || res.status === 404, { status: res.status });
}

// 3. Hostile paths on the file-reading routes.
const evil = ['../package.json', '..\\..\\package.json', '%2e%2e%2f%2e%2e%2fpackage.json', '/etc/passwd', 'C:\\Windows\\win.ini', '.git/config', 'docs/../../../.env', 'docs/adr/0001\u0000.md'];
for (const p of evil) {
  const res = await f(`/api/v1/source?path=${encodeURIComponent(p)}`);
  record('path-traversal', `source?path=${JSON.stringify(p)}`, res.status >= 400 && res.status < 500 && !/"lines"|root:|\[extensions\]|\[core\]/.test(res.body), { status: res.status });
}
for (const u of ['/api/v1/deck/export/..%2f..%2fpackage.json', '/api/v1/deck/export/pptx%00', '/api/v1/deck/export/%2e%2e', '/api/v1/deck/preview/-1', '/api/v1/deck/preview/999', '/api/v1/deck/preview/..%2fx', '/api/v1/review/..%2f..%2fx', '/api/v1/queue/..%2f..%2fx']) {
  const res = await f(u);
  // A 308 is Next normalising ".." away before routing: the client is sent to a path that is itself checked.
  record('path-traversal', `GET ${u}`, ((res.status >= 400 && res.status < 500) || res.status === 308) && !leaks(res.body), { status: res.status });
}

// 4. Oversized and malformed bodies are refused as client errors, never a crash.
const big = JSON.stringify({ rationale: 'x'.repeat(3 * 1024 * 1024) });
for (const url of ['/api/v1/deck/actions', '/api/v1/review/ADR-0016/actions']) {
  const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: big });
  record('body-limits', `3 MB body to ${url}`, res.status >= 400 && res.status < 500, { status: res.status });
  const bad = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: '{not json' });
  record('body-limits', `malformed JSON to ${url}`, bad.status >= 400 && bad.status < 500 && !leaks(bad.body), { status: bad.status });
}

// 5. Response headers and error bodies.
const page = await f('/');
const h = (n) => page.headers.get(n);
record('headers', 'Content-Security-Policy present', !!h('content-security-policy'), { value: h('content-security-policy')?.slice(0, 160) });
record('headers', 'CSP does not allow unsafe-eval', !/unsafe-eval/.test(h('content-security-policy') ?? ''), {});
record('headers', 'X-Content-Type-Options: nosniff', h('x-content-type-options') === 'nosniff', { value: h('x-content-type-options') });
record('headers', 'framing refused', /frame-ancestors 'none'|frame-ancestors 'self'/.test(h('content-security-policy') ?? '') || /DENY|SAMEORIGIN/i.test(h('x-frame-options') ?? ''), {});
record('headers', 'Referrer-Policy set', !!h('referrer-policy'), { value: h('referrer-policy') });
record('headers', 'X-Powered-By absent', !h('x-powered-by'), { value: h('x-powered-by') });
const nf = await f('/api/v1/decisions/ADR-9999');
// Signed out, an Entra deployment answers 401 before it looks up anything; either answer is correct as long as nothing internal leaks.
record('errors', 'unknown decision is a 404 (or 401 signed out) problem document without internals', (nf.status === 404 || nf.status === 401) && !leaks(nf.body), { status: nf.status });
const np = await f('/no-such-page');
record('errors', 'unknown page is a 404 without internals', np.status === 404 && !leaks(np.body), { status: np.status });
const unauth = await f('/api/v1/auth/session');
record('errors', 'session endpoint without a cookie reveals no identity', !/"login"\s*:\s*"[^"]+"/.test(unauth.body) || /dev/i.test(unauth.body), { status: unauth.status });

// 6. Latency of read paths (sequential, warm).
async function sample(url, n) {
  await f(url);
  const t = [];
  for (let i = 0; i < n; i++) t.push((await f(url)).ms);
  t.sort((a, b) => a - b);
  const q = (p) => Math.round(t[Math.min(t.length - 1, Math.floor(p * t.length))] * 10) / 10;
  return { n, p50: q(0.5), p95: q(0.95), max: Math.round(t[t.length - 1] * 10) / 10 };
}
const latency = {};
for (const [name, url] of [
  ['search: decision text', '/api/v1/search?q=sovereignty'],
  ['search: id', '/api/v1/search?q=ADR-0016'],
  ['search: no match', '/api/v1/search?q=zzzzqqqq'],
  ['decision register', '/api/v1/register'],
  ['decision detail', '/api/v1/review/ADR-0016'],
  ['work queue', '/api/v1/queue'],
  ['baseline readiness', '/api/v1/baseline'],
  ['deck model', '/api/v1/deck'],
]) latency[name] = await sample(url, 30);

const failed = results.filter((r) => !r.pass);
const probeStatus = (await f('/api/v1/register')).status;
const latencyNote = probeStatus === 200 ? 'read paths answered 200' : `read paths answered ${probeStatus} (signed out), so these latencies measure the refusal, not a page`;
const summary = { base, probedAt: new Date().toISOString(), checks: results.length, failed: failed.length, routes: all.length, mutatingRoutes: mutating.length };
const report = { summary, latencyNote, failed, latency, results };
if (out) fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ summary, latencyNote, failed, latency }, null, 2));
process.exit(failed.length ? 1 : 0);
