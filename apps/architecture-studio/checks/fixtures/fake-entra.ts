// A stand-in for Microsoft Entra ID, for tests only. It speaks just enough OpenID Connect for the Studio's sign-in: discovery, the
// authorization endpoint, the token endpoint (with PKCE and client-secret checks) and the JWKS. It can mint deliberately bad ID
// tokens. It is NOT Microsoft: nothing proven against it proves the Studio works against a real tenant.
import crypto from 'node:crypto';
import http from 'node:http';
import { policyJson } from './review-fixture.ts';

export interface FakeUser {
  oid: string;
  upn: string;
  name: string;
  roles?: string[];
  groups?: string[];
  amr?: string[];
}

export interface TokenFault {
  /** Header overrides, for example { alg: 'none' } or { kid: 'other' }. */
  header?: Record<string, unknown>;
  /** Claim overrides. A value of undefined removes the claim. */
  claims?: Record<string, unknown>;
  /** Sign with this key instead of the published one. */
  signWith?: crypto.KeyObject;
  /** Sign with HMAC (HS256) using this secret instead of RSA. */
  hmacSecret?: string | Buffer;
  /** Leave the signature empty. */
  unsigned?: boolean;
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const GUID = (n: number) => `${'0'.repeat(8)}-0000-0000-0000-${String(n).padStart(12, '0')}`;
export const guid = GUID;

export class FakeEntra {
  readonly tenantId: string;
  readonly clientId = 'client-00000000-test';
  readonly secret = 'fake-client-secret';
  readonly authority: string;
  readonly kid = 'fake-kid-1';
  readonly key = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  readonly otherKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  user: FakeUser | null = null;
  fault: TokenFault = {};
  nowMs: () => number = Date.now;
  readonly codes = new Map<string, { user: FakeUser; nonce: string; challenge: string; redirectUri: string }>();
  readonly seen: string[] = [];
  private server: http.Server | null = null;

  constructor(authority = 'https://login.fake.test', tenantId = GUID(1)) {
    this.authority = authority.replace(/\/+$/, '');
    this.tenantId = tenantId;
  }

  get issuer() {
    return `${this.authority}/${this.tenantId}/v2.0`;
  }

  config(redirectUri: string, secretFile: string) {
    return { tenantId: this.tenantId, clientId: this.clientId, clientSecretFile: secretFile, redirectUri, authority: this.authority };
  }

  /** Mint an ID token. Faults apply on top of a normal token for the given user. */
  mint(user: FakeUser, nonce: string, fault: TokenFault = this.fault): string {
    const now = Math.floor(this.nowMs() / 1000);
    const claims: Record<string, unknown> = {
      iss: this.issuer,
      aud: this.clientId,
      tid: this.tenantId,
      ver: '2.0',
      iat: now,
      nbf: now,
      exp: now + 3600,
      nonce,
      oid: user.oid,
      sub: `sub-${user.oid}`,
      name: user.name,
      preferred_username: user.upn,
      roles: user.roles ?? [],
      amr: user.amr ?? ['pwd', 'mfa'],
      ...(user.groups ? { groups: user.groups } : {}),
    };
    for (const [k, v] of Object.entries(fault.claims ?? {})) {
      if (v === undefined) delete claims[k];
      else claims[k] = v;
    }
    const header: Record<string, unknown> = { alg: fault.hmacSecret ? 'HS256' : 'RS256', typ: 'JWT', kid: this.kid, ...fault.header };
    const signingInput = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
    if (fault.unsigned || header.alg === 'none') return `${signingInput}.`;
    if (fault.hmacSecret) return `${signingInput}.${crypto.createHmac('sha256', fault.hmacSecret).update(signingInput).digest('base64url')}`;
    const key = fault.signWith ?? this.key.privateKey;
    return `${signingInput}.${crypto.sign('RSA-SHA256', Buffer.from(signingInput), key).toString('base64url')}`;
  }

