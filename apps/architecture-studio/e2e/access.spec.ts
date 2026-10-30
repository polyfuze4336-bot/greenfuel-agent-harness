import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect as baseExpect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { E2E_USERS, type FakeUser } from '../checks/fixtures/fake-entra.ts';
import { expectNoAxeViolations } from './helpers.ts';

// Security acceptance, in a real browser, against a Studio running in Entra mode (port 3106) and a stand-in for Microsoft Entra ID
// (port 3107). The stand-in is not Microsoft: this proves the Studio's own sign-in and authorization, not Entra's behaviour.
const expect = baseExpect.configure({ timeout: 20_000 });
const BASE = 'http://localhost:3106';
const IDP = 'http://127.0.0.1:3107';
test.use({ baseURL: BASE });
test.describe.configure({ mode: 'serial', timeout: 90_000 });

const dir = process.env.STUDIO_E2E_ENTRA_DIR!;
const state = path.join(dir, 'state');
const remote = path.join(dir, 'origin.git');
const bare = (...a: string[]) => spawnSync('git', ['--git-dir', remote, ...a], { encoding: 'utf8' }).stdout.trim();
const prsFile = path.join(state, 'prs.json');
const prs = () => (!fs.existsSync(prsFile) ? [] : (JSON.parse(fs.readFileSync(prsFile, 'utf8')) as { prs: { number: number; headSha: string; head: string }[] }).prs);
const REASON = 'The residency analysis in the design review supports this choice.';

function merge(n: number) {
  const pr = prs().find((p) => p.number === n)!;
  const ff = spawnSync('git', ['--git-dir', remote, 'merge-base', '--is-ancestor', bare('rev-parse', 'refs/heads/main'), pr.headSha]).status === 0;
  expect(ff, 'the pull request merges cleanly').toBe(true);
  bare('update-ref', 'refs/heads/main', pr.headSha);
}

const control = (req: APIRequestContext, body: { user?: FakeUser | null; fault?: Record<string, unknown> }) => req.post(`${IDP}/__control`, { data: body });
const ago = (s: number) => Math.floor(Date.now() / 1000) - s;

/** Sign in as a person through the whole browser flow, in a fresh browser context, so sessions never mix. */
async function signIn(browser: Browser, user: FakeUser, fault: Record<string, unknown> = {}): Promise<{ ctx: BrowserContext; page: Page; callback: string | null }> {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  let callback: string | null = null;
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/auth/entra/callback')) callback = r.url();
  });
  await control(ctx.request, { user, fault });
  await page.goto('/');
  await page.getByTestId('login-button').click();
  await page.waitForURL((u) => u.origin === BASE && !u.pathname.startsWith('/api/'));
  return { ctx, page, callback };
}

const session = async (req: APIRequestContext) => (await (await req.get('/api/v1/auth/session')).json()) as { authenticated: boolean; csrf?: string; mode: string; user?: { login: string; roles: string[]; provider: string; mfa: boolean } };
const post = async (req: APIRequestContext, url: string, data: unknown, csrf?: string, headers: Record<string, string> = {}) => req.post(url, { data, headers: { origin: BASE, 'content-type': 'application/json', ...(csrf ? { 'x-studio-csrf': csrf } : {}), ...headers } });
const revision = async (req: APIRequestContext, id: string) => ((await (await req.get(`/api/v1/review/${id}`)).json()) as { view: { revision: string } }).view.revision;
async function decide(req: APIRequestContext, id: string, action: string, extra: Record<string, unknown> = {}, key = `${id}-${action}-${Math.random().toString(36).slice(2, 10)}`) {
  const s = await session(req);
  return post(req, `/api/v1/review/${id}/actions`, { action, expectedRevision: await revision(req, id), idempotencyKey: key, ...extra }, s.csrf);
}
/** Most register entries recommend nothing, so approving means choosing an option explicitly. */
async function approveBody(req: APIRequestContext, id: string) {
  const d = (await (await req.get(`/api/v1/decisions/${id}`)).json()) as { decision?: { options?: { key: string }[] }; options?: { key: string }[] };
  const key = (d.decision?.options ?? d.options ?? [])[0]?.key;
  return { optionKey: key, rationale: REASON };
}
const approve = async (req: APIRequestContext, id: string) => decide(req, id, 'approve-alternative', await approveBody(req, id));
const codeOf = async (r: { json(): Promise<unknown> }) => ((await r.json()) as { code?: string }).code;

