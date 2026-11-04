// Security acceptance tests for authentication and authorization. Every test here states an attack or a failure and checks that the
// control holds. The stand-in IdP (fixtures/fake-entra.ts) is not Microsoft, so these prove the Studio's own checks, not Entra.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { parseAccessPolicy } from '../src/lib/auth/access-policy.ts';
import { authorizeAccess, authorizeDecision, authorizeWork, effectiveRoles, keyOf, type AuthContext, type Principal } from '../src/lib/auth/authorize.ts';
import { __setAuthForTests } from '../src/lib/auth/config.ts';
import { EntraClient, EntraError } from '../src/lib/auth/entra.ts';
import { checkRecord, type Authenticity } from '../src/lib/auth/authenticity.ts';
import { buildAccessReport } from '../src/lib/auth/review.ts';
import { SessionStore } from '../src/lib/auth/sessions.ts';
import { emptyTrust, trustFrom } from '../src/lib/auth/signing.ts';
import { SuspensionStore } from '../src/lib/auth/suspensions.ts';
import { eventId, eventPath, hashEvent, serializeEvent, type ActionKind, type ReviewEvent } from '../src/lib/workflow/events.ts';
import { LocalGitHub } from '../src/lib/workflow/github.ts';
import { FixtureIdentity, type VerifiedUser } from '../src/lib/workflow/identity.ts';
import { GitPublisher } from '../src/lib/workflow/publish.ts';
import { ReviewService, ServiceError } from '../src/lib/workflow/review.ts';
import { ReviewStore } from '../src/lib/workflow/store.ts';
import type { NormalizedDecision } from '../src/lib/intel/schema.ts';
import { FakeEntra, guid, type FakeUser } from './fixtures/fake-entra.ts';
import { USERS, git, installTestAuth, makeDecision, makeFixture, policyJson, subjectOf, type Fixture } from './fixtures/review-fixture.ts';

const auth = installTestAuth();
const fixtures: Fixture[] = [];
after(() => {
  for (const f of fixtures) f.cleanup();
});

const T0 = Date.parse('2026-10-30T00:00:00Z');
const code = (c: string) => (e: unknown) => e instanceof ServiceError && e.code === c;
const REASON = 'The residency analysis in the design review supports this choice.';

// ---------------------------------------------------------------- people and policy

const OWNER_OID = guid(11);
const OWNER2_OID = guid(12);
const ADMIN_OID = guid(13);
const SEC_OID = guid(14);
const CONTRIB_OID = guid(15);
const fe0 = new FakeEntra();
const TID = fe0.tenantId;
const ent = (oid: string) => `entra:${TID}:${oid}`;

const entraPerson = (oid: string, login: string, roles: string[], over: Record<string, unknown> = {}) => ({
  subject: ent(oid),
  kind: 'human',
  login,
  holder: login,
  roles,
  enrolledAt: '2026-01-01T00:00:00Z',
  enrollment: { basis: 'bootstrap', requestedBy: null, approvedBy: null, reference: 'test' },
  ...over,
});
const ENTRA_PEOPLE = [
  entraPerson(OWNER_OID, 'owner@fake.test', ['architecture-owner']),
  entraPerson(OWNER2_OID, 'owner2@fake.test', ['architecture-owner']),
  entraPerson(ADMIN_OID, 'admin@fake.test', ['administrator']),
  entraPerson(SEC_OID, 'sec@fake.test', ['security-reviewer']),
  entraPerson(CONTRIB_OID, 'contrib@fake.test', ['contributor']),
];
const ENTRA_OWNERSHIP = [
  { domain: 'architecture', scope: { all: true }, owners: [ent(OWNER_OID), ent(OWNER2_OID)] },
  { domain: 'security', scope: { all: true }, owners: [ent(SEC_OID)] },
];
const entraPolicy = (o: Parameters<typeof policyJson>[0] = {}) => parseAccessPolicy(policyJson({ tenantId: TID, people: ENTRA_PEOPLE, ownership: ENTRA_OWNERSHIP, ...o }), 'canonical');

const principal = (oid: string, roles: string[], over: Partial<Principal> = {}): Principal => ({ provider: 'entra', subject: `${TID}:${oid}`, tenantId: TID, login: `${oid}@fake.test`, name: null, id: null, type: 'User', verifiedBy: 'entra-oidc', entraRoles: roles, entraGroups: [], mfa: true, authAt: T0, ...over });
const ROLE_CLAIM = { owner: 'Studio.ArchitectureOwner', admin: 'Studio.Administrator', sec: 'Studio.SecurityReviewer', contrib: 'Studio.Contributor', viewer: 'Studio.Viewer' };
const ctxFor = (policy = entraPolicy(), over: Partial<AuthContext> = {}): AuthContext => ({ policy, now: T0 + 60_000, devApprovals: false, ...over });

const ARCH = { id: 'ADR-0900', kind: 'adr', approverText: 'Programme owner' };
const SEC = { id: 'D-901', kind: 'register-entry', approverText: 'Security architect' };
const REG = { id: 'D-902', kind: 'register-entry', approverText: 'Quality manager' };
const decide = (p: Principal, action: Parameters<typeof authorizeDecision>[0]['action'], rec = ARCH, ctx = ctxFor(), sod: { proposers?: string[]; recommenders?: { subject: string; recommendation: string | null }[] } = {}) => authorizeDecision({ principal: p, action, rec, proposers: sod.proposers ?? [], recommenders: sod.recommenders ?? [] }, ctx);

// ---------------------------------------------------------------- the ID token

const SECRET_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-secret-')), 'secret');
fs.writeFileSync(SECRET_FILE, 'fake-client-secret');
const REDIRECT = 'http://localhost:3999/api/v1/auth/entra/callback';

function entraWorld(over: { authority?: string } = {}) {
  const fe = new FakeEntra(over.authority);
  const clock = { now: Date.now() };
  fe.nowMs = () => clock.now;
  const cfg = fe.config(REDIRECT, SECRET_FILE);
  const client = new EntraClient(cfg, { fetchImpl: fe.fetch, now: () => clock.now, readSecret: () => fe.secret });
  const user: FakeUser = { oid: OWNER_OID, upn: 'owner@fake.test', name: 'Owner', roles: [ROLE_CLAIM.owner], amr: ['pwd', 'mfa'] };
  /** What a browser does: start, follow the redirect to the IdP, come back with code and state. */
  const browse = async (u: FakeUser | null = user, opts: { reauth?: boolean } = {}) => {
    fe.user = u;
    const b = await client.begin({ reauth: !!opts.reauth, maxAgeSeconds: 900 });
    const r = await fe.handle(new Request(b.url));
    const back = new URL(r.headers.get('location')!);
    return { binding: b.bindingCookie, code: back.searchParams.get('code'), state: back.searchParams.get('state'), error: back.searchParams.get('error'), url: b.url };
  };
  const signIn = async (u: FakeUser | null = user, opts: { reauth?: boolean } = {}) => {
    const x = await browse(u, opts);
    return client.complete({ code: x.code, state: x.state, error: x.error, bindingCookie: x.binding });
  };
  return { fe, client, clock, user, browse, signIn };
}
const failsWith = (c: string) => (e: unknown) => e instanceof EntraError && e.code === c;

