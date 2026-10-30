// Decision review events: the append-only record of what a person decided about one decision.
// An event is a JSON file under docs/decision-reviews/<decision id>/. It is hash-chained to the previous event of the same
// decision, so a missing, reordered or edited event is detected. This module is pure: no file, network or clock access.
import crypto from 'node:crypto';
import type { NormStatus } from '../intel/schema.ts';
import type { RecordSignature } from '../auth/signing.ts';

export const EVENT_SCHEMA = 'greenfuel.decision-review-event/v2';
export const REVIEW_DIR = 'docs/decision-reviews';

import { ACTIONS, ACTION_LABEL, type ActionKind } from './labels.ts';
export { ACTIONS, ACTION_LABEL, type ActionKind };

export const DECISION_ID = /^(ADR-\d{4}|D-\d{3})$/;

/** Who did it. The subject is the stable identity (a GitHub id, or an Entra tenant and object id); the login is only a display handle. */
export interface Actor {
  login: string;
  githubId: number | null;
  name: string | null;
  verifiedBy: 'github-api' | 'test-fixture' | 'entra-oidc';
  provider: 'entra' | 'github';
  subject: string;
  tenantId: string | null;
}

export interface RoleCheck {
  critical: boolean;
  /** Roles of which the actor must hold at least one. */
  required: string[];
  held: string[];
  /** Roles the decision's own record names, whether or not the actor holds them. */
  namedRoles: string[];
  /** Named roles the actor does not hold: a reviewer of the pull request should expect their input. */
  outstanding: string[];
  policySource: 'canonical' | 'local-head-not-canonical';
  /** The approval domain the record was classified into, and the hash of the access policy it was decided under. */
  domain: string;
  policyHash: string;
  /** The authorization checks that passed, by name. */
  checks: string[];
  authAgeSeconds: number;
  mfa: boolean;
}

export interface OptionRef {
  key: string;
  name: string;
  recommended: boolean;
}

export interface ReviewEvent {
  schema: typeof EVENT_SCHEMA;
  id: string;
  decisionId: string;
  seq: number;
  action: ActionKind;
  actor: Actor;
  createdAt: string;
  basis: { recordHash: string; sourceStatus: string; sourceCommit: string };
  prevHash: string | null;
  option: OptionRef | null;
  conditions: string[];
  rationale: string | null;
  comment: string | null;
  /** For a recommend action: approve, reject or revise. Null otherwise. */
  recommendation: string | null;
  roleCheck: RoleCheck;
  eventHash: string;
  /** The server's signature over the hash. Without a valid one the record is not an approval. */
  signature: RecordSignature | null;
}

export type ReviewPhase = 'none' | 'approved' | 'approved-with-conditions' | 'rejected' | 'revision-requested' | 'deferred' | 'reopened';

export interface ReviewState {
  decisionId: string;
  events: ReviewEvent[];
  phase: ReviewPhase;
  /** The status this review imposes, or null when the source's own status stands. */
  effectiveStatus: NormStatus | null;
  approvedOption: OptionRef | null;
  conditions: string[];
  headHash: string | null;
  /** The event that put the decision in its current phase. */
  decidingEvent: ReviewEvent | null;
  /** Problems found in the chain. Events after the first problem are ignored. */
  problems: string[];
}

// ---- hashing

