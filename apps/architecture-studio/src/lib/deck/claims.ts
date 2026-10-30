// Checks each claim against the sources it cites. This proves a source exists at the commit and says what the claim relies on it saying.
// It does not prove the claim true; that stays with the person who approves the slide.
import type { DeckContext } from './context.ts';
import type { ClaimCheck, Placeholder, Slide } from './types.ts';

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');

export function checkClaims(c: DeckContext, slides: Slide[]): ClaimCheck[] {
  const out: ClaimCheck[] = [];
  for (const s of slides) {
    for (const cl of s.claims) {
      const problems: string[] = [];
      if (cl.sources.length === 0) problems.push('The claim cites no source.');
      const texts = cl.sources.map((p) => ({ p, text: c.read(p) }));
      for (const t of texts) if (t.text === undefined) problems.push(`Source ${t.p} does not exist at commit ${c.commit.slice(0, 7)}.`);
      const haystack = norm(texts.map((t) => t.text ?? '').join('\n'));
      for (const needle of cl.contains ?? []) if (!haystack.includes(norm(needle))) problems.push(`None of the cited sources contains "${needle}".`);
      out.push({ claimId: cl.id, slideId: s.id, ok: problems.length === 0, problems });
    }
    // Every source a slide lists must exist: a footer must not point at a file that is not there.
    for (const r of s.sources) if (!c.has(r.path)) out.push({ claimId: `${s.id}-source:${r.path}`, slideId: s.id, ok: false, problems: [`Listed source ${r.path} does not exist at commit ${c.commit.slice(0, 7)}.`] });
  }
  return out;
}

/** A slide whose claim fails is not allowed to present it: the claim is replaced by a placeholder naming what was not found. */
export function applyFailures(slides: Slide[], checks: ClaimCheck[]): Slide[] {
  const bad = new Map<string, ClaimCheck[]>();
  for (const k of checks) if (!k.ok) bad.set(k.slideId, [...(bad.get(k.slideId) ?? []), k]);
  return slides.map((s) => {
    const fails = bad.get(s.id);
    if (!fails) return s;
    const added: Placeholder[] = fails.map((k) => ({ id: `PH-${k.claimId}`, what: `Unsupported claim ${k.claimId}`, why: k.problems.join(' '), neededFrom: 'The owner of the cited source' }));
    return { ...s, placeholders: [...s.placeholders, ...added] };
  });
}
