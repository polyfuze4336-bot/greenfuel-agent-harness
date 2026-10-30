// The pull-request pipeline shared by decision reviews and work items.
// It moves one proposal as far as it can go, and every step checks what already happened, so it is safe to call again:
//   locally submitted -> build one commit on the canonical branch -> push a NEW branch -> open a pull request
//   -> wait for a person to merge it -> verify the merged file, its hash and its chain on the canonical branch -> applied.
// It never pushes to the canonical branch, never forces, and never trusts a merge it has not verified.
import { GitRepositoryAdapter } from '../repo/git.ts';
import { GitHubError, type GitHubPort } from './github.ts';
import { describeValidation } from './labels.ts';
import { PublishError, splitCanonicalRef, type Publisher } from './publish.ts';
import { ReviewStore, isOpen, type AuditFacts, type Proposal, type ProposalState } from './store.ts';

export interface SyncDeps {
  root: string;
  canonicalRef: string;
  store: ReviewStore;
  github: GitHubPort;
  publisher: Publisher;
  now(): Date;
  audit(p: Proposal, code: string, detail: string): void;
}

export interface Chain {
  length: number;
  head: string | null;
  hashes: string[];
}

export interface SyncFamily {
  /** Words for messages: "decision" or "work item". */
  noun: string;
  file(p: Proposal): string;
  serialize(p: Proposal): string;
  chain(adapter: GitRepositoryAdapter, p: Proposal): Chain;
  /** The hash of the event a file holds, or null if the file is not a valid, self-consistent event. */
  hashOf(text: string): string | null;
  title(p: Proposal): string;
  body(p: Proposal, ref: string): string;
  message(p: Proposal): string;
}

/** The audit facts a proposal carries at this moment. */
export function factsOf(p: Proposal): AuditFacts {
  return { oldValue: p.change?.old ?? null, newValue: p.change?.new ?? null, sourceCommit: p.sourceCommit ?? null, baseCommit: p.baseSha, resultCommit: p.resultCommit ?? p.headSha, pullRequest: p.prNumber, validation: p.validation?.state ?? null };
}

const short = (s: string | null) => (s ? s.slice(0, 7) : '');

function move(d: SyncDeps, p: Proposal, state: ProposalState, note: string, patch: Partial<Proposal> = {}): Proposal {
  const at = d.now().toISOString();
  if (p.state === state) return d.store.save({ ...p, ...patch, updatedAt: at });
  return d.store.transition(p, state, note, at, patch);
}

function failure(d: SyncDeps, p: Proposal, e: unknown): Proposal {
  const retryable = e instanceof PublishError || e instanceof GitHubError ? e.retryable : true;
  const code = e instanceof PublishError ? e.code : e instanceof GitHubError ? e.code : 'UNEXPECTED';
  const message = e instanceof Error ? e.message : 'Unexpected error.';
  const lastError = { code, message, retryable, at: d.now().toISOString() };
  d.audit(p, code, message);
  if (retryable) return move(d, p, p.state === 'locally-submitted' ? 'awaiting-github-update' : p.state, `Could not reach GitHub: ${message}`, { lastError, attempts: p.attempts + 1 });
  return move(d, p, 'failed', message, { lastError, attempts: p.attempts + 1 });
}

