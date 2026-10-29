import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Read-only access to a git repository.
 *
 * Every operation goes through `run`, which only accepts an allowlisted set of git subcommands, none of which can
 * modify the repository, the index or the working tree. There is no method that writes. The adapter reads committed
 * content at one resolved commit, so uncommitted edits never leak into what the Studio shows.
 */

const ALLOWED = new Set(['rev-parse', 'ls-tree', 'cat-file', 'rev-list', 'for-each-ref', 'log', 'config', 'remote', 'status', 'symbolic-ref', 'merge-base']);
const MAX_BUFFER = 256 * 1024 * 1024;

export class GitError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'GitError';
    this.code = code;
  }
}

export interface RemoteRef {
  name: string;
  commit: string;
}

export interface LogEntry {
  sha: string;
  date: string;
  author: string;
  subject: string;
}

export function validateRef(ref: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/@^~{}-]{0,200}$/.test(ref) || ref.includes('..')) {
    throw new GitError('BAD_REF', `Refusing ref "${ref.slice(0, 60)}": not a plain branch, tag or commit name.`);
  }
  return ref;
}

export class GitRepositoryAdapter {
  readonly root: string;
  readonly ref: string;
  commit = '';
  private tree = new Map<string, string>();
  private cache = new Map<string, string>();
  private remoteTrees: { ref: RemoteRef; tree: Map<string, string> }[] | null = null;

  constructor(root: string, ref = 'HEAD') {
    this.root = root;
    this.ref = validateRef(ref);
  }

