import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { AreaReadiness } from '../src/lib/baseline/readiness.ts';
import type { NormalizedDecision } from '../src/lib/intel/schema.ts';
import type { WorkItem } from '../src/lib/queue/types.ts';
import { approvedOn, buildOverview } from '../src/lib/next/overview.ts';
import { pickNext, rankActions, type ProposalFact, type RankInput } from '../src/lib/next/rank.ts';
import { affectedTasks, baselineChanges, decisionHistory } from '../src/lib/next/changes.ts';
import { staleEvidence } from '../src/lib/next/stale.ts';
import { POINTS } from '../src/lib/next/types.ts';
import { makeDecision } from './fixtures/review-fixture.ts';

// The Next Best Action and the Overview, as rules. Every test builds a small world by hand, so the expected order can be checked by eye.

const dec = (id: string, over: Partial<NormalizedDecision> = {}) => makeDecision({ id, priority: null, status: 'Proposed', ...over });
const item = (id: string, over: Partial<WorkItem> = {}): WorkItem =>
  ({
    id, kind: 'task', class: 'engineering', title: `Task ${id}`, description: '', priority: null, priorityBasis: null, critical: false, criticalBasis: null, status: 'Open', sourceStatus: null, statusBasis: '',
    ownerText: null, ownerRoles: [], assignee: null, source: { path: 'docs/state/TODO.md', line: 1 }, relatedDecisions: [], relatedRequirements: [], relatedRisks: [], rubricCriteria: [], links: [],
    acceptance: null, evidenceRequired: null, dueDate: null, completionEvidence: [], approval: null, derivedBlocks: [], reviewNeeded: [], flags: [], missing: [], blocksBuild: false, milestone: null, mode: [], contentHash: id,
    ...over,
  }) as WorkItem;
const prop = (id: string, subjectId: string, state: ProposalFact['state'], over: Partial<ProposalFact> = {}): ProposalFact => ({ id, subjectId, family: 'decision', action: 'approve', state, prNumber: null, prUrl: null, error: null, ...over });

const base = (over: Partial<RankInput> = {}): RankInput => ({
  decisions: [], nextPhase: new Map(), later: new Map(), gateBlockers: [], approver: () => ({ label: 'the programme owner', isMe: null }), proposals: [], items: [], buildChain: new Map(), stale: [], me: null, ...over,
});
const ids = (as: { subjectId: string }[]) => as.map((a) => a.subjectId);
const sum = (a: { reasons: { points: number }[] }) => a.reasons.reduce((n, r) => n + r.points, 0);

