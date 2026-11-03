import assert from 'node:assert/strict';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { applyReviewOverlay } from '../src/lib/workflow/overlay.ts';
import { ACTIONS, canonicalJson, eventId, eventPath, foldEvents, hashEvent, parseEvent, serializeEvent, sha256, type ActionKind, type ReviewEvent } from '../src/lib/workflow/events.ts';
import { GitHubError, LocalGitHub, type GitHubPort, type PullRequestInfo } from '../src/lib/workflow/github.ts';
import { FixtureIdentity, GhCliIdentity, IdentityError, SessionStore, type VerifiedUser } from '../src/lib/workflow/identity.ts';
import { GitPublisher, PublishError } from '../src/lib/workflow/publish.ts';
import { ReviewService, ServiceError } from '../src/lib/workflow/review.ts';
import { availability, validateRequest } from '../src/lib/workflow/rules.ts';
import { parseAccessPolicy, rolesNamed } from '../src/lib/auth/access-policy.ts';
import { ReviewStore, type Proposal } from '../src/lib/workflow/store.ts';
import { pendingOrder, reviewableInStudio } from '../src/lib/workflow/runtime.ts';
import { PEOPLE, USERS, git, installTestAuth, makeDecision, makeFixture, policyJson, subjectOf, type Fixture } from './fixtures/review-fixture.ts';
import type { NormalizedDecision, RegisterSnapshot } from '../src/lib/intel/schema.ts';

const auth = installTestAuth();
const fixtures: Fixture[] = [];
after(() => {
  for (const f of fixtures) f.cleanup();
});

type U = (typeof USERS)[keyof typeof USERS];

function world(opts: Parameters<typeof makeFixture>[0] = {}, github?: (real: LocalGitHub) => GitHubPort) {
  const fx = makeFixture(opts);
  fixtures.push(fx);
  fx.setIdentity(USERS.owner);
  const real = new LocalGitHub(path.join(fx.state, 'prs.json'), fx.remote);
  const identity = new FixtureIdentity(path.join(fx.state, 'identity.json'));
  const store = new ReviewStore(path.join(fx.state, 'review'));
  let t = Date.parse('2026-10-30T00:00:00Z');
  const svc = new ReviewService({ root: fx.work, readRef: 'HEAD', canonicalRef: 'origin/main', store, github: github ? github(real) : real, publisher: new GitPublisher(fx.work), identity, now: () => new Date((t += 1000)) });
  let n = 0;
  const key = () => `key-${++n}-abcdefgh`;
  const as = async (u: U): Promise<VerifiedUser> => {
    fx.setIdentity(u);
    return identity.verify();
  };
  const submit = async (d: NormalizedDecision, u: VerifiedUser | null, action: ActionKind, extra: Record<string, unknown> = {}) => {
    const v = svc.view(d, u);
    const r = await svc.submit(u, d, { action, expectedRevision: v.revision, idempotencyKey: key(), ...extra });
    return { ...r, proposal: r.proposal as Proposal & { event: ReviewEvent } };
  };
  /** Submit, send to GitHub, merge as a person would, and let the Studio verify it. */
  const decideAndMerge = async (d: NormalizedDecision, u: VerifiedUser, action: ActionKind, extra: Record<string, unknown> = {}) => {
    const { proposal } = await submit(d, u, action, extra);
    const sent = await svc.sync(proposal.id);
    assert.equal(sent.state, 'pull-request-created');
    fx.merge(sent.prNumber!);
    const done = await svc.sync(proposal.id);
    assert.equal(done.state, 'applied');
    return done as Proposal & { event: ReviewEvent };
  };
  return { fx, svc, store, real, identity, key, as, submit, decideAndMerge };
}

const code = (c: string) => (e: unknown) => e instanceof ServiceError && e.code === c;
const REASON = 'The residency analysis in the design review supports this choice.';

describe('approval', () => {
  it('approves the recommended option through a pull request and is canonical only after the merge', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0101' });
    const owner = await w.as(USERS.owner);
    const before = { head: git(w.fx.work, 'rev-parse', 'HEAD'), status: git(w.fx.work, 'status', '--porcelain'), branches: git(w.fx.work, 'for-each-ref', 'refs/heads') };

    const { proposal, duplicate } = await w.submit(d, owner, 'approve');
    assert.equal(duplicate, false);
    assert.equal(proposal.state, 'locally-submitted');
    assert.equal(proposal.event.option?.key, 'B');
    assert.equal(proposal.event.option?.recommended, true);
    assert.equal(w.svc.canonical().states.get('ADR-0101'), undefined, 'nothing is canonical yet');
    assert.equal(git(w.fx.remote, 'rev-parse', '--verify', 'refs/heads/main'), git(w.fx.work, 'rev-parse', 'origin/main'), 'the canonical branch was not touched');

    const sent = await w.svc.sync(proposal.id);
    assert.equal(sent.state, 'pull-request-created');
    assert.ok(sent.prNumber);
    assert.ok(git(w.fx.remote, 'for-each-ref', 'refs/heads/decision-review').includes(sent.branch));
    assert.equal(git(w.fx.remote, 'rev-parse', 'refs/heads/main'), git(w.fx.work, 'rev-parse', 'origin/main'), 'main is still untouched after the push');
    assert.equal(w.svc.canonical().states.get('ADR-0101'), undefined, 'a pull request is not a decision');

    assert.equal((await w.svc.sync(proposal.id)).state, 'awaiting-merge');
    w.fx.merge(sent.prNumber!);
    const done = await w.svc.sync(proposal.id);
    assert.equal(done.state, 'applied');
    const s = w.svc.canonical().states.get('ADR-0101')!;
    assert.equal(s.phase, 'approved');
    assert.equal(s.effectiveStatus, 'Approved');
    assert.equal(s.problems.length, 0);

    // The commit is attributed to the person, contains exactly one file, and the working repository was not touched.
    const file = eventPath('ADR-0101', 1, 'approve');
    assert.equal(git(w.fx.remote, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'refs/heads/main'), file);
    assert.match(git(w.fx.remote, 'log', '-1', '--format=%an <%ae>', 'refs/heads/main'), /Test Owner <1001\+test-owner@users\.noreply\.github\.com>/);
    assert.deepEqual({ head: git(w.fx.work, 'rev-parse', 'HEAD'), status: git(w.fx.work, 'status', '--porcelain'), branches: git(w.fx.work, 'for-each-ref', 'refs/heads') }, before);
  });

  it('shows Approved on the register only after the merge, with the source status preserved', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0102' });
    const owner = await w.as(USERS.owner);
    const reg = (r: NormalizedDecision[]): RegisterSnapshot => ({ commit: 'x', ref: 'HEAD', records: r, duplicates: [], validation: { checked: r.length, valid: r.length, issues: [] }, suggestions: [], warnings: [], stats: { total: r.length, byStatus: { Proposed: r.length, 'Pending Review': 0, Approved: 0, Rejected: 0, Deferred: 0, Superseded: 0, Blocked: 0 }, byKind: { adr: r.length, 'register-entry': 0 }, populated: {}, filesRead: 0, filesReused: 0, filesReparsed: 0, filesRemoved: 0 } });
    const { proposal } = await w.submit(d, owner, 'approve');
    await w.svc.sync(proposal.id);
    let shown = applyReviewOverlay(reg([d]), w.svc.canonical().states, 'origin/main');
    assert.equal(shown.records[0]!.status, 'Proposed', 'an unmerged proposal changes nothing');
    assert.equal(shown.stats.byStatus.Approved, 0);
    w.fx.merge((await w.svc.sync(proposal.id)).prNumber!);
    await w.svc.sync(proposal.id);
    shown = applyReviewOverlay(reg([d]), w.svc.canonical().states, 'origin/main');
    const r = shown.records[0]!;
    assert.equal(r.status, 'Approved');
    assert.equal(r.approvalBasis, 'review-record');
    assert.equal(r.review?.sourceStatus, 'Proposed');
    assert.ok(r.flags.some((f) => f.code === 'review-record-approval'));
    assert.equal(r.approvalHistory[0]!.type, 'review-event');
    assert.equal(r.approvalHistory[0]!.signed, false, 'a review record is never presented as a signed approval');
    assert.equal(shown.stats.byStatus.Approved, 1);
  });
});

