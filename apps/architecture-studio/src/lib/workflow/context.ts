// Read-only context for a review: diagrams, consequences and a timeline. Everything here is copied or derived from repository
// records, and says where from. Nothing is written by a model, and no consequence is invented.
import type { GitRepositoryAdapter } from '../repo/git.ts';
import type { NormalizedDecision } from '../intel/schema.ts';
import { ACTION_LABEL, eventPath, type ReviewState } from './events.ts';
import type { Proposal } from './store.ts';
import { PROPOSAL_LABEL } from './store.ts';
import { actionLabel } from './labels.ts';

export interface Diagram {
  path: string;
  line: number;
  heading: string | null;
  relation: 'in-source' | 'mentions-decision' | 'in-citing-document';
  text: string;
}

const FENCE = /^```mermaid\s*$/;

/** Mermaid diagrams in the decision's own file, and in documents that cite it. Shown as source: no renderer is an approved dependency. */
export function findDiagrams(adapter: GitRepositoryAdapter, d: NormalizedDecision, limit = 4): Diagram[] {
  const files = [d.source.path, ...d.citedBy.filter((p) => p.endsWith('.md') && p !== d.source.path)].slice(0, 15);
  adapter.preload(files.filter((p) => adapter.has(p)));
  const found: Diagram[] = [];
  for (const path of files) {
    const text = adapter.read(path);
    if (!text) continue;
    const lines = text.split('\n');
    let heading: string | null = null;
    for (let i = 0; i < lines.length; i++) {
      const h = /^#{1,4}\s+(.*)$/.exec(lines[i]!);
      if (h) heading = h[1]!.trim();
      if (!FENCE.test(lines[i]!.trim())) continue;
      let j = i + 1;
      while (j < lines.length && !lines[j]!.trim().startsWith('```')) j++;
      const block = lines.slice(i + 1, j).join('\n');
      const mentions = block.includes(d.id) || (heading ?? '').includes(d.id);
      found.push({ path, line: i + 1, heading, relation: path === d.source.path ? 'in-source' : mentions ? 'mentions-decision' : 'in-citing-document', text: block.slice(0, 3000) });
      i = j;
    }
  }
  const rank = { 'mentions-decision': 0, 'in-source': 1, 'in-citing-document': 2 } as const;
  return found.sort((a, b) => rank[a.relation] - rank[b.relation]).slice(0, limit);
}

export interface ConsequenceLine {
  text: string;
  ids?: string[];
  src?: { path: string; line: number };
}

export interface Consequences {
  ifApproved: ConsequenceLine[];
  ifRejected: ConsequenceLine[];
  always: ConsequenceLine[];
}

const list = (a: string[], n = 8) => (a.length > n ? `${a.slice(0, n).join(', ')} and ${a.length - n} more` : a.join(', '));

export function consequencesOf(d: NormalizedDecision, byId: Map<string, NormalizedDecision>): Consequences {
  const dependents = d.dependedOnBy.filter((x) => byId.has(x));
  const open = dependents.filter((x) => byId.get(x)!.status !== 'Approved');
  const reqs = d.blockingRequirements.map((r) => r.id);
  const rec = d.recommendedOption;
  const ifApproved: ConsequenceLine[] = [];
  const ifRejected: ConsequenceLine[] = [];
  if (rec?.cons.length) for (const c of rec.cons.slice(0, 3)) ifApproved.push({ text: `Recorded weakness of the recommended option: ${c.text}`, src: c.src });
  for (const [k, label] of [['cost', 'Cost'], ['security', 'Security'], ['reliability', 'Reliability'], ['dataSovereignty', 'Data sovereignty'], ['operational', 'Operational']] as const) {
    const imp = d.implications[k];
    if (imp) ifApproved.push({ text: `${label} implication recorded in the source: ${imp.text.slice(0, 220)}`, src: { path: imp.src.path, line: imp.src.line } });
  }
  if (open.length) ifApproved.push({ text: `${open.length} decision(s) cite this one and are still undecided. Approving it does not decide them: ${list(open)}.`, ids: open });
  if (reqs.length) ifApproved.push({ text: `${reqs.length} requirement(s) wait on this decision: ${list(reqs)}. Their status is not changed automatically.`, ids: reqs });
  if (d.relatedTasks.length) ifApproved.push({ text: `Related task(s): ${list(d.relatedTasks)}.`, ids: d.relatedTasks });
  if (dependents.length) ifRejected.push({ text: `${dependents.length} decision(s) cite this one and would need re-examination: ${list(dependents)}.`, ids: dependents });
  if (reqs.length) ifRejected.push({ text: `${reqs.length} requirement(s) stay blocked until another option is chosen: ${list(reqs)}.`, ids: reqs });
  if (d.options.length > 1) ifRejected.push({ text: `${d.options.length - 1} other option(s) remain on record and can be selected later by reopening the decision.` });
  if (!ifRejected.length) ifRejected.push({ text: 'No dependent decision, requirement or task is recorded against this decision.' });
  if (!ifApproved.length) ifApproved.push({ text: 'No consequence beyond the decision itself is recorded in the sources.' });
  return {
    ifApproved,
    ifRejected,
    always: [
      { text: 'Nothing changes on the canonical branch until a person merges the pull request. Until then the decision keeps its current status.' },
      { text: 'No downstream decision, requirement or task is changed by this action.' },
      { text: 'A decision recorded here is a repository record, not a signed approval under ADR 0008. The ADR file itself is not edited.' },
    ],
  };
}

