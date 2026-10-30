// A stand-in for the GitHub REST API, for tests only. It is NOT GitHub: it implements just the endpoints the Studio's GitHub App
// client uses, over a real bare git repository, so branches, commits, trees and merges are genuine git. What it simulates, and
// what it lets a test break on purpose:
//   - GitHub App auth: it verifies the app's RS256 JWT (signature, issuer, expiry, 10 minute limit) before issuing a token, and
//     it rejects expired or revoked installation tokens with 401, as GitHub does;
//   - rate limits (429 / 403 with Retry-After or x-ratelimit-*), server errors, dropped connections;
//   - checks, statuses and reviews on a pull request, a merge by "a person", and closing without merging.
// It records every request so tests can prove what the Studio did and did not do (for example, never touching the main branch).
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export interface FakeOptions {
  remoteGitDir: string;
  repo: string;
  appId: string;
  installationId: string;
  publicKeyPem: string;
  tokenTtlMs?: number;
  /** Lets a test driver (the browser tests) steer the stand-in over HTTP, under /_control/. Not part of any real GitHub API. */
  allowControl?: boolean;
}

interface Pull {
  number: number;
  title: string;
  body: string;
  head: string;
  base: string;
  closed: boolean;
  mergedBy: string | null;
  headSha: string;
}

export interface RequestLog {
  method: string;
  path: string;
  auth: 'jwt' | 'token' | 'none';
  status: number;
  body?: unknown;
}

export class FakeGitHub {
  readonly o: Required<FakeOptions>;
  readonly log: RequestLog[] = [];
  readonly pulls: Pull[] = [];
  tokensIssued = 0;
  private server: http.Server | null = null;
  private readonly tokens = new Map<string, number>();
  private checks = new Map<string, { name: string; status: string; conclusion: string | null }[]>();
  private reviews = new Map<number, { state: string; user: { id: number } }[]>();
  private failures: { n: number; status: number; message: string }[] = [];
  private drops = 0;
  private limit: { n: number; status: number; headers: Record<string, string>; message: string } | null = null;
  private authBroken = false;
  private clockSkewMs = 0;

  constructor(o: FakeOptions) {
    this.o = { tokenTtlMs: 3_600_000, allowControl: false, ...o };
  }