test.afterEach(async ({ request }) => {
  await control(request, { user: null, fault: {} });
});

test.describe('signed out', () => {
  test('every page shows only the sign-in screen, and every API answers 401 with no repository content', async ({ page, request }) => {
    for (const p of ['/', '/decisions', '/queue', '/decisions/D-033/review', '/access']) {
      await page.goto(p);
      await expect(page.getByTestId('login-screen')).toBeVisible();
      await expect(page.getByTestId('login-button')).toBeVisible();
      await expect(page.getByRole('navigation')).toHaveCount(0);
      const text = (await page.content()).toLowerCase();
      // Repository text must not be anywhere in the payload, including the serialised page data, not just invisible on screen.
      for (const needle of ['programme owner', 'quality manager', 'fuel products and blends', 'adr-0015']) expect(text, `${p}: ${needle}`).not.toContain(needle);
    }
    for (const u of ['/api/v1/queue', '/api/v1/review/D-033', '/api/v1/access/review']) {
      const r = await request.get(u);
      expect(r.status(), u).toBe(401);
      expect(r.headers()['content-type']).toContain('problem+json');
    }
    const s = await session(request);
    expect(s).toMatchObject({ authenticated: false, mode: 'entra' });
    expect((await post(request, '/api/v1/auth/signin', {})).status(), 'the development sign-in does not exist in Entra mode').toBe(404);
    expect((await post(request, '/api/v1/review/D-033/actions', { action: 'comment', comment: 'x', expectedRevision: 'x', idempotencyKey: 'anon-direct-0001' })).status()).toBe(401);
    expect((await request.get('/api/v1/auth/entra/callback?code=abc&state=forged', { maxRedirects: 0 })).headers().location).toContain('/login?error=');
  });

  test('the webhook endpoint stays reachable without a session (it is authenticated by signature instead)', async ({ request }) => {
    const r = await request.post('/api/v1/github/webhook', { data: '{}', headers: { 'content-type': 'application/json' } });
    expect([400, 401, 404, 501, 503]).toContain(r.status());
    expect(r.status(), 'refused for want of a valid signature or configuration, not for want of a session cookie').not.toBe(403);
  });

  test('no secret reaches the browser: not in any script, page or response', async ({ request }) => {
    const found: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|css|html|json|txt|map)$/.test(e.name)) {
          const t = fs.readFileSync(p, 'utf8');
          for (const needle of ['fake-client-secret', 'BEGIN PRIVATE KEY', 'STUDIO_ENTRA_CLIENT_SECRET', 'client_secret']) if (t.includes(needle)) found.push(`${needle} in ${path.relative(process.cwd(), p)}`);
        }
      }
    };
    walk(path.resolve(process.cwd(), '.next', 'static'));
    expect(found).toEqual([]);
    const s = JSON.stringify(await (await request.get('/api/v1/auth/session')).json());
    expect(s).not.toMatch(/secret|PRIVATE KEY|signing-key/i);
  });
});

