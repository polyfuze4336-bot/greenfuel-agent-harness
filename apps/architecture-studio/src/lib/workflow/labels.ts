// Names shared by the server and the browser. Pure data: no Node imports, so client components can use it.
export const ACTIONS = ['approve', 'approve-alternative', 'approve-with-conditions', 'reject', 'request-revision', 'defer', 'comment', 'reopen'] as const;
export type ActionKind = (typeof ACTIONS)[number];

export const ACTION_LABEL: Record<ActionKind, string> = {
  approve: 'Approve the recommended option',
  'approve-alternative': 'Select and approve an alternative',
  'approve-with-conditions': 'Approve with conditions',
  reject: 'Reject',
  'request-revision': 'Request revision',
  defer: 'Defer',
  comment: 'Comment',
  reopen: 'Reopen',
};

export type ProposalState = 'locally-submitted' | 'awaiting-github-update' | 'pull-request-created' | 'awaiting-merge' | 'applied' | 'failed' | 'conflicted';

export const PROPOSAL_LABEL: Record<ProposalState, string> = {
  'locally-submitted': 'Locally submitted',
  'awaiting-github-update': 'Awaiting GitHub update',
  'pull-request-created': 'Pull request created',
  'awaiting-merge': 'Awaiting merge',
  applied: 'Applied to canonical repository',
  failed: 'Failed',
  conflicted: 'Conflicted',
};

/** The happy path, in order. Failed and Conflicted are outcomes, not steps. */
export const PROPOSAL_STEPS: ProposalState[] = ['locally-submitted', 'awaiting-github-update', 'pull-request-created', 'awaiting-merge', 'applied'];

export const WORK_ACTION_LABEL = {
  assign: 'Assign',
  prioritize: 'Prioritize',
  comment: 'Comment',
  'mark-blocked': 'Mark blocked',
  unblock: 'Clear blocked or clarification',
  'request-clarification': 'Request clarification',
  'submit-for-review': 'Submit for review',
  'approve-completion': 'Approve completion',
  'reject-completion': 'Reject completion',
  reopen: 'Reopen',
} as const;
export type WorkAction = keyof typeof WORK_ACTION_LABEL;
export const WORK_ACTIONS = Object.keys(WORK_ACTION_LABEL) as WorkAction[];

/** A readable name for any action, from either workflow. */
export const actionLabel = (a: string): string => (ACTION_LABEL as Record<string, string>)[a] ?? (WORK_ACTION_LABEL as Record<string, string>)[a] ?? a;
