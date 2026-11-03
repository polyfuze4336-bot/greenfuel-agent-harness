import { reviewLane, type NormalizedDecision } from '../intel/schema.ts';
import type { WorkItem } from '../queue/types.ts';
import { isClosed, mineReason } from '../queue/views.ts';
import { POINTS, type NextAction, type Reason, type Venue } from './types.ts';

// The rules, in order of how much they matter. Each one adds points and says so in the action's reasons. See docs/studio/NEXT-BEST-ACTION.md.

export interface ProposalFact {
  id: string;
  subjectId: string;
  family: 'decision' | 'work';
  action: string;
  state: 'locally-submitted' | 'awaiting-github-update' | 'pull-request-created' | 'awaiting-merge' | 'applied' | 'failed' | 'conflicted';
  prNumber: number | null;
  prUrl: string | null;
  error: string | null;
}

export interface StaleEvidenceFact {
  decisionId: string;
  evidenceId: string;
  kind: 'stale' | 'failing' | 'missing';
  text: string;
}

export interface GateBlockerFact {
  code: string;
  text: string;
  refs: string[];
}

export interface RankInput {
  decisions: NormalizedDecision[];
  /** Decision id to the gates that need it, for the stage the next implementation phase is at. Mandatory for that phase. */
  nextPhase: Map<string, string[]>;
  /** The same for stages after it (production). Needed later, not for the next phase. */
  later: Map<string, string[]>;
  /** What stops the next phase that is not a decision: an approver, the phase, branch protection, a baseline. */
  gateBlockers: GateBlockerFact[];
  approver: (d: NormalizedDecision) => { label: string; isMe: boolean | null };
  proposals: ProposalFact[];
  items: WorkItem[];
  /** For work the build requires: how many unresolved items wait on it, and whether it has nothing left to wait for. */
  buildChain: Map<string, { unlocks: number; ready: boolean }>;
  stale: StaleEvidenceFact[];
  me: { login: string; roles: string[] } | null;
}

const RESOLVED = new Set(['Approved', 'Superseded']);
const OPEN = new Set(['Proposed', 'Pending Review', 'Blocked']);
const num = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const add = (rs: Reason[], points: number, rule: string, text: string) => {
  if (points !== 0) rs.push({ points, rule, text });
};
const total = (rs: Reason[]) => rs.reduce((n, r) => n + r.points, 0);
// Plain names for the gates that are not decisions, so the action reads as a step and not as a log line. Anything else keeps its first sentence.
const GATE_TITLE: Record<string, string> = {
  baseline: 'Authorize an architecture baseline',
  'no-approver': 'Enroll an architecture-class approver',
  'phase-0': 'Raise the phase with signed approvals',
  'phase-unsigned': 'Sign the phase approval',
  'no-branch-protection': 'Put branch protection in force on main',
  policy: 'Fix the baseline policy',
  'baseline-reopened': 'Authorize a new baseline version',
  'baseline-uncontrolled-change': 'Reopen the baseline for the change that was made',
};
const decisionHref = (d: NormalizedDecision) => (reviewLane(d.natures) === 'architecture' ? `/decisions/${encodeURIComponent(d.id)}/review` : `/decisions?id=${encodeURIComponent(d.id)}`);