describe('priority ordering', () => {
  it('puts what stands between the architecture and the next phase before anything a later phase needs, however critical that is', () => {
    const decisions = [dec('D-001', { priority: { value: 'Must', basis: 'x' }, blockingRequirements: [{ id: 'FR-1', priority: 'Must' }, { id: 'FR-2', priority: 'Must' }, { id: 'FR-3', priority: 'Must' }], dependedOnBy: ['D-005', 'D-006'] }), dec('D-002'), dec('D-005'), dec('D-006')];
    const out = rankActions(base({ decisions, later: new Map([['D-001', ['production']]]), nextPhase: new Map([['D-002', ['the scope ADR']]]) }));
    assert.equal(out[0]!.subjectId, 'D-002');
    assert.equal(out[0]!.blocksNextPhase, true);
    assert.equal(out.find((a) => a.subjectId === 'D-001')!.neededLater, true);
    assert.ok(out.find((a) => a.subjectId === 'D-001')!.score < POINTS.mandatoryNextPhase, 'later work cannot reach the next-phase weight');
  });

  it('within the same tier, orders by criticality, then by what it unlocks, then by readiness', () => {
    const decisions = [
      dec('D-010', { priority: { value: 'Could', basis: 'x' } }),
      dec('D-011', { priority: { value: 'Must', basis: 'x' } }),
      dec('D-012', { priority: { value: 'Should', basis: 'x' } }),
    ];
    assert.deepEqual(ids(rankActions(base({ decisions }))), ['D-011', 'D-012', 'D-010']);

    const unlocking = [dec('D-020'), dec('D-021', { dependedOnBy: ['D-023', 'D-024'] }), dec('D-023'), dec('D-024')];
    assert.equal(ids(rankActions(base({ decisions: unlocking })))[0], 'D-021', 'the one two others wait on comes first');

    const waiting = [dec('D-030', { dependsOn: ['D-031'] }), dec('D-031', { status: 'Proposed' }), dec('D-032')];
    const r = rankActions(base({ decisions: waiting }));
    assert.ok(r.findIndex((a) => a.subjectId === 'D-030') > r.findIndex((a) => a.subjectId === 'D-032'), 'a decision waiting on an undecided one ranks below a free one');
  });

  it('puts a change that did not reach GitHub above ordinary review, and a mandatory decision above that', () => {
    const decisions = [dec('D-040'), dec('D-041'), dec('D-042')];
    const out = rankActions(base({ decisions, proposals: [prop('P-1', 'D-041', 'failed', { error: 'GitHub is unreachable' })], nextPhase: new Map([['D-042', ['g']]]) }));
    assert.deepEqual(out.slice(0, 3).map((a) => a.key), ['decision:D-042', 'proposal:P-1', 'decision:D-040']);
    assert.equal(out[1]!.kind, 'sync-failure');
    assert.ok(!out.some((a) => a.key === 'decision:D-041'), 'a decision with a change in flight is not also offered for review');
  });

  it('every action’s score is exactly the sum of its stated reasons, and every reason names its rule', () => {
    const decisions = [dec('D-050', { priority: { value: 'Must', basis: 'x' }, dependedOnBy: ['D-051'], blockingRequirements: [{ id: 'FR-9', priority: 'Must' }] }), dec('D-051')];
    for (const a of rankActions(base({ decisions, nextPhase: new Map([['D-050', ['g']]]), items: [item('T1', { critical: true, criticalBasis: 'a risk', priority: 'High', blocksBuild: true })], proposals: [prop('P-2', 'D-051', 'awaiting-merge', { prNumber: 7 })] }))) {
      assert.equal(a.score, sum(a), a.key);
      assert.ok(a.reasons.every((r) => r.rule.length > 0 && r.text.length > 0), a.key);
    }
  });

  it('is deterministic: the same facts in any order give the same ranking', () => {
    const decisions = ['D-061', 'D-062', 'D-063', 'D-064', 'D-065'].map((id, i) => dec(id, { priority: i % 2 ? { value: 'Must', basis: 'x' } : null }));
    const a = rankActions(base({ decisions })).map((x) => x.key);
    const b = rankActions(base({ decisions: [...decisions].reverse() })).map((x) => x.key);
    const c = rankActions(base({ decisions: [decisions[2]!, decisions[0]!, decisions[4]!, decisions[1]!, decisions[3]!] })).map((x) => x.key);
    assert.deepEqual(b, a);
    assert.deepEqual(c, a);
  });

  it('breaks a tie by identifier in natural order, so D-9 comes before D-10', () => {
    const out = rankActions(base({ decisions: [dec('D-010'), dec('D-009'), dec('D-100')] }));
    assert.deepEqual(ids(out), ['D-009', 'D-010', 'D-100']);
  });

  it('uses no clock, no randomness and no model: the rule modules contain none of them', () => {
    for (const f of ['rank.ts', 'overview.ts', 'stale.ts', 'types.ts']) {
      const text = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'lib', 'next', f), 'utf8');
      assert.ok(!/Date\.now|new Date\(\s*\)|Math\.random|fetch\(|openai|anthropic|copilot/i.test(text.replace(/\/\/.*$/gm, '')), f);
    }
  });
});

