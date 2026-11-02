// Microsoft Entra ID sign-in: OpenID Connect authorization code flow with PKCE, from a confidential client.
//
// What is checked, and why:
//   - state and nonce are random, single-use, and tied to the browser that started the sign-in (a cookie), so a callback replayed,
//     forged, or delivered to a different browser is refused;
//   - the code exchange sends the PKCE verifier and the client secret, over the token endpoint named by discovery, whose host
//     must be the configured authority's host (a discovery document cannot redirect the exchange somewhere else);
//   - the ID token must be RS256 (never `none`, never an HMAC keyed with a public key), signed by a key in the issuer's JWKS,
//     issued by THIS tenant, for THIS client, unexpired, carrying the nonce we sent, and for a person (not an application);
//   - roles come from the token's `roles` claim (Entra app roles) or `groups`, mapped by the access policy. A token with the
//     groups-overage marker gets no group roles: the Studio fails closed instead of guessing.
// Nothing from Entra is kept except what a session needs. No access token or refresh token is requested or stored.
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { Principal } from './authorize.ts';
import type { EntraConfig } from './config.ts';

/** A sign-in name for Microsoft's login_hint: an email-shaped value of a sensible length, or nothing. Anything else is ignored, not rejected. */
export function safeLoginHint(v: string | null | undefined): string | null {
  if (!v || v.length > 200) return null;
  return /^[A-Za-z0-9._%+'-]{1,80}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(v) ? v : null;
}
export class EntraError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'EntraError';
    this.code = code;
  }
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface Jwk {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
  use?: string;
}

export interface Pending {
  state: string;
  nonce: string;
  verifier: string;
  /** sha256 of the browser-binding cookie value. */
  binding: string;
  reauth: boolean;
  createdAt: number;
}

export interface EntraDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  readSecret?: () => string;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const b64u = (b: Buffer) => b.toString('base64url');
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest();
const PENDING_TTL_MS = 10 * 60_000;
const SKEW_S = 60;
const MFA = new Set(['mfa', 'ngcmfa']);

export class EntraClient {
  private readonly cfg: EntraConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly readSecret: () => string;
  private readonly pending = new Map<string, Pending>();
  private disc: { at: number; d: Discovery } | null = null;
  private jwks: { at: number; keys: Jwk[] } | null = null;
  private lastJwksRefetch = 0;

  constructor(cfg: EntraConfig, deps: EntraDeps = {}) {
    this.cfg = cfg;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? Date.now;
    this.readSecret = deps.readSecret ?? (() => fs.readFileSync(cfg.clientSecretFile, 'utf8').trim());
  }

  get issuer() {
    return `${this.cfg.authority}/${this.cfg.tenantId}/v2.0`;
  }

