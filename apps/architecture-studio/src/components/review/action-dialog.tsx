'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Plus, X } from 'lucide-react';
import { ACTION_LABEL, type ActionKind } from '@/lib/workflow/labels.ts';
import { btn, btnPrimary } from '../ui.tsx';
import { ConflictPanel, type Conflict, type Original } from './conflict-panel.tsx';

export interface OptionChoice {
  key: string;
  name: string;
  recommended: boolean;
}

export interface SubmitResult {
  ok: boolean;
  status: number;
  code?: string;
  detail?: string;
  proposal?: { id: string; state: string };
  duplicate?: boolean;
  /** Set when the submission was refused because GitHub changed: the current revision and the values to compare. */
  currentRevision?: string;
  conflict?: Conflict;
}

const MIN_REASON = 10;
const needsReason: ActionKind[] = ['reject', 'defer', 'request-revision', 'reopen', 'approve-alternative'];

const COPY: Record<ActionKind, { title: string; lead: string; reasonLabel: string; submit: string }> = {
  approve: { title: 'Approve the recommended option', lead: 'You are approving the option the source recommends.', reasonLabel: 'Why (optional)', submit: 'Submit approval' },
  'approve-alternative': { title: 'Select and approve an alternative', lead: 'You are approving an option the source does not recommend. The choice and your reasons are recorded.', reasonLabel: 'Why this option instead of the recommendation', submit: 'Submit selection' },
  'approve-with-conditions': { title: 'Approve with conditions', lead: 'The approval stands only on the conditions you list. They are recorded with it.', reasonLabel: 'Why (optional)', submit: 'Submit conditional approval' },
  reject: { title: 'Reject this proposal', lead: 'A rejection needs a reason. It is recorded, and the decision can only be revisited by reopening it.', reasonLabel: 'Reason for rejection', submit: 'Submit rejection' },
  'request-revision': { title: 'Request revision', lead: 'Say what must change before this can be decided.', reasonLabel: 'What needs to change', submit: 'Request revision' },
  defer: { title: 'Defer this decision', lead: 'Deferring leaves the decision open for later. Say why, and until when if you know.', reasonLabel: 'Reason for deferring', submit: 'Submit deferral' },
  comment: { title: 'Add a comment', lead: 'A comment changes no status. It joins the decision’s history through a pull request.', reasonLabel: 'Comment', submit: 'Submit comment' },
  reopen: { title: 'Reopen this decision', lead: 'Reopening is the controlled way to revisit an approved or rejected decision. The earlier decision stays on record.', reasonLabel: 'Why it is being reopened', submit: 'Submit reopening' },
};

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`);

interface Props {
  action: ActionKind | null;
  onClose: () => void;
  decisionId: string;
  options: OptionChoice[];
  revision: string;
  /** What the person was looking at, so a conflict can show it beside what GitHub holds now. */
  original: Original;
  login: string;
  onSubmit: (body: Record<string, unknown>) => Promise<SubmitResult>;
  onReload: () => void;
}

export function ActionDialog({ action, onClose, decisionId, options, revision, original, login, onSubmit, onReload }: Props) {
  const [text, setText] = useState('');
  const [optionKey, setOptionKey] = useState('');
  const [conditions, setConditions] = useState<string[]>(['']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SubmitResult | null>(null);
  // After a conflict the person reads the current state and confirms; only then is the newer revision used.
  const [override, setOverride] = useState<string | null>(null);
  const key = useRef(newKey());
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const hasRec = options.some((o) => o.recommended);
  const choices = useMemo(() => (action === 'approve-alternative' && hasRec ? options.filter((o) => !o.recommended) : options), [action, options, hasRec]);

  // Reset only when a different action is opened. A background refresh passes new props; it must never clear what the user typed.
  useEffect(() => {
    if (!action) return;
    key.current = newKey();
    setText('');
    setError(null);
    setBusy(false);
    setConditions(['']);
    setOverride(null);
    const o = optionsRef.current;
    setOptionKey(action === 'approve-with-conditions' ? (o.find((x) => x.recommended)?.key ?? o[0]?.key ?? '') : '');
  }, [action]);

  if (!action) return null;
  const c = COPY[action];
  const reasonRequired = needsReason.includes(action) || action === 'comment';
  const reasonOk = !reasonRequired || text.trim().length >= (action === 'comment' ? 1 : MIN_REASON);
  const condList = conditions.map((x) => x.trim()).filter(Boolean);
  const valid = reasonOk && (action !== 'approve-alternative' || !!optionKey) && (action !== 'approve-with-conditions' || (condList.length > 0 && !!optionKey));
  const hint = !reasonOk ? (action === 'comment' ? 'Write a comment.' : `At least ${MIN_REASON} characters are needed (${text.trim().length} so far).`) : null;

  const submit = async (reconciledRevision?: string) => {
    if (!valid || busy) return;
    if (reconciledRevision) {
      setOverride(reconciledRevision);
      key.current = newKey(); // a new decision against new content is a new request
    }
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { action, expectedRevision: reconciledRevision ?? override ?? revision, idempotencyKey: key.current };
    if (action === 'comment') body.comment = text;
    else if (text.trim()) body.rationale = text;
    if (optionKey) body.optionKey = optionKey;
    if (action === 'approve-with-conditions') body.conditions = condList;
    const r = await onSubmit(body);
    setBusy(false);
    if (r.ok) onClose();
    else setError(r);
  };

  const stale = error?.code === 'stale-revision' && !error.conflict;
  return (
    <Dialog.Root open onOpenChange={(o) => !o && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-50 bg-navy/40 backdrop-blur-[2px]" />
        <Dialog.Content data-testid="action-dialog" className="anim-pop fixed top-[8vh] left-1/2 z-50 max-h-[84vh] w-[560px] max-w-[calc(100vw-24px)] -translate-x-1/2 overflow-y-auto rounded-2xl bg-surface p-6" style={{ boxShadow: 'var(--shadow-sheet)' }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-[18px] font-semibold">{c.title}</Dialog.Title>
              <p className="mt-0.5 font-mono text-[12px] text-ink-3">{decisionId}</p>
            </div>
            <Dialog.Close aria-label="Close" disabled={busy} className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2">
              <X aria-hidden className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-2 text-[13.5px] leading-5 text-ink-2">{c.lead}</Dialog.Description>

          {action === 'approve' ? (
            <p className="mt-4 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[13.5px]">
              Option <span className="font-mono font-semibold">{options.find((o) => o.recommended)?.key}</span> · {options.find((o) => o.recommended)?.name}
            </p>
          ) : null}

          {action === 'approve-alternative' || action === 'approve-with-conditions' ? (
            <fieldset className="mt-4">
              <legend className="mb-1.5 text-[13px] font-medium">{action === 'approve-alternative' ? (hasRec ? 'Which alternative are you approving?' : 'Which option are you approving?') : 'Which option do the conditions apply to?'}</legend>
              <div className="space-y-1.5">
                {choices.map((o) => (
                  <label key={o.key} className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-hairline px-3.5 py-2.5 text-[13.5px] has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                    <input type="radio" name="option" value={o.key} checked={optionKey === o.key} onChange={() => setOptionKey(o.key)} className="mt-1" />
                    <span>
                      <span className="font-mono font-semibold">{o.key}</span> · {o.name}
                      {o.recommended ? <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-semibold text-accent">Recommended</span> : null}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {action === 'approve-with-conditions' ? (
            <fieldset className="mt-4">
              <legend className="mb-1.5 text-[13px] font-medium">Conditions</legend>
              <ul className="space-y-2">
                {conditions.map((v, i) => (
                  <li key={i} className="flex gap-2">
                    <input value={v} onChange={(e) => setConditions((cs) => cs.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Condition ${i + 1}`} maxLength={500} placeholder="For example: confirm in-country region support first" className="min-w-0 flex-1 rounded-lg border border-hairline-strong bg-surface px-3 py-1.5 text-[13.5px]" />
                    {conditions.length > 1 ? (
                      <button type="button" aria-label={`Remove condition ${i + 1}`} onClick={() => setConditions((cs) => cs.filter((_, j) => j !== i))} className="grid size-9 place-items-center rounded-lg text-ink-3 hover:bg-surface-2">
                        <X aria-hidden className="size-4" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {conditions.length < 10 ? (
                <button type="button" onClick={() => setConditions((cs) => [...cs, ''])} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
                  <Plus aria-hidden className="size-3.5" />
                  Add a condition
                </button>
              ) : null}
              {condList.length === 0 ? <p className="mt-1.5 text-[12.5px] text-ink-3">At least one condition is needed.</p> : null}
            </fieldset>
          ) : null}

          <div className="mt-4">
            <label htmlFor="rationale" className="mb-1.5 block text-[13px] font-medium">
              {c.reasonLabel}
              {reasonRequired ? <span className="text-[var(--s-rejected-fg)]"> (required)</span> : null}
            </label>
            <textarea
              id="rationale"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void submit();
              }}
              rows={5}
              maxLength={4000}
              aria-describedby={hint ? 'rationale-hint' : undefined}
              aria-invalid={!reasonOk && text.length > 0}
              className="w-full resize-y rounded-xl border border-hairline-strong bg-surface px-3.5 py-2.5 text-[14px] leading-6"
            />
            {hint ? (
              <p id="rationale-hint" className="mt-1 text-[12.5px] text-ink-3">
                {hint}
              </p>
            ) : null}
          </div>

          <p className="mt-4 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[12.5px] leading-5 text-ink-2">
            You are acting as <strong>@{login}</strong>. This saves a proposal and opens a pull request on GitHub. The decision keeps its current status until a person merges that pull request.
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
                    Reload this decision
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className={btn} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} onClick={() => void submit()} disabled={!valid || busy || stale || !!error?.conflict} aria-busy={busy}>
              {busy ? 'Submitting…' : c.submit}
            </button>
          </div>
          <span className="sr-only" aria-live="polite">
            {busy ? `Submitting ${ACTION_LABEL[action]}` : ''}
          </span>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
