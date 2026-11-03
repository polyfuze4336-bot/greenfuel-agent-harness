import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect as baseExpect, test, type APIRequestContext, type Page } from '@playwright/test';
import { USERS } from '../checks/fixtures/review-fixture.ts';
import { hashEvent } from '../src/lib/workflow/events.ts';
import { adrText } from '../checks/fixtures/acceptance-world.ts';

const expect = baseExpect.configure({ timeout: 20_000 });

// Does what the screen says match what GitHub holds? Every scenario below ends with the same three-way comparison:
//   GITHUB: the review records and the commit on the canonical branch, read straight from the bare repository with git;
//   API:    what the Studio's server reports about the decision and its history;
//   SCREEN: what the page in the browser shows.
// The Studio is configured as a GitHub App and talks to a stand-in for the GitHub REST API (port 3105) running over a real bare
// git repository. The stand-in is not GitHub: these tests prove how the Studio behaves, not how GitHub behaves.
const BASE = 'http://localhost:3104';
const FAKE = 'http://127.0.0.1:3105';
test.use({ baseURL: BASE });
test.describe.configure({ mode: 'serial', timeout: 180_000 });

const dir = process.env.STUDIO_E2E_APP_DIR!;
const state = path.join(dir, 'state');
const remote = path.join(dir, 'origin.git');
const work = path.join(dir, 'work');
const git = (cwd: string, ...a: string[]) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const bare = (...a: string[]) => spawnSync('git', ['--git-dir', remote, ...a], { encoding: 'utf8' }).stdout.trim();

type User = (typeof USERS)[keyof typeof USERS];
const as = (u: User | null) => (u ? fs.writeFileSync(path.join(state, 'identity.json'), JSON.stringify(u)) : fs.rmSync(path.join(state, 'identity.json'), { force: true }));
const H = { origin: BASE, 'content-type': 'application/json' };

async function login(request: APIRequestContext, u: User): Promise<string> {
  as(u);
  await request.post('/api/v1/auth/signout', { headers: H, data: {} });
  const r = await request.post('/api/v1/auth/signin', { headers: H, data: {} });
  expect(r.ok(), `sign-in as ${u.login}: ${await r.text()}`).toBe(true);
  return ((await (await request.get('/api/v1/auth/session')).json()) as { csrf: string }).csrf;
}
const ctl = async (request: APIRequestContext, name: string, ...args: unknown[]) => {
  const r = await request.post(`${FAKE}/_control/${name}`, { data: { args } });
  expect(r.ok(), `${name}: ${await r.text()}`).toBe(true);
};
interface FakeState {
  pulls: { number: number; head: string; merged: boolean; closed: boolean; headSha: string }[];
  refWrites: string[];
}
const fake = async (request: APIRequestContext) => (await (await request.get(`${FAKE}/_control/state`)).json()) as FakeState;
const prsFor = async (request: APIRequestContext, id: string) => (await fake(request)).pulls.filter((p) => p.head.startsWith(`decision-review/${id}/`));

// ---- reading all three sides

interface GhEvent {
  seq: number;
  action: string;
  decisionId: string;
  rationale: string | null;
  comment: string | null;
  conditions: string[];
  option: { key: string; recommended: boolean } | null;
  actor: { login: string; provider: string; subject: string };
  eventHash: string;
  signature: unknown;
  createdAt: string;
}
function github(id: string) {
  const files = bare('ls-tree', '-r', '--name-only', 'refs/heads/main', `docs/decision-reviews/${id}/`).split('\n').filter(Boolean).sort();
  const events = files.map((f) => JSON.parse(bare('show', `refs/heads/main:${f}`)) as GhEvent).sort((a, b) => a.seq - b.seq);
  const lastFile = files[files.length - 1];
  const commit = lastFile ? bare('log', '-1', '--format=%H', 'refs/heads/main', '--', lastFile) : null;
  const changed = commit ? bare('diff-tree', '--no-commit-id', '--name-only', '-r', commit).split('\n') : [];
  return { files, events, commit, changed, main: bare('rev-parse', 'refs/heads/main') };
}
const reviewOf = async (request: APIRequestContext, id: string) => (await (await request.get(`/api/v1/review/${id}`)).json()) as {
  view: { revision: string; canonical: { commit: string | null; state: { effectiveStatus: string | null; events: GhEvent[]; conditions: string[]; problems: string[]; phase: string } }; open: { state: string } | null; actions: { action: string; allowed: boolean; authorised: boolean | null }[] };
  timeline: { kind: string; title: string; detail: string | null; actor: string | null; carriedBy?: { sha: string; pullRequest: { number: number } | null } }[];
  audit: { outcome: string; code: string | null; action: string; actor: string | null }[];
};
const optionsOf = async (request: APIRequestContext, id: string) => ((await (await request.get(`/api/v1/decisions/${id}/sheet`)).json()) as { decision: { options: { key: string; name: string; recommended: boolean }[]; status: string } }).decision;

const STATUS: Record<string, string> = { approve: 'Approved', 'approve-alternative': 'Approved', 'approve-with-conditions': 'Approved', reject: 'Rejected', defer: 'Deferred', 'request-revision': 'Pending Review', reopen: 'Pending Review' };