describe('Entra ID token: every check refuses what it should', () => {
  it('accepts a good sign-in, maps roles and MFA, and takes authentication time from the token', async () => {
    const w = entraWorld();
    const r = await w.signIn();
    assert.equal(r.principal.provider, 'entra');
    assert.equal(r.principal.subject, `${TID}:${OWNER_OID}`);
    assert.deepEqual(r.principal.entraRoles, [ROLE_CLAIM.owner]);
    assert.equal(r.principal.mfa, true);
    assert.equal(r.principal.verifiedBy, 'entra-oidc');
    assert.ok(Math.abs(r.principal.authAt - Math.floor(w.clock.now / 1000) * 1000) < 2000);
    const single = await entraWorld().signIn({ ...w.user, amr: ['pwd'] });
    assert.equal(single.principal.mfa, false, 'no second factor claimed, none assumed');
  });

  const bad: [string, (w: ReturnType<typeof entraWorld>) => void, string][] = [
    ['alg none', (w) => (w.fe.fault = { header: { alg: 'none' } }), 'bad-alg'],
    ['HS256 keyed with the public key', (w) => (w.fe.fault = { hmacSecret: JSON.stringify(w.fe.jwks().keys[0]) }), 'bad-alg'],
    ['a signature from another key', (w) => (w.fe.fault = { signWith: w.fe.otherKey.privateKey }), 'bad-signature'],
    ['an unpublished key id', (w) => (w.fe.fault = { header: { kid: 'not-published' } }), 'unknown-key'],
    ['the wrong issuer', (w) => (w.fe.fault = { claims: { iss: 'https://evil.example/x/v2.0' } }), 'bad-issuer'],
    ['another tenant', (w) => (w.fe.fault = { claims: { tid: guid(999) } }), 'bad-tenant'],
    ['another application (audience)', (w) => (w.fe.fault = { claims: { aud: 'someone-elses-client' } }), 'bad-audience'],
    ['an expired token', (w) => (w.fe.fault = { claims: { exp: Math.floor(w.clock.now / 1000) - 3600 } }), 'expired'],
    ['a token not yet valid', (w) => (w.fe.fault = { claims: { nbf: Math.floor(w.clock.now / 1000) + 3600 } }), 'not-yet-valid'],
    ['a token issued in the future', (w) => (w.fe.fault = { claims: { iat: Math.floor(w.clock.now / 1000) + 3600, nbf: undefined } }), 'bad-iat'],
    ['the wrong nonce', (w) => (w.fe.fault = { claims: { nonce: 'replayed-nonce' } }), 'bad-nonce'],
    ['a v1 token', (w) => (w.fe.fault = { claims: { ver: '1.0' } }), 'bad-version'],
    ['an application identity', (w) => (w.fe.fault = { claims: { idtyp: 'app' } }), 'not-a-person'],
    ['no object id', (w) => (w.fe.fault = { claims: { oid: undefined } }), 'bad-subject'],
    ['an object id that is not a GUID', (w) => (w.fe.fault = { claims: { oid: 'admin' } }), 'bad-subject'],
  ];
  for (const [name, set, expected] of bad) {
    it(`refuses ${name}`, async () => {
      const w = entraWorld();
      set(w);
      await assert.rejects(w.signIn(), failsWith(expected));
    });
  }

  it('gives no group roles when the token says groups overflowed (fail closed)', async () => {
    const w = entraWorld();
    w.fe.fault = { claims: { groups: undefined, _claim_names: { groups: 'src1' } } };
    const r = await w.signIn({ ...w.user, groups: [guid(77)] });
    assert.deepEqual(r.principal.entraGroups, []);
  });

  it('a recently minted token is required for approvals: a reauth sign-in refuses a stale login', async () => {
    const w = entraWorld();
    w.fe.fault = { claims: { iat: Math.floor(w.clock.now / 1000) - 3000, nbf: Math.floor(w.clock.now / 1000) - 3000 } };
    await assert.rejects(w.signIn(w.user, { reauth: true }), failsWith('stale-login'));
    await w.signIn(w.user, { reauth: false });
  });

  it('sends PKCE, state, nonce, and prompt=login when a fresh sign-in is needed', async () => {
    const w = entraWorld();
    const x = await w.browse(w.user, { reauth: true });
    const q = new URL(x.url).searchParams;
    assert.equal(q.get('code_challenge_method'), 'S256');
    assert.ok(q.get('state') && q.get('nonce') && q.get('code_challenge'));
    assert.equal(q.get('prompt'), 'login');
    assert.equal(q.get('response_type'), 'code');
  });

  it('passes an email-shaped login_hint to Microsoft and drops anything else, and the hint grants nothing', async () => {
    const { safeLoginHint } = await import('../src/lib/auth/entra.ts');
    assert.equal(safeLoginHint('admin@MngEnvMCAP682563.onmicrosoft.com'), 'admin@MngEnvMCAP682563.onmicrosoft.com');
    for (const bad of [null, undefined, '', 'not an email', 'a@b', 'a@b.c d', 'x@y.com\r\nSet-Cookie: a=b', '<script>@x.io', 'a'.repeat(300) + '@x.io', 'a@b.com&prompt=none', 'a@b.com#frag']) assert.equal(safeLoginHint(bad as string), null, `ignored: ${String(bad).slice(0, 30)}`);
    const w = entraWorld();
    const q = new URL((await w.client.begin({ reauth: false, maxAgeSeconds: 900, loginHint: 'admin@MngEnvMCAP682563.onmicrosoft.com' })).url).searchParams;
    assert.equal(q.get('login_hint'), 'admin@MngEnvMCAP682563.onmicrosoft.com');
    const none = new URL((await w.client.begin({ reauth: false, maxAgeSeconds: 900, loginHint: 'a@b.com&prompt=none' })).url).searchParams;
    assert.equal(none.get('login_hint'), null);
    assert.equal(none.get('prompt'), null, 'an injected parameter does not reach Microsoft');
  });
  it('refuses a replayed callback, a callback in another browser, an unknown state, and an IdP error', async () => {
    const w = entraWorld();
    const a = await w.browse();
    await w.client.complete({ code: a.code, state: a.state, error: null, bindingCookie: a.binding });
    await assert.rejects(w.client.complete({ code: a.code, state: a.state, error: null, bindingCookie: a.binding }), failsWith('unknown-state'), 'replay');
    const b = await w.browse();
    await assert.rejects(w.client.complete({ code: b.code, state: b.state, error: null, bindingCookie: 'another-browsers-cookie' }), failsWith('browser-mismatch'));
    await assert.rejects(w.client.complete({ code: b.code, state: b.state, error: null, bindingCookie: b.binding }), failsWith('unknown-state'), 'the state was consumed even by the failed attempt');
    await assert.rejects(w.client.complete({ code: 'x', state: 'never-issued', error: null, bindingCookie: 'y' }), failsWith('unknown-state'));
    await assert.rejects(w.client.complete({ code: null, state: null, error: null, bindingCookie: undefined }), failsWith('bad-callback'));
    const c = await w.browse(null);
    assert.equal(c.error, 'access_denied');
    await assert.rejects(w.client.complete({ code: null, state: c.state, error: c.error, bindingCookie: c.binding }), failsWith('idp-refused'));
  });

  it('does not trust a discovery document that points outside the authority', async () => {
    const w = entraWorld();
    const real = w.fe.fetch;
    const evil: typeof fetch = async (i, init) => {
      const r = await real(i, init);
      if (String(i).endsWith('openid-configuration')) {
        const d = (await r.json()) as Record<string, string>;
        return new Response(JSON.stringify({ ...d, token_endpoint: 'https://evil.example/token' }), { headers: { 'content-type': 'application/json' } });
      }
      return r;
    };
    const client = new EntraClient(w.fe.config(REDIRECT, SECRET_FILE), { fetchImpl: evil, now: () => w.clock.now, readSecret: () => w.fe.secret });
    await assert.rejects(client.begin({ reauth: false, maxAgeSeconds: 900 }), failsWith('bad-discovery'));
  });

  it('reports an unreachable IdP as such, and never sends the client secret anywhere but the token endpoint', async () => {
    const w = entraWorld();
    const sent: string[] = [];
    const spy: typeof fetch = async (i, init) => {
      sent.push(`${init?.method ?? 'GET'} ${String(i)} ${String(init?.body ?? '')}`);
      return w.fe.fetch(i, init);
    };
    const client = new EntraClient(w.fe.config(REDIRECT, SECRET_FILE), { fetchImpl: spy, now: () => w.clock.now, readSecret: () => w.fe.secret });
    w.fe.user = w.user;
    const b = await client.begin({ reauth: false, maxAgeSeconds: 900 });
    const back = new URL((await w.fe.handle(new Request(b.url))).headers.get('location')!);
    await client.complete({ code: back.searchParams.get('code'), state: back.searchParams.get('state'), error: null, bindingCookie: b.bindingCookie });
    assert.ok(!b.url.includes(w.fe.secret), 'the secret is not in the browser redirect');
    assert.deepEqual(sent.filter((s) => s.includes(w.fe.secret)).map((s) => s.split(' ')[1]), [`${w.fe.authority}/${TID}/oauth2/v2.0/token`]);
    const down = new EntraClient(w.fe.config(REDIRECT, SECRET_FILE), { fetchImpl: () => Promise.reject(new Error('network')), now: () => w.clock.now, readSecret: () => w.fe.secret });
    await assert.rejects(down.begin({ reauth: false, maxAgeSeconds: 900 }), failsWith('idp-unreachable'));
  });
});

