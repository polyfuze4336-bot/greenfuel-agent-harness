'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, CircleDot, ExternalLink, LogIn, LogOut, RotateCw, ShieldCheck } from 'lucide-react';
import type { TimelineEntry } from '@/lib/workflow/context.ts';
import { ACTION_LABEL, PROPOSAL_LABEL, PROPOSAL_STEPS, actionLabel, describeValidation, type ActionKind, type ProposalState } from '@/lib/workflow/labels.ts';
import type { ReviewView } from '@/lib/workflow/review.ts';
import type { AuditEntry, Proposal } from '@/lib/workflow/store.ts';
import type { NormStatus } from '@/lib/intel/schema.ts';
import { utcDate } from '@/lib/format.ts';
import { SourcePreviewButton } from '../source-preview.tsx';
import { Card, NormStatusPill, Skeleton, Tag, btn, useGitHub } from '../ui.tsx';
import { ActionDialog, type OptionChoice, type SubmitResult } from './action-dialog.tsx';
import type { Conflict } from './conflict-panel.tsx';

interface SessionInfo {
  authenticated: boolean;
  csrf?: string;
  testMode: boolean;
  mode: 'entra' | 'github-dev';
  devApprovals: boolean;
  entraConfigured: boolean;
  canonicalRef: string;
  user?: { login: string; name: string | null; provider: string; roles: string[]; listed: boolean; verifiedBy: string; mfa: boolean; notes: string[] };
  session?: { idleExpiresAt: number; absoluteExpiresAt: number; approvalWindowEndsAt: number };
  policy: { source: string; configured: boolean; problems: string[] };
}

interface ReviewData {
  view: ReviewView;
  status: NormStatus;
  timeline: TimelineEntry[];
  audit: AuditEntry[];
  next: { id: string; title: string } | null;
  previous: { id: string; title: string } | null;
  pending: { total: number; position: number | null };
}

type Problem = { detail?: string; code?: string };

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: (T & Problem) | null }> {
  const r = await fetch(url, { credentials: 'same-origin', ...init });
  const body = (await r.json().catch(() => null)) as (T & Problem) | null;
  return { ok: r.ok, status: r.status, body };
}

const KEYS: Record<string, ActionKind> = { a: 'approve', r: 'reject', d: 'defer', v: 'request-revision', c: 'comment', o: 'reopen', m: 'recommend' };
const PRIMARY: ActionKind[] = ['approve', 'approve-alternative', 'approve-with-conditions'];
const SECONDARY: ActionKind[] = ['recommend', 'request-revision', 'defer', 'reject', 'comment', 'reopen'];
const HOTKEY: Partial<Record<ActionKind, string>> = { approve: 'A', reject: 'R', defer: 'D', 'request-revision': 'V', comment: 'C', reopen: 'O', recommend: 'M' };