describe('who must act', () => {
  const ap = (me: boolean | null) => () => ({ label: 'the programme owner', isMe: me });
  it('adds points when you are the named approver and takes them away when somebody else is', () => {
    const decisions = [dec('D-070')];
    const mine = rankActions(base({ decisions, approver: ap(true), me: { login: 'me', roles: [] } }))[0]!;
    const theirs = rankActions(base({ decisions, approver: ap(false), me: { login: 'me', roles: [] } }))[0]!;
    assert.equal(mine.mine, true);
    assert.equal(theirs.mine, false);
    assert.equal(mine.score - theirs.score, POINTS.mineAsApprover - POINTS.someoneElseApproves);
  });

  it('never offers the person something only somebody else can approve as the next action', () => {
    const decisions = [dec('D-071'), dec('D-072', { priority: { value: 'Must', basis: 'x' } })];
    const out = rankActions(base({ decisions, approver: (d) => ({ label: 'the security architect', isMe: d.id === 'D-071' }), me: { login: 'me', roles: [] }, nextPhase: new Map([['D-072', ['g']]]) }));
    assert.equal(out[0]!.subjectId, 'D-072', 'it ranks first on weight');
    assert.equal(pickNext(out)!.subjectId, 'D-071', 'but D-071 is the first one this person can act on');
  });

  it('does not guess when nobody is signed in', () => {
    const out = rankActions(base({ decisions: [dec('D-073')], me: null }));
    assert.equal(out[0]!.mine, null);
    assert.equal(pickNext(out)!.subjectId, 'D-073');
  });

  it('treats a stakeholder question and a regulatory claim as steps outside the Studio, never as something to approve', () => {
    const decisions = [dec('D-074', { natures: ['stakeholder-clarification'] }), dec('D-075', { natures: ['regulatory-verification'] }), dec('D-076')];
    const out = Object.fromEntries(rankActions(base({ decisions })).map((a) => [a.subjectId, a]));
    assert.deepEqual([out['D-074']!.kind, out['D-074']!.venue], ['answer-clarification', 'business']);
    assert.deepEqual([out['D-075']!.kind, out['D-075']!.venue], ['verify-claim', 'qualified-person']);
    assert.deepEqual([out['D-076']!.kind, out['D-076']!.venue], ['review-decision', 'studio']);
    assert.match(out['D-075']!.title, /verified/);
  });
});

describe('blocker detection', () => {
  it('marks only unapproved mandatory decisions as blocking the next phase, and an approved one produces no action', () => {
    const decisions = [dec('D-080'), dec('D-081', { status: 'Approved' }), dec('D-082')];
    const out = rankActions(base({ decisions, nextPhase: new Map([['D-080', ['g1']]]) }));
    assert.deepEqual(out.filter((a) => a.blocksNextPhase).map((a) => a.subjectId), ['D-080']);
    assert.ok(!out.some((a) => a.subjectId === 'D-081'));
  });

  it('names the gate and the decisions that wait, and does not require optional decisions', () => {
    const decisions = [dec('D-083', { dependedOnBy: ['D-084'] }), dec('D-084'), dec('D-085')];
    const out = rankActions(base({ decisions, nextPhase: new Map([['D-083', ['gate scope-adr']]]) }));
    const a = out.find((x) => x.subjectId === 'D-083')!;
    assert.match(a.reasons.map((r) => r.text).join(' '), /gate scope-adr/);
    assert.equal(a.unlocks.decisions, 1);
    assert.equal(out.find((x) => x.subjectId === 'D-085')!.blocksNextPhase, false, 'an optional decision does not block');
  });

  it('turns a gate that is not a decision into an action that blocks the next phase', () => {
    const out = rankActions(base({ gateBlockers: [{ code: 'no-approver', text: 'No approver is enrolled. A baseline cannot be authorized.', refs: [] }] }));
    assert.equal(out[0]!.kind, 'readiness-gate');
    assert.equal(out[0]!.blocksNextPhase, true);
    assert.equal(out[0]!.title, 'Enroll an architecture-class approver');
    assert.match(out[0]!.detail, /^No approver is enrolled/);
  });

  it('flags work blocked by a deferred decision, and ranks a task that blocks the build above one that does not', () => {
    const items = [item('T-1'), item('T-2', { blocksBuild: true }), item('T-3', { derivedBlocks: [{ by: 'D-9', reason: 'D-9 is deferred' }] })];
    const out = rankActions(base({ items }));
    assert.equal(out[0]!.subjectId, 'T-2');
    assert.equal(out.find((a) => a.subjectId === 'T-3')!.ready, false);
    assert.ok(out.find((a) => a.subjectId === 'T-3')!.score < out.find((a) => a.subjectId === 'T-1')!.score);
  });

  it('skips closed work and decisions that were already decided or superseded', () => {
    const out = rankActions(base({ decisions: [dec('D-086', { status: 'Superseded' }), dec('D-087', { status: 'Approved' })], items: [item('T-4', { status: 'Done' }), item('T-5', { status: 'Rejected' })] }));
    assert.deepEqual(out, []);
  });
});

