// Decision impact analysis: types. Pure data, no Node imports, so the browser can use them.
//
// Rules this module follows, because they are the point of it:
//   - An item appears only because a repository record says so, and it carries the record and line that says so.
//   - "Direct" means a source names this decision, or this decision names it. "Potential" means it is reached only through another
//     decision that depends on this one. Neither is a prediction.
//   - A suggestion by an AI is kept apart, labelled unverified, and never counted. It becomes explicit only when a repository record says so.
//   - Effort, schedule and cost are never estimated. Counts are counts of the items above; a cost appears only if the ADR states it.

export type ImpactAction = 'approve' | 'reject' | 'defer' | 'revise';
export const IMPACT_ACTIONS: ImpactAction[] = ['approve', 'reject', 'defer', 'revise'];

export const ACTION_LABEL: Record<ImpactAction, string> = { approve: 'Approved', reject: 'Rejected', defer: 'Deferred', revise: 'Sent back for revision' };

export type ImpactKind = 'requirement' | 'decision' | 'component' | 'security' | 'sovereignty' | 'data-flow' | 'infrastructure' | 'cost' | 'task' | 'test' | 'risk' | 'slide' | 'review' | 'document';

export const KIND_LABEL: Record<ImpactKind, string> = {
  requirement: 'Requirements',
  decision: 'Decisions and ADRs',
  component: 'Architecture components and designs',
  security: 'Security controls',
  sovereignty: 'Sovereignty boundaries',
  'data-flow': 'Data flows',
  infrastructure: 'Infrastructure and operations',
  cost: 'Costs',
  task: 'Tasks',
  test: 'Test cases and evidence',
  risk: 'Risks',
  slide: 'Presentation material',
  review: 'Design review gates',
  document: 'Other documents and reports',
};

export interface Src {
  path: string;
  line: number;
}

export interface ImpactItem {
  id: string;
  kind: ImpactKind;
  title: string;
  /** Why it is here, in the repository's terms: "cites this decision", "requires this decision", "traceability row names it". */
  relation: string;
  /** The reference that puts it in the analysis. */
  src: Src | null;
  status: string | null;
  tier: 'direct' | 'potential';
  /** For a potential item: the decision that links it to this one. */
  via: string | null;
}

export interface BlockingDependency {
  id: string;
  title: string;
  status: string;
  /** This decision rests on it (unresolved), or it waits for this decision. */
  direction: 'rests-on' | 'waits-for-this';
  src: Src | null;
}

export interface FollowUp {
  text: string;
  /** What in the repository makes this follow-up necessary. */
  because: string;
  src: Src | null;
}

export interface UnresolvedReference {
  id: string;
  kind: string;
  via: string;
  src: Src | null;
}

export interface SuggestedRelationship {
  id: string;
  /** The other end of the suggested link. */
  targetId: string;
  /** Whether the AI suggested this decision relates to the other record, or the other record relates to this decision. */
  direction: 'from-this' | 'to-this';
  relation: string;
  rationale: string;
  generatedBy: { tool: string; date: string };
  src: Src;
  /** True when a repository record already makes the same link explicit, so the suggestion has been accepted by the record itself. */
  nowExplicit: boolean;
}

export interface ImpactResult {
  decisionId: string;
  title: string;
  action: ImpactAction;
  commit: string;
  statusNow: string;
  /** What the status would become. The Studio changes nothing; a review record merged through GitHub does. */
  statusAfter: string | null;
  statusNote: string;
  summary: { direct: number; potential: number; blocking: number; followUp: number; rework: number; unresolved: number; unverified: number };
  byKind: Partial<Record<ImpactKind, { direct: number; potential: number }>>;
  direct: ImpactItem[];
  potential: ImpactItem[];
  blocking: BlockingDependency[];
  followUp: FollowUp[];
  rework: ImpactItem[];
  unresolved: UnresolvedReference[];
  cycles: string[][];
  unverified: SuggestedRelationship[];
  estimate: { counts: string; effort: null; cost: { text: string; src: Src } | null; note: string };
  notes: string[];
}
