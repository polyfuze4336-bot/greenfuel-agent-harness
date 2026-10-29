import type { Claim, Comparison, NormalizedDecision, OptionInfo, Suggestion } from './schema.ts';

// Compare Alternatives: the recommended option beside every other recorded option. Recorded material and AI suggestions
// are kept in separate fields so the screen can never blur them. Counts are of recorded entries, not a score.

export interface ComparedOption {
  key: string;
  name: string;
  recommended: boolean;
  disposition: string | null;
  summary: string | null;
  tradeoffs: string | null;
  recorded: { pros: Claim[]; cons: Claim[]; conditional: Claim[]; unknown: Claim[] };
  suggested: { pros: Suggestion[]; cons: Suggestion[] };
  mapping: OptionInfo['mapping'];
  src: OptionInfo['src'];
}

export interface AlternativesView {
  decisionId: string;
  title: string;
  status: NormalizedDecision['status'];
  recommendedKey: string | null;
  options: ComparedOption[];
  matrix: Comparison | null;
  /** AI suggestions that propose a new alternative or discuss consequences of the decision as a whole. */
  suggestedAlternatives: Suggestion[];
  suggestedConsequences: Suggestion[];
  notes: string[];
}

export function compareAlternatives(rec: NormalizedDecision, suggestions: Suggestion[]): AlternativesView {
  const mine = suggestions.filter((s) => s.decisionId === rec.id);
  const notes: string[] = [];
  if (rec.options.length === 0) notes.push('No options are recorded for this decision, so there is nothing to compare. AI suggestions, if any, are listed separately.');
  if (rec.options.length > 0 && !rec.recommendedOption) notes.push(rec.kind === 'register-entry' ? 'The register records known options and states that none is chosen.' : 'The source does not mark a selected or proposed option.');
  if (rec.options.length > 0 && !rec.comparison && !rec.options.some((o) => o.pros.length || o.cons.length)) notes.push('The sources record no pros or cons for these options, and the Studio does not invent them.');
  const options = rec.options
    .map<ComparedOption>((o) => ({
      key: o.key,
      name: o.name,
      recommended: o.recommended,
      disposition: o.disposition,
      summary: o.summary,
      tradeoffs: o.tradeoffs,
      recorded: { pros: o.pros, cons: o.cons, conditional: o.conditional, unknown: o.unknown },
      suggested: { pros: mine.filter((s) => s.optionKey === o.key && s.kind === 'pro'), cons: mine.filter((s) => s.optionKey === o.key && s.kind === 'con') },
      mapping: o.mapping,
      src: o.src,
    }))
    .sort((a, b) => Number(b.recommended) - Number(a.recommended));
  return {
    decisionId: rec.id,
    title: rec.title,
    status: rec.status,
    recommendedKey: rec.recommendedOption?.key ?? null,
    options,
    matrix: rec.comparison,
    suggestedAlternatives: mine.filter((s) => s.kind === 'alternative'),
    suggestedConsequences: mine.filter((s) => s.kind === 'consequence'),
    notes,
  };
}
