// Shows a merged review on top of the register. Only events that are on the canonical ref and form a valid chain are applied,
// so a decision is never shown as approved, rejected or deferred on the strength of a pending or unmerged proposal.
import type { ApprovalEvent, NormStatus, NormalizedDecision, RegisterSnapshot } from '../intel/schema.ts';
import { STATUSES } from '../intel/schema.ts';
import { ACTION_LABEL, eventPath, type ReviewEvent, type ReviewState } from './events.ts';

const describe = (e: ReviewEvent): string => {
  const parts: string[] = [ACTION_LABEL[e.action]];
  if (e.option) parts.push(`option ${e.option.key}`);
  if (e.conditions.length) parts.push(`${e.conditions.length} condition(s)`);
  const why = e.rationale ?? e.comment;
  return `${parts.join(', ')}${why ? `: ${why.slice(0, 160)}` : ''}`;
};

export const toApprovalEvent = (e: ReviewEvent): ApprovalEvent => ({ type: 'review-event', date: e.createdAt.slice(0, 10), actor: `@${e.actor.login}`, text: describe(e), signed: false, src: { path: eventPath(e.decisionId, e.seq, e.action), line: 1 } });

export function applyReviewOverlay(reg: RegisterSnapshot, states: Map<string, ReviewState>, ref: string): RegisterSnapshot {
  const warnings = [...reg.warnings];
  const records = reg.records.map((r): NormalizedDecision => {
    const s = states.get(r.id);
    if (!s) return r;
    for (const p of s.problems) warnings.push(`Review record for ${r.id} is inconsistent on ${ref}: ${p}`);
    if (!s.events.length) return r;
    const history = s.events.map(toApprovalEvent);
    if (s.phase === 'none' || !s.effectiveStatus) return { ...r, approvalHistory: [...history, ...r.approvalHistory] };
    const by = s.decidingEvent!;
    const flags = [...r.flags];
    if (s.phase === 'approved' || s.phase === 'approved-with-conditions') {
      flags.push({ code: 'review-record-approval', text: `Approved by review record ${by.id} merged to ${ref}. It is a recorded decision, not a signed approval under ADR 0008.` });
      if (s.phase === 'approved-with-conditions') flags.push({ code: 'conditional-approval', text: `Approval is conditional: ${s.conditions.join('; ')}` });
      if (s.approvedOption && !s.approvedOption.recommended) flags.push({ code: 'alternative-selected', text: `Option ${s.approvedOption.key} was approved instead of the recommended option.` });
    }
    if (s.phase === 'revision-requested') flags.push({ code: 'revision-requested', text: `A revision was requested in ${by.id}: ${(by.rationale ?? '').slice(0, 200)}` });
    return {
      ...r,
      status: s.effectiveStatus,
      statusRule: `Review record ${by.id} (${ACTION_LABEL[by.action]}, by @${by.actor.login}) is on ${ref}. The source file's own status is "${r.statusRaw}".`,
      approvalBasis: s.effectiveStatus === 'Approved' ? 'review-record' : 'none',
      approvalHistory: [...history, ...r.approvalHistory],
      flags,
      review: { phase: s.phase, sourceStatus: r.status, sourceStatusRule: r.statusRule, decidingEventId: by.id },
    };
  });
  const byStatus = Object.fromEntries(STATUSES.map((x) => [x, 0])) as Record<NormStatus, number>;
  for (const r of records) byStatus[r.status]++;
  return { ...reg, records, warnings, stats: { ...reg.stats, byStatus } };
}
