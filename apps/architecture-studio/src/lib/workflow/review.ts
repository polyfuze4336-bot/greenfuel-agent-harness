// The review workflow service. It owns the rules; routes only translate HTTP.
//
//   submit  -> checks identity, role, state, revision, duplicates; records ONE proposal (nothing is sent anywhere yet)
//   sync    -> moves a proposal forward: build a commit on the canonical branch, push a new branch, open a pull request,
//              then watch for the merge. Only a verified merge makes the decision canonical.
//
// "Canonical" means: the event file exists on the canonical ref (origin/main by default), parses, hashes correctly and chains.
import crypto from 'node:crypto';
import { GitRepositoryAdapter } from '../repo/git.ts';
import { sourceRuleOf, sourceStatusOf } from './rules.ts';
import type { NormalizedDecision } from '../intel/schema.ts';
import {
  ACTION_LABEL, REVIEW_DIR, applyEvent, canonicalJson, emptyState, eventId, eventPath, foldEvents, hashEvent, parseEvent, serializeEvent, sha256,
  type ActionKind, type ReviewEvent, type ReviewState,
} from './events.ts';
import { GitHubError, type GitHubPort } from './github.ts';
import type { IdentityProvider, VerifiedUser } from './identity.ts';
import { GitPublisher, PublishError, splitCanonicalRef } from './publish.ts';
import { POLICY_PATH, authorise, availability, parsePolicy, rolesHeld, isListed, validateRequest, emptyPolicy, type ActionAvailability, type ActionRequest, type Policy } from './rules.ts';
import { ReviewStore, isOpen, withLock, type Proposal, type ProposalState } from './store.ts';

export class ServiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export interface ServiceDeps {
  root: string;
  /** Where canonical decisions live, as remote/branch. Default origin/main. */
  canonicalRef: string;
  /** The ref the Studio reads its records from. Used only to find the policy before it has reached the canonical ref. */
  readRef: string;
  store: ReviewStore;
  github: GitHubPort;
  publisher: GitPublisher;
  identity: IdentityProvider;
  now?: () => Date;
}

export interface CanonicalReviews {
  available: boolean;
  ref: string;
  commit: string | null;
  states: Map<string, ReviewState>;
  error: string | null;
}

const FILE = new RegExp(`^${REVIEW_DIR}/((?:ADR-\\d{4}|D-\\d{3}))/(\\d{4})-([a-z-]+)\\.json$`);

/** Every review event on a ref, folded per decision. Files that do not parse or do not match their own path are reported, never trusted. */
export function loadReviewStates(adapter: GitRepositoryAdapter): Map<string, ReviewState> {
  const paths = adapter.list(`${REVIEW_DIR}/`).filter((p) => p.endsWith('.json'));
  adapter.preload(paths);
  const byDecision = new Map<string, ReviewEvent[]>();
  const problems = new Map<string, string[]>();
  const problem = (id: string, m: string) => problems.set(id, [...(problems.get(id) ?? []), m]);
  for (const p of paths) {
    const m = FILE.exec(p);
    if (!m) continue;
    const parsed = parseEvent(adapter.read(p) ?? '');
    if ('error' in parsed) {
      problem(m[1]!, `${p}: ${parsed.error}`);
      continue;
    }
    const e = parsed.event;
    if (e.decisionId !== m[1] || e.seq !== Number(m[2]) || e.action !== m[3]) {
      problem(m[1]!, `${p}: the file name does not match its content`);
      continue;
    }
    byDecision.set(e.decisionId, [...(byDecision.get(e.decisionId) ?? []), e]);
  }
  const out = new Map<string, ReviewState>();
  for (const id of new Set([...byDecision.keys(), ...problems.keys()])) {
    const s = foldEvents(id, byDecision.get(id) ?? []);
    out.set(id, { ...s, problems: [...s.problems, ...(problems.get(id) ?? [])] });
  }
  return out;
}

export interface ReviewView {
  decisionId: string;
  revision: string;
  canonical: { ref: string; commit: string | null; available: boolean; error: string | null; state: ReviewState };
  open: Proposal | null;
  recent: Proposal[];
  actions: (ActionAvailability & { authorised: boolean | null; authReason: string | null })[];
  policy: { source: Policy['source']; configured: boolean; problems: string[] };
  user: { login: string; name: string | null; roles: string[]; listed: boolean } | null;
}

const short = (s: string | null) => (s ? s.slice(0, 7) : '');