describe('dependency updates', () => {
  it('when an upstream decision is approved, what waited for it becomes ready and rises', () => {
    const before = [dec('D-090', { dependedOnBy: ['D-091'], status: 'Proposed' }), dec('D-091', { dependsOn: ['D-090'] }), dec('D-092')];
    const after = [dec('D-090', { dependedOnBy: ['D-091'], status: 'Approved' }), dec('D-091', { dependsOn: ['D-090'] }), dec('D-092')];
    const b = rankActions(base({ decisions: before }));
    const a = rankActions(base({ decisions: after }));
    const rank = (r: typeof a, id: string) => r.findIndex((x) => x.subjectId === id);
    assert.equal(b.find((x) => x.subjectId === 'D-091')!.ready, false);
    assert.deepEqual(b.find((x) => x.subjectId === 'D-091')!.waitingFor, ['D-090']);
    assert.equal(a.find((x) => x.subjectId === 'D-091')!.ready, true);
    assert.ok(rank(a, 'D-091') < rank(b, 'D-091') || rank(a, 'D-091') <= rank(a, 'D-092'));
    assert.equal(a.find((x) => x.subjectId === 'D-091')!.score - b.find((x) => x.subjectId === 'D-091')!.score, POINTS.readyNow - POINTS.waitingOnUndecided);
    assert.ok(!a.some((x) => x.subjectId === 'D-090'), 'the approved decision no longer needs an action');
  });

  it('the count of what a decision unlocks falls as those decisions are decided', () => {
    const open = rankActions(base({ decisions: [dec('D-093', { dependedOnBy: ['D-094', 'D-095'] }), dec('D-094'), dec('D-095')] })).find((x) => x.subjectId === 'D-093')!;
    const oneDone = rankActions(base({ decisions: [dec('D-093', { dependedOnBy: ['D-094', 'D-095'] }), dec('D-094', { status: 'Approved' }), dec('D-095')] })).find((x) => x.subjectId === 'D-093')!;
    assert.equal(open.unlocks.decisions, 2);
    assert.equal(oneDone.unlocks.decisions, 1);
  });

  it('a reference to a decision that does not exist is not counted as something to wait for', () => {
    const a = rankActions(base({ decisions: [dec('D-096', { dependsOn: ['D-999'], dependedOnBy: ['D-998'] })] }))[0]!;
    assert.equal(a.ready, true);
    assert.equal(a.unlocks.decisions, 0);
  });

  it('a task in the build chain gains points for each unresolved item that waits on it', () => {
    const items = [item('T-10'), item('T-11')];
    const out = rankActions(base({ items, buildChain: new Map([['T-10', { unlocks: 3, ready: true }], ['T-11', { unlocks: 0, ready: false }]]) }));
    assert.equal(out[0]!.subjectId, 'T-10');
    assert.equal(out[0]!.score - out[1]!.score, 3 * POINTS.taskUnlockEach + POINTS.taskReady - 0, 'ready and unlocking, against waiting and unlocking nothing');
  });
});

describe('changes on their way to GitHub', () => {
  it('turns each unfinished change into the step that moves it, and ignores one already applied', () => {
    const decisions = [dec('D-100'), dec('D-101'), dec('D-102'), dec('D-103')];
    const out = rankActions(base({ decisions, proposals: [prop('P-a', 'D-100', 'failed'), prop('P-b', 'D-101', 'awaiting-github-update', { error: 'offline' }), prop('P-c', 'D-102', 'awaiting-merge', { prNumber: 12 }), prop('P-d', 'D-103', 'applied')] }));
    const by = Object.fromEntries(out.filter((a) => a.key.startsWith('proposal:')).map((a) => [a.key, a]));
    assert.equal(by['proposal:P-a']!.kind, 'sync-failure');
    assert.equal(by['proposal:P-b']!.kind, 'send-to-github');
    assert.equal(by['proposal:P-c']!.kind, 'merge-pull-request');
    assert.equal(by['proposal:P-c']!.title, 'Merge pull request #12');
    assert.ok(!('proposal:P-d' in by));
    assert.deepEqual(out.filter((a) => a.key.startsWith('proposal:')).map((a) => a.key), ['proposal:P-a', 'proposal:P-b', 'proposal:P-c'], 'failure, then not sent, then waiting for a merge');
  });

  it('a conflict says nothing was applied', () => {
    const a = rankActions(base({ decisions: [dec('D-104')], proposals: [prop('P-e', 'D-104', 'conflicted')] })).find((x) => x.key === 'proposal:P-e')!;
    assert.match(a.reasons[0]!.text, /Nothing was applied/);
  });
});

