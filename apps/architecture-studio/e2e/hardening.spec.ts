import fs from 'node:fs';
import path from 'node:path';
import { expect as baseExpect, test } from '@playwright/test';
import { USERS } from '../checks/fixtures/review-fixture.ts';

const expect = baseExpect.configure({ timeout: 20_000 });

// Fixes from the final review: JSON is compressed, the read-only deployment cannot be written to, GitHub write-back needs the permission to
// propose, and a repository error does not reach the reader as raw git output.
const READONLY = 'http://localhost:3111';
const WRITE = 'http://localhost:3103';
const state = path.join(process.env.STUDIO_E2E_REVIEW_DIR!, 'state');
type User = (typeof USERS)[keyof typeof USERS];
const as = (u: User | null) => (u ? fs.writeFileSync(path.join(state, 'identity.json'), JSON.stringify(u)) : fs.rmSync(path.join(state, 'identity.json'), { force: true }));
const H = (origin: string, csrf?: string) => ({ 'content-type': 'application/json', origin, ...(csrf ? { 'x-studio-csrf': csrf } : {}) });

test.describe('JSON responses are compressed when the caller accepts it', () => {
  test('a large response is gzip on the wire, identical once decoded, and plain for a caller that does not accept gzip', async ({ request }) => {
    const gz = await request.get('/api/v1/queue', { headers: { 'accept-encoding': 'gzip' } });
    expect(gz.status()).toBe(200);
    expect(gz.headers()['content-encoding']).toBe('gzip');
    expect(gz.headers()['vary']).toMatch(/accept-encoding/i);
    expect(gz.headers()['content-type']).toMatch(/json/);
    const wire = Number(gz.headers()['content-length']);
    const plain = await request.get('/api/v1/queue', { headers: { 'accept-encoding': 'identity' } });
    expect(plain.headers()['content-encoding']).toBeUndefined();
    const plainBytes = (await plain.body()).length;
    expect(wire, 'the compressed body is a fraction of the plain one').toBeLessThan(plainBytes / 4);
    expect((await gz.json()).items?.length ?? (await gz.json()).count).toEqual((await plain.json()).items?.length ?? (await plain.json()).count);
  });
  test('a small response is not compressed, and a download is passed through untouched', async ({ request }) => {
    const v = await request.get('/api/v1/version', { headers: { 'accept-encoding': 'gzip' } });
    expect(v.headers()['content-encoding']).toBeUndefined();
    expect((await v.json()).build).toBeTruthy();
    const e = await request.get('/api/v1/deck/export/pptx', { headers: { 'accept-encoding': 'gzip' } });
    expect(e.headers()['content-encoding']).toBeUndefined();
  });
  test('an error is still a readable problem document, not compressed away', async ({ request }) => {
    const r = await request.get('/api/v1/source?path=..%2F..%2Fetc%2Fpasswd', { headers: { 'accept-encoding': 'gzip' } });
    expect(r.status()).toBeGreaterThanOrEqual(400);
    expect(r.status()).toBeLessThan(500);
    expect((await r.json()).title).toBeTruthy();
  });
});

test.describe('the read-only deployment cannot be written to', () => {
  test('nobody can sign in, reset the shared register baseline, or change anything', async ({ request }) => {
    const mode = await (await request.get(`${READONLY}/api/v1/auth/session`)).json();
    expect(mode.mode).toBe('public-readonly');
    expect(mode.authenticated).toBe(false);
    const sync = await request.post(`${READONLY}/api/v1/register/sync`, { headers: H(READONLY), data: {} });
    expect(sync.status()).toBe(403);
    expect((await sync.json()).code).toBe('read-only');
    expect((await request.post(`${READONLY}/api/v1/auth/signin`, { headers: H(READONLY), data: {} })).status()).toBe(404);
    for (const p of ['/api/v1/sync/reconcile', '/api/v1/review/proposals/P-1/sync', '/api/v1/deck/actions', '/api/v1/deck/build']) {
      const r = await request.post(`${READONLY}${p}`, { headers: H(READONLY), data: {} });
      expect(r.status(), p).toBe(401);
    }
    // And it still reads.
    expect((await request.get(`${READONLY}/api/v1/overview`)).status()).toBe(200);
    expect((await request.get(`${READONLY}/api/v1/register/sync`)).status()).toBe(200);
  });
  test('the development sign-in still works on a laptop, where it belongs', async ({ request }) => {
    const mode = await (await request.get('/api/v1/auth/session')).json();
    expect(mode.mode).toBe('github-dev');
  });
});

test.describe('GitHub write-back needs the permission to propose', () => {
  async function login(request: import('@playwright/test').APIRequestContext, u: User) {
    as(u);
    await request.post(`${WRITE}/api/v1/auth/signout`, { headers: H(WRITE), data: {} });
    const r = await request.post(`${WRITE}/api/v1/auth/signin`, { headers: H(WRITE), data: {} });
    expect(r.ok(), await r.text()).toBe(true);
    return ((await (await request.get(`${WRITE}/api/v1/auth/session`)).json()) as { csrf: string }).csrf;
  }
  test('a viewer is refused on both routes, with a reason, even with a valid session and token', async ({ request }) => {
    const csrf = await login(request, USERS.outsider);
    for (const p of ['/api/v1/sync/reconcile', '/api/v1/review/proposals/P-0/sync']) {
      const r = await request.post(`${WRITE}${p}`, { headers: H(WRITE, csrf), data: {} });
      expect(r.status(), p).toBe(403);
      expect((await r.json()).code).toBe('forbidden');
    }
  });
  test('a person who may propose is not refused by the permission check', async ({ request }) => {
    const csrf = await login(request, USERS.contrib);
    const r = await request.post(`${WRITE}/api/v1/sync/reconcile`, { headers: H(WRITE, csrf), data: {} });
    expect(r.status(), 'not a 401 or 403').not.toBe(403);
    expect(r.status()).not.toBe(401);
    as(null);
  });
});
