// A small GitHub REST client with the failure handling the sync needs:
//   - 401: the installation token expired or was revoked. Get a fresh one and try again once; a second 401 is a credential
//     problem a person must fix, and it is reported as one, not retried.
//   - rate limits (primary and secondary): wait if GitHub says the wait is short, otherwise stop and report when to try again.
//   - network failures and 5xx: GET requests are retried with backoff. Writes are not retried blindly; the pipeline above is
//     built so that calling it again is safe, and it checks what already happened.
// No error message ever contains a token or an Authorization header.
import { GitHubError } from '../workflow/github.ts';
import type { TokenSource } from './app-auth.ts';

export interface ApiOptions {
  baseUrl: string;
  tokens: TokenSource;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** The longest the client will wait on a rate limit before giving up and reporting it. */
  maxWaitMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface ApiResult<T> {
  status: number;
  data: T;
  headers: Headers;
}

export interface RateLimitSeen {
  remaining: number | null;
  resetAt: string | null;
  limited: boolean;
  at: string;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class GitHubApi {
  private readonly o: Required<Omit<ApiOptions, 'tokens'>> & { tokens: TokenSource };
  rate: RateLimitSeen | null = null;
  requests = 0;

  constructor(o: ApiOptions) {
    this.o = { fetchImpl: fetch, sleep: defaultSleep, now: Date.now, maxWaitMs: 10_000, maxRetries: 3, timeoutMs: 15_000, ...o, baseUrl: o.baseUrl.replace(/\/+$/, '') };
  }

  async request<T = unknown>(method: 'GET' | 'POST', path: string, body?: unknown, opts: { allow404?: boolean } = {}): Promise<ApiResult<T>> {
    let forced = false;
    let attempt = 0;
    for (;;) {
      attempt++;
      const token = await this.o.tokens.token(forced);
      let res: Response;
      this.requests++;
      try {
        res = await this.o.fetchImpl(`${this.o.baseUrl}${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'greenfuel-architecture-studio', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.o.timeoutMs),
        });
      } catch {
        if (method === 'GET' && attempt <= this.o.maxRetries) {
          await this.o.sleep(250 * 2 ** (attempt - 1));
          continue;
        }
        throw new GitHubError('Could not reach GitHub (network error or timeout). Nothing was lost; try again.', true, { code: 'NETWORK' });
      }
      this.noteRate(res);
      const data = (await res.json().catch(() => null)) as T;
      if (res.ok) return { status: res.status, data, headers: res.headers };
      if (res.status === 404 && opts.allow404) return { status: 404, data, headers: res.headers };

      const message = String((data as { message?: string } | null)?.message ?? '').slice(0, 200);
      if (res.status === 401) {
        if (!forced) {
          forced = true; // the cached installation token may simply have expired
          continue;
        }
        throw new GitHubError('GitHub rejected the app credentials even after renewing the token. The app may be suspended, uninstalled or its key revoked. Fix that, then retry: nothing was lost.', true, { code: 'AUTH' });
      }
      const wait = this.rateLimitWaitMs(res, message);
      if (wait !== null) {
        if (wait <= this.o.maxWaitMs && attempt <= this.o.maxRetries) {
          await this.o.sleep(wait);
          continue;
        }
        throw new GitHubError(`GitHub is rate limiting the Studio. Try again in ${Math.ceil(wait / 1000)} seconds.`, true, { code: 'RATE_LIMIT', retryAfterMs: wait });
      }
      if (res.status >= 500) {
        if (method === 'GET' && attempt <= this.o.maxRetries) {
          await this.o.sleep(250 * 2 ** (attempt - 1));
          continue;
        }
        throw new GitHubError(`GitHub had a server problem (HTTP ${res.status}). Try again.`, true, { code: 'SERVER' });
      }
      const retryable = false;
      throw new GitHubError(`GitHub refused the request (HTTP ${res.status}${message ? `: ${message}` : ''}).`, retryable, { code: res.status === 404 ? 'NOT_FOUND' : res.status === 403 || res.status === 422 ? 'REJECTED' : 'GITHUB_ERROR' });
    }
  }

  private noteRate(res: Response) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    if (remaining === null && reset === null) return;
    this.rate = { remaining: remaining === null ? null : Number(remaining), resetAt: reset ? new Date(Number(reset) * 1000).toISOString() : null, limited: remaining === '0', at: new Date(this.o.now()).toISOString() };
  }

  /** Milliseconds to wait if this response is a rate limit, otherwise null. */
  private rateLimitWaitMs(res: Response, message: string): number | null {
    if (res.status !== 403 && res.status !== 429) return null;
    const retryAfter = res.headers.get('retry-after');
    if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    if (remaining === '0' && reset) return Math.max(0, Number(reset) * 1000 - this.o.now()) + 500;
    if (/rate limit|abuse|secondary/i.test(message)) return 60_000;
    return null;
  }
}