describe('rejection', () => {
  it('requires a rationale, records it, and shows Rejected only after the merge', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0103' });
    const owner = await w.as(USERS.owner);
    await assert.rejects(w.submit(d, owner, 'reject'), code('invalid'));
    await assert.rejects(w.submit(d, owner, 'reject', { rationale: 'no' }), code('invalid'));
    await assert.rejects(w.submit(d, owner, 'reject', { rationale: '          ' }), code('invalid'));
    assert.equal(w.store.list().length, 0, 'a refused rejection leaves no proposal');
    const done = await w.decideAndMerge(d, owner, 'reject', { rationale: 'Violates the residency constraint HC-01.' });
    assert.equal(done.event.rationale, 'Violates the residency constraint HC-01.');
    assert.equal(w.svc.canonical().states.get('ADR-0103')!.effectiveStatus, 'Rejected');
  });
});

describe('alternative approval', () => {
  it('records which alternative was chosen and why', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0104' });
    const owner = await w.as(USERS.owner);
    await assert.rejects(w.submit(d, owner, 'approve-alternative', { optionKey: 'C' }), code('invalid'), 'an alternative needs a rationale');
    await assert.rejects(w.submit(d, owner, 'approve-alternative', { rationale: REASON }), code('invalid'), 'an alternative must be named');
    await assert.rejects(w.submit(d, owner, 'approve-alternative', { optionKey: 'Z', rationale: REASON }), code('invalid'));
    await assert.rejects(w.submit(d, owner, 'approve-alternative', { optionKey: 'B', rationale: REASON }), code('invalid'), 'the recommended option is not an alternative');
    const done = await w.decideAndMerge(d, owner, 'approve-alternative', { optionKey: 'C', rationale: REASON });
    assert.deepEqual(done.event.option, { key: 'C', name: 'Buy it', recommended: false });
    const s = w.svc.canonical().states.get('ADR-0104')!;
    assert.equal(s.approvedOption?.key, 'C');
    const shown = applyReviewOverlay({ commit: 'x', ref: 'HEAD', records: [d], duplicates: [], validation: { checked: 1, valid: 1, issues: [] }, suggestions: [], warnings: [], stats: { total: 1, byStatus: { Proposed: 1, 'Pending Review': 0, Approved: 0, Rejected: 0, Deferred: 0, Superseded: 0, Blocked: 0 }, byKind: { adr: 1, 'register-entry': 0 }, populated: {}, filesRead: 0, filesReused: 0, filesReparsed: 0, filesRemoved: 0 } }, w.svc.canonical().states, 'origin/main');
    assert.ok(shown.records[0]!.flags.some((f) => f.code === 'alternative-selected'));
  });

  it('a decision with no recommended option cannot be approved as recommended, only by explicit selection', async () => {
    const w = world();
    const d = makeDecision({ id: 'D-010', kind: 'register-entry', recommendedOption: null, options: makeDecision({ id: 'x' }).options.map((o) => ({ ...o, recommended: false })), status: 'Pending Review' });
    const owner = await w.as(USERS.owner);
    await assert.rejects(w.submit(d, owner, 'approve'), code('not-allowed'));
    const done = await w.decideAndMerge(d, owner, 'approve-alternative', { optionKey: 'A', rationale: REASON });
    assert.equal(done.event.option?.key, 'A');
  });
});

describe('conditional approval', () => {
  it('captures every condition and carries them to the canonical state', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0105' });
    const owner = await w.as(USERS.owner);
    await assert.rejects(w.submit(d, owner, 'approve-with-conditions'), code('invalid'));
    await assert.rejects(w.submit(d, owner, 'approve-with-conditions', { conditions: ['', '   '] }), code('invalid'));
    const done = await w.decideAndMerge(d, owner, 'approve-with-conditions', { conditions: ['Confirm in-country region support (D-010)', 'Re-review after the pilot'] });
    assert.deepEqual(done.event.conditions, ['Confirm in-country region support (D-010)', 'Re-review after the pilot']);
    assert.equal(done.event.option?.key, 'B', 'defaults to the recommended option');
    const s = w.svc.canonical().states.get('ADR-0105')!;
    assert.equal(s.phase, 'approved-with-conditions');
    assert.equal(s.effectiveStatus, 'Approved');
    assert.equal(s.conditions.length, 2);
  });
});

