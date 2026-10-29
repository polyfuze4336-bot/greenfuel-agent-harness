import type { RegisterSnapshot } from '../intel/schema.ts';

// Shared read-model types for the Architecture Decision Studio.

export type DecisionStatus = 'open' | 'proposed' | 'accepted' | 'rejected' | 'deferred' | 'superseded';

export interface Src {
  path: string;
  line: number;
}

export interface Decision {
  id: string;
  type: 'adr' | 'register';
  title: string;
  status: DecisionStatus;
  statusRaw: string;
  /** Register entries only: C clarification, D verification, X architecture decision (or a combination). */
  kind?: string;
  /** ADRs only: Governance, Design, or "(none: pre-Type)". */
  adrType?: string;
  /** Register entries only: the milestone the answer is needed by. */
  milestone?: string;
  owner?: string;
  date?: string;
  summary: string;
  whyItMatters?: string;
  options: string[];
  flags: {
    /** ADRs 0001 to 0015: accepted by owner instruction in chat before signing existed. */
    grandfathered: boolean;
    delegated: boolean;
    partialScope: boolean;
    /** True only if a signed approval record exists. Always false while docs/approvals has no records. */
    signed: boolean;
    review: string[];
  };
  refs: {
    decisions: string[];
    adrs: string[];
    requirements: string[];
    risks: string[];
    assumptions: string[];
    reviews: string[];
    tasks: string[];
  };
  src: Src;
}

export type TaskStatus = 'open' | 'deferred' | 'approved' | 'decided' | 'done' | 'agreed' | 'not-granted' | 'unmarked';

export interface Task {
  id: string;
  family: 'owner-todo' | 'roadmap';
  title: string;
  detail: string;
  section: string;
  status: TaskStatus;
  statusRecorded: boolean;
  blocks: string;
  approvalNeeded?: string;
  blocked: boolean;
  blockedBy?: string;
  ambiguous: boolean;
  refs: { decisions: string[]; adrs: string[]; tasks: string[] };
  src: Src;
}

export interface Requirement {
  id: string;
  group: string;
  title: string;
  priority: string;
  cls: string;
  justification: string;
  acceptance: string;
  traceSource: string;
  validation: string;
  evidenceRequired: string;
  decisions: string[];
  dependsOn: string[];
  openClarifications: string[];
  verifyClaims: string[];
  src: Src;
}

export interface Risk {
  id: string;
  title: string;
  cause: string;
  impact: string;
  likelihood: string;
  mitigation: string;
  owner: string;
  status: string;
  links: string;
  decisions: string[];
  src: Src;
}

export interface Assumption {
  id: string;
  text: string;
  basis: string;
  riskIfWrong: string;
  validation: string;
  replacedBy: string;
  resolved: boolean;
  src: Src;
}

export interface DesignReview {
  id: string;
  design: string;
  title: string;
  declared: string;
  decider: string;
  adrs: string[];
  /** From inventory.snapshot.json, which is a derived file: the gate result as last computed, not recomputed here. */
  computed: string | null;
  blockReasons: number | null;
  blockingDecisions: string[];
  src: Src;
  designSrc: Src;
}

export interface Doc {
  path: string;
  title: string;
  area: string;
  authority: 'authoritative' | 'derived' | 'reference';
}

export interface EvidenceRun {
  id: string;
  claim: string;
  exitCode: number | null;
  startedAt: string;
  gitHead: string;
  src: Src;
}

export interface Slide {
  id: string;
  kicker: string;
  title: string;
}

export interface QaItem {
  id: string;
  area: string;
  slide: string;
  question: string;
  uncertain: string;
  src: Src;
}

export interface RehearsalCriterion {
  id: string;
  title: string;
  status: string;
  rehearsed: boolean;
  src: Src;
}

export interface Recording {
  path: string;
  scenario: string;
  title: string;
  recordedAt: string;
  gitHead: string;
  notLive: boolean;
}

export interface Blocker {
  id: string;
  title: string;
  detail: string;
  /** Where the underlying fact comes from. */
  basis: string;
  href?: string;
}

export interface Attention {
  id: string;
  level: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  href: string;
}

export interface RepoMeta {
  /** Directory name only; absolute paths are not exposed to the browser. */
  name: string;
  githubUrl: string | null;
  ref: string;
  commit: string;
  commitShort: string;
  commitDate: string;
  commitSubject: string;
  branch: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  /** Whether the commit being read exists on a remote-tracking ref. */
  commitOnGitHub: boolean;
  remoteRefs: { name: string; commit: string }[];
  defaultBranch: string | null;
  defaultBranchBehind: number | null;
  lastFetchAt: string | null;
  uncommittedChanges: number;
  gitUser: { name: string; email: string } | null;
  generatedAt: string;
  mode: 'read-only';
}

export interface Approvals {
  enrolledApprovers: number;
  signedRecords: number;
  phase: string | null;
  validatorOutput: string | null;
  validatorSrc: string;
  pending: PendingApproval[];
  grandfatheredAccepted: string[];
}

export interface PendingApproval {
  id: string;
  kind: 'adr' | 'design-review';
  title: string;
  required: string;
  state: string;
  blockedBy: string[];
  href: string;
  src?: Src;
}

export interface Metrics {
  decisions: { total: number; adrs: number; register: number; pending: number; open: number; proposed: number; accepted: number; acceptedSigned: number; rejected: number; deferred: number; superseded: number };
  tasks: { total: number; ownerTodo: number; blocked: number; open: number; deferred: number; ambiguous: number };
  approvals: { outstanding: number; adrs: number; reviews: number; enrolledApprovers: number; signedRecords: number };
  readiness: { label: string; reviewsApproved: number; reviewsTotal: number; reviewsBlocked: number; gateDecisions: number; m1Open: number; phase: string | null };
  requirements: { total: number; must: number };
  risks: { total: number; open: number };
  assumptions: { total: number; unresolved: number };
}

export interface CommitInfo {
  sha: string;
  short: string;
  date: string;
  subject: string;
  author: string;
  /** True when no remote-tracking ref contains this commit. */
  localOnly: boolean;
}

export interface StudioModel {
  repo: RepoMeta;
  /** path -> commit that holds an identical blob on a GitHub remote-tracking ref, or null if none. */
  links: Record<string, string | null>;
  metrics: Metrics;
  decisions: Decision[];
  tasks: Task[];
  requirements: Requirement[];
  risks: Risk[];
  assumptions: Assumption[];
  reviews: DesignReview[];
  approvals: Approvals;
  blockers: Blocker[];
  attention: Attention[];
  docs: Doc[];
  evidence: { runs: EvidenceRun[]; sealedThrough: string | null; sealedCount: number | null; nonZero: number };
  presentation: { slides: Slide[]; qa: QaItem[]; rehearsal: RehearsalCriterion[]; recordings: Recording[]; recordingsSrc: string };
  recentCommits: CommitInfo[];
  warnings: string[];
  /** Normalized decision register: the same decisions, enriched, checked and traced to source. */
  register: RegisterSnapshot;
}

export const STATUS_LABEL: Record<DecisionStatus, string> = {
  open: 'Open',
  proposed: 'Proposed',
  accepted: 'Accepted',
  rejected: 'Rejected',
  deferred: 'Deferred',
  superseded: 'Superseded',
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Open',
  deferred: 'Deferred',
  approved: 'Approved',
  decided: 'Decided',
  done: 'Done',
  agreed: 'Agreed',
  'not-granted': 'Not granted',
  unmarked: 'No status recorded',
};
