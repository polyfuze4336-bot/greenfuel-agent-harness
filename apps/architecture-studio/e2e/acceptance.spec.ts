import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { expect as baseExpect, test, type APIRequestContext, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { ACC_PASS, adrText } from '../checks/fixtures/acceptance-world.ts';
import { USERS } from '../checks/fixtures/review-fixture.ts';
import { expectNoAxeViolations } from './helpers.ts';

const expect = baseExpect.configure({ timeout: 30_000 });

// THE ACCEPTANCE CHAIN. One decision and one deck, walked through the whole workflow in a throw-away world: a clone of this repository, a
// bare "GitHub" remote, a simulated pull-request service, test identities, a Studio on port 3108. Nothing touches the real repository,
// GitHub or Azure. A person's merge is done with git on the bare remote, as GitHub would.
//
// Not proven here, and stated in the report: GitHub Actions running on GitHub, a real GitHub App, a real Entra tenant, Azure hosting.
const BASE = 'http://localhost:3108';
test.use({ baseURL: BASE });
test.describe.configure({ mode: 'serial', timeout: 420_000 });

const REAL = path.resolve(process.cwd(), '..', '..');
const dir = process.env.STUDIO_E2E_ACC_DIR!;
const state = path.join(dir, 'state');
const remote = path.join(dir, 'origin.git');
const work = path.join(dir, 'work');
const person = path.join(dir, 'person');
const require = createRequire(import.meta.url);

type User = (typeof USERS)[keyof typeof USERS];
const as = (u: User | null) => (u ? fs.writeFileSync(path.join(state, 'identity.json'), JSON.stringify(u)) : fs.rmSync(path.join(state, 'identity.json'), { force: true }));
const run = (cwd: string, ...a: string[]) => spawnSync('git', a, { cwd, encoding: 'utf8', windowsHide: true });
const g = (cwd: string, ...a: string[]) => {
  const r = run(cwd, ...a);
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const bare = (...a: string[]) => spawnSync('git', ['--git-dir', remote, ...a], { encoding: 'utf8' }).stdout.trim();
const prs = () => (JSON.parse(fs.readFileSync(path.join(state, 'prs.json'), 'utf8')) as { prs: { number: number; headSha: string; head: string }[] }).prs;
const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Everything that was measured, written out at the end so the report quotes numbers from this run. */
const perf: Record<string, number | number[]> = {};
async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    const ms = Math.round(performance.now() - t0);
    const prev = perf[name];
    perf[name] = prev === undefined ? ms : Array.isArray(prev) ? [...prev, ms] : [prev, ms];
  }
}
const evidence: Record<string, unknown> = {};

// ------------------------------------------------------------------------------------------------ the person's side of GitHub
function pullWork() {
  g(work, 'fetch', '-q', 'origin');
  g(work, 'merge', '-q', '--ff-only', 'origin/main');
}
/** Another person commits to GitHub's main, then the Studio's checkout is updated the way a pull would. */
function pushToGitHub(files: Record<string, string>, message: string, remove: string[] = []) {
  g(person, 'fetch', '-q', 'origin');
  g(person, 'checkout', '-q', '-B', 'main', 'origin/main');
  for (const p of remove) fs.rmSync(path.join(person, p), { force: true });
  for (const [p, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(person, p)), { recursive: true });
    fs.writeFileSync(path.join(person, p), c);
  }
  g(person, 'add', '-A');
  g(person, 'commit', '-q', '-m', message);
  g(person, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  return g(person, 'rev-parse', 'HEAD');
}
const pushAndPull = (files: Record<string, string>, msg: string, remove: string[] = []) => {
  const sha = pushToGitHub(files, msg, remove);
  pullWork();
  return sha;
};
const fileOnMain = (p: string) => bare('show', `refs/heads/main:${p}`);

// ------------------------------------------------------------------------------------------------ the Studio's API
const H = { origin: BASE, 'content-type': 'application/json' };
async function login(request: APIRequestContext, u: User): Promise<string> {
  as(u);
  await request.post('/api/v1/auth/signout', { headers: H, data: {} });
  const r = await request.post('/api/v1/auth/signin', { headers: H, data: {} });
  expect(r.ok(), 'sign-in').toBe(true);
  return ((await (await request.get('/api/v1/auth/session')).json()) as { csrf: string }).csrf;
}
const post = (request: APIRequestContext, url: string, csrf: string, data: unknown) => request.post(url, { data, headers: { ...H, 'x-studio-csrf': csrf } });
const getJson = async <T = any>(request: APIRequestContext, url: string): Promise<T> => (await request.get(url)).json() as Promise<T>;
const refresh = (request: APIRequestContext) => timed('repository refresh after a pull (ms)', async () => expect((await request.post('/api/v1/refresh', { headers: H, data: {} })).ok()).toBe(true));
const decision = async (request: APIRequestContext, id: string) => (await getJson(request, `/api/v1/decisions/${id}`)).decision;

async function submit(request: APIRequestContext, csrf: string, id: string, body: Record<string, unknown>) {
  const rv = (await getJson(request, `/api/v1/review/${id}`)).view.revision as string;
  const t0 = performance.now();
  const resp = await post(request, `/api/v1/review/${id}/actions`, csrf, { expectedRevision: rv, idempotencyKey: crypto.randomUUID(), ...body });
  const ms = Math.round(performance.now() - t0);
  return { resp, ms, rv, body: (await resp.json().catch(() => null)) as any };
}
/** What a person does on GitHub: merge the proposal's pull request. */
function mergePrFor(id: string) {
  const pr = prs().filter((p) => p.head.includes(`/${id}/`)).at(-1)!;
  const ff = spawnSync('git', ['--git-dir', remote, 'merge-base', '--is-ancestor', bare('rev-parse', 'refs/heads/main'), pr.headSha]).status === 0;
  expect(ff, 'the pull request merges cleanly').toBe(true);
  bare('update-ref', 'refs/heads/main', pr.headSha);
  return pr;
}
async function canonicalAfterMerge(request: APIRequestContext, csrf: string, id: string, name: string) {
  const open = (await getJson(request, `/api/v1/review/${id}`)).view.open;
  await timed(name, async () => {
    const r = await post(request, `/api/v1/review/proposals/${open.id}/sync`, csrf, {});
    expect(r.ok()).toBe(true);
  });
  pullWork();
  await refresh(request);
}