// ---------------------------------------------------------------- roles, enrollment and privilege escalation

describe('privilege escalation', () => {
  it('an Entra role claim alone grants no privileged role: enrollment is also required', () => {
    const stranger = principal(guid(500), [ROLE_CLAIM.owner]);
    const r = effectiveRoles(stranger, ctxFor());
    assert.deepEqual(r.roles, [], 'not enrolled: no role at all');
    assert.equal(decide(stranger, 'approve').ok, false);
    const noEnrollment = principal(OWNER_OID, [ROLE_CLAIM.owner]);
    const policy = entraPolicy({ people: ENTRA_PEOPLE.filter((p) => p.subject !== ent(OWNER_OID)) });
    assert.equal(decide(noEnrollment, 'approve', ARCH, ctxFor(policy)).ok, false);
    assert.match(effectiveRoles(noEnrollment, ctxFor(policy)).notes.join(' '), /no active enrollment/);
  });

  it('enrollment alone grants nothing: the identity provider must still assign the role', () => {
    const p = principal(OWNER_OID, [ROLE_CLAIM.viewer]);
    const r = effectiveRoles(p, ctxFor());
    assert.deepEqual(r.roles, ['viewer']);
    assert.equal(decide(p, 'approve').ok, false);
    assert.match(r.notes.join(' '), /no longer assigns/);
  });

  it('a token from another tenant carries no roles, even with the right claim and a known object id', () => {
    const p = principal(OWNER_OID, [ROLE_CLAIM.owner], { tenantId: guid(999), subject: `${guid(999)}:${OWNER_OID}` });
    assert.deepEqual(effectiveRoles(p, ctxFor()).roles, []);
    assert.equal(decide(p, 'approve').ok, false);
  });

  it('an unknown role claim is ignored', () => {
    const p = principal(OWNER_OID, ['Studio.GodMode', 'Studio.ArchitectureOwner ']);
    assert.deepEqual(effectiveRoles(p, ctxFor()).roles, [], 'only exact role names map');
  });

  it('nobody can enrol themselves, or be enrolled by one person, or by someone who is not an administrator', () => {
    const adm = (oid: string, over: Record<string, unknown> = {}) => entraPerson(oid, `${oid}@fake.test`, ['administrator'], over);
    const approved = (by: [string | null, string | null], oid = guid(21), roles = ['architecture-owner']) => entraPerson(oid, `${oid}@fake.test`, roles, { enrollment: { basis: 'approved', requestedBy: by[0], approvedBy: by[1], reference: 'PR 1' } });
    const roles = (people: unknown[], who: string) => parseAccessPolicy(policyJson({ tenantId: TID, people }), 'canonical').people.find((p) => p.subject === ent(who))?.roles ?? [];
    const admins = [adm(ADMIN_OID), adm(guid(16))];
    assert.deepEqual(roles([...admins, approved([ent(ADMIN_OID), ent(guid(16))])], guid(21)), ['architecture-owner'], 'two different administrators: accepted');
    assert.deepEqual(roles([...admins, approved([ent(guid(21)), ent(ADMIN_OID)])], guid(21)), [], 'requested by the person enrolled');
    assert.deepEqual(roles([...admins, approved([ent(ADMIN_OID), ent(guid(21))])], guid(21)), [], 'approved by the person enrolled');
    assert.deepEqual(roles([...admins, approved([ent(ADMIN_OID), ent(ADMIN_OID)])], guid(21)), [], 'one person is both requester and approver');
    assert.deepEqual(roles([...admins, approved([ent(ADMIN_OID), ent(CONTRIB_OID)])], guid(21)), [], 'approver is not an administrator');
    assert.deepEqual(roles([...admins, approved([null, null])], guid(21)), [], 'no requester or approver at all');
    const p = parseAccessPolicy(policyJson({ tenantId: TID, people: [...admins, approved([ent(guid(21)), ent(ADMIN_OID)])] }), 'canonical');
    assert.ok(p.problems.some((m) => /grant themselves|requested or approved by the person/.test(m)));
  });

  it('an administrator cannot also hold an approver role; both are removed rather than one picked', () => {
    const both = entraPerson(guid(30), 'both@fake.test', ['administrator', 'architecture-owner']);
    const p = parseAccessPolicy(policyJson({ tenantId: TID, people: [both] }), 'canonical');
    assert.deepEqual(p.people[0]!.roles, []);
    assert.ok(p.problems.some((m) => /may not/.test(m)));
    const two = entraPerson(guid(31), 'two@fake.test', ['architecture-owner', 'deployment-approver']);
    assert.deepEqual(parseAccessPolicy(policyJson({ tenantId: TID, people: [two] }), 'canonical').people[0]!.roles, []);
  });

  it('an entry that is not a human (agent, bot, service principal) is never enrolled', () => {
    for (const kind of ['agent', 'bot', 'service-principal', undefined]) {
      const p = parseAccessPolicy(policyJson({ tenantId: TID, people: [entraPerson(guid(40), 'copilot', ['architecture-owner'], { kind })] }), 'canonical');
      assert.equal(p.people.length, 0, String(kind));
      assert.ok(p.problems.some((m) => /human|Agents, bots/.test(m)));
    }
    const names = parseAccessPolicy(policyJson({ tenantId: TID, people: [entraPerson(guid(41), 'x', ['architecture-owner'], { subject: 'copilot' })] }), 'canonical');
    assert.equal(names.people.length, 0, 'a name is not an identity');
  });

  it('a policy that does not match the pinned hash grants nothing, and neither does an invalid or old one', () => {
    const text = policyJson({ tenantId: TID, people: ENTRA_PEOPLE, ownership: ENTRA_OWNERSHIP });
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    const ok = parseAccessPolicy(text, 'canonical', hash);
    assert.equal(ok.pinMismatch, false);
    assert.equal(decide(principal(OWNER_OID, [ROLE_CLAIM.owner]), 'approve', ARCH, ctxFor(ok)).ok, true);
    const tampered = parseAccessPolicy(text.replace('architecture-owner', 'architecture-owner'.toUpperCase()), 'canonical', hash);
    assert.equal(tampered.pinMismatch, true);
    assert.deepEqual(tampered.people, []);
    assert.equal(decide(principal(OWNER_OID, [ROLE_CLAIM.owner]), 'approve', ARCH, ctxFor(tampered)).code, 'policy-invalid');
    assert.equal(parseAccessPolicy('{"version":1}', 'canonical').people.length, 0);
    assert.equal(parseAccessPolicy(undefined, 'missing').people.length, 0);
  });

  it('a user cannot grant themselves access by what they send: roles are never read from a request', async () => {
    const src = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'app', 'api', 'v1', 'review', '[id]', 'actions', 'route.ts'), 'utf8');
    assert.ok(!/body\.(roles?|role|domain|approver|actor)/.test(src), 'the action route reads no role or actor from the body');
  });
});

// ---------------------------------------------------------------- cross-role and cross-domain

