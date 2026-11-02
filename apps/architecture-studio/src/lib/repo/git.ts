import { execFile, spawnSync } from 'node:child_process';
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
  email: string;
}

export function validateRef(ref: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/@^~{}-]{0,200}$/.test(ref) || ref.includes('..')) {
    throw new GitError('BAD_REF', `Refusing ref "${ref.slice(0, 60)}": not a plain branch, tag or commit name.`);
  }
  return ref;
}

/**
 * Git objects are immutable: a tree is fully determined by its commit id and a blob by its object id. They can therefore be kept for
 * the life of the process without ever going stale, which removes most of the git subprocesses from a rebuild. The caches live on
 * globalThis because pages and route handlers are bundled separately and would otherwise each hold their own copy.
 */
interface ObjectCaches {
  trees: Map<string, Map<string, string>>;
  blobs: Map<string, string>;
  blobBytes: number;
}
const g = globalThis as unknown as { __studioGitObjects?: ObjectCaches };
const objects: ObjectCaches = (g.__studioGitObjects ??= { trees: new Map(), blobs: new Map(), blobBytes: 0 });
const MAX_TREES = 8;
const MAX_BLOB_BYTES = 64 * 1024 * 1024;

function rememberBlob(oid: string, text: string) {
  if (objects.blobs.has(oid)) return;
  objects.blobs.set(oid, text);
  objects.blobBytes += text.length;
  // Oldest first (Map keeps insertion order). A blob is cheap to read again, so eviction is only a cost.
  for (const k of objects.blobs.keys()) {
    if (objects.blobBytes <= MAX_BLOB_BYTES) break;
    objects.blobBytes -= objects.blobs.get(k)!.length;
    objects.blobs.delete(k);
  }
}

function spawnGit(root: string, args: string[], input?: Buffer | string): Buffer {
  const sub = args[0];
  if (!sub || !ALLOWED.has(sub)) throw new GitError('FORBIDDEN', `git ${sub ?? ''} is not on the read-only allowlist.`);
  if (sub === 'config' && args[1] !== '--get') throw new GitError('FORBIDDEN', 'Only git config --get is allowed.');
  if (sub === 'remote' && args[1] !== 'get-url') throw new GitError('FORBIDDEN', 'Only git remote get-url is allowed.');
  const r = spawnSync('git', ['--no-optional-locks', ...args], { cwd: root, input, maxBuffer: MAX_BUFFER, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } });
  if (r.error) throw new GitError('GIT_UNAVAILABLE', `Could not run git: ${r.error.message}`);
  if (r.status !== 0) throw new GitError('GIT_FAILED', `git ${sub} failed: ${r.stderr.toString().trim().slice(0, 200)}`);
  return r.stdout;
}

/**
 * A short string that changes whenever anything the read model depends on changes: where HEAD and every branch and remote-tracking
 * ref point, how many files are uncommitted, and when the last fetch happened. Three git calls instead of a full rebuild.
 */
export async function repositoryFingerprint(root: string): Promise<string> {
  // Fixed, read-only commands run concurrently and without blocking the event loop. Nothing here takes user input.
  const run = (args: string[]) =>
    new Promise<string>((resolve, reject) => {
      execFile('git', ['--no-optional-locks', ...args], { cwd: root, maxBuffer: MAX_BUFFER, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } }, (err, stdout) => (err ? reject(new GitError('GIT_FAILED', `git ${args[0]} failed: ${err.message.slice(0, 160)}`)) : resolve(stdout)));
    });
  const [head, refs, status, dir] = await Promise.all([
    run(['rev-parse', '--verify', 'HEAD']),
    run(['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads', 'refs/remotes']),
    run(['status', '--porcelain']),
    run(['rev-parse', '--git-common-dir']),
  ]);
  let fetch = 'none';
  try {
    fetch = String(fs.statSync(path.resolve(root, dir.trim(), 'FETCH_HEAD')).mtimeMs);
  } catch {
    // No fetch has happened yet.
  }
  return [head.trim(), refs, status, fetch].join('\n--\n');
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
    return spawnGit(this.root, args, input);
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
    // A commit id fixes its tree for ever, so the listing is read from git once per commit.
    const hit = objects.trees.get(commit);
    if (hit) return hit;
    const out = this.run(['ls-tree', '-r', '-z', '--full-tree', commit]).toString('utf8');
    const map = new Map<string, string>();
    for (const rec of out.split('\0')) {
      const m = /^\d+ blob ([0-9a-f]{40,64})\t(.+)$/.exec(rec);
      if (m?.[1] && m[2]) map.set(m[2], m[1]);
    }
    objects.trees.set(commit, map);
    for (const k of objects.trees.keys()) {
      if (objects.trees.size <= MAX_TREES) break;
      objects.trees.delete(k);
    }
    return map;
  }

  has(p: string): boolean {
    return this.tree.has(p);
  }

  list(prefix: string): string[] {
    return [...this.tree.keys()].filter((k) => k.startsWith(prefix)).sort();
  }

  /** Every tracked file path at the commit being read. */
  listAll(): string[] {
    return [...this.tree.keys()].sort();
  }

  oid(p: string): string | undefined {
    return this.tree.get(p);
  }

  /** Read many files with one git process. Content is normalised to LF. */
  preload(paths: string[]): void {
    // Blobs already read in this process (by object id) are taken from memory, so only new content costs a git process.
    for (const p of paths) {
      const oid = this.tree.get(p);
      const hit = oid ? objects.blobs.get(oid) : undefined;
      if (hit !== undefined && !this.cache.has(p)) this.cache.set(p, hit);
    }
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
      const text = out.subarray(nl + 1, nl + 1 + size).toString('utf8').replace(/\r\n/g, '\n');
      this.cache.set(p, text);
      rememberBlob(this.tree.get(p)!, text);
      pos = nl + 1 + size + 1;
    }
  }

  read(p: string): string | undefined {
    if (!this.tree.has(p)) return undefined;
    if (!this.cache.has(p)) this.preload([p]);
    return this.cache.get(p);
  }

  /** A file as it was at an earlier commit. The caller must already have checked the commit is in the file's own history. */
  readAt(commit: string, p: string): string | undefined {
    if (!/^[0-9a-f]{40,64}$/.test(commit)) throw new GitError('BAD_REF', 'Not a commit id.');
    try {
      return this.run(['cat-file', 'blob', `${commit}:${p}`]).toString('utf8').replace(/\r\n/g, '\n');
    } catch {
      return undefined;
    }
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
    const args = ['log', `-n${Math.min(Math.max(n, 1), 50)}`, '--format=%H%x1f%cI%x1f%an%x1f%s%x1f%ae', from, '--'];
    for (const p of paths) {
      if (!this.tree.has(p) && !this.list(p).length) throw new GitError('BAD_PATH', `Unknown path: ${p.slice(0, 80)}`);
      args.push(p);
    }
    const out = this.tryText(args) ?? '';
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [sha, date, author, subject, email] = l.split('\x1f');
        return { sha: sha ?? '', date: date ?? '', author: author ?? '', subject: subject ?? '', email: email ?? '' };
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
