'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, GitPullRequest, LogIn, OctagonAlert, RotateCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { CLASS_LABEL, KIND_LABEL, type WorkItem } from '@/lib/queue/types.ts';
import type { Dependent, Impact } from '@/lib/queue/graph.ts';
import { WORK_ACTIONS, WORK_ACTION_LABEL, PROPOSAL_LABEL, type ProposalState, type WorkAction } from '@/lib/workflow/labels.ts';
import type { WorkView } from '@/lib/workflow/work.ts';
import type { AuditEntry, Proposal } from '@/lib/workflow/store.ts';
import { utcDate } from '@/lib/format.ts';
import { SourceBlock } from '../record-bits.tsx';
import { Tracker } from '../review/review-rail.tsx';
import type { SubmitResult } from '../review/action-dialog.tsx';
import { Meta, Skeleton, Tag, btn } from '../ui.tsx';
import { api, type QueueData, type SessionInfo } from './queue-data.tsx';
import { PriorityTag, WorkStatusPill } from './work-bits.tsx';
import { WorkActionDialog } from './work-action-dialog.tsx';
import type { Conflict } from '../review/conflict-panel.tsx';

interface Detail {
  item: WorkItem;
  view: WorkView;
  dependents: (Dependent & { title: string; status: WorkItem['status'] | null })[];
  scenarios: { ifRejected: Impact; ifDeferred: Impact } | null;
  activeImpact: Impact | null;
  audit: AuditEntry[];
  /** Which signed-in account this was loaded for. What an action allows depends on it. */
  forLogin?: string | null;
}

const NOT_STATED = <span className="text-ink-3">Not stated in the source</span>;
const FLAG_TITLE: Record<string, string> = { 'marked-blocked': 'Marked blocked', clarification: 'Clarification requested', 'completion-rejected': 'Completion rejected', reopened: 'Reopened', 'unmet-prerequisite': 'States an unmet prerequisite' };

function Callout({ tone, icon: I, title, children }: { tone: 'open' | 'blocked'; icon: typeof TriangleAlert; title: string; children: React.ReactNode }) {
  return (
    <div role="note" className="mt-4 flex gap-2.5 rounded-xl px-3.5 py-2.5 text-[13.5px] leading-5" style={{ background: `var(--s-${tone}-bg)`, color: `var(--s-${tone}-fg)` }}>
      <I aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        {children}
      </div>
    </div>
  );
}

