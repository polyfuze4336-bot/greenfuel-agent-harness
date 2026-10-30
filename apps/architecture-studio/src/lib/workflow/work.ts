// The work-item service: assign, prioritize, comment, block, clarify, submit for review, approve or reject completion, reopen.
// Same guarantees as the decision review workflow, and the same pull-request pipeline: nothing changes on the canonical branch
// until a person merges, and an item is shown as Done only after a verified, evidence-backed completion approval.
import crypto from 'node:crypto';
import { GitRepositoryAdapter } from '../repo/git.ts';
import type { WorkItem } from '../queue/types.ts';
import { canonicalJson, sha256 } from './events.ts';
import type { VerifiedUser } from './identity.ts';
import { ServiceError, type ReviewService, type ServiceDeps } from './review.ts';
import type { Policy } from './rules.ts';
import { ReviewStore, isOpen, withLock, type AuditFacts, type Proposal } from './store.ts';
import { factsOf, syncProposal, type SyncDeps, type SyncFamily } from './sync-core.ts';
import {
  WORK_ACTION_LABEL, WORK_DIR, applyWorkEvent, emptyWorkState, foldWorkEvents, hashWorkEvent, parseWorkEvent, serializeWorkEvent, workEventId, workEventPath,
  type WorkAction, type WorkEvent, type WorkState,
} from './work-events.ts';
import { validateWorkRequest, workAvailability, type WorkAvailability, type WorkRequest } from './work-rules.ts';
import { authenticityAt, checkRecord, type Authenticity } from '../auth/authenticity.ts';
import { authorizeWork, effectiveRoles, keyOf, roleCheckOf } from '../auth/authorize.ts';
import { authContextFor, getTrust } from '../auth/config.ts';
import { actorOf, authFacts, authzPublic } from './review.ts';

const FILE = new RegExp(`^${WORK_DIR}/([A-Za-z0-9-]{1,16})/(\\d{4})-([a-z-]+)\\.json$`);

/** Every work-item event on a ref, folded per item. A file that does not parse or match its own path is reported, never trusted. */
export function loadWorkStates(adapter: GitRepositoryAdapter, authenticity: Authenticity = authenticityAt((x) => adapter.read(x))): Map<string, WorkState> {
  const paths = adapter.list(`${WORK_DIR}/`).filter((p) => p.endsWith('.json'));
  adapter.preload(paths);
  const byItem = new Map<string, WorkEvent[]>();
  const problems = new Map<string, string[]>();
  const problem = (id: string, m: string) => problems.set(id, [...(problems.get(id) ?? []), m]);
  for (const p of paths) {
    const m = FILE.exec(p);
    if (!m) continue;
    const parsed = parseWorkEvent(adapter.read(p) ?? '');
    if ('error' in parsed) {
      problem(m[1]!, `${p}: ${parsed.error}`);
      continue;
    }
    const e = parsed.event;
    if (e.itemId !== m[1] || e.seq !== Number(m[2]) || e.action !== m[3]) {
      problem(m[1]!, `${p}: the file name does not match its content`);
      continue;
    }
    const fake = checkRecord(authenticity, { actor: e.actor, createdAt: e.createdAt, eventHash: e.eventHash, signature: e.signature, roleCheck: e.roleCheck, approvalClass: e.action === 'approve-completion' || e.action === 'reject-completion' || e.action === 'reopen' });
    if (fake) {
      problem(m[1]!, `${p}: not accepted as a record, because ${fake}`);
      continue;
    }
    byItem.set(e.itemId, [...(byItem.get(e.itemId) ?? []), e]);
  }
  const out = new Map<string, WorkState>();
  for (const id of new Set([...byItem.keys(), ...problems.keys()])) {
    const s = foldWorkEvents(id, byItem.get(id) ?? []);
    out.set(id, { ...s, problems: [...s.problems, ...(problems.get(id) ?? [])] });
  }
  return out;
}

const quote = (s: string) => s.split('\n').map((l) => `> ${l}`).join('\n');