export class ReviewService {
  readonly deps: ServiceDeps;
  constructor(deps: ServiceDeps) {
    this.deps = deps;
  }

  private now() {
    return (this.deps.now ?? (() => new Date()))();
  }

  private canonicalAdapter(): GitRepositoryAdapter | null {
    try {
      return new GitRepositoryAdapter(this.deps.root, this.deps.canonicalRef).open();
    } catch {
      return null;
    }
  }

  canonical(): CanonicalReviews {
    const a = this.canonicalAdapter();
    if (!a) return { available: false, ref: this.deps.canonicalRef, commit: null, states: new Map(), error: `The canonical ref ${this.deps.canonicalRef} cannot be read. Run a fetch, or set STUDIO_CANONICAL_REF.` };
    return { available: true, ref: this.deps.canonicalRef, commit: a.commit, states: loadReviewStates(a), error: null };
  }

  /** Policy comes from the canonical ref. Until it has been merged there, the local HEAD copy is used and every event says so. */
  policy(): Policy {
    const c = this.canonicalAdapter();
    const onCanonical = c?.read(POLICY_PATH);
    if (onCanonical !== undefined) return parsePolicy(onCanonical, 'canonical');
    try {
      const local = new GitRepositoryAdapter(this.deps.root, this.deps.readRef).open().read(POLICY_PATH);
      if (local !== undefined) return parsePolicy(local, 'local-head-not-canonical');
    } catch {
      /* falls through to a missing policy */
    }
    return emptyPolicy('missing', `${POLICY_PATH} is not on ${this.deps.canonicalRef} or in the working branch, so nobody can decide.`);
  }

  private revisionOf(d: NormalizedDecision, s: ReviewState, open: Proposal | null): string {
    return sha256(canonicalJson({ h: d.contentHash, head: s.headHash, phase: s.phase, open: open?.id ?? null })).slice(0, 32);
  }

  view(d: NormalizedDecision, user: VerifiedUser | null, canonical: CanonicalReviews = this.canonical(), policy: Policy = this.policy()): ReviewView {
    const state = canonical.states.get(d.id) ?? emptyState(d.id);
    const open = this.deps.store.openFor(d.id);
    const avail = availability(d, state);
    const actions = avail.map((a) => {
      if (!user) return { ...a, authorised: null, authReason: 'Sign in to act.' };
      if (!a.allowed) return { ...a, authorised: null, authReason: null };
      const auth = authorise({ login: user.login, githubId: user.id }, a.action, d, policy);
      return { ...a, authorised: auth.ok, authReason: auth.ok ? null : auth.reason ?? null };
    });
    return {
      decisionId: d.id,
      revision: this.revisionOf(d, state, open),
      canonical: { ref: canonical.ref, commit: canonical.commit, available: canonical.available, error: canonical.error, state },
      open,
      recent: this.deps.store.forDecision(d.id).filter((p) => !isOpen(p.state)).slice(-5).reverse(),
      actions,
      policy: { source: policy.source, configured: policy.people.length > 0, problems: policy.problems },
      user: user ? { login: user.login, name: user.name, roles: rolesHeld({ login: user.login, githubId: user.id }, policy), listed: isListed({ login: user.login, githubId: user.id }, policy) } : null,
    };
  }

  private audit(user: VerifiedUser | null, d: string | null, action: string, outcome: Parameters<ReviewStore['audit']>[0]['outcome'], code: string | null, detail: string | null, proposalId: string | null = null) {
    this.deps.store.audit({ at: this.now().toISOString(), actor: user?.login ?? null, decisionId: d, action, outcome, code, detail: detail?.slice(0, 300) ?? null, proposalId });
  }

  /** Record a refusal in the audit log and throw it. */
  private refuse(user: VerifiedUser | null, d: NormalizedDecision | null, action: string, outcome: 'denied' | 'stale' | 'invalid', e: ServiceError): never {
    this.audit(user, d?.id ?? null, action, outcome, e.code, e.message);
    throw e;
  }