export function ItemSheet({ id, data, session, onChanged, onSignIn, onOpen }: { id: string; data: QueueData; session: SessionInfo | null; onChanged: () => void; onSignIn: () => Promise<string | null>; onOpen: (id: string) => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<WorkAction | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  const login = session?.user?.login ?? null;
  const loginRef = useRef(login);
  loginRef.current = login;

  const load = useCallback(async () => {
    setError(null);
    const forLogin = loginRef.current;
    const r = await api<Detail>(`/api/v1/queue/${encodeURIComponent(id)}`);
    if (r.ok && r.body) setDetail({ ...r.body, forLogin });
    else setError(r.body?.detail ?? `HTTP ${r.status}`);
  }, [id]);

  // What each action allows depends on who is signed in, so a change of identity discards what was loaded for the previous one.
  useEffect(() => {
    setDetail(null);
    void load();
  }, [load, login]);

  const signedIn = !!session?.authenticated;
  const item = detail?.item ?? data.items.find((i) => i.id === id) ?? null;

  if (!item) return <p role="alert">No work item {id.slice(0, 20)} in the queue.</p>;

  const submit = async (body: Record<string, unknown>): Promise<SubmitResult> => {
    const r = await api<{ proposal: Proposal; duplicate: boolean }>(`/api/v1/queue/${encodeURIComponent(id)}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-studio-csrf': session?.csrf ?? '' },
      body: JSON.stringify(body),
    });
    if (r.ok && r.body) {
      setNotice(r.body.duplicate ? 'That submission was already recorded. Nothing new was created.' : `Submitted. ${PROPOSAL_LABEL[r.body.proposal.state as ProposalState]}.`);
      void load();
      onChanged();
    }
    return { ok: r.ok, status: r.status, code: r.body?.code, detail: r.body?.detail, proposal: r.body?.proposal, duplicate: r.body?.duplicate, currentRevision: (r.body as { currentRevision?: string } | null)?.currentRevision, conflict: (r.body as { conflict?: Conflict } | null)?.conflict };
  };

  const check = async (p: Proposal) => {
    setBusy(true);
    const r = await api<{ proposal: Proposal }>(`/api/v1/review/proposals/${p.id}/sync`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-csrf': session?.csrf ?? '' }, body: '{}' });
    setBusy(false);
    setNotice(r.ok && r.body ? `${PROPOSAL_LABEL[r.body.proposal.state as ProposalState]}.` : (r.body?.detail ?? 'Could not check GitHub.'));
    void load();
    onChanged();
  };

  const v = detail && detail.forLogin === login ? detail.view : undefined;
  const open = v?.open ?? null;
  const reasonFor = (a: WorkAction): string | null => {
    const x = v?.actions.find((y) => y.action === a);
    if (!x) return null;
    if (!signedIn) return 'Sign in to act.';
    if (open) return 'A change to this item is already in flight.';
    if (!x.allowed) return x.reason;
    if (x.authorised === false) return x.authReason;
    return null;
  };
  const usable = (a: WorkAction) => !!v && !reasonFor(a);

  const requires = item.links.filter((l) => l.type === 'requires');
  const references = item.links.filter((l) => l.type === 'references');
  const known = new Set(data.items.map((i) => i.id));
  const idButton = (x: string) =>
    known.has(x) ? (
      <button key={x} type="button" onClick={() => onOpen(x)} className="rounded-md border border-hairline bg-surface-2 px-1.5 py-px font-mono text-[11.5px] leading-5 text-ink-2 hover:bg-hairline/60">
        {x}
      </button>
    ) : (
      <Tag key={x}>{x}</Tag>
    );
  const dependents = (detail?.dependents ?? []).filter((d) => d.type === 'requires');
  const mentioned = (detail?.dependents ?? []).filter((d) => d.type === 'references');

  return (
    <article data-testid="item-detail" aria-label={`${item.id} ${item.title}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Tag>{item.id}</Tag>
        <WorkStatusPill status={item.status} />
        <PriorityTag priority={item.priority} />
        <span className="text-[12.5px] text-ink-3">
          {KIND_LABEL[item.kind]} · {CLASS_LABEL[item.class]}
        </span>
        {item.blocksBuild ? (
          <span className="rounded-md bg-[var(--s-blocked-bg)] px-1.5 py-px text-[11.5px] font-semibold text-[var(--s-blocked-fg)]">Blocks the build</span>
        ) : null}
      </div>
      <h2 className="text-[19px] leading-[1.3] font-semibold">{item.title}</h2>
      {item.description && item.description !== item.title ? <p className="mt-3 text-[14px] leading-6 text-ink-2">{item.description}</p> : null}

      {item.derivedBlocks.map((b) => (
        <Callout key={`${b.by}${b.reason}`} tone="blocked" icon={OctagonAlert} title="Blocked by a deferred critical decision">
          <p>{b.reason}</p>
        </Callout>
      ))}
      {item.reviewNeeded.map((b) => (
        <Callout key={`${b.by}${b.reason}`} tone="open" icon={TriangleAlert} title="Flagged for review">
          <p>{b.reason}</p>
        </Callout>
      ))}
      {item.flags.map((f) => (
        <Callout key={f.code + f.text} tone="open" icon={TriangleAlert} title={FLAG_TITLE[f.code] ?? 'Needs a person to confirm'}>
          <p>{f.text}</p>
        </Callout>
      ))}

      <section className="mt-6" aria-labelledby="wk-actions">
        <h3 id="wk-actions" className="mb-2 text-[13px] font-semibold text-ink-2">
          Actions
        </h3>
        {error ? (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-hairline p-3 text-[13.5px] text-[var(--s-rejected-fg)]">
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <div>
              <p>{error}</p>
              <button type="button" className={`${btn} mt-2`} onClick={() => void load()}>
                <RotateCw aria-hidden className="size-3.5" />
                Retry
              </button>
            </div>
          </div>
        ) : !v ? (
          <div role="status" aria-busy="true" aria-label="Loading actions" className="space-y-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : (
          <>
            {signedIn && session?.user ? (
              <p data-testid="identity" className="mb-2 flex items-center gap-2 text-[13px] text-ink-2">
                <ShieldCheck aria-hidden className="size-4 text-[var(--s-accepted-fg)]" />
                Acting as <strong>@{session.user.login}</strong>
                {session.user.roles.length ? ` · ${session.user.roles.join(', ')}` : ' · no role (read only)'}
              </p>
            ) : (
              <div className="mb-2">
                <button
                  type="button"
                  data-testid="sign-in"
                  className={btn}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setSignInError(await onSignIn());
                    setBusy(false);
                  }}
                >
                  <LogIn aria-hidden className="size-3.5" />
                  {session?.mode === 'entra' ? 'Sign in with Microsoft' : 'Sign in with GitHub'}
                </button>
                <p className="mt-1.5 text-[12.5px] text-ink-3">Every action needs a verified identity. Your role is checked on the server.</p>
                {signInError ? (
                  <p role="alert" className="mt-1.5 text-[12.5px] text-[var(--s-rejected-fg)]">
                    {signInError}
                  </p>
                ) : null}
              </div>
            )}
            <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Actions on this item">
              {WORK_ACTIONS.map((a) => {
                const ok = usable(a);
                const why = reasonFor(a);
                return (
                  <li key={a}>
                    <button
                      type="button"
                      data-testid={`work-${a}`}
                      aria-disabled={!ok}
                      title={ok ? undefined : (why ?? undefined)}
                      onClick={() => (ok ? setDialog(a) : setNotice(`${WORK_ACTION_LABEL[a]} is unavailable: ${why ?? 'not allowed now'}`))}
                      className={`flex w-full items-center rounded-lg border px-3 py-2 text-left text-[13.5px] font-medium transition-colors ${ok ? 'border-hairline-strong bg-surface hover:bg-surface-2' : 'cursor-not-allowed border-hairline bg-surface-2 text-ink-3'}`}
                    >
                      {WORK_ACTION_LABEL[a]}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p role="status" aria-live="polite" data-testid="work-notice" className="mt-2 min-h-5 text-[12.5px] leading-5 text-ink-2">
              {notice}
            </p>
            {open ? <Tracker p={open} busy={busy} subject="item" onCheck={() => void check(open)} /> : null}
            {!open && v.recent[0] && (v.recent[0].state === 'failed' || v.recent[0].state === 'conflicted') ? <Tracker p={v.recent[0]} busy={busy} subject="item" onCheck={() => undefined} /> : null}
            {item.kind === 'decision' ? (
              <p className="mt-2 text-[12.5px] text-ink-3">
                Decisions are decided one at a time in the review workflow.{' '}
                <Link href={`/decisions/${item.id}/review`} className="font-medium text-accent hover:underline">
                  Open the review
                </Link>
              </p>
            ) : null}
          </>
        )}
      </section>

      <dl className="mt-6 grid grid-cols-1 gap-4">
        <Meta label="Status">
          <span data-testid="field-status">{item.status}</span>
          {item.sourceStatus && item.sourceStatus !== item.status ? <span className="text-ink-3"> · the source says “{item.sourceStatus}”</span> : null}
          <span className="mt-0.5 block text-[12.5px] text-ink-3">{item.statusBasis}</span>
        </Meta>
        <Meta label="Priority">
          {item.priority ?? NOT_STATED}
          {item.priorityBasis ? <span className="mt-0.5 block text-[12.5px] text-ink-3">{item.priorityBasis}</span> : null}
        </Meta>
        <Meta label="Owner">
          {item.assignee ? (
            <span>
              @{item.assignee} <span className="text-ink-3">(assigned through a merged record)</span>
            </span>
          ) : item.ownerText ? (
            <span>
              {item.ownerText} <span className="text-ink-3">(from the source; nobody is assigned)</span>
            </span>
          ) : (
            NOT_STATED
          )}
        </Meta>
        <Meta label="Due date">{item.dueDate ?? <span className="text-ink-3">None. No source or merged record states a due date, and the Studio does not invent one.</span>}</Meta>
        <Meta label="Acceptance criteria">{item.acceptance ?? NOT_STATED}</Meta>
        <Meta label="Evidence required">{item.evidenceRequired ?? NOT_STATED}</Meta>
        <Meta label="Completion evidence">
          {item.completionEvidence.length ? (
            <ul className="space-y-1">
              {item.completionEvidence.map((e) => (
                <li key={e.ref} className="text-[13.5px]">
                  <span className="font-mono">{e.ref}</span> <span className="text-ink-3">· {e.valid ? 'resolves in the repository' : 'does not resolve or the run failed'}{e.note ? ` · ${e.note}` : ''}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-ink-3">None. This item is not shown as done without it.</span>
          )}
        </Meta>
        <Meta label="Related decisions">{item.relatedDecisions.length ? <span className="flex flex-wrap gap-1.5">{item.relatedDecisions.map(idButton)}</span> : <span className="text-ink-3">None stated</span>}</Meta>
        <Meta label="Related requirements">{item.relatedRequirements.length ? <span className="flex flex-wrap gap-1.5">{item.relatedRequirements.map((r) => <Tag key={r}>{r}</Tag>)}</span> : <span className="text-ink-3">None stated</span>}</Meta>
        {item.relatedRisks.length ? <Meta label="Related risks"><span className="flex flex-wrap gap-1.5">{item.relatedRisks.map(idButton)}</span></Meta> : null}
        {item.rubricCriteria.length ? <Meta label="Capstone rubric criteria"><span className="flex flex-wrap gap-1.5">{item.rubricCriteria.map(idButton)}</span></Meta> : null}
      </dl>

      <section className="mt-6" aria-labelledby="wk-deps">
        <h3 id="wk-deps" className="mb-2 text-[13px] font-semibold text-ink-2">
          Dependencies
        </h3>
        {requires.length === 0 && references.length === 0 ? <p className="text-[13.5px] text-ink-3">No source states a dependency for this item.</p> : null}
        {requires.length ? (
          <div className="mb-3">
            <p className="mb-1 text-[12.5px] text-ink-3">Requires (a source says these come first)</p>
            <ul className="space-y-1.5">
              {requires.map((l) => (
                <li key={l.id} className="flex flex-wrap items-baseline gap-2 text-[13.5px]">
                  {idButton(l.id)}
                  <span className="text-ink-3">{l.basis}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {references.length ? (
          <div>
            <p className="mb-1 text-[12.5px] text-ink-3">Mentions (shown, but nothing follows from a mention)</p>
            <span className="flex flex-wrap gap-1.5">{references.map((l) => idButton(l.id))}</span>
          </div>
        ) : null}
        {dependents.length ? (
          <div className="mt-3" data-testid="dependents">
            <p className="mb-1 text-[12.5px] text-ink-3">Needed by ({dependents.length}, directly or through others)</p>
            <ul className="space-y-1">
              {dependents.slice(0, 12).map((d) => (
                <li key={d.id} className="flex flex-wrap items-baseline gap-2 text-[13.5px]">
                  {idButton(d.id)}
                  <span className="clamp-1 text-ink-2">{d.title}</span>
                  <span className="text-[12px] text-ink-3">{d.depth > 1 ? `${d.depth} steps away` : 'direct'}</span>
                </li>
              ))}
            </ul>
            {dependents.length > 12 ? <p className="mt-1 text-[12.5px] text-ink-3">and {dependents.length - 12} more</p> : null}
          </div>
        ) : null}
        {mentioned.length ? (
          <div className="mt-3">
            <p className="mb-1 text-[12.5px] text-ink-3">Mentioned by</p>
            <span className="flex flex-wrap gap-1.5">{mentioned.map((d) => idButton(d.id))}</span>
          </div>
        ) : null}
      </section>

      {detail?.scenarios ? <Scenarios status={item.status} s={detail.scenarios} active={detail.activeImpact} idButton={idButton} /> : null}

      <section className="mt-6" aria-labelledby="wk-history">
        <h3 id="wk-history" className="mb-2 text-[13px] font-semibold text-ink-2">
          History in the repository
        </h3>
        {v && v.canonical.state.events.length ? (
          <ol className="space-y-2.5" data-testid="work-timeline">
            {v.canonical.state.events.map((e) => (
              <li key={e.id} className="rounded-xl border border-hairline p-3 text-[13.5px]">
                <p className="font-medium">
                  {WORK_ACTION_LABEL[e.action]} <span className="font-normal text-ink-3">· @{e.actor.login} · {utcDate(e.createdAt)}</span>
                </p>
                {e.assignee ? <p className="text-ink-2">Assigned to @{e.assignee}{e.dueDate ? `, due ${e.dueDate}` : ''}</p> : null}
                {e.priority ? <p className="text-ink-2">Priority set to {e.priority}</p> : null}
                {e.blockedBy.length ? <p className="text-ink-2">Blocked by {e.blockedBy.join(', ')}</p> : null}
                {e.evidence.length ? <p className="text-ink-2">Evidence: <span className="font-mono">{e.evidence.join(', ')}</span></p> : null}
                {e.rationale ?? e.comment ? <p className="mt-1 whitespace-pre-wrap text-ink-2">{e.rationale ?? e.comment}</p> : null}
              </li>
            ))}
          </ol>
        ) : v ? (
          <p className="text-[13.5px] text-ink-3">No merged work-item record yet. Actions appear here once their pull request is merged on {v.canonical.ref}.</p>
        ) : null}
        {v && v.recent.length ? (
          <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-ink-3">
            <GitPullRequest aria-hidden className="size-3.5" />
            Recent proposals: {v.recent.map((p) => `${WORK_ACTION_LABEL[p.action as WorkAction] ?? p.action} (${PROPOSAL_LABEL[p.state as ProposalState]})`).join(', ')}
          </p>
        ) : null}
      </section>

      {item.missing.length ? <p className="mt-6 text-[12.5px] text-ink-3">Not stated by the source: {item.missing.join(', ')}.</p> : null}

      <div className="mt-8 border-t border-hairline pt-6">
        <SourceBlock src={item.source} label="GitHub reference" />
      </div>

      {v ? (
        <WorkActionDialog
          action={dialog}
          onClose={() => setDialog(null)}
          itemId={item.id}
          revision={v.revision}
          original={{ status: v.canonical.state.phase, canonicalCommit: v.canonical.commit, lastEvent: ((e) => (e ? { action: e.action, by: e.actor.login, at: e.createdAt, text: e.rationale ?? e.comment ?? null } : null))(v.canonical.state.events[v.canonical.state.events.length - 1]) }}
          login={session?.user?.login ?? ''}
          people={v.people}
          knownIds={data.items.map((i) => i.id)}
          submittedEvidence={v.canonical.state.evidence}
          onSubmit={submit}
          onReload={() => {
            setDialog(null);
            void load();
          }}
        />
      ) : null}
    </article>
  );
}

function Scenarios({ status, s, active, idButton }: { status: WorkItem['status']; s: { ifRejected: Impact; ifDeferred: Impact }; active: Impact | null; idButton: (id: string) => React.ReactNode }) {
  const list = (ids: string[]) => (ids.length ? <span className="flex flex-wrap gap-1.5">{ids.map(idButton)}</span> : <span className="text-ink-3">none</span>);
  return (
    <section className="mt-6" aria-labelledby="wk-impact" data-testid="impact-panel">
      <h3 id="wk-impact" className="mb-2 text-[13px] font-semibold text-ink-2">
        What this decision touches
      </h3>
      {active ? (
        <p className="mb-2 rounded-xl px-3.5 py-2.5 text-[13.5px] leading-5" style={{ background: 'var(--s-open-bg)', color: 'var(--s-open-fg)' }}>
          This decision is {status.toLowerCase()}: {active.note}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-hairline p-3 text-[13.5px]">
          <p className="font-semibold">If rejected</p>
          <p className="mt-1 text-[12.5px] text-ink-3">Work that requires it</p>
          {list(s.ifRejected.requiring.map((d) => d.id))}
          <p className="mt-2 text-[12.5px] text-ink-3">Work that only mentions it</p>
          {list(s.ifRejected.mentioning.map((d) => d.id))}
          <p className="mt-2 text-[12.5px] text-ink-3">Design and architecture documents citing it</p>
          {s.ifRejected.artefacts.length ? (
            <ul className="space-y-0.5">
              {s.ifRejected.artefacts.slice(0, 6).map((a) => (
                <li key={a.path} className="clamp-1 font-mono text-[12px] text-ink-2">
                  {a.path}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-ink-3">none</span>
          )}
        </div>
        <div className="rounded-xl border border-hairline p-3 text-[13.5px]">
          <p className="font-semibold">If deferred (when critical)</p>
          <p className="mt-1 text-[12.5px] text-ink-3">Implementation work that must stay blocked</p>
          {list(s.ifDeferred.mustRemainBlocked)}
          <p className="mt-2 text-[12.5px] text-ink-3">All work that requires it</p>
          {list(s.ifDeferred.requiring.map((d) => d.id))}
        </div>
      </div>
      <p className="mt-2 text-[12.5px] leading-5 text-ink-3">The repository records no mapping from a decision to named architecture components. This lists the documents that cite the decision and the work whose sources say it requires it. Unrelated work is never touched.</p>
    </section>
  );
}