/** The three-way comparison. `status` is what the decision must show everywhere after the last record on GitHub. */
async function reconcile(page: Page, request: APIRequestContext, id: string, want: { action: string; status: string; count: number; actor?: string; text?: string; conditions?: string[]; option?: string }) {
  const gh = github(id);
  expect(gh.events.length, `${id}: records on GitHub`).toBe(want.count);
  const last = gh.events[gh.events.length - 1]!;
  expect(last.action, `${id}: last record on GitHub`).toBe(want.action);
  expect(last.actor.login).toBe(want.actor ?? USERS.owner.login);
  expect(last.signature, 'the record carries the server signature').toBeTruthy();
  expect(gh.changed, 'the smallest change: one file').toEqual([gh.files[gh.files.length - 1]]);
  if (want.option) expect(last.option?.key).toBe(want.option);
  if (want.conditions) expect(last.conditions).toEqual(want.conditions);

  const api = await reviewOf(request, id);
  const st = api.view.canonical.state;
  expect(st.problems, `${id}: no chain problems`).toEqual([]);
  expect(st.events.length, `${id}: API sees the same number of records as GitHub`).toBe(gh.events.length);
  expect(st.events[st.events.length - 1]!.eventHash, 'the same record, by hash').toBe(last.eventHash);
  expect(st.effectiveStatus ?? (await optionsOf(request, id)).status).toBe(want.status);
  expect(api.view.canonical.commit, 'the Studio read the commit GitHub is at').toBe(gh.main);
  const entry = api.timeline.find((t) => t.kind === 'review-event' && t.carriedBy?.sha === gh.commit);
  expect(entry, `${id}: the history names the GitHub commit that carries the last record`).toBeTruthy();
  if (want.conditions) expect(st.conditions).toEqual(want.conditions);

  await page.goto(`/decisions/${id}/review`);
  await expect(page.getByTestId('review-status')).toContainText(want.status);
  const tl = page.getByTestId('timeline');
  await expect(tl).toContainText(`@${want.actor ?? USERS.owner.login}`);
  if (want.text) await expect(tl).toContainText(want.text);
  await expect(tl.getByTestId('carried-by').first()).toContainText(gh.commit!.slice(0, 7));
  if (want.conditions) for (const c of want.conditions) await expect(page.getByTestId('conditions')).toContainText(c);
  return { gh, api };
}

// ---- another person committing to GitHub's main
const person = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-forger-'));
const pushToMain = (files: Record<string, string>, message: string, remove: string[] = []) => {
  if (!fs.existsSync(path.join(person, '.git'))) git(os.tmpdir(), 'clone', '-q', remote, person);
  git(person, 'config', 'user.email', 'forger@example.invalid');
  git(person, 'config', 'user.name', 'Forger');
  git(person, 'config', 'core.autocrlf', 'false');
  git(person, 'fetch', '-q', 'origin');
  git(person, 'checkout', '-q', '-B', 'main', 'origin/main');
  for (const p of remove) fs.rmSync(path.join(person, p), { force: true });
  for (const [p, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(person, p)), { recursive: true });
    fs.writeFileSync(path.join(person, p), c);
  }
  git(person, 'add', '-A');
  git(person, 'commit', '-q', '-m', message);
  git(person, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  git(work, 'fetch', '-q', 'origin');
  git(work, 'merge', '-q', '--ff-only', 'origin/main');
};

// ---- driving the workflow

let n = 0;
async function act(request: APIRequestContext, csrf: string, id: string, body: Record<string, unknown>) {
  const rv = (await reviewOf(request, id)).view.revision;
  const r = await request.post(`/api/v1/review/${id}/actions`, { headers: { ...H, 'x-studio-csrf': csrf }, data: { expectedRevision: rv, idempotencyKey: `recon-${++n}-${Date.now().toString(36)}-abcdef`, ...body } });
  return { r, body: (await r.json().catch(() => ({}))) as { proposal?: { id: string; state: string; prNumber: number | null; lastError?: { code: string; message: string } | null }; duplicate?: boolean; code?: string; detail?: string; conflict?: any } };
}
const sync = async (request: APIRequestContext, csrf: string, pid: string) => ((await (await request.post(`/api/v1/review/proposals/${pid}/sync`, { headers: { ...H, 'x-studio-csrf': csrf }, data: {} })).json()) as { proposal: { state: string } }).proposal;