function body(e: WorkEvent, ref: string): string {
  const lines = [
    'This pull request records a **work-item action** made through the Architecture Studio. It is not a signed approval under ADR 0008, and it changes no repository source file.',
    '',
    '| | |',
    '|---|---|',
    `| Work item | ${e.itemId} |`,
    `| Action | ${WORK_ACTION_LABEL[e.action]} |`,
    `| Requested by | @${e.actor.login} (GitHub id ${e.actor.githubId}, verified by ${e.actor.verifiedBy}) |`,
    `| Roles held | ${e.roleCheck.held.join(', ') || 'none'} |`,
    `| Policy source | ${e.roleCheck.policySource === 'canonical' ? 'canonical branch' : '**local copy, not yet on the canonical branch**'} |`,
    `| Event | ${e.id}, hash \`${e.eventHash}\` |`,
  ];
  if (e.assignee) lines.push(`| Assigned to | @${e.assignee} |`);
  if (e.priority) lines.push(`| Priority | ${e.priority} |`);
  if (e.dueDate) lines.push(`| Due date (explicit) | ${e.dueDate} |`);
  if (e.blockedBy.length) lines.push(`| Blocked by | ${e.blockedBy.join(', ')} |`);
  if (e.evidence.length) lines.push('', '**Completion evidence submitted**', '', ...e.evidence.map((x) => `- ${x}`));
  if (e.rationale) lines.push('', '**Reason**', '', quote(e.rationale));
  if (e.comment) lines.push('', '**Comment**', '', quote(e.comment));
  lines.push('', `Merging adds one file to \`${ref}\`. The Studio shows the change only after it verifies that file. Closing this pull request discards the request.`);
  return lines.join('\n');
}

const workFamily: SyncFamily = {
  noun: 'work item',
  file: (p) => {
    const e = p.event as WorkEvent;
    return workEventPath(e.itemId, e.seq, e.action);
  },
  serialize: (p) => serializeWorkEvent(p.event as WorkEvent),
  chain: (a, p) => {
    const id = (p.event as WorkEvent).itemId;
    const st = loadWorkStates(a).get(id) ?? emptyWorkState(id);
    return { length: st.events.length, head: st.headHash, hashes: st.events.map((x) => x.eventHash) };
  },
  hashOf: (text) => {
    const r = parseWorkEvent(text);
    return 'event' in r ? r.event.eventHash : null;
  },
  title: (p) => {
    const e = p.event as WorkEvent;
    return `Work item ${e.itemId}: ${WORK_ACTION_LABEL[e.action]} (${e.actor.login})`;
  },
  body: (p, ref) => body(p.event as WorkEvent, ref),
  message: (p) => {
    const e = p.event as WorkEvent;
    return `Work item ${e.itemId}: ${WORK_ACTION_LABEL[e.action]}\n\nRecorded through the Architecture Studio by ${e.actor.login}. Event ${e.id}, hash ${e.eventHash}.`;
  },
};

/** What a view needs from the canonical branch. */
export interface CanonicalWorkRead {
  ref: string;
  commit: string | null;
  available: boolean;
  error: string | null;
  states: Map<string, WorkState>;
}

/** What an action changes on a work item, as a before and after value for the audit log. */
function workChange(a: WorkAction, item: WorkItem, s: WorkState, c: { assignee: string | null; priority: WorkItem['priority']; blockedBy: string[] }): { field: string; old: string | null; new: string | null } {
  switch (a) {
    case 'assign':
      return { field: 'assignee', old: s.assignee ?? item.assignee, new: c.assignee };
    case 'prioritize':
      return { field: 'priority', old: s.priority ?? item.priority, new: c.priority };
    case 'comment':
      return { field: 'comment', old: null, new: 'comment added' };
    default: {
      const after: Partial<Record<WorkAction, string>> = { 'mark-blocked': 'Blocked', 'request-clarification': 'Awaiting clarification', 'submit-for-review': 'In review', 'approve-completion': 'Done', 'reject-completion': 'Open', reopen: 'Open', unblock: 'Open' };
      return { field: 'status', old: item.status, new: after[a] ?? item.status };
    }
  }
}

export interface WorkView {
  itemId: string;
  revision: string;
  canonical: { ref: string; commit: string | null; available: boolean; error: string | null; state: WorkState };
  open: Proposal | null;
  recent: Proposal[];
  actions: (WorkAvailability & { authorised: boolean | null; authReason: string | null })[];
  policy: { source: Policy['source']; configured: boolean };
  people: { login: string; holder: string; roles: string[] }[];
  user: { login: string; roles: string[]; listed: boolean } | null;
}