describe('reopening and history', () => {
  it('cannot overwrite an approval, can reopen through the workflow, and keeps every earlier version', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0106' });
    const owner = await w.as(USERS.owner);
    await w.decideAndMerge(d, owner, 'approve');
    for (const a of ['approve', 'approve-alternative', 'reject', 'defer', 'approve-with-conditions'] as ActionKind[]) {
      const v = w.svc.view(d, owner);
      assert.equal(v.actions.find((x) => x.action === a)!.allowed, false, `${a} is not offered after approval`);
      await assert.rejects(w.svc.submit(owner, d, { action: a, expectedRevision: v.revision, idempotencyKey: w.key(), optionKey: 'C', rationale: REASON, conditions: ['x'] }), code('not-allowed'));
    }
    await assert.rejects(w.submit(d, owner, 'reopen'), code('invalid'), 'reopening needs a rationale');
    await w.decideAndMerge(d, owner, 'reopen', { rationale: 'New evidence on cost changes the trade-off.' });
    assert.equal(w.svc.canonical().states.get('ADR-0106')!.effectiveStatus, 'Pending Review');
    await w.decideAndMerge(d, owner, 'reject', { rationale: 'The new cost evidence rules the option out.' });
    const s = w.svc.canonical().states.get('ADR-0106')!;
    assert.equal(s.effectiveStatus, 'Rejected');
    assert.deepEqual(s.events.map((e) => e.action), ['approve', 'reopen', 'reject']);
    assert.equal(s.events[0]!.eventHash, hashEvent(s.events[0]!), 'the first approval is still on record, unchanged');
    assert.equal(s.problems.length, 0);
    const files = git(w.fx.remote, 'ls-tree', '-r', '--name-only', 'refs/heads/main').split('\n').filter((f) => f.includes('ADR-0106'));
    assert.equal(files.length, 3, 'three append-only files, none rewritten');
  });

  it('an ADR the source already approved is protected, but can be reopened', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0107', status: 'Approved', statusRaw: 'Accepted', approvalBasis: 'owner-instruction-unsigned' });
    const owner = await w.as(USERS.owner);
    const v = w.svc.view(d, owner);
    for (const a of v.actions) assert.equal(a.allowed, ['reopen', 'comment', 'recommend'].includes(a.action), a.action);
    await assert.rejects(w.submit(d, owner, 'approve'), code('not-allowed'));
    await w.decideAndMerge(d, owner, 'reopen', { rationale: 'The owner wants this decision revisited.' });
    assert.equal(w.svc.view(d, owner).actions.find((x) => x.action === 'approve')!.allowed, true);
  });

  it('request revision, defer and comment are recorded and do not close the decision', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0108' });
    const owner = await w.as(USERS.owner);
    await assert.rejects(w.submit(d, owner, 'defer'), code('invalid'));
    await assert.rejects(w.submit(d, owner, 'request-revision'), code('invalid'));
    await assert.rejects(w.submit(d, owner, 'comment', { comment: '   ' }), code('invalid'));
    await w.decideAndMerge(d, owner, 'request-revision', { rationale: 'Add the cost comparison before deciding.' });
    assert.equal(w.svc.canonical().states.get('ADR-0108')!.effectiveStatus, 'Pending Review');
    await w.decideAndMerge(d, owner, 'comment', { comment: 'Waiting on the sovereignty lead.' });
    assert.equal(w.svc.canonical().states.get('ADR-0108')!.effectiveStatus, 'Pending Review', 'a comment changes no status');
    // The person who asked for the revision proposed it, so a different owner decides.
    await assert.rejects(w.submit(d, owner, 'defer', { rationale: 'Postponed to milestone M2.' }), code('sod-proposer'));
    const owner2 = await w.as(USERS.owner2);
    await w.decideAndMerge(d, owner2, 'defer', { rationale: 'Postponed to milestone M2.' });
    assert.equal(w.svc.canonical().states.get('ADR-0108')!.effectiveStatus, 'Deferred');
    await w.decideAndMerge(d, owner2, 'approve');
    assert.equal(w.svc.canonical().states.get('ADR-0108')!.effectiveStatus, 'Approved', 'a deferred decision can still be decided');
  });
});