describe('rejected and deferred decisions', () => {
  it('asks for rework only when something still depends on a rejected decision, or a gate needs it', () => {
    const decisions = [dec('D-110', { status: 'Rejected', dependedOnBy: ['D-111'] }), dec('D-111'), dec('D-112', { status: 'Rejected' }), dec('D-113', { status: 'Rejected', blockingRequirements: [{ id: 'FR-1', priority: 'Must' }] })];
    const out = rankActions(base({ decisions }));
    assert.deepEqual(out.filter((a) => a.kind === 'rework-rejected').map((a) => a.subjectId).sort(), ['D-110', 'D-113']);
  });
  it('asks to revisit a deferred decision only when a gate needs it', () => {
    const out = rankActions(base({ decisions: [dec('D-114', { status: 'Deferred' }), dec('D-115', { status: 'Deferred' })], nextPhase: new Map([['D-114', ['g']]]) }));
    assert.deepEqual(out.filter((a) => a.kind === 'revisit-deferred').map((a) => a.subjectId), ['D-114']);
  });
});

describe('stale evidence detection', () => {
  const run = (id: string, startedAt: string, exitCode: number | null = 0) => [id, { id, exitCode, startedAt }] as const;
  const ev = (id: string, over: Partial<NormalizedDecision['evidence'][number]> = {}) => ({ id, kind: 'test-run' as const, claim: null, exitCode: 0, resolved: true, src: null, ...over });

  it('calls evidence stale when it was recorded before the decision’s own file last changed', () => {
    const d = dec('ADR-0100', { evidence: [ev('EV-1')] });
    const out = staleEvidence([d], new Map([run('EV-1', '2026-10-01T00:00:00Z')]), () => '2026-10-20T00:00:00Z');
    assert.equal(out.length, 1);
    assert.equal(out[0]!.kind, 'stale');
    assert.match(out[0]!.text, /2026-10-01.*2026-10-20/);
  });
  it('does not call evidence stale when it is newer than the last change, or equal', () => {
    const d = dec('ADR-0101', { evidence: [ev('EV-2')] });
    assert.deepEqual(staleEvidence([d], new Map([run('EV-2', '2026-10-21T00:00:00Z')]), () => '2026-10-20T00:00:00Z'), []);
    assert.deepEqual(staleEvidence([d], new Map([run('EV-2', '2026-10-20T00:00:00Z')]), () => '2026-10-20T00:00:00Z'), []);
  });
  it('reports a cited record that does not exist, and a run that failed', () => {
    const d = dec('ADR-0102', { evidence: [ev('EV-3', { resolved: false, exitCode: null }), ev('EV-4', { exitCode: 2 })] });
    const out = staleEvidence([d], new Map([run('EV-4', '2026-10-25T00:00:00Z', 2)]), () => null);
    assert.deepEqual(out.map((x) => [x.evidenceId, x.kind]), [['EV-3', 'missing'], ['EV-4', 'failing']]);
  });
  it('does not judge a register entry by its shared file, and skips superseded and rejected decisions', () => {
    const reg = dec('D-120', { kind: 'register-entry', evidence: [ev('EV-5')] });
    const sup = dec('ADR-0103', { status: 'Superseded', evidence: [ev('EV-6', { resolved: false })] });
    const rej = dec('ADR-0104', { status: 'Rejected', evidence: [ev('EV-7', { resolved: false })] });
    assert.deepEqual(staleEvidence([reg, sup, rej], new Map([run('EV-5', '2020-01-01T00:00:00Z')]), () => '2026-10-20T00:00:00Z'), []);
  });
  it('ignores design-review references, which are not recorded runs', () => {
    const d = dec('ADR-0105', { evidence: [ev('RV-0003', { kind: 'design-review', resolved: false })] });
    assert.deepEqual(staleEvidence([d], new Map(), () => null), []);
  });
  it('becomes a refresh action that carries the reason, and ranks above nothing it does not deserve', () => {
    const d = dec('ADR-0106', { evidence: [ev('EV-8')] });
    const stale = staleEvidence([d], new Map([run('EV-8', '2026-10-01T00:00:00Z')]), () => '2026-10-20T00:00:00Z');
    const out = rankActions(base({ decisions: [d], stale }));
    const a = out.find((x) => x.kind === 'refresh-evidence')!;
    assert.equal(a.venue, 'evidence');
    assert.match(a.reasons[0]!.text, /before ADR-0106 last changed/);
    assert.equal(a.reasons[0]!.points, POINTS.staleEvidence);
  });
});