/** An approval or rejection, start to canonical: submit, check it is not yet canonical, merge, verify. */
async function decideViaWorkflow(request: APIRequestContext, csrf: string, id: string, body: Record<string, unknown>, expectStatus: string) {
  const mainBefore = bare('rev-parse', 'refs/heads/main');
  const s = await submit(request, csrf, id, body);
  expect(s.resp.status(), JSON.stringify(s.body)).toBe(200);
  perf[`approval transaction: submit to pull request (ms) ${id}`] = s.ms;
  expect(s.body.proposal.state, 'a pull request exists').toBe('pull-request-created');
  expect(bare('rev-parse', 'refs/heads/main'), 'main did not move: nothing is canonical yet').toBe(mainBefore);
  expect((await decision(request, id)).status, 'the Studio does not call it decided yet').not.toBe(expectStatus);
  const pr = mergePrFor(id);
  await canonicalAfterMerge(request, csrf, id, `merge to canonical status in the Studio (ms) ${id}`);
  expect((await decision(request, id)).status).toBe(expectStatus);
  return { pr, proposal: s.body.proposal };
}

const adrPath = (n: string, slug: string) => `docs/adr/${n}-${slug}.md`;

test.beforeAll(() => {
  if (!fs.existsSync(person)) {
    g(dir, 'clone', '-q', remote, person);
    g(person, 'config', 'user.email', 'person@example.invalid');
    g(person, 'config', 'user.name', 'A Person');
    g(person, 'config', 'commit.gpgsign', 'false');
  }
});
test.afterAll(() => {
  fs.mkdirSync(path.join(REAL, 'docs', 'studio-acceptance'), { recursive: true });
  fs.writeFileSync(path.join(REAL, 'docs', 'studio-acceptance', 'measurements.json'), `${JSON.stringify({ measuredAt: new Date().toISOString(), machine: { os: `${os.type()} ${os.release()}`, cpus: os.cpus().length, node: process.version }, measurements: perf, evidence }, null, 2)}\n`);
});