describe('cross-role and cross-domain access', () => {
  const owner = principal(OWNER_OID, [ROLE_CLAIM.owner]);
  const sec = principal(SEC_OID, [ROLE_CLAIM.sec]);
  const admin = principal(ADMIN_OID, [ROLE_CLAIM.admin]);
  const contrib = principal(CONTRIB_OID, [ROLE_CLAIM.contrib]);

  it('the right role approves in its own domain only', () => {
    assert.equal(decide(owner, 'approve', ARCH).ok, true);
    assert.equal(decide(owner, 'approve', SEC).code, 'missing-permission', 'an architecture owner cannot approve a security gate');
    assert.equal(decide(sec, 'approve', SEC).ok, true);
    assert.equal(decide(sec, 'approve', ARCH).code, 'missing-permission', 'a security reviewer cannot approve architecture');
  });

  it('architecture approval cannot authorise a regulatory filing or a deployment', () => {
    for (const rec of [REG, { id: 'D-903', kind: 'register-entry', approverText: 'Programme owner, quality manager' }, { id: 'D-904', kind: 'register-entry', approverText: 'Compliance counsel' }]) {
      for (const p of [owner, sec, admin]) assert.equal(decide(p, 'approve', rec).code, 'domain-not-approvable', `${rec.id}`);
    }
    // No role approves a deployment here: the permission exists, but nobody in this policy holds the role.
    const deploy = { id: 'D-905', kind: 'register-entry', approverText: 'x' };
    const policy = entraPolicy({ classification: { rules: [{ domain: 'deployment', idMatches: ['^D-905$'] }], overrides: {} }, ownership: [{ domain: 'deployment', scope: { all: true }, owners: [ent(guid(60))] }] });
    assert.equal(decide(owner, 'approve', deploy, ctxFor(policy)).code, 'missing-permission', 'an architecture approval is not a deployment approval');
    assert.equal(decide(owner, 'reject', deploy, ctxFor(policy)).code, 'missing-permission');
  });

  it('a record that touches a filing is classified as regulatory even when it also names the architecture owner', () => {
    const c = parseAccessPolicy(policyJson({ tenantId: TID, people: ENTRA_PEOPLE, ownership: ENTRA_OWNERSHIP }), 'canonical');
    assert.equal(decide(owner, 'approve', { id: 'D-001', kind: 'register-entry', approverText: 'Programme owner with compliance counsel' }, ctxFor(c)).code, 'domain-not-approvable');
    const unknown = decide(owner, 'approve', { id: 'D-906', kind: 'register-entry', approverText: 'Somebody else' });
    assert.equal(unknown.code, 'domain-not-approvable', 'unclassified is not approvable');
  });

  it('a contributor proposes but cannot approve, reject, defer or reopen; an administrator approves nothing', () => {
    for (const a of ['approve', 'approve-alternative', 'approve-with-conditions', 'reject', 'defer', 'reopen'] as const) {
      assert.equal(decide(contrib, a).code, 'missing-permission', `contributor ${a}`);
      assert.equal(decide(admin, a).code, 'missing-permission', `administrator ${a}`);
    }
    assert.equal(decide(contrib, 'request-revision').ok, true);
    assert.equal(decide(contrib, 'comment').ok, true);
    assert.equal(decide(admin, 'comment').ok, true);
  });

  it('work completion is an architecture approval and no other role closes work', () => {
    const w = (p: Principal, action: Parameters<typeof authorizeWork>[0]['action']) => authorizeWork({ principal: p, action, itemId: 'T9', submitter: ent(guid(99)) }, ctxFor());
    assert.equal(w(owner, 'approve-completion').ok, true);
    for (const p of [sec, admin, contrib]) assert.equal(w(p, 'approve-completion').code, 'missing-permission');
    assert.equal(w(sec, 'assign').code, 'missing-permission', 'a security reviewer does not run the work queue');
  });

  it('only an Administrator reaches the access review, and an Administrator cannot use it to approve', () => {
    const c = ctxFor();
    assert.equal(authorizeAccess(admin, 'access:review', c).ok, true);
    assert.equal(authorizeAccess(admin, 'access:administer', c).ok, true);
    for (const p of [owner, sec, contrib]) {
      assert.equal(authorizeAccess(p, 'access:review', c).code, 'missing-permission');
      assert.equal(authorizeAccess(p, 'access:administer', c).code, 'missing-permission');
    }
    assert.equal(authorizeAccess(null, 'access:review', c).status, 401);
    assert.equal(authorizeAccess(null, 'read', c).ok, false);
    assert.equal(authorizeAccess(principal(guid(70), []), 'read', c).code, 'no-access', 'signed in, but no role: not even read');
  });

  it('only the designated approver may decide, even with the role', () => {
    const policy = entraPolicy({ ownership: [{ domain: 'architecture', scope: { all: true }, owners: [ent(OWNER2_OID)] }] });
    assert.equal(decide(owner, 'approve', ARCH, ctxFor(policy)).code, 'not-designated');
    assert.equal(decide(principal(OWNER2_OID, [ROLE_CLAIM.owner]), 'approve', ARCH, ctxFor(policy)).ok, true);
  });

  it('every refusal says what was checked, and a pass records the checks it passed', () => {
    const a = decide(owner, 'approve');
    assert.equal(a.ok, true);
    const names = a.checks.map((c) => c.name);
    for (const n of ['has a role', 'approval provider', 'designated approver', 'recent sign-in', 'not the proposer']) assert.ok(names.includes(n), n);
    assert.ok(a.checks.every((c) => c.pass));
    const refused = decide(sec, 'approve');
    assert.ok(refused.checks.some((c) => !c.pass));
    assert.equal(refused.policyHash, ctxFor().policy.hash);
  });
});

// ---------------------------------------------------------------- step-up, providers and agents