/** Submit, check the pull request on GitHub, merge it as a person would, and let the Studio verify. Returns the moment before the merge too. */
async function decide(page: Page, request: APIRequestContext, csrf: string, id: string, body: Record<string, unknown>) {
  const mainBefore = bare('rev-parse', 'refs/heads/main');
  const before = (await reviewOf(request, id)).view.canonical.state.events.length;
  const { r, body: res } = await act(request, csrf, id, body);
  expect(r.status(), JSON.stringify(res)).toBe(200);
  const p = res.proposal!;
  expect(p.state).toBe('pull-request-created');
  expect(bare('rev-parse', 'refs/heads/main'), 'GitHub main did not move: nothing is canonical yet').toBe(mainBefore);
  expect(github(id).events.length).toBe(before);
  const pr = (await prsFor(request, id)).find((x) => !x.merged && !x.closed)!;
  expect(pr, 'a pull request is open').toBeTruthy();
  // Until the merge, the screen shows what GitHub holds, not what was asked for.
  await page.goto(`/decisions/${id}/review`);
  await expect(page.getByTestId('proposal-tracker')).toHaveAttribute('data-state', 'pull-request-created');
  const shown = (await reviewOf(request, id)).view.canonical.state.effectiveStatus;
  expect(shown, 'not decided yet').not.toBe(STATUS[body.action as string]);
  await ctl(request, 'setChecks', pr.headSha, [{ name: 'validate', status: 'completed', conclusion: 'success' }, { name: 'gate', status: 'completed', conclusion: 'success' }]);
  await ctl(request, 'merge', pr.number);
  const done = await sync(request, csrf, p.id);
  expect(done.state).toBe('applied');
  return { pr, proposalId: p.id };
}

// Decisions this spec may act on. Chosen by what the server says the owner may do to each one, never by assumption: in this world most
// real ADRs are Blocked, and the workflow correctly refuses to approve them. The decisions github-sync.spec.ts uses are left alone.
const RESERVED = new Set(['ADR-0046', 'ADR-0047', 'ADR-0020', ...Array.from({ length: 10 }, (_, i) => `D-0${26 + i}`), 'D-037']);
const used = new Set<string>();
async function pick(request: APIRequestContext, actions: string[], prefix = ''): Promise<string> {
  const list = (await (await request.get('/api/v1/decisions')).json()) as { items: { id: string }[] };
  for (const { id } of list.items) {
    if (used.has(id) || RESERVED.has(id) || !id.startsWith(prefix)) continue;
    const v = (await reviewOf(request, id)).view;
    if (v.canonical.state.events.length || v.open) continue;
    if (!actions.every((a) => v.actions.some((x) => x.action === a && x.allowed && x.authorised))) continue;
    used.add(id);
    return id;
  }
  throw new Error(`no free decision in this world allows ${actions.join(' + ')}`);
}
let csrf = '';
let approvedId = '';

// A fresh API context, and so a fresh cookie jar, for every test: sign in again each time.
test.beforeEach(async ({ request }) => {
  csrf = await login(request, USERS.owner);
});

test.describe('a new decision is added to GitHub and found by the Studio', () => {
  test('eight decisions arrive on GitHub, appear as Proposed, and are unchanged by being read', async ({ request }) => {
    const files: Record<string, string> = {};
    for (const [n, slug] of [['0040', 'approve'], ['0041', 'alt'], ['0042', 'conditions'], ['0043', 'reject'], ['0044', 'defer'], ['0045', 'reopen'], ['0046', 'forged-record'], ['0047', 'forged-markdown']]) files[`docs/adr/${n}-${slug}.md`] = adrText(n!, `Reconciliation scenario ${slug}`);
    pushToMain(files, 'ADRs 0040 to 0045 for the approval scenarios');
    await request.post('/api/v1/refresh', { headers: H, data: {} });
    for (const n of ['0040', '0041', '0042', '0043', '0044', '0045', '0046', '0047']) {
      const d = ((await (await request.get(`/api/v1/decisions/ADR-${n}`)).json()) as { decision: { status: string } }).decision;
      expect(d.status, `ADR-${n} appears as pending`).toBe('Proposed');
    }
    const before = bare('rev-parse', 'refs/heads/main');
    await request.get('/api/v1/decisions/ADR-0040');
    expect(bare('rev-parse', 'refs/heads/main'), 'reading changes nothing').toBe(before);
  });
});