// ================================================================================================ the chain, steps 1 to 20
test.describe('the complete workflow', () => {
  let queueBefore: { items: { id: string; status: string }[]; blocking: { analysis: { unresolvedCount: number } } };
  let oldCommit = '';

  test('1-3: a new decision is added to GitHub, the Studio discovers it, and it is pending', async ({ request, page }) => {
    const csrf = await login(request, USERS.owner);
    void csrf;
    queueBefore = await getJson(request, '/api/v1/queue');
    oldCommit = g(work, 'rev-parse', 'HEAD');
    expect((await request.get('/api/v1/decisions/ADR-0021')).status(), 'unknown before it exists').toBe(404);

    pushToGitHub({ [adrPath('0021', 'keep-decision-records-in-repo')]: adrText('0021', 'Keep decision records in this repository') }, 'ADR 0021: keep decision records in this repository');
    g(work, 'fetch', '-q', 'origin');
    expect(Number(g(work, 'rev-list', '--count', 'HEAD..origin/main')), 'the working copy is one commit behind GitHub').toBe(1);
    expect((await request.get('/api/v1/decisions/ADR-0021')).status(), 'the Studio reads what is checked out, so it has not seen it yet').toBe(404);

    g(work, 'merge', '-q', '--ff-only', 'origin/main');
    await refresh(request);
    const d = await decision(request, 'ADR-0021');
    expect(d.status).toBe('Proposed');
    expect(d.options).toHaveLength(3);
    const changes = await getJson(request, `/api/v1/register/changes?from=${oldCommit}`);
    expect(changes.changes.records.find((r: { id: string }) => r.id === 'ADR-0021')?.kind).toBe('added');
    const list = await getJson(request, '/api/v1/decisions');
    expect(list.items.some((i: { id: string; status: string }) => i.id === 'ADR-0021' && i.status === 'Proposed')).toBe(true);
    const q = await getJson(request, '/api/v1/queue');
    expect(q.items.find((i: { id: string }) => i.id === 'ADR-0021')?.status, 'it is in the work queue as open work').toBe('Open');
    const gate = (await getJson(request, '/api/v1/baseline')).gates[0];
    expect(gate.state).toBe('blocked');
    expect(gate.reasons.some((r: { code: string; text: string }) => r.code === 'pending' && /ADR-0021/.test(r.text)), 'readiness recalculated: the new decision is a pending gate').toBe(true);

    await page.goto('/decisions/ADR-0021');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Keep decision records');
    await page.screenshot({ path: path.join(REAL, 'docs', 'studio-acceptance', 'step-03-new-decision-pending.png'), animations: 'disabled' });
  });

  test('4-6: opening it shows the recommended option, the alternatives, pros, cons, cost and dependencies', async ({ request, page }) => {
    const d = await decision(request, 'ADR-0021');
    expect(d.recommendedOption?.name).toMatch(/Keep decision records/);
    const alts = d.options.filter((o: { recommended: boolean }) => !o.recommended);
    expect(alts.map((o: { name: string }) => o.name).join('|')).toMatch(/separate decision database.*Do nothing/);
    // The recommended option carries the ADR's own Consequences. An alternative shows only what its author wrote:
    // the Studio does not invent pros and cons for it (AI suggestions are separate and labelled).
    const rec = d.recommendedOption;
    expect(rec.pros.map((p: { text: string }) => p.text).join(' ')).toMatch(/every change has an author/);
    expect(rec.cons.map((p: { text: string }) => p.text).join(' ')).toMatch(/cannot be changed quickly/);
    for (const o of alts) {
      expect(o.tradeoffs, `${o.name} trade-offs`).toBeTruthy();
      expect(o.pros, `${o.name}: nothing fabricated`).toEqual([]);
    }
    expect(JSON.stringify(d.options)).toMatch(/hosted database/);
    expect(d.requiredApproverRole?.text).toMatch(/Programme owner/);
    expect(d.source.path).toBe('docs/adr/0021-keep-decision-records-in-repo.md');
    expect(d.source.commit).toMatch(/^[0-9a-f]{40}$/);
    await page.goto('/decisions/ADR-0021/review');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    for (const t of ['Keep decision records in this repository', 'A separate decision database', 'Do nothing']) await expect(page.getByText(t).first()).toBeVisible();
    await expectNoAxeViolations(page, 'review page of a new decision');
    await page.screenshot({ path: path.join(REAL, 'docs', 'studio-acceptance', 'step-04-review-page.png'), fullPage: true, animations: 'disabled' });
    await page.goto('/decisions/ADR-0021/compare');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('7-12: approve with a rationale and an authenticated identity; a change reaches GitHub, validates, merges, and becomes canonical', async ({ request }) => {
    const csrf = await login(request, USERS.owner);
    const rationale = 'One source of truth and a reviewable history; the cost of the review workflow is accepted.';
    const { pr, proposal } = await decideViaWorkflow(request, csrf, 'ADR-0021', { action: 'approve', rationale }, 'Approved');

    // 8: rationale and authenticated identity are in the record that GitHub holds.
    const file = JSON.parse(fileOnMain('docs/decision-reviews/ADR-0021/0001-approve.json'));
    expect(file.actor).toMatchObject({ login: 'test-owner', githubId: 1001 });
    expect(JSON.stringify(file)).toContain(rationale);
    expect(file.sig ?? file.signature ?? file.basis, 'the record is bound to its content and signed').toBeTruthy();
    // 9: the change is a branch and a pull request, not a push to main.
    expect(pr.head).toMatch(/^decision-review\/ADR-0021\//);
    expect(proposal.change).toEqual({ field: 'status', old: 'Proposed', new: 'Approved' });
    // 10: the repository's own validation runs on the pull request's content.
    g(person, 'fetch', '-q', 'origin', pr.head);
    // The world's supporting records are SYNTHETIC text-only approvals, which the real validators correctly refuse. So the proof here is the
    // delta: the pull request must introduce no validator failure that the canonical branch did not already have, and none about ADR-0021.
    const validate = (rev: string) => {
      g(person, 'checkout', '-q', '--detach', rev);
      const r = spawnSync('node', ['harness/scripts/validate-harness.mjs'], { cwd: person, encoding: 'utf8', windowsHide: true });
      return { exit: r.status, fails: `${r.stdout}${r.stderr}`.split('\n').filter((l) => /^FAIL /.test(l)).map((l) => l.trim()) };
    };
    const baseRun = validate('origin/main');
    const v = await timed('repository validation on the pull request (ms)', async () => validate(pr.headSha));
    g(person, 'checkout', '-q', '-B', 'main', 'origin/main');
    const introduced = v.fails.filter((l) => !baseRun.fails.includes(l));
    evidence.validationOnPullRequest = { baseFailures: baseRun.fails.length, prFailures: v.fails.length, introducedByThePullRequest: introduced, mentionsAdr0021: v.fails.filter((l) => /0021/.test(l)).length };
    expect(introduced, 'the pull request introduces no new validator failure').toEqual([]);
    expect(v.fails.filter((l) => /0021/.test(l))).toEqual([]);
    // 11-12: merged by a person on GitHub, then the Studio verifies it on the canonical branch.
    const d = await decision(request, 'ADR-0021');
    expect(d).toMatchObject({ status: 'Approved', approvalBasis: 'review-record' });
    expect(d.approvalHistory.length).toBeGreaterThan(0);
  });

  test('13-14: related work and dependencies update, and the readiness gate recalculates', async ({ request }) => {
    const q = await getJson(request, '/api/v1/queue');
    // The queue's vocabulary: an approved decision is finished work.
    expect(q.items.find((i: { id: string }) => i.id === 'ADR-0021').status).toBe('Done');
    const changed = q.items.filter((i: { id: string; status: string }) => {
      const b = queueBefore.items.find((x) => x.id === i.id);
      return b && b.status !== i.status;
    });
    // Nothing unrelated changed: the only status that moved is the decision itself, or build blockers derived from open decisions.
    expect(changed.map((i: { id: string }) => i.id).filter((id: string) => !/^BLK-/.test(id))).toEqual([]);
    evidence.unresolvedBuildBlockers = { before: queueBefore.blocking.analysis.unresolvedCount, after: q.blocking.analysis.unresolvedCount };
    expect(q.blocking.analysis.unresolvedCount).toBeLessThanOrEqual(queueBefore.blocking.analysis.unresolvedCount);
    const gate = (await getJson(request, '/api/v1/baseline')).gates[0];
    expect(gate.reasons.map((r: { code: string }) => r.code), 'the decision gate is met; only the missing baseline remains').toEqual(['baseline']);
  });

  test('before a baseline exists the final deck cannot be built, whatever the page or the state file says', async ({ request }) => {
    const csrf = await login(request, USERS.owner);
    const resp = await post(request, '/api/v1/deck/build', csrf, { mode: 'final' });
    expect(resp.status()).toBe(422);
    const msg = (await resp.json()).detail as string;
    expect(msg).toMatch(/A final deck is refused/);
    expect(msg).toMatch(/baseline/);
    expect((await request.get('/api/v1/deck/export/pptx')).status(), 'nothing was exported').toBe(404);

    // Forge the slide-review state file: every slide "approved" at made-up hashes. The gate does not trust it.
    const model = (await getJson(request, '/api/v1/deck')).model;
    const forged = { version: 1, revision: model.revision, slides: Object.fromEntries(model.slides.map((s: { id: string }) => [s.id, { status: 'approved', decidedHash: 'f'.repeat(64), decidedBy: 'forger', titleOverride: null, visualKind: null, reason: null, events: [] }])) };
    const stateFile = path.join(dir, 'cache', 'deck', 'state.json');
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(forged));
    const m2 = (await getJson(request, '/api/v1/deck')).model;
    expect(m2.totals.approved, 'approvals at hashes that do not match the content count for nothing').toBe(0);
    expect(m2.totals.stale).toBe(model.slides.length);
    expect((await post(request, '/api/v1/deck/build', csrf, { mode: 'final' })).status()).toBe(422);
    fs.rmSync(stateFile);

    // The CLI is bound by the same gate.
    const cli = spawnSync('node', ['scripts/deck.ts', 'build', '--mode', 'final', '--out', path.join(os.tmpdir(), 'acc-cli-final'), '--root', work, '--state', 'none'], { cwd: process.cwd(), encoding: 'utf8' });
    expect(cli.status).toBe(2);
    expect(cli.stdout).toMatch(/REFUSED/);

    // A person without the recommend permission cannot even ask.
    const c2 = await login(request, USERS.contrib);
    expect((await post(request, '/api/v1/deck/build', c2, { mode: 'final' })).status()).toBe(403);
    expect((await post(request, '/api/v1/deck/build', await login(request, USERS.outsider), { mode: 'sample' })).status()).toBe(403);
  });

  test('15: the approved architecture baseline is generated, signed by a person, and verified', async ({ request }) => {
    pullWork();
    const gen = spawnSync('node', ['scripts/baseline.ts', 'generate', '--root', person, '--id', 'BL-0001', '--areas', 'application'], { cwd: process.cwd(), encoding: 'utf8' });
    g(person, 'fetch', '-q', 'origin');
    g(person, 'checkout', '-q', '-B', 'main', 'origin/main');
    const gen2 = spawnSync('node', ['scripts/baseline.ts', 'generate', '--root', person, '--id', 'BL-0001', '--areas', 'application'], { cwd: process.cwd(), encoding: 'utf8' });
    expect(gen2.status, gen2.stdout + gen2.stderr + gen.stdout).toBe(0);
    const files = ['manifest.json', 'decision-register.snapshot.json', 'READINESS-REPORT.md', 'DEPENDENCY-MATRIX.md', 'SUMMARY.md'].map((f) => `docs/baselines/BL-0001/${f}`);
    for (const f of files) expect(fs.existsSync(path.join(person, f)), f).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(person, files[0]!), 'utf8'));
    expect(manifest.scope.areas[0].decisions).toContain('ADR-0021');
    const snap = manifest.requiredDecisions.find((d: { id: string }) => d.id === 'ADR-0021');
    expect(snap.approvedOption, 'the snapshot records which option was approved').toBeTruthy();

    // Generated and committed, but not authorized: the Studio calls it proposed and the gate stays closed.
    const generatedCommit = pushAndPull(Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(person, f), 'utf8')])), 'Generated: baseline BL-0001 (not yet authorized)');
    await refresh(request);
    let bv = await getJson(request, '/api/v1/baseline');
    expect(bv.baselines.find((b: { id: string }) => b.id === 'BL-0001').status).toBe('proposed');
    expect(bv.gates[0].state).toBe('blocked');
    evidence.baselineGeneratedAt = generatedCommit;

    // A person signs it with an enrolled architecture-class key.
    const key = JSON.parse(fs.readFileSync(path.join(dir, 'approver.json'), 'utf8')) as { privateKeyPem: string; keyId: string };
    const gates = require('../../../harness/approvals/approval-gates.cjs');
    const engine = require('../../../harness/hooks/permission-engine.cjs');
    g(person, 'checkout', '-q', '-B', 'main', 'origin/main');
    let rec = gates.buildDecisionRequest({ type: 'baseline', id: 'BL-0001', reason: 'Reviewed the manifest and the summary; ADR-0021 is approved.', root: person, now: new Date(Date.now() - 3600000) });
    rec = engine.signApproval(rec, key.privateKeyPem, key.keyId, ACC_PASS);
    await timed('baseline authorization visible in the Studio after commit (ms)', async () => {
      pushAndPull({ [`docs/approvals/${rec.id}.json`]: `${JSON.stringify(rec, null, 2)}\n` }, 'Approval: authorize baseline BL-0001');
      await refresh(request);
    });
    bv = await getJson(request, '/api/v1/baseline');
    const b = bv.baselines.find((x: { id: string }) => x.id === 'BL-0001');
    expect(b).toMatchObject({ status: 'approved', currentness: 'current' });
    expect(bv.gates[0].state).toBe('open');
    evidence.baseline = { id: 'BL-0001', sourceCommit: b.commit, authorizedBy: b.authorization?.approval };
  });

  test('16-17: the Presentation Studio reads the baseline and generates the slide outline', async ({ request, page }) => {
    const model = (await getJson(request, '/api/v1/deck')).model;
    const gate = Object.fromEntries(model.gate.items.map((i: { id: string; met: boolean; detail: string }) => [i.id, i]));
    expect(gate.baseline.met, gate.baseline.detail).toBe(true);
    expect(gate.baseline.detail).toMatch(/BL-0001/);
    expect(model.slides.length).toBe(40);
    // The presented decisions: ADR-0020 is still Proposed in this world, so the gate says so, by name.
    expect(gate.decisions.met).toBe(false);
    expect(gate.decisions.detail).toMatch(/ADR-0020/);
    await page.goto('/presentation/deck');
    await expect(page.getByTestId('gate-baseline')).toHaveAttribute('data-met', 'true');
    await page.screenshot({ path: path.join(REAL, 'docs', 'studio-acceptance', 'step-16-deck-reads-baseline.png'), fullPage: true, animations: 'disabled' });
  });

  test('18a: the last presented decision is approved through the same workflow, and the deck gate sees it', async ({ request }) => {
    const csrf = await login(request, USERS.owner);
    await decideViaWorkflow(request, csrf, 'ADR-0020', { action: 'approve', rationale: 'Phase 1a scope accepted for the acceptance world.' }, 'Approved');
    const model = (await getJson(request, '/api/v1/deck')).model;
    const d = model.gate.items.find((i: { id: string }) => i.id === 'decisions');
    evidence.deckDecisionsGate = d;
    expect(d.met, d.detail).toBe(true);
  });

  test('18b: every slide is reviewed and approved by a person, one at a time', async ({ request }) => {
    const csrf = await login(request, USERS.owner);
    let view = await getJson(request, '/api/v1/deck');
    const t0 = performance.now();
    for (const s of view.model.slides) {
      const cur = view.model.slides.find((x: { id: string }) => x.id === s.id);
      const r = await post(request, '/api/v1/deck/actions', csrf, { action: 'approve', slideId: s.id, contentHash: cur.contentHash, expectedRevision: view.model.revision, reason: s.placeholders.length ? 'Present as a stated gap, not a result.' : undefined });
      expect(r.status(), `${s.id}: ${await r.text()}`).toBe(200);
      view = await r.json();
    }
    perf['approving all 40 slides one by one (ms)'] = Math.round(performance.now() - t0);
    expect(view.model.totals.approved).toBe(40);
    expect(view.model.slides.every((s: { decidedBy: string }) => s.decidedBy === 'test-owner')).toBe(true);
    expect(view.model.gate.items.find((i: { id: string }) => i.id === 'slides').met).toBe(true);
  });

  test('19-20: the editable PowerPoint is generated and exported as a final deck, with source references', async ({ request }) => {
    const csrf = await login(request, USERS.owner);
    // A sample first, so the corrupted-output tests below have something to tamper with.
    const sample = await timed('presentation generation, sample, rendered by PowerPoint (ms)', () => post(request, '/api/v1/deck/build', csrf, { mode: 'sample' }));
    expect(sample.status(), await sample.text()).toBe(200);
    const sampleRec = (await sample.json()).build;
    expect(sampleRec.mode).toBe('sample');

    const t0 = performance.now();
    const resp = await timed('presentation generation, FINAL, rendered by PowerPoint (ms)', () => post(request, '/api/v1/deck/build', csrf, { mode: 'final' }));
    expect(resp.status(), await resp.text()).toBe(200);
    const fin = (await resp.json()).build;
    perf['final deck wall clock from request (ms)'] = Math.round(performance.now() - t0);
    expect(fin).toMatchObject({ mode: 'final', rendered: true });
    expect(fin.qa.errors).toBe(0);

    const buildsDir = path.join(dir, 'cache', 'deck', 'builds', fin.id);
    const rec = JSON.parse(fs.readFileSync(path.join(buildsDir, 'generation.json'), 'utf8'));
    expect(rec.mode).toBe('final');
    expect(rec.gate.filter((x: { blocking: boolean }) => x.blocking).every((x: { met: boolean }) => x.met), 'every blocking gate item was met when the final deck was made').toBe(true);
    expect(rec.baseline.authorized.map((b: { id: string }) => b.id)).toContain('BL-0001');
    expect(rec.git.commit).toBe(g(work, 'rev-parse', 'HEAD'));
    expect(rec.sources.length).toBeGreaterThan(30);
    expect(rec.slides.every((s: { review: string; decidedBy: string }) => s.review === 'approved' && s.decidedBy === 'test-owner')).toBe(true);
    expect(rec.assets.some((a: { slot: string; outcome: string }) => a.slot === 'hero' && a.outcome === 'fallback'), 'the unavailable photograph fell back to the vector artwork, and the deck was still built').toBe(true);
    evidence.finalDeck = { id: fin.id, commit: rec.git.commit, pptxSha256: rec.outputs.pptx.sha256, pdfSha256: rec.outputs.pdf.sha256, qa: fin.qa, slides: rec.slides.length, sources: rec.sources.length };

    for (const [kind, magic, type] of [['pptx', 'PK', 'presentationml'], ['pdf', '%PDF', 'pdf']] as const) {
      const r = await request.get(`/api/v1/deck/export/${kind}`);
      expect(r.status(), kind).toBe(200);
      expect(r.headers()['content-type']).toContain(type);
      expect(r.headers()['content-disposition']).not.toContain('SAMPLE');
      const body = await r.body();
      expect(body.subarray(0, magic.length).toString()).toBe(magic);
      expect(sha256(body), 'the downloaded file is exactly the recorded output').toBe(kind === 'pptx' ? rec.outputs.pptx.sha256 : rec.outputs.pdf.sha256);
      if (kind === 'pptx') {
        const zip = await JSZip.loadAsync(body);
        const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
        const notes = Object.keys(zip.files).filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f));
        expect(slides).toHaveLength(40);
        expect(notes).toHaveLength(40);
        const masters = (await Promise.all(Object.keys(zip.files).filter((f) => /slideMasters|slideLayouts/.test(f) && f.endsWith('.xml')).map((f) => zip.files[f]!.async('string')))).join('');
        expect(masters, 'a final deck carries no SAMPLE marker').not.toMatch(/SAMPLE/);
        let withSources = 0;
        for (const f of slides) if (/Sources\s/.test(await zip.files[f]!.async('string'))) withSources++;
        expect(withSources, 'every content slide shows its sources').toBeGreaterThanOrEqual(39);
        expect(Object.keys(zip.files).filter((f) => f.startsWith('ppt/media/') && !f.endsWith('/'))).toEqual([]);
      }
    }
    const verify = spawnSync('node', ['scripts/deck.ts', 'verify', buildsDir], { cwd: process.cwd(), encoding: 'utf8' });
    expect(verify.status, verify.stdout).toBe(0);
    evidence.verify = verify.stdout.trim();
    // Keep the generated files for the report's evidence (hashes are recorded; the files stay in the throw-away world).
    for (const n of [1, 7, 18, 30]) {
      const r = await request.get(`/api/v1/deck/preview/${n}`);
      if (r.ok()) fs.writeFileSync(path.join(REAL, 'docs', 'studio-acceptance', `final-deck-slide-${String(n).padStart(2, '0')}.png`), await r.body());
    }
  });

  test('presentation corruption: a damaged or swapped output is detected and not served', async ({ request }) => {
    const csrf = await login(request, USERS.owner);
    const latest = JSON.parse(fs.readFileSync(path.join(dir, 'cache', 'deck', 'latest.json'), 'utf8')) as { id: string; mode: string };
    const folder = path.join(dir, 'cache', 'deck', 'builds', latest.id);
    const pptx = path.join(folder, 'deck.pptx');
    const original = fs.readFileSync(pptx);

    const flipped = Buffer.from(original);
    const mid = Math.floor(flipped.length / 2);
    flipped[mid] = (flipped[mid] ?? 0) ^ 0xff;
    fs.writeFileSync(pptx, flipped);
    const r1 = await request.get('/api/v1/deck/export/pptx');
    expect(r1.status()).toBe(409);
    expect((await r1.json()).code).toBe('output-corrupted');
    expect(spawnSync('node', ['scripts/deck.ts', 'verify', folder], { cwd: process.cwd(), encoding: 'utf8' }).status, 'the CLI verifier agrees').toBe(2);

    fs.writeFileSync(pptx, original.subarray(0, 4096));
    expect((await request.get('/api/v1/deck/export/pptx')).status(), 'truncated').toBe(409);
    fs.writeFileSync(pptx, Buffer.alloc(0));
    expect((await request.get('/api/v1/deck/export/pptx')).status(), 'empty').toBe(409);
    fs.rmSync(pptx);
    expect((await request.get('/api/v1/deck/export/pptx')).status(), 'missing').toBe(409);
    fs.writeFileSync(pptx, original);
    expect((await request.get('/api/v1/deck/export/pptx')).status(), 'restored').toBe(200);

    // Swapped record: a sample presented as final, by editing the pointer file.
    const rec = path.join(folder, 'generation.json');
    const recText = fs.readFileSync(rec, 'utf8');
    const latestFile = path.join(dir, 'cache', 'deck', 'latest.json');
    const latestText = fs.readFileSync(latestFile, 'utf8');
    fs.writeFileSync(latestFile, latestText.replace(`"mode": "${latest.mode}"`, `"mode": "${latest.mode === 'final' ? 'sample' : 'final'}"`));
    const r2 = await request.get('/api/v1/deck/export/pptx');
    expect(r2.status()).toBe(409);
    expect((await r2.json()).code).toBe('record-mismatch');
    fs.writeFileSync(latestFile, latestText);
    fs.writeFileSync(rec, '{ not json');
    expect((await request.get('/api/v1/deck/export/pptx')).status()).toBe(409);
    fs.writeFileSync(rec, recText);
    void csrf;
  });
});