describe('who may approve, and how recently they proved it', () => {
  const owner = (over: Partial<Principal> = {}) => principal(OWNER_OID, [ROLE_CLAIM.owner], over);

  it('approving needs a recent sign-in: an old session is sent back to sign in (401), reading is unaffected', () => {
    const stale = decide(owner({ authAt: T0 - 3 * 3600_000 }), 'approve');
    assert.equal(stale.code, 'reauth-required');
    assert.equal(stale.status, 401);
    assert.equal(decide(owner({ authAt: T0 - 3 * 3600_000 }), 'comment').ok, true);
    assert.equal(authorizeAccess(owner({ authAt: T0 - 3 * 3600_000 }), 'read', ctxFor()).ok, true);
    assert.equal(decide(owner({ authAt: T0 }), 'approve', ARCH, ctxFor(undefined, { now: T0 + 14 * 60_000 })).ok, true);
    assert.equal(decide(owner({ authAt: T0 }), 'approve', ARCH, ctxFor(undefined, { now: T0 + 16 * 60_000 })).code, 'reauth-required');
  });

  it('approving needs multi-factor sign-in when the policy says so', () => {
    const r = decide(owner({ mfa: false }), 'approve');
    assert.equal(r.code, 'mfa-required');
    assert.equal(r.status, 403);
    const lax = entraPolicy({ session: { requireMfaForApproval: false } });
    assert.equal(decide(owner({ mfa: false }), 'approve', ARCH, ctxFor(lax)).ok, true);
  });

  it('a GitHub sign-in cannot approve unless the operator turned on the development allowance; Entra needs no allowance', () => {
    const gh: Principal = { ...owner(), provider: 'github', subject: '1001', tenantId: null, id: 1001, verifiedBy: 'github-api', entraRoles: [] };
    const policy = parseAccessPolicy(policyJson(), 'canonical');
    assert.equal(decide(gh, 'approve', ARCH, { policy, now: T0 + 60_000, devApprovals: false }).code, 'provider-not-allowed');
    assert.equal(decide(gh, 'approve', ARCH, { policy, now: T0 + 60_000, devApprovals: true }).ok, true);
    assert.equal(decide(owner(), 'approve').ok, true);
  });

  it('the development allowance is ignored in Entra mode', async () => {
    const { readAuthConfig } = await import('../src/lib/auth/config.ts');
    const cfg = readAuthConfig({ STUDIO_AUTH_MODE: 'entra', STUDIO_ALLOW_DEV_APPROVALS: '1', STUDIO_ENTRA_TENANT_ID: TID, STUDIO_ENTRA_CLIENT_ID: 'c', STUDIO_ENTRA_CLIENT_SECRET_FILE: 'f', STUDIO_ENTRA_REDIRECT_URI: REDIRECT });
    assert.equal(cfg.mode, 'entra');
    assert.equal(cfg.devApprovals, false);
    assert.ok(cfg.entra);
    const broken = readAuthConfig({ STUDIO_AUTH_MODE: 'entra' });
    assert.equal(broken.entra, null, 'half-configured Entra is not usable');
    assert.ok(broken.problems.length >= 3);
    assert.equal(readAuthConfig({}).mode, 'github-dev', 'default is the development mode');
    // A deployment sets STUDIO_REQUIRE_ENTRA=1 so that forgetting STUDIO_AUTH_MODE cannot fall back to development sign-in.
    const required = readAuthConfig({ STUDIO_REQUIRE_ENTRA: '1', STUDIO_ALLOW_DEV_APPROVALS: '1' });
    assert.equal(required.mode, 'entra');
    assert.equal(required.devApprovals, false);
    assert.equal(required.entra, null, 'and it fails closed until Entra is configured');
    assert.ok(required.problems.length >= 3);
  });

  it('public-readonly mode is explicit, never weakens Entra, and enables no development shortcut', async () => {
    const { readAuthConfig } = await import('../src/lib/auth/config.ts');
    assert.equal(readAuthConfig({ STUDIO_AUTH_MODE: 'public-readonly' }).mode, 'public-readonly');
    assert.equal(readAuthConfig({ STUDIO_AUTH_MODE: 'PUBLIC-READONLY' }).entra, null);
    assert.equal(readAuthConfig({}).mode, 'github-dev', 'the default is unchanged');
    assert.equal(readAuthConfig({ STUDIO_AUTH_MODE: 'public' }).mode, 'github-dev', 'a near miss does not select it');
    const both = readAuthConfig({ STUDIO_AUTH_MODE: 'public-readonly', STUDIO_REQUIRE_ENTRA: '1', STUDIO_ENTRA_TENANT_ID: TID });
    assert.equal(both.mode, 'entra', 'STUDIO_REQUIRE_ENTRA=1 always wins');
    const pub = readAuthConfig({ STUDIO_AUTH_MODE: 'public-readonly', STUDIO_ALLOW_DEV_APPROVALS: '1' });
    assert.equal(pub.devApprovals, false, 'no development approvals without a sign-in');
    assert.equal(pub.secureCookies, false);
  });
  it('a server told to answer on other hosts never falls back to the development sign-in', async () => {
    const { readAuthConfig } = await import('../src/lib/auth/config.ts');
    for (const asked of [undefined, '', 'public', 'github-dev']) {
      const c = readAuthConfig({ STUDIO_ALLOWED_HOSTS: 'studio.example.com', ...(asked === undefined ? {} : { STUDIO_AUTH_MODE: asked }), STUDIO_ALLOW_DEV_APPROVALS: '1' });
      assert.equal(c.mode, 'public-readonly', `mode ${JSON.stringify(asked)} with an allowed host`);
      assert.equal(c.devApprovals, false);
    }
    assert.equal(readAuthConfig({ STUDIO_ALLOWED_HOSTS: ' , ' }).mode, 'github-dev', 'blank entries are not a host');
    assert.equal(readAuthConfig({}).mode, 'github-dev', 'on a laptop the default is unchanged');
    const entra = readAuthConfig({ STUDIO_ALLOWED_HOSTS: 'studio.example.com', STUDIO_AUTH_MODE: 'entra', STUDIO_ENTRA_TENANT_ID: TID, STUDIO_ENTRA_CLIENT_ID: 'c', STUDIO_ENTRA_CLIENT_SECRET_FILE: 'f', STUDIO_ENTRA_REDIRECT_URI: REDIRECT });
    assert.equal(entra.mode, 'entra', 'an explicit Entra setting is kept');
  });
  it('the sign-in scope is configurable but limited to openid, profile and email, and must include openid', async () => {
    const { readAuthConfig } = await import('../src/lib/auth/config.ts');
    const base = { STUDIO_AUTH_MODE: 'entra', STUDIO_ENTRA_TENANT_ID: TID, STUDIO_ENTRA_CLIENT_ID: 'c', STUDIO_ENTRA_CLIENT_SECRET_FILE: 'f', STUDIO_ENTRA_REDIRECT_URI: REDIRECT };
    assert.equal(readAuthConfig(base).entra?.scope, 'openid profile', 'the default is unchanged');
    assert.equal(readAuthConfig({ ...base, STUDIO_ENTRA_SCOPE: 'openid' }).entra?.scope, 'openid');
    assert.equal(readAuthConfig({ ...base, STUDIO_ENTRA_SCOPE: 'openid  profile openid' }).entra?.scope, 'openid profile', 'duplicates and spacing are normalised');
    for (const bad of ['profile', 'openid User.Read', 'openid https://graph.microsoft.com/.default', 'openid offline_access']) {
      const c = readAuthConfig({ ...base, STUDIO_ENTRA_SCOPE: bad });
      assert.equal(c.entra, null, `refused: ${bad}`);
      assert.ok(c.problems.some((p) => /STUDIO_ENTRA_SCOPE/.test(p)), `explained: ${bad}`);
    }
  });
  it('an application, bot or agent identity cannot hold a role: no enrollment, and no sign-in', async () => {
    const agent: Principal = { ...owner(), subject: `${TID}:${guid(80)}`, login: 'copilot-agent' };
    assert.deepEqual(effectiveRoles(agent, ctxFor()).roles, []);
    assert.equal(decide(agent, 'approve').ok, false);
    const w = entraWorld();
    w.fe.fault = { claims: { idtyp: 'app' } };
    await assert.rejects(w.signIn(), failsWith('not-a-person'));
  });
});

// ---------------------------------------------------------------- segregation of duties

describe('segregation of duties', () => {
  const owner = principal(OWNER_OID, [ROLE_CLAIM.owner]);
  const owner2 = principal(OWNER2_OID, [ROLE_CLAIM.owner]);

  it('the person who proposed a revision cannot approve, reject or defer it; another owner can', () => {
    const sod = { proposers: [ent(OWNER_OID)] };
    for (const a of ['approve', 'approve-with-conditions', 'reject', 'defer'] as const) assert.equal(decide(owner, a, ARCH, ctxFor(), sod).code, 'sod-proposer', a);
    assert.equal(decide(owner2, 'approve', ARCH, ctxFor(), sod).ok, true);
    assert.equal(decide(owner, 'comment', ARCH, ctxFor(), sod).ok, true, 'commenting is not deciding');
  });

  it('the person who submitted work for review cannot complete or reject it', () => {
    const w = (p: Principal, a: 'approve-completion' | 'reject-completion') => authorizeWork({ principal: p, action: a, itemId: 'T9', submitter: ent(OWNER_OID) }, ctxFor());
    assert.equal(w(owner, 'approve-completion').code, 'sod-submitter');
    assert.equal(w(owner, 'reject-completion').code, 'sod-submitter');
    assert.equal(w(owner2, 'approve-completion').ok, true);
  });

  it('can require an independent recommendation first, and a rejecting recommendation does not count', () => {
    const strict = ctxFor(entraPolicy({ segregation: { requireIndependentRecommendation: true } }));
    assert.equal(decide(owner, 'approve', ARCH, strict).code, 'sod-recommendation');
    assert.equal(decide(owner, 'approve', ARCH, strict, { recommenders: [{ subject: ent(OWNER_OID), recommendation: 'approve' }] }).code, 'sod-recommendation', 'your own recommendation does not count');
    assert.equal(decide(owner, 'approve', ARCH, strict, { recommenders: [{ subject: ent(OWNER2_OID), recommendation: 'reject' }] }).code, 'sod-recommendation');
    assert.equal(decide(owner, 'approve', ARCH, strict, { recommenders: [{ subject: ent(OWNER2_OID), recommendation: 'approve' }] }).ok, true);
    assert.equal(decide(owner, 'reject', ARCH, strict).ok, true, 'rejecting needs no recommendation');
  });

  it('switching segregation off in the policy is visible to the administrator review', () => {
    const policy = entraPolicy({ segregation: { enforce: false } });
    const rep = buildAccessReport({ policy, pinned: false, now: T0, audit: [], sessions: [], suspensions: [] });
    assert.ok(rep.findings.some((f) => f.severity === 'attention' && /Segregation of duties is switched off/.test(f.text)));
    assert.equal(decide(owner, 'approve', ARCH, ctxFor(policy), { proposers: [ent(OWNER_OID)] }).ok, true, 'and it really is off: the review is what exposes it');
  });
});

// ---------------------------------------------------------------- sessions