test.describe('who can sign in', () => {
  test('an enrolled architecture owner signs in through Entra, with the role, provider and multi-factor sign-in shown; the cookie is HttpOnly and SameSite', async ({ browser }) => {
    const { ctx, page } = await signIn(browser, E2E_USERS.owner);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const s = await session(ctx.request);
    expect(s.authenticated).toBe(true);
    expect(s.user).toMatchObject({ login: 'owner@fake.test', provider: 'entra', mfa: true });
    expect(s.user!.roles).toContain('architecture-owner');
    const cookie = (await ctx.cookies()).find((c) => c.name === 'studio_session')!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(cookie.value.length).toBeGreaterThanOrEqual(40);
    await page.goto('/decisions/D-033/review');
    await expect(page.getByTestId('identity-roles')).toContainText('architecture-owner');
    await expect(page.getByTestId('identity')).toContainText('Microsoft Entra ID');
    await expect(page.getByTestId('governance')).toContainText('architecture');
    await page.getByRole('button', { name: /account menu/ }).click();
    await expect(page.getByTestId('menu-identity')).toContainText('owner@fake.test');
    await expect(page.getByTestId('access-link')).toHaveCount(0);
    await ctx.close();
  });

  test('a person who signs in to the tenant but holds no Studio role is refused with a plain reason', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: BASE });
    const page = await ctx.newPage();
    await control(ctx.request, { user: E2E_USERS.norole });
    await page.goto('/');
    await page.getByTestId('login-button').click();
    await expect(page.getByTestId('login-error')).toContainText('no role');
    expect((await session(ctx.request)).authenticated).toBe(false);
    await ctx.close();
  });

  test('a privileged Entra role claim without an enrollment gets nothing: the person cannot sign in at all', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: BASE });
    const page = await ctx.newPage();
    await control(ctx.request, { user: E2E_USERS.unenrolled });
    await page.goto('/');
    await page.getByTestId('login-button').click();
    await expect(page.getByTestId('login-error')).toBeVisible();
    expect((await session(ctx.request)).authenticated).toBe(false);
    expect((await ctx.request.get('/api/v1/queue')).status()).toBe(401);
    await ctx.close();
  });

  test('tokens that fail a check never create a session: wrong tenant, wrong audience, expired, unsigned', async ({ browser }) => {
    for (const fault of [{ claims: { tid: '00000000-0000-0000-0000-000000000999' } }, { claims: { aud: 'other-app' } }, { claims: { exp: ago(7200) } }, { header: { alg: 'none' }, unsigned: true }]) {
      const ctx = await browser.newContext({ baseURL: BASE });
      const page = await ctx.newPage();
      await control(ctx.request, { user: E2E_USERS.owner, fault });
      await page.goto('/');
      await page.getByTestId('login-button').click();
      await expect(page.getByTestId('login-error'), JSON.stringify(fault)).toBeVisible();
      expect((await session(ctx.request)).authenticated, JSON.stringify(fault)).toBe(false);
      await ctx.close();
    }
  });

  test('a callback replayed after a successful sign-in is refused and creates no session', async ({ browser }) => {
    const { ctx, callback } = await signIn(browser, E2E_USERS.owner);
    expect(callback).toBeTruthy();
    const fresh = await browser.newContext({ baseURL: BASE });
    const r = await fresh.request.get(callback!, { maxRedirects: 0 });
    expect(r.headers().location).toContain('/login?error=');
    expect((await session(fresh.request)).authenticated).toBe(false);
    const same = await ctx.request.get(callback!, { maxRedirects: 0 });
    expect(same.headers().location).toContain('error=unknown-state');
    await fresh.close();
    await ctx.close();
  });

  test('signing out ends the session on the server: the old cookie no longer works', async ({ browser }) => {
    const { ctx } = await signIn(browser, E2E_USERS.contributor);
    const old = (await ctx.cookies()).find((c) => c.name === 'studio_session')!.value;
    const s = await session(ctx.request);
    expect((await post(ctx.request, '/api/v1/auth/signout', {}, s.csrf)).ok()).toBe(true);
    const replay = await browser.newContext({ baseURL: BASE });
    await replay.addCookies([{ name: 'studio_session', value: old, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
    expect((await session(replay.request)).authenticated, 'a stolen cookie after sign-out').toBe(false);
    expect((await replay.request.get('/api/v1/queue')).status()).toBe(401);
    await replay.close();
    await ctx.close();
  });
});

test.describe('server-side authorization', () => {
  test('a viewer can read but every decision action is refused by the server, whatever the page shows', async ({ browser }) => {
    const { ctx, page } = await signIn(browser, E2E_USERS.viewer);
    await page.goto('/decisions/D-033/review');
    await expect(page.getByTestId('identity-roles')).toContainText('viewer');
    await expect(page.getByTestId('action-approve-alternative')).toHaveAttribute('aria-disabled', 'true');
    for (const a of ['approve-alternative', 'reject', 'comment', 'request-revision']) {
      const r = await decide(ctx.request, 'D-033', a, { ...(await approveBody(ctx.request, 'D-033')), comment: 'hello' });
      expect([r.status(), await codeOf(r)], a).toEqual([403, 'missing-permission']);
    }
    expect(prs().length, 'no pull request was created by a refused action').toBe(0);
    await ctx.close();
  });

  test('a contributor proposes but cannot approve; a security reviewer cannot approve an architecture decision', async ({ browser }) => {
    const c = await signIn(browser, E2E_USERS.contributor);
    for (const a of ['approve-alternative', 'reject', 'defer', 'reopen']) expect(await codeOf(await decide(c.ctx.request, 'D-033', a, await approveBody(c.ctx.request, 'D-033'))), a).toBe('missing-permission');
    const s = await signIn(browser, E2E_USERS.security);
    expect(await codeOf(await decide(s.ctx.request, 'D-033', 'approve-alternative', await approveBody(s.ctx.request, 'D-033'))), 'security reviewer on architecture').toBe('missing-permission');
    await c.ctx.close();
    await s.ctx.close();
  });

  test('regulatory decisions cannot be approved in the Studio by anyone, and the page says why', async ({ browser }) => {
    const { ctx, page } = await signIn(browser, E2E_USERS.owner);
    for (const id of ['D-006', 'D-023']) {
      const r = await decide(ctx.request, id, 'approve-alternative', await approveBody(ctx.request, id));
      expect([r.status(), await codeOf(r)], id).toEqual([403, 'domain-not-approvable']);
    }
    await page.goto('/decisions/D-006/review');
    await expect(page.getByTestId('governance')).toContainText('regulatory');
    await expect(page.getByTestId('governance')).toContainText('does not approve');
    await expect(page.getByTestId('action-approve-alternative')).toHaveAttribute('aria-disabled', 'true');
    await ctx.close();
  });

  test('a request needs the origin and the per-session CSRF token as well as the cookie', async ({ browser }) => {
    const { ctx } = await signIn(browser, E2E_USERS.owner);
    const s = await session(ctx.request);
    const body = { action: 'comment', comment: 'x', expectedRevision: 'x', idempotencyKey: 'csrf-direct-0001' };
    expect((await post(ctx.request, '/api/v1/review/D-033/actions', body)).status(), 'no CSRF token').toBe(403);
    expect((await post(ctx.request, '/api/v1/review/D-033/actions', body, s.csrf, { origin: 'http://evil.example' })).status(), 'foreign origin').toBe(403);
    expect((await post(ctx.request, '/api/v1/review/D-033/actions', body, 'not-my-token')).status(), 'wrong token').toBe(403);
    await ctx.close();
  });
});

test.describe('approval integrity', () => {
  test('an owner approves through the page: the record is signed, carries the Entra identity and what was checked, and only the merge makes it canonical', async ({ browser }) => {
    const { ctx, page } = await signIn(browser, E2E_USERS.owner);
    await page.goto('/decisions/D-033/review');
    await expect(page.getByTestId('review-status')).toContainText('Pending Review');
    await page.getByTestId('action-approve-alternative').click();
    const d = page.getByTestId('action-dialog');
    await d.getByRole('radio').first().check();
    await d.getByRole('textbox').last().fill(REASON);
    await d.getByRole('button', { name: 'Submit selection' }).click();
    await expect(d).toBeHidden({ timeout: 30_000 });
    await expect(page.getByTestId('proposal-tracker')).toBeVisible();
    await expect(page.getByTestId('review-status')).toContainText('Pending Review');
    const pr = prs().at(-1)!;
    const rec = JSON.parse(bare('show', `${pr.headSha}:docs/decision-reviews/D-033/0001-approve-alternative.json`)) as { actor: Record<string, unknown>; signature: { alg: string; keyId: string; value: string } | null; roleCheck: { domain: string; mfa: boolean; checks: string[]; policyHash: string }; schema: string };
    expect(rec.schema).toBe('greenfuel.decision-review-event/v2');
    expect(rec.actor).toMatchObject({ provider: 'entra', verifiedBy: 'entra-oidc', tenantId: '00000000-0000-0000-0000-000000000001', login: 'owner@fake.test' });
    expect(rec.signature).toMatchObject({ alg: 'Ed25519' });
    expect(rec.signature!.value.length).toBeGreaterThan(40);
    expect(rec.roleCheck).toMatchObject({ domain: 'architecture', mfa: true });
    expect(rec.roleCheck.checks).toEqual(expect.arrayContaining(['designated approver', 'recent sign-in', 'not the proposer']));
    expect(rec.roleCheck.policyHash).toMatch(/^[0-9a-f]{64}$/);
    merge(pr.number);
    await page.getByTestId('proposal-tracker').getByRole('button', { name: 'Check GitHub status' }).click();
    await expect(page.getByTestId('review-status')).toContainText('Approved');
    await ctx.close();
  });

  test('a hand-written approval committed to the repository, valid hash but unsigned, never shows as Approved and is reported', async ({ browser }) => {
    const { ctx, page } = await signIn(browser, E2E_USERS.owner);
    const base = JSON.parse(bare('show', `refs/heads/main:docs/decision-reviews/D-033/0001-approve-alternative.json`)) as Record<string, unknown>;
    const other = path.join(dir, 'other');
    if (!fs.existsSync(other)) spawnSync('git', ['clone', '-q', remote, other]);
    const run = (...a: string[]) => spawnSync('git', a, { cwd: other, encoding: 'utf8' });
    for (const [k, v] of [['user.email', 'o@example.invalid'], ['user.name', 'Other'], ['commit.gpgsign', 'false']]) run('config', k!, v!);
    run('pull', '-q', '--ff-only', 'origin', 'main');
    // The decision was approved properly above. Plant an unsigned approval for a different decision, with a correct hash.
    const { createHash } = await import('node:crypto');
    const canon = (v: unknown): string => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v));
    const { eventHash: _h, signature: _s, ...rest } = base;
    const forged = { ...rest, id: 'DR-D-034-0001', decisionId: 'D-034', seq: 1, prevHash: null } as Record<string, unknown>;
    const eventHash = createHash('sha256').update(canon(forged)).digest('hex');
    fs.mkdirSync(path.join(other, 'docs', 'decision-reviews', 'D-034'), { recursive: true });
    fs.writeFileSync(path.join(other, 'docs', 'decision-reviews', 'D-034', '0001-approve-alternative.json'), `${JSON.stringify({ ...forged, eventHash, signature: null }, null, 2)}\n`);
    run('add', '-A');
    run('commit', '-q', '-m', 'Approved D-034 (not really)');
    run('push', '-q', 'origin', 'HEAD:refs/heads/main');
    // Make the Studio fetch the canonical branch, so the planted commit is really what it reads.
    expect(spawnSync('git', ['fetch', '-q', 'origin'], { cwd: path.join(dir, 'work') }).status).toBe(0);
    await page.goto('/decisions/D-034/review');
    await expect(page.getByTestId('review-status')).not.toContainText('Approved');
    const v = (await (await ctx.request.get('/api/v1/review/D-034')).json()) as { view: { canonical: { state: { problems: string[]; effectiveStatus: string | null } } } };
    expect(v.view.canonical.state.effectiveStatus).toBeNull();
    expect(v.view.canonical.state.problems.length, 'the planted record is reported, not silently dropped').toBeGreaterThan(0);
    expect(v.view.canonical.state.problems.join(' ')).toMatch(/signature|signed|hash/i);
    await ctx.close();
  });

  test('segregation of duties: whoever requested a revision cannot then approve it, and a different owner can', async ({ browser }) => {
    const o1 = await signIn(browser, E2E_USERS.owner);
    const id = 'D-035';
    const rev = await decide(o1.ctx.request, id, 'request-revision', { rationale: 'Add the cost comparison before deciding.' });
    expect(rev.status(), await rev.text()).toBeLessThan(300);
    const proposalId = ((await rev.json()) as { proposal: { id: string } }).proposal.id;
    const s1 = await session(o1.ctx.request);
    expect((await post(o1.ctx.request, `/api/v1/review/proposals/${proposalId}/sync`, {}, s1.csrf)).ok()).toBe(true);
    merge(prs().at(-1)!.number);
    expect((await post(o1.ctx.request, `/api/v1/review/proposals/${proposalId}/sync`, {}, s1.csrf)).ok()).toBe(true);
    for (const a of ['approve-alternative', 'reject', 'defer']) {
      const r = await decide(o1.ctx.request, id, a, { ...(await approveBody(o1.ctx.request, id)) });
      expect([r.status(), await codeOf(r)], `the proposer: ${a}`).toEqual([403, 'sod-proposer']);
    }
    const page = o1.page;
    await page.goto(`/decisions/${id}/review`);
    await page.getByTestId('action-approve-alternative').click({ force: true });
    await expect(page.getByTestId('rail-notice')).toContainText('proposed this revision');
    const o2 = await signIn(browser, E2E_USERS.owner2);
    const ok = await approve(o2.ctx.request, id);
    expect(ok.status(), await ok.text()).toBeLessThan(300);
    await o1.ctx.close();
    await o2.ctx.close();
  });

  test('approving needs a recent sign-in: an old one is sent back to sign in again, and a fresh sign-in then works', async ({ browser }) => {
    const { ctx, page } = await signIn(browser, E2E_USERS.owner, { claims: { iat: ago(3600), nbf: ago(3600) } });
    expect((await session(ctx.request)).authenticated, 'reading is allowed on an old sign-in').toBe(true);
    const r = await approve(ctx.request, 'D-037');
    expect([r.status(), await codeOf(r)]).toEqual([401, 'reauth-required']);
    await page.goto('/decisions/D-037/review');
    await expect(page.getByTestId('action-approve-alternative')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('reauth-notice')).toContainText('recent sign-in');
    await control(ctx.request, { user: E2E_USERS.owner, fault: {} });
    await page.getByTestId('reauth-link').click();
    await page.waitForURL((u) => u.origin === BASE && u.pathname.includes('/decisions/D-037'));
    await expect(page.getByTestId('action-approve-alternative')).not.toHaveAttribute('aria-disabled', 'true');
    const ok = await approve(ctx.request, 'D-037');
    expect(ok.status(), await ok.text()).toBeLessThan(300);
    await ctx.close();
  });

  test('approving needs multi-factor sign-in: a single-factor sign-in can read and comment but not approve', async ({ browser }) => {
    const { ctx } = await signIn(browser, { ...E2E_USERS.owner2, amr: ['pwd'] });
    const s = await session(ctx.request);
    expect(s.user!.mfa).toBe(false);
    const r = await approve(ctx.request, 'D-031');
    expect([r.status(), await codeOf(r)]).toEqual([403, 'mfa-required']);
    await ctx.close();
  });
});

