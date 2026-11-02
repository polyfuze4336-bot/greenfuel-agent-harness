import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, before } from 'node:test';
import { GitRepositoryAdapter, repositoryFingerprint, validateRef } from '../src/lib/repo/git.ts';
import { buildModel } from '../src/lib/repo/build.ts';
import { blockedReason, cells, parseAdr, parseRegister, parseTodo, tableRows } from '../src/lib/repo/parse.ts';
import type { StudioModel } from '../src/lib/repo/types.ts';

const root = GitRepositoryAdapter.findRoot(process.cwd());
const gitDir = path.resolve(root, spawnSync('git', ['rev-parse', '--git-dir'], { cwd: root, encoding: 'utf8' }).stdout.trim());
const sha = (f: string) => (fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : 'absent');
const gitOut = (...a: string[]) => spawnSync('git', a, { cwd: root, encoding: 'utf8' }).stdout.trim();

let adapter: GitRepositoryAdapter;
let model: StudioModel;
let before_: { head: string; status: string; index: string; refs: string };

before(() => {
  before_ = { head: gitOut('rev-parse', 'HEAD'), status: gitOut('status', '--porcelain'), index: sha(path.join(gitDir, 'index')), refs: gitOut('for-each-ref') };
  adapter = new GitRepositoryAdapter(root, 'HEAD').open();
  model = buildModel(adapter);
});

describe('read-only guarantee (adapter)', () => {
  it('has no method that writes', () => {
    const names = Object.getOwnPropertyNames(GitRepositoryAdapter.prototype);
    for (const n of names) assert.doesNotMatch(n, /^(write|save|put|delete|remove|commit|push|checkout|reset|merge|create|update)/i, `unexpected mutating method ${n}`);
  });

  it('refuses git subcommands that are not on the allowlist', () => {
    const run = (adapter as unknown as { run: (a: string[]) => unknown }).run.bind(adapter);
    for (const bad of [['add', '.'], ['commit', '-m', 'x'], ['push'], ['checkout', 'HEAD'], ['reset', '--hard'], ['fetch'], ['branch', 'x'], ['config', 'user.name', 'x'], ['remote', 'add', 'x', 'y'], ['update-ref', 'refs/x', 'HEAD']]) {
      assert.throws(() => run(bad), (e: unknown) => e instanceof Error && (e as { code?: string }).code === 'FORBIDDEN', `git ${bad.join(' ')} should be refused`);
    }
  });

  it('rejects refs that could be read as options or ranges', () => {
    for (const bad of ['--upload-pack=calc', '-x', 'a..b', '', 'a b', 'a;b', '$(id)']) assert.throws(() => validateRef(bad), /Refusing ref/);
    for (const ok of ['HEAD', 'main', 'origin/main', 'studio/ui-readonly', 'v1.2.3', 'df07cf2']) assert.equal(validateRef(ok), ok);
  });

  it('reports a clear error for a ref that does not exist', () => {
    assert.throws(() => new GitRepositoryAdapter(root, 'no-such-branch-xyz').open(), (e: unknown) => (e as { code?: string }).code === 'REF_NOT_FOUND');
  });

  it('leaves HEAD, refs, index and working-tree status unchanged after building the model', () => {
    assert.equal(gitOut('rev-parse', 'HEAD'), before_.head);
    assert.equal(gitOut('status', '--porcelain'), before_.status);
    assert.equal(sha(path.join(gitDir, 'index')), before_.index);
    assert.equal(gitOut('for-each-ref'), before_.refs);
  });
});

