// Architecture Examiner: types. Pure data, no Node imports, so the browser can use them.
//
// Every entry the Examiner shows has a basis, and the five bases are never mixed:
//   verified-fact            true about the repository, by a mechanical check: a status, a count, an id, a recorded test result, a cited source.
//   approved-decision        what a decision with the status Approved says. The repository decided it (signed or not, as stated).
//   proposed-interpretation  an author's claim in a record that is not Approved, or a conclusion the Examiner derived by a stated rule.
//   unverified-assumption    something the decision relies on that no record settles.
//   ai-generated             written by an AI. Unreviewed. Not evidence. Shown only with the citations it gave, and checked against them.

export type Basis = 'verified-fact' | 'approved-decision' | 'proposed-interpretation' | 'unverified-assumption' | 'ai-generated';

export const BASIS_LABEL: Record<Basis, string> = {
  'verified-fact': 'Verified fact',
  'approved-decision': 'Approved decision',
  'proposed-interpretation': 'Proposed interpretation',
  'unverified-assumption': 'Unverified assumption',
  'ai-generated': 'AI-generated · unreviewed',
};

export const BASIS_MEANING: Record<Basis, string> = {
  'verified-fact': 'True about the repository by a mechanical check: a status, a count, an id, a recorded result, a source that exists.',
  'approved-decision': 'What a decision with the status Approved says.',
  'proposed-interpretation': 'An author\u2019s claim in a record that is not Approved, or a conclusion the Examiner derived by a stated rule.',
  'unverified-assumption': 'Something the decision relies on that no record settles.',
  'ai-generated': 'Written by an AI, unreviewed, not evidence. Shown with its citations, and checked against them.',
};

export const SECTION_KEYS = ['against', 'alternatives', 'pros-cons', 'assumptions', 'reliability', 'security-compliance', 'cost-operations', 'questions', 'evidence', 'recommendation'] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_TITLE: Record<SectionKey, string> = {
  against: 'The strongest argument against',
  alternatives: 'Viable alternatives',
  'pros-cons': 'Pros and cons',
  assumptions: 'Hidden assumptions',
  reliability: 'Reliability and failure implications',
  'security-compliance': 'Security and compliance implications',
  'cost-operations': 'Cost and operational implications',
  questions: 'Five difficult panel questions',
  evidence: 'Evidence needed to defend it',
  recommendation: 'Recommendation and its limits',
};

export interface Src {
  path: string;
  line: number;
}

export interface ExaminerEntry {
  text: string;
  basis: Basis;
  sources: Src[];
  /** How it was derived, when that is not obvious from the text. */
  note?: string;
}

export interface ExaminerSection {
  key: SectionKey;
  title: string;
  entries: ExaminerEntry[];
  /** Said plainly when the repository gives nothing to put here, instead of a guess. */
  empty: string | null;
}

export type Position = 'Not ready to defend' | 'Defensible with conditions' | 'Defensible on the record' | 'Not an architecture decision';

export interface InjectionSignal {
  where: string;
  pattern: string;
  excerpt: string;
}

export interface AiClaim {
  section: SectionKey;
  text: string;
  evidence: { path: string; line: number | null; quote: string | null; verified: boolean; problem: string | null }[];
  /** A claim with no citation, or whose citation does not check out, is unsupported. It is shown apart and never counted. */
  supported: boolean;
  injection: boolean;
}

export interface AiChallenge {
  path: string;
  agent: string;
  tool: string;
  date: string;
  label: 'AI CHALLENGE';
  reviewState: 'unreviewed';
  claims: AiClaim[];
  notAssessed: string[];
  problems: string[];
}

export interface ExaminerDossier {
  decisionId: string;
  title: string;
  commit: string;
  status: string;
  lane: string;
  natures: string[];
  headline: { counterArgument: ExaminerEntry; position: Position; reasons: ExaminerEntry[] };
  sections: ExaminerSection[];
  basisCounts: Record<Basis, number>;
  injection: InjectionSignal[];
  ai: AiChallenge | null;
  limitations: string[];
  /** A ready prompt for the architecture-critic and principal-architect agents in VS Code Copilot Chat. */
  prompt: string;
}