  static findRoot(start: string): string {
    const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: start, encoding: 'utf8' });
    if (r.error || r.status !== 0) throw new GitError('NOT_A_REPO', 'No git repository found. Set STUDIO_REPO_ROOT to the repository root.');
    return path.resolve(r.stdout.trim());
  }

  private run(args: string[], input?: Buffer | string): Buffer {
    const sub = args[0];
    if (!sub || !ALLOWED.has(sub)) throw new GitError('FORBIDDEN', `git ${sub ?? ''} is not on the read-only allowlist.`);
    if (sub === 'config' && args[1] !== '--get') throw new GitError('FORBIDDEN', 'Only git config --get is allowed.');
    if (sub === 'remote' && args[1] !== 'get-url') throw new GitError('FORBIDDEN', 'Only git remote get-url is allowed.');
    const r = spawnSync('git', ['--no-optional-locks', ...args], { cwd: this.root, input, maxBuffer: MAX_BUFFER, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } });
    if (r.error) throw new GitError('GIT_UNAVAILABLE', `Could not run git: ${r.error.message}`);
    if (r.status !== 0) throw new GitError('GIT_FAILED', `git ${sub} failed: ${r.stderr.toString().trim().slice(0, 200)}`);
    return r.stdout;
  }

  private text(args: string[]): string {
    return this.run(args).toString('utf8').trim();
  }

  private tryText(args: string[]): string | null {
    try {
      return this.text(args);
    } catch {
      return null;
    }
  }

  /** Resolve the ref to a commit and index its tree. Must be called once before reading. */
  open(): this {
    try {
      this.commit = this.text(['rev-parse', '--verify', `${this.ref}^{commit}`]);
    } catch (e) {
      if (e instanceof GitError && e.code === 'GIT_FAILED') throw new GitError('REF_NOT_FOUND', `The ref "${this.ref}" does not resolve to a commit in this repository.`);
      throw e;
    }
    this.tree = this.parseTree(this.commit);
    return this;
  }

  private parseTree(commit: string): Map<string, string> {
    const out = this.run(['ls-tree', '-r', '-z', '--full-tree', commit]).toString('utf8');
    const map = new Map<string, string>();
    for (const rec of out.split('\0')) {
      const m = /^\d+ blob ([0-9a-f]{40,64})\t(.+)$/.exec(rec);
      if (m?.[1] && m[2]) map.set(m[2], m[1]);
    }
    return map;
  }

  has(p: string): boolean {
    return this.tree.has(p);
  }

  list(prefix: string): string[] {
    return [...this.tree.keys()].filter((k) => k.startsWith(prefix)).sort();
  }

  oid(p: string): string | undefined {
    return this.tree.get(p);
  }

  /** Read many files with one git process. Content is normalised to LF. */
  preload(paths: string[]): void {
    const want = paths.filter((p) => this.tree.has(p) && !this.cache.has(p));
    if (!want.length) return;
    const out = this.run(['cat-file', '--batch'], want.map((p) => this.tree.get(p)).join('\n') + '\n');
    let pos = 0;
    for (const p of want) {
      const nl = out.indexOf(0x0a, pos);
      if (nl < 0) break;
      const header = out.subarray(pos, nl).toString('utf8').split(' ');
      const size = Number(header[2]);
      if (header[1] !== 'blob' || !Number.isFinite(size)) throw new GitError('GIT_FAILED', `Unexpected cat-file output for ${p}`);
      this.cache.set(p, out.subarray(nl + 1, nl + 1 + size).toString('utf8').replace(/\r\n/g, '\n'));
      pos = nl + 1 + size + 1;
    }
  }

  read(p: string): string | undefined {
    if (!this.tree.has(p)) return undefined;
    if (!this.cache.has(p)) this.preload([p]);
    return this.cache.get(p);
  }

  // ---- repository facts

  remoteUrl(): string | null {
    return this.tryText(['remote', 'get-url', 'origin']);
  }

  currentBranch(): string | null {
    const b = this.tryText(['rev-parse', '--abbrev-ref', 'HEAD']);
    return b && b !== 'HEAD' ? b : null;
  }

  upstream(): string | null {
    return this.tryText(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  }

  aheadBehind(a: string, b: string): { ahead: number; behind: number } | null {
    const r = this.tryText(['rev-list', '--left-right', '--count', `${a}...${b}`]);
    if (!r) return null;
    const [ahead, behind] = r.split(/\s+/).map(Number);
    return Number.isFinite(ahead) && Number.isFinite(behind) ? { ahead: ahead!, behind: behind! } : null;
  }

  defaultBranch(): string | null {
    const r = this.tryText(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    return r ?? null;
  }

  remoteRefs(): RemoteRef[] {
    const out = this.tryText(['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/remotes']) ?? '';
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [name, commit] = l.split(' ');
        return { name: name ?? '', commit: commit ?? '' };
      })
      .filter((r) => r.name && !r.name.endsWith('/HEAD') && r.commit);
  }

  remoteRefsContainingCommit(): string[] {
    const out = this.tryText(['for-each-ref', '--contains', this.commit, '--format=%(refname:short)', 'refs/remotes']) ?? '';
    return out.split('\n').filter((n) => n && !n.endsWith('/HEAD'));
  }

  /** Shas among the last n commits that no remote-tracking ref contains. */
  localOnlyCommits(n: number): Set<string> {
    const out = this.tryText(['rev-list', `-n${Math.min(Math.max(n, 1), 50)}`, this.commit, '--not', '--remotes']) ?? '';
    return new Set(out.split('\n').filter(Boolean));
  }

  lastFetchAt(): string | null {
    const gitDir = this.tryText(['rev-parse', '--git-common-dir']);
    if (!gitDir) return null;
    try {
      return fs.statSync(path.resolve(this.root, gitDir, 'FETCH_HEAD')).mtime.toISOString();
    } catch {
      return null;
    }
  }

  uncommittedCount(): number {
    const s = this.tryText(['status', '--porcelain']);
    return s ? s.split('\n').filter(Boolean).length : 0;
  }

  userConfig(key: 'user.name' | 'user.email'): string | null {
    return this.tryText(['config', '--get', key]);
  }

  describeCommit(sha: string): LogEntry | null {
    return this.log(1, [], sha)[0] ?? null;
  }

  log(n: number, paths: string[] = [], from = this.commit): LogEntry[] {
    const args = ['log', `-n${Math.min(Math.max(n, 1), 50)}`, '--format=%H%x1f%cI%x1f%an%x1f%s', from, '--'];
    for (const p of paths) {
      if (!this.tree.has(p) && !this.list(p).length) throw new GitError('BAD_PATH', `Unknown path: ${p.slice(0, 80)}`);
      args.push(p);
    }
    const out = this.tryText(args) ?? '';
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [sha, date, author, subject] = l.split('\x1f');
        return { sha: sha ?? '', date: date ?? '', author: author ?? '', subject: subject ?? '' };
      });
  }

  /**
   * For each path, the commit on a GitHub remote-tracking ref that holds a byte-identical blob (so a permalink to that
   * commit shows exactly what the Studio read), or null. Preference: refs that contain this commit, then the default
   * branch, then any other remote ref.
   */
  githubCommitsFor(paths: string[]): Record<string, string | null> {
    if (!this.remoteTrees) {
      const refs = this.remoteRefs();
      const containing = new Set(this.remoteRefsContainingCommit());
      const def = this.defaultBranch();
      const rank = (r: RemoteRef) => (containing.has(r.name) ? 0 : r.name === def ? 1 : 2);
      refs.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
      this.remoteTrees = refs.map((r) => ({ ref: r, tree: this.parseTree(r.commit) }));
    }
    const result: Record<string, string | null> = {};
    for (const p of paths) {
      const local = this.tree.get(p);
      result[p] = this.remoteTrees.find((t) => t.tree.get(p) === local)?.ref.commit ?? null;
    }
    return result;
  }
}
