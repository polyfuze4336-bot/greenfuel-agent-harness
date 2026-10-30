'use client';

import * as Popover from '@radix-ui/react-popover';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, GitCommitHorizontal, Lock, RefreshCw } from 'lucide-react';
import { relativeFrom, utcDateTime } from '@/lib/format.ts';
import type { RepoMeta } from '@/lib/repo/types.ts';
import { btn } from '../ui.tsx';

export function syncSummary(r: RepoMeta): { label: string; ok: boolean } {
  if (!r.commitOnGitHub) return { label: 'Local commit', ok: false };
  if ((r.ahead ?? 0) > 0) return { label: `${r.ahead} to push`, ok: false };
  if ((r.behind ?? 0) > 0) return { label: `${r.behind} behind`, ok: false };
  return { label: 'In sync', ok: true };
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-3 py-1.5 text-[13px]">
      <dt className="text-ink-3">{k}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}

interface GitHubSync {
  mode: 'app' | 'cli' | 'test';
  repo: string | null;
  app: { appId: string; installationId: string; tokenExpiresAt: string | null; webhookConfigured: boolean } | null;
  rateLimit: { remaining: number | null; resetAt: string | null; limited: boolean } | null;
  openProposals: { total: number; byState: Record<string, number> };
  lastReconcile: { at: string; trigger: string; checked: number; advanced: unknown[]; failures: { message: string }[]; orphans: { number: number; head: string }[]; orphanCheck: unknown } | null;
}

const MODE_LABEL = { app: 'GitHub App', cli: 'GitHub CLI, as you', test: 'Simulated GitHub (test)' } as const;