  async start(port = 0): Promise<string> {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server!.listen(port, '127.0.0.1', r));
    return `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
  }

  async stop() {
    this.server?.closeAllConnections?.();
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }

  // ---- controls a test uses to make things go wrong, or right

  /** Every issued installation token stops working (it "expired"). */
  expireTokens() {
    for (const k of this.tokens.keys()) this.tokens.set(k, 0);
  }
  /** The next n API requests answer with this status. */
  failNext(n: number, status = 500, message = 'Server Error') {
    this.failures.push({ n, status, message });
  }
  /** The next n API requests lose their connection without an answer. */
  dropNext(n: number) {
    this.drops += n;
  }
  /** The next n requests are rate limited. */
  rateLimitNext(n: number, opts: { status?: 403 | 429; retryAfter?: number; resetInSeconds?: number; message?: string } = {}) {
    const headers: Record<string, string> = {};
    if (opts.retryAfter !== undefined) headers['retry-after'] = String(opts.retryAfter);
    if (opts.resetInSeconds !== undefined) {
      headers['x-ratelimit-remaining'] = '0';
      headers['x-ratelimit-reset'] = String(Math.floor(Date.now() / 1000) + opts.resetInSeconds);
    }
    this.limit = { n, status: opts.status ?? 403, headers, message: opts.message ?? 'API rate limit exceeded' };
  }
  /** The app is uninstalled or its key revoked: new installation tokens are refused. */
  breakAuth(on = true) {
    this.authBroken = on;
  }
  setChecks(sha: string, checks: { name: string; status: string; conclusion: string | null }[]) {
    this.checks.set(sha, checks);
  }
  setReviews(pr: number, reviews: { state: string; user: { id: number } }[]) {
    this.reviews.set(pr, reviews);
  }
  /** What a person does on GitHub: merge the pull request (fast-forward). */
  merge(n: number, by = 'a-reviewer') {
    const p = this.pull(n);
    const base = this.git(['rev-parse', `refs/heads/${p.base}`]).out;
    if (this.git(['merge-base', '--is-ancestor', base, p.headSha]).status !== 0) throw new Error('not a fast-forward: the pull request conflicts');
    this.git(['update-ref', `refs/heads/${p.base}`, p.headSha]);
    p.mergedBy = by;
  }
  close(n: number) {
    this.pull(n).closed = true;
  }
  /** Writes to refs, for asserting the Studio only ever creates branches under its own prefixes. */
  refWrites(): RequestLog[] {
    return this.log.filter((l) => /\/git\/refs/.test(l.path) && l.method !== 'GET');
  }

  // ---- implementation

  private pull(n: number): Pull {
    const p = this.pulls.find((x) => x.number === n);
    if (!p) throw new Error(`no pull request ${n}`);
    return p;
  }

  private git(args: string[], input?: string | Buffer, env: Record<string, string> = {}) {
    const r = spawnSync('git', ['--git-dir', this.o.remoteGitDir, ...args], { input, encoding: 'utf8', env: { ...process.env, ...env }, windowsHide: true });
    return { status: r.status, out: String(r.stdout ?? '').trim(), err: String(r.stderr ?? '') };
  }

  private merged(p: Pull): boolean {
    return p.mergedBy !== null || this.git(['merge-base', '--is-ancestor', p.headSha, `refs/heads/${p.base}`]).status === 0;
  }

  private rawPull(p: Pull) {
    const merged = this.merged(p);
    const checks = this.checks.get(p.headSha) ?? [];
    const failing = checks.some((c) => c.status === 'completed' && !['success', 'neutral', 'skipped'].includes(c.conclusion ?? ''));
    return {
      number: p.number,
      html_url: `https://github.invalid/${this.o.repo}/pull/${p.number}`,
      state: merged || p.closed ? 'closed' : 'open',
      merged,
      merged_at: merged ? new Date().toISOString() : null,
      merge_commit_sha: merged ? p.headSha : null,
      mergeable_state: failing ? 'blocked' : 'clean',
      head: { sha: p.headSha, ref: p.head },
      base: { ref: p.base },
      title: p.title,
    };
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url ?? '/', 'http://x');
    const method = req.method ?? 'GET';
    const bearer = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? '';
    const isJwt = bearer.split('.').length === 3;
    const entry: RequestLog = { method, path: url.pathname + url.search, auth: !bearer ? 'none' : isJwt ? 'jwt' : 'token', status: 0 };
    this.log.push(entry);
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      entry.status = status;
      res.writeHead(status, { 'content-type': 'application/json', 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4999', ...headers });
      res.end(JSON.stringify(body));
    };
    let body: any = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return send(400, { message: 'Problems parsing JSON' });
    }
    entry.body = method === 'POST' ? body : undefined;

    // ---- test control, never reachable unless the driver asked for it
    if (this.o.allowControl && url.pathname.startsWith('/_control/')) {
      const name = url.pathname.slice('/_control/'.length);
      if (name === 'state') {
        return send(200, { pulls: this.pulls.map((p) => ({ number: p.number, head: p.head, headSha: p.headSha, merged: this.merged(p), closed: p.closed })), refWrites: this.refWrites().map((l) => (l.body as { ref: string }).ref), tokensIssued: this.tokensIssued, requests: this.log.length, nonGetMethods: [...new Set(this.log.map((l) => l.method))] });
      }
      const allowed = ['expireTokens', 'failNext', 'dropNext', 'rateLimitNext', 'breakAuth', 'setChecks', 'setReviews', 'merge', 'close'] as const;
      if (!(allowed as readonly string[]).includes(name)) return send(404, { message: 'no such control' });
      try {
        (this as any)[name](...(Array.isArray(body.args) ? body.args : []));
        return send(200, { ok: true });
      } catch (e) {
        return send(409, { message: (e as Error).message });
      }
    }

    // ---- the token exchange: authenticated with the app's JWT
    const m = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(url.pathname);
    if (m) {
      if (this.authBroken) return send(401, { message: 'A JSON web token could not be decoded' });
      if (!isJwt || !this.checkJwt(bearer)) return send(401, { message: 'A JSON web token could not be decoded' });
      if (m[1] !== this.o.installationId) return send(404, { message: 'Not Found' });
      const name = this.o.repo.split('/')[1];
      if (!Array.isArray(body.repositories) || body.repositories.length !== 1 || body.repositories[0] !== name) return send(422, { message: 'The token must be scoped to exactly this repository' });
      const perms = body.permissions ?? {};
      if (Object.keys(perms).some((k) => !['contents', 'pull_requests', 'checks', 'statuses', 'metadata'].includes(k))) return send(422, { message: 'Permission not granted to this app' });
      this.tokensIssued++;
      const token = `ghs_${crypto.randomBytes(18).toString('hex')}`;
      const expires = Date.now() + this.o.tokenTtlMs + this.clockSkewMs;
      this.tokens.set(token, expires);
      return send(201, { token, expires_at: new Date(expires).toISOString(), permissions: perms });
    }

    // ---- everything else needs a live installation token
    const exp = this.tokens.get(bearer);
    if (!exp || exp <= Date.now()) return send(401, { message: 'Bad credentials' });
    if (this.drops > 0) {
      this.drops--;
      entry.status = -1;
      return void req.socket.destroy();
    }
    if (this.limit && this.limit.n > 0) {
      this.limit.n--;
      return send(this.limit.status, { message: this.limit.message }, this.limit.headers);
    }
    const f = this.failures[0];
    if (f && f.n > 0) {
      f.n--;
      if (f.n === 0) this.failures.shift();
      return send(f.status, { message: f.message });
    }

    const base = `/repos/${this.o.repo}`;
    if (!url.pathname.startsWith(`${base}/`)) return send(404, { message: 'Not Found' });
    const p = url.pathname.slice(base.length);

    let r: RegExpExecArray | null;
    if (method === 'GET' && (r = /^\/git\/ref\/(heads\/.+)$/.exec(p))) {
      const sha = this.git(['rev-parse', '--verify', `refs/${r[1]}`]);
      return sha.status === 0 ? send(200, { ref: `refs/${r[1]}`, object: { sha: sha.out, type: 'commit' } }) : send(404, { message: 'Not Found' });
    }
    if (method === 'POST' && p === '/git/refs') {
      if (typeof body.ref !== 'string' || !body.ref.startsWith('refs/heads/') || !/^[0-9a-f]{40}$/.test(body.sha ?? '')) return send(422, { message: 'Invalid ref or sha' });
      if (this.git(['rev-parse', '--verify', body.ref]).status === 0) return send(422, { message: 'Reference already exists' });
      if (this.git(['cat-file', '-e', `${body.sha}^{commit}`]).status !== 0) return send(422, { message: 'Object does not exist' });
      this.git(['update-ref', body.ref, body.sha]);
      return send(201, { ref: body.ref, object: { sha: body.sha } });
    }
    if (method === 'POST' && p === '/git/blobs') {
      const content = body.encoding === 'base64' ? Buffer.from(body.content, 'base64') : Buffer.from(String(body.content), 'utf8');
      const h = spawnSync('git', ['--git-dir', this.o.remoteGitDir, 'hash-object', '-w', '--stdin'], { input: content, encoding: 'utf8', windowsHide: true });
      return send(201, { sha: String(h.stdout).trim() });
    }
    if (method === 'GET' && (r = /^\/git\/commits\/([0-9a-f]{40})$/.exec(p))) {
      const t = this.git(['rev-parse', `${r[1]}^{tree}`]);
      return t.status === 0 ? send(200, { sha: r[1], tree: { sha: t.out } }) : send(404, { message: 'Not Found' });
    }
    if (method === 'POST' && p === '/git/trees') {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-gh-index-'));
      try {
        const env = { GIT_INDEX_FILE: path.join(tmp, 'index') };
        this.git(['read-tree', body.base_tree], undefined, env);
        for (const t of body.tree ?? []) this.git(['update-index', '--add', '--cacheinfo', `${t.mode},${t.sha},${t.path}`], undefined, env);
        const w = this.git(['write-tree'], undefined, env);
        return w.status === 0 ? send(201, { sha: w.out }) : send(422, { message: 'Could not write tree' });
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }
    if (method === 'POST' && p === '/git/commits') {
      const a = body.author ?? { name: 'GitHub App', email: 'app@users.noreply.github.com', date: new Date().toISOString() };
      const when = a.date ?? new Date().toISOString();
      const args = ['commit-tree', body.tree, ...(body.parents ?? []).flatMap((x: string) => ['-p', x]), '-m', body.message];
      const c = this.git(args, undefined, { GIT_AUTHOR_NAME: a.name, GIT_AUTHOR_EMAIL: a.email, GIT_AUTHOR_DATE: when, GIT_COMMITTER_NAME: 'greenfuel-studio[bot]', GIT_COMMITTER_EMAIL: 'bot@users.noreply.github.com', GIT_COMMITTER_DATE: when });
      return c.status === 0 ? send(201, { sha: c.out }) : send(422, { message: 'Could not write commit' });
    }
    if (method === 'GET' && (r = /^\/contents\/(.+)$/.exec(p))) {
      const ref = url.searchParams.get('ref') ?? 'main';
      return this.git(['cat-file', '-e', `${ref}:${decodeURIComponent(r[1]!)}`]).status === 0 ? send(200, { type: 'file' }) : send(404, { message: 'Not Found' });
    }
    if (method === 'POST' && p === '/pulls') {
      if (this.git(['rev-parse', '--verify', `refs/heads/${body.head}`]).status !== 0) return send(422, { message: 'Validation Failed: head invalid' });
      if (this.pulls.some((x) => x.head === body.head && !x.closed && !this.merged(x))) return send(422, { message: `A pull request already exists for ${this.o.repo.split('/')[0]}:${body.head}.` });
      const pr: Pull = { number: this.pulls.length + 1, title: body.title, body: body.body ?? '', head: body.head, base: body.base, closed: false, mergedBy: null, headSha: this.git(['rev-parse', `refs/heads/${body.head}`]).out };
      this.pulls.push(pr);
      return send(201, this.rawPull(pr));
    }
    if (method === 'GET' && p === '/pulls') {
      const head = url.searchParams.get('head');
      const wanted = head ? head.split(':').slice(1).join(':') : null;
      const list = this.pulls.filter((x) => !wanted || x.head === wanted).map((x) => this.rawPull(x));
      return send(200, list.slice(0, Number(url.searchParams.get('per_page') ?? 30)));
    }
    if (method === 'GET' && (r = /^\/pulls\/(\d+)$/.exec(p))) {
      const pr = this.pulls.find((x) => x.number === Number(r![1]));
      return pr ? send(200, this.rawPull(pr)) : send(404, { message: 'Not Found' });
    }
    if (method === 'GET' && (r = /^\/pulls\/(\d+)\/reviews$/.exec(p))) return send(200, this.reviews.get(Number(r[1])) ?? []);
    if (method === 'GET' && (r = /^\/commits\/([0-9a-f]{40})\/check-runs$/.exec(p))) return send(200, { total_count: (this.checks.get(r[1]!) ?? []).length, check_runs: this.checks.get(r[1]!) ?? [] });
    if (method === 'GET' && /^\/commits\/[0-9a-f]{40}\/status$/.test(p)) return send(200, { state: 'pending', statuses: [], total_count: 0 });
    return send(404, { message: 'Not Found' });
  }

  private checkJwt(jwt: string): boolean {
    const [h, b, s] = jwt.split('.');
    if (!h || !b || !s) return false;
    try {
      const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${b}`), this.o.publicKeyPem, Buffer.from(s, 'base64url'));
      if (!ok) return false;
      const head = JSON.parse(Buffer.from(h, 'base64url').toString());
      const c = JSON.parse(Buffer.from(b, 'base64url').toString()) as { iss?: string; iat?: number; exp?: number };
      const now = Math.floor(Date.now() / 1000);
      return head.alg === 'RS256' && String(c.iss) === this.o.appId && typeof c.exp === 'number' && c.exp > now && typeof c.iat === 'number' && c.iat <= now && c.exp - c.iat <= 10 * 60 + 60;
    } catch {
      return false;
    }
  }
}

/** A throw-away RSA key pair, as a GitHub App would hold. */
export function makeAppKeys(dir: string) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const privateKeyFile = path.join(dir, 'app-private-key.pem');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(privateKeyFile, privateKey, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'app-public-key.pem'), publicKey);
  return { publicKeyPem: publicKey, privateKeyPem: privateKey, privateKeyFile };
}
