'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Plus, X } from 'lucide-react';
import { PRIORITIES } from '@/lib/queue/types.ts';
import { WORK_ACTION_LABEL, type WorkAction } from '@/lib/workflow/labels.ts';
import { btn, btnPrimary } from '../ui.tsx';
import type { SubmitResult } from '../review/action-dialog.tsx';
import { ConflictPanel, type Original } from '../review/conflict-panel.tsx';

const MIN_REASON = 10;
const REASON_REQUIRED: WorkAction[] = ['prioritize', 'mark-blocked', 'unblock', 'request-clarification', 'reject-completion', 'reopen'];

const COPY: Record<WorkAction, { lead: string; reason: string; submit: string }> = {
  assign: { lead: 'Assign this item to a registered person. A due date is optional: set one only if it has actually been agreed.', reason: 'Note (optional)', submit: 'Submit assignment' },
  prioritize: { lead: 'Change the priority. The priority from the source document is kept on record and the change is attributed to you.', reason: 'Why the priority changes', submit: 'Submit priority' },
  comment: { lead: 'A comment changes nothing about the item. It joins the item’s history through a pull request.', reason: 'Comment', submit: 'Submit comment' },
  'mark-blocked': { lead: 'Record that this item cannot proceed. Name the items it is waiting for if they are in the queue.', reason: 'What is blocking it', submit: 'Mark blocked' },
  unblock: { lead: 'Record that the block or the clarification request has been cleared.', reason: 'What cleared it', submit: 'Clear block' },
  'request-clarification': { lead: 'Ask for clarification. The item shows as awaiting clarification until it is cleared.', reason: 'What needs clarifying', submit: 'Request clarification' },
  'submit-for-review': { lead: 'Submit the item for a completion decision. Completion needs evidence that already exists in the repository: an evidence record (EV-nnnn) from a run that succeeded, or a file.', reason: 'Note for the reviewer (optional)', submit: 'Submit for review' },
  'approve-completion': { lead: 'Approve that the evidence shows this work is complete. The item shows as Done only after this record is merged on the canonical branch.', reason: 'Note (optional)', submit: 'Approve completion' },
  'reject-completion': { lead: 'The evidence does not show completion. Say what is missing; the item returns to open.', reason: 'Why completion is rejected', submit: 'Reject completion' },
  reopen: { lead: 'Reopen completed or closed work. The earlier record stays on file.', reason: 'Why it is being reopened', submit: 'Reopen' },
};

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`);

interface Props {
  action: WorkAction | null;
  onClose: () => void;
  itemId: string;
  revision: string;
  original: Original;
  login: string;
  people: { login: string; holder: string; roles: string[] }[];
  knownIds: string[];
  submittedEvidence: string[];
  onSubmit: (body: Record<string, unknown>) => Promise<SubmitResult>;
  onReload: () => void;
}

export function WorkActionDialog({ action, onClose, itemId, revision, original, login, people, knownIds, submittedEvidence, onSubmit, onReload }: Props) {
  const [text, setText] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('');
  const [blockedBy, setBlockedBy] = useState('');
  const [evidence, setEvidence] = useState<string[]>(['']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SubmitResult | null>(null);
  const [override, setOverride] = useState<string | null>(null);
  const key = useRef(newKey());

  // Reset only when a different action opens; a background refresh must never clear what was typed.
  useEffect(() => {
    if (!action) return;
    key.current = newKey();
    setText('');
    setAssignee(people[0]?.login ?? '');
    setDue('');
    setPriority('');
    setBlockedBy('');
    setEvidence(['']);
    setError(null);
    setBusy(false);
    setOverride(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  if (!action) return null;
  const c = COPY[action];
  const reasonRequired = REASON_REQUIRED.includes(action) || action === 'comment';
  const min = action === 'comment' ? 1 : MIN_REASON;
  const reasonOk = !reasonRequired || text.trim().length >= min;
  const evList = evidence.map((x) => x.trim()).filter(Boolean);
  const blockedList = blockedBy.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  const unknownBlockers = blockedList.filter((b) => !knownIds.includes(b));
  const valid =
    reasonOk &&
    (action !== 'assign' || !!assignee) &&
    (action !== 'prioritize' || !!priority) &&
    (action !== 'submit-for-review' || evList.length > 0) &&
    (action !== 'mark-blocked' || unknownBlockers.length === 0);
  const hint = !reasonOk ? (action === 'comment' ? 'Write a comment.' : `At least ${MIN_REASON} characters are needed (${text.trim().length} so far).`) : null;

  const submit = async (reconciledRevision?: string) => {
    if (!valid || busy) return;
    if (reconciledRevision) {
      setOverride(reconciledRevision);
      key.current = newKey();
    }
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { action, expectedRevision: reconciledRevision ?? override ?? revision, idempotencyKey: key.current };
    if (action === 'comment') body.comment = text;
    else if (text.trim()) body.rationale = text;
    if (action === 'assign') {
      body.assignee = assignee;
      if (due) body.dueDate = due;
    }
    if (action === 'prioritize') body.priority = priority;
    if (action === 'mark-blocked') body.blockedBy = blockedList;
    if (action === 'submit-for-review') body.evidence = evList;
    const r = await onSubmit(body);
    setBusy(false);
    if (r.ok) onClose();
    else setError(r);
  };

  const stale = error?.code === 'stale-revision' && !error.conflict;
  const field = 'w-full rounded-lg border border-hairline-strong bg-surface px-3 py-1.5 text-[13.5px]';
  return (
    <Dialog.Root open onOpenChange={(o) => !o && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-[60] bg-navy/40 backdrop-blur-[2px]" />
        <Dialog.Content data-testid="work-action-dialog" className="anim-pop fixed top-[8vh] left-1/2 z-[60] max-h-[84vh] w-[560px] max-w-[calc(100vw-24px)] -translate-x-1/2 overflow-y-auto rounded-2xl bg-surface p-6" style={{ boxShadow: 'var(--shadow-sheet)' }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-[18px] font-semibold">{WORK_ACTION_LABEL[action]}</Dialog.Title>
              <p className="mt-0.5 font-mono text-[12px] text-ink-3">{itemId}</p>
            </div>
            <Dialog.Close aria-label="Close" disabled={busy} className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2">
              <X aria-hidden className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-2 text-[13.5px] leading-5 text-ink-2">{c.lead}</Dialog.Description>

          {action === 'assign' ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="wk-assignee" className="mb-1.5 block text-[13px] font-medium">
                  Assign to
                </label>
                <select id="wk-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} className={field}>
                  {people.map((p) => (
                    <option key={p.login} value={p.login}>
                      @{p.login} ({p.roles.join(', ') || 'no roles'})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="wk-due" className="mb-1.5 block text-[13px] font-medium">
                  Due date (only if agreed)
                </label>
                <input id="wk-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className={field} />
              </div>
            </div>
          ) : null}

          {action === 'prioritize' ? (
            <div className="mt-4">
              <label htmlFor="wk-priority" className="mb-1.5 block text-[13px] font-medium">
                New priority
              </label>
              <select id="wk-priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={field}>
                <option value="">Choose a priority</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {action === 'mark-blocked' ? (
            <div className="mt-4">
              <label htmlFor="wk-blocked-by" className="mb-1.5 block text-[13px] font-medium">
                Blocked by (item ids, optional)
              </label>
              <input id="wk-blocked-by" list="wk-known" value={blockedBy} onChange={(e) => setBlockedBy(e.target.value)} placeholder="For example: D-003, T14" className={field} aria-invalid={unknownBlockers.length > 0} />
              <datalist id="wk-known">
                {knownIds.slice(0, 400).map((i) => (
                  <option key={i} value={i} />
                ))}
              </datalist>
              {unknownBlockers.length ? <p className="mt-1 text-[12.5px] text-[var(--s-rejected-fg)]">Not in the queue: {unknownBlockers.join(', ')}</p> : null}
            </div>
          ) : null}

          {action === 'submit-for-review' ? (
            <fieldset className="mt-4">
              <legend className="mb-1.5 text-[13px] font-medium">
                Completion evidence <span className="text-[var(--s-rejected-fg)]">(required)</span>
              </legend>
              <ul className="space-y-2">
                {evidence.map((v, i) => (
                  <li key={i} className="flex gap-2">
                    <input value={v} onChange={(e) => setEvidence((es) => es.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Evidence ${i + 1}`} maxLength={240} placeholder="EV-0042 or docs/evidence/…" className={`${field} min-w-0 flex-1 font-mono`} />
                    {evidence.length > 1 ? (
                      <button type="button" aria-label={`Remove evidence ${i + 1}`} onClick={() => setEvidence((es) => es.filter((_, j) => j !== i))} className="grid size-9 place-items-center rounded-lg text-ink-3 hover:bg-surface-2">
                        <X aria-hidden className="size-4" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {evidence.length < 10 ? (
                <button type="button" onClick={() => setEvidence((es) => [...es, ''])} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
                  <Plus aria-hidden className="size-3.5" />
                  Add evidence
                </button>
              ) : null}
              <p className="mt-1.5 text-[12.5px] text-ink-3">The Studio checks each reference exists in the repository, and that an EV record’s run succeeded. It cannot judge whether the evidence is enough: a person does that.</p>
            </fieldset>
          ) : null}

          {action === 'approve-completion' ? (
            <p className="mt-4 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[13.5px]">
              Evidence submitted: <span className="font-mono">{submittedEvidence.join(', ') || 'none recorded'}</span>
            </p>
          ) : null}

          <div className="mt-4">
            <label htmlFor="wk-rationale" className="mb-1.5 block text-[13px] font-medium">
              {c.reason}
              {reasonRequired ? <span className="text-[var(--s-rejected-fg)]"> (required)</span> : null}
            </label>
            <textarea
              id="wk-rationale"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void submit();
              }}
              rows={4}
              maxLength={4000}
              aria-describedby={hint ? 'wk-hint' : undefined}
              aria-invalid={!reasonOk && text.length > 0}
              className="w-full resize-y rounded-xl border border-hairline-strong bg-surface px-3.5 py-2.5 text-[14px] leading-6"
            />
            {hint ? (
              <p id="wk-hint" className="mt-1 text-[12.5px] text-ink-3">
                {hint}
              </p>
            ) : null}
          </div>

          <p className="mt-4 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[12.5px] leading-5 text-ink-2">
            You are acting as <strong>@{login}</strong>. This saves a proposal and opens a pull request on GitHub. The item keeps its current status until a person merges that pull request.
          </p>

          {error?.conflict ? (
            <ConflictPanel conflict={error.conflict} original={original} busy={busy} onReapply={() => void submit(error.currentRevision)} onDiscard={() => {
              onReload();
              onClose();
            }} />
          ) : error ? (
            <div role="alert" className="mt-3 flex gap-2.5 rounded-xl px-3.5 py-2.5 text-[13.5px] leading-5" style={{ background: 'var(--s-rejected-bg)', color: 'var(--s-rejected-fg)' }}>
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p>{error.detail ?? `The request failed (HTTP ${error.status}).`}</p>
                {stale ? (
                  <button type="button" className="mt-1.5 font-medium underline" onClick={onReload}>
                    Reload this item
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className={btn} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" data-testid="work-submit" className={btnPrimary} onClick={() => void submit()} disabled={!valid || busy || stale || !!error?.conflict} aria-busy={busy}>
              {busy ? 'Submitting…' : c.submit}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