describe('session management', () => {
  const user = principal(OWNER_OID, [ROLE_CLAIM.owner]);
  it('ends a session after inactivity and after its absolute lifetime, and says why', () => {
    let now = 1_000_000;
    const s = new SessionStore(() => now);
    const a = s.create(user, { idleMinutes: 30, absoluteHours: 8 });
    now += 29 * 60_000;
    assert.ok(s.get(a.token), 'activity inside the idle window keeps it');
    now += 29 * 60_000;
    assert.ok(s.get(a.token), 'and the idle window restarts');
    now += 31 * 60_000;
    assert.equal(s.get(a.token), null);
    assert.equal(s.whyEnded(a.token), 'idle');
    const b = s.create(user, { idleMinutes: 30, absoluteHours: 1 });
    for (let i = 0; i < 5; i++) {
      now += 20 * 60_000;
      s.get(b.token);
    }
    assert.equal(s.get(b.token), null, 'constant use does not extend past the absolute limit');
    assert.equal(s.whyEnded(b.token), 'absolute');
    assert.equal(s.whyEnded('never-existed'), 'unknown');
  });

  it('stores only a hash of the token, issues a new token for every sign-in, and a signed-out token is dead', () => {
    const s = new SessionStore(() => 1);
    const a = s.create(user, { idleMinutes: 30, absoluteHours: 8 });
    const b = s.create(user, { idleMinutes: 30, absoluteHours: 8 });
    assert.notEqual(a.token, b.token);
    assert.ok(a.token.length >= 40);
    assert.ok(!JSON.stringify(s.list()).includes(a.token));
    assert.ok(![...(s as unknown as { map: Map<string, unknown> }).map.keys()].includes(a.token), 'the map is keyed by hash, not token');
    assert.ok(s.get(a.token));
  });

  it('revoking a person ends every session of theirs at once and nobody else’s', () => {
    const s = new SessionStore(() => 1);
    const mine = [s.create(user, { idleMinutes: 30, absoluteHours: 8 }), s.create(user, { idleMinutes: 30, absoluteHours: 8 })];
    const other = s.create(principal(OWNER2_OID, [ROLE_CLAIM.owner]), { idleMinutes: 30, absoluteHours: 8 });
    assert.equal(s.revokeSubject(keyOf(user)), 2);
    for (const m of mine) {
      assert.equal(s.get(m.token), null);
      assert.equal(s.whyEnded(m.token), 'revoked');
    }
    assert.ok(s.get(other.token));
  });

  it('an old authentication is not refreshed by activity: step-up depends on authAt, not on the session clock', () => {
    let now = T0;
    const s = new SessionStore(() => now);
    const a = s.create(principal(OWNER_OID, [ROLE_CLAIM.owner], { authAt: T0 }), { idleMinutes: 30, absoluteHours: 8 });
    for (let i = 0; i < 4; i++) {
      now += 20 * 60_000;
      assert.ok(s.get(a.token));
    }
    const live = s.get(a.token)!;
    assert.equal(decide(live.user, 'approve', ARCH, ctxFor(undefined, { now })).code, 'reauth-required');
  });
});

// ---------------------------------------------------------------- revoked approvers and suspension

describe('revoked approvers', () => {
  it('an enrollment that has ended grants nothing, from the moment it ends', () => {
    const owner = principal(OWNER_OID, [ROLE_CLAIM.owner], { authAt: T0 + 20 * 60_000 });
    const policy = entraPolicy({ people: ENTRA_PEOPLE.map((p) => (p.subject === ent(OWNER_OID) ? { ...p, revokedAt: '2026-10-30T00:30:00Z', revokedReason: 'left the programme' } : p)) });
    assert.equal(decide(owner, 'approve', ARCH, ctxFor(policy, { now: T0 + 29 * 60_000 })).ok, true, 'before the revocation');
    const after = decide(owner, 'approve', ARCH, ctxFor(policy, { now: T0 + 31 * 60_000 }));
    assert.equal(after.ok, false);
    assert.match(effectiveRoles(owner, ctxFor(policy, { now: T0 + 31 * 60_000 })).notes.join(' '), /revoked/);
    const future = entraPolicy({ people: ENTRA_PEOPLE.map((p) => (p.subject === ent(OWNER_OID) ? { ...p, enrolledAt: '2026-12-01T00:00:00Z' } : p)) });
    assert.equal(decide(owner, 'approve', ARCH, ctxFor(future)).ok, false, 'not yet enrolled');
  });

  it('an administrator’s suspension takes effect on the next request, and lifting it restores access', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-susp-'));
    const store = new SuspensionStore(dir);
    const owner = principal(OWNER_OID, [ROLE_CLAIM.owner]);
    const ctx = () => ctxFor(undefined, { suspended: store.set() });
    assert.equal(decide(owner, 'approve', ARCH, ctx()).ok, true);
    store.suspend({ subject: keyOf(owner), by: 'admin@fake.test', reason: 'credentials reported stolen', at: new Date(T0).toISOString() });
    assert.equal(decide(owner, 'approve', ARCH, ctx()).ok, false);
    assert.equal(authorizeAccess(owner, 'read', ctx()).ok, false, 'a suspended person cannot even read');
    assert.deepEqual(new SuspensionStore(dir).list().map((s) => s.subject), [keyOf(owner)], 'it survives a restart');
    assert.equal(store.lift(keyOf(owner)), true);
    assert.equal(decide(owner, 'approve', ARCH, ctx()).ok, true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('an unreadable suspension file is treated as no suspensions being lost, not as a crash', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-susp-'));
    fs.writeFileSync(path.join(dir, 'suspensions.json'), '{not json');
    assert.doesNotThrow(() => new SuspensionStore(dir).set());
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------- the service: replay, forgery, signing

function world(policy?: string) {
  const fx = makeFixture({ policy });
  fixtures.push(fx);
  fx.setIdentity(USERS.owner);
  const real = new LocalGitHub(path.join(fx.state, 'prs.json'), fx.remote);
  const identity = new FixtureIdentity(path.join(fx.state, 'identity.json'));
  const store = new ReviewStore(path.join(fx.state, 'review'));
  let t = T0;
  const svc = new ReviewService({ root: fx.work, readRef: 'HEAD', canonicalRef: 'origin/main', store, github: real, publisher: new GitPublisher(fx.work), identity, now: () => new Date((t += 1000)), policyTtlMs: 0 });
  let n = 0;
  const key = () => `akey-${++n}-abcdefgh`;
  const as = async (u: (typeof USERS)[keyof typeof USERS]): Promise<VerifiedUser> => {
    fx.setIdentity(u);
    return identity.verify();
  };
  const submit = async (d: NormalizedDecision, u: VerifiedUser | null, action: ActionKind, extra: Record<string, unknown> = {}) => {
    const v = svc.view(d, u);
    return svc.submit(u, d, { action, expectedRevision: v.revision, idempotencyKey: key(), ...extra });
  };
  const land = async (d: NormalizedDecision, u: VerifiedUser, action: ActionKind, extra: Record<string, unknown> = {}) => {
    const { proposal } = await submit(d, u, action, extra);
    const sent = await svc.sync(proposal.id);
    fx.merge(sent.prNumber!);
    assert.equal((await svc.sync(proposal.id)).state, 'applied');
    return proposal;
  };
  const fetch = () => git(fx.work, 'fetch', '-q', 'origin');
  return { fx, svc, store, as, submit, land, fetch, key };
}

/** An event written by hand, the way someone with write access to the repository could. */
function handmade(d: NormalizedDecision, seq: number, action: ActionKind, prevHash: string | null, o: { signer?: 'server' | 'other' | 'none'; actor?: { login: string; id: number }; createdAt?: string; domain?: string; id?: string } = {}): ReviewEvent {
  const who = o.actor ?? { login: 'test-owner', id: 1001 };
  const body = {
    schema: 'greenfuel.decision-review-event/v2' as const,
    id: o.id ?? eventId(d.id, seq),
    decisionId: d.id,
    seq,
    action,
    actor: { login: who.login, githubId: who.id, name: who.login, verifiedBy: 'test-fixture' as const, provider: 'github' as const, subject: String(who.id), tenantId: null },
    createdAt: o.createdAt ?? new Date(Date.UTC(2026, 9, 30, 1, seq)).toISOString(),
    basis: { recordHash: d.contentHash, sourceStatus: d.status, sourceCommit: 'c'.repeat(40) },
    prevHash,
    option: action === 'approve' ? { key: 'B', name: 'Build it', recommended: true } : null,
    conditions: [],
    rationale: null,
    comment: null,
    recommendation: null,
    roleCheck: { critical: true, required: ['approve:architecture'], held: ['architecture-owner'], namedRoles: [], outstanding: [], policySource: 'canonical' as const, domain: o.domain ?? 'architecture', policyHash: '', checks: [], authAgeSeconds: 0, mfa: false },
  };
  const eventHash = hashEvent(body);
  const other = trustFrom({ privateKeyPem: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  const signature = o.signer === 'none' ? null : o.signer === 'other' ? other.signer!.sign(eventHash) : auth.signer.sign(eventHash);
  return { ...body, eventHash, signature } as ReviewEvent;
}

describe('forged approval records', () => {
  const stateOf = (w: ReturnType<typeof world>, id: string) => {
    w.fetch();
    return w.svc.canonical().states.get(id)!;
  };
  const plant = (w: ReturnType<typeof world>, e: ReviewEvent, file = eventPath(e.decisionId, e.seq, e.action)) => w.fx.commitToMain({ [file]: serializeEvent(e) });

  it('a hand-written approval with a valid hash but no signature is ignored, reported, and approves nothing', () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0301' });
    plant(w, handmade(d, 1, 'approve', null, { signer: 'none' }));
    const s = stateOf(w, d.id);
    assert.equal(s.effectiveStatus, null);
    assert.equal(s.phase, 'none');
    assert.ok(s.problems.length > 0, 'the problem is reported');
    assert.match(s.problems.join(' '), /signature|signed/i);
  });

  it('an approval signed by a key the server does not trust is ignored', () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0302' });
    plant(w, handmade(d, 1, 'approve', null, { signer: 'other' }));
    const s = stateOf(w, d.id);
    assert.equal(s.effectiveStatus, null);
    assert.ok(s.problems.length > 0);
  });

  it('a signature copied from another event does not transfer: the hash it covers changed', () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0303' });
    const good = handmade(d, 1, 'comment', null);
    const forged = { ...handmade(d, 1, 'approve', null), signature: good.signature } as ReviewEvent;
    plant(w, forged);
    const s = stateOf(w, d.id);
    assert.equal(s.effectiveStatus, null);
    assert.ok(s.problems.length > 0);
  });

  it('a validly signed approval by someone who was never enrolled (an agent or a stranger) is ignored', () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0304' });
    plant(w, handmade(d, 1, 'approve', null, { actor: { login: 'copilot-agent', id: 4242 } }));
    const s = stateOf(w, d.id);
    assert.equal(s.effectiveStatus, null);
    assert.match(s.problems.join(' '), /not an enrolled approver/);
  });

  it('a signed approval dated before the person was enrolled is ignored (back-dating)', () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0305' });
    plant(w, handmade(d, 1, 'approve', null, { createdAt: '2025-06-01T00:00:00.000Z' }));
    const s = stateOf(w, d.id);
    assert.equal(s.effectiveStatus, null);
    assert.match(s.problems.join(' '), /was not enrolled as architecture-owner/);
  });

  it('a signed approval by a person who holds a different role is ignored (cross-role forgery)', () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0306' });
    plant(w, handmade(d, 1, 'approve', null, { actor: { login: 'test-security', id: 1002 } }));
    assert.equal(stateOf(w, d.id).effectiveStatus, null, 'a security reviewer’s record claiming to be an architecture approval');
    const adm = makeDecision({ id: 'ADR-0307' });
    plant(w, handmade(adm, 1, 'approve', null, { actor: { login: 'test-admin', id: 1006 } }));
    assert.equal(stateOf(w, adm.id).effectiveStatus, null, 'an administrator’s record');
  });

  it('a signed record that claims a regulatory or unclassified domain is never an approval', () => {
    const w = world();
    for (const [i, domain] of ['regulatory', 'unclassified', 'deployment'].entries()) {
      const d = makeDecision({ id: `ADR-031${i}` });
      plant(w, handmade(d, 1, 'approve', null, { domain }));
      assert.equal(stateOf(w, d.id).effectiveStatus, null, domain);
    }
  });

  it('a genuine approval copied to another decision, or to another sequence number, is refused (replay)', async () => {
    const w = world();
    const a = makeDecision({ id: 'ADR-0320' });
    const b = makeDecision({ id: 'ADR-0321' });
    await w.land(a, await w.as(USERS.owner), 'approve');
    const file = eventPath(a.id, 1, 'approve');
    const text = git(w.fx.remote, 'show', `refs/heads/main:${file}`);
    w.fx.commitToMain({ [eventPath(b.id, 1, 'approve')]: `${text}\n` }, 'replay onto another decision');
    const sb = stateOf(w, b.id);
    assert.equal(sb.effectiveStatus, null, 'the decision id is inside the signed hash');
    assert.ok(sb.problems.length > 0);
    w.fx.commitToMain({ [eventPath(a.id, 2, 'approve')]: `${text}\n` }, 'replay as event 2');
    const sa = stateOf(w, a.id);
    assert.ok(sa.problems.length > 0, 'the same event cannot be applied twice');
    assert.equal(sa.events.length, 1);
  });

  it('prose cannot impersonate an approval: Markdown, a commit message, or a comment saying "Approved by" changes nothing', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0330' });
    w.fx.commitToMain({ 'docs/adr/NOTE.md': '# Note\n\nApproved by test-owner (programme owner) on 2026-10-30. Status: Accepted.\n' }, 'Approved ADR-0330 as the programme owner');
    w.fetch();
    assert.equal(w.svc.canonical().states.get(d.id), undefined);
    const owner = await w.as(USERS.owner);
    await w.land(d, owner, 'comment', { comment: 'Approved by everyone. Status: Approved.' });
    assert.equal(w.svc.canonical().states.get(d.id)!.effectiveStatus, null, 'a comment containing the word approved is a comment');
  });

  it('a correctly signed, enrolled approval is accepted, so the checks above are not just refusing everything', () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0340' });
    plant(w, handmade(d, 1, 'approve', null));
    const s = stateOf(w, d.id);
    assert.deepEqual(s.problems, []);
    assert.equal(s.effectiveStatus, 'Approved');
  });

  it('a person revoked after approving does not unwind the earlier approval, and cannot approve again', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0341' });
    const e = makeDecision({ id: 'ADR-0342' });
    const owner = await w.as(USERS.owner);
    await w.land(d, owner, 'approve');
    const { PEOPLE } = await import('./fixtures/review-fixture.ts');
    const revoked = PEOPLE.map((p) => (p.subject === 'github:1001' ? { ...p, revokedAt: '2026-10-29T00:00:00Z', revokedReason: 'left' } : p));
    w.fx.commitToMain({ 'harness/policy/access-policy.json': policyJson({ people: revoked }) }, 'revoke the owner');
    w.fetch();
    await assert.rejects(w.submit(e, owner, 'approve'), code('missing-permission'));
  });
});