test.describe('each action reconciles: GitHub, the server and the screen agree', () => {
  test('approve the recommended option', async ({ page, request }) => {
    approvedId = await pick(request, ['approve']);
    const { pr } = await decide(page, request, csrf, approvedId, { action: 'approve', rationale: 'The recommended option satisfies HC-01 and HC-02.' });
    await reconcile(page, request, approvedId, { action: 'approve', status: 'Approved', count: 1, text: 'The recommended option satisfies HC-01 and HC-02.' });
    expect(github(approvedId).events[0]!.option?.recommended).toBe(true);
    const api = await reviewOf(request, approvedId);
    expect(api.timeline.find((t) => t.kind === 'review-event')!.carriedBy!.pullRequest?.number, 'the history names the pull request').toBe(pr.number);
  });

  test('approve an alternative, with the option and the reason recorded', async ({ page, request }) => {
    const id = await pick(request, ['approve-alternative']);
    const alt = (await optionsOf(request, id)).options.find((o) => !o.recommended)!;
    await decide(page, request, csrf, id, { action: 'approve-alternative', optionKey: alt.key, rationale: 'The alternative has the lower recovery risk.' });
    await reconcile(page, request, id, { action: 'approve-alternative', status: 'Approved', count: 1, option: alt.key, text: 'The alternative has the lower recovery risk.' });
    expect(github(id).events[0]!.option?.recommended).toBe(false);
  });

  test('approve with conditions: the conditions travel to GitHub and back to the screen', async ({ page, request }) => {
    const id = await pick(request, ['approve-with-conditions']);
    const opt = (await optionsOf(request, id)).options[0]!;
    const conditions = ['Confirm in-country region support before build', 'Re-review after the pilot'];
    await decide(page, request, csrf, id, { action: 'approve-with-conditions', optionKey: opt.key, conditions, rationale: 'Approved only if both conditions are met.' });
    await reconcile(page, request, id, { action: 'approve-with-conditions', status: 'Approved', count: 1, conditions, text: 'Approved only if both conditions are met.' });
  });

  test('reject: a reason is required, and is what GitHub and the screen show', async ({ page, request }) => {
    const id = await pick(request, ['reject']);
    const none = await act(request, csrf, id, { action: 'reject' });
    expect(none.r.status(), 'no reason').toBeGreaterThanOrEqual(400);
    const short = await act(request, csrf, id, { action: 'reject', rationale: 'no' });
    expect(short.r.status(), 'a token reason').toBeGreaterThanOrEqual(400);
    expect(github(id).events.length).toBe(0);
    expect((await prsFor(request, id)).length, 'a refused request opens no pull request').toBe(0);
    await decide(page, request, csrf, id, { action: 'reject', rationale: 'Violates the residency constraint HC-01.' });
    await reconcile(page, request, id, { action: 'reject', status: 'Rejected', count: 1, text: 'Violates the residency constraint HC-01.' });
  });

  test('defer', async ({ page, request }) => {
    const id = await pick(request, ['defer']);
    await decide(page, request, csrf, id, { action: 'defer', rationale: 'Postponed until the pilot reports.' });
    await reconcile(page, request, id, { action: 'defer', status: 'Deferred', count: 1, text: 'Postponed until the pilot reports.' });
  });

  test('request revision, then a different person approves the revised decision: two records, one chain', async ({ page, request }) => {
    const id = await pick(request, ['request-revision', 'approve']);
    await decide(page, request, csrf, id, { action: 'request-revision', rationale: 'Add the recovery design before this is decided.' });
    await reconcile(page, request, id, { action: 'request-revision', status: 'Pending Review', count: 1, text: 'Add the recovery design' });
    // Segregation of duties: whoever asked for the revision may not approve the result.
    const self = await act(request, csrf, id, { action: 'approve', rationale: 'Approving my own revision request.' });
    expect(self.r.status()).toBe(403);
    expect(self.body.code).toBe('sod-proposer');
    expect(github(id).events.length).toBe(1);
    const second = await login(request, USERS.owner2);
    await decide(page, request, second, id, { action: 'approve', rationale: 'The recovery design is now attached.' });
    const { gh } = await reconcile(page, request, id, { action: 'approve', status: 'Approved', count: 2, actor: USERS.owner2.login, text: 'The recovery design is now attached.' });
    expect(gh.events[1]!.eventHash).not.toBe(gh.events[0]!.eventHash);
  });

  test('reopen an approved decision: the approval stays on record and the decision is open again', async ({ page, request }) => {
    const over = await act(request, csrf, approvedId, { action: 'approve', rationale: 'Approving again over the top.' });
    expect(over.r.status(), 'an approved decision cannot be silently overwritten').toBeGreaterThanOrEqual(400);
    expect(github(approvedId).events.length).toBe(1);
    const none = await act(request, csrf, approvedId, { action: 'reopen' });
    expect(none.r.status(), 'reopening needs a reason').toBeGreaterThanOrEqual(400);
    await decide(page, request, csrf, approvedId, { action: 'reopen', rationale: 'New evidence on sovereignty needs to be considered.' });
    const { gh } = await reconcile(page, request, approvedId, { action: 'reopen', status: 'Pending Review', count: 2, text: 'New evidence on sovereignty' });
    expect(gh.events[0]!.action, 'the first approval is still on record').toBe('approve');
    await expect(page.getByTestId('timeline')).toContainText('Approve the recommended option');
  });

  test('comment: recorded with its author, and no status changes anywhere', async ({ page, request }) => {
    const id = await pick(request, ['comment']);
    const before = (await optionsOf(request, id)).status;
    await decide(page, request, csrf, id, { action: 'comment', comment: 'The sovereignty lead should read this first.' });
    const { api } = await reconcile(page, request, id, { action: 'comment', status: before, count: 1, text: 'The sovereignty lead should read this first.' });
    expect(api.view.canonical.state.effectiveStatus, 'a comment imposes no status').toBeNull();
  });
});

