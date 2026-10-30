// Merged work-item events shown on top of the derived items. Only events on the canonical ref that form a valid chain are applied,
// so an item is never shown as assigned, blocked or Done on the strength of an unmerged request.
import type { EvidenceLink, Flag, WorkItem, WorkStatus } from './types.ts';
import { workEventPath, type WorkPhase, type WorkState } from '../workflow/work-events.ts';

const STATUS_OF: Partial<Record<WorkPhase, WorkStatus>> = { active: 'Open', blocked: 'Blocked', clarification: 'Awaiting clarification', 'in-review': 'In review', completed: 'Done' };

export function applyWorkOverlay(items: WorkItem[], states: Map<string, WorkState>, completionRoles: string[], ref: string): WorkItem[] {
  return items.map((it) => {
    const s = states.get(it.id);
    if (!s || !s.events.length) return it;
    const last = s.events[s.events.length - 1]!;
    const flags: Flag[] = [...it.flags];
    const next: WorkItem = { ...it, flags };
    if (s.assignee) next.assignee = s.assignee;
    if (s.dueDate) next.dueDate = s.dueDate;
    if (s.priority) {
      const e = [...s.events].reverse().find((x) => x.action === 'prioritize');
      next.priority = s.priority;
      next.priorityBasis = `Set by @${e?.actor.login ?? 'unknown'} in ${e?.id ?? 'a work-item record'}`;
      next.missing = it.missing.filter((m) => m !== 'priority');
    }
    if (s.assignee) next.missing = next.missing.filter((m) => m !== 'owner');
    const status = STATUS_OF[s.phase];
    if (status) {
      next.status = status;
      next.statusBasis = `Work-item record ${last.id} (${last.action}) on ${ref}. The source says: ${it.sourceStatus ?? it.statusBasis}`;
    }
    if (s.phase === 'blocked') {
      const e = [...s.events].reverse().find((x) => x.action === 'mark-blocked');
      flags.push({ code: 'marked-blocked', text: `Marked blocked by @${e?.actor.login}: ${e?.rationale ?? ''}${s.blockedBy.length ? ` Blocked by ${s.blockedBy.join(', ')}.` : ''}` });
    }
    if (s.phase === 'clarification') {
      const e = [...s.events].reverse().find((x) => x.action === 'request-clarification');
      flags.push({ code: 'clarification', text: `Clarification requested by @${e?.actor.login}: ${e?.rationale ?? ''}` });
    }
    if (s.phase === 'in-review') next.approval = { kind: 'completion', by: completionRoles.join(' or ') || 'Not configured', state: 'In review' };
    if (s.phase === 'completed' && s.completedBy) {
      const approved = s.completedBy;
      const evidence: EvidenceLink[] = s.evidence.map((ref2) => ({ ref: ref2, kind: 'completion-review', src: { path: workEventPath(approved.itemId, approved.seq, approved.action), line: 1 }, valid: true, note: `Submitted by @${s.submittedBy}, approved by @${approved.actor.login}` }));
      next.completionEvidence = [...it.completionEvidence.filter((x) => x.valid), ...evidence];
    }
    if (s.phase === 'active' && last.action === 'reject-completion') flags.push({ code: 'completion-rejected', text: `Completion rejected by @${last.actor.login}: ${last.rationale ?? ''}` });
    if (s.phase === 'active' && last.action === 'reopen') flags.push({ code: 'reopened', text: `Reopened by @${last.actor.login}: ${last.rationale ?? ''}` });
    return next;
  });
}
