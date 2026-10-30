// Work items for the Architecture Work Queue. Pure data: no Node imports, so the browser can use these types.
//
// Rules this module's consumers follow, because they are the point of the queue:
//   - A field is copied from a repository source with its file and line, or it is null and the item says so. Nothing is invented.
//   - A due date exists only if a source states one explicitly.
//   - "Done" needs completion evidence. A source that says a task is closed without evidence gives "Closed, no evidence".
//   - A dependency is "requires" only where a source says so. A bare mention is "references". Impact follows "requires" only.

export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const WORK_STATUSES = ['Open', 'Unmarked', 'Blocked', 'Awaiting clarification', 'In review', 'Deferred', 'Done', 'Closed, no evidence', 'Rejected', 'Superseded'] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export const WORK_KINDS = ['task', 'roadmap', 'backlog', 'decision', 'design-gate', 'gap', 'security', 'validation', 'risk', 'requirement-gap', 'build-blocker', 'rubric'] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

export const KIND_LABEL: Record<WorkKind, string> = {
  task: 'Owner task',
  roadmap: 'Roadmap item',
  backlog: 'Capstone backlog',
  decision: 'Decision',
  'design-gate': 'Design review gate',
  gap: 'Capstone gap',
  security: 'Security finding',
  validation: 'Validation procedure',
  risk: 'Risk',
  'requirement-gap': 'Requirement gap',
  'build-blocker': 'Build blocker',
  rubric: 'Rubric criterion',
};

/** What sort of work it is. Rubric criteria are evidence gaps, kept apart from engineering work. */
export type WorkClass = 'engineering' | 'decision' | 'governance' | 'risk' | 'evidence-gap';

export const CLASS_LABEL: Record<WorkClass, string> = {
  engineering: 'Engineering',
  decision: 'Decision',
  governance: 'Governance',
  risk: 'Risk',
  'evidence-gap': 'Evidence gap (rubric)',
};

export interface Src {
  path: string;
  line: number;
}

export interface Link {
  id: string;
  /** requires: a source says this must happen first. references: the source only mentions it. */
  type: 'requires' | 'references';
  basis: string;
  src: Src | null;
}

export interface EvidenceLink {
  ref: string;
  kind: 'evidence-record' | 'file' | 'decision-record' | 'completion-review';
  src: Src | null;
  /** False when the reference cannot be resolved in the repository, or the recorded run failed. */
  valid: boolean;
  note: string | null;
}

export interface Flag {
  code: string;
  text: string;
}

export interface Derived {
  by: string;
  reason: string;
}

export interface WorkItem {
  id: string;
  kind: WorkKind;
  class: WorkClass;
  title: string;
  description: string;
  priority: Priority | null;
  priorityBasis: string | null;
  /** Rule per kind, stated in criticalBasis. Never a model's judgement. */
  critical: boolean;
  criticalBasis: string | null;
  status: WorkStatus;
  /** The status text exactly as the source states it, and how it was mapped. */
  sourceStatus: string | null;
  statusBasis: string;
  /** Who the source says owns it (a role or name), and which policy roles that text names. */
  ownerText: string | null;
  ownerRoles: string[];
  /** Set only by a merged work-item event. */
  assignee: string | null;
  source: Src;
  relatedDecisions: string[];
  relatedRequirements: string[];
  relatedRisks: string[];
  /** Rubric criteria (A1 to D3) this item moves. */
  rubricCriteria: string[];
  links: Link[];
  acceptance: string | null;
  evidenceRequired: string | null;
  /** Only when a source or a merged assignment states it explicitly. */
  dueDate: string | null;
  completionEvidence: EvidenceLink[];
  /** Approval this item is waiting for, if any. */
  approval: { kind: 'decision' | 'design-review' | 'completion'; by: string; state: string } | null;
  /** Hard blocks derived from decisions that were deferred. Never from unrelated work. */
  derivedBlocks: Derived[];
  /** Advisory flags from rejected decisions or changed requirements. They change no status. */
  reviewNeeded: Derived[];
  flags: Flag[];
  /** Fields the sources do not state. */
  missing: string[];
  /** Whether this blocks starting the application build, by the written rule in graph.ts. */
  blocksBuild: boolean;
  milestone: string | null;
  mode: string[];
  contentHash: string;
}

export interface Edge {
  from: string;
  to: string;
  type: 'requires' | 'references';
  basis: string;
}

export interface UnresolvedRef {
  from: string;
  ref: string;
  src: Src | null;
}

export const PRIORITY_RANK: Record<Priority, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

export const DONE_STATUSES: WorkStatus[] = ['Done'];
export const CLOSED_STATUSES: WorkStatus[] = ['Done', 'Closed, no evidence', 'Rejected', 'Superseded'];