/** The GitHub commit, and pull request, that carry a review record. Linked only when GitHub is known to have them. */
function CarriedBy({ c }: { c: NonNullable<TimelineEntry['carriedBy']> }) {
  const { githubUrl } = useGitHub();
  return (
    <p className="mt-0.5 text-[12px] text-ink-3" data-testid="carried-by">
      Commit{' '}
      {githubUrl ? (
        <a href={`${githubUrl}/commit/${c.sha}`} target="_blank" rel="noreferrer noopener" aria-label={`Commit ${c.sha.slice(0, 7)} on GitHub (opens in a new tab)`} className="font-mono text-accent hover:underline">
          {c.sha.slice(0, 7)}
        </a>
      ) : (
        <span className="font-mono">{c.sha.slice(0, 7)}</span>
      )}
      {c.pullRequest ? (
        <>
          {' · '}
          {c.pullRequest.url ? (
            <a href={c.pullRequest.url} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">
              pull request #{c.pullRequest.number}
            </a>
          ) : (
            <>pull request #{c.pullRequest.number}</>
          )}
        </>
      ) : null}
    </p>
  );
}
export function Tracker({ p, onCheck, busy, subject = 'decision' }: { p: Proposal; onCheck: () => void; busy: boolean; subject?: string }) {
  const failed = p.state === 'failed' || p.state === 'conflicted';
  const at = PROPOSAL_STEPS.indexOf(p.state);
  return (
    <div data-testid="proposal-tracker" data-state={p.state} className="rounded-xl border border-hairline p-3.5">
      <p className="text-[12px] font-medium tracking-wide text-ink-3 uppercase">{actionLabel(p.action)}</p>
      <ol className="mt-2 space-y-1.5" aria-label="Where this change stands">
        {PROPOSAL_STEPS.map((s, i) => {
          const done = !failed && at > i;
          const current = !failed && at === i;
          return (
            <li key={s} aria-current={current ? 'step' : undefined} className={`flex items-center gap-2 text-[13px] ${current ? 'font-semibold text-ink' : done ? 'text-ink-2' : 'text-ink-3'}`}>
              {done ? <CheckCircle2 aria-hidden className="size-4 text-[var(--s-accepted-fg)]" /> : <CircleDot aria-hidden className={`size-4 ${current ? 'text-accent' : 'text-hairline-strong'}`} />}
              {PROPOSAL_LABEL[s as ProposalState]}
              <span className="sr-only">{done ? ' (done)' : current ? ' (current)' : ' (not yet)'}</span>
            </li>
          );
        })}
      </ol>
      {p.validation && !failed ? (
        <p data-testid="validation" data-state={p.validation.state} role="status" className="mt-2.5 rounded-lg px-3 py-2 text-[12.5px] leading-5" style={p.validation.state === 'failure' ? { background: 'var(--s-rejected-bg)', color: 'var(--s-rejected-fg)' } : { background: 'var(--surface-2)' }}>
          GitHub: {describeValidation(p.validation)}. The Studio never merges or waives a check; a person does that on GitHub.
        </p>
      ) : null}
      {failed ? (
        <div role="alert" className="mt-2.5 flex gap-2 rounded-lg px-3 py-2 text-[13px] leading-5" style={{ background: 'var(--s-rejected-bg)', color: 'var(--s-rejected-fg)' }}>
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">{PROPOSAL_LABEL[p.state]}</p>
            <p>{p.lastError?.message ?? 'The request could not be applied.'}</p>
            <p className="mt-1">{p.state === 'conflicted' ? 'Reload and decide again against the current canonical state.' : 'Nothing was applied. You can submit again.'}</p>
          </div>
        </div>
      ) : null}
      {!failed && p.lastError ? (
        <p role="status" className="mt-2.5 rounded-lg px-3 py-2 text-[12.5px] leading-5" style={{ background: 'var(--s-open-bg)', color: 'var(--s-open-fg)' }}>
          Last attempt: {p.lastError.message} {p.lastError.retryable ? 'It can be retried.' : ''}
        </p>
      ) : null}
      {p.state !== 'applied' && !failed ? (
        <p className="mt-2.5 text-[12.5px] leading-5 text-ink-3">The {subject} keeps its current status until this pull request is merged and the Studio has verified it on {`the canonical branch`}.</p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {p.state !== 'applied' && !failed ? (
          <button type="button" className={btn} onClick={onCheck} disabled={busy}>
            <RotateCw aria-hidden className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />
            {p.lastError?.retryable || p.state === 'locally-submitted' ? 'Send to GitHub' : 'Check GitHub status'}
          </button>
        ) : null}
        {p.prUrl ? (
          <a href={p.prUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
            Pull request #{p.prNumber}
            <ExternalLink aria-hidden className="size-3.5" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function ReviewRail({ id, options }: { id: string; options: OptionChoice[] }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ActionKind | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const live = useRef<HTMLParagraphElement>(null);

  const loadSession = useCallback(async () => {
    const r = await api<SessionInfo>('/api/v1/auth/session');
    if (r.ok && r.body) setSession(r.body);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const r = await api<ReviewData>(`/api/v1/review/${encodeURIComponent(id)}`);
    if (r.ok && r.body) setData(r.body);
    else setError(r.body?.detail ?? `HTTP ${r.status}`);
  }, [id]);

  // Session and review state change together: the authorisation of each action depends on who is signed in, so showing a new
  // identity beside the old authorisation would be wrong, even briefly.
  const loadBoth = useCallback(async () => {
    setError(null);
    const [s, r] = await Promise.all([api<SessionInfo>('/api/v1/auth/session'), api<ReviewData>(`/api/v1/review/${encodeURIComponent(id)}`)]);
    if (s.ok && s.body) setSession(s.body);
    if (r.ok && r.body) setData(r.body);
    else setError(r.body?.detail ?? `HTTP ${r.status}`);
  }, [id]);

  useEffect(() => {
    void loadBoth();
  }, [loadBoth]);

  const signIn = async () => {
    setBusy(true);
    setSignInError(null);
    const r = await api<SessionInfo>('/api/v1/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!r.ok) setSignInError(r.body?.detail ?? `Sign-in failed (HTTP ${r.status}).`);
    await loadBoth();
    setBusy(false);
  };

  const signOut = async () => {
    await api('/api/v1/auth/signout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    await loadBoth();
  };

  const submit = async (body: Record<string, unknown>): Promise<SubmitResult> => {
    const r = await api<{ proposal: Proposal; duplicate: boolean }>(`/api/v1/review/${encodeURIComponent(id)}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-studio-csrf': session?.csrf ?? '' },
      body: JSON.stringify(body),
    });
    if (r.status === 401 && r.body?.code !== 'reauth-required') await loadBoth();
    if (r.ok && r.body) {
      setNotice(r.body.duplicate ? 'That submission was already recorded. Nothing new was created.' : `Submitted. ${PROPOSAL_LABEL[r.body.proposal.state as ProposalState]}.`);
      // Refresh in the background so the dialog can close at once.
      void load();
      router.refresh();
    }
    return { ok: r.ok, status: r.status, code: r.body?.code, detail: r.body?.detail, proposal: r.body?.proposal, duplicate: r.body?.duplicate, currentRevision: (r.body as { currentRevision?: string } | null)?.currentRevision, conflict: (r.body as { conflict?: Conflict } | null)?.conflict };
  };

  const check = async (p: Proposal) => {
    setBusy(true);
    const r = await api<{ proposal: Proposal }>(`/api/v1/review/proposals/${p.id}/sync`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-csrf': session?.csrf ?? '' }, body: '{}' });
    setBusy(false);
    setNotice(r.ok && r.body ? `${PROPOSAL_LABEL[r.body.proposal.state as ProposalState]}.` : (r.body?.detail ?? 'Could not check GitHub.'));
    void load();
    router.refresh();
  };

  const signedIn = !!session?.authenticated;
  const find = (a: ActionKind) => data?.view.actions.find((x) => x.action === a);
  const usable = useCallback(
    (a: ActionKind) => {
      const x = data?.view.actions.find((y) => y.action === a);
      return !!x && x.allowed && x.authorised === true && signedIn && !data?.view.open;
    },
    [data, signedIn],
  );
  const reasonFor = useCallback(
    (a: ActionKind): string | null => {
      const x = data?.view.actions.find((y) => y.action === a);
      if (!x) return null;
      if (!signedIn) return 'Sign in to act.';
      if (data?.view.open) return 'A change to this decision is already in flight.';
      if (!x.allowed) return x.reason;
      if (x.authorised === false) return x.authReason;
      return null;
    },
    [data, signedIn],
  );

  const go = useCallback(
    (to: { id: string } | null | undefined, what: string) => {
      if (to) router.push(`/decisions/${to.id}/review`);
      else setNotice(`There is no ${what} pending decision.`);
    },
    [router],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.closest('[role="dialog"], [role="menu"]'))) return;
      if (document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (k === 'n' || k === ']') return void (e.preventDefault(), go(data?.next, 'next'));
      if (k === 'p' || k === '[') return void (e.preventDefault(), go(data?.previous, 'previous'));
      const a = KEYS[k];
      if (!a) return;
      e.preventDefault();
      if (usable(a)) setDialog(a);
      else setNotice(`${ACTION_LABEL[a]} is unavailable: ${reasonFor(a) ?? 'not allowed now'}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data, go, usable, reasonFor]);

  if (error)
    return (
      <Card className="p-5" data-testid="review-rail">
        <div role="alert" className="flex items-start gap-3 text-[13.5px] text-[var(--s-rejected-fg)]">
          <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold">The review state could not be loaded.</p>
            <p>{error}</p>
            <button type="button" className={`${btn} mt-3`} onClick={() => void load()}>
              <RotateCw aria-hidden className="size-3.5" />
              Retry
            </button>
          </div>
        </div>
      </Card>
    );

  if (!data || !session)
    return (
      <Card className="p-5" data-testid="review-rail">
        <div role="status" aria-busy="true" aria-label="Loading review state" className="space-y-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
      </Card>
    );

  const v = data.view;
  const unavailable = ([...PRIMARY, ...SECONDARY] as ActionKind[]).filter((a) => !usable(a) && reasonFor(a));
  const label = (a: ActionKind) => (a === 'approve-alternative' && !options.some((o) => o.recommended) ? 'Select and approve an option' : ACTION_LABEL[a]);
  const button = (a: ActionKind, primary: boolean) => {
    const ok = usable(a);
    const danger = a === 'reject';
    return (
      <li key={a}>
        <button
          type="button"
          data-testid={`action-${a}`}
          aria-disabled={!ok}
          title={ok ? undefined : (reasonFor(a) ?? undefined)}
          onClick={() => (ok ? setDialog(a) : setNotice(`${label(a)} is unavailable: ${reasonFor(a) ?? 'not allowed now'}`))}
          className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-[13.5px] font-medium transition-colors ${
            ok ? (primary ? 'border-transparent bg-accent text-accent-ink hover:opacity-90' : danger ? 'border-hairline-strong bg-surface text-[var(--s-rejected-fg)] hover:bg-surface-2' : 'border-hairline-strong bg-surface hover:bg-surface-2') : 'cursor-not-allowed border-hairline bg-surface-2 text-ink-3'
          }`}
        >
          <span>{label(a)}</span>
          {HOTKEY[a] ? <kbd className={`rounded border px-1.5 font-mono text-[11px] ${ok && primary ? 'border-white/40' : 'border-hairline-strong'}`}>{HOTKEY[a]}</kbd> : null}
        </button>
      </li>
    );
  };

  return (
    <div data-testid="review-rail" className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
      {session.testMode ? (
        <p role="note" data-testid="test-mode-banner" className="rounded-xl px-3.5 py-2 text-[12.5px] font-medium" style={{ background: 'var(--s-open-bg)', color: 'var(--s-open-fg)' }}>
          TEST MODE: the GitHub account and pull requests are simulated. Nothing here is real.
        </p>
      ) : null}

      <Card className="p-4">
        <h2 className="text-[13px] font-semibold text-ink-2">Your identity</h2>
        {signedIn && session.user ? (
          <div data-testid="identity" className="mt-2">
            <p className="flex items-center gap-2 text-[14px] font-semibold">
              <ShieldCheck aria-hidden className="size-4 text-[var(--s-accepted-fg)]" />@{session.user.login}
            </p>
            <p data-testid="identity-roles" className="mt-0.5 text-[12.5px] leading-5 text-ink-2">
              {session.user.roles.length ? `Role${session.user.roles.length > 1 ? 's' : ''}: ${session.user.roles.join(', ')}` : 'No role. You can read, not act.'}
            </p>
            <p className="text-[12px] text-ink-3">
              Confirmed by {session.user.verifiedBy === 'entra-oidc' ? 'Microsoft Entra ID' : session.user.verifiedBy === 'github-api' ? 'GitHub (development sign-in)' : 'the test fixture'}, not typed in.
              {session.user.provider === 'entra' ? (session.user.mfa ? ' Multi-factor sign-in.' : ' No multi-factor claim on this sign-in.') : ''}
            </p>
            {session.user.notes.length ? <p className="mt-1 text-[12px] leading-5 text-ink-3">{session.user.notes[0]}</p> : null}
            <button type="button" className={`${btn} mt-2.5`} onClick={() => void signOut()}>
              <LogOut aria-hidden className="size-3.5" />
              Sign out
            </button>
          </div>
        ) : (
          <div className="mt-2">
            {session.mode === 'entra' ? (
              <>
                <p className="text-[13px] leading-5 text-ink-2">Every action needs a Microsoft Entra ID sign-in. Your role comes from your Entra assignment and the access policy, never from this page.</p>
                <a data-testid="sign-in" className={`${btn} mt-2.5`} href={`/api/v1/auth/entra/login?next=${encodeURIComponent(typeof window === 'undefined' ? '/' : window.location.pathname)}`}>
                  <LogIn aria-hidden className="size-3.5" />
                  Sign in with Microsoft
                </a>
              </>
            ) : (
              <>
                <p className="text-[13px] leading-5 text-ink-2">Development sign-in: the Studio asks GitHub which account is signed in on this computer. This is not a production identity.</p>
                <button type="button" data-testid="sign-in" className={`${btn} mt-2.5`} onClick={() => void signIn()} disabled={busy}>
                  <LogIn aria-hidden className="size-3.5" />
                  Sign in with GitHub
                </button>
              </>
            )}
            {signInError ? (
              <p role="alert" className="mt-2 text-[12.5px] leading-5 text-[var(--s-rejected-fg)]">
                {signInError}
              </p>
            ) : null}
          </div>
        )}
        {!v.policy.configured ? (
          <p role="note" data-testid="no-approvers" className="mt-3 rounded-lg px-3 py-2 text-[12.5px] leading-5" style={{ background: 'var(--s-open-bg)', color: 'var(--s-open-fg)' }}>
            No approver is enrolled, so nobody can decide yet. Enroll approvers in <span className="font-mono">harness/policy/access-policy.json</span> through a reviewed change.
          </p>
        ) : v.policy.source !== 'canonical' ? (
          <p role="note" className="mt-3 rounded-lg px-3 py-2 text-[12.5px] leading-5" style={{ background: 'var(--s-open-bg)', color: 'var(--s-open-fg)' }}>
            The approver policy is on your branch but not yet on {session.canonicalRef}. Each decision records that.
          </p>
        ) : null}
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[13px] font-semibold text-ink-2">Canonical status</h2>
          <NormStatusPill status={data.status} />
        </div>
        <p className="mt-1 text-[12.5px] leading-5 text-ink-3">
          As on {v.canonical.ref}
          {v.canonical.commit ? ` at ${v.canonical.commit.slice(0, 7)}` : ''}. A decision changes here only after its pull request is merged.
        </p>
        {v.canonical.state.approvedOption ? (
          <p className="mt-2 text-[13px] text-ink-2">
            Approved option <Tag>{v.canonical.state.approvedOption.key}</Tag> {v.canonical.state.approvedOption.name}
            {!v.canonical.state.approvedOption.recommended ? ' (not the recommended option)' : ''}
          </p>
        ) : null}
        {v.canonical.state.conditions.length ? (
          <div data-testid="conditions" className="mt-2 text-[13px]">
            <p className="font-medium">Conditions</p>
            <ul className="list-disc pl-5 text-ink-2">
              {v.canonical.state.conditions.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {v.canonical.state.problems.length ? (
          <p role="alert" className="mt-2 text-[12.5px] leading-5 text-[var(--s-rejected-fg)]">
            The review record on the canonical branch is inconsistent: {v.canonical.state.problems[0]}
          </p>
        ) : null}
        {!v.canonical.available ? (
          <p role="alert" className="mt-2 text-[12.5px] leading-5 text-[var(--s-rejected-fg)]">
            {v.canonical.error}
          </p>
        ) : null}
      </Card>

      {v.open ? <Tracker p={v.open} busy={busy} onCheck={() => void check(v.open!)} /> : null}
      {!v.open && v.recent[0] && (v.recent[0].state === 'failed' || v.recent[0].state === 'conflicted') ? <Tracker p={v.recent[0]} busy={busy} onCheck={() => undefined} /> : null}

      <Card className="p-4">
        <h2 className="text-[13px] font-semibold text-ink-2">Decide</h2>
        <p className="mt-0.5 mb-2.5 text-[12.5px] text-ink-3">One decision, one action at a time. Nothing here changes the repository directly.</p>
        <p data-testid="governance" data-domain={v.governance.domain} className="mb-2.5 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] leading-5 text-ink-2">
          <span className="font-medium text-ink">Approval domain: {v.governance.domain}.</span>{' '}
          {v.governance.domain === 'regulatory' || v.governance.domain === 'unclassified'
            ? 'The Studio does not approve this kind of record. A regulatory filing or an unclassified record is approved outside it.'
            : v.governance.designated === false
              ? 'You are not designated to approve this decision. Designation is set in the access policy.'
              : v.governance.designated === true
                ? 'You are the designated approver for this decision.'
                : 'Only the designated approver can decide it.'}{' '}
          Architecture approval never authorises a regulatory filing or a deployment.
        </p>
        {v.actions.some((a) => a.authCode === 'reauth-required') ? (
          <p data-testid="reauth-notice" className="mb-2.5 rounded-lg px-3 py-2 text-[12.5px] leading-5" style={{ background: 'var(--s-open-bg)', color: 'var(--s-open-fg)' }}>
            Approving needs a recent sign-in.{' '}
            <a data-testid="reauth-link" className="font-medium underline" href={`/api/v1/auth/entra/login?reauth=1&next=${encodeURIComponent(`/decisions/${id}/review`)}`}>
              Sign in again to approve
            </a>
            .
          </p>
        ) : null}
        <ul className="space-y-1.5" aria-label="Actions">
          {PRIMARY.map((a) => button(a, true))}
        </ul>
        <ul className="mt-3 space-y-1.5 border-t border-hairline pt-3" aria-label="Other actions">
          {SECONDARY.map((a) => button(a, false))}
        </ul>
        {unavailable.length ? (
          <details className="mt-3 text-[12.5px] leading-5 text-ink-3">
            <summary className="cursor-pointer font-medium text-ink-2">Why are some actions unavailable? ({unavailable.length})</summary>
            <ul className="mt-1.5 space-y-1" data-testid="unavailable-reasons">
              {unavailable.map((a) => (
                <li key={a}>
                  <span className="font-medium text-ink-2">{label(a)}:</span> {reasonFor(a)}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <p ref={live} role="status" aria-live="polite" data-testid="rail-notice" className="mt-3 min-h-5 text-[12.5px] leading-5 text-ink-2">
          {notice}
        </p>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-ink-2">Pending decisions</h2>
          <span className="text-[12.5px] text-ink-3" data-testid="pending-position">
            {data.pending.position ? `${data.pending.position} of ${data.pending.total}` : `${data.pending.total} waiting`}
          </span>
        </div>
        <div className="mt-2.5 flex gap-2">
          <button type="button" data-testid="prev-pending" className={`${btn} flex-1`} disabled={!data.previous} onClick={() => go(data.previous, 'previous')}>
            <ChevronLeft aria-hidden className="size-4" />
            Previous
          </button>
          <button type="button" data-testid="next-pending" className={`${btn} flex-1`} disabled={!data.next} onClick={() => go(data.next, 'next')}>
            Next
            <ChevronRight aria-hidden className="size-4" />
          </button>
        </div>
        {data.next ? <p className="mt-2 truncate text-[12.5px] text-ink-3">Next: {data.next.id}, {data.next.title}</p> : <p className="mt-2 text-[12.5px] text-ink-3">No more pending decisions after this one.</p>}
        <p className="mt-1.5 text-[12px] text-ink-3">
          Keys: <kbd className="font-mono">N</kbd> next, <kbd className="font-mono">P</kbd> previous, <kbd className="font-mono">A R D V C O M</kbd> actions.
        </p>
      </Card>

      <Card className="p-4">
        <h2 className="text-[13px] font-semibold text-ink-2">Decision timeline</h2>
        {data.timeline.length === 0 ? <p className="mt-2 text-[13px] text-ink-3">No history is recorded for this decision.</p> : null}
        <ol data-testid="timeline" className="mt-2.5 space-y-3">
          {data.timeline.slice(0, 14).map((t, i) => (
            <li key={`${t.kind}-${i}`} className="border-l-2 border-hairline-strong pl-3 text-[13px] leading-5">
              <p className="text-[11.5px] font-medium tracking-wide text-ink-3 uppercase">
                {t.kind === 'review-event' ? 'Review record' : t.kind === 'proposal' ? 'In flight' : t.kind === 'source-approval' ? 'Source' : 'Source commit'}
                {t.at ? ` · ${t.at.length > 10 ? utcDate(t.at) : t.at}` : ''}
              </p>
              <p className="font-medium text-ink">{t.title}</p>
              {t.actor ? <p className="text-[12px] text-ink-3">{t.actor}</p> : null}
              {t.carriedBy ? <CarriedBy c={t.carriedBy} /> : null}
              {t.detail ? <p className="mt-0.5 text-ink-2 whitespace-pre-line">{t.detail.slice(0, 300)}</p> : null}
              {t.kind === 'source-commit' && t.sha && t.ref ? (
                <div className="mt-1.5">
                  <SourcePreviewButton src={{ path: t.ref.path, line: 1 }} at={t.sha} label={`View version ${t.sha.slice(0, 7)}`} />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
        <details className="mt-3 text-[12.5px]">
          <summary className="cursor-pointer font-medium text-ink-2">Audit trail ({data.audit.length})</summary>
          <ul data-testid="audit-trail" className="mt-1.5 space-y-1 text-ink-3">
            {data.audit.map((a) => (
              <li key={a.hash}>
                {a.at.slice(0, 19).replace('T', ' ')} · {a.actor ? `@${a.actor}` : 'unauthenticated'} · {a.action} · <span className="font-medium text-ink-2">{a.outcome}</span>
                {a.code ? ` (${a.code})` : ''}
              </li>
            ))}
          </ul>
        </details>
      </Card>

      <ActionDialog action={dialog} onClose={() => setDialog(null)} decisionId={id} options={options} revision={v.revision} original={{ status: data.status, canonicalCommit: v.canonical.commit, lastEvent: ((e) => (e ? { action: e.action, by: e.actor.login, at: e.createdAt, text: e.rationale ?? e.comment ?? null } : null))(v.canonical.state.events[v.canonical.state.events.length - 1]) }} login={session.user?.login ?? ''} onSubmit={submit} onReload={() => void load()} />
    </div>
  );
}