test.describe('refusals leave GitHub and the screen exactly as they were', () => {
  const snapshot = async (request: APIRequestContext, id: string) => ({ main: bare('rev-parse', 'refs/heads/main'), prs: (await fake(request)).pulls.length, writes: (await fake(request)).refWrites.length, events: github(id).events.length });

  test('unauthorized: a person with no role, a contributor, an impostor with the owner’s login, and an unauthenticated caller are refused', async ({ request }) => {
    const id = await pick(request, ['request-revision']);
    const before = await snapshot(request, id);
    for (const u of [USERS.outsider, USERS.contrib, USERS.impostor]) {
      const c = await login(request, u);
      const { r, body } = await act(request, c, id, { action: 'approve', rationale: 'I approve this.' });
      expect(r.status(), `${u.login} (${u.id})`).toBeGreaterThanOrEqual(400);
      expect(body.proposal, `${u.login} got no proposal`).toBeUndefined();
    }
    // An agent or bot account cannot even sign in.
    as(USERS.bot);
    await request.post('/api/v1/auth/signout', { headers: H, data: {} });
    const bot = await request.post('/api/v1/auth/signin', { headers: H, data: {} });
    expect(bot.status()).toBe(401);
    expect(((await bot.json()) as { code: string }).code).toBe('NOT_A_PERSON');
    const anon = await request.post(`/api/v1/review/${id}/actions`, { headers: H, data: { action: 'approve', expectedRevision: 'x', idempotencyKey: 'anonymous-key-123456' } });
    expect(anon.status()).toBeGreaterThanOrEqual(401);
    expect(await snapshot(request, id), 'nothing reached GitHub').toEqual(before);
    csrf = await login(request, USERS.owner);
    const audit = (await reviewOf(request, id)).audit;
    expect(audit.filter((a) => a.outcome === 'denied').length, 'every refusal is in the audit log').toBeGreaterThanOrEqual(3);
    used.delete(id);
  });

  test('an AI agent or an unverified identity cannot approve, even with a valid session cookie', async ({ request }) => {
    const id = await pick(request, ['request-revision']);
    const before = await snapshot(request, id);
    const c = await login(request, USERS.owner);
    as(USERS.bot); // the identity behind the session changes under it
    const { r } = await act(request, c, id, { action: 'approve', rationale: 'Approved by the agent.' });
    expect(r.status()).toBeGreaterThanOrEqual(400);
    as(null);
    const { r: r2 } = await act(request, c, id, { action: 'approve', rationale: 'No identity at all.' });
    expect(r2.status()).toBeGreaterThanOrEqual(400);
    expect(await snapshot(request, id)).toEqual(before);
    csrf = await login(request, USERS.owner);
    used.delete(id);
  });

  test('no cross-site or token-less write: a wrong origin and a missing CSRF token are refused', async ({ request }) => {
    const id = await pick(request, ['request-revision']);
    const before = await snapshot(request, id);
    const rv = (await reviewOf(request, id)).view.revision;
    const body = { action: 'approve', rationale: 'Cross-site.', expectedRevision: rv, idempotencyKey: 'xsite-key-1234567' };
    expect((await request.post(`/api/v1/review/${id}/actions`, { headers: { origin: 'https://evil.example', 'content-type': 'application/json', 'x-studio-csrf': csrf }, data: body })).status()).toBeGreaterThanOrEqual(400);
    expect((await request.post(`/api/v1/review/${id}/actions`, { headers: H, data: body })).status()).toBeGreaterThanOrEqual(400);
    expect(await snapshot(request, id)).toEqual(before);
    used.delete(id);
  });

  test('the merge policy: with no rule requiring pull requests an approval is not sent, a comment still is, and the screen says why', async ({ page, request }) => {
    const id = await pick(request, ['approve-alternative', 'comment']);
    const opts = (await optionsOf(request, id)).options;
    const opt = (opts.find((o) => !o.recommended) ?? opts[0]!).key;
    const before = await snapshot(request, id);
    await ctl(request, 'setRules', []);
    try {
      const st = (await (await request.get('/api/v1/sync/status')).json()) as { mergePolicy: { state: string; detail: string } };
      expect(st.mergePolicy.state).toBe('absent');
      const refused = await act(request, csrf, id, { action: 'approve-alternative', optionKey: opt, rationale: 'Approving while the branch is open.' });
      expect(refused.r.status()).toBe(409);
      expect(refused.body.code).toBe('merge-policy-absent');
      expect(await snapshot(request, id), 'nothing was sent').toEqual(before);
      await page.goto('/');
      await page.getByRole('button', { name: /Repository sync status/ }).click();
      await expect(page.getByTestId('merge-policy')).toHaveAttribute('data-state', 'absent');
      await expect(page.getByTestId('merge-policy')).toContainText('approvals are not sent');
      const c = await act(request, csrf, id, { action: 'comment', comment: 'A note is still fine.' });
      expect(c.r.status(), 'a comment changes no status and is allowed').toBe(200);
      // Finish that comment so the decision is free again.
      const pr = (await prsFor(request, id))[0]!;
      await ctl(request, 'merge', pr.number);
      await sync(request, csrf, c.body.proposal!.id);
    } finally {
      await ctl(request, 'setRules', [{ type: 'pull_request', parameters: {} }, { type: 'non_fast_forward' }, { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'validate' }, { context: 'gate' }] } }]);
    }
    const ok = await act(request, csrf, id, { action: 'approve-alternative', optionKey: opt, rationale: 'Now that the branch is protected again.' });
    expect(ok.r.status(), JSON.stringify(ok.body)).toBe(200);
    const st = (await (await request.get('/api/v1/sync/status')).json()) as { mergePolicy: { state: string } };
    expect(st.mergePolicy.state).toBe('enforced');
    await page.goto('/');
    await page.getByRole('button', { name: /Repository sync status/ }).click();
    await expect(page.getByTestId('merge-policy')).toContainText('Enforced by GitHub');
    // leave the decision free for later tests
    const pr = (await prsFor(request, id)).find((p) => !p.merged && !p.closed)!;
    await ctl(request, 'close', pr.number);
    await sync(request, csrf, ok.body.proposal!.id);
  });

  test('a merge policy that cannot be read is shown as unknown and does not by itself stop a decision', async ({ request }) => {
    const id = await pick(request, ['request-revision']);
    await ctl(request, 'setRules', 'error');
    try {
      const st = (await (await request.get('/api/v1/sync/status')).json()) as { mergePolicy: { state: string } };
      expect(st.mergePolicy.state).toBe('unknown');
      const { r, body } = await act(request, csrf, id, { action: 'request-revision', rationale: 'Revision requested while the rules endpoint is down.' });
      expect(r.status(), JSON.stringify(body)).toBe(200);
      const pr = (await prsFor(request, id))[0]!;
      await ctl(request, 'close', pr.number);
      await sync(request, csrf, body.proposal!.id);
    } finally {
      await ctl(request, 'setRules', [{ type: 'pull_request', parameters: {} }, { type: 'non_fast_forward' }, { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'validate' }, { context: 'gate' }] } }]);
    }
  });
});