describe('parsers', () => {
  it('reads table rows and ignores separators', () => {
    const rows = tableRows('| A | B |\n|---|:---:|\n| D-001 | x |');
    assert.deepEqual(rows.map((r) => r.cells), [['A', 'B'], ['D-001', 'x']]);
    assert.deepEqual(cells('| a | b |'), ['a', 'b']);
  });

  it('maps register rows to Open decisions with provenance', () => {
    const t = '| ID | Kind |\n|---|---|\n| D-001 | C | Title | Why | Opt A; Opt B | Owner | M1 | Open |';
    const [d] = parseRegister(t, 'x.md');
    assert.ok(d);
    assert.equal(d.status, 'open');
    assert.equal(d.milestone, 'M1');
    assert.deepEqual(d.options, ['Opt A', 'Opt B']);
    assert.equal(d.src.line, 3);
  });

  it('never upgrades a Proposed ADR, and recognises owner-chat acceptance as unsigned', () => {
    const proposed = parseAdr('# ADR 0099: T\n\n- **Status:** Proposed\n', 'docs/adr/0099-t.md');
    assert.equal(proposed.status, 'proposed');
    const accepted = parseAdr('# ADR 0098: T\n\n- **Status:** Accepted (2026-10-28, programme owner, by instruction in chat)\n', 'docs/adr/0098-t.md');
    assert.equal(accepted.status, 'accepted');
    assert.equal(accepted.flags.grandfathered, true);
    assert.equal(accepted.flags.signed, false);
    const odd = parseAdr('# ADR 0097: T\n\n- **Status:** Maybe\n', 'docs/adr/0097-t.md');
    assert.equal(odd.status, 'proposed');
    assert.ok(odd.flags.review.length > 0);
  });

  it('derives blocked tasks only from stated prerequisites and never for closed tasks', () => {
    assert.match(blockedReason('open', '**Open.** Until T13 is done the gate cannot pass.') ?? '', /^Until T13/);
    assert.equal(blockedReason('done', '**Done.** Until the day it shipped.'), undefined);
    assert.ok(blockedReason('not-granted', 'x'));
    assert.equal(blockedReason('open', 'Plain open item with no prerequisite.'), undefined);
    const [t] = parseTodo('## Owner has deferred ("will answer later")\n| T1 | Answer things | src | R1 |', 'TODO.md');
    assert.equal(t?.status, 'deferred');
  });
});

describe('model counts agree with the independent discovery snapshot', () => {
  const snap = () => JSON.parse(adapter.read('docs/architecture-studio/inventory.snapshot.json') ?? '{}') as { counts: Record<string, any>; reviews: any[] };

  it('decisions', () => {
    const s = snap();
    assert.equal(model.metrics.decisions.register, s.counts.decisionRegister.total);
    assert.equal(model.metrics.decisions.adrs, s.counts.adr.total);
    assert.equal(model.metrics.decisions.accepted, s.counts.adr.byClass.Accepted);
    assert.equal(model.metrics.decisions.proposed, s.counts.adr.byClass.Proposed);
    assert.equal(model.metrics.decisions.rejected, s.counts.adr.rejected);
    assert.equal(model.metrics.decisions.superseded, s.counts.adr.superseded);
    assert.equal(model.decisions.filter((d) => d.milestone === 'M1').length, s.counts.decisionRegister.byMilestone.M1);
  });

  it('tasks', () => {
    const s = snap();
    const by: Record<string, number> = {};
    for (const t of model.tasks.filter((x) => x.family === 'owner-todo')) by[t.status] = (by[t.status] ?? 0) + 1;
    assert.deepEqual(by, s.counts.todoTasks.byStatus);
    assert.deepEqual(model.tasks.filter((t) => t.ambiguous && t.family === 'owner-todo').map((t) => t.id), s.counts.todoTasks.ambiguousForReview);
  });

  it('assumptions, risks, requirements, reviews', () => {
    const s = snap();
    assert.equal(model.assumptions.length, s.counts.assumptions.total);
    assert.equal(model.metrics.assumptions.unresolved, s.counts.assumptions.unresolved);
    assert.equal(model.risks.length, s.counts.risks.total);
    assert.equal(model.requirements.length, s.counts.requirements.total);
    assert.equal(model.metrics.requirements.must, s.counts.requirements.byPriority.Must);
    assert.equal(model.reviews.length, s.counts.designReviews.reviews);
    assert.equal(model.metrics.readiness.gateDecisions, s.counts.designReviews.distinctBlockingDecisions.length);
    assert.equal(model.approvals.enrolledApprovers, s.counts.approvals.enrolledApprovers);
    assert.equal(model.approvals.signedRecords, s.counts.approvals.signedApprovalRecords);
  });
});

