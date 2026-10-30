// Work-item events: the append-only record of what a person did to a work item (assign, prioritize, comment, block, ask for
// clarification, submit for review, approve or reject completion, reopen). Same design as the decision review events:
// one JSON file per action under docs/work-items/<item id>/, hash-chained to the one before, sent as a pull request.
// Pure: no file, network or clock access.
import { canonicalJson, sha256, type Actor, type RoleCheck } from './events.ts';
import type { RecordSignature } from '../auth/signing.ts';
import { subjectKeyOf } from '../auth/access-policy.ts';
import type { Priority } from '../queue/types.ts';
import { PRIORITIES } from '../queue/types.ts';

import { WORK_ACTIONS, WORK_ACTION_LABEL, type WorkAction } from './labels.ts';
export { WORK_ACTIONS, WORK_ACTION_LABEL, type WorkAction };

export const WORK_EVENT_SCHEMA = 'greenfuel.work-item-event/v2';
export const WORK_DIR = 'docs/work-items';

/** Item ids are safe path segments: T14, R1b, B-01, G-12, RK-001, RV-0001, SF-N4, RC-A1, D-010, ADR-0004. */
export const WORK_ID = /^[A-Za-z][A-Za-z0-9]{0,7}(?:-[A-Za-z0-9]{1,8})?$/;

export interface WorkEvent {
  schema: typeof WORK_EVENT_SCHEMA;
  id: string;
  itemId: string;
  seq: number;
  action: WorkAction;
  actor: Actor;
  createdAt: string;
  basis: { itemHash: string; sourceStatus: string; sourcePath: string };
  prevHash: string | null;
  assignee: string | null;
  priority: Priority | null;
  dueDate: string | null;
  rationale: string | null;
  comment: string | null;
  evidence: string[];
  blockedBy: string[];
  roleCheck: RoleCheck;
  eventHash: string;
  /** The server's signature over the hash. Without a valid one the record is not an approval. */
  signature: RecordSignature | null;
}

export type WorkPhase = 'none' | 'active' | 'blocked' | 'clarification' | 'in-review' | 'completed';

export interface WorkState {
  itemId: string;
  events: WorkEvent[];
  phase: WorkPhase;
  assignee: string | null;
  priority: Priority | null;
  dueDate: string | null;
  headHash: string | null;
  /** Who last submitted the item for review, and with which evidence. */
  submittedBy: string | null;
  /** The stable identity of who submitted it, for segregation of duties. */
  submittedBySubject: string | null;
  evidence: string[];
  blockedBy: string[];
  completedBy: WorkEvent | null;
  problems: string[];
}

export const workEventPath = (id: string, seq: number, action: WorkAction) => `${WORK_DIR}/${id}/${String(seq).padStart(4, '0')}-${action}.json`;
export const workEventId = (id: string, seq: number) => `WI-${id}-${String(seq).padStart(4, '0')}`;
export const serializeWorkEvent = (e: WorkEvent) => `${JSON.stringify(e, null, 2)}\n`;

export function hashWorkEvent(e: Omit<WorkEvent, 'eventHash' | 'signature'> | WorkEvent): string {
  const { eventHash: _h, signature: _s, ...rest } = e as WorkEvent;
  void _h;
  void _s;
  return sha256(canonicalJson(rest));
}

const KEYS = ['schema', 'id', 'itemId', 'seq', 'action', 'actor', 'createdAt', 'basis', 'prevHash', 'assignee', 'priority', 'dueDate', 'rationale', 'comment', 'evidence', 'blockedBy', 'roleCheck', 'eventHash', 'signature'];

