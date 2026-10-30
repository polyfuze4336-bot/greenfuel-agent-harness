// Normalized decision schema for the Decision Intelligence Engine. Pure data: no Node imports.
// Rule for every field: it is filled only from a repository record, with the file and line it came from.
// A field the sources do not state is null (or an empty list) and is named in `missing`. Nothing is inferred by a model.

export const STATUSES = ['Proposed', 'Pending Review', 'Approved', 'Rejected', 'Deferred', 'Superseded', 'Blocked'] as const;
export type NormStatus = (typeof STATUSES)[number];

export interface Src {
  path: string;
  line: number;
}

/** Where a field value came from, and the rule that produced it. */
export interface FieldSource extends Src {
  rule: string;
}

export interface Claim {
  text: string;
  src: Src;
  /** Always "recorded": the claim is text from a repository file, not generated. */
  basis: 'recorded';
  /** Where in the source it was found, for example the criterion of a comparison table. */
  criterion?: string;
}

export type Verdict = 'meets' | 'conditional' | 'does-not-meet' | 'unknown';

export interface OptionInfo {
  key: string;
  name: string;
  summary: string | null;
  /** Selected, Chosen, Proposed, Not selected, Rejected, Deferred, or null when the source states none. */
  disposition: string | null;
  recommended: boolean;
  tradeoffs: string | null;
  pros: Claim[];
  cons: Claim[];
  conditional: Claim[];
  unknown: Claim[];
  /** How the comparison-table column was tied to this option, when one was. */
  mapping: 'letter' | 'position' | null;
  /** The comparison-table column this option was tied to (a letter such as "C"), when one was. */
  matrixColumn: string | null;
  src: Src;
}

export interface ComparisonCell {
  verdict: Verdict;
  text: string;
}
export interface ComparisonRow {
  criterion: string;
  cells: Record<string, ComparisonCell>;
  line: number;
}
export interface Comparison {
  designId: string;
  src: Src;
  columns: string[];
  rows: ComparisonRow[];
  mapping: 'letter' | 'position';
}

export interface Implication {
  text: string;
  src: FieldSource;
}

export interface ApprovalEvent {
  type: 'status-line' | 'signed-approval' | 'owner-log' | 'review-event';
  date: string | null;
  actor: string | null;
  text: string;
  /** True only for a record in docs/approvals that names this decision. The Studio does not verify the signature. */
  signed: boolean;
  src: Src;
}

export interface EvidenceRef {
  id: string;
  kind: 'test-run' | 'design-review' | 'design' | 'other';
  claim: string | null;
  exitCode: number | null;
  /** False when the id is cited but no record with that id exists at this commit. */
  resolved: boolean;
  src: Src | null;
}

export interface RubricRef {
  criterion: string;
  title: string;
  via: 'direct' | 'design';
  /** The bullet label in the rubric document, for example Missing or Evidence. */
  label: string;
  src: Src;
}

export type PriorityValue = 'Must' | 'Should' | 'Could';

export interface Flag {
  code: string;
  text: string;
}