describe('the Overview', () => {
  const area = (over: Partial<AreaReadiness> = {}): AreaReadiness =>
    ({ id: 'application', title: 'Application code', kind: 'implementation', stage: 'phase-1a', stageTitle: 'Phase 1a', paths: [], gates: [{ id: 'g1', title: 'Scope', source: '', satisfied: false, reasons: [], decisions: ['ADR-0020'], designReviews: [] }, { id: 'g2', title: 'Approver', source: '', satisfied: true, reasons: [], decisions: [], designReviews: [] }], requiredDecisions: [{ id: 'ADR-0020', title: 'Scope', kind: 'adr', status: 'Proposed', state: 'pending', approved: false, basis: '', caveats: [], requiredBy: ['gate g1'], domain: 'architecture', milestone: null, needsSecurityApproval: false, evidence: 'none', validated: false, source: null }], requiredReviews: [], metrics: [], blockers: [{ code: 'no-approver', text: 'No approver is enrolled.', refs: [] }, { code: 'pending', text: 'ADR-0020 is Proposed.', refs: ['ADR-0020'] }], ready: false, deferredNonBlocking: [], closureItems: [], ...over }) as AreaReadiness;

  const world = () => {
    const decisions = [
      dec('ADR-0020', { natures: ['architecture-choice'] }),
      dec('D-130', { dependedOnBy: ['D-131'] }),
      dec('D-131'),
      dec('D-132', { status: 'Approved', approvalHistory: [{ type: 'review-event', date: '2026-11-02T10:00:00Z', actor: '@me', text: 'Approved', signed: false, src: { path: 'x', line: 1 } }] }),
      dec('D-133', { status: 'Approved', approvalHistory: [{ type: 'status-line', date: '2026-10-28', actor: null, text: 'Accepted', signed: false, src: { path: 'x', line: 1 } }] }),
      dec('D-134', { status: 'Approved', approvalHistory: [] }),
      dec('D-135', { status: 'Rejected', dependedOnBy: ['D-131'] }),
    ];
    const items = [item('T-20', { blocksBuild: true }), item('T-21'), item('T-22', { status: 'Done' })];
    const actions = rankActions(base({ decisions, items, nextPhase: new Map([['ADR-0020', ['gate g1']]]), gateBlockers: [{ code: 'no-approver', text: 'No approver is enrolled.', refs: [] }], approver: () => ({ label: 'the owner', isMe: true }), me: { login: 'me', roles: ['architecture-owner'] } }));
    return { decisions, items, actions };
  };

  it('answers "what next" with the mandatory decision, then the rest in order, and lists what waits on somebody else apart', () => {
    const { decisions, items, actions } = world();
    const o = buildOverview({ commit: 'abc', actions, decisions, items, area: area(), laterAreas: [] });
    assert.equal(o.next!.subjectId, 'ADR-0020');
    assert.ok(o.then.length > 0 && o.then.length <= 4);
    assert.ok(!o.then.some((a) => a.key === o.next!.key));
    assert.deepEqual(o.waitingOnOthers, []);
  });

  it('lists the mandatory decisions that block the next phase, and the gates that are not decisions, and counts the optional ones apart', () => {
    const { decisions, items, actions } = world();
    const o = buildOverview({ commit: 'abc', actions, decisions, items, area: area(), laterAreas: [] });
    assert.deepEqual(o.readiness.blockingDecisions.map((b) => b.id), ['ADR-0020']);
    assert.deepEqual(o.readiness.otherBlockers.map((b) => b.code), ['no-approver'], 'a gate that is about a decision is not repeated here');
    assert.equal(o.readiness.optionalOpen, 2, 'D-130 and D-131 are open and no phase requires them');
    assert.equal(o.readiness.ready, false);
  });

  it('is ready only when the area is ready and nothing mandatory or gate-related remains', () => {
    const { decisions, items } = world();
    const done = area({ ready: true, blockers: [], requiredDecisions: [{ ...area().requiredDecisions[0]!, approved: true, state: 'approved' }] });
    assert.equal(buildOverview({ commit: 'c', actions: [], decisions, items, area: done, laterAreas: [] }).readiness.ready, true);
  });

  it('recently approved is newest first, only counts records that carry a date, and keeps three', () => {
    const { decisions, items, actions } = world();
    const o = buildOverview({ commit: 'abc', actions, decisions, items, area: null, laterAreas: [] });
    assert.deepEqual(o.recentlyApproved.items.map((i) => i.title), ['D-132', 'D-133']);
    assert.equal(o.recentlyApproved.count, 2, 'D-134 has no approval date, so it is not claimed as recent');
    assert.equal(o.recentlyApproved.items[0]!.meta, '2026-11-02');
    assert.equal(approvedOn(decisions[2]!), null);
  });

  it('shows a rejected decision that something still depends on under rework', () => {
    const { decisions, items, actions } = world();
    const o = buildOverview({ commit: 'abc', actions, decisions, items, area: null, laterAreas: [] });
    assert.deepEqual(o.rework.items.map((i) => i.title), ['Rework D-135']);
  });

  it('progress is counts of records with their basis, and carries no percentage or score', () => {
    const { decisions, items, actions } = world();
    const o = buildOverview({ commit: 'abc', actions, decisions, items, area: area({ closureItems: ['T-20', 'T-22'] }), laterAreas: [] });
    const f = Object.fromEntries(o.progress.map((p) => [p.label, p]));
    assert.deepEqual([f['Mandatory decisions approved']!.done, f['Mandatory decisions approved']!.total], [0, 1]);
    assert.deepEqual([f['Gates satisfied']!.done, f['Gates satisfied']!.total], [1, 2]);
    assert.deepEqual([f['Tasks the phase needs, done with evidence']!.done, f['Tasks the phase needs, done with evidence']!.total], [1, 2]);
    for (const p of o.progress) {
      assert.ok(Number.isInteger(p.done) && Number.isInteger(p.total) && p.basis.length > 0, p.label);
      assert.ok(!('percent' in p) && !('score' in p) && !('maturity' in p));
    }
  });

  it('empty states: no actions, no area and nothing in the register give empty sections, not errors', () => {
    const o = buildOverview({ commit: 'abc', actions: [], decisions: [], items: [], area: null, laterAreas: [] });
    assert.equal(o.next, null);
    assert.deepEqual([o.awaiting.count, o.blockers.count, o.tasks.count, o.recentlyApproved.count, o.rework.count], [0, 0, 0, 0, 0]);
    assert.equal(o.readiness.available, false);
    assert.deepEqual(o.progress, []);
    assert.deepEqual(rankActions(base()), []);
    assert.equal(pickNext([]), null);
  });

  it('sections show at most three items, but count them all', () => {
    const decisions = Array.from({ length: 9 }, (_, i) => dec(`D-${200 + i}`));
    const actions = rankActions(base({ decisions }));
    const o = buildOverview({ commit: 'abc', actions, decisions, items: [], area: null, laterAreas: [] });
    assert.equal(o.awaiting.count, 9);
    assert.equal(o.awaiting.items.length, 3);
    assert.equal(o.awaiting.byLane.architecture, 9);
  });
});