describe('quality gates and authority', () => {
  it('refuses to approve a Blocked decision, but allows reject, defer, revision and comment', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0109', status: 'Blocked', statusRule: 'its design review is declared Blocked' });
    const owner = await w.as(USERS.owner);
    for (const a of ['approve', 'approve-alternative', 'approve-with-conditions'] as ActionKind[]) {
      await assert.rejects(w.submit(d, owner, a, { optionKey: 'C', rationale: REASON, conditions: ['x'] }), code('not-allowed'), a);
    }
    const v = w.svc.view(d, owner);
    for (const a of ['reject', 'defer', 'request-revision', 'comment']) assert.equal(v.actions.find((x) => x.action === a)!.allowed, true, a);
    await w.decideAndMerge(d, owner, 'reject', { rationale: 'Blocked and not fixable in this milestone.' });
  });

  it('a reopened decision that the source says is Blocked still cannot be approved', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0110', status: 'Blocked' });
    const owner = await w.as(USERS.owner);
    await w.decideAndMerge(d, owner, 'reject', { rationale: 'Rejected for now, pending the review.' });
    await w.decideAndMerge(d, owner, 'reopen', { rationale: 'Review is being redone.' });
    // After the overlay the record no longer says Blocked, but its source status still does.
    const shown = { ...d, status: 'Pending Review' as const, review: { phase: 'reopened', sourceStatus: 'Blocked' as const, sourceStatusRule: 'design review Blocked', decidingEventId: 'x' } };
    const v = w.svc.view(shown, owner);
    assert.equal(v.actions.find((a) => a.action === 'approve')!.allowed, false);
  });

  it('denies an unauthenticated caller, a person with no role, a role that cannot approve, a bot and a recycled login', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0111' });
    await assert.rejects(w.submit(d, null, 'approve'), code('unauthenticated'));

    const outsider = await w.as(USERS.outsider);
    await assert.rejects(w.submit(d, outsider, 'approve'), code('missing-permission'), 'a viewer cannot approve');

    const contrib = await w.as(USERS.contrib);
    await assert.rejects(w.submit(d, contrib, 'approve'), code('missing-permission'), 'a contributor proposes, it does not approve');

    const security = await w.as(USERS.security);
    await assert.rejects(w.submit(d, security, 'approve'), code('missing-permission'), 'a security reviewer cannot approve an architecture decision');
    const sv = w.svc.view(d, security);
    assert.equal(sv.actions.find((a) => a.action === 'approve')!.authorised, false);
    assert.match(sv.actions.find((a) => a.action === 'approve')!.authReason ?? '', /approve/i);

    const admin = await w.as(USERS.admin);
    await assert.rejects(w.submit(d, admin, 'approve'), code('missing-permission'), 'an administrator manages access and approves nothing');

    w.fx.setIdentity(USERS.bot);
    await assert.rejects(w.identity.verify(), (e: unknown) => e instanceof IdentityError && e.code === 'NOT_A_PERSON');

    const impostor = await w.as(USERS.impostor);
    await assert.rejects(w.submit(d, impostor, 'approve'), code('missing-permission'), 'right login, wrong GitHub id');

    assert.equal(w.store.list().length, 0, 'nothing was recorded for any denied attempt');
    const denied = w.store.readAudit({ decisionId: 'ADR-0111' }).filter((a) => a.outcome === 'denied');
    assert.equal(denied.length, 6, 'every denied submission is in the audit log (the bot was refused earlier, at sign-in)');
  });

  it('approval domains are separate: a security-gate record needs the security reviewer, and a regulatory record is never approvable', async () => {
    const w = world();
    const sec = makeDecision({ id: 'ADR-0112', kind: 'register-entry', requiredApproverRole: { text: 'Security architect', basis: 'test' } });
    const owner = await w.as(USERS.owner);
    await assert.rejects(w.submit(sec, owner, 'approve'), code('missing-permission'), 'an architecture owner cannot approve a security gate');
    const security = await w.as(USERS.security);
    const done = await w.decideAndMerge(sec, security, 'approve');
    assert.equal(done.event.roleCheck.domain, 'security');
    assert.deepEqual(done.event.roleCheck.held.includes('security-reviewer'), true);

    const filing = makeDecision({ id: 'ADR-0113', requiredApproverRole: { text: 'Quality manager', basis: 'test' } });
    for (const u of [USERS.owner, USERS.owner2, USERS.security, USERS.admin]) {
      const who = await w.as(u);
      await assert.rejects(w.submit(filing, who, 'approve'), code('domain-not-approvable'), `${u.login} cannot approve a regulatory record`);
    }
    const v = w.svc.view(filing, await w.as(USERS.owner));
    assert.equal(v.governance.domain, 'regulatory');
    const unclassified = makeDecision({ id: 'D-900', kind: 'register-entry', requiredApproverRole: { text: 'Somebody unknown', basis: 'test' } });
    await assert.rejects(w.submit(unclassified, await w.as(USERS.owner), 'approve'), code('domain-not-approvable'), 'an unclassified record is not approvable');
  });

  it('only the designated approver may decide, even with the right role', async () => {
    const w = world({ policy: policyJson({ ownership: [{ domain: 'architecture', scope: { all: true }, owners: ['github:1001'] }] }) });
    const d = makeDecision({ id: 'ADR-0114' });
    await assert.rejects(w.submit(d, await w.as(USERS.owner2), 'approve'), code('not-designated'));
    await w.decideAndMerge(d, await w.as(USERS.owner), 'approve');
  });

  it('with no policy, or an empty one, nobody can decide; a person with no role can still read', async () => {
    const w = world({ policy: null });
    const d = makeDecision({ id: 'ADR-0115' });
    const owner = await w.as(USERS.owner);
    assert.equal(w.svc.policy().source, 'missing');
    await assert.rejects(w.submit(d, owner, 'approve'), code('policy-invalid'));
    const w2 = world({ policy: policyJson({ people: [] }) });
    const o2 = await w2.as(USERS.owner);
    await assert.rejects(w2.submit(d, o2, 'reject', { rationale: REASON }), code('missing-permission'));
    const out = await w2.as(USERS.outsider);
    await assert.rejects(w2.submit(d, out, 'comment', { comment: 'A question for the owner.' }), code('missing-permission'), 'a viewer cannot even comment');
  });

  it('a policy emptied on the canonical branch wins over the local copy', async () => {
    const w = world();
    const rm = w.fx.commitToMain({ 'harness/policy/access-policy.json': policyJson({ people: [] }) }, 'empty the canonical policy');
    git(w.fx.work, 'fetch', '-q', 'origin');
    assert.ok(rm);
    const d = makeDecision({ id: 'ADR-0116' });
    const owner = await w.as(USERS.owner);
    await assert.rejects(w.submit(d, owner, 'approve'), code('missing-permission'), 'the canonical policy wins over the local one');
  });
  it('refuses to sign in inside an agent session, and sessions expire', async () => {
    const prev = process.env.HARNESS_AGENT_SESSION;
    process.env.HARNESS_AGENT_SESSION = '1';
    try {
      await assert.rejects(new GhCliIdentity().verify(), (e: unknown) => e instanceof IdentityError && e.code === 'AGENT_SESSION');
    } finally {
      if (prev === undefined) delete process.env.HARNESS_AGENT_SESSION;
      else process.env.HARNESS_AGENT_SESSION = prev;
    }
    let now = 1_000;
    const s = new SessionStore(() => now);
    const sess = s.create({ provider: 'github', subject: '1', tenantId: null, login: 'a', id: 1, name: null, type: 'User', verifiedBy: 'test-fixture', entraRoles: [], entraGroups: [], mfa: false, authAt: now }, { idleMinutes: 600, absoluteHours: 8 });
    assert.ok(s.get(sess.token));
    now += 9 * 60 * 60 * 1000;
    assert.equal(s.get(sess.token), null);
    assert.equal(s.get(undefined), null);
  });

  it('re-verifies the GitHub account at the moment of acting', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0116' });
    const owner = await w.as(USERS.owner);
    const v = w.svc.view(d, owner);
    w.fx.setIdentity(USERS.security); // someone ran `gh auth switch`
    await assert.rejects(w.svc.submit(owner, d, { action: 'approve', expectedRevision: v.revision, idempotencyKey: w.key() }), code('identity-changed'));
    w.fx.setIdentity(null);
    await assert.rejects(w.svc.submit(owner, d, { action: 'approve', expectedRevision: v.revision, idempotencyKey: w.key() }), code('identity-unverified'));
  });
});