export interface NormalizedDecision {
  id: string;
  kind: 'adr' | 'register-entry';
  title: string;
  description: string | null;
  businessJustification: string | null;
  category: string | null;
  tags: string[];
  /** Register entries only: the milestone the answer is needed by (M1, M2). */
  milestone: string | null;
  /** Highest priority among the requirements that trace to the decision. Null when none does. */
  priority: { value: PriorityValue; basis: string } | null;
  status: NormStatus;
  /** The status text exactly as the source states it. */
  statusRaw: string;
  statusRule: string;
  /** How the approval stands: signed record, owner instruction without a signature, or none. */
  approvalBasis: 'signed' | 'owner-instruction-unsigned' | 'delegated-unsigned' | 'review-record' | 'none';
  recommendedOption: OptionInfo | null;
  options: OptionInfo[];
  comparison: Comparison | null;
  implications: {
    cost: Implication | null;
    security: Implication | null;
    reliability: Implication | null;
    dataSovereignty: Implication | null;
    operational: Implication | null;
  };
  /** Decisions this record cites. */
  dependsOn: string[];
  /** Decisions that cite this record. */
  dependedOnBy: string[];
  /** ADR numbers (as ADR-nnnn) this ADR says it supersedes, from the "Supersedes" header. */
  supersedes: string[];
  /** ADRs that say they supersede this one. */
  supersededBy: string[];
  /** Requirements that cannot be fully accepted until this decision is made, from the traceability table. */
  blockingRequirements: { id: string; priority: string | null }[];
  relatedAdrs: string[];
  relatedRisks: string[];
  relatedTasks: string[];
  relatedReviews: string[];
  requiredApproverRole: { text: string; basis: string } | null;
  decisionOwner: string | null;
  decisionDate: string | null;
  approvalHistory: ApprovalEvent[];
  source: { path: string; line: number; commit: string; blob: string };
  /** Other repository files that cite this decision (documents, plans, reports). */
  citedBy: string[];
  evidence: EvidenceRef[];
  rubric: RubricRef[];
  flags: Flag[];
  /** Names of fields the sources do not state. */
  missing: string[];
  /** Where each populated field came from. */
  fieldSources: Record<string, FieldSource>;
  contentHash: string;
  /** Set only when a merged review record changes the status shown. The source's own status is kept here. */
  review?: { phase: string; sourceStatus: NormStatus; sourceStatusRule: string; decidingEventId: string | null };
}

export interface DuplicateCandidate {
  a: string;
  b: string;
  kind: 'id-collision' | 'exact-title' | 'similar' | 'overlap' | 'supersession-gap';
  score: number;
  reasons: string[];
}

export interface ValidationIssue {
  id: string;
  field: string;
  message: string;
}

export interface RegisterStats {
  total: number;
  byStatus: Record<NormStatus, number>;
  byKind: Record<'adr' | 'register-entry', number>;
  populated: Record<string, number>;
  filesRead: number;
  filesReused: number;
  filesReparsed: number;
  filesRemoved: number;
}

export interface Suggestion {
  id: string;
  decisionId: string;
  optionKey: string | null;
  kind: 'pro' | 'con' | 'alternative' | 'consequence';
  text: string;
  rationale: string;
  basedOn: string[];
  label: 'AI SUGGESTION';
  reviewState: 'unreviewed';
  generatedBy: { kind: 'ai'; tool: string; date: string };
  src: Src;
}

export interface RegisterSnapshot {
  commit: string;
  ref: string;
  records: NormalizedDecision[];
  duplicates: DuplicateCandidate[];
  validation: { checked: number; valid: number; issues: ValidationIssue[] };
  suggestions: Suggestion[];
  stats: RegisterStats;
  warnings: string[];
}

export type ChangeKind = 'added' | 'removed' | 'changed';
export interface FieldChange {
  field: string;
  from: string;
  to: string;
}
export interface RecordChange {
  id: string;
  kind: ChangeKind;
  title: string;
  fields: FieldChange[];
  /** Alerts: a status that went backwards, or Approved without a recorded approval event. */
  alerts: string[];
}
export interface ChangeSet {
  fromCommit: string | null;
  toCommit: string;
  initial: boolean;
  records: RecordChange[];
  files: { path: string; change: 'added' | 'removed' | 'changed' }[];
  counts: { added: number; removed: number; changed: number; unchanged: number; alerts: number };
}

export const FIELD_LABEL: Record<string, string> = {
  description: 'Description',
  businessJustification: 'Business justification',
  category: 'Category',
  priority: 'Priority',
  recommendedOption: 'Recommended option',
  options: 'Alternative options',
  'implications.cost': 'Cost implications',
  'implications.security': 'Security implications',
  'implications.reliability': 'Reliability implications',
  'implications.dataSovereignty': 'Data sovereignty implications',
  'implications.operational': 'Operational implications',
  requiredApproverRole: 'Required approver role',
  decisionOwner: 'Decision owner',
  decisionDate: 'Decision date',
  approvalHistory: 'Approval history',
  evidence: 'Evidence references',
  rubric: 'Rubric mapping',
};
