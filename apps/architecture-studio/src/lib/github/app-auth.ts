// GitHub App authentication. The app signs a short-lived JWT with its private key, and exchanges it for an installation token
// that is scoped down to this one repository and the few permissions the Studio needs.
//
// The private key is read from a file on the server, held as an opaque key object, and never serialised, logged or sent to the
// browser. Installation tokens live only in memory and are refreshed shortly before they expire.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { inspect } from 'node:util';
import { GitHubError } from '../workflow/github.ts';

export interface TokenSource {
  /** A bearer token for the repository API. `force` discards the cached one (used after a 401). */
  token(force?: boolean): Promise<string>;
}

/** The only permissions the Studio asks for. GitHub rejects anything the app was not granted, so this can only narrow. */
export const APP_PERMISSIONS = { contents: 'write', pull_requests: 'write', checks: 'read', statuses: 'read', metadata: 'read' } as const;

export interface AppConfig {
  appId: string;
  installationId: string;
  /** owner/name */
  repo: string;
  privateKeyFile: string;
  apiUrl: string;
  /** Where git fetches from. Defaults to the repository on github.com. */
  gitUrl: string;
  webhookSecret: string | null;
}

/** Reads the configuration from the environment. Returns null when the app is not configured, so the Studio falls back to the CLI. */
export function appConfigFromEnv(env: Record<string, string | undefined> = process.env): AppConfig | null {
  const appId = env.STUDIO_GITHUB_APP_ID?.trim();
  const installationId = env.STUDIO_GITHUB_APP_INSTALLATION_ID?.trim();
  const repo = env.STUDIO_GITHUB_REPO?.trim();
  const privateKeyFile = env.STUDIO_GITHUB_APP_PRIVATE_KEY_FILE?.trim();
  if (!appId || !installationId || !repo || !privateKeyFile) return null;
  if (!/^\d+$/.test(appId) || !/^\d+$/.test(installationId)) throw new Error('STUDIO_GITHUB_APP_ID and STUDIO_GITHUB_APP_INSTALLATION_ID must be numbers.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('STUDIO_GITHUB_REPO must be owner/name.');
  const apiUrl = (env.STUDIO_GITHUB_API_URL?.trim() || 'https://api.github.com').replace(/\/+$/, '');
  return { appId, installationId, repo, privateKeyFile, apiUrl, gitUrl: env.STUDIO_GITHUB_GIT_URL?.trim() || `https://github.com/${repo}.git`, webhookSecret: env.STUDIO_GITHUB_WEBHOOK_SECRET?.trim() || null };
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** RS256 JWT for the GitHub App. GitHub allows at most 10 minutes; the issue time is set back a minute for clock drift. */
export function signAppJwt(key: crypto.KeyObject, appId: string, nowSeconds: number): string {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 9 * 60, iss: appId }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key);
  return `${head}.${body}.${b64url(sig)}`;
}

export class AppAuth implements TokenSource {
  private readonly key: crypto.KeyObject;
  private readonly cfg: Pick<AppConfig, 'appId' | 'installationId' | 'repo' | 'apiUrl'>;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => number;
  private cached: { token: string; expiresAt: number } | null = null;
  private inflight: Promise<string> | null = null;

  constructor(cfg: Pick<AppConfig, 'appId' | 'installationId' | 'repo' | 'apiUrl'> & { privateKeyPem: string }, opts: { fetchImpl?: typeof fetch; now?: () => number } = {}) {
    try {
      this.key = crypto.createPrivateKey(cfg.privateKeyPem);
    } catch {
      throw new GitHubError('The GitHub App private key could not be read. It must be a PEM-encoded RSA key.', false, { code: 'AUTH' });
    }
    this.cfg = { appId: cfg.appId, installationId: cfg.installationId, repo: cfg.repo, apiUrl: cfg.apiUrl };
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.clock = opts.now ?? Date.now;
  }

  static fromConfig(c: AppConfig, opts: { fetchImpl?: typeof fetch; now?: () => number } = {}): AppAuth {
    let pem: string;
    try {
      pem = fs.readFileSync(c.privateKeyFile, 'utf8');
    } catch {
      throw new GitHubError('The GitHub App private key file cannot be read.', false, { code: 'AUTH' });
    }
    return new AppAuth({ ...c, privateKeyPem: pem }, opts);
  }

  /** Nothing secret is ever serialised or printed. */
  toJSON() {
    return { appId: this.cfg.appId, installationId: this.cfg.installationId, repo: this.cfg.repo };
  }

  [inspect.custom]() {
    return `AppAuth(app ${this.cfg.appId}, installation ${this.cfg.installationId})`;
  }

  jwt(): string {
    return signAppJwt(this.key, this.cfg.appId, Math.floor(this.clock() / 1000));
  }

  /** When the cached token expires, for status display. Never the token itself. */
  tokenExpiresAt(): string | null {
    return this.cached ? new Date(this.cached.expiresAt).toISOString() : null;
  }

  async token(force = false): Promise<string> {
    if (!force && this.cached && this.cached.expiresAt - 60_000 > this.clock()) return this.cached.token;
    if (this.inflight) return this.inflight;
    this.inflight = this.exchange().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async exchange(): Promise<string> {
    const name = this.cfg.repo.split('/')[1]!;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.apiUrl}/app/installations/${this.cfg.installationId}/access_tokens`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.jwt()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'greenfuel-architecture-studio', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repositories: [name], permissions: APP_PERMISSIONS }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new GitHubError('Could not reach GitHub to obtain an installation token.', true, { code: 'NETWORK' });
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      throw new GitHubError(`GitHub refused the app credentials (HTTP ${res.status}). Check the app id, installation id and private key, and that the app is still installed, then retry: nothing was lost.`, true, { code: 'AUTH' });
    }
    if (!res.ok) throw new GitHubError(`GitHub could not issue an installation token (HTTP ${res.status}).`, res.status >= 500 || res.status === 429, { code: res.status >= 500 ? 'SERVER' : 'GITHUB_ERROR' });
    const body = (await res.json().catch(() => null)) as { token?: string; expires_at?: string } | null;
    if (!body?.token || !body.expires_at) throw new GitHubError('GitHub returned an installation token response the Studio could not read.', false, { code: 'AUTH' });
    this.cached = { token: body.token, expiresAt: Date.parse(body.expires_at) };
    return body.token;
  }
}