describe('model integrity', () => {
  it('has unique ids and no Accepted decision that is signed while there are no approval records', () => {
    const ids = model.decisions.map((d) => d.id);
    assert.equal(new Set(ids).size, ids.length);
    if (model.approvals.signedRecords === 0) assert.equal(model.metrics.decisions.acceptedSigned, 0);
  });

  it('every record points to a real file and line, and the line mentions the record id', () => {
    const records: { id: string; src: { path: string; line: number } }[] = [...model.decisions.filter((d) => d.type === 'register'), ...model.risks, ...model.assumptions, ...model.requirements, ...model.tasks];
    for (const r of records) {
      const text = adapter.read(r.src.path);
      assert.ok(text !== undefined, `${r.id}: missing ${r.src.path}`);
      const line = text.split('\n')[r.src.line - 1] ?? '';
      assert.ok(line.includes(r.id), `${r.id}: line ${r.src.line} of ${r.src.path} does not mention the id`);
    }
  });

  it('only links to GitHub when a pushed commit holds an identical blob', () => {
    const remote = new Set(model.repo.remoteRefs.map((r) => r.commit));
    for (const [p, c] of Object.entries(model.links)) if (c) assert.ok(remote.has(c), `${p} links to ${c}, which is not a remote ref tip`);
  });

  it('does not expose absolute paths', () => {
    const json = JSON.stringify(model);
    assert.ok(!json.includes(root.replace(/\\/g, '\\\\')) && !json.includes(root), 'absolute repository path leaked into the model');
  });

  it('every blocker states its basis, and no repository path from this machine leaks through the model', () => {
    assert.ok(model.blockers.length > 0);
    assert.ok(model.blockers.every((b) => b.basis.length > 0 && b.title.length > 0));
    assert.ok(model.attention.every((a) => a.href.startsWith('/')));
  });
});

describe('object caches and the repository fingerprint', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-fp-'));
  const g = (...a: string[]) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const commit = (file: string, text: string, msg: string) => {
    fs.writeFileSync(path.join(tmp, file), text);
    g('add', file);
    g('commit', '-q', '-m', msg);
  };

  before(() => {
    g('init', '-q', '-b', 'main');
    commit('a.md', 'one\n', 'first');
  });

  it('is stable while nothing changes', async () => {
    assert.equal(await repositoryFingerprint(tmp), await repositoryFingerprint(tmp));
  });

  it('changes with a commit, a new branch and an uncommitted file, and nothing else', async () => {
    const f0 = await repositoryFingerprint(tmp);
    commit('a.md', 'two\n', 'second');
    const f1 = await repositoryFingerprint(tmp);
    assert.notEqual(f1, f0, 'a commit changes it');
    g('branch', 'side');
    const f2 = await repositoryFingerprint(tmp);
    assert.notEqual(f2, f1, 'a new branch ref changes it');
    fs.writeFileSync(path.join(tmp, 'dirty.txt'), 'x');
    const f3 = await repositoryFingerprint(tmp);
    assert.notEqual(f3, f2, 'an uncommitted file changes it');
    fs.rmSync(path.join(tmp, 'dirty.txt'));
    assert.equal(await repositoryFingerprint(tmp), f2, 'removing it restores the earlier value');
  });

  it('never serves stale content: the cache is keyed by object id, so a changed file reads as changed', () => {
    const a1 = new GitRepositoryAdapter(tmp, 'HEAD').open();
    const before = a1.read('a.md');
    commit('a.md', 'three\n', 'third');
    const a2 = new GitRepositoryAdapter(tmp, 'HEAD').open();
    assert.equal(a2.read('a.md'), 'three\n');
    assert.notEqual(a2.read('a.md'), before);
    // The earlier commit still reads as it was, from the same caches.
    const old = new GitRepositoryAdapter(tmp, a1.commit).open();
    assert.equal(old.read('a.md'), before);
  });

  it('lists the same files for the same commit when opened twice', () => {
    const x = new GitRepositoryAdapter(tmp, 'HEAD').open();
    const y = new GitRepositoryAdapter(tmp, 'HEAD').open();
    assert.deepEqual(y.listAll(), x.listAll());
    assert.equal(y.oid('a.md'), x.oid('a.md'));
  });

  it('fails clearly when the folder is not a repository', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-nogit-'));
    await assert.rejects(() => repositoryFingerprint(plain), (e: unknown) => (e as { code?: string }).code === 'GIT_FAILED');
    try {
      fs.rmSync(plain, { recursive: true, force: true });
    } catch {
      // Windows can hold the folder for a moment after git exits; it is a temp folder.
    }
  });
});