  async submit(user: VerifiedUser | null, d: NormalizedDecision, req: Partial<ActionRequest>): Promise<{ proposal: Proposal; duplicate: boolean }> {
    const action = String(req.action ?? '');
    if (!user) this.refuse(null, d, action, 'denied', new ServiceError(401, 'unauthenticated', 'Sign in first. Every action needs a verified GitHub identity.'));
    // Re-verify against GitHub at the moment of acting, so a switched account or a revoked login cannot ride on an old session.
    let current: VerifiedUser;
    try {
      current = await this.deps.identity.verify();
    } catch (e) {
      return this.refuse(user, d, action, 'denied', new ServiceError(401, 'identity-unverified', e instanceof Error ? e.message : 'GitHub could not confirm your identity.'));
    }
    if (current.id !== user!.id || current.login.toLowerCase() !== user!.login.toLowerCase()) {
      this.refuse(user, d, action, 'denied', new ServiceError(401, 'identity-changed', `The GitHub account on this computer is now ${current.login}, not ${user!.login}. Sign in again.`));
    }
    return withLock(`decision:${d.id}`, async () => {
      const v = validateRequest(req, d);
      if (!v.ok) return this.refuse(current, d, action, 'invalid', new ServiceError(400, 'invalid', v.message));
      const a = req.action as ActionKind;
      const canonical = this.canonical();
      if (!canonical.available) return this.refuse(current, d, a, 'invalid', new ServiceError(503, 'canonical-unavailable', canonical.error ?? 'The canonical branch cannot be read.'));
      const policy = this.policy();
      const auth = authorise({ login: current.login, githubId: current.id }, a, d, policy);
      if (!auth.ok) return this.refuse(current, d, a, 'denied', new ServiceError(403, auth.code ?? 'forbidden', auth.reason ?? 'Not permitted.'));

      // A retry of the same submission returns what it already created, however the revision has moved since.
      const prior = this.deps.store.byKey(d.id, req.idempotencyKey!);
      if (prior) {
        this.audit(current, d.id, a, 'duplicate', 'duplicate-submission', `Returned ${prior.id}`, prior.id);
        return { proposal: prior, duplicate: true };
      }

      const state = canonical.states.get(d.id) ?? emptyState(d.id);
      const open = this.deps.store.openFor(d.id);
      const revision = this.revisionOf(d, state, open);
      if (req.expectedRevision !== revision) {
        return this.refuse(current, d, a, 'stale', new ServiceError(409, 'stale-revision', 'This decision changed after you opened it. Reload to see the current state, then decide again.', { currentRevision: revision }));
      }
      if (open) return this.refuse(current, d, a, 'stale', new ServiceError(409, 'proposal-open', `A change to ${d.id} is already in flight (${open.id}, ${open.state}). One change at a time.`, { proposalId: open.id }));
      const av = availability(d, state).find((x) => x.action === a);
      if (!av?.allowed) return this.refuse(current, d, a, 'denied', new ServiceError(409, 'not-allowed', av?.reason ?? 'This action is not allowed now.'));

      const seq = state.events.length + 1;
      const body = {
        schema: 'greenfuel.decision-review-event/v1' as const,
        id: eventId(d.id, seq),
        decisionId: d.id,
        seq,
        action: a,
        actor: { login: current.login, githubId: current.id, name: current.name, verifiedBy: current.verifiedBy },
        createdAt: this.now().toISOString(),
        basis: { recordHash: d.contentHash, sourceStatus: sourceStatusOf(d), sourceCommit: d.source.commit },
        prevHash: state.headHash,
        option: v.value.option,
        conditions: v.value.conditions,
        rationale: v.value.rationale,
        comment: v.value.comment,
        roleCheck: auth.roleCheck,
      };
      const event: ReviewEvent = { ...body, eventHash: hashEvent(body) };
      const legal = applyEvent(state, event);
      if ('error' in legal) return this.refuse(current, d, a, 'denied', new ServiceError(409, 'not-allowed', legal.error));

      const t = this.now();
      const stamp = t.toISOString().replace(/\D/g, '').slice(0, 14);
      const proposal: Proposal = {
        id: `P-${stamp}-${crypto.randomBytes(3).toString('hex')}`,
        decisionId: d.id,
        action: a,
        idempotencyKey: req.idempotencyKey!,
        submittedBy: current.login,
        event,
        state: 'locally-submitted',
        branch: `decision-review/${d.id}/${String(seq).padStart(4, '0')}-${a}-${sha256(req.idempotencyKey!).slice(0, 8)}`,
        baseSha: null,
        headSha: null,
        prNumber: null,
        prUrl: null,
        attempts: 0,
        lastError: null,
        history: [{ at: t.toISOString(), state: 'locally-submitted', note: `${ACTION_LABEL[a]} saved in the Studio. Nothing has been sent to GitHub.` }],
        createdAt: t.toISOString(),
        updatedAt: t.toISOString(),
      };
      this.deps.store.save(proposal);
      this.audit(current, d.id, a, 'accepted', null, `Recorded ${event.id} as ${proposal.id}`, proposal.id);
      return { proposal, duplicate: false };
    });
  }