/** What the service needs to know about the world beyond the item itself. */
export interface WorkContext {
  /** Evidence run ids and whether the recorded run succeeded. */
  evidenceRuns: Map<string, { exitCode: number | null }>;
  /** Every work item id, so "blocked by" can be checked. */
  knownItems: Set<string>;
}

export class WorkService {
  readonly deps: ServiceDeps;
  private readonly review: ReviewService;
  constructor(deps: ServiceDeps, review: ReviewService) {
    this.deps = deps;
    this.review = review;
  }

  private now() {
    return (this.deps.now ?? (() => new Date()))();
  }

  canonical() {
    try {
      const a = new GitRepositoryAdapter(this.deps.root, this.deps.canonicalRef).open();
      return { available: true as const, ref: this.deps.canonicalRef, commit: a.commit, states: loadWorkStates(a), error: null as string | null, adapter: a };
    } catch {
      return { available: false as const, ref: this.deps.canonicalRef, commit: null as string | null, states: new Map<string, WorkState>(), error: `The canonical ref ${this.deps.canonicalRef} cannot be read.`, adapter: null };
    }
  }

  private revisionOf(item: WorkItem, s: WorkState, open: Proposal | null) {
    return sha256(canonicalJson({ h: item.contentHash, head: s.headHash, phase: s.phase, open: open?.id ?? null })).slice(0, 32);
  }

  view(item: WorkItem, user: VerifiedUser | null, canonical: CanonicalWorkRead = this.canonical(), policy: Policy = this.review.policy()): WorkView {
    const state = canonical.states.get(item.id) ?? emptyWorkState(item.id);
    const open = this.deps.store.openFor(item.id, 'work');
    const ctx = authContextFor(policy, this.now().getTime());
    const actions = workAvailability(item, state).map((a) => {
      if (!user) return { ...a, authorised: null, authReason: 'Sign in to act.' };
      if (!a.allowed) return { ...a, authorised: null, authReason: null };
      const auth = authorizeWork({ principal: user, action: a.action, itemId: item.id, submitter: state.submittedBySubject }, ctx);
      return { ...a, authorised: auth.ok, authReason: auth.ok ? null : (auth.reason ?? null) };
    });
    const mine = user ? policy.people.find((p) => p.subject === keyOf(user)) : undefined;
    return {
      itemId: item.id,
      revision: this.revisionOf(item, state, open),
      canonical: { ref: canonical.ref, commit: canonical.commit, available: canonical.available, error: canonical.error, state },
      open,
      recent: this.deps.store.forDecision(item.id, 'work').filter((p) => !isOpen(p.state)).slice(-5).reverse(),
      actions,
      policy: { source: policy.source, configured: policy.people.length > 0 },
      people: policy.people.filter((p) => p.revokedAt === null).map((p) => ({ login: p.login, holder: p.holder, roles: p.roles })),
      user: user ? { login: user.login, roles: effectiveRoles(user, ctx).roles, listed: !!mine } : null,
    };
  }

  private audit(user: VerifiedUser | null, id: string, action: string, outcome: Parameters<ReviewStore['audit']>[0]['outcome'], code: string | null, detail: string | null, proposalId: string | null = null, facts?: AuditFacts) {
    this.deps.store.audit({ at: this.now().toISOString(), actor: user?.login ?? null, decisionId: `work:${id}`, action, outcome, code, detail: detail?.slice(0, 300) ?? null, proposalId, ...(facts ? { facts } : {}) });
  }

  private refuse(user: VerifiedUser | null, id: string, action: string, outcome: 'denied' | 'stale' | 'invalid', e: ServiceError, facts?: AuditFacts): never {
    this.audit(user, id, action, outcome, e.code, e.message, null, facts);
    throw e;
  }