describe('duplicate submission', () => {
  it('returns the same proposal for the same key, and opens one pull request', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0120' });
    const owner = await w.as(USERS.owner);
    const v = w.svc.view(d, owner);
    const req = { action: 'approve' as const, expectedRevision: v.revision, idempotencyKey: 'double-click-1234' };
    const [a, b] = await Promise.all([w.svc.submit(owner, d, req), w.svc.submit(owner, d, req)]);
    assert.equal(a.proposal.id, b.proposal.id);
    assert.deepEqual([a.duplicate, b.duplicate].sort(), [false, true]);
    const c = await w.svc.submit(owner, d, req);
    assert.equal(c.duplicate, true, 'also after the revision has moved on');
    await Promise.all([w.svc.sync(a.proposal.id), w.svc.sync(a.proposal.id)]);
    assert.equal(w.store.list().length, 1);
    assert.equal(JSON.parse(await import('node:fs').then((m) => m.readFileSync(path.join(w.fx.state, 'prs.json'), 'utf8'))).prs.length, 1, 'one pull request');
  });

  it('refuses a second, different change while one is in flight (one decision at a time)', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0121' });
    const owner = await w.as(USERS.owner);
    const first = await w.submit(d, owner, 'approve');
    const v = w.svc.view(d, owner);
    assert.equal(v.open?.id, first.proposal.id);
    await assert.rejects(w.svc.submit(owner, d, { action: 'reject', expectedRevision: v.revision, idempotencyKey: w.key(), rationale: REASON }), code('proposal-open'));
  });
});

describe('stale revision', () => {
  it('refuses a decision made on an out-of-date view', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0130' });
    const owner = await w.as(USERS.owner);
    const stale = w.svc.view(d, owner).revision;
    await w.decideAndMerge(d, owner, 'comment', { comment: 'A comment lands first.' });
    await assert.rejects(w.svc.submit(owner, d, { action: 'approve', expectedRevision: stale, idempotencyKey: w.key() }), (e: unknown) => e instanceof ServiceError && e.code === 'stale-revision' && typeof e.extra.currentRevision === 'string');
    const fresh = w.svc.view(d, owner).revision;
    assert.notEqual(fresh, stale);
    await w.submit(d, owner, 'approve');
  });

  it('refuses when the decision record itself changed after the view was loaded', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0131' });
    const owner = await w.as(USERS.owner);
    const stale = w.svc.view(d, owner).revision;
    const changed = { ...d, contentHash: 'hash-after-edit' };
    await assert.rejects(w.svc.submit(owner, changed, { action: 'approve', expectedRevision: stale, idempotencyKey: w.key() }), code('stale-revision'));
  });

  it('requires a revision and a well-formed idempotency key', async () => {
    const d = makeDecision({ id: 'ADR-0132' });
    assert.equal(validateRequest({ action: 'approve', idempotencyKey: 'abcdefgh-1' }, d).ok, false);
    assert.equal(validateRequest({ action: 'approve', expectedRevision: 'r', idempotencyKey: 'short' }, d).ok, false);
    assert.equal(validateRequest({ action: 'nope' as ActionKind, expectedRevision: 'r', idempotencyKey: 'abcdefgh-1' }, d).ok, false);
    assert.equal(validateRequest({ action: 'approve', expectedRevision: 'r', idempotencyKey: 'abcdefgh-1' }, d).ok, true);
  });
});

describe('GitHub synchronisation failures', () => {
  it('keeps the proposal and retries when GitHub is unreachable', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0140' });
    const owner = await w.as(USERS.owner);
    const { proposal } = await w.submit(d, owner, 'approve');
    git(w.fx.work, 'remote', 'set-url', 'origin', path.join(w.fx.dir, 'does-not-exist.git'));
    const failed = await w.svc.sync(proposal.id);
    assert.equal(failed.state, 'awaiting-github-update');
    assert.equal(failed.lastError?.retryable, true);
    assert.equal(failed.attempts, 1);
    assert.equal(w.svc.canonical().states.get('ADR-0140'), undefined);
    git(w.fx.work, 'remote', 'set-url', 'origin', w.fx.remote);
    const ok = await w.svc.sync(proposal.id);
    assert.equal(ok.state, 'pull-request-created');
    assert.equal(ok.lastError, null);
  });

  it('retries when pull-request creation fails, without pushing the branch twice', async () => {
    let failures = 1;
    const w = world({}, (real) => ({
      createPullRequest: async (a) => {
        if (failures-- > 0) throw new GitHubError('GitHub: 502 bad gateway', true);
        return real.createPullRequest(a);
      },
      findByHead: (h) => real.findByHead(h),
      get: (n) => real.get(n),
    }));
    const d = makeDecision({ id: 'ADR-0141' });
    const owner = await w.as(USERS.owner);
    const { proposal } = await w.submit(d, owner, 'approve');
    const first = await w.svc.sync(proposal.id);
    assert.equal(first.state, 'awaiting-github-update');
    assert.ok(first.headSha, 'the commit was prepared and kept');
    assert.ok(git(w.fx.remote, 'for-each-ref', 'refs/heads/decision-review').includes(first.branch), 'the branch is on GitHub');
    const second = await w.svc.sync(proposal.id);
    assert.equal(second.state, 'pull-request-created');
    assert.equal(second.headSha, first.headSha, 'the same commit was reused');
  });

  it('marks a closed-unmerged pull request Failed, frees the decision, and never shows it as decided', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0142' });
    const owner = await w.as(USERS.owner);
    const { proposal } = await w.submit(d, owner, 'approve');
    const sent = await w.svc.sync(proposal.id);
    w.real.close(sent.prNumber!);
    const closed = await w.svc.sync(proposal.id);
    assert.equal(closed.state, 'failed');
    assert.equal(closed.lastError?.code, 'PR_CLOSED');
    assert.equal(closed.lastError?.retryable, false);
    assert.equal(w.svc.canonical().states.get('ADR-0142'), undefined);
    assert.equal(w.svc.view(d, owner).open, null, 'the decision is free again');
    assert.equal(w.svc.view(d, owner).recent[0]!.state, 'failed');
    await w.decideAndMerge(d, owner, 'reject', { rationale: 'Decided differently after the closed request.' });
  });

  it('marks a proposal Conflicted when another event for the same decision reached the canonical branch first', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0143' });
    const owner = await w.as(USERS.owner);
    const { proposal } = await w.submit(d, owner, 'approve');
    // Someone else's event number 1 lands on the canonical branch while ours waits.
    const theirs = event(d, 1, 'reject', null, { rationale: 'Rejected by someone else first.' });
    w.fx.commitToMain({ [eventPath('ADR-0143', 1, 'reject')]: serializeEvent(theirs) });
    const result = await w.svc.sync(proposal.id);
    assert.ok(['conflicted'].includes(result.state), result.state);
    assert.equal(result.lastError?.retryable, false);
    assert.equal(git(w.fx.remote, 'for-each-ref', 'refs/heads/decision-review'), '', 'nothing was pushed');
    assert.equal(w.svc.canonical().states.get('ADR-0143')!.effectiveStatus, 'Rejected');
    assert.equal(w.svc.view(d, owner).open, null);
  });

  it('is Conflicted when the canonical branch moved for this decision after the pull request was opened', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0144' });
    const owner = await w.as(USERS.owner);
    const { proposal } = await w.submit(d, owner, 'approve');
    const sent = await w.svc.sync(proposal.id);
    assert.equal(sent.state, 'pull-request-created');
    w.fx.commitToMain({ [eventPath('ADR-0144', 1, 'comment')]: serializeEvent(event(d, 1, 'comment', null, { comment: 'A competing comment.' })) });
    assert.throws(() => w.fx.merge(sent.prNumber!), /not a fast-forward/, 'the pull request can no longer merge cleanly');
    assert.equal((await w.svc.sync(proposal.id)).state, 'conflicted');
  });

  it('fails without retry when a different branch already holds the proposal name, and never forces', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0145' });
    const owner = await w.as(USERS.owner);
    const { proposal } = await w.submit(d, owner, 'approve');
    const other = w.fx.pushBranch(proposal.branch, { 'unrelated.txt': 'x' });
    const r = await w.svc.sync(proposal.id);
    assert.equal(r.state, 'failed');
    assert.equal(r.lastError?.code, 'BRANCH_EXISTS_DIFFERENT');
    assert.equal(git(w.fx.remote, 'rev-parse', `refs/heads/${proposal.branch}`), other, 'the other branch is untouched');
  });

  it('a merged pull request whose file is not on the canonical branch is flagged, not trusted', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0146' });
    const owner = await w.as(USERS.owner);
    const { proposal } = await w.submit(d, owner, 'approve');
    const sent = await w.svc.sync(proposal.id);
    w.fx.merge(sent.prNumber!);
    // After the merge someone reverts the file on the canonical branch. The pull request is merged, but the event is not there.
    w.fx.commitToMain({}, 'revert the decision', [eventPath('ADR-0146', 1, 'approve')]);
    const r = await w.svc.sync(proposal.id);
    assert.equal(r.state, 'conflicted');
    assert.equal(r.lastError?.code, 'MERGED_BUT_DIFFERENT');
    assert.equal(w.svc.canonical().states.get('ADR-0146'), undefined);
  });
});