test.describe('duplicates, conflicts and failures reconcile', () => {
  test('duplicate submission: the same key, sent twice and sent together, opens one pull request and lands one record', async ({ page, request }) => {
    const id = await pick(request, ['request-revision']);
    const rv = (await reviewOf(request, id)).view.revision;
    const body = { action: 'request-revision', rationale: 'Please add the cost model.', expectedRevision: rv, idempotencyKey: 'dup-recon-key-123456' };
    const send = () => request.post(`/api/v1/review/${id}/actions`, { headers: { ...H, 'x-studio-csrf': csrf }, data: body });
    const [a, b] = await Promise.all([send(), send()]);
    const again = await send();
    const ids = new Set<string>();
    for (const r of [a, b, again]) {
      expect(r.status()).toBe(200);
      ids.add(((await r.json()) as { proposal: { id: string } }).proposal.id);
    }
    expect(ids.size, 'one proposal').toBe(1);
    expect((await prsFor(request, id)).length, 'one pull request').toBe(1);
    const pr = (await prsFor(request, id))[0]!;
    await ctl(request, 'setChecks', pr.headSha, [{ name: 'validate', status: 'completed', conclusion: 'success' }]);
    await ctl(request, 'merge', pr.number);
    await sync(request, csrf, [...ids][0]!);
    await sync(request, csrf, [...ids][0]!);
    await reconcile(page, request, id, { action: 'request-revision', status: 'Pending Review', count: 1, text: 'Please add the cost model.' });
  });

  test('conflict: GitHub moved while the person was reviewing. Their decision is preserved, shown against the current state, and not sent until reconciled', async ({ page, request }) => {
    const id = await pick(request, ['reject', 'comment']);
    const seen = (await reviewOf(request, id)).view.revision; // what the person was looking at
    // A colleague's comment lands first.
    const c = await act(request, csrf, id, { action: 'comment', comment: 'A colleague added context first.' });
    const pr = (await prsFor(request, id))[0]!;
    await ctl(request, 'merge', pr.number);
    await sync(request, csrf, c.body.proposal!.id);
    const writes = (await fake(request)).refWrites.length;
    const mine = { action: 'reject', rationale: 'Rejected on what I read earlier.', expectedRevision: seen, idempotencyKey: 'conflict-recon-key-123' };
    const r = await request.post(`/api/v1/review/${id}/actions`, { headers: { ...H, 'x-studio-csrf': csrf }, data: mine });
    const res = (await r.json()) as { code: string; conflict: { kind: string; current: { lastEvent: { action: string } | null; canonicalCommit: string | null }; proposed: { action: string; rationale: string } } };
    expect(r.status()).toBe(409);
    expect(res.code).toBe('stale-revision');
    expect(res.conflict.proposed, 'my proposed decision is preserved').toMatchObject({ action: 'reject', rationale: 'Rejected on what I read earlier.' });
    expect(res.conflict.current.lastEvent?.action, 'the conflicting change is shown').toBe('comment');
    expect(res.conflict.current.canonicalCommit).toBe(bare('rev-parse', 'refs/heads/main'));
    expect((await fake(request)).refWrites.length, 'nothing was written').toBe(writes);
    expect(github(id).events.map((e) => e.action), 'GitHub holds only the colleague’s record').toEqual(['comment']);
    expect((await reviewOf(request, id)).audit.some((a) => a.outcome === 'stale' && a.action === 'reject')).toBe(true);
    // Reconciled: the same words, against the current revision, now go through.
    await decide(page, request, csrf, id, { action: 'reject', rationale: 'Rejected on what I read earlier.' });
    await reconcile(page, request, id, { action: 'reject', status: 'Rejected', count: 2, text: 'Rejected on what I read earlier.' });
  });

  test('a failed GitHub write: no false success, nothing changes, and sending again completes it once', async ({ page, request }) => {
    const id = await pick(request, ['request-revision']);
    const prsBefore = (await fake(request)).pulls.length;
    await ctl(request, 'clearFaults');
    await ctl(request, 'dropNext', 400);
    const { r, body } = await act(request, csrf, id, { action: 'request-revision', rationale: 'Revision requested during an outage.' });
    expect(r.status(), JSON.stringify(body)).toBe(200);
    expect(body.proposal!.state).toBe('awaiting-github-update');
    expect(body.proposal!.lastError?.message).toMatch(/Could not reach GitHub/);
    expect((await fake(request)).pulls.length, 'no pull request exists').toBe(prsBefore);
    expect(github(id).events.length).toBe(0);
    await page.goto(`/decisions/${id}/review`);
    await expect(page.getByTestId('proposal-tracker')).toHaveAttribute('data-state', 'awaiting-github-update');
    await expect(page.getByTestId('timeline')).not.toContainText('Revision requested during an outage.');
    await ctl(request, 'clearFaults');
    const done = await sync(request, csrf, body.proposal!.id);
    expect(done.state).toBe('pull-request-created');
    expect((await prsFor(request, id)).length, 'exactly one pull request after the retry').toBe(1);
    const pr = (await prsFor(request, id))[0]!;
    await ctl(request, 'merge', pr.number);
    await sync(request, csrf, body.proposal!.id);
    await reconcile(page, request, id, { action: 'request-revision', status: 'Pending Review', count: 1, text: 'Revision requested during an outage.' });
  });

  test('GitHub rate limiting, long: reported with when to retry, nothing claimed, and the retry completes it', async ({ page, request }) => {
    const id = await pick(request, ['request-revision']);
    const prsBefore = (await fake(request)).pulls.length;
    await ctl(request, 'rateLimitNext', 2, { status: 429, retryAfter: 120 }); // one for the merge-policy read, one for the write
    const { r, body } = await act(request, csrf, id, { action: 'request-revision', rationale: 'Revision requested while GitHub was rate limiting.' });
    expect(r.status(), JSON.stringify(body)).toBe(200);
    expect(body.proposal!.state).toBe('awaiting-github-update');
    expect(body.proposal!.lastError?.message).toMatch(/rate limiting.*120 seconds/i);
    expect((await fake(request)).pulls.length).toBe(prsBefore);
    expect(github(id).events.length).toBe(0);
    await page.goto(`/decisions/${id}/review`);
    await expect(page.getByTestId('proposal-tracker')).toContainText(/rate limiting/i);
    await expect(page.getByTestId('timeline')).not.toContainText('Revision requested while GitHub was rate limiting.');
    const done = await sync(request, csrf, body.proposal!.id);
    expect(done.state).toBe('pull-request-created');
    const pr = (await prsFor(request, id))[0]!;
    await ctl(request, 'merge', pr.number);
    await sync(request, csrf, body.proposal!.id);
    await reconcile(page, request, id, { action: 'request-revision', status: 'Pending Review', count: 1, text: 'Revision requested while GitHub was rate limiting.' });
  });

  test('GitHub rate limiting, short: the Studio waits it out and the decision goes through without a failure', async ({ page, request }) => {
    const id = await pick(request, ['request-revision']);
    await ctl(request, 'rateLimitNext', 1, { status: 429, retryAfter: 1 });
    const { r, body } = await act(request, csrf, id, { action: 'request-revision', rationale: 'Revision requested after a one second pause.' });
    expect(r.status(), JSON.stringify(body)).toBe(200);
    expect(body.proposal!.state).toBe('pull-request-created');
    const pr = (await prsFor(request, id))[0]!;
    await ctl(request, 'merge', pr.number);
    await sync(request, csrf, body.proposal!.id);
    await reconcile(page, request, id, { action: 'request-revision', status: 'Pending Review', count: 1, text: 'Revision requested after a one second pause.' });
  });

  test('a pull request closed without merging: the screen and GitHub both say nothing was decided', async ({ page, request }) => {
    const id = await pick(request, ['reject']);
    const { body } = await act(request, csrf, id, { action: 'reject', rationale: 'Rejected, then the pull request was closed.' });
    const pr = (await prsFor(request, id))[0]!;
    await ctl(request, 'close', pr.number);
    const p = await sync(request, csrf, body.proposal!.id);
    expect(p.state).toBe('failed');
    expect(github(id).events.length).toBe(0);
    await page.goto(`/decisions/${id}/review`);
    await expect(page.getByTestId('review-status')).not.toContainText('Rejected');
    await expect(page.getByTestId('timeline')).not.toContainText('Rejected, then the pull request was closed.');
  });
});

