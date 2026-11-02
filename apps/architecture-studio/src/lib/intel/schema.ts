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

/**
 * What kind of thing a record asks for. These are not interchangeable and are never inferred: they come from the register's own "Kind"
 * column (C, D, X, or a combination) and, for an ADR, from the fact that it is an architecture decision record.
 *   architecture-choice      the options are known and choosing needs analysis and approval.
 *   stakeholder-clarification a fact only the business can supply. It is answered, not approved, and its "options" are possible answers.
 *   regulatory-verification  a regulatory or certification claim that a qualified person must verify. It is never approved on a recommendation.
 */
export const NATURES = ['architecture-choice', 'stakeholder-clarification', 'regulatory-verification'] as const;
export type DecisionNature = (typeof NATURES)[number];

export const NATURE_LABEL: Record<DecisionNature, string> = {
  'architecture-choice': 'Architecture choice',
  'stakeholder-clarification': 'Stakeholder clarification',
  'regulatory-verification': 'Regulatory verification',
};

export const NATURE_SHORT: Record<DecisionNature, string> = { 'architecture-choice': 'Architecture', 'stakeholder-clarification': 'Stakeholder', 'regulatory-verification': 'Verification' };

/** Which review queue a record belongs in. Only "architecture" can be approved as an architecture decision in the Studio. */
export type ReviewLane = 'architecture' | 'stakeholder' | 'verification' | 'unclassified';

export const LANE_LABEL: Record<ReviewLane, string> = {
  architecture: 'Architecture decisions to review',
  stakeholder: 'Stakeholder answers needed',
  verification: 'Needs qualified verification',
  unclassified: 'Kind not stated',
};

/** The most restrictive nature decides: a record that needs a regulatory verification is never an architecture approval, whatever else it also is. */
export function reviewLane(natures: readonly DecisionNature[] | undefined): ReviewLane {
  if (!natures) return 'unclassified';
  if (natures.includes('regulatory-verification')) return 'verification';
  if (natures.includes('stakeholder-clarification')) return 'stakeholder';
  if (natures.includes('architecture-choice')) return 'architecture';
  return 'unclassified';
}

/** A record cites an id that does not exist at the commit being read. It is reported, never dropped and never guessed at. */
export interface InvalidReference {
  kind: 'decision' | 'requirement';
  id: string;
  /** What cites it, in words: for example "traceability row FR-004" or "this record's Depends on". */
  via: string;
  src: Src | null;
}

export interface RelatedRequirement {
  id: string;
  priority: string | null;
  relation: 'blocked-until-decided' | 'addressed-by-this-adr' | 'cites-this-decision';
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
  /** What the record asks for. Empty when the source states no kind, which is then shown as unknown. */
  natures: DecisionNature[];
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
  /** Every requirement that a source ties to this decision, with how. Empty means none was found, not that none exists. */
  relatedRequirements: RelatedRequirement[];
  /** Citations of ids that do not exist at this commit. */
  invalidReferences: InvalidReference[];
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
  kind: 'pro' | 'con' | 'alternative' | 'consequence' | 'relationship';
  /** For a relationship: the record the AI suggests is affected. Unverified until a repository record states the link itself. */
  targetId?: string;
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