describe('gates that are not decisions', () => {
  it('rank below a mandatory decision and above anything a later phase needs, with a plain name', () => {
    const decisions = [dec('D-300', { priority: { value: 'Must', basis: 'x' }, blockingRequirements: [{ id: 'FR-1', priority: 'Must' }] }), dec('D-301')];
    const out = rankActions(base({ decisions, later: new Map([['D-300', ['production']]]), nextPhase: new Map([['D-301', ['scope']]]), gateBlockers: [{ code: 'baseline', text: 'No architecture baseline covers area "application".', refs: [] }, { code: 'phase-0', text: 'Gate "phase-raised": The phase is 0.', refs: [] }] }));
    assert.deepEqual(out.map((a) => a.subjectId), ['D-301', 'baseline', 'phase-0', 'D-300']);
    assert.equal(out[1]!.title, 'Authorize an architecture baseline');
    assert.equal(out[2]!.detail, 'The phase is 0.');
  });
});

describe('tasks needing attention', () => {
  it('counts only tasks that block the next phase or are critical or High by their own source', () => {
    const items = [item('T-1', { blocksBuild: true }), item('T-2', { critical: true, criticalBasis: 'a High risk' }), item('T-3', { priority: 'High' }), item('T-4', { priority: 'Medium' }), item('T-5')];
    const actions = rankActions(base({ items }));
    const o = buildOverview({ commit: 'c', actions, decisions: [], items, area: null, laterAreas: [] });
    assert.deepEqual(o.tasks.items.map((i) => i.action!.subjectId).sort(), ['T-1', 'T-2', 'T-3']);
    assert.equal(o.tasks.count, 3);
  });
});

