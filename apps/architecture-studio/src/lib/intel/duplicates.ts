import type { DuplicateCandidate, NormalizedDecision } from './schema.ts';

// Duplicate and overlap detection. Deterministic signals only; a candidate is something a person should look at.
// The engine never merges, hides or rewrites a record because it looks like another one.

const STOP = new Set(['the', 'and', 'for', 'with', 'per', 'that', 'this', 'are', 'any', 'how', 'what', 'which', 'who', 'where', 'when', 'its', 'not', 'from', 'into', 'than', 'then', 'only', 'each', 'one', 'all', 'can', 'may', 'must', 'will', 'shall', 'does', 'both', 'adr', 'decision', 'option', 'options']);

export function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .map((w) => w.replace(/(ies)$/, 'y').replace(/(es|s|ing|ed)$/, ''))
      .filter((w) => w.length >= 4 && !STOP.has(w)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const SIMILAR_THRESHOLD = 0.3;
export const OVERLAP_THRESHOLD = 0.45;
const MIN_BODY_TOKENS = 8;

export function detectDuplicates(records: NormalizedDecision[]): DuplicateCandidate[] {
  const out: DuplicateCandidate[] = [];
  const seen = new Map<string, NormalizedDecision>();
  for (const r of records) {
    const prior = seen.get(r.id);
    if (prior) out.push({ a: prior.id, b: r.id, kind: 'id-collision', score: 1, reasons: [`the id ${r.id} is defined in ${prior.source.path} and again in ${r.source.path}`] });
    else seen.set(r.id, r);
  }

  const toks = records.map((r) => ({ r, title: tokens(r.title), body: tokens(`${r.description ?? ''} ${r.recommendedOption?.name ?? ''}`), deps: new Set(r.dependsOn.filter((d) => d.startsWith('D-'))) }));
  for (let i = 0; i < toks.length; i++) {
    for (let j = i + 1; j < toks.length; j++) {
      const x = toks[i]!;
      const y = toks[j]!;
      if (x.r.kind !== y.r.kind || x.r.id === y.r.id) continue;
      if (normTitle(x.r.title) === normTitle(y.r.title)) {
        out.push({ a: x.r.id, b: y.r.id, kind: 'exact-title', score: 1, reasons: ['the titles are identical after normalisation'] });
        continue;
      }
      const t = jaccard(x.title, y.title);
      const b = jaccard(x.body, y.body);
      const d = jaccard(x.deps, y.deps);
      const sharedDeps = [...x.deps].filter((w) => y.deps.has(w));
      // Scope overlap: two ADRs that hang on the same open decisions may be deciding the same thing from two angles.
      if (x.r.kind === 'adr' && d >= OVERLAP_THRESHOLD && sharedDeps.length >= 4) {
        out.push({ a: x.r.id, b: y.r.id, kind: 'overlap', score: Math.round(d * 100) / 100, reasons: [`both cite ${sharedDeps.length} of the same decisions (${sharedDeps.slice(0, 8).join(', ')}), so their scopes may overlap; this is not evidence that either is redundant`] });
      }
      // Register entries have no body, and a short body is too little text to compare; weight what exists.
      const hasBody = x.body.size >= MIN_BODY_TOKENS && y.body.size >= MIN_BODY_TOKENS;
      const score = hasBody ? 0.5 * t + 0.3 * b + 0.2 * d : 0.8 * t + 0.2 * d;
      if (score < SIMILAR_THRESHOLD) continue;
      const reasons: string[] = [];
      const shared = [...x.title].filter((w) => y.title.has(w));
      if (shared.length) reasons.push(`titles share: ${shared.slice(0, 8).join(', ')}`);
      if (hasBody && b > 0.15) reasons.push(`the recorded decisions share ${Math.round(b * 100)}% of their key terms`);
      if (sharedDeps.length >= 2) reasons.push(`both cite ${sharedDeps.length} of the same decisions (${sharedDeps.slice(0, 6).join(', ')})`);
      if (x.r.relatedReviews.some((rv) => y.r.relatedReviews.includes(rv))) reasons.push(`both belong to ${x.r.relatedReviews.filter((rv) => y.r.relatedReviews.includes(rv)).join(', ')}`);
      out.push({ a: x.r.id, b: y.r.id, kind: 'similar', score: Math.round(score * 100) / 100, reasons: reasons.length ? reasons : ['overlapping wording'] });
    }
  }

  const byId = new Map(records.map((r) => [r.id, r]));
  for (const r of records) {
    for (const s of r.supersedes) {
      const t = byId.get(s);
      if (!t) out.push({ a: r.id, b: s, kind: 'supersession-gap', score: 1, reasons: [`${r.id} says it supersedes ${s}, which does not exist at this commit`] });
      else if (t.status !== 'Superseded') out.push({ a: r.id, b: s, kind: 'supersession-gap', score: 1, reasons: [`${r.id} says it supersedes ${s}, but ${s} is ${t.status}, not Superseded`] });
    }
    if (r.status === 'Superseded' && r.supersededBy.length === 0) out.push({ a: r.id, b: r.id, kind: 'supersession-gap', score: 1, reasons: [`${r.id} is Superseded but no ADR says it supersedes it`] });
  }
  return out.sort((p, q) => q.score - p.score || p.a.localeCompare(q.a));
}

/** Candidates involving one decision, from either side. */
export const duplicatesFor = (id: string, all: DuplicateCandidate[]): DuplicateCandidate[] => all.filter((d) => d.a === id || d.b === id);
