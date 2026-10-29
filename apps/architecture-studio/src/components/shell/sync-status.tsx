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
        <Popover.Content align="end" sideOffset={8} className="anim-pop z-50 w-[380px] max-w-[calc(100vw-24px)] rounded-2xl bg-surface p-4" style={{ boxShadow: 'var(--shadow-pop)' }}>
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
          <p className="mt-3 text-[12.5px] leading-5 text-ink-3">The Studio reads committed git objects. It never fetches, pulls or writes. Run <span className="font-mono">git fetch</span> yourself to refresh GitHub state, then re-read.</p>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" onClick={reread} disabled={busy} className={btn}>
              <RefreshCw aria-hidden className={`size-4 ${busy ? 'animate-spin' : ''}`} />
              {busy ? 'Re-reading…' : 'Re-read repository'}
            </button>
            <p role="status" aria-live="polite" className={`text-[12.5px] ${msg && !msg.ok ? 'text-[var(--s-rejected-fg)]' : 'text-ink-3'}`}>
              {msg?.text}
            </p>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