describe('tamper evidence on the canonical branch', () => {
  it('ignores an edited event, a missing event and a forged hash, and reports the problem', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0150' });
    const owner = await w.as(USERS.owner);
    await w.decideAndMerge(d, owner, 'comment', { comment: 'First.' });
    const good = w.svc.canonical().states.get('ADR-0150')!.events[0]!;

    // 1. an event file edited after the fact
    const edited = { ...good, comment: 'Edited later.' };
    assert.ok('error' in parseEvent(JSON.stringify(edited)));

    // 2. a gap: event 3 without event 2
    const e3 = event(d, 3, 'approve', good.eventHash);
    w.fx.commitToMain({ [eventPath('ADR-0150', 3, 'approve')]: serializeEvent(e3) });
    git(w.fx.work, 'fetch', '-q', 'origin');
    let s = w.svc.canonical().states.get('ADR-0150')!;
    assert.equal(s.effectiveStatus, null, 'an approval after a gap is not applied');
    assert.equal(s.events.length, 1);

    // 3. a forged hash is a parse error, reported against the decision
    const forged = { ...event(d, 2, 'approve', good.eventHash), eventHash: 'f'.repeat(64) };
    w.fx.commitToMain({ [eventPath('ADR-0150', 2, 'approve')]: `${JSON.stringify(forged, null, 2)}\n` });
    git(w.fx.work, 'fetch', '-q', 'origin');
    s = w.svc.canonical().states.get('ADR-0150')!;
    assert.ok(s.problems.some((p) => /eventHash does not match/.test(p)), s.problems.join('; '));
    assert.equal(s.effectiveStatus, null);
    const v = w.svc.view(d, owner);
    assert.ok(v.actions.every((a) => !a.allowed), 'an inconsistent record offers no action until it is fixed in the repository');
  });

  it('refuses an event whose previous-hash does not chain, a decision from another id, and an action not allowed in the phase', () => {
    const d = makeDecision({ id: 'ADR-0151' });
    const a = event(d, 1, 'approve', null);
    const bad = event(d, 2, 'approve', 'a'.repeat(64));
    assert.match(foldEvents('ADR-0151', [a, bad]).problems[0]!, /prevHash/);
    const again = event(d, 2, 'approve', a.eventHash);
    assert.match(foldEvents('ADR-0151', [a, again]).problems[0]!, /not allowed while the decision is approved/);
    assert.match(foldEvents('ADR-0999', [a]).problems[0]!, /another decision/);
    assert.equal(foldEvents('ADR-0151', [a]).effectiveStatus, 'Approved');
  });

  it('parseEvent rejects unknown fields, bad ids and unknown actions', () => {
    const d = makeDecision({ id: 'ADR-0152' });
    const e = event(d, 1, 'comment', null, { comment: 'x' });
    assert.ok('event' in parseEvent(serializeEvent(e)));
    assert.ok('error' in parseEvent(JSON.stringify({ ...e, extra: 1 })));
    assert.ok('error' in parseEvent(JSON.stringify({ ...e, id: 'DR-ADR-0152-0009' })));
    assert.ok('error' in parseEvent(JSON.stringify({ ...e, action: 'obliterate' })));
    assert.ok('error' in parseEvent('{'));
    assert.equal(sha256(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })), sha256('{"a":[2,{"c":2,"d":1}],"b":1}'), 'canonical JSON sorts keys');
  });
});

describe('publishing is narrow and never touches main', () => {
  it('builds a commit only for review-event files, never overwrites, and pushes only decision-review branches', async () => {
    const w = world();
    const pub = new GitPublisher(w.fx.work);
    const base = pub.fetchCanonical('origin/main');
    const author = { name: 'T', email: 't@example.invalid' };
    for (const bad of ['harness/policy/access-policy.json', 'docs/adr/0001-x.md', '../escape.json', 'docs/decision-reviews/ADR-0001/x.txt']) {
      assert.throws(() => pub.buildCommit({ baseSha: base, files: [{ path: bad, content: '{}' }], author, message: 'm', now: new Date() }), (e: unknown) => e instanceof PublishError && e.code === 'BAD_INPUT', bad);
    }
    const sha = pub.buildCommit({ baseSha: base, files: [{ path: 'docs/decision-reviews/ADR-0001/0001-comment.json', content: '{}\n' }], author, message: 'm', now: new Date() });
    assert.equal(git(w.fx.work, 'rev-parse', `${sha}^`), base);
    assert.throws(() => pub.push('origin', sha, 'main'), (e: unknown) => e instanceof PublishError && e.code === 'BAD_INPUT');
    assert.throws(() => pub.push('origin', sha, 'decision-review/../main'), PublishError);
    assert.throws(() => pub.fetchCanonical('--upload-pack=x'), PublishError);
    assert.equal(git(w.fx.work, 'status', '--porcelain'), '');
  });
});