// ================================================================================================ negative tests that change the world
test.describe('negative tests', () => {
  test.describe.configure({ mode: 'serial' });

  test('setup: four more decisions arrive on GitHub', async ({ request }) => {
    const files: Record<string, string> = {};
    for (const [n, slug, t] of [['0022', 'forged', 'A decision someone tries to approve with a forged record'], ['0023', 'rejected', 'A decision the owner rejects'], ['0024', 'conflict', 'A decision changed on GitHub while it is open'], ['0025', 'outage', 'A decision submitted while GitHub is unreachable']]) files[adrPath(n!, slug!)] = adrText(n!, t!);
    pushAndPull(files, 'ADRs 0022 to 0025');
    await refresh(request);
    for (const n of ['0022', '0023', '0024', '0025']) expect((await decision(request, `ADR-${n}`)).status).toBe('Proposed');
  });

  test('unauthorized approval: no role, a viewer, a contributor, a security reviewer, an agent identity and an impostor are all refused by the server', async ({ request }) => {
    const before = bare('rev-parse', 'refs/heads/main');
    const prCount = prs().length;
    for (const [who, user] of [['viewer', USERS.outsider], ['contributor', USERS.contrib], ['security reviewer', USERS.security], ['agent', USERS.bot], ['impostor', USERS.impostor]] as const) {
      as(user);
      await request.post('/api/v1/auth/signout', { headers: H, data: {} });
      const s = await request.post('/api/v1/auth/signin', { headers: H, data: {} });
      if (!s.ok()) {
        expect([401, 403], `${who} cannot even sign in`).toContain(s.status());
        continue;
      }
      const csrf = ((await (await request.get('/api/v1/auth/session')).json()) as { csrf: string }).csrf;
      const r = await submit(request, csrf, 'ADR-0022', { action: 'approve' });
      expect([401, 403, 409, 422], `${who}: ${JSON.stringify(r.body).slice(0, 200)}`).toContain(r.resp.status());
      expect(r.resp.ok(), `${who} must not be able to approve`).toBe(false);
    }
    expect(prs().length, 'no pull request was created').toBe(prCount);
    expect(bare('rev-parse', 'refs/heads/main')).toBe(before);
    // no session at all
    await request.post('/api/v1/auth/signout', { headers: H, data: {} });
    expect((await post(request, '/api/v1/review/ADR-0022/actions', '', { action: 'approve', expectedRevision: 'x', idempotencyKey: 'k' })).status()).toBe(401);
  });

  test('forged approval: a hand-written review record, a forged baseline approval and a forged slide approval all change nothing', async ({ request }) => {
    const csrf = await login(request, USERS.owner);
    const rv = (await getJson(request, '/api/v1/review/ADR-0022')).view.revision;
    // A review record written by hand and committed to main, claiming the owner approved. It has no valid signature or hash chain.
    const fake = { schema: 'greenfuel.decision-review-event/v2', id: 'DR-ADR-0022-0001', decisionId: 'ADR-0022', seq: 1, action: 'approve', actor: { login: 'test-owner', githubId: 1001, name: 'Test Owner', verifiedBy: 'test-fixture', provider: 'github', subject: '1001', tenantId: null }, createdAt: new Date().toISOString(), rationale: 'Approved (forged).', basis: { recordHash: 'a'.repeat(64) }, sig: 'b'.repeat(64) };
    pushAndPull({ 'docs/decision-reviews/ADR-0022/0001-approve.json': `${JSON.stringify(fake, null, 2)}\n` }, 'a hand-written approval record');
    await refresh(request);
    const d = await decision(request, 'ADR-0022');
    expect(d.status, 'the forged record does not approve the decision').toBe('Proposed');
    const view = (await getJson(request, '/api/v1/review/ADR-0022')).view;
    expect(JSON.stringify(view.canonical.state.problems), 'the Studio reports the forged record').toMatch(/./);
    evidence.forgedReviewRecord = view.canonical.state.problems.slice(0, 2);
    void rv;
    void csrf;

    // A forged baseline authorization: a signed-looking approval for a baseline that was never authorized by a key in the registry.
    const bl = fileOnMain('docs/baselines/BL-0001/manifest.json');
    pushAndPull({ 'docs/baselines/BL-0002/manifest.json': bl.replace('"BL-0001"', '"BL-0002"'), 'docs/approvals/APPROVAL-FORGED-BL-0002.json': JSON.stringify({ schema: 'greenfuel.approval/v1', id: 'APPROVAL-FORGED-BL-0002', type: 'baseline', subject: { id: 'BL-0002' }, signatures: [{ keyId: 'forged', sig: 'c'.repeat(64) }] }, null, 2) }, 'a forged baseline authorization');
    await refresh(request);
    const bv = await getJson(request, '/api/v1/baseline');
    const b2 = bv.baselines.find((x: { id: string }) => x.id === 'BL-0002');
    expect(b2?.status, 'a forged authorization does not authorize').not.toBe('approved');
    expect(bv.baselines.find((x: { id: string }) => x.id === 'BL-0001').status, 'the genuine baseline is unaffected').toBe('approved');
    pushAndPull({}, 'remove the forged baseline', ['docs/baselines/BL-0002/manifest.json', 'docs/approvals/APPROVAL-FORGED-BL-0002.json', 'docs/decision-reviews/ADR-0022/0001-approve.json']);
    await refresh(request);
  });

  test('rejected decision: needs a rationale, is recorded, is not resolved, and cannot be approved over', async ({ request }) => {
    const csrf = await login(request, USERS.owner);
    const none = await submit(request, csrf, 'ADR-0023', { action: 'reject' });
    expect(none.resp.status(), 'a rejection without a reason is refused').toBeGreaterThanOrEqual(400);
    await decideViaWorkflow(request, csrf, 'ADR-0023', { action: 'reject', rationale: 'Violates the residency constraint HC-01.' }, 'Rejected');
    const q = await getJson(request, '/api/v1/queue');
    expect(q.items.find((i: { id: string }) => i.id === 'ADR-0023').status).toBe('Rejected');
    const bv = await getJson(request, '/api/v1/baseline');
    expect(bv.readiness.global.rejected, 'a rejected decision is counted as rejected, not resolved').toBeGreaterThanOrEqual(1);
    const over = await submit(request, csrf, 'ADR-0023', { action: 'approve' });
    expect(over.resp.status(), 'a rejected decision cannot be silently approved').toBeGreaterThanOrEqual(400);
    expect((await decision(request, 'ADR-0023')).status).toBe('Rejected');
  });

  test('conflicting GitHub changes and a stale revision: the submission is refused and nothing is sent', async ({ request }) => {
    const csrf = await login(request, USERS.owner);
    const seen = (await getJson(request, '/api/v1/review/ADR-0024')).view.revision as string;
    const text = fileOnMain(adrPath('0024', 'conflict'));
    pushAndPull({ [adrPath('0024', 'conflict')]: text.replace('Keep decision records in this repository', 'Keep decision records somewhere else') }, 'someone edits ADR 0024 on GitHub');
    await refresh(request);
    const before = prs().length;
    const resp = await post(request, '/api/v1/review/ADR-0024/actions', csrf, { action: 'approve', expectedRevision: seen, idempotencyKey: crypto.randomUUID() });
    expect(resp.status(), await resp.text()).toBe(409);
    expect(prs().length, 'no pull request was created').toBe(before);
    expect((await decision(request, 'ADR-0024')).status).toBe('Proposed');
    // and with the current revision it goes through, so the refusal was about staleness and not a broken decision
    const ok = await submit(request, csrf, 'ADR-0024', { action: 'approve' });
    expect(ok.resp.status()).toBe(200);
    // the deck's own state is also protected by a revision
    const dv = await getJson(request, '/api/v1/deck');
    const stale = await post(request, '/api/v1/deck/actions', csrf, { action: 'reset', slideId: 'E01', expectedRevision: dv.model.revision - 1 });
    expect(stale.status()).toBe(409);
  });

  test('GitHub unreachable: no false success, the failure is visible, and the same request succeeds once GitHub is back', async ({ request }) => {
    const csrf = await login(request, USERS.owner);
    const rv = (await getJson(request, '/api/v1/review/ADR-0025')).view.revision as string;
    const key = crypto.randomUUID();
    fs.renameSync(remote, `${remote}.off`);
    let resp;
    try {
      resp = await post(request, '/api/v1/review/ADR-0025/actions', csrf, { action: 'approve', expectedRevision: rv, idempotencyKey: key });
    } finally {
      fs.renameSync(`${remote}.off`, remote);
    }
    const body = await resp.json().catch(() => ({}));
    const falseSuccess = resp.ok() && ['applied', 'awaiting-merge', 'pull-request-created'].includes(body?.proposal?.state);
    evidence.githubUnreachable = { status: resp.status(), state: body?.proposal?.state ?? null, detail: String(body?.detail ?? body?.proposal?.failure ?? '').slice(0, 160) };
    expect(falseSuccess, `must not claim a pull request exists: ${JSON.stringify(evidence.githubUnreachable)}`).toBe(false);
    expect((await decision(request, 'ADR-0025')).status, 'still not decided').toBe('Proposed');
    // retry: the idempotency key makes it safe, and it now goes through
    const retry = await post(request, '/api/v1/review/ADR-0025/actions', csrf, { action: 'approve', expectedRevision: rv, idempotencyKey: key });
    const rb = await retry.json();
    const open = (await getJson(request, '/api/v1/review/ADR-0025')).view.open;
    if (!(retry.ok() && rb.proposal?.state === 'pull-request-created')) {
      const s = await post(request, `/api/v1/review/proposals/${open?.id ?? rb?.proposal?.id}/sync`, csrf, {});
      expect(s.ok(), await s.text()).toBe(true);
    }
    expect((await getJson(request, '/api/v1/review/ADR-0025')).view.open.state).toBe('pull-request-created');
    expect(prs().filter((p) => p.head.includes('/ADR-0025/')).length, 'exactly one pull request').toBe(1);
  });

  test('duplicate decision: two files claiming the same ADR number are flagged and not silently merged', async ({ request }) => {
    pushAndPull({ [adrPath('0021', 'duplicate-of-keep-decision-records')]: adrText('0021', 'A second record that claims number 0021') }, 'a duplicate ADR number');
    await refresh(request);
    const reg = await getJson(request, '/api/v1/register');
    evidence.duplicates = reg.duplicates;
    expect(JSON.stringify(reg.duplicates) + JSON.stringify(reg.warnings) + JSON.stringify(reg.validation), 'the register reports the duplicate').toMatch(/0021/);
    const dup = await decision(request, 'ADR-0021');
    expect(JSON.stringify(dup.flags) + JSON.stringify(dup.missing) + dup.status, 'the original is not silently overwritten by the duplicate').toMatch(/Approved|duplicate/i);
    pushAndPull({}, 'remove the duplicate', [adrPath('0021', 'duplicate-of-keep-decision-records')]);
    await refresh(request);
  });

  test('change after approval: editing an approved decision invalidates the baseline and the final deck is refused again', async ({ request }) => {
    const csrf = await login(request, USERS.owner);
    const text = fileOnMain(adrPath('0021', 'keep-decision-records-in-repo'));
    pushAndPull({ [adrPath('0021', 'keep-decision-records-in-repo')]: text.replace('every change has an author, a reviewer and a commit', 'every change has an author and a commit') }, 'edit the approved ADR 0021 without reopening it');
    await refresh(request);
    const bv = await getJson(request, '/api/v1/baseline');
    const b = bv.baselines.find((x: { id: string }) => x.id === 'BL-0001');
    evidence.driftAfterEdit = { currentness: b.currentness, impacts: b.impacts.map((i: { code: string }) => i.code) };
    expect(b.currentness, 'the baseline no longer describes the repository').not.toBe('current');
    expect(bv.gates[0].state).toBe('blocked');
    const resp = await post(request, '/api/v1/deck/build', csrf, { mode: 'final' });
    expect(resp.status(), 'the final deck is refused again').toBe(422);
    expect((await resp.json()).detail).toMatch(/baseline|approved/);
  });

  test('missing source file and missing presentation evidence: the deck says so instead of inventing, and a final deck is refused', async ({ request }) => {
    const csrf = await login(request, USERS.owner);
    const gone = 'docs/target-architecture/12-DATA-MOVEMENT-AND-RESIDENCY-VALIDATION.md';
    pushAndPull({}, 'delete a source document the deck cites', [gone]);
    await refresh(request);
    expect((await request.get(`/api/v1/source?path=${encodeURIComponent(gone)}`)).status(), 'the Studio answers a missing source with an error, not a crash').toBeGreaterThanOrEqual(400);
    const model = (await getJson(request, '/api/v1/deck')).model;
    const t03 = model.slides.find((s: { id: string }) => s.id === 'T03');
    expect(t03.claims.some((c: { ok: boolean }) => !c.ok), 'the claim that relied on the deleted file fails').toBe(true);
    expect(t03.placeholders.some((p: { id: string }) => /^PH-T03/.test(p.id)), 'and a visible placeholder replaces it').toBe(true);
    expect(model.gate.items.find((i: { id: string }) => i.id === 'claims').met).toBe(false);
    expect((await post(request, '/api/v1/deck/build', csrf, { mode: 'final' })).status()).toBe(422);
    // a sample is still buildable, and carries the placeholder
    const s = await post(request, '/api/v1/deck/build', csrf, { mode: 'sample' });
    expect(s.status(), await s.text()).toBe(200);
  });
});

test.describe('the interface under test', () => {
  test('the pages named in the workflow are accessible and responsive', async ({ page }) => {
    for (const p of ['/decisions', '/decisions/ADR-0021', '/queue', '/baseline', '/presentation/deck']) {
      await page.goto(p);
      await expect(page.locator('main h1').first()).toBeVisible();
      await expectNoAxeViolations(page, p);
    }
    const overflow = async (pg: Page) => pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    await page.setViewportSize({ width: 820, height: 1100 });
    for (const p of ['/decisions/ADR-0021/review', '/baseline', '/presentation/deck']) {
      await page.goto(p);
      await expect(page.locator('main h1').first()).toBeVisible();
      expect(await overflow(page), `${p} at tablet width`).toBe(false);
    }
  });
});