export interface TimelineEntry {
  at: string | null;
  kind: 'review-event' | 'proposal' | 'source-approval' | 'source-commit';
  title: string;
  detail: string | null;
  actor: string | null;
  tone: 'accepted' | 'blocked' | 'open' | 'neutral';
  ref: { path: string; line?: number } | null;
  sha?: string;
  /** For a review record: the commit on the canonical branch that carries it, and the pull request that brought it, where this Studio opened one. */
  carriedBy?: { sha: string; date: string; subject: string; pullRequest: { number: number; url: string | null } | null };
}

const TONE: Record<string, TimelineEntry['tone']> = { approve: 'accepted', 'approve-alternative': 'accepted', 'approve-with-conditions': 'accepted', reject: 'blocked', 'request-revision': 'open', defer: 'neutral', comment: 'neutral', reopen: 'open' };

export function timelineOf(d: NormalizedDecision, state: ReviewState, proposals: Proposal[], commits: { sha: string; date: string; author: string; subject: string }[], eventCommits: Record<string, { sha: string; date: string; subject: string }> = {}): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const e of state.events) {
    const path = eventPath(e.decisionId, e.seq, e.action);
    const c = eventCommits[path];
    const prop = proposals.find((p) => p.state === 'applied' && (p.event as { eventHash?: string }).eventHash === e.eventHash);
    out.push({
      carriedBy: c ? { sha: c.sha, date: c.date, subject: c.subject, pullRequest: prop?.prNumber ? { number: prop.prNumber, url: prop.prUrl } : null } : undefined, at: e.createdAt, kind: 'review-event', title: ACTION_LABEL[e.action] + (e.option ? ` (option ${e.option.key})` : ''), detail: [e.rationale, e.comment, ...e.conditions.map((c) => `Condition: ${c}`)].filter(Boolean).join('\n') || null, actor: `@${e.actor.login}`, tone: TONE[e.action] ?? 'neutral', ref: { path } });
  }
  for (const p of proposals) {
    if (p.state === 'applied') continue;
    out.push({ at: p.updatedAt, kind: 'proposal', title: `${actionLabel(p.action)}: ${PROPOSAL_LABEL[p.state]}`, detail: p.lastError?.message ?? p.history[p.history.length - 1]?.note ?? null, actor: `@${p.submittedBy}`, tone: p.state === 'failed' || p.state === 'conflicted' ? 'blocked' : 'open', ref: null });
  }
  for (const a of d.approvalHistory) {
    if (a.type === 'review-event') continue;
    out.push({ at: a.date, kind: 'source-approval', title: a.type === 'status-line' ? 'Status line in the source' : a.type === 'signed-approval' ? 'Signed approval record' : 'Owner log', detail: a.text, actor: a.actor, tone: 'neutral', ref: a.src });
  }
  for (const c of commits) out.push({ at: c.date, kind: 'source-commit', title: c.subject, detail: null, actor: c.author, tone: 'neutral', ref: { path: d.source.path }, sha: c.sha });
  return out.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
}