  async submit(user: VerifiedUser | null, item: WorkItem, req: Partial<WorkRequest>, ctx: WorkContext): Promise<{ proposal: Proposal; duplicate: boolean }> {
    const action = String(req.action ?? '');
    if (!user) this.refuse(null, item.id, action, 'denied', new ServiceError(401, 'unauthenticated', 'Sign in first. Every action needs a verified identity.'));
    let current: VerifiedUser = user!;
    if (user!.provider === 'github') {
      try {
        current = await this.deps.identity.verify();
      } catch (e) {
        return this.refuse(user, item.id, action, 'denied', new ServiceError(401, 'identity-unverified', e instanceof Error ? e.message : 'GitHub could not confirm your identity.'));
      }
      if (keyOf(current) !== keyOf(user!)) {
        this.refuse(user, item.id, action, 'denied', new ServiceError(401, 'identity-changed', `The GitHub account on this computer is now ${current.login}, not ${user!.login}. Sign in again.`));
      }
      current = { ...current, authAt: user!.authAt };
    }
    return withLock(`work:${item.id}`, async () => {
      const v = validateWorkRequest(req);
      if (!v.ok) return this.refuse(current, item.id, action, 'invalid', new ServiceError(400, 'invalid', v.message));
      const a = req.action as WorkAction;
      try {
        await this.deps.publisher.fetchCanonical(this.deps.canonicalRef);
      } catch {
        /* checked again at sync */
      }
      const canonical = this.canonical();
      if (!canonical.available) return this.refuse(current, item.id, a, 'invalid', new ServiceError(503, 'canonical-unavailable', canonical.error ?? 'The canonical branch cannot be read.'));
      const policy = this.review.policy();
      const state = canonical.states.get(item.id) ?? emptyWorkState(item.id);
      const actx = authContextFor(policy, this.now().getTime());
      const auth = authorizeWork({ principal: current, action: a, itemId: item.id, submitter: state.submittedBySubject }, actx);
      if (!auth.ok) return this.refuse(current, item.id, a, 'denied', new ServiceError(auth.status, auth.code ?? 'forbidden', auth.reason ?? 'Not permitted.', { authz: authzPublic(auth) }), authFacts(auth));

      const prior = this.deps.store.byKey(item.id, req.idempotencyKey!, 'work');
      if (prior) {
        this.audit(current, item.id, a, 'duplicate', 'duplicate-submission', `Returned ${prior.id}`, prior.id);
        return { proposal: prior, duplicate: true };
      }
      const open = this.deps.store.openFor(item.id, 'work');
      const revision = this.revisionOf(item, state, open);
      if (req.expectedRevision !== revision) {
        const last = state.events[state.events.length - 1];
        return this.refuse(current, item.id, a, 'stale', new ServiceError(409, 'stale-revision', 'This item changed after you opened it. Review the current state, then act again.', {
          currentRevision: revision,
          conflict: {
            kind: 'stale-revision',
            current: { status: state.phase, canonicalCommit: canonical.commit, lastEvent: last ? { id: last.id, action: last.action, by: last.actor.login, at: last.createdAt, text: last.rationale ?? last.comment ?? null } : null, openProposal: open ? { id: open.id, state: open.state, action: open.action } : null, source: null },
            proposed: { action: a, option: null, conditions: null, rationale: req.rationale ?? null, comment: req.comment ?? null },
          },
        }));
      }
      if (open) return this.refuse(current, item.id, a, 'stale', new ServiceError(409, 'proposal-open', `A change to ${item.id} is already in flight (${open.id}, ${open.state}). One change at a time.`, { proposalId: open.id }));
      const av = workAvailability(item, state).find((x) => x.action === a);
      if (!av?.allowed) return this.refuse(current, item.id, a, 'denied', new ServiceError(409, 'not-allowed', av?.reason ?? 'This action is not allowed now.'));

      const c = v.value;
      if (a === 'assign' && !policy.people.some((p) => p.revokedAt === null && p.login.toLowerCase() === c.assignee!.toLowerCase())) {
        return this.refuse(current, item.id, a, 'invalid', new ServiceError(400, 'invalid', `${c.assignee} is not a registered person in the policy. Assign to one of the registered people.`));
      }
      if (a === 'mark-blocked') {
        const bad = c.blockedBy.find((x) => !ctx.knownItems.has(x));
        if (bad) return this.refuse(current, item.id, a, 'invalid', new ServiceError(400, 'invalid', `${bad} is not a work item in the queue.`));
        if (c.blockedBy.includes(item.id)) return this.refuse(current, item.id, a, 'invalid', new ServiceError(400, 'invalid', 'An item cannot block itself.'));
      }
      if (a === 'submit-for-review') {
        for (const ref of c.evidence) {
          if (/^EV-\d{4}$/.test(ref)) {
            const run = ctx.evidenceRuns.get(ref);
            if (!run) return this.refuse(current, item.id, a, 'invalid', new ServiceError(400, 'evidence-not-found', `${ref} is not an evidence record in the repository.`));
            if (run.exitCode !== 0) return this.refuse(current, item.id, a, 'invalid', new ServiceError(400, 'evidence-failed', `${ref} recorded a run that did not succeed (exit code ${run.exitCode}), so it cannot show completion.`));
          } else if (!canonical.adapter!.has(ref)) {
            return this.refuse(current, item.id, a, 'invalid', new ServiceError(400, 'evidence-not-found', `${ref} does not exist on ${canonical.ref}. Evidence must already be in the repository.`));
          }
        }
      }

      const seq = state.events.length + 1;
      const base = {
        schema: 'greenfuel.work-item-event/v2' as const,
        id: workEventId(item.id, seq),
        itemId: item.id,
        seq,
        action: a,
        actor: actorOf(current),
        createdAt: this.now().toISOString(),
        basis: { itemHash: item.contentHash, sourceStatus: item.sourceStatus ?? item.status, sourcePath: item.source.path },
        prevHash: state.headHash,
        assignee: c.assignee,
        priority: c.priority,
        dueDate: c.dueDate,
        rationale: c.rationale,
        comment: c.comment,
        evidence: c.evidence,
        blockedBy: c.blockedBy,
        roleCheck: roleCheckOf(auth, current, actx, null),
      };
      const signer = getTrust().signer;
      if (!signer) return this.refuse(current, item.id, a, 'invalid', new ServiceError(503, 'signing-unavailable', getTrust().signerProblem ?? 'This server has no signing key, so it cannot record an action.'));
      const hash = hashWorkEvent(base);
      const event: WorkEvent = { ...base, eventHash: hash, signature: signer.sign(hash) };
      const legal = applyWorkEvent(state, event);
      if ('error' in legal) return this.refuse(current, item.id, a, 'denied', new ServiceError(409, 'not-allowed', legal.error));

      const t = this.now();
      const proposal: Proposal = {
        id: `P-${t.toISOString().replace(/\D/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`,
        decisionId: item.id,
        family: 'work',
        action: a,
        idempotencyKey: req.idempotencyKey!,
        change: workChange(a, item, state, c),
        sourceCommit: null,
        submittedBy: current.login,
        event,
        state: 'locally-submitted',
        branch: `work-item/${item.id}/${String(seq).padStart(4, '0')}-${a}-${sha256(req.idempotencyKey!).slice(0, 8)}`,
        baseSha: null,
        headSha: null,
        prNumber: null,
        prUrl: null,
        attempts: 0,
        lastError: null,
        history: [{ at: t.toISOString(), state: 'locally-submitted', note: `${WORK_ACTION_LABEL[a]} saved in the Studio. Nothing has been sent to GitHub.` }],
        createdAt: t.toISOString(),
        updatedAt: t.toISOString(),
      };
      this.deps.store.save(proposal);
      this.audit(current, item.id, a, 'accepted', null, `Recorded ${event.id} as ${proposal.id}`, proposal.id, { oldValue: proposal.change!.old, newValue: proposal.change!.new, baseCommit: canonical.commit });
      return { proposal, duplicate: false };
    });
  }

  private syncDeps(): SyncDeps {
    return { root: this.deps.root, canonicalRef: this.deps.canonicalRef, store: this.deps.store, github: this.deps.github, publisher: this.deps.publisher, now: () => this.now(), audit: (p, code, detail) => this.audit({ login: p.submittedBy } as VerifiedUser, p.decisionId, p.action, 'sync', code, detail, p.id, factsOf(p)) };
  }

  async sync(proposalId: string): Promise<Proposal> {
    const first = this.deps.store.get(proposalId);
    if (!first) throw new ServiceError(404, 'not-found', 'No such proposal.');
    return withLock(`work:${first.decisionId}`, async () => syncProposal(this.syncDeps(), workFamily, this.deps.store.get(proposalId)!));
  }
}