describe('audit log', () => {
  it('records accepted, denied, stale and duplicate attempts in a hash chain that detects editing', async () => {
    const w = world();
    const d = makeDecision({ id: 'ADR-0160' });
    const owner = await w.as(USERS.owner);
    const v = w.svc.view(d, owner);
    const req = { action: 'approve' as const, expectedRevision: v.revision, idempotencyKey: 'audit-key-0001' };
    await w.svc.submit(owner, d, req);
    await w.svc.submit(owner, d, req);
    await assert.rejects(w.svc.submit(owner, d, { ...req, idempotencyKey: 'audit-key-0002', expectedRevision: 'old' }), code('stale-revision'));
    await assert.rejects(w.svc.submit(null, d, req), code('unauthenticated'));
    const outcomes = w.store.readAudit({ decisionId: 'ADR-0160' }).map((a) => a.outcome).reverse();
    assert.deepEqual(outcomes, ['accepted', 'duplicate', 'stale', 'denied']);
    assert.equal(w.store.verifyAudit(), null);
    const fs = await import('node:fs');
    const f = path.join(w.fx.state, 'review', 'audit.jsonl');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"accepted"', '"denied"'));
    assert.match(w.store.verifyAudit() ?? '', /content changed/);
  });
});

describe('ordering and availability', () => {
  it('the access policy shipped in this repository parses, enrolls only humans by stable subject, and asks for no github approvals in production', async () => {
    const fs = await import('node:fs');
    const text = fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', '..', 'harness', 'policy', 'access-policy.json'), 'utf8');
    const p = parseAccessPolicy(text, 'canonical');
    assert.deepEqual(p.problems, [], `unexpected policy problems: ${p.problems.join('; ')}`);
    assert.ok(p.people.length >= 1 && p.people.every((x) => /^(github:[1-9]\d*|entra:[0-9a-f-]{36}:[0-9a-f-]{36})$/.test(x.subject) && !/\[bot\]$/i.test(x.login)));
    assert.deepEqual(p.authentication.approvalProviders, ['entra']);
    assert.equal(p.segregation.enforce, true);
    assert.ok(p.roleAliases['programme-owner']);
    assert.ok(!p.people.some((x) => x.roles.includes('administrator') && x.roles.some((r) => ['architecture-owner', 'security-reviewer', 'deployment-approver'].includes(r))), 'no one holds administrator together with an approver role');
  });
  it('orders pending decisions: Must first, ADRs before register entries, Blocked last, skipping those with a request in flight', () => {
    const r = [
      makeDecision({ id: 'D-002', kind: 'register-entry', status: 'Pending Review', priority: { value: 'Must', basis: 'x' } }),
      makeDecision({ id: 'ADR-0003', status: 'Blocked' }),
      makeDecision({ id: 'D-001', kind: 'register-entry', status: 'Pending Review', priority: { value: 'Should', basis: 'x' } }),
      makeDecision({ id: 'ADR-0002', status: 'Proposed', priority: { value: 'Must', basis: 'x' } }),
      makeDecision({ id: 'ADR-0001', status: 'Approved' }),
      makeDecision({ id: 'D-003', kind: 'register-entry', status: 'Pending Review', priority: { value: 'Must', basis: 'x' } }),
    ];
    assert.deepEqual(pendingOrder(r, () => false).map((x) => x.id), ['ADR-0002', 'D-002', 'D-003', 'D-001', 'ADR-0003']);
    assert.deepEqual(pendingOrder(r, (id) => id === 'D-002').map((x) => x.id), ['ADR-0002', 'D-003', 'D-001', 'ADR-0003']);
  });

  it('keeps stakeholder clarifications and regulatory verifications out of the review queue, whoever owns them', () => {
    const r = [
      makeDecision({ id: 'D-010', kind: 'register-entry', status: 'Pending Review', natures: ['architecture-choice'] }),
      makeDecision({ id: 'D-003', kind: 'register-entry', status: 'Pending Review', natures: ['stakeholder-clarification'], requiredApproverRole: { text: 'Programme owner', basis: 'x' } }),
      makeDecision({ id: 'D-001', kind: 'register-entry', status: 'Pending Review', natures: ['stakeholder-clarification', 'regulatory-verification'] }),
      makeDecision({ id: 'D-011', kind: 'register-entry', status: 'Pending Review', natures: ['architecture-choice', 'stakeholder-clarification'] }),
      makeDecision({ id: 'D-099', kind: 'register-entry', status: 'Pending Review', natures: [] }),
    ];
    assert.deepEqual(pendingOrder(r, () => false).map((x) => x.id), ['D-010']);
    const p = parseAccessPolicy(policyJson(), 'canonical');
    assert.deepEqual(pendingOrder(r, () => false, p).map((x) => x.id), ['D-010']);
    assert.equal(reviewableInStudio(r[1]!, p), false, 'a clarification owned by the programme owner is still not an architecture approval');
  });

  it('offers every action with a reason when it is unavailable, and parses role names through aliases', () => {
    const d = makeDecision({ id: 'ADR-0170', status: 'Superseded' });
    const av = availability(d, { decisionId: d.id, events: [], phase: 'none', effectiveStatus: null, approvedOption: null, conditions: [], headHash: null, decidingEvent: null, problems: [] });
    assert.equal(av.length, ACTIONS.length);
    assert.ok(av.filter((a) => !a.allowed).every((a) => a.reason));
    const p = parseAccessPolicy(policyJson(), 'canonical');
    assert.equal(p.people.length, PEOPLE.length);
    assert.deepEqual(rolesNamed('Security architect, quality manager', p).sort(), ['quality-manager', 'security-architect']);
  });

  it('a policy entry with no stable subject, not marked human, or listed twice is ignored and reported', () => {
    const ok = (subject: string, over: Record<string, unknown> = {}) => ({ subject, kind: 'human', login: 'x', holder: 'X', roles: ['contributor'], enrolledAt: '2026-01-01T00:00:00Z', enrollment: { basis: 'bootstrap', reference: 'r' }, ...over });
    const p = parseAccessPolicy(JSON.stringify({ version: 2, people: [ok('github:2'), ok('alice@example.com'), ok('github:3', { kind: 'agent' }), ok('github:2'), ok('github:4', { enrolledAt: 'not a date' })] }), 'canonical');
    assert.deepEqual(p.people.map((x) => x.subject), ['github:2']);
    assert.equal(p.problems.filter((m) => !/Nobody/.test(m)).length, 4);
    assert.equal(parseAccessPolicy('{not json', 'canonical').people.length, 0);
    assert.equal(parseAccessPolicy(JSON.stringify({ version: 1, people: [] }), 'canonical').people.length, 0, 'the old format grants nothing');
    assert.equal(parseAccessPolicy(undefined, 'canonical').source, 'missing');
  });
});
/** Build a valid, signed event the way the service does, for tests that put events on the canonical branch directly. */
describe('the merge policy of the canonical branch', () => {
  const policy = (state: 'enforced' | 'partial' | 'absent' | 'unknown') => async () => ({ state, requiresPullRequest: state === 'absent' ? false : state === 'unknown' ? null : true, requiresStatusChecks: state === 'enforced', requiredChecks: [], blocksForcePush: null, branch: 'main', checkedAt: 'x', detail: `main is ${state}` });
  const withPolicy = (state: Parameters<typeof policy>[0]) => {
    const w = world();
    w.svc.deps.mergePolicy = policy(state);
    return w;
  };
  const was = process.env.STUDIO_MERGE_POLICY;
  after(() => {
    if (was === undefined) delete process.env.STUDIO_MERGE_POLICY;
    else process.env.STUDIO_MERGE_POLICY = was;
  });

  it('refuses to send an approval when no rule requires a pull request, records the refusal, and writes nothing', async () => {
    delete process.env.STUDIO_MERGE_POLICY;
    const w = withPolicy('absent');
    const d = makeDecision({ id: 'ADR-0110' });
    const owner = await w.as(USERS.owner);
    const remoteBefore = git(w.fx.remote, 'for-each-ref');
    for (const action of ['approve', 'reject', 'defer', 'request-revision'] as const) {
      await assert.rejects(w.submit(d, owner, action, { rationale: REASON }), code('merge-policy-absent'), action);
    }
    assert.equal(git(w.fx.remote, 'for-each-ref'), remoteBefore, 'nothing reached GitHub');
    assert.equal(w.store.list().length, 0, 'no proposal was created');
    assert.ok(w.store.readAudit({ decisionId: 'ADR-0110', limit: 10 }).some((a) => a.code === 'merge-policy-absent' && a.outcome === 'denied'));
  });

  it('still allows a comment, which changes no status', async () => {
    delete process.env.STUDIO_MERGE_POLICY;
    const w = withPolicy('absent');
    const d = makeDecision({ id: 'ADR-0111' });
    const owner = await w.as(USERS.owner);
    const { proposal } = await w.submit(d, owner, 'comment', { comment: 'A note while the branch is unprotected.' });
    assert.equal(proposal.state, 'locally-submitted');
  });

  it('lets an approval through when the policy is enforced, partial or could not be read', async () => {
    delete process.env.STUDIO_MERGE_POLICY;
    for (const s of ['enforced', 'partial', 'unknown'] as const) {
      const w = withPolicy(s);
      const owner = await w.as(USERS.owner);
      const { proposal } = await w.submit(makeDecision({ id: 'ADR-0112' }), owner, 'approve');
      assert.equal(proposal.state, 'locally-submitted', s);
    }
  });

  it('warn mode shows the problem elsewhere but does not refuse, and the default is to refuse', async () => {
    process.env.STUDIO_MERGE_POLICY = 'warn';
    const w = withPolicy('absent');
    const owner = await w.as(USERS.owner);
    assert.equal((await w.submit(makeDecision({ id: 'ADR-0113' }), owner, 'approve')).proposal.state, 'locally-submitted');
    delete process.env.STUDIO_MERGE_POLICY;
    const w2 = withPolicy('absent');
    await assert.rejects(w2.submit(makeDecision({ id: 'ADR-0113' }), await w2.as(USERS.owner), 'approve'), code('merge-policy-absent'));
  });

  it('is checked after who may act: an unauthorised person is told they may not, not that the branch is open', async () => {
    delete process.env.STUDIO_MERGE_POLICY;
    const w = withPolicy('absent');
    const viewer = await w.as(USERS.outsider);
    await assert.rejects(w.submit(makeDecision({ id: 'ADR-0114' }), viewer, 'approve'), (e: unknown) => e instanceof ServiceError && e.code !== 'merge-policy-absent');
  });
});
function event(d: NormalizedDecision, seq: number, action: ActionKind, prevHash: string | null, extra: { rationale?: string; comment?: string; signed?: boolean; actor?: { login: string; id: number } } = {}): ReviewEvent {
  const who = extra.actor ?? { login: 'test-owner', id: 1001 };
  const body = {
    schema: 'greenfuel.decision-review-event/v2' as const,
    id: eventId(d.id, seq),
    decisionId: d.id,
    seq,
    action,
    actor: { login: who.login, githubId: who.id, name: who.login, verifiedBy: 'test-fixture' as const, provider: 'github' as const, subject: String(who.id), tenantId: null },
    createdAt: new Date(Date.UTC(2026, 9, 30, 1, seq)).toISOString(),
    basis: { recordHash: d.contentHash, sourceStatus: d.status, sourceCommit: 'c'.repeat(40) },
    prevHash,
    option: action === 'approve' ? { key: 'B', name: 'Build it', recommended: true } : null,
    conditions: [],
    rationale: extra.rationale ?? null,
    comment: extra.comment ?? null,
    recommendation: null,
    roleCheck: { critical: true, required: ['architecture-owner'], held: ['architecture-owner'], namedRoles: [], outstanding: [], policySource: 'canonical' as const, domain: 'architecture', policyHash: '', checks: [], authAgeSeconds: 0, mfa: false },
  };
  const eventHash = hashEvent(body);
  return { ...body, eventHash, signature: extra.signed === false ? null : auth.signer.sign(eventHash) } as ReviewEvent;
}