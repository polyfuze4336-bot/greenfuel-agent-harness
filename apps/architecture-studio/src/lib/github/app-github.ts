// The GitHub App implementations of the two ports the sync pipeline needs: pull requests (GitHubPort) and getting a commit onto a
// new branch (Publisher). Everything goes through the REST API with an installation token; no personal token is involved.
//
// What the app can do here, and nothing else:
//   - create blobs, trees and commits (unreferenced objects) and one NEW branch under decision-review/ or work-item/;
//   - open and read pull requests, and read checks, statuses and reviews.
// It never updates an existing branch, never touches the canonical branch, never merges, approves or closes. Merging stays a
// human decision under whatever merge policy the repository enforces; the Studio only reports what GitHub says.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitHubError, type GitHubPort, type PullRequestInfo, type Validation } from '../workflow/github.ts';
import { BRANCH_RE, FILE_RE, PublishError, splitCanonicalRef, type Publisher } from '../workflow/publish.ts';
import type { GitHubApi } from './api.ts';
import type { TokenSource } from './app-auth.ts';

const run = promisify(execFile);

interface RawPull {
  number: number;
  html_url: string;
  state: 'open' | 'closed';
  merged?: boolean;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
  mergeable_state?: string;
  head: { sha: string; ref: string };
}

const STUDIO_BRANCH = /^(?:decision-review|work-item)\//;

export class AppGitHub implements GitHubPort {
  private readonly api: GitHubApi;
  private readonly repo: string;
  private readonly now: () => Date;
  constructor(api: GitHubApi, repo: string, now: () => Date = () => new Date()) {
    this.api = api;
    this.repo = repo;
    this.now = now;
  }

  private info(p: RawPull, validation?: Validation): PullRequestInfo {
    const merged = p.merged === true || !!p.merged_at;
    return { number: p.number, url: p.html_url, state: merged ? 'merged' : p.state === 'closed' ? 'closed' : 'open', headSha: p.head.sha, head: p.head.ref, mergeCommitSha: merged ? (p.merge_commit_sha ?? null) : null, ...(validation ? { validation } : {}) };
  }

  async createPullRequest(a: { base: string; head: string; title: string; body: string }): Promise<PullRequestInfo> {
    try {
      const r = await this.api.request<RawPull>('POST', `/repos/${this.repo}/pulls`, { title: a.title, head: a.head, base: a.base, body: a.body, maintainer_can_modify: false });
      return this.info(r.data);
    } catch (e) {
      // A retry after a lost response: the pull request exists already. Return it rather than failing or opening a second one.
      if (e instanceof GitHubError && e.code === 'REJECTED') {
        const existing = await this.findByHead(a.head);
        if (existing) return existing;
      }
      throw e;
    }
  }

  async findByHead(head: string): Promise<PullRequestInfo | null> {
    const owner = this.repo.split('/')[0]!;
    const r = await this.api.request<RawPull[]>('GET', `/repos/${this.repo}/pulls?head=${encodeURIComponent(`${owner}:${head}`)}&state=all&per_page=1`);
    return r.data[0] ? this.info(r.data[0]) : null;
  }

  async get(number: number): Promise<PullRequestInfo> {
    const r = await this.api.request<RawPull>('GET', `/repos/${this.repo}/pulls/${number}`);
    const p = r.data;
    if (p.state === 'closed' || p.merged) return this.info(p);
    return this.info(p, await this.validation(p));
  }

  async listStudio(): Promise<PullRequestInfo[]> {
    const out: PullRequestInfo[] = [];
    for (let page = 1; page <= 3; page++) {
      const r = await this.api.request<RawPull[]>('GET', `/repos/${this.repo}/pulls?state=all&per_page=100&sort=created&direction=desc&page=${page}`);
      for (const p of r.data) if (STUDIO_BRANCH.test(p.head.ref)) out.push(this.info(p));
      if (r.data.length < 100) break;
    }
    return out;
  }

