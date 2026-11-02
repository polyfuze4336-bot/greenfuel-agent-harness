import type { Fragment } from './extract.ts';
import type { NormalizedDecision, Suggestion } from './schema.ts';

// AI suggestions live in separate files under docs/architecture-studio/suggestions/. They are read, validated and shown
// beside a decision. They are never merged into a decision's fields, never change a status, and never count as evidence.
// Anything that does not meet the schema is rejected and reported, not silently repaired.

const KINDS = ['pro', 'con', 'alternative', 'consequence', 'relationship'];
const ALLOWED_KEYS = new Set(['id', 'decisionId', 'optionKey', 'targetId', 'kind', 'text', 'rationale', 'basedOn', 'label', 'reviewState', 'generatedBy', 'line']);

export interface SuggestionContext {
  records: NormalizedDecision[];
  hasPath: (path: string) => boolean;
  knownIds: Set<string>;
}

export function collectSuggestions(fragments: Fragment[], ctx: SuggestionContext): { suggestions: Suggestion[]; warnings: string[] } {
  const out: Suggestion[] = [];
  const warnings: string[] = [];
  const byId = new Map(ctx.records.map((r) => [r.id, r]));
  const seen = new Set<string>();
  for (const f of fragments.filter((x) => x.kind === 'suggestions')) {
    const d = f.data as { invalid?: boolean; suggestions?: Record<string, unknown>[] };
    if (d.invalid) {
      warnings.push(`${f.path} is not valid JSON; none of its suggestions are shown.`);
      continue;
    }
    for (const s of d.suggestions ?? []) {
      const why = reject(s, byId, seen, ctx);
      if (why) {
        warnings.push(`Suggestion ${String(s.id ?? '(no id)')} in ${f.path} was rejected: ${why}`);
        continue;
      }
      seen.add(String(s.id));
      out.push({
        id: String(s.id),
        decisionId: String(s.decisionId),
        optionKey: s.optionKey === null || s.optionKey === undefined ? null : String(s.optionKey),
        kind: s.kind as Suggestion['kind'],
        ...(s.kind === 'relationship' ? { targetId: String(s.targetId) } : {}),
        text: String(s.text),
        rationale: String(s.rationale),
        basedOn: (s.basedOn as unknown[]).map(String),
        label: 'AI SUGGESTION',
        reviewState: 'unreviewed',
        generatedBy: s.generatedBy as Suggestion['generatedBy'],
        src: { path: f.path, line: Number(s.line) || 1 },
      });
    }
  }
  return { suggestions: out, warnings };
}

function reject(s: Record<string, unknown>, byId: Map<string, NormalizedDecision>, seen: Set<string>, ctx: SuggestionContext): string | null {
  for (const k of Object.keys(s)) if (!ALLOWED_KEYS.has(k)) return `unknown field "${k}" (suggestions carry no status, approval or confidence)`;
  if (typeof s.id !== 'string' || !/^S-[A-Za-z0-9-]+$/.test(s.id)) return 'id must look like S-001';
  if (seen.has(s.id)) return 'duplicate suggestion id';
  const rec = typeof s.decisionId === 'string' ? byId.get(s.decisionId) : undefined;
  if (!rec) return 'decisionId does not match any decision at this commit';
  if (s.optionKey !== null && s.optionKey !== undefined && !rec.options.some((o) => o.key === s.optionKey)) return `optionKey "${String(s.optionKey)}" is not an option of ${rec.id}`;
  if (!KINDS.includes(String(s.kind))) return `kind must be one of ${KINDS.join(', ')}`;
  if (s.kind === 'relationship') {
    if (typeof s.targetId !== 'string' || !ctx.knownIds.has(s.targetId)) return 'a relationship must name a targetId that is a known record at this commit';
    if (s.targetId === s.decisionId) return 'a decision cannot be suggested to affect itself';
  } else if (s.targetId !== undefined) return 'targetId is only for a relationship';
  if ((s.kind === 'pro' || s.kind === 'con') && (s.optionKey === null || s.optionKey === undefined)) return 'a pro or con must name the option it is about';
  if (typeof s.text !== 'string' || !s.text.trim()) return 'text is empty';
  if (typeof s.rationale !== 'string' || !s.rationale.trim()) return 'rationale is empty';
  if (s.label !== 'AI SUGGESTION') return 'label must be "AI SUGGESTION"';
  if (s.reviewState !== 'unreviewed') return 'reviewState must be "unreviewed": only a person may review a suggestion, outside this file';
  const g = s.generatedBy as { kind?: string; tool?: string; date?: string } | undefined;
  if (!g || g.kind !== 'ai' || !g.tool || !/^\d{4}-\d\d-\d\d$/.test(g.date ?? '')) return 'generatedBy must name the AI tool and the date';
  if (!Array.isArray(s.basedOn) || s.basedOn.length === 0) return 'basedOn must list the repository records the suggestion was drawn from';
  for (const b of s.basedOn as unknown[]) {
    const v = String(b);
    if (!ctx.knownIds.has(v) && !ctx.hasPath(v)) return `basedOn "${v}" is neither a repository path nor a known record id at this commit`;
  }
  return null;
}

export const suggestionsFor = (id: string, all: Suggestion[]): Suggestion[] => all.filter((s) => s.decisionId === id);