  jwks() {
    return { keys: [{ ...(this.key.publicKey.export({ format: 'jwk' }) as object), kid: this.kid, use: 'sig', alg: 'RS256' }] };
  }

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    this.seen.push(`${req.method} ${url.pathname}`);
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    const t = this.tenantId;
    if (url.pathname === `/${t}/v2.0/.well-known/openid-configuration`) {
      return json({ issuer: this.issuer, authorization_endpoint: `${this.authority}/${t}/oauth2/v2.0/authorize`, token_endpoint: `${this.authority}/${t}/oauth2/v2.0/token`, jwks_uri: `${this.authority}/${t}/discovery/v2.0/keys` });
    }
    if (url.pathname === `/${t}/discovery/v2.0/keys`) return json(this.jwks());
    if (url.pathname === `/${t}/oauth2/v2.0/authorize`) {
      const q = url.searchParams;
      const redirectUri = q.get('redirect_uri') ?? '';
      if (q.get('client_id') !== this.clientId || q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) return json({ error: 'invalid_request' }, 400);
      const back = new URL(redirectUri);
      if (!this.user) {
        back.searchParams.set('error', 'access_denied');
        back.searchParams.set('state', q.get('state') ?? '');
        return new Response(null, { status: 302, headers: { location: back.toString() } });
      }
      const code = `code-${crypto.randomBytes(12).toString('hex')}`;
      this.codes.set(code, { user: this.user, nonce: q.get('nonce') ?? '', challenge: q.get('code_challenge')!, redirectUri });
      back.searchParams.set('code', code);
      back.searchParams.set('state', q.get('state') ?? '');
      return new Response(null, { status: 302, headers: { location: back.toString() } });
    }
    if (url.pathname === `/${t}/oauth2/v2.0/token` && req.method === 'POST') {
      const f = new URLSearchParams(await req.text());
      const rec = this.codes.get(f.get('code') ?? '');
      this.codes.delete(f.get('code') ?? '');
      if (!rec) return json({ error: 'invalid_grant' }, 400);
      if (f.get('client_secret') !== this.secret || f.get('client_id') !== this.clientId) return json({ error: 'invalid_client' }, 401);
      if (f.get('redirect_uri') !== rec.redirectUri) return json({ error: 'invalid_grant' }, 400);
      const challenge = crypto.createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url');
      if (challenge !== rec.challenge) return json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
      return json({ token_type: 'Bearer', id_token: this.mint(rec.user, rec.nonce) });
    }
    if (url.pathname === '/__control' && req.method === 'POST') {
      const b = (await req.json()) as { user?: FakeUser | null; fault?: TokenFault };
      if ('user' in b) this.user = b.user ?? null;
      if ('fault' in b) this.fault = b.fault ?? {};
      return json({ ok: true });
    }
    return json({ error: 'not_found' }, 404);
  }

  /** For unit tests: a fetch that never leaves the process. */
  fetch: typeof fetch = (input, init) => this.handle(new Request(input as RequestInfo, init));

  listen(port: number): Promise<void> {
    this.server = http.createServer(async (rq, rs) => {
      const chunks: Buffer[] = [];
      for await (const c of rq) chunks.push(c as Buffer);
      const body = Buffer.concat(chunks);
      const r = await this.handle(new Request(`http://localhost:${port}${rq.url}`, { method: rq.method, headers: rq.headers as Record<string, string>, body: rq.method === 'GET' || rq.method === 'HEAD' ? undefined : body }));
      rs.writeHead(r.status, Object.fromEntries(r.headers));
      rs.end(Buffer.from(await r.arrayBuffer()));
    });
    return new Promise((resolve) => this.server!.listen(port, '127.0.0.1', resolve));
  }

  close() {
    this.server?.close();
  }
}

// ---------------------------------------------------------------- the people used by the browser tests

const TENANT = GUID(1);
export const E2E_USERS = {
  owner: { oid: GUID(11), upn: 'owner@fake.test', name: 'Olivia Owner', roles: ['Studio.ArchitectureOwner'] },
  owner2: { oid: GUID(12), upn: 'owner2@fake.test', name: 'Omar Owner', roles: ['Studio.ArchitectureOwner'] },
  admin: { oid: GUID(13), upn: 'admin@fake.test', name: 'Ada Admin', roles: ['Studio.Administrator'] },
  security: { oid: GUID(14), upn: 'security@fake.test', name: 'Sam Security', roles: ['Studio.SecurityReviewer'] },
  contributor: { oid: GUID(15), upn: 'contrib@fake.test', name: 'Cleo Contributor', roles: ['Studio.Contributor'] },
  // Holds a Viewer assignment in Entra and no enrollment: may read.
  viewer: { oid: GUID(16), upn: 'viewer@fake.test', name: 'Vic Viewer', roles: ['Studio.Viewer'] },
  // Signed in to the tenant with no Studio role at all.
  norole: { oid: GUID(17), upn: 'norole@fake.test', name: 'Nora NoRole', roles: [] },
  // Entra assigns the privileged role, but nobody enrolled this person: must get nothing privileged.
  unenrolled: { oid: GUID(18), upn: 'unenrolled@fake.test', name: 'Una Unenrolled', roles: ['Studio.ArchitectureOwner'] },
} satisfies Record<string, FakeUser>;

const enrolled = (u: FakeUser, roles: string[]) => ({
  subject: `entra:${TENANT}:${u.oid}`,
  kind: 'human',
  login: u.upn,
  holder: u.name,
  roles,
  enrolledAt: '2026-01-01T00:00:00Z',
  enrollment: { basis: 'bootstrap', requestedBy: null, approvedBy: null, reference: 'browser-test fixture' },
});

/** The access policy for the Entra browser tests. Real people are not in it: only the stand-in tenant's. */
export function entraE2ePolicy(): string {
  const U = E2E_USERS;
  return policyJson({
    tenantId: TENANT,
    approvalProviders: ['entra'],
    people: [enrolled(U.owner, ['architecture-owner']), enrolled(U.owner2, ['architecture-owner']), enrolled(U.admin, ['administrator']), enrolled(U.security, ['security-reviewer']), enrolled(U.contributor, ['contributor'])],
    ownership: [
      { domain: 'architecture', scope: { all: true }, owners: [`entra:${TENANT}:${U.owner.oid}`, `entra:${TENANT}:${U.owner2.oid}`] },
      { domain: 'security', scope: { all: true }, owners: [`entra:${TENANT}:${U.security.oid}`] },
    ],
  });
}