describe('what changed', () => {
  const hist = (type: 'status-line' | 'owner-log' | 'review-event' | 'signed-approval', date: string | null, text: string, signed = false) => ({ type, date, actor: null, text, signed, src: { path: 'x', line: 1 } });

  it('shows one row per decision, newest first, and counts its other records', () => {
    const ds = [
      dec('ADR-0001', { approvalHistory: [hist('status-line', '2026-10-28', 'Accepted'), hist('owner-log', '2026-10-28', 'logged')] }),
      dec('ADR-0002', { approvalHistory: [hist('review-event', '2026-11-02T10:00:00Z', 'Approved'), hist('status-line', '2026-10-20', 'Proposed earlier')] }),
      dec('ADR-0003', { approvalHistory: [hist('status-line', null, 'no date')] }),
    ];
    const h = decisionHistory(ds);
    assert.deepEqual(h.map((r) => [r.decisionId, r.more]), [['ADR-0002', 1], ['ADR-0001', 1]]);
    assert.equal(h[1]!.source, 'status line', 'the heavier record is shown when both are on the same day');
  });

  it('lists open work that a deferred decision blocks or a rejected one flags, blocked first, and never closed work', () => {
    const items = [item('T-1', { reviewNeeded: [{ by: 'D-9', reason: 'D-9 was rejected' }] }), item('T-2', { derivedBlocks: [{ by: 'D-8', reason: 'D-8 is deferred' }] }), item('T-3', { status: 'Done', derivedBlocks: [{ by: 'D-8', reason: 'old' }] })];
    const a = affectedTasks(items);
    assert.deepEqual(a.map((x) => [x.id, x.kind]), [['T-2', 'blocked'], ['T-1', 'review']]);
  });

  it('reports what changed since an authorized baseline, invalidating first, and says nothing for a baseline that is not authorized', () => {
    const imp = (severity: 'invalidates' | 'review', subject: string, controlledBy: string | null = null) => ({ severity, code: 'c', subject, text: `${subject} changed`, areas: [], affectedItems: [], controlledBy });
    const out = baselineChanges([{ id: 'BL-0001', status: 'approved', impacts: [imp('review', 'D-2'), imp('invalidates', 'D-1', 'BL-0001-R01')] }, { id: 'BL-0002', status: 'proposed', impacts: [imp('invalidates', 'D-3')] }]);
    assert.deepEqual(out.map((c) => [c.subject, c.severity, c.controlledBy]), [['D-1', 'invalidates', 'BL-0001-R01'], ['D-2', 'review', null]]);
    assert.deepEqual(baselineChanges([]), []);
  });
});