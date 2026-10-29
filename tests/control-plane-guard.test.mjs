import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { checkRange } = await import('../harness/scripts/ci-control-plane-guard.mjs');
const { buildEnrollment, registerEntry } = await import('../harness/scripts/approval.mjs');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PERM = readFileSync(path.join(REPO, 'harness/policy/permissions.json'), 'utf8');

const OWNERS = (logins, enforce = false) => JSON.stringify({ version: 1, enforce, owners: logins.map((login) => ({ login })) });
// Mock of git and the GitHub API. `commits` is [{ sha, files, verification }]; refs read are recorded so we can prove only the BASE is consulted.
function mock({ commits, owners = ['owner-login'], head = {}, ownersMissing = false, apiError = false }) {
  const refs = [];
  return {
    refs,
    readAtRef: (ref, file) => {
      refs.push(`${ref}:${file}`);
      if (file === 'harness/policy/permissions.json') return PERM;
      if (file === 'harness/policy/control-plane-owners.json') { if (ownersMissing) throw new Error('no such file at base'); return OWNERS(owners); }
      if (file === 'harness/policy/approvers.json' && ref === 'HEADSHA') return JSON.stringify({ approvers: head.approvers ?? [] });
      throw new Error(`unexpected read ${ref}:${file}`);
    },
    listCommits: () => commits.map((c) => ({ sha: c.sha, files: c.files })),
    fetchCommit: async (_repo, sha) => { if (apiError) throw new Error('API answered 502'); const c = commits.find((x) => x.sha === sha); return c.verification; },
  };
}
const ok = { verified: true, reason: 'valid', authorLogin: 'owner-login', committerLogin: 'owner-login' };
const run = (deps, extra = {}) => checkRange({ base: 'BASESHA', head: 'HEADSHA', repo: 'o/r', deps, env: {}, ...extra });

test('a range that touches no control-plane file passes without asking GitHub anything', async () => {
  const d = mock({ commits: [{ sha: 'a'.repeat(40), files: ['docs/state/NOTES.md', 'src/readme.txt'], verification: null }] });
  d.fetchCommit = async () => { throw new Error('must not be called'); };
  const r = await run(d, { mode: 'enforce' });
  assert.equal(r.ok, true); assert.deepEqual(r.findings, []); assert.deepEqual(r.touched, []);
});

test('enforce: an unsigned or unverifiable control-plane commit blocks, for every kind of control-plane path', async () => {
  for (const file of ['harness/hooks/policy-guard.cjs', '.github/workflows/validate.yml', 'harness/policy/approvers.json', 'docs/approvals/AP-x.json', 'docs/adr/0016-new.md', '.vscode/settings.json', '.devcontainer/devcontainer.json', 'package.json', 'memory/ledger.jsonl', 'docs/evidence/records/EV-0900.json']) {
    for (const reason of ['unsigned', 'unknown_key', 'bad_email', 'expired_key', 'unverified_email', 'invalid']) {
      const d = mock({ commits: [{ sha: 'b'.repeat(40), files: [file], verification: { verified: false, reason, authorLogin: 'owner-login', committerLogin: 'owner-login' } }] });
      const r = await run(d, { mode: 'enforce' });
      assert.equal(r.ok, false, `${file} / ${reason}`);
      assert.match(r.findings[0], /not a GitHub-verified commit/);
    }
  }
});