  private move(p: Proposal, state: ProposalState, note: string, patch: Partial<Proposal> = {}): Proposal {
    const at = this.now().toISOString();
    if (p.state === state) return this.deps.store.save({ ...p, ...patch, updatedAt: at });
    return this.deps.store.transition(p, state, note, at, patch);
  }

  private fail(p: Proposal, e: unknown): Proposal {
    const retryable = e instanceof PublishError || e instanceof GitHubError ? e.retryable : true;
    const code = e instanceof PublishError ? e.code : e instanceof GitHubError ? 'GITHUB_ERROR' : 'UNEXPECTED';
    const message = e instanceof Error ? e.message : 'Unexpected error.';
    const lastError = { code, message, retryable, at: this.now().toISOString() };
    this.audit(null, p.decisionId, p.action, 'sync', code, message, p.id);
    if (retryable) return this.move(p, p.state === 'locally-submitted' ? 'awaiting-github-update' : p.state, `Could not reach GitHub: ${message}`, { lastError, attempts: p.attempts + 1 });
    return this.move(p, 'failed', message, { lastError, attempts: p.attempts + 1 });
  }

  /** Move a proposal as far as it can go. Safe to call repeatedly: every step checks what already happened. */
  async sync(proposalId: string): Promise<Proposal> {
    const first = this.deps.store.get(proposalId);
    if (!first) throw new ServiceError(404, 'not-found', 'No such proposal.');
    return withLock(`decision:${first.decisionId}`, async () => {
      let p = this.deps.store.get(proposalId)!;
      if (!isOpen(p.state)) return p;
      const split = splitCanonicalRef(this.deps.canonicalRef);
      if (!split) return this.move(p, 'failed', 'The canonical ref is not remote/branch.', { lastError: { code: 'BAD_CONFIG', message: `${this.deps.canonicalRef} is not a remote/branch reference.`, retryable: false, at: this.now().toISOString() } });
      const e = p.event;
      try {
        if (p.state === 'locally-submitted') p = this.move(p, 'awaiting-github-update', 'Sending to GitHub.');
        this.deps.publisher.fetchCanonical(this.deps.canonicalRef);
        const adapter = new GitRepositoryAdapter(this.deps.root, this.deps.canonicalRef).open();
        const states = loadReviewStates(adapter);
        const st = states.get(e.decisionId) ?? emptyState(e.decisionId);
        const file = eventPath(e.decisionId, e.seq, e.action);

        const onMain = adapter.read(file);
        if (onMain !== undefined) {
          const parsed = parseEvent(onMain);
          if ('event' in parsed && parsed.event.eventHash === e.eventHash && st.events.some((x) => x.eventHash === e.eventHash)) {
            this.audit(null, e.decisionId, e.action, 'sync', 'applied', `${e.id} verified on ${this.deps.canonicalRef} at ${short(adapter.commit)}`, p.id);
            return this.move(p, 'applied', `Merged and verified on ${this.deps.canonicalRef} at ${short(adapter.commit)}.`, { lastError: null });
          }
          return this.move(p, 'conflicted', `Another review event with sequence ${e.seq} is on ${this.deps.canonicalRef}.`, { lastError: { code: 'SEQUENCE_TAKEN', message: 'A different review event already occupies this position on the canonical branch. Reload and decide again.', retryable: false, at: this.now().toISOString() } });
        }
        if (st.events.length + 1 !== e.seq || st.headHash !== e.prevHash) {
          return this.move(p, 'conflicted', 'The canonical branch moved after this was submitted.', { lastError: { code: 'CANONICAL_MOVED', message: 'The decision changed on the canonical branch after you submitted. Reload and decide again.', retryable: false, at: this.now().toISOString() } });
        }

        if (!p.prNumber) {
          if (!p.headSha) {
            const sha = this.deps.publisher.buildCommit({
              baseSha: adapter.commit,
              files: [{ path: file, content: serializeEvent(e) }],
              author: { name: e.actor.name ?? e.actor.login, email: `${e.actor.githubId}+${e.actor.login}@users.noreply.github.com` },
              message: `Decision review: ${e.decisionId} ${ACTION_LABEL[e.action]}\n\nRecorded through the Architecture Studio by ${e.actor.login}. Event ${e.id}, hash ${e.eventHash}.`,
              now: this.now(),
            });
            p = this.move(p, 'awaiting-github-update', 'Commit prepared on top of the canonical branch.', { baseSha: adapter.commit, headSha: sha });
          }
          const remoteSha = this.deps.publisher.remoteBranchSha(split.remote, p.branch);
          if (remoteSha === null) this.deps.publisher.push(split.remote, p.headSha!, p.branch);
          else if (remoteSha !== p.headSha) throw new PublishError('BRANCH_EXISTS_DIFFERENT', `Branch ${p.branch} already exists on GitHub with different content.`, false);
          const existing = await this.deps.github.findByHead(p.branch);
          const pr = existing ?? (await this.deps.github.createPullRequest({ base: split.branch, head: p.branch, title: `Decision review: ${e.decisionId}, ${ACTION_LABEL[e.action]} (${e.actor.login})`, body: pullRequestBody(e, this.deps.canonicalRef) }));
          p = this.move(p, 'pull-request-created', `Pull request #${pr.number} opened.`, { prNumber: pr.number, prUrl: pr.url, lastError: null });
          if (pr.state === 'closed') return this.move(p, 'failed', 'The pull request was closed without merging.', { lastError: { code: 'PR_CLOSED', message: 'The pull request was closed without merging. Submit again if you still want this decision.', retryable: false, at: this.now().toISOString() } });
          return p;
        }

        const pr = await this.deps.github.get(p.prNumber);
        if (pr.state === 'closed') return this.move(p, 'failed', 'The pull request was closed without merging.', { lastError: { code: 'PR_CLOSED', message: 'The pull request was closed without merging. Submit again if you still want this decision.', retryable: false, at: this.now().toISOString() } });
        if (pr.state === 'merged') {
          return this.move(p, 'conflicted', 'The pull request is merged, but the event is not on the canonical branch as submitted.', { lastError: { code: 'MERGED_BUT_DIFFERENT', message: `Pull request #${pr.number} is merged, but ${file} on ${this.deps.canonicalRef} is missing or different. Investigate before deciding again.`, retryable: false, at: this.now().toISOString() } });
        }
        return this.move(p, 'awaiting-merge', `Pull request #${pr.number} is open and waiting for a person to merge it.`, { lastError: null });
      } catch (err) {
        return this.fail(p, err);
      }
    });
  }