describe('the service refuses what the policy and the key do not allow', () => {
  it('without a signing key it records nothing and says so (503)', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0350' });
    const owner = await w.as(USERS.owner);
    __setAuthForTests({ trust: emptyTrust('No signing key is configured.') });
    try {
      await assert.rejects(w.submit(d, owner, 'approve'), (e: unknown) => e instanceof ServiceError && e.code === 'signing-unavailable' && e.status === 503);
      assert.equal(w.store.list().length, 0);
    } finally {
      __setAuthForTests({ trust: auth.trust });
    }
  });

  it('with the development allowance off, a GitHub sign-in cannot approve but can still read and, with a role, comment', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0351' });
    const owner = await w.as(USERS.owner);
    auth.setApprovals(false);
    try {
      await assert.rejects(w.submit(d, owner, 'approve'), code('provider-not-allowed'));
      await w.submit(d, owner, 'comment', { comment: 'Still able to comment.' });
    } finally {
      auth.setApprovals(true);
    }
  });

  it('a policy that does not match the pinned hash stops all decisions', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0352' });
    const owner = await w.as(USERS.owner);
    __setAuthForTests({ config: { mode: 'github-dev', devApprovals: true, policyPin: '0'.repeat(64), cacheDir: auth.cacheDir, entra: null, secureCookies: false, problems: [] } });
    try {
      await assert.rejects(w.submit(d, owner, 'approve'), code('policy-invalid'));
      assert.equal(w.svc.policy().pinMismatch, true);
    } finally {
      auth.setApprovals(true);
    }
    await w.submit(d, owner, 'approve');
  });

  it('a suspended person is refused at once, and the refusal is audited with the checks', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0353' });
    const owner = await w.as(USERS.owner);
    const store = new SuspensionStore(auth.cacheDir);
    store.suspend({ subject: subjectOf(USERS.owner), by: 'test-admin', reason: 'credentials reported stolen', at: new Date(T0).toISOString() });
    try {
      await assert.rejects(w.submit(d, owner, 'approve'), code('no-access'));
      const denied = w.store.readAudit({ decisionId: d.id }).filter((a) => a.outcome === 'denied');
      assert.equal(denied.length, 1);
      assert.equal(denied[0]!.actor, 'test-owner');
    } finally {
      store.lift(subjectOf(USERS.owner));
    }
    await w.submit(d, owner, 'approve');
  });

  it('a replayed submission (same key) returns the first result and creates nothing new; a stale one is refused', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0354' });
    const owner = await w.as(USERS.owner);
    const v = w.svc.view(d, owner);
    const req = { action: 'approve' as const, expectedRevision: v.revision, idempotencyKey: 'replay-key-0001' };
    const first = await w.svc.submit(owner, d, req);
    const again = await w.svc.submit(owner, d, req);
    assert.equal(again.duplicate, true);
    assert.equal(again.proposal.id, first.proposal.id);
    assert.equal(w.store.list().length, 1);
    await assert.rejects(w.submit(d, owner, 'reject', { rationale: REASON }), code('proposal-open'), 'a different request while the first is in flight');
    await assert.rejects(w.svc.submit(owner, d, { ...req, idempotencyKey: 'replay-key-0002' }), code('stale-revision'), 'a new key against the old view');
  });

  it('an approval records who, under which policy, how recently they signed in, and what was checked; and it is signed', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0355' });
    const owner = await w.as(USERS.owner);
    const { proposal } = await w.submit(d, owner, 'approve');
    const ev = (proposal as unknown as { event: ReviewEvent }).event;
    assert.equal(ev.actor.provider, 'github');
    assert.equal(ev.actor.subject, '1001');
    assert.equal(ev.roleCheck.domain, 'architecture');
    assert.match(ev.roleCheck.policyHash, /^[0-9a-f]{64}$/);
    assert.ok(ev.roleCheck.checks.includes('designated approver'));
    assert.ok(ev.signature && ev.signature.keyId === auth.signer.keyId);
    assert.equal(ev.eventHash, hashEvent(ev), 'the hash excludes the signature, the signature covers the hash');
  });

  it('an Entra person can approve through the service when enrolled, MFA-signed and recent; not when any of those fail', async () => {
    const w = world(policyJson({ tenantId: TID, people: ENTRA_PEOPLE, ownership: ENTRA_OWNERSHIP }));
    const d = makeDecision({ id: 'ADR-0356' });
    const good = principal(OWNER_OID, [ROLE_CLAIM.owner], { authAt: T0 });
    const { proposal } = await w.svc.submit(good, d, { action: 'approve', expectedRevision: w.svc.view(d, good).revision, idempotencyKey: w.key() });
    const ev = (proposal as unknown as { event: ReviewEvent }).event;
    assert.equal(ev.actor.provider, 'entra');
    assert.equal(ev.actor.verifiedBy, 'entra-oidc');
    assert.equal(ev.actor.tenantId, TID);
    assert.equal(ev.roleCheck.mfa, true);
    const e = makeDecision({ id: 'ADR-0357' });
    const noMfa = principal(OWNER2_OID, [ROLE_CLAIM.owner], { authAt: T0, mfa: false });
    await assert.rejects(w.svc.submit(noMfa, e, { action: 'approve', expectedRevision: w.svc.view(e, noMfa).revision, idempotencyKey: w.key() }), code('mfa-required'));
    const old = principal(OWNER2_OID, [ROLE_CLAIM.owner], { authAt: T0 - 3 * 3600_000 });
    await assert.rejects(w.svc.submit(old, e, { action: 'approve', expectedRevision: w.svc.view(e, old).revision, idempotencyKey: w.key() }), code('reauth-required'));
    const fake = principal(guid(555), [ROLE_CLAIM.owner]);
    await assert.rejects(w.svc.submit(fake, e, { action: 'approve', expectedRevision: w.svc.view(e, fake).revision, idempotencyKey: w.key() }), code('no-access'));
  });
});