  /** Checks, commit statuses and reviews, as GitHub reports them for the pull request's head commit. */
  private async validation(p: RawPull): Promise<Validation> {
    const [runs, status, reviews] = await Promise.all([
      this.api.request<{ check_runs?: { name: string; status: string; conclusion: string | null }[] }>('GET', `/repos/${this.repo}/commits/${p.head.sha}/check-runs?per_page=100`),
      this.api.request<{ statuses?: { context: string; state: string }[] }>('GET', `/repos/${this.repo}/commits/${p.head.sha}/status`),
      this.api.request<{ state: string; user?: { id: number } | null; submitted_at?: string }[]>('GET', `/repos/${this.repo}/pulls/${p.number}/reviews?per_page=100`),
    ]);
    const checks: Validation['checks'] = [];
    for (const c of runs.data.check_runs ?? []) {
      checks.push({ name: c.name, state: c.status !== 'completed' ? 'pending' : ['success', 'neutral', 'skipped'].includes(c.conclusion ?? '') ? 'success' : 'failure' });
    }
    for (const s of status.data.statuses ?? []) checks.push({ name: s.context, state: s.state === 'success' ? 'success' : s.state === 'pending' ? 'pending' : 'failure' });
    const state: Validation['state'] = checks.length === 0 ? 'none' : checks.some((c) => c.state === 'failure') ? 'failure' : checks.some((c) => c.state === 'pending') ? 'pending' : 'success';
    // The latest review from each person is the one that counts.
    const latest = new Map<number, string>();
    for (const r of reviews.data) if (r.user && (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED' || r.state === 'DISMISSED')) latest.set(r.user.id, r.state);
    const states = [...latest.values()];
    return { state, checks, reviews: { approvals: states.filter((s) => s === 'APPROVED').length, changesRequested: states.filter((s) => s === 'CHANGES_REQUESTED').length }, mergeState: p.mergeable_state ?? null, at: this.now().toISOString() };
  }
}

export interface AppPublisherOptions {
  api: GitHubApi;
  tokens: TokenSource;
  repo: string;
  /** The working repository, where the canonical branch is fetched to so it can be read locally. */
  root: string;
  gitUrl: string;
}

export class AppPublisher implements Publisher {
  private readonly o: AppPublisherOptions;
  constructor(o: AppPublisherOptions) {
    this.o = o;
  }

  /** Fetch the canonical branch with the app's installation token. The token goes through the environment, never the command line. */
  async fetchCanonical(ref: string): Promise<string> {
    const s = splitCanonicalRef(ref);
    if (!s) throw new PublishError('BAD_INPUT', `"${ref}" is not a remote/branch reference.`, false);
    const https = /^https:\/\//i.test(this.o.gitUrl);
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    if (https) {
      const token = await this.o.tokens.token();
      Object.assign(env, {
        GIT_CONFIG_COUNT: '2',
        GIT_CONFIG_KEY_0: 'http.extraheader',
        GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
        // The app's identity only: never fall back to a credential helper that holds a personal token.
        GIT_CONFIG_KEY_1: 'credential.helper',
        GIT_CONFIG_VALUE_1: '',
      });
    }
    try {
      await run('git', ['fetch', '--quiet', this.o.gitUrl, `+refs/heads/${s.branch}:refs/remotes/${s.remote}/${s.branch}`], { cwd: this.o.root, env, timeout: 90_000, windowsHide: true });
      const r = await run('git', ['rev-parse', '--verify', `refs/remotes/${s.remote}/${s.branch}^{commit}`], { cwd: this.o.root, windowsHide: true });
      return String(r.stdout).trim();
    } catch (e) {
      const msg = String((e as { stderr?: string }).stderr ?? (e as Error).message).replace(/Authorization:[^\n]*/gi, '[redacted]').slice(0, 200);
      throw new PublishError('FETCH_FAILED', `Could not fetch ${ref} from GitHub: ${msg}`, true);
    }
  }

  async remoteBranchSha(_remote: string, branch: string): Promise<string | null> {
    const r = await this.o.api.request<{ object?: { sha?: string } }>('GET', `/repos/${this.o.repo}/git/ref/heads/${branch}`, undefined, { allow404: true });
    return r.status === 404 ? null : (r.data.object?.sha ?? null);
  }

  /** Creates the objects for one commit on top of baseSha that adds the given files and nothing else. Nothing refers to it yet. */
  async buildCommit(a: { baseSha: string; files: { path: string; content: string }[]; author: { name: string; email: string }; message: string; now: Date }): Promise<string> {
    if (!/^[0-9a-f]{40,64}$/.test(a.baseSha)) throw new PublishError('BAD_INPUT', 'baseSha is not a commit id.', false);
    for (const f of a.files) if (!FILE_RE.test(f.path)) throw new PublishError('BAD_INPUT', `Refusing to write ${f.path}: only review-event files are allowed.`, false);
    const { api, repo } = this.o;
    for (const f of a.files) {
      // Never overwrite: a path that already exists on the canonical commit means someone else got there first.
      const there = await api.request('GET', `/repos/${repo}/contents/${f.path}?ref=${a.baseSha}`, undefined, { allow404: true });
      if (there.status !== 404) throw new PublishError('BAD_INPUT', `${f.path} already exists on the canonical branch.`, false);
    }
    const base = await api.request<{ tree: { sha: string } }>('GET', `/repos/${repo}/git/commits/${a.baseSha}`);
    const entries: { path: string; mode: string; type: string; sha: string }[] = [];
    for (const f of a.files) {
      const blob = await api.request<{ sha: string }>('POST', `/repos/${repo}/git/blobs`, { content: Buffer.from(f.content, 'utf8').toString('base64'), encoding: 'base64' });
      entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.data.sha });
    }
    const tree = await api.request<{ sha: string }>('POST', `/repos/${repo}/git/trees`, { base_tree: base.data.tree.sha, tree: entries });
    const commit = await api.request<{ sha: string }>('POST', `/repos/${repo}/git/commits`, { message: a.message, tree: tree.data.sha, parents: [a.baseSha], author: { name: a.author.name, email: a.author.email, date: a.now.toISOString() } });
    return commit.data.sha;
  }

  /** Create a NEW branch at sha. An existing branch is never moved; if it is already there at the same commit, that is success. */
  async push(_remote: string, sha: string, branch: string): Promise<void> {
    if (!BRANCH_RE.test(branch)) throw new PublishError('BAD_INPUT', `Refusing to create "${branch}".`, false);
    if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new PublishError('BAD_INPUT', 'sha is not a commit id.', false);
    try {
      await this.o.api.request('POST', `/repos/${this.o.repo}/git/refs`, { ref: `refs/heads/${branch}`, sha });
    } catch (e) {
      if (e instanceof GitHubError && e.code === 'REJECTED') {
        const now = await this.remoteBranchSha('', branch);
        if (now === sha) return;
        throw new PublishError('PUSH_REJECTED', `GitHub did not accept the branch: ${e.message}`, false);
      }
      throw e;
    }
  }
}