test.describe('accessibility of the new screens', () => {
  test('the sign-in screen, the sign-in error, the access review and the identity menu have no axe violations', async ({ browser, page }) => {
    await page.goto('/');
    await expect(page.getByTestId('login-screen')).toBeVisible();
    await expectNoAxeViolations(page, 'sign-in screen');
    await page.goto('/login?error=no-access');
    await expect(page.getByTestId('login-error')).toBeVisible();
    await expectNoAxeViolations(page, 'sign-in error');
    const admin = await signIn(browser, E2E_USERS.admin);
    await admin.page.goto('/access');
    await expect(admin.page.getByTestId('access-review')).toBeVisible();
    await expectNoAxeViolations(admin.page, 'access review');
    await admin.page.getByRole('button', { name: /account menu/ }).click();
    await expect(admin.page.getByTestId('menu-identity')).toBeVisible();
    await expectNoAxeViolations(admin.page, 'identity menu');
    await admin.ctx.close();
  });
});

test.describe('administration', () => {
  test('an administrator reviews access, sees what needs attention, and records the review; nobody else can', async ({ browser }) => {
    const admin = await signIn(browser, E2E_USERS.admin);
    await admin.page.goto('/access');
    await expect(admin.page.getByTestId('access-review')).toBeVisible();
    await expect(admin.page.getByTestId('access-person')).toHaveCount(5);
    await expect(admin.page.getByTestId('access-findings')).toContainText('only one Administrator');
    await expect(admin.page.getByTestId('access-findings')).toContainText('not pinned');
    await expect(admin.page.getByTestId('access-domains')).toContainText('regulatory');
    await expect(admin.page.getByTestId('last-attestation')).toContainText('Never attested');
    await admin.page.getByLabel('Review note').fill('Reviewed in the browser test.');
    await admin.page.getByTestId('attest').click();
    await expect(admin.page.getByTestId('access-message')).toContainText('Recorded');
    await expect(admin.page.getByTestId('last-attestation')).toContainText('admin@fake.test');
    await admin.page.getByRole('button', { name: /account menu/ }).click();
    await expect(admin.page.getByTestId('access-link')).toBeVisible();
    await admin.page.keyboard.press('Escape');

    for (const u of [E2E_USERS.owner, E2E_USERS.security, E2E_USERS.contributor, E2E_USERS.viewer]) {
      const x = await signIn(browser, u);
      expect((await x.ctx.request.get('/api/v1/access/review')).status(), u.upn).toBe(403);
      await x.page.goto('/access');
      await expect(x.page.getByTestId('access-denied')).toContainText('Administrators');
      await x.page.getByRole('button', { name: /account menu/ }).click();
      await expect(x.page.getByTestId('access-link')).toHaveCount(0);
      const s = await session(x.ctx.request);
      expect((await post(x.ctx.request, '/api/v1/access/suspend', { subject: 'github:1', reason: 'nothing at all' }, s.csrf)).status(), u.upn).toBe(403);
      expect((await post(x.ctx.request, '/api/v1/access/attest', {}, s.csrf)).status(), u.upn).toBe(403);
      await x.ctx.close();
    }
    await admin.ctx.close();
  });

  test('the Administrator manages access and approves nothing: every decision action is refused', async ({ browser }) => {
    const { ctx } = await signIn(browser, E2E_USERS.admin);
    for (const a of ['approve-alternative', 'reject', 'defer', 'reopen']) expect(await codeOf(await decide(ctx.request, 'D-033', a, await approveBody(ctx.request, 'D-033'))), a).toBe('missing-permission');
    const s = await session(ctx.request);
    expect(s.user!.roles).toContain('administrator');
    expect(s.user!.roles).not.toContain('architecture-owner');
    await ctx.close();
  });

  test('administration needs the CSRF token and origin, and an administrator cannot suspend themselves', async ({ browser }) => {
    const { ctx } = await signIn(browser, E2E_USERS.admin);
    const s = await session(ctx.request);
    const self = `entra:00000000-0000-0000-0000-000000000001:${E2E_USERS.admin.oid}`;
    expect((await post(ctx.request, '/api/v1/access/suspend', { subject: self, reason: 'testing the guard' })).status(), 'no CSRF').toBe(403);
    expect((await post(ctx.request, '/api/v1/access/suspend', { subject: self, reason: 'testing the guard' }, s.csrf, { origin: 'http://evil.example' })).status(), 'foreign origin').toBe(403);
    const r = await post(ctx.request, '/api/v1/access/suspend', { subject: self, reason: 'testing the guard' }, s.csrf);
    expect([r.status(), await codeOf(r)]).toEqual([403, 'self-suspend']);
    expect((await post(ctx.request, '/api/v1/access/suspend', { subject: 'not-a-subject', reason: 'testing the guard' }, s.csrf)).status()).toBe(400);
    await ctx.close();
  });

  test('a suspended approver loses access on their very next request, their sessions end, and lifting it restores sign-in', async ({ browser }) => {
    const owner = await signIn(browser, E2E_USERS.owner2);
    expect((await owner.ctx.request.get('/api/v1/queue')).status()).toBe(200);
    const admin = await signIn(browser, E2E_USERS.admin);
    await admin.page.goto('/access');
    const row = admin.page.getByTestId('access-person').filter({ hasText: 'owner2@fake.test' });
    admin.page.once('dialog', (d) => void d.accept('Credentials reported stolen at the vendor'));
    await row.getByRole('button', { name: 'Suspend' }).click();
    await expect(admin.page.getByTestId('access-message')).toContainText('Suspended');
    await expect(row).toContainText('suspended');
    expect((await owner.ctx.request.get('/api/v1/queue')).status(), 'the next request after suspension').toBeGreaterThanOrEqual(401);
    expect((await session(owner.ctx.request)).authenticated, 'the session is gone').toBe(false);
    await owner.page.goto('/');
    await expect(owner.page.getByTestId('login-screen')).toBeVisible();
    const again = await browser.newContext({ baseURL: BASE });
    const p2 = await again.newPage();
    await control(again.request, { user: E2E_USERS.owner2 });
    await p2.goto('/');
    await p2.getByTestId('login-button').click();
    await expect(p2.getByTestId('login-error'), 'a suspended person cannot sign back in').toBeVisible();
    await row.getByRole('button', { name: 'Lift suspension' }).click();
    await expect(admin.page.getByTestId('access-message')).toContainText('lifted');
    await p2.goto('/');
    await p2.getByTestId('login-button').click();
    await p2.waitForURL((u) => u.origin === BASE && !u.pathname.startsWith('/api/'));
    expect((await session(again.request)).authenticated).toBe(true);
    await again.close();
    await owner.ctx.close();
    await admin.ctx.close();
  });
});
