// The only code in the Studio that writes to git or GitHub. It is separate from the read-only adapter on purpose.
//
// What it can do, and nothing else:
//   - fetch the canonical branch;
//   - build ONE commit on top of the canonical commit that adds review-event files under docs/decision-reviews/,
//     using git plumbing and a temporary index, so the user's working tree, index, branches and HEAD are never touched;
//   - push that commit to a NEW branch named decision-review/...; it never pushes to the canonical branch and never forces.
// Everything runs as the user, with the user's own git credentials. Arguments are passed as arrays, never through a shell.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ALLOWED = new Set(['fetch', 'rev-parse', 'cat-file', 'read-tree', 'hash-object', 'update-index', 'write-tree', 'commit-tree', 'push', 'ls-remote', 'merge-base']);

export class PublishError extends Error {
  readonly code: 'FETCH_FAILED' | 'PUSH_REJECTED' | 'PUSH_FAILED' | 'BAD_INPUT' | 'COMMIT_FAILED' | 'BRANCH_EXISTS_DIFFERENT';
  readonly retryable: boolean;
  constructor(code: PublishError['code'], message: string, retryable: boolean) {
    super(message);
    this.name = 'PublishError';
    this.code = code;
    this.retryable = retryable;
  }
}

export const BRANCH_RE = /^(?:decision-review|work-item)\/[A-Za-z0-9-]{1,16}\/[0-9]{4}-[a-z-]{3,30}-[a-z0-9]{6,12}$/;
const FILE_RE = /^docs\/(?:decision-reviews|work-items)\/[A-Za-z0-9-]{1,16}\/\d{4}-[a-z-]+\.json$/;

/** "origin/main" becomes remote "origin", branch "main". Anything else is not a canonical ref the Studio can publish against. */
export function splitCanonicalRef(ref: string): { remote: string; branch: string } | null {
  const m = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._/-]+)$/.exec(ref);
  return m && !ref.includes('..') ? { remote: m[1]!, branch: m[2]! } : null;
}

export class GitPublisher {
  private readonly root: string;
  private readonly env: NodeJS.ProcessEnv;
  constructor(root: string, env: NodeJS.ProcessEnv = process.env) {
    this.root = root;
    this.env = env;
  }

  private git(args: string[], opts: { input?: string | Buffer; env?: Record<string, string>; timeout?: number } = {}): { ok: boolean; out: string; err: string } {
    if (!args[0] || !ALLOWED.has(args[0])) throw new PublishError('BAD_INPUT', `git ${args[0] ?? ''} is not on the publish allowlist.`, false);
    const r = spawnSync('git', args, { cwd: this.root, input: opts.input, encoding: 'utf8', timeout: opts.timeout ?? 60_000, maxBuffer: 64 << 20, windowsHide: true, env: { ...this.env, ...opts.env, GIT_TERMINAL_PROMPT: '0' } });
    if (r.error) return { ok: false, out: '', err: r.error.message };
    return { ok: r.status === 0, out: String(r.stdout ?? '').trim(), err: String(r.stderr ?? '').trim() };
  }

  fetchCanonical(ref: string): string {
    const s = splitCanonicalRef(ref);
    if (!s) throw new PublishError('BAD_INPUT', `"${ref}" is not a remote/branch reference.`, false);
    const r = this.git(['fetch', '--quiet', s.remote, `+refs/heads/${s.branch}:refs/remotes/${s.remote}/${s.branch}`]);
    if (!r.ok) throw new PublishError('FETCH_FAILED', `Could not fetch ${ref} from GitHub: ${r.err.slice(0, 200)}`, true);
    return this.git(['rev-parse', '--verify', `refs/remotes/${s.remote}/${s.branch}^{commit}`]).out;
  }

  remoteBranchSha(remote: string, branch: string): string | null {
    const r = this.git(['ls-remote', '--heads', remote, `refs/heads/${branch}`]);
    if (!r.ok) throw new PublishError('PUSH_FAILED', `Could not reach GitHub: ${r.err.slice(0, 200)}`, true);
    return r.out.split(/\s+/)[0] || null;
  }

  /** One commit on top of baseSha that adds the given files and nothing else. Returns its sha. */
  buildCommit(a: { baseSha: string; files: { path: string; content: string }[]; author: { name: string; email: string }; message: string; now: Date }): string {
    if (!/^[0-9a-f]{40,64}$/.test(a.baseSha)) throw new PublishError('BAD_INPUT', 'baseSha is not a commit id.', false);
    for (const f of a.files) if (!FILE_RE.test(f.path)) throw new PublishError('BAD_INPUT', `Refusing to write ${f.path}: only review-event files are allowed.`, false);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-index-'));
    const indexEnv = { GIT_INDEX_FILE: path.join(tmp, 'index') };
    try {
      const fail = (what: string, err: string) => new PublishError('COMMIT_FAILED', `Could not prepare the commit (${what}): ${err.slice(0, 200)}`, false);
      let r = this.git(['read-tree', a.baseSha], { env: indexEnv });
      if (!r.ok) throw fail('read-tree', r.err);
      for (const f of a.files) {
        // Never overwrite: a path that already exists on the canonical commit means someone else got there first.
        if (this.git(['cat-file', '-e', `${a.baseSha}:${f.path}`]).ok) throw new PublishError('BAD_INPUT', `${f.path} already exists on the canonical branch.`, false);
        r = this.git(['hash-object', '-w', '--stdin'], { input: f.content });
        if (!r.ok) throw fail('hash-object', r.err);
        const u = this.git(['update-index', '--add', '--cacheinfo', `100644,${r.out},${f.path}`], { env: indexEnv });
        if (!u.ok) throw fail('update-index', u.err);
      }
      r = this.git(['write-tree'], { env: indexEnv });
      if (!r.ok) throw fail('write-tree', r.err);
      const when = a.now.toISOString();
      const who = { GIT_AUTHOR_NAME: a.author.name, GIT_AUTHOR_EMAIL: a.author.email, GIT_AUTHOR_DATE: when, GIT_COMMITTER_NAME: a.author.name, GIT_COMMITTER_EMAIL: a.author.email, GIT_COMMITTER_DATE: when };
      const c = this.git(['commit-tree', r.out, '-p', a.baseSha, '-m', a.message], { env: who });
      if (!c.ok) throw fail('commit-tree', c.err);
      return c.out;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  /** Push a commit to a new decision-review branch. Not forced, and never the canonical branch. */
  push(remote: string, sha: string, branch: string): void {
    if (!BRANCH_RE.test(branch)) throw new PublishError('BAD_INPUT', `Refusing to push to "${branch}".`, false);
    if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new PublishError('BAD_INPUT', 'sha is not a commit id.', false);
    const r = this.git(['push', '--quiet', remote, `${sha}:refs/heads/${branch}`]);
    if (r.ok) return;
    const rejected = /rejected|non-fast-forward|denied|protected|permission|403|authentication failed/i.test(r.err);
    throw new PublishError(rejected ? 'PUSH_REJECTED' : 'PUSH_FAILED', `GitHub did not accept the branch: ${r.err.slice(0, 240)}`, !rejected);
  }

  isAncestor(a: string, b: string): boolean {
    return this.git(['merge-base', '--is-ancestor', a, b]).ok;
  }
}