export async function syncProposal(d: SyncDeps, fam: SyncFamily, start: Proposal): Promise<Proposal> {
  let p = start;
  if (!isOpen(p.state)) return p;
  const split = splitCanonicalRef(d.canonicalRef);
  const err = (code: string, message: string) => ({ code, message, retryable: false, at: d.now().toISOString() });
  if (!split) return move(d, p, 'failed', 'The canonical ref is not remote/branch.', { lastError: err('BAD_CONFIG', `${d.canonicalRef} is not a remote/branch reference.`) });
  const e = p.event;
  const closed = () => {
    const n = move(d, p, 'failed', 'The pull request was closed without merging.', { lastError: err('PR_CLOSED', 'The pull request was closed without merging. Submit again if you still want this change.') });
    d.audit(n, 'pr-closed-unmerged', `Pull request #${n.prNumber} was closed without merging; nothing was applied`);
    return n;
  };
  try {
    if (p.state === 'locally-submitted') p = move(d, p, 'awaiting-github-update', 'Sending to GitHub.');
    await d.publisher.fetchCanonical(d.canonicalRef);
    const adapter = new GitRepositoryAdapter(d.root, d.canonicalRef).open();
    const chain = fam.chain(adapter, p);
    const file = fam.file(p);

    const onMain = adapter.read(file);
    if (onMain !== undefined) {
      const h = fam.hashOf(onMain);
      if (h !== null && h === e.eventHash && chain.hashes.includes(e.eventHash)) {
        const introduced = adapter.log(1, [file])[0]?.sha ?? adapter.commit;
        const n = move(d, p, 'applied', `Merged and verified on ${d.canonicalRef} at ${short(adapter.commit)}.`, { lastError: null, resultCommit: introduced });
        d.audit(n, 'applied', `${e.id} verified on ${d.canonicalRef} at ${short(adapter.commit)} (introduced by ${short(introduced)})`);
        return n;
      }
      const n = move(d, p, 'conflicted', `Another event with sequence ${e.seq} is on ${d.canonicalRef}.`, { lastError: err('SEQUENCE_TAKEN', `A different event already occupies this position on the canonical branch. Reload and act again.`) });
      d.audit(n, 'conflicted', `Another event already occupies sequence ${e.seq} on ${d.canonicalRef}`);
      return n;
    }
    if (chain.length + 1 !== e.seq || chain.head !== e.prevHash) {
      const n = move(d, p, 'conflicted', 'The canonical branch moved after this was submitted.', { lastError: err('CANONICAL_MOVED', `The ${fam.noun} changed on the canonical branch after you submitted. Reload and act again.`) });
      d.audit(n, 'conflicted', `The ${fam.noun} changed on ${d.canonicalRef} (now at ${short(adapter.commit)}) after this was submitted; nothing was written`);
      return n;
    }

    if (!p.prNumber) {
      if (!p.headSha) {
        const sha = await d.publisher.buildCommit({
          baseSha: adapter.commit,
          files: [{ path: file, content: fam.serialize(p) }],
          author: { name: e.actor.name ?? e.actor.login, email: `${e.actor.githubId}+${e.actor.login}@users.noreply.github.com` },
          message: fam.message(p),
          now: d.now(),
        });
        p = move(d, p, 'awaiting-github-update', 'Commit prepared on top of the canonical branch.', { baseSha: adapter.commit, headSha: sha, resultCommit: sha });
      }
      const remoteSha = await d.publisher.remoteBranchSha(split.remote, p.branch);
      if (remoteSha === null) await d.publisher.push(split.remote, p.headSha!, p.branch);
      else if (remoteSha !== p.headSha) throw new PublishError('BRANCH_EXISTS_DIFFERENT', `Branch ${p.branch} already exists on GitHub with different content.`, false);
      const existing = await d.github.findByHead(p.branch);
      const pr = existing ?? (await d.github.createPullRequest({ base: split.branch, head: p.branch, title: fam.title(p), body: fam.body(p, d.canonicalRef) }));
      p = move(d, p, 'pull-request-created', `Pull request #${pr.number} opened.`, { prNumber: pr.number, prUrl: pr.url, lastError: null });
      d.audit(p, 'pull-request-created', `Pull request #${pr.number} opened from ${p.branch} on top of ${short(p.baseSha)}`);
      if (pr.state === 'closed') return closed();
      return p;
    }

    const pr = await d.github.get(p.prNumber);
    if (pr.state === 'closed') return closed();
    if (pr.state === 'merged') {
      const n = move(d, p, 'conflicted', 'The pull request is merged, but the event is not on the canonical branch as submitted.', { lastError: err('MERGED_BUT_DIFFERENT', `Pull request #${pr.number} is merged, but ${file} on ${d.canonicalRef} is missing or different. Investigate before acting again.`), resultCommit: pr.mergeCommitSha ?? p.resultCommit ?? null });
      d.audit(n, 'conflicted', `Pull request #${pr.number} merged but ${file} is missing or different on ${d.canonicalRef}`);
      return n;
    }
    // Still open: report what GitHub says about the checks and reviews. The Studio never merges and never waives a check.
    const before = p.validation?.state ?? null;
    const v = pr.validation ?? null;
    const n = move(d, p, 'awaiting-merge', `Pull request #${pr.number} is open: ${describeValidation(v)}. Waiting for a person to merge it.`, { lastError: null, validation: v });
    if (v && v.state !== before) d.audit(n, `validation-${v.state}`, `Pull request #${pr.number}: ${describeValidation(v)}`);
    return n;
  } catch (e2) {
    return failure(d, p, e2);
  }
}