export function rankActions(input: RankInput): NextAction[] {
  const out: NextAction[] = [];
  const byId = new Map(input.decisions.map((d) => [d.id, d]));
  const isResolved = (id: string) => RESOLVED.has(byId.get(id)?.status ?? '');
  const inFlight = new Set(input.proposals.filter((p) => p.state !== 'applied' && p.family === 'decision').map((p) => p.subjectId));
  const me = input.me;

  const unlocksOf = (d: NormalizedDecision) => ({
    decisions: d.dependedOnBy.filter((id) => byId.has(id) && !isResolved(id)).length,
    mustRequirements: d.blockingRequirements.filter((r) => r.priority === 'Must').length,
  });
  const unlockPoints = (rs: Reason[], u: { decisions: number; mustRequirements: number }) => {
    add(rs, Math.min(u.decisions * POINTS.perUnlockedDecision, POINTS.unlockedDecisionCap), 'unlocks', `${u.decisions} undecided decision${u.decisions === 1 ? '' : 's'} depend${u.decisions === 1 ? 's' : ''} on it`);
    add(rs, Math.min(u.mustRequirements * POINTS.perMustRequirement, POINTS.mustRequirementCap), 'requirement-priority', `${u.mustRequirements} Must requirement${u.mustRequirements === 1 ? ' is' : 's are'} blocked until it is decided`);
  };
  const phasePoints = (rs: Reason[], id: string) => {
    const now = input.nextPhase.get(id);
    const later = input.later.get(id);
    if (now) add(rs, POINTS.mandatoryNextPhase, 'readiness-gate', `Mandatory for the next implementation phase (${now.join('; ')})`);
    else if (later) add(rs, POINTS.mandatoryLater, 'readiness-gate', `Needed for a later phase, not the next (${later.join('; ')})`);
    return { next: !!now, later: !now && !!later };
  };
  const priorityPoints = (rs: Reason[], d: NormalizedDecision) => {
    const v = d.priority?.value;
    if (v === 'Must') add(rs, POINTS.priorityMust, 'criticality', 'Its requirements include a Must');
    else if (v === 'Should') add(rs, POINTS.priorityShould, 'criticality', 'Its requirements include a Should');
    else if (v === 'Could') add(rs, POINTS.priorityCould, 'criticality', 'Its requirements are Could');
  };

  // ---- decisions
  for (const d of input.decisions) {
    const lane = reviewLane(d.natures);
    const u = unlocksOf(d);
    const waitingFor = d.dependsOn.filter((id) => byId.has(id) && !isResolved(id));
    const ap = input.approver(d);
    const mineNow = (): boolean | null => (lane === 'architecture' ? ap.isMe : me ? true : null);

    if (OPEN.has(d.status) && !inFlight.has(d.id)) {
      const rs: Reason[] = [];
      const ph = phasePoints(rs, d.id);
      priorityPoints(rs, d);
      unlockPoints(rs, u);
      if (waitingFor.length === 0) add(rs, POINTS.readyNow, 'dependencies', 'Everything it depends on is already decided');
      else add(rs, POINTS.waitingOnUndecided, 'dependencies', `Waits for ${waitingFor.length} undecided: ${waitingFor.slice(0, 4).join(', ')}`);
      if (d.status === 'Blocked') add(rs, POINTS.sourceBlocked, 'blocking-status', 'The source marks it Blocked, so it cannot be approved until it is unblocked');
      if (lane === 'architecture') {
        if (ap.isMe === true) add(rs, POINTS.mineAsApprover, 'approver', `You are the named approver (${ap.label})`);
        else if (ap.isMe === false) add(rs, POINTS.someoneElseApproves, 'approver', `${ap.label} must approve it, not you`);
      }
      const venue: Venue = lane === 'architecture' ? 'studio' : lane === 'stakeholder' ? 'business' : lane === 'verification' ? 'qualified-person' : 'repository';
      const kind = lane === 'architecture' ? 'review-decision' : lane === 'stakeholder' ? 'answer-clarification' : lane === 'verification' ? 'verify-claim' : 'review-decision';
      const title =
        lane === 'architecture' ? `Review ${d.id}` : lane === 'stakeholder' ? `Get the answer to ${d.id}` : lane === 'verification' ? `Have ${d.id} verified` : `Say what ${d.id} asks for`;
      out.push({ key: `decision:${d.id}`, kind, venue, subjectId: d.id, title, detail: clip(d.title, 120), href: decisionHref(d), score: total(rs), reasons: rs, blocksNextPhase: ph.next, neededLater: ph.later, ready: waitingFor.length === 0, waitingFor, mine: mineNow(), unlocks: u });
    }

    if (d.status === 'Rejected' && !inFlight.has(d.id) && (input.nextPhase.has(d.id) || input.later.has(d.id) || u.decisions > 0 || u.mustRequirements > 0)) {
      const rs: Reason[] = [];
      add(rs, POINTS.reworkRejected, 'rework', 'Rejected, and something still depends on it');
      const ph = phasePoints(rs, d.id);
      priorityPoints(rs, d);
      unlockPoints(rs, u);
      out.push({ key: `rework:${d.id}`, kind: 'rework-rejected', venue: lane === 'architecture' ? 'studio' : 'business', subjectId: d.id, title: `Rework ${d.id}`, detail: clip(d.title, 120), href: decisionHref(d), score: total(rs), reasons: rs, blocksNextPhase: ph.next, neededLater: ph.later, ready: true, waitingFor: [], mine: me ? true : null, unlocks: u });
    }

    if (d.status === 'Deferred' && !inFlight.has(d.id) && (input.nextPhase.has(d.id) || input.later.has(d.id))) {
      const rs: Reason[] = [];
      add(rs, POINTS.revisitDeferred, 'rework', 'Deferred, but a gate needs it');
      const ph = phasePoints(rs, d.id);
      priorityPoints(rs, d);
      unlockPoints(rs, u);
      out.push({ key: `deferred:${d.id}`, kind: 'revisit-deferred', venue: lane === 'architecture' ? 'studio' : 'business', subjectId: d.id, title: `Revisit ${d.id}`, detail: clip(d.title, 120), href: decisionHref(d), score: total(rs), reasons: rs, blocksNextPhase: ph.next, neededLater: ph.later, ready: true, waitingFor: [], mine: me ? true : null, unlocks: u });
    }
  }

  // ---- changes on their way to GitHub
  for (const p of input.proposals) {
    if (p.state === 'applied') continue;
    const d = byId.get(p.subjectId);
    const rs: Reason[] = [];
    const label = p.action.replace(/-/g, ' ');
    const ph = d ? phasePoints([], d.id) : { next: false, later: false };
    let kind: NextAction['kind'];
    let title: string;
    if (p.state === 'failed' || p.state === 'conflicted') {
      kind = 'sync-failure';
      title = `Fix the ${label} on ${p.subjectId}`;
      add(rs, POINTS.syncFailure, 'sync-failure', p.state === 'conflicted' ? 'It conflicts with a newer change on GitHub. Nothing was applied' : `It did not reach GitHub${p.error ? `: ${clip(p.error, 90)}` : ''}`);
    } else if (p.state === 'locally-submitted' || p.state === 'awaiting-github-update') {
      kind = 'send-to-github';
      title = `Send the ${label} on ${p.subjectId} to GitHub`;
      add(rs, POINTS.sendToGithub, 'sync-failure', `Saved here, not on GitHub yet${p.error ? `: ${clip(p.error, 90)}` : ''}. Until it is sent it changes nothing`);
    } else {
      kind = 'merge-pull-request';
      title = p.prNumber ? `Merge pull request #${p.prNumber}` : `Merge the pull request for ${p.subjectId}`;
      add(rs, POINTS.mergePullRequest, 'sync-failure', `The ${label} on ${p.subjectId} takes effect only when a person merges it`);
      if (ph.next) add(rs, POINTS.mergeMandatoryBonus, 'readiness-gate', 'The decision is mandatory for the next implementation phase');
    }
    out.push({ key: `proposal:${p.id}`, kind, venue: 'github', subjectId: p.subjectId, title, detail: d ? clip(d.title, 120) : p.subjectId, href: p.family === 'work' ? `/queue?id=${encodeURIComponent(p.subjectId)}` : `/decisions/${encodeURIComponent(p.subjectId)}/review`, score: total(rs), reasons: rs, blocksNextPhase: ph.next, neededLater: ph.later, ready: true, waitingFor: [], mine: me ? true : null, unlocks: { decisions: 0, mustRequirements: 0 } });
  }

  // ---- evidence that cannot be relied on
  const seen = new Set<string>();
  for (const s of input.stale) {
    if (seen.has(s.decisionId)) continue;
    seen.add(s.decisionId);
    const d = byId.get(s.decisionId);
    const mine = input.stale.filter((x) => x.decisionId === s.decisionId);
    const rs: Reason[] = [];
    add(rs, POINTS.staleEvidence, 'stale-evidence', mine.map((x) => x.text).slice(0, 2).join(' '));
    const ph = phasePoints(rs, s.decisionId);
    if (d) priorityPoints(rs, d);
    out.push({ key: `evidence:${s.decisionId}`, kind: 'refresh-evidence', venue: 'evidence', subjectId: s.decisionId, title: `Refresh the evidence for ${s.decisionId}`, detail: d ? clip(d.title, 120) : s.decisionId, href: `/decisions?id=${encodeURIComponent(s.decisionId)}`, score: total(rs), reasons: rs, blocksNextPhase: ph.next, neededLater: ph.later, ready: true, waitingFor: [], mine: me ? true : null, unlocks: { decisions: 0, mustRequirements: 0 } });
  }

  // ---- gates that are not decisions
  for (const g of input.gateBlockers) {
    const rs: Reason[] = [];
    add(rs, POINTS.gateNextPhase, 'readiness-gate', 'Stands in the way of the next implementation phase. It is satisfied in the repository or on GitHub, after the mandatory decisions are made, not by approving something here');
    out.push({ key: `gate:${g.code}`, kind: 'readiness-gate', venue: 'repository', subjectId: g.code, title: GATE_TITLE[g.code] ?? clip(g.text.split(/(?<=[.!?])\s/)[0] ?? g.text, 140), detail: clip(g.text.replace(/^Gate "[^"]+": /, ''), 150), href: '/baseline', score: total(rs), reasons: rs, blocksNextPhase: true, neededLater: false, ready: true, waitingFor: [], mine: me ? true : null, unlocks: { decisions: 0, mustRequirements: 0 } });
  }

  // ---- queue work other than decisions (those are above, with richer facts)
  for (const it of input.items) {
    if (it.kind === 'decision' || isClosed(it.status)) continue;
    const chain = input.buildChain.get(it.id);
    const rs: Reason[] = [];
    if (it.critical) add(rs, POINTS.taskCritical, 'criticality', it.criticalBasis ?? 'Critical by its own rule');
    if (it.priority) add(rs, POINTS.taskPriority[it.priority] ?? 0, 'criticality', `Priority ${it.priority}`);
    if (it.blocksBuild) add(rs, POINTS.taskBlocksBuild, 'readiness-gate', 'Blocks the start of the application build');
    if (chain) add(rs, Math.min(chain.unlocks * POINTS.taskUnlockEach, POINTS.taskUnlockCap), 'unlocks', `${chain.unlocks} unresolved item${chain.unlocks === 1 ? '' : 's'} in the build chain wait${chain.unlocks === 1 ? 's' : ''} on it`);
    const blockedByDecision = it.derivedBlocks.length > 0;
    const ready = chain ? chain.ready && !blockedByDecision : !blockedByDecision && it.status !== 'Blocked';
    if (blockedByDecision) add(rs, POINTS.taskDerivedBlock, 'dependencies', clip(it.derivedBlocks[0]!.reason, 110));
    else if (ready) add(rs, POINTS.taskReady, 'dependencies', 'Nothing it requires is still open');
    if (it.status === 'Blocked' && !blockedByDecision) add(rs, POINTS.sourceBlocked, 'blocking-status', 'Marked Blocked by its source');
    // Unowned work is nobody else's: only work assigned to, or owned by a role of, someone else is "theirs".
    const mine = me ? (mineReason(it, me) !== null ? true : it.assignee || it.ownerRoles.length ? false : null) : null;
    if (mine) add(rs, POINTS.taskMine, 'approver', 'Assigned to you, or its owner role is one you hold');
    out.push({ key: `item:${it.id}`, kind: 'work-item', venue: it.class === 'evidence-gap' ? 'evidence' : 'repository', subjectId: it.id, title: clip(it.title, 130), detail: `${it.id} · ${it.status}`, href: `/queue?id=${encodeURIComponent(it.id)}`, score: total(rs), reasons: rs, blocksNextPhase: it.blocksBuild, neededLater: false, ready, waitingFor: [], mine, unlocks: { decisions: 0, mustRequirements: 0 } });
  }

  return out.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.blocksNextPhase) - Number(a.blocksNextPhase) ||
      b.unlocks.decisions + b.unlocks.mustRequirements - (a.unlocks.decisions + a.unlocks.mustRequirements) ||
      num(a.subjectId, b.subjectId) ||
      num(a.key, b.key),
  );
}

/** The one to do next: the best-ranked action the signed-in person can do. When nobody is signed in, the best-ranked action. */
export function pickNext(actions: NextAction[]): NextAction | null {
  return actions.find((a) => a.mine !== false) ?? null;
}