test.describe('forged approvals never become approvals', () => {
  // The refresh rebuilds the model after a push; a connection reset while it does is retried once.
  const refresh = async (request: APIRequestContext) => {
    try {
      return await request.post('/api/v1/refresh', { headers: H, data: {} });
    } catch {
      return request.post('/api/v1/refresh', { headers: H, data: {} });
    }
  };
  const decisionOf = async (request: APIRequestContext, id: string) => ((await (await request.get(`/api/v1/decisions/${id}`)).json()) as { decision: { status: string; approvalBasis: string; flags: { code: string }[]; review: unknown } }).decision;

  test('hand-written records on main, one with a hash that matches its content and a real approver’s name, are ignored and reported', async ({ page, request }) => {
    const target = 'ADR-0046';
    // A genuine record, taken from a decision that really was approved through the Studio, repointed at another decision.
    const genuine = JSON.parse(bare('show', `refs/heads/main:${github(approvedId).files[0]}`)) as Record<string, unknown>;
    const files: Record<string, string> = {};
    const crude = { ...genuine, decisionId: target, id: `DR-${target}-0001`, seq: 1, prevHash: null, eventHash: 'a'.repeat(64), signature: { keyId: 'forged', sig: 'b'.repeat(64) } };
    files[`docs/decision-reviews/${target}/0001-approve.json`] = `${JSON.stringify(crude, null, 2)}\n`;
    pushToMain(files, 'a hand-written approval record');
    await refresh(request);
    let d = await decisionOf(request, target);
    expect(d.status, 'a crude forgery approves nothing').not.toBe('Approved');
    let v = (await reviewOf(request, target)).view.canonical.state;
    expect(v.problems.length, 'and is reported').toBeGreaterThan(0);

    // Subtler: the content hash is recomputed so the record is internally consistent, naming the real owner, but the signature is the
    // one made for a different record. Only the server's key can sign, so this must fail.
    const { eventHash: _h, signature: _s, ...body } = { ...genuine, decisionId: target, id: `DR-${target}-0001`, seq: 1, prevHash: null } as Record<string, unknown>;
    void _h;
    void _s;
    const rehashed = { ...body, eventHash: hashEvent(body as never), signature: genuine.signature };
    pushToMain({ [`docs/decision-reviews/${target}/0001-approve.json`]: `${JSON.stringify(rehashed, null, 2)}\n` }, 'a record with a recomputed hash and a borrowed signature');
    await refresh(request);
    d = await decisionOf(request, target);
    expect(d.status, 'a forged record under the owner’s name approves nothing').not.toBe('Approved');
    v = (await reviewOf(request, target)).view.canonical.state;
    expect(v.problems.join(' '), 'the signature failure is named').toMatch(/signature|trust|enrol/i);
    expect(v.effectiveStatus).toBeNull();
    await page.goto(`/decisions/${target}/review`);
    await expect(page.getByTestId('review-status')).not.toContainText('Approved');
    pushToMain({}, 'remove the forged records', [`docs/decision-reviews/${target}/0001-approve.json`]);
    await refresh(request);
  });

  test('Markdown that says “approved by the owner” is shown as a claim in the source, never as a signed approval or a review record', async ({ request }) => {
    const id = 'ADR-0047';
    const adrPath = bare('ls-tree', '-r', '--name-only', 'refs/heads/main', 'docs/adr/').split('\n').find((p) => p.includes(`/${id.slice(4)}-`))!;
    const original = bare('show', `refs/heads/main:${adrPath}`);
    const claimed = original.replace(/^- \*\*Status:\*\*.*$/m, '- **Status:** Accepted (2026-11-03, programme owner, approved by the AI agent on the owner’s behalf)');
    expect(claimed).not.toBe(original);
    pushToMain({ [adrPath]: claimed }, 'markdown that claims an approval');
    await refresh(request);
    const d = await decisionOf(request, id);
    expect(d.approvalBasis, 'not a signed approval').not.toBe('signed');
    expect(d.approvalBasis, 'not a review record either').not.toBe('review-record');
    expect(d.flags.map((f) => f.code).join(',')).toMatch(/approved-by-text-only|unsigned/);
    const v = (await reviewOf(request, id)).view;
    expect(v.canonical.state.effectiveStatus, 'the review chain holds no approval').toBeNull();
    expect(github(id).events.length).toBe(0);
    pushToMain({ [adrPath]: original }, 'restore the source');
    await refresh(request);
  });
});

