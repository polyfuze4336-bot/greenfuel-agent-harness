// The pre-generation check. A sample deck can always be built, and is marked as a sample. A final deck is refused until the architecture it
// presents has been approved by people, its claims are supported, every slide has been reviewed at its current content, and the layout has
// been measured. Each unmet item says why and what would meet it. Nothing here approves anything.
import type { DeckContext } from './context.ts';
import type { Finding } from './qa.ts';
import { statusOf, type EffectiveStatus } from './store.ts';
import type { ClaimCheck, Slide } from './types.ts';

export interface GateItem {
  id: string;
  title: string;
  /** An unmet blocking item stops a final deck. An informational item is reported only. */
  blocking: boolean;
  met: boolean;
  detail: string;
  hint?: string;
}

export interface DeckGate {
  items: GateItem[];
  /** True only when every blocking item is met. */
  finalAllowed: boolean;
}

export interface GateInput {
  ctx: DeckContext;
  slides: Slide[];
  statuses: Map<string, EffectiveStatus>;
  claimChecks: ClaimCheck[];
  /** Findings from the last render and check, or null when the deck has not been rendered. */
  qa: Finding[] | null;
  rendered: boolean;
  rehearsal: { rehearsed: number; total: number };
}

/** Counts the per-criterion status lines of the rehearsal scorecard. */
export function rehearsalOf(text: string | undefined): { rehearsed: number; total: number } {
  const lines = (text ?? '').split(/\r?\n/).filter((l) => /^- \*\*Status:\*\*/.test(l));
  return { total: lines.length, rehearsed: lines.filter((l) => !/NOT REHEARSED/i.test(l)).length };
}

export function deckGate(i: GateInput): DeckGate {
  const items: GateItem[] = [];
  const add = (x: GateItem) => items.push(x);

  const authorized = i.ctx.baselines.filter((b) => b.status === 'approved' && b.currentness === 'current');
  add({
    id: 'baseline',
    title: 'An authorized, current architecture baseline exists',
    blocking: true,
    met: authorized.length > 0,
    detail: authorized.length ? `Baseline ${authorized.map((b) => b.id).join(', ')} is authorized and current.` : 'No baseline is authorized. The deck cannot claim to present an approved architecture.',
    hint: 'Authorize a baseline (docs/architecture-studio/BASELINE.md).',
  });

  const shown = [...new Set(i.slides.flatMap((s) => s.decisions))];
  const notApproved = shown.filter((id) => i.ctx.decisions.find((d) => d.id === id)?.status !== 'Approved');
  add({
    id: 'decisions',
    title: 'Every decision the deck presents is approved',
    blocking: true,
    met: notApproved.length === 0,
    detail: notApproved.length ? `${notApproved.length} of ${shown.length} presented decisions are not approved: ${notApproved.join(', ')}.` : `All ${shown.length} presented decisions are approved.`,
    hint: 'Decide them in the review workflow. The deck reads their status; it does not change it.',
  });

  const failing = i.claimChecks.filter((c) => !c.ok);
  add({ id: 'claims', title: 'Every claim is supported by a cited source', blocking: true, met: failing.length === 0, detail: failing.length ? `${failing.length} of ${i.claimChecks.length} claim checks fail.` : `All ${i.claimChecks.length} claim checks pass (a source exists and says what the claim relies on).`, hint: 'Fix the source or the claim.' });

  const approved = i.slides.filter((s) => i.statuses.get(s.id) === 'approved').length;
  const stale = i.slides.filter((s) => /^stale/.test(i.statuses.get(s.id) ?? '')).length;
  add({
    id: 'slides',
    title: 'A person has approved every slide at its current content',
    blocking: true,
    met: approved === i.slides.length,
    detail: `${approved} of ${i.slides.length} slides approved${stale ? `; ${stale} had an approval that no longer applies because the slide changed` : ''}.`,
    hint: 'Review each slide in the Presentation Studio.',
  });

  const errors = (i.qa ?? []).filter((f) => f.severity === 'error');
  add({
    id: 'qa',
    title: 'The deck was rendered, measured by PowerPoint, and has no layout error',
    blocking: true,
    met: i.rendered && errors.length === 0,
    detail: !i.rendered ? 'The deck has not been rendered, so overflow is only estimated.' : errors.length ? `${errors.length} layout or content errors.` : 'No overflow, overlap, margin, font or content error.',
    hint: 'Build with rendering on a computer with Microsoft PowerPoint.',
  });

  add({
    id: 'clean-tree',
    title: 'The sources are exactly the committed commit',
    blocking: true,
    met: i.ctx.uncommitted === 0,
    detail: i.ctx.uncommitted === 0 ? `Commit ${i.ctx.commit.slice(0, 7)}, no uncommitted changes.` : `${i.ctx.uncommitted} tracked files differ from commit ${i.ctx.commit.slice(0, 7)}, so figures may not match it.`,
    hint: 'Commit or discard changes, then build again.',
  });

  const placeholders = i.slides.reduce((n, s) => n + s.placeholders.length, 0);
  add({
    id: 'placeholders',
    title: 'Review placeholders',
    blocking: false,
    met: placeholders === 0,
    detail: placeholders ? `${placeholders} placeholders on ${i.slides.filter((s) => s.placeholders.length).length} slides stand for evidence the repository does not hold. They are shown on the slides; approving such a slide needs a written acknowledgement.` : 'No slide carries a placeholder.',
  });

  add({
    id: 'rehearsal',
    title: 'Delivery rehearsed by a person',
    blocking: false,
    met: i.rehearsal.total > 0 && i.rehearsal.rehearsed === i.rehearsal.total,
    detail: `${i.rehearsal.rehearsed} of ${i.rehearsal.total} rehearsal criteria are recorded as rehearsed. The deck does not verify delivery, presence or consultative behaviour.`,
  });

  return { items, finalAllowed: items.filter((x) => x.blocking).every((x) => x.met) };
}

export { statusOf };