function GitHubSyncPanel() {
  const router = useRouter();
  const [s, setS] = useState<GitHubSync | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = async () => {
    try {
      const r = await fetch('/api/v1/sync/status', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setS((await r.json()) as GitHubSync);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown error');
    }
  };
  useEffect(() => {
    void load();
  }, []);

  async function reconcile() {
    setBusy(true);
    setNote(null);
    try {
      const sess = (await (await fetch('/api/v1/auth/session', { cache: 'no-store' })).json()) as { authenticated: boolean; csrf?: string };
      if (!sess.authenticated) {
        setNote('Sign in on a decision or work item first: reconciling needs a verified identity.');
        return;
      }
      const r = await fetch('/api/v1/sync/reconcile', { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-csrf': sess.csrf ?? '' }, body: '{}' });
      const body = (await r.json().catch(() => null)) as { checked?: number; advanced?: unknown[]; failures?: { message: string }[]; detail?: string } | null;
      if (!r.ok) throw new Error(body?.detail ?? `HTTP ${r.status}`);
      setNote(`Checked ${body?.checked ?? 0} open proposal(s); ${body?.advanced?.length ?? 0} moved forward${body?.failures?.length ? `; ${body.failures.length} could not be checked: ${body.failures[0]!.message}` : ''}.`);
      await load();
      router.refresh();
    } catch (e) {
      setNote(`Could not reconcile: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="gh-sync" data-testid="github-sync" className="mt-4 border-t border-hairline pt-3">
      <p id="gh-sync" className="text-[13px] font-semibold text-ink-2">
        Writing to GitHub
      </p>
      {err ? (
        <p role="alert" className="mt-1 text-[12.5px] text-[var(--s-rejected-fg)]">
          Could not read the GitHub connection: {err}
        </p>
      ) : !s ? (
        <p className="mt-1 text-[12.5px] text-ink-3">Reading…</p>
      ) : (
        <dl className="mt-1 divide-y divide-hairline">
          <Row k="Connected as">
            <span data-testid="github-mode">{MODE_LABEL[s.mode]}</span>
            {s.repo ? <span className="block font-mono text-[12px] text-ink-3">{s.repo}</span> : null}
          </Row>
          {s.app ? (
            <Row k="Credential">
              App {s.app.appId}, installation {s.app.installationId}
              <span className="block text-ink-3">{s.app.tokenExpiresAt ? `Token renews before ${utcDateTime(s.app.tokenExpiresAt)}` : 'No token requested yet'} · webhook {s.app.webhookConfigured ? 'configured' : 'not configured'}</span>
            </Row>
          ) : null}
          {s.rateLimit ? <Row k="Rate limit">{s.rateLimit.limited ? 'Limited' : `${s.rateLimit.remaining ?? '?'} requests left`}{s.rateLimit.resetAt ? `, resets ${utcDateTime(s.rateLimit.resetAt)}` : ''}</Row> : null}
          <Row k="In flight">{s.openProposals.total === 0 ? 'Nothing waiting' : `${s.openProposals.total} proposal(s): ${Object.entries(s.openProposals.byState).map(([k, v]) => `${v} ${k}`).join(', ')}`}</Row>
          <Row k="Last check">
            {s.lastReconcile ? (
              <>
                {utcDateTime(s.lastReconcile.at)} ({s.lastReconcile.trigger}): {s.lastReconcile.checked} checked, {s.lastReconcile.advanced.length} moved
                {s.lastReconcile.failures.length ? `, ${s.lastReconcile.failures.length} failed` : ''}
                {s.lastReconcile.orphans.length ? <span className="block text-[var(--s-open-fg)]">{s.lastReconcile.orphans.length} pull request(s) on GitHub the Studio did not open from here: #{s.lastReconcile.orphans.map((o) => o.number).join(', #')}</span> : null}
              </>
            ) : (
              'Not run since the Studio started.'
            )}
          </Row>
        </dl>
      )}
      <div className="mt-2 flex items-start gap-3">
        <button type="button" data-testid="reconcile" onClick={reconcile} disabled={busy} className={btn}>
          <RefreshCw aria-hidden className={`size-4 ${busy ? 'animate-spin' : ''}`} />
          {busy ? 'Checking…' : 'Reconcile with GitHub'}
        </button>
        <p role="status" aria-live="polite" data-testid="reconcile-note" className="min-h-5 text-[12.5px] leading-5 text-ink-3">
          {note}
        </p>
      </div>
    </section>
  );
}

export function SyncStatus({ repo }: { repo: RepoMeta }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), [repo.generatedAt]);
  const s = syncSummary(repo);

  async function reread() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/v1/refresh', { method: 'POST' });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { detail?: string } | null)?.detail ?? `HTTP ${res.status}`);
      router.refresh();
      setMsg({ ok: true, text: 'Repository re-read.' });
    } catch (e) {
      setMsg({ ok: false, text: `Could not re-read: ${e instanceof Error ? e.message : 'unknown error'}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="inline-flex h-9 items-center gap-2 rounded-lg border border-hairline-strong bg-surface px-2.5 text-[13px] text-ink-2 transition-colors hover:bg-surface-2">
          {s.ok ? <CircleCheck aria-hidden className="size-4 text-[var(--s-accepted-fg)]" /> : <CircleAlert aria-hidden className="size-4 text-[var(--s-open-fg)]" />}
          <span className="sr-only">Repository sync status: </span>
          <span className="hidden font-mono text-[12px] sm:inline">{repo.commitShort}</span>
          <span className="hidden md:inline">{s.label}</span>
          <span className="sr-only sm:hidden">{repo.commitShort} {s.label}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="anim-pop z-50 max-h-[calc(100vh-80px)] w-[400px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl bg-surface p-4" style={{ boxShadow: 'var(--shadow-pop)' }}>
          <div className="mb-2 flex items-center gap-2">
            <Lock aria-hidden className="size-4 text-ink-3" />
            <p className="text-[15px] font-semibold">Repository, read-only</p>
          </div>
          <dl className="divide-y divide-hairline">
            <Row k="Reading">
              <span className="inline-flex items-center gap-1.5">
                <GitCommitHorizontal aria-hidden className="size-4 text-ink-3" />
                <span className="font-mono text-[12.5px]">{repo.commitShort}</span>
              </span>
              <span className="mt-0.5 block text-ink-2">{repo.commitSubject}</span>
              <span className="block text-ink-3">{utcDateTime(repo.commitDate)}</span>
            </Row>
            <Row k="Branch">
              <span className="font-mono text-[12.5px]">{repo.branch ?? 'detached HEAD'}</span>
              {repo.upstream ? <span className="block text-ink-3">tracks {repo.upstream}: {repo.ahead} ahead, {repo.behind} behind</span> : <span className="block text-ink-3">No upstream branch is set.</span>}
            </Row>
            <Row k="On GitHub">{repo.commitOnGitHub ? 'Yes, this commit is on a remote branch.' : 'No. This commit exists only on this machine.'}</Row>
            {repo.defaultBranch ? (
              <Row k={repo.defaultBranch}>
                {repo.defaultBranchBehind ? `Lacks ${repo.defaultBranchBehind} commits that are being read here.` : 'Contains everything being read.'}
              </Row>
            ) : null}
            <Row k="Last fetch">{repo.lastFetchAt ? (now ? relativeFrom(repo.lastFetchAt, now) : utcDateTime(repo.lastFetchAt)) : 'Never fetched on this machine.'}</Row>
            <Row k="Uncommitted">{repo.uncommittedChanges === 0 ? 'None' : `${repo.uncommittedChanges} change(s), not shown in the Studio`}</Row>
          </dl>
          <p className="mt-3 text-[12.5px] leading-5 text-ink-3">The Studio reads committed git objects. Re-reading never fetches, pulls or writes. Only an action you submit fetches the canonical branch, and then only to open a pull request; your working tree is never touched.</p>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" onClick={reread} disabled={busy} className={btn}>
              <RefreshCw aria-hidden className={`size-4 ${busy ? 'animate-spin' : ''}`} />
              {busy ? 'Re-reading…' : 'Re-read repository'}
            </button>
            <p role="status" aria-live="polite" className={`text-[12.5px] ${msg && !msg.ok ? 'text-[var(--s-rejected-fg)]' : 'text-ink-3'}`}>
              {msg?.text}
            </p>
          </div>
          <GitHubSyncPanel />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
