// The Next Best Action: which one thing to do next to move the architecture toward an approved build, and in what order the rest follow.
// Pure and deterministic. No model, no clock, no randomness: the same repository facts always give the same order, and every action
// carries the list of rules (with their points) that put it where it is, so the order can be checked by hand. Nothing here decides or
// approves anything; it only orders work.

export type ActionKind =
  | 'sync-failure' // a change the person made did not reach GitHub (failed, conflicted)
  | 'send-to-github' // saved locally, not sent yet
  | 'merge-pull-request' // open on GitHub, waiting for a person to merge
  | 'review-decision' // an architecture choice the person can decide in the Studio
  | 'answer-clarification' // a fact only the business can give
  | 'verify-claim' // a regulatory or certification claim a qualified person must verify
  | 'rework-rejected' // rejected, and something still depends on it
  | 'revisit-deferred' // deferred, and the next phase needs it
  | 'work-item' // a task, risk, gap or design gate from the queue
  | 'readiness-gate' // a gate that is not decisions: approver, phase, branch protection
  | 'refresh-evidence'; // evidence recorded before the thing it supports last changed, or failing, or missing

/** Where the action is carried out. It does not change the order; it tells the person what kind of step this is. */
export type Venue = 'studio' | 'github' | 'business' | 'qualified-person' | 'repository' | 'evidence';

export interface Reason {
  /** Points this rule added (or took away). Shown, so the order is explainable. */
  points: number;
  text: string;
  /** The rule's name in docs/studio/NEXT-BEST-ACTION.md. */
  rule: string;
}

export interface NextAction {
  /** Stable across requests: kind and subject. */
  key: string;
  kind: ActionKind;
  venue: Venue;
  subjectId: string;
  /** What to do, as an instruction. */
  title: string;
  /** One line of context: the decision's title, the pull request, the gate. */
  detail: string;
  href: string;
  score: number;
  reasons: Reason[];
  /** This stands between the architecture and the next implementation phase (the active stage's gates). */
  blocksNextPhase: boolean;
  /** Needed for a later phase (production), not the next one. */
  neededLater: boolean;
  /** True when nothing it depends on is still undecided, so it can be done now. */
  ready: boolean;
  waitingFor: string[];
  /** True when the signed-in person is the one who must act, false when somebody else must, null when it is not known who is signed in. */
  mine: boolean | null;
  /** What it unlocks, by count: undecided decisions and Must requirements that wait for it. */
  unlocks: { decisions: number; mustRequirements: number };
}

/** The tuning of the rules in one place, so the documentation and the tests quote the same numbers. */
export const POINTS = {
  syncFailure: 120,
  sendToGithub: 110,
  mergePullRequest: 60,
  mergeMandatoryBonus: 100, // finishing a mandatory decision already in flight outranks starting another (60 + 100 > 150)
  // Larger than anything a later-phase item can earn, so work that stands between the architecture and the next phase always comes first.
  mandatoryNextPhase: 150,
  mandatoryLater: 12,
  priorityMust: 20,
  priorityShould: 10,
  priorityCould: 4,
  perUnlockedDecision: 3,
  unlockedDecisionCap: 15,
  perMustRequirement: 4,
  mustRequirementCap: 20,
  buildBlocker: 15,
  readyNow: 20,
  waitingOnUndecided: -25,
  sourceBlocked: -15,
  mineAsApprover: 10,
  someoneElseApproves: -20,
  reworkRejected: 35,
  revisitDeferred: 25,
  staleEvidence: 20,
  // A gate that is not a decision (an approver, the phase, a baseline). It stands in the way of the next phase, but it is satisfied after the
  // mandatory decisions are made and a person signs, so it ranks just below them and above everything a later phase needs.
  gateNextPhase: 100,
  taskCritical: 15,
  taskPriority: { Critical: 20, High: 12, Medium: 6, Low: 0 } as Record<string, number>,
  taskBlocksBuild: 25,
  taskUnlockEach: 3,
  taskUnlockCap: 15,
  taskReady: 15,
  taskDerivedBlock: -25,
  taskMine: 10,
} as const;
