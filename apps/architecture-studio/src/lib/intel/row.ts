import { NATURE_LABEL, reviewLane, type DecisionNature, type NormalizedDecision, type NormStatus, type ReviewLane } from './schema.ts';

/**
 * What the Decision Register table needs about one decision, and nothing more. The full record (options, pros and cons, field sources,
 * citations, implications) is about 7 KB per decision and is only needed when one decision is opened, so it is fetched on demand. Sending
 * every full record with the page made `/decisions` 760 KB of HTML.
 */
export interface DecisionRow {
  id: string;
  kind: NormalizedDecision['kind'];
  title: string;
  status: NormStatus;
  statusRaw: string;
  priority: string | null;
  milestone: string | null;
  category: string | null;
  decisionOwner: string | null;
  approvalBasis: NormalizedDecision['approvalBasis'];
  relatedReviews: string[];
  flagged: boolean;
  hasMissing: boolean;
  /** What the record asks for, from the register's Kind column. Empty when unstated. */
  natures: DecisionNature[];
  /** Which review queue it belongs in. Only "architecture" is an architecture approval. */
  lane: ReviewLane;
  invalidReferences: number;
  source: { path: string; line: number };
  /** Lower-cased text the search box matches against. Built on the server so the search behaves exactly as before. */
  hay: string;
}

/** The text a search matches: id, title, description, justification, owner, status, milestone, category and option names. */
export function searchText(d: NormalizedDecision): string {
  return `${d.id} ${d.title} ${d.description ?? ''} ${d.businessJustification ?? ''} ${d.decisionOwner ?? ''} ${d.statusRaw} ${d.milestone ?? ''} ${d.category ?? ''} ${d.natures.map((n) => NATURE_LABEL[n]).join(' ')} ${d.options.map((o) => o.name).join(' ')}`.toLowerCase();
}

export function toRow(d: NormalizedDecision): DecisionRow {
  return {
    id: d.id,
    kind: d.kind,
    title: d.title,
    status: d.status,
    statusRaw: d.statusRaw,
    priority: d.priority?.value ?? null,
    milestone: d.milestone,
    category: d.category,
    decisionOwner: d.decisionOwner ?? null,
    approvalBasis: d.approvalBasis,
    relatedReviews: d.relatedReviews,
    flagged: d.flags.length > 0,
    hasMissing: d.missing.length > 0,
    natures: d.natures,
    lane: reviewLane(d.natures),
    invalidReferences: d.invalidReferences.length,
    source: { path: d.source.path, line: d.source.line },
    hay: searchText(d),
  };
}

/** Every word typed must appear somewhere in the row's search text. */
export function rowMatches(row: Pick<DecisionRow, 'hay'>, text: string): boolean {
  if (!text) return true;
  return text.split(/\s+/).every((t) => row.hay.includes(t));
}
