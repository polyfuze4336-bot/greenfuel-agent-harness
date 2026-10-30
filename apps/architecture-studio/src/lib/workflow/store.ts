// The Studio's own working state for the review workflow: proposals in flight and the audit log.
// It lives in the Studio cache folder (STUDIO_CACHE_DIR), never in the repository. The repository only ever receives an
// event through a reviewed pull request; this folder is what lets the Studio resume, retry and explain.
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson, sha256, type ReviewEvent } from './events.ts';
import { PROPOSAL_LABEL, type ProposalState } from './labels.ts';
import type { WorkEvent } from './work-events.ts';
import type { Validation } from './github.ts';

export { PROPOSAL_LABEL, type ProposalState };

export const OPEN_STATES: ProposalState[] = ['locally-submitted', 'awaiting-github-update', 'pull-request-created', 'awaiting-merge'];
export const isOpen = (s: ProposalState) => OPEN_STATES.includes(s);

export interface Proposal {
  id: string;
  /** The id of the subject: a decision id, or a work item id (see `family`). */
  decisionId: string;
  /** Which workflow created it. Proposals written before work items existed have none and are decisions. */
  family?: 'decision' | 'work';
  action: string;
  idempotencyKey: string;
  submittedBy: string;
  event: ReviewEvent | WorkEvent;
  state: ProposalState;
  branch: string;
  baseSha: string | null;
  headSha: string | null;
  prNumber: number | null;
  prUrl: string | null;
  attempts: number;
  /** The last problem, with whether trying again can help. */
  lastError: { code: string; message: string; retryable: boolean; at: string } | null;
  /** What the change does, for the audit log: the value before and the value after. */
  change?: { field: string; old: string | null; new: string | null };
  /** The commit of the source record the person was looking at when they acted. */
  sourceCommit?: string | null;
  /** The commit that carries the change: the merge commit once merged, otherwise the pull request's head. */
  resultCommit?: string | null;
  /** The checks and reviews GitHub reported at the last sync. */
  validation?: Validation | null;
  history: { at: string; state: ProposalState; note: string }[];
  createdAt: string;
  updatedAt: string;
}

/** The facts an audit entry records about a change, beyond who did what. */
export interface AuditFacts {
  oldValue?: string | null;
  newValue?: string | null;
  sourceCommit?: string | null;
  baseCommit?: string | null;
  resultCommit?: string | null;
  pullRequest?: number | null;
  validation?: string | null;
}

export interface AuditEntry {
  at: string;
  actor: string | null;
  decisionId: string | null;
  action: string;
  outcome: 'accepted' | 'denied' | 'stale' | 'duplicate' | 'invalid' | 'sync' | 'signin' | 'signout';
  code: string | null;
  detail: string | null;
  proposalId: string | null;
  facts?: AuditFacts;
  prevHash: string | null;
  hash: string;
}

const locks = new Map<string, Promise<unknown>>();

/** Runs fn after any earlier call with the same key, so two submissions for one decision never interleave. */
export function withLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  const prior = locks.get(key) ?? Promise.resolve();
  const next = prior.catch(() => undefined).then(fn);
  locks.set(key, next);
  void next.finally(() => {
    if (locks.get(key) === next) locks.delete(key);
  }).catch(() => undefined);
  return next;
}

export class ReviewStore {
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }

  private file(...p: string[]) {
    return path.join(this.dir, ...p);
  }

  private writeAtomic(p: string, text: string) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, p);
  }

  save(p: Proposal): Proposal {
    this.writeAtomic(this.file('proposals', `${p.id}.json`), `${JSON.stringify(p, null, 2)}\n`);
    return p;
  }

  get(id: string): Proposal | null {
    if (!/^[A-Za-z0-9-]{6,80}$/.test(id)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.file('proposals', `${id}.json`), 'utf8')) as Proposal;
    } catch {
      return null;
    }
  }

  list(): Proposal[] {
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.file('proposals')).filter((n) => n.endsWith('.json'));
    } catch {
      return [];
    }
    const out: Proposal[] = [];
    for (const n of names) {
      try {
        out.push(JSON.parse(fs.readFileSync(this.file('proposals', n), 'utf8')) as Proposal);
      } catch {
        /* an unreadable file is skipped; the audit log still has its history */
      }
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  forDecision(decisionId: string, family: 'decision' | 'work' = 'decision'): Proposal[] {
    return this.list().filter((p) => p.decisionId === decisionId && (p.family ?? 'decision') === family);
  }

  openFor(decisionId: string, family: 'decision' | 'work' = 'decision'): Proposal | null {
    return this.forDecision(decisionId, family).find((p) => isOpen(p.state)) ?? null;
  }

  byKey(decisionId: string, key: string, family: 'decision' | 'work' = 'decision'): Proposal | null {
    return this.forDecision(decisionId, family).find((p) => p.idempotencyKey === key) ?? null;
  }

  transition(p: Proposal, state: ProposalState, note: string, now: string, patch: Partial<Proposal> = {}): Proposal {
    const next: Proposal = { ...p, ...patch, state, updatedAt: now, history: [...p.history, { at: now, state, note }] };
    return this.save(next);
  }

  // ---- audit log: one JSON line per action attempt, hash-chained so removal or editing shows

  private auditFile() {
    return this.file('audit.jsonl');
  }

  audit(e: Omit<AuditEntry, 'prevHash' | 'hash'>): AuditEntry {
    let prev: string | null = null;
    try {
      const lines = fs.readFileSync(this.auditFile(), 'utf8').trimEnd().split('\n');
      prev = (JSON.parse(lines[lines.length - 1]!) as AuditEntry).hash;
    } catch {
      prev = null;
    }
    const body = { ...e, prevHash: prev };
    if (body.facts === undefined) delete body.facts;
    const entry: AuditEntry = { ...body, hash: sha256(canonicalJson(body)) };
    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(this.auditFile(), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    return entry;
  }

  readAudit(filter: { decisionId?: string; limit?: number } = {}): AuditEntry[] {
    let lines: string[] = [];
    try {
      lines = fs.readFileSync(this.auditFile(), 'utf8').split('\n').filter(Boolean);
    } catch {
      return [];
    }
    const all = lines.map((l) => JSON.parse(l) as AuditEntry);
    const sel = filter.decisionId ? all.filter((a) => a.decisionId === filter.decisionId) : all;
    return sel.slice(-(filter.limit ?? 50)).reverse();
  }

  /** Checks the hash chain. Returns the first problem, or null. */
  verifyAudit(): string | null {
    let prev: string | null = null;
    let lines: string[] = [];
    try {
      lines = fs.readFileSync(this.auditFile(), 'utf8').split('\n').filter(Boolean);
    } catch {
      return null;
    }
    for (const [i, l] of lines.entries()) {
      const e = JSON.parse(l) as AuditEntry;
      const { hash, ...body } = e;
      if (body.prevHash !== prev) return `entry ${i + 1}: chain broken`;
      if (sha256(canonicalJson(body)) !== hash) return `entry ${i + 1}: content changed`;
      prev = hash;
    }
    return null;
  }
}