test('enforce: a verified commit passes only when an enrolled owner made it; web-flow merges count only for an owner author', async () => {
  const c = (verification) => mock({ commits: [{ sha: 'c'.repeat(40), files: ['harness/policy/permissions.json'], verification }] });
  assert.equal((await run(c(ok), { mode: 'enforce' })).ok, true);
  assert.equal((await run(c({ ...ok, authorLogin: 'someone-else', committerLogin: 'someone-else' }), { mode: 'enforce' })).ok, false, 'verified but not an owner');
  assert.equal((await run(c({ ...ok, authorLogin: 'owner-login', committerLogin: 'web-flow' }), { mode: 'enforce' })).ok, true, 'GitHub merged an owner pull request');
  assert.equal((await run(c({ ...ok, authorLogin: 'someone-else', committerLogin: 'web-flow' }), { mode: 'enforce' })).ok, false, 'GitHub merged a stranger pull request');
  assert.equal((await run(c({ ...ok, authorLogin: 'OWNER-LOGIN', committerLogin: 'Owner-Login' }), { mode: 'enforce' })).ok, true, 'logins compare case-insensitively');
  assert.equal((await run(c({ verified: true, reason: 'unknown_key', authorLogin: 'owner-login', committerLogin: 'owner-login' }), { mode: 'enforce' })).ok, false, 'verified must also be valid');
});

test('fail closed: an API error, an unreadable owner list or no owners blocks an enforcing guard, and report mode says so without blocking', async () => {
  const files = ['harness/hooks/agent-guard.cjs'];
  const base = { commits: [{ sha: 'd'.repeat(40), files, verification: ok }] };
  assert.equal((await run(mock({ ...base, apiError: true }), { mode: 'enforce' })).ok, false, 'API error');
  assert.equal((await run(mock({ ...base, ownersMissing: true }), { mode: 'enforce' })).ok, false, 'owner list unreadable at the base');
  assert.equal((await run(mock({ ...base, owners: [] }), { mode: 'enforce' })).ok, false, 'nobody is an owner: nothing can pass');
  const report = await run(mock({ ...base, owners: [] }), { mode: 'report' });
  assert.equal(report.ok, true); assert.equal(report.enforce, false); assert.ok(report.findings.length > 0, 'the finding is still reported');
  const bad = mock(base); bad.listCommits = () => { throw new Error('bad revision'); };
  assert.equal((await run(bad, { mode: 'enforce' })).ok, false, 'an unlistable range blocks');
});

test('the mode comes from the environment or from the owner list at the base, never from the change', async () => {
  const files = ['harness/hooks/agent-guard.cjs']; const commits = [{ sha: 'e'.repeat(40), files, verification: { verified: false, reason: 'unsigned', authorLogin: 'x', committerLogin: 'x' } }];
  assert.equal((await run(mock({ commits }), { mode: undefined, env: {} })).enforce, false);
  assert.equal((await run(mock({ commits }), { mode: undefined, env: { GF_CONTROL_PLANE_ENFORCE: 'true' } })).ok, false);
  assert.equal((await run(mock({ commits }), { mode: undefined, env: { GF_CONTROL_PLANE_ENFORCE: 'false' } })).ok, true);
  const d = mock({ commits }); const orig = d.readAtRef;
  d.readAtRef = (ref, file) => (file === 'harness/policy/control-plane-owners.json' ? OWNERS(['owner-login'], true) : orig(ref, file));
  assert.equal((await run(d, { mode: undefined, env: {} })).ok, false, '"enforce": true at the base turns enforcement on');
  const refs = mock({ commits }); await run(refs, { mode: 'enforce' });
  assert.ok(refs.refs.filter((r) => /permissions\.json|control-plane-owners/.test(r)).every((r) => r.startsWith('BASESHA:')), 'rules and owners are read from the base commit only');
});