// ---------------------------------------------------------------- the administrator review

describe('administrative review', () => {
  it('reports one administrator, bootstrap enrollment, a missing tenant and an unpinned policy, and records who attested', () => {
    const policy = parseAccessPolicy(policyJson({ people: [...(JSON.parse(policyJson()) as { people: unknown[] }).people] }), 'canonical');
    const rep = buildAccessReport({
      policy,
      pinned: false,
      now: T0,
      audit: [
        { at: '2026-10-30T00:00:00Z', actor: 'test-admin', action: 'access-review', outcome: 'accepted', code: null, facts: { newValue: policy.hash } },
        ...Array.from({ length: 5 }, (_, i) => ({ at: `2026-10-30T00:0${i}:00Z`, actor: 'test-contrib', action: 'approve', outcome: 'denied', code: 'missing-permission' })),
      ],
      sessions: [],
      suspensions: [],
    });
    const text = rep.findings.map((f) => f.text).join('\n');
    assert.match(text, /only one Administrator/);
    assert.match(text, /No Entra tenant/);
    assert.match(text, /not pinned/);
    assert.match(text, /test-contrib has 5 refused attempts/);
    assert.equal(rep.lastAttestation?.by, 'test-admin');
    assert.ok(rep.people.some((p) => p.flags.some((f) => /Bootstrap enrollment/.test(f))));
    assert.ok(rep.people.every((p) => p.status === 'active'));
  });

  it('flags a revoked or suspended designated approver, and nobody being able to approve', () => {
    const revoked = parseAccessPolicy(policyJson({ people: (JSON.parse(policyJson()) as { people: Record<string, unknown>[] }).people.map((p) => (p.subject === 'github:1001' ? { ...p, revokedAt: '2026-02-01T00:00:00Z' } : p)) }), 'canonical');
    const rep = buildAccessReport({ policy: revoked, pinned: true, now: T0, audit: [], sessions: [], suspensions: [{ subject: 'github:1005', by: 'test-admin', reason: 'review pending', at: '2026-10-29T00:00:00Z' }] });
    const text = rep.findings.map((f) => f.text).join('\n');
    assert.match(text, /designated for architecture but their enrollment is revoked/);
    assert.match(text, /test-owner2 is suspended/);
    assert.equal(rep.people.find((p) => p.login === 'test-owner2')!.status, 'suspended');
    const empty = buildAccessReport({ policy: parseAccessPolicy(policyJson({ people: [] }), 'canonical'), pinned: true, now: T0, audit: [], sessions: [], suspensions: [] });
    assert.ok(empty.findings.some((f) => /Nobody is enrolled/.test(f.text)));
  });
});

// ---------------------------------------------------------------- the checker for records, on its own

describe('record checks, directly', () => {
  const policy = parseAccessPolicy(policyJson(), 'canonical');
  const a: Authenticity = { trust: auth.trust, policy, allowDevKeys: true };
  const facts = (over: Record<string, unknown> = {}) => {
    const eventHash = 'a'.repeat(64);
    return { actor: { provider: 'github' as const, subject: '1001' }, createdAt: '2026-10-30T01:00:00Z', eventHash, signature: auth.signer.sign(eventHash), roleCheck: { domain: 'architecture' }, approvalClass: true, ...over };
  };
  it('passes a genuine record, and refuses each way of getting it wrong', () => {
    assert.equal(checkRecord(a, facts()), null);
    assert.ok(checkRecord(a, facts({ signature: null })));
    assert.ok(checkRecord(a, facts({ eventHash: 'b'.repeat(64) })), 'a signature over another hash');
    assert.match(checkRecord(a, facts({ actor: { provider: 'github', subject: '9' } })) ?? '', /not an enrolled approver/);
    assert.match(checkRecord(a, facts({ roleCheck: { domain: 'regulatory' } })) ?? '', /not something the Studio can approve/);
    assert.equal(checkRecord(a, facts({ approvalClass: false, actor: { provider: 'github', subject: '9' } })), null, 'a comment needs a signature, not enrollment');
    assert.match(checkRecord({ ...a, policy: parseAccessPolicy(policyJson(), 'canonical', 'f'.repeat(64)) }, facts()) ?? '', /no trusted access policy/);
  });
  it('a development key is not accepted when Entra is the authentication mode', () => {
    const dev = trustFrom({ privateKeyPem: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), dev: true });
    const eventHash = 'c'.repeat(64);
    const f = facts({ eventHash, signature: dev.signer!.sign(eventHash) });
    assert.equal(checkRecord({ trust: dev, policy, allowDevKeys: true }, f), null);
    assert.ok(checkRecord({ trust: dev, policy, allowDevKeys: false }, f), 'refused in entra mode');
  });
});