export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(',')}}`;
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** The hash covers everything except itself and the signature, which is made over the hash. */
export function hashEvent(e: Omit<ReviewEvent, 'eventHash' | 'signature'> | ReviewEvent): string {
  const { eventHash: _h, signature: _s, ...rest } = e as ReviewEvent;
  void _h;
  void _s;
  return sha256(canonicalJson(rest));
}

export const eventPath = (decisionId: string, seq: number, action: ActionKind) => `${REVIEW_DIR}/${decisionId}/${String(seq).padStart(4, '0')}-${action}.json`;
export const eventId = (decisionId: string, seq: number) => `DR-${decisionId}-${String(seq).padStart(4, '0')}`;
export const serializeEvent = (e: ReviewEvent) => `${JSON.stringify(e, null, 2)}\n`;

// ---- parsing

const KEYS = ['schema', 'id', 'decisionId', 'seq', 'action', 'actor', 'createdAt', 'basis', 'prevHash', 'option', 'conditions', 'rationale', 'comment', 'recommendation', 'roleCheck', 'eventHash', 'signature'];

/** Strict parse: unknown keys, wrong types or a hash that does not match are refused. */
export function parseEvent(text: string): { event: ReviewEvent } | { error: string } {
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
  if (r.schema !== EVENT_SCHEMA) return { error: 'unknown schema' };
  if (typeof r.decisionId !== 'string' || !DECISION_ID.test(r.decisionId)) return { error: 'bad decision id' };
  if (!Number.isInteger(r.seq) || (r.seq as number) < 1) return { error: 'bad seq' };
  if (!ACTIONS.includes(r.action as ActionKind)) return { error: 'unknown action' };
  const a = r.actor as Record<string, unknown> | null;
  if (!a || typeof a.login !== 'string' || !a.login || (a.githubId !== null && !Number.isInteger(a.githubId))) return { error: 'bad actor' };
  if ((a.provider !== 'entra' && a.provider !== 'github') || typeof a.subject !== 'string' || !a.subject || (a.tenantId !== null && typeof a.tenantId !== 'string')) return { error: 'bad actor identity' };
  if (r.signature !== null && (typeof r.signature !== 'object' || Array.isArray(r.signature))) return { error: 'bad signature field' };
  if (typeof r.createdAt !== 'string' || Number.isNaN(Date.parse(r.createdAt))) return { error: 'bad createdAt' };
  if (typeof r.eventHash !== 'string' || !/^[0-9a-f]{64}$/.test(r.eventHash)) return { error: 'bad eventHash' };
  if (r.prevHash !== null && !(typeof r.prevHash === 'string' && /^[0-9a-f]{64}$/.test(r.prevHash))) return { error: 'bad prevHash' };
  if (!Array.isArray(r.conditions) || r.conditions.some((c) => typeof c !== 'string')) return { error: 'bad conditions' };
  const e = r as unknown as ReviewEvent;
  if (r.id !== eventId(e.decisionId, e.seq)) return { error: 'id does not match decision and seq' };
  if (hashEvent(e) !== e.eventHash) return { error: 'eventHash does not match the content: the file was edited' };
  return { event: e };
}

// ---- state machine

const DECIDING: ActionKind[] = ['approve', 'approve-alternative', 'approve-with-conditions', 'reject', 'request-revision', 'defer'];

/** Actions the phase permits, before any source-status or role rule. */
export function permittedIn(phase: ReviewPhase): ActionKind[] {
  switch (phase) {
    case 'approved':
    case 'approved-with-conditions':
    case 'rejected':
      return ['reopen', 'comment'];
    case 'none':
      // Reopen from "no review yet" is how a source-approved or source-rejected decision is revisited. Whether the
      // source status allows it is checked when the action is requested.
      return [...DECIDING, 'reopen', 'comment', 'recommend'];
    default:
      return [...DECIDING, 'comment', 'recommend'];
  }
}

export function nextPhase(phase: ReviewPhase, a: ActionKind): ReviewPhase {
  switch (a) {
    case 'approve':
    case 'approve-alternative':
      return 'approved';
    case 'approve-with-conditions':
      return 'approved-with-conditions';
    case 'reject':
      return 'rejected';
    case 'request-revision':
      return 'revision-requested';
    case 'defer':
      return 'deferred';
    case 'reopen':
      return 'reopened';
    case 'comment':
    case 'recommend':
      return phase;
  }
}

const STATUS_OF: Record<ReviewPhase, NormStatus | null> = {
  none: null,
  approved: 'Approved',
  'approved-with-conditions': 'Approved',
  rejected: 'Rejected',
  'revision-requested': 'Pending Review',
  deferred: 'Deferred',
  reopened: 'Pending Review',
};

export function emptyState(decisionId: string): ReviewState {
  return { decisionId, events: [], phase: 'none', effectiveStatus: null, approvedOption: null, conditions: [], headHash: null, decidingEvent: null, problems: [] };
}

/** Apply one event to a state, or say why it is not legal. */
export function applyEvent(s: ReviewState, e: ReviewEvent): ReviewState | { error: string } {
  if (e.decisionId !== s.decisionId) return { error: 'event belongs to another decision' };
  if (e.seq !== s.events.length + 1) return { error: `expected sequence ${s.events.length + 1}, found ${e.seq}` };
  if (e.prevHash !== s.headHash) return { error: 'prevHash does not match the previous event: an event is missing, reordered or replaced' };
  if (!permittedIn(s.phase).includes(e.action)) return { error: `"${e.action}" is not allowed while the decision is ${s.phase}` };
  const phase = nextPhase(s.phase, e.action);
  const decides = e.action !== 'comment' && e.action !== 'recommend';
  const approves = phase === 'approved' || phase === 'approved-with-conditions';
  return {
    ...s,
    events: [...s.events, e],
    phase,
    effectiveStatus: STATUS_OF[phase],
    approvedOption: decides ? (approves ? e.option : null) : s.approvedOption,
    conditions: decides ? (phase === 'approved-with-conditions' ? e.conditions : []) : s.conditions,
    headHash: e.eventHash,
    decidingEvent: decides ? e : s.decidingEvent,
  };
}

/** Fold events in order. The first illegal event ends the fold; it and everything after it are reported, not applied. */
export function foldEvents(decisionId: string, events: ReviewEvent[]): ReviewState {
  let s = emptyState(decisionId);
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  for (const e of ordered) {
    const r = applyEvent(s, e);
    if ('error' in r) {
      s = { ...s, problems: [...s.problems, `${e.id}: ${r.error}`] };
      break;
    }
    s = r;
  }
  return s;
}