test('a registry change must also be a valid registry, and a self-made but well-formed entry still cannot pass without a verified owner commit', async () => {
  const owner = buildEnrollment({ holder: 'Real Owner', classes: ['architecture'], passphrase: 'a-test-passphrase-123', now: new Date(Date.now() - 3600000) });
  const entry = registerEntry({ request: owner.request, approvers: [], typedFingerprint: owner.request.fingerprint }).entry;
  const commits = (verification) => [{ sha: 'f'.repeat(40), files: ['harness/policy/approvers.json'], verification }];
  assert.equal((await run(mock({ commits: commits(ok), head: { approvers: [entry] } }), { mode: 'enforce' })).ok, true, 'a verified owner commit adding a well-formed entry passes');
  const forged = { ...entry, holder: 'Edited Holder' };
  const r = await run(mock({ commits: commits(ok), head: { approvers: [forged] } }), { mode: 'enforce' });
  assert.equal(r.ok, false); assert.ok(r.findings.some((f) => /approver registry/.test(f)), 'even an owner commit cannot add a malformed entry');
  const selfMade = await run(mock({ commits: commits({ verified: false, reason: 'unsigned', authorLogin: 'agent', committerLogin: 'agent' }), head: { approvers: [entry] } }), { mode: 'enforce' });
  assert.equal(selfMade.ok, false, 'a model can generate a key and a valid proof; it cannot make GitHub verify the commit as an owner');
  assert.ok(selfMade.findings.some((f) => /not a GitHub-verified commit/.test(f)));
});

test('git range listing works on a real repository: only commits that touch the control plane are sent to the API', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gf-cpg-'));
  try {
    const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' });
    git('init', '-q'); mkdirSync(path.join(dir, 'harness/policy'), { recursive: true }); mkdirSync(path.join(dir, 'docs'), { recursive: true });
    writeFileSync(path.join(dir, 'harness/policy/permissions.json'), PERM); writeFileSync(path.join(dir, 'harness/policy/control-plane-owners.json'), OWNERS(['owner-login']));
    writeFileSync(path.join(dir, 'docs/a.md'), 'a'); git('add', '-A'); git('commit', '-q', '-m', 'base');
    const base = git('rev-parse', 'HEAD').trim();
    writeFileSync(path.join(dir, 'docs/a.md'), 'b'); git('commit', '-q', '-am', 'docs only');
    writeFileSync(path.join(dir, 'harness/policy/permissions.json'), PERM.replace('"version": 1', '"version": 1 ')); git('commit', '-q', '-am', 'policy');
    const head = git('rev-parse', 'HEAD').trim();
    const { createRequire: cr } = await import('node:module');
    void cr;
    const asked = [];
    const mod = await import('../harness/scripts/ci-control-plane-guard.mjs');
    const deps = {
      git: (a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }), readAtRef: (ref, f) => execFileSync('git', ['show', `${ref}:${f}`], { cwd: dir, encoding: 'utf8' }),
      listCommits: (b, h) => execFileSync('git', ['log', '--name-only', '--format=%x01%H', `${b}..${h}`], { cwd: dir, encoding: 'utf8' }).split('\x01').filter(Boolean).map((chunk) => { const [sha, ...files] = chunk.split('\n').map((s) => s.trim()).filter(Boolean); return { sha, files }; }),
      fetchCommit: async (_r, sha) => { asked.push(sha); return { verified: false, reason: 'unsigned', authorLogin: 't', committerLogin: 't' }; },
    };
    const r = await mod.checkRange({ base, head, repo: 'o/r', mode: 'enforce', deps, env: {} });
    assert.equal(asked.length, 1, 'only the policy commit touched the control plane');
    assert.equal(r.ok, false); assert.deepEqual(r.touched, ['harness/policy/permissions.json']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the real owner list is empty and not enforcing, so the guard reports and says it is not enforced; the workflow runs it with a read-only token', () => {
  const owners = JSON.parse(readFileSync(path.join(REPO, 'harness/policy/control-plane-owners.json'), 'utf8'));
  assert.deepEqual(owners.owners, []); assert.equal(owners.enforce, false);
  const wf = readFileSync(path.join(REPO, '.github/workflows/validate.yml'), 'utf8');
  assert.match(wf, /ci-control-plane-guard\.mjs/); assert.match(wf, /fetch-depth: 0/); assert.match(wf, /^permissions:\s*\n\s+contents: read/m);
  assert.ok(!/pull_request_target/.test(wf), 'never run on pull_request_target: it would give a pull request a token');
});
void require;