export function parseWorkEvent(text: string): { event: WorkEvent } | { error: string } {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return { error: 'not valid JSON' };
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { error: 'not an object' };
  const r = o as Record<string, unknown>;
  const extra = Object.keys(r).filter((k) => !KEYS.includes(k));
  const missing = KEYS.filter((k) => !(k in r));
  if (extra.length) return { error: `unknown field(s): ${extra.join(', ')}` };
  if (missing.length) return { error: `missing field(s): ${missing.join(', ')}` };
  if (r.schema !== WORK_EVENT_SCHEMA) return { error: 'unknown schema' };
  if (typeof r.itemId !== 'string' || !WORK_ID.test(r.itemId)) return { error: 'bad item id' };
  if (!Number.isInteger(r.seq) || (r.seq as number) < 1) return { error: 'bad seq' };
  if (!WORK_ACTIONS.includes(r.action as WorkAction)) return { error: 'unknown action' };
  const a = r.actor as Record<string, unknown> | null;
  if (!a || typeof a.login !== 'string' || !a.login || (a.githubId !== null && !Number.isInteger(a.githubId))) return { error: 'bad actor' };
  if ((a.provider !== 'entra' && a.provider !== 'github') || typeof a.subject !== 'string' || !a.subject || (a.tenantId !== null && typeof a.tenantId !== 'string')) return { error: 'bad actor identity' };
  if (r.signature !== null && (typeof r.signature !== 'object' || Array.isArray(r.signature))) return { error: 'bad signature field' };
  if (typeof r.createdAt !== 'string' || Number.isNaN(Date.parse(r.createdAt))) return { error: 'bad createdAt' };
  if (typeof r.eventHash !== 'string' || !/^[0-9a-f]{64}$/.test(r.eventHash)) return { error: 'bad eventHash' };
  if (r.prevHash !== null && !(typeof r.prevHash === 'string' && /^[0-9a-f]{64}$/.test(r.prevHash))) return { error: 'bad prevHash' };
  if (!Array.isArray(r.evidence) || r.evidence.some((x) => typeof x !== 'string') || !Array.isArray(r.blockedBy) || r.blockedBy.some((x) => typeof x !== 'string')) return { error: 'bad lists' };
  if (r.priority !== null && !PRIORITIES.includes(r.priority as Priority)) return { error: 'bad priority' };
  const e = r as unknown as WorkEvent;
  if (r.id !== workEventId(e.itemId, e.seq)) return { error: 'id does not match item and seq' };
  if (hashWorkEvent(e) !== e.eventHash) return { error: 'eventHash does not match the content: the file was edited' };
  return { event: e };
}

// ---- state machine

const ANYTIME: WorkAction[] = ['assign', 'prioritize', 'comment'];

/** Actions a phase permits, before source-status, kind and role rules. */
export function workPermittedIn(phase: WorkPhase): WorkAction[] {
  switch (phase) {
    case 'none':
    case 'active':
      return [...ANYTIME, 'mark-blocked', 'request-clarification', 'submit-for-review', ...(phase === 'none' ? (['reopen'] as WorkAction[]) : [])];
    case 'blocked':
    case 'clarification':
      return [...ANYTIME, 'unblock', 'mark-blocked', 'request-clarification'];
    case 'in-review':
      return ['comment', 'assign', 'prioritize', 'approve-completion', 'reject-completion'];
    case 'completed':
      return ['comment', 'reopen'];
  }
}

export function nextWorkPhase(phase: WorkPhase, a: WorkAction): WorkPhase {
  switch (a) {
    case 'assign':
    case 'prioritize':
    case 'comment':
      return phase;
    case 'mark-blocked':
      return 'blocked';
    case 'request-clarification':
      return 'clarification';
    case 'unblock':
    case 'reject-completion':
    case 'reopen':
      return 'active';
    case 'submit-for-review':
      return 'in-review';
    case 'approve-completion':
      return 'completed';
  }
}

export function emptyWorkState(itemId: string): WorkState {
  return { itemId, events: [], phase: 'none', assignee: null, priority: null, dueDate: null, headHash: null, submittedBy: null, submittedBySubject: null, evidence: [], blockedBy: [], completedBy: null, problems: [] };
}

export function applyWorkEvent(s: WorkState, e: WorkEvent): WorkState | { error: string } {
  if (e.itemId !== s.itemId) return { error: 'event belongs to another item' };
  if (e.seq !== s.events.length + 1) return { error: `expected sequence ${s.events.length + 1}, found ${e.seq}` };
  if (e.prevHash !== s.headHash) return { error: 'prevHash does not match the previous event: an event is missing, reordered or replaced' };
  if (!workPermittedIn(s.phase).includes(e.action)) return { error: `"${e.action}" is not allowed while the item is ${s.phase}` };
  const phase = nextWorkPhase(s.phase, e.action);
  const next: WorkState = { ...s, events: [...s.events, e], phase, headHash: e.eventHash };
  if (e.action === 'assign') {
    next.assignee = e.assignee;
    next.dueDate = e.dueDate ?? s.dueDate;
  }
  if (e.action === 'prioritize') next.priority = e.priority;
  if (e.action === 'mark-blocked') next.blockedBy = e.blockedBy;
  if (e.action === 'unblock') next.blockedBy = [];
  if (e.action === 'submit-for-review') {
    next.submittedBy = e.actor.login;
    next.submittedBySubject = subjectKeyOf(e.actor);
    next.evidence = e.evidence;
  }
  if (e.action === 'approve-completion') next.completedBy = e;
  if (e.action === 'reopen' || e.action === 'reject-completion') {
    next.completedBy = null;
    if (e.action === 'reopen') next.evidence = [];
  }
  return next;
}

export function foldWorkEvents(itemId: string, events: WorkEvent[]): WorkState {
  let s = emptyWorkState(itemId);
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    const r = applyWorkEvent(s, e);
    if ('error' in r) {
      s = { ...s, problems: [...s.problems, `${e.id}: ${r.error}`] };
      break;
    }
    s = r;
  }
  return s;
}