  private async getJson<T>(url: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json' } });
    } catch {
      throw new EntraError('idp-unreachable', 'Microsoft Entra ID could not be reached.');
    }
    if (!res.ok) throw new EntraError('idp-error', `Microsoft Entra ID answered HTTP ${res.status}.`);
    return (await res.json()) as T;
  }

  private async discovery(): Promise<Discovery> {
    if (this.disc && this.now() - this.disc.at < 3_600_000) return this.disc.d;
    const d = await this.getJson<Discovery>(`${this.cfg.authority}/${this.cfg.tenantId}/v2.0/.well-known/openid-configuration`);
    const host = new URL(this.cfg.authority).host;
    for (const u of [d.authorization_endpoint, d.token_endpoint, d.jwks_uri]) {
      let h = '';
      try {
        h = new URL(u).host;
      } catch {
        /* handled below */
      }
      if (!h || (h !== host && !h.endsWith(`.${host}`))) throw new EntraError('bad-discovery', 'The discovery document points outside the configured authority, so it was not trusted.');
    }
    // The issuer Entra publishes can carry a {tenantid} placeholder; the token's own issuer is checked against the configured one.
    this.disc = { at: this.now(), d };
    return d;
  }

  /** Starts a sign-in. `reauth` forces a fresh interactive login, for approvals. Returns where to send the browser, and the value to put in the binding cookie. */
  async begin(opts: { reauth: boolean; maxAgeSeconds: number; loginHint?: string | null }): Promise<{ url: string; bindingCookie: string }> {
    const d = await this.discovery();
    const state = b64u(crypto.randomBytes(24));
    const nonce = b64u(crypto.randomBytes(24));
    const verifier = b64u(crypto.randomBytes(48));
    const bindingCookie = b64u(crypto.randomBytes(24));
    this.sweep();
    this.pending.set(state, { state, nonce, verifier, binding: b64u(sha256(bindingCookie)), reauth: opts.reauth, createdAt: this.now() });
    const q = new URLSearchParams({
      client_id: this.cfg.clientId,
      response_type: 'code',
      redirect_uri: this.cfg.redirectUri,
      response_mode: 'query',
      scope: 'openid profile',
      state,
      nonce,
      code_challenge: b64u(sha256(verifier)),
      code_challenge_method: 'S256',
      max_age: String(opts.maxAgeSeconds),
      ...(opts.reauth ? { prompt: 'login' } : {}),
      // Only a hint: it chooses which account Microsoft offers when the browser is already signed in as someone else. It grants nothing;
      // the person is still identified by the signed token and must be enrolled.
      ...(safeLoginHint(opts.loginHint) ? { login_hint: safeLoginHint(opts.loginHint)! } : {}),
    });
    return { url: `${d.authorization_endpoint}?${q.toString()}`, bindingCookie };
  }

  private sweep() {
    const t = this.now();
    for (const [k, v] of this.pending) if (t - v.createdAt > PENDING_TTL_MS) this.pending.delete(k);
  }

  /** Finishes a sign-in. The pending record is consumed first, so a second use of the same callback always fails. */
  async complete(p: { code: string | null; state: string | null; error: string | null; bindingCookie: string | undefined }): Promise<{ principal: Principal; reauth: boolean }> {
    if (p.error) throw new EntraError('idp-refused', 'Microsoft Entra ID did not complete the sign-in.');
    if (!p.state || !p.code) throw new EntraError('bad-callback', 'The sign-in response is missing its state or code.');
    this.sweep();
    const pend = this.pending.get(p.state);
    this.pending.delete(p.state);
    if (!pend) throw new EntraError('unknown-state', 'This sign-in was not started here, has expired, or was already used.');
    if (!p.bindingCookie || !crypto.timingSafeEqual(sha256(p.bindingCookie), Buffer.from(pend.binding, 'base64url'))) throw new EntraError('browser-mismatch', 'This sign-in was started in a different browser.');
    if (p.code.length > 4096) throw new EntraError('bad-callback', 'The sign-in code is too long.');

    const d = await this.discovery();
    let res: Response;
    try {
      res = await this.fetchImpl(d.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: p.code, redirect_uri: this.cfg.redirectUri, client_id: this.cfg.clientId, client_secret: this.readSecret(), code_verifier: pend.verifier }).toString(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new EntraError('idp-unreachable', 'Microsoft Entra ID could not be reached to finish the sign-in.');
    }
    const body = (await res.json().catch(() => null)) as { id_token?: string } | null;
    if (!res.ok || !body?.id_token) throw new EntraError('code-refused', 'Microsoft Entra ID refused the sign-in code.');
    const principal = await this.validateIdToken(body.id_token, pend.nonce, pend.reauth);
    return { principal, reauth: pend.reauth };
  }

  private async keys(kid: string): Promise<Jwk | undefined> {
    const d = await this.discovery();
    const fresh = this.jwks && this.now() - this.jwks.at < 3_600_000;
    if (!fresh) {
      this.jwks = { at: this.now(), keys: (await this.getJson<{ keys: Jwk[] }>(d.jwks_uri)).keys ?? [] };
    }
    let k = this.jwks!.keys.find((x) => x.kid === kid && x.kty === 'RSA');
    // A new signing key may have been published: look once more, but no more than once a minute.
    if (!k && this.now() - this.lastJwksRefetch > 60_000) {
      this.lastJwksRefetch = this.now();
      this.jwks = { at: this.now(), keys: (await this.getJson<{ keys: Jwk[] }>(d.jwks_uri)).keys ?? [] };
      k = this.jwks.keys.find((x) => x.kid === kid && x.kty === 'RSA');
    }
    return k;
  }

  /** Every check on the ID token. Exported for tests through EntraClient; there is no way to skip any of them. */
  async validateIdToken(jwt: string, nonce: string, reauth: boolean): Promise<Principal> {
    const parts = jwt.split('.');
    if (parts.length !== 3 || jwt.length > 16_384) throw new EntraError('bad-token', 'The identity token is malformed.');
    let header: { alg?: string; kid?: string; typ?: string };
    let c: Record<string, unknown>;
    try {
      header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'));
      c = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    } catch {
      throw new EntraError('bad-token', 'The identity token is malformed.');
    }
    if (header.alg !== 'RS256') throw new EntraError('bad-alg', 'The identity token is not signed with RS256.');
    if (typeof header.kid !== 'string') throw new EntraError('bad-token', 'The identity token names no signing key.');
    const jwk = await this.keys(header.kid);
    if (!jwk) throw new EntraError('unknown-key', 'The identity token is signed by a key the issuer does not publish.');
    let ok = false;
    try {
      ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' }), Buffer.from(parts[2]!, 'base64url'));
    } catch {
      ok = false;
    }
    if (!ok) throw new EntraError('bad-signature', 'The identity token signature is not valid.');

    const nowS = Math.floor(this.now() / 1000);
    const str = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : '');
    const num = (k: string) => (typeof c[k] === 'number' ? (c[k] as number) : null);
    if (str('iss') !== this.issuer) throw new EntraError('bad-issuer', 'The identity token was not issued by the configured tenant.');
    if (str('tid').toLowerCase() !== this.cfg.tenantId) throw new EntraError('bad-tenant', 'The identity token is for a different tenant.');
    const aud = c.aud;
    if (aud !== this.cfg.clientId && !(Array.isArray(aud) && aud.length === 1 && aud[0] === this.cfg.clientId)) throw new EntraError('bad-audience', 'The identity token is for a different application.');
    const exp = num('exp');
    if (exp === null || exp + SKEW_S < nowS) throw new EntraError('expired', 'The identity token has expired.');
    const nbf = num('nbf');
    if (nbf !== null && nbf - SKEW_S > nowS) throw new EntraError('not-yet-valid', 'The identity token is not valid yet.');
    const iat = num('iat');
    if (iat === null || iat - SKEW_S > nowS) throw new EntraError('bad-iat', 'The identity token has no valid issue time.');
    if (reauth && nowS - iat > 300) throw new EntraError('stale-login', 'A fresh sign-in was required and this one is not recent.');
    if (str('nonce') !== nonce) throw new EntraError('bad-nonce', 'The identity token does not answer this sign-in.');
    if (c.ver !== undefined && c.ver !== '2.0') throw new EntraError('bad-version', 'The identity token is not a v2.0 token.');
    if (c.idtyp === 'app') throw new EntraError('not-a-person', 'An application identity cannot sign in to the Studio.');
    const oid = str('oid').toLowerCase();
    if (!GUID.test(oid) || !str('sub')) throw new EntraError('bad-subject', 'The identity token has no stable user identifier.');

    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    const overage = !!(c._claim_names && typeof c._claim_names === 'object' && 'groups' in (c._claim_names as object));
    const amr = strs(c.amr);
    return {
      provider: 'entra',
      subject: `${this.cfg.tenantId}:${oid}`,
      tenantId: this.cfg.tenantId,
      login: str('preferred_username') || str('upn') || str('email') || oid,
      name: str('name') || null,
      id: null,
      type: 'User',
      verifiedBy: 'entra-oidc',
      entraRoles: strs(c.roles),
      // With the overage marker the groups are not in the token. Fail closed: no group-derived role is granted.
      entraGroups: overage ? [] : strs(c.groups),
      mfa: amr.some((x) => MFA.has(x)),
      authAt: iat * 1000,
    };
  }
}