test.describe('the history shows who, when, why and the GitHub commit', () => {
  test('every record on the page names its author, date, reason and the commit on GitHub, and the links are real', async ({ page, request }) => {
    await page.goto(`/decisions/${approvedId}/review`);
    await expect(page.getByTestId('carried-by').first()).toBeVisible();
    const entries = page.getByTestId('timeline').locator('li').filter({ has: page.getByTestId('carried-by') });
    expect(await entries.count()).toBeGreaterThanOrEqual(2);
    const gh = github(approvedId);
    for (const e of gh.events) {
      const sha = bare('log', '-1', '--format=%H', 'refs/heads/main', '--', gh.files[e.seq - 1]!);
      const li = entries.filter({ hasText: sha.slice(0, 7) });
      await expect(li, `seq ${e.seq}`).toHaveCount(1);
      await expect(li).toContainText(`@${e.actor.login}`);
      await expect(li).toContainText(e.createdAt.slice(0, 10).replace(/^(\d{4})-(\d\d)-(\d\d)$/, '$1'));
      if (e.rationale) await expect(li).toContainText(e.rationale.slice(0, 40));
    }
    const logins = await page.getByTestId('timeline').getByTestId('carried-by').locator('a[href*="/commit/"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    for (const h of logins) expect(h).toMatch(/\/commit\/[0-9a-f]{40}$/);
  });
});