  /** Sync every open proposal, optionally for one decision. */
  async refresh(decisionId?: string): Promise<Proposal[]> {
    const open = this.deps.store.list().filter((p) => isOpen(p.state) && (!decisionId || p.decisionId === decisionId));
    const out: Proposal[] = [];
    for (const p of open) out.push(await this.sync(p.id));
    return out;
  }
}

function pullRequestBody(e: ReviewEvent, ref: string): string {
  const lines = [
    `This pull request records a **decision request** made through the Architecture Studio. It is not a signed approval under ADR 0008.`,
    '',
    '| | |',
    '|---|---|',
    `| Decision | ${e.decisionId} |`,
    `| Action | ${ACTION_LABEL[e.action]} |`,
    `| Requested by | @${e.actor.login} (GitHub id ${e.actor.githubId}, verified by ${e.actor.verifiedBy}) |`,
    `| Option | ${e.option ? `${e.option.key}: ${e.option.name}${e.option.recommended ? ' (recommended)' : ' (not the recommended option)'}` : 'none'} |`,
    `| Roles held | ${e.roleCheck.held.join(', ') || 'none'} |`,
    `| Critical decision | ${e.roleCheck.critical ? 'yes' : 'no'} |`,
    `| Roles named by the record but not held | ${e.roleCheck.outstanding.join(', ') || 'none'} |`,
    `| Policy source | ${e.roleCheck.policySource === 'canonical' ? 'canonical branch' : '**local copy, not yet on the canonical branch**'} |`,
    `| Event | ${e.id}, hash \`${e.eventHash}\` |`,
  ];
  if (e.rationale) lines.push('', '**Rationale**', '', quote(e.rationale));
  if (e.conditions.length) lines.push('', '**Conditions**', '', ...e.conditions.map((c) => `- ${c.replace(/\n/g, ' ')}`));
  if (e.comment) lines.push('', '**Comment**', '', quote(e.comment));
  lines.push('', `Merging adds one file to \`${ref}\`. The Studio shows the decision as changed only after it verifies that file. Closing this pull request discards the request.`);
  return lines.join('\n');
}

const quote = (s: string) => s.split('\n').map((l) => `> ${l}`).join('\n');
