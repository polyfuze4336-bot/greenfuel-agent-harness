// Pull requests, behind a small port so the workflow can be tested without GitHub.
// The real implementation shells out to the GitHub CLI (`gh`) as the signed-in user. It can create a pull request and read
// its state. It cannot merge, approve, close or comment: merging is the human gate.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export interface PullRequestInfo {
  number: number;
  url: string;
  state: 'open' | 'merged' | 'closed';
  headSha: string | null;
}

export class GitHubError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = true) {
    super(message);
    this.name = 'GitHubError';
    this.retryable = retryable;
  }
}

export interface GitHubPort {
  createPullRequest(a: { base: string; head: string; title: string; body: string }): Promise<PullRequestInfo>;
  findByHead(head: string): Promise<PullRequestInfo | null>;
  get(number: number): Promise<PullRequestInfo>;
}

function run(root: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('gh', args, { cwd: root, timeout: 60_000, windowsHide: true, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || err.message).trim().slice(0, 300);
        return reject(new GitHubError(`GitHub: ${msg}`, !/not found|permission|forbidden|401|403|422|already exists/i.test(msg)));
      }
      resolve(String(stdout));
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

const FIELDS = 'number,url,state,headRefOid';
type Raw = { number: number; url: string; state: string; headRefOid?: string };
const toInfo = (r: Raw): PullRequestInfo => ({ number: r.number, url: r.url, state: r.state === 'MERGED' ? 'merged' : r.state === 'CLOSED' ? 'closed' : 'open', headSha: r.headRefOid ?? null });

export class GhCliGitHub implements GitHubPort {
  private readonly root: string;
  constructor(root: string) {
    this.root = root;
  }

  async createPullRequest(a: { base: string; head: string; title: string; body: string }): Promise<PullRequestInfo> {
    const url = (await run(this.root, ['pr', 'create', '--base', a.base, '--head', a.head, '--title', a.title, '--body-file', '-'], a.body)).trim().split('\n').pop() ?? '';
    const n = /\/pull\/(\d+)/.exec(url)?.[1];
    if (!n) throw new GitHubError('GitHub created the pull request but did not return its number.', false);
    return this.get(Number(n));
  }

  async findByHead(head: string): Promise<PullRequestInfo | null> {
    const list = JSON.parse(await run(this.root, ['pr', 'list', '--head', head, '--state', 'all', '--json', FIELDS, '--limit', '1'])) as Raw[];
    return list[0] ? toInfo(list[0]) : null;
  }

  async get(number: number): Promise<PullRequestInfo> {
    return toInfo(JSON.parse(await run(this.root, ['pr', 'view', String(number), '--json', FIELDS])) as Raw);
  }
}

/**
 * Test double. Pull requests are rows in a JSON file; a pull request counts as merged when its head commit is an ancestor of
 * the base branch in the (local, bare) remote, exactly what a real merge does. A person "merges" it with git, as in real life.
 */
export class LocalGitHub implements GitHubPort {
  private readonly file: string;
  private readonly remoteGitDir: string;
  constructor(file: string, remoteGitDir: string) {
    this.file = file;
    this.remoteGitDir = remoteGitDir;
  }

  private read(): { next: number; prs: { number: number; base: string; head: string; headSha: string; title: string; body: string; closed: boolean }[] } {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return { next: 1, prs: [] };
    }
  }

  private write(v: ReturnType<LocalGitHub['read']>) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(v, null, 2));
  }

  private git(args: string[]) {
    return spawnSync('git', ['--git-dir', this.remoteGitDir, ...args], { encoding: 'utf8', windowsHide: true });
  }

  private info(p: ReturnType<LocalGitHub['read']>['prs'][number]): PullRequestInfo {
    const merged = this.git(['merge-base', '--is-ancestor', p.headSha, `refs/heads/${p.base}`]).status === 0;
    return { number: p.number, url: `https://github.invalid/test/pull/${p.number}`, state: merged ? 'merged' : p.closed ? 'closed' : 'open', headSha: p.headSha };
  }

  async createPullRequest(a: { base: string; head: string; title: string; body: string }): Promise<PullRequestInfo> {
    const sha = this.git(['rev-parse', '--verify', `refs/heads/${a.head}`]).stdout.trim();
    if (!sha) throw new GitHubError(`Head branch ${a.head} does not exist on the remote.`, false);
    const s = this.read();
    const row = { number: s.next++, base: a.base, head: a.head, headSha: sha, title: a.title, body: a.body, closed: false };
    s.prs.push(row);
    this.write(s);
    return this.info(row);
  }

  async findByHead(head: string): Promise<PullRequestInfo | null> {
    const p = this.read().prs.find((x) => x.head === head);
    return p ? this.info(p) : null;
  }

  async get(number: number): Promise<PullRequestInfo> {
    const p = this.read().prs.find((x) => x.number === number);
    if (!p) throw new GitHubError(`Pull request ${number} not found.`, false);
    return this.info(p);
  }

  /** Test helper: close a pull request without merging. */
  close(number: number) {
    const s = this.read();
    const p = s.prs.find((x) => x.number === number);
    if (p) p.closed = true;
    this.write(s);
  }
}
