'use client';

import * as Dialog from '@radix-ui/react-dialog';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Anchor, Lock, Menu, X } from 'lucide-react';
import type { Attention, RepoMeta } from '@/lib/repo/types.ts';
import { GitHubProvider } from '../ui.tsx';
import type { GitHubCtx } from '@/lib/links.ts';
import { IdentityMenu } from './identity-menu.tsx';
import { NAV, isActive } from './nav.ts';
import { Notifications } from './notifications.tsx';
import { SearchPalette } from './search-palette.tsx';
import { SyncStatus } from './sync-status.tsx';

export interface ShellData {
  repo: RepoMeta;
  counts: { decisions: number; queue: number; approvals: number };
  attention: Attention[];
  approvers: number;
  totalRecords: number;
  gh: GitHubCtx;
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-3 rounded-lg px-2 py-1 text-white">
      <span className="grid size-8 place-items-center rounded-[9px] bg-white/12 ring-1 ring-white/20">
        <Anchor aria-hidden className="size-[18px]" strokeWidth={1.9} />
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-[-0.01em]">Architecture Studio</span>
        <span className="block text-[11.5px] text-white/60">GreenFuel programme</span>
      </span>
    </Link>
  );
}

function NavList({ shell, onNavigate }: { shell: ShellData; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex-1 px-3">
      <ul className="space-y-0.5">
        {NAV.map((n) => {
          const active = isActive(pathname, n.href);
          const count = n.count ? shell.counts[n.count] : undefined;
          const I = n.icon;
          return (
            <li key={n.href}>
              <Link href={n.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors ${active ? 'bg-white/12 font-medium text-white' : 'text-white/70 hover:bg-white/6 hover:text-white'}`}>
                {active ? <span aria-hidden className="absolute top-2 bottom-2 -left-3 w-[3px] rounded-r bg-[#7cc4ee]" /> : null}
                <I aria-hidden className="size-[18px] shrink-0" strokeWidth={active ? 2 : 1.75} />
                <span className="flex-1">{n.label}</span>
                {count !== undefined && count > 0 ? (
                  <span title={`${count} ${n.countLabel}`} className="rounded-full bg-white/10 px-1.5 text-[11.5px] leading-5 text-white/75 tnum">
                    <span className="sr-only">{n.countLabel}: </span>
                    {count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ReadOnlyFooter({ repo }: { repo: RepoMeta }) {
  return (
    <div className="m-3 rounded-xl bg-white/6 p-3 text-[12px] leading-[18px] text-white/65">
      <p className="mb-0.5 flex items-center gap-1.5 font-medium text-white/85">
        <Lock aria-hidden className="size-3.5" />
        Reads this commit only
      </p>
      Showing commit <span className="font-mono text-white/85">{repo.commitShort}</span> on <span className="font-mono text-white/85">{repo.branch ?? 'detached HEAD'}</span>. This view never changes the branch. Decisions are proposed as pull requests.
    </div>
  );
}

export function AppShell({ shell, children }: { shell: ShellData; children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  return (
    <GitHubProvider value={shell.gh}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="min-h-dvh lg:grid lg:grid-cols-[256px_1fr]">
        <aside className="sticky top-0 hidden h-dvh flex-col bg-navy py-5 lg:flex">
          <div className="mb-6 px-3">
            <Brand />
          </div>
          <NavList shell={shell} />
          <ReadOnlyFooter repo={shell.repo} />
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-hairline bg-canvas/85 px-4 backdrop-blur-md sm:px-6 lg:px-8">
            <Dialog.Root open={navOpen} onOpenChange={setNavOpen}>
              <Dialog.Trigger asChild>
                <button type="button" aria-label="Open navigation" className="grid size-9 place-items-center rounded-lg border border-hairline-strong bg-surface text-ink-2 lg:hidden">
                  <Menu aria-hidden className="size-[18px]" />
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="anim-fade fixed inset-0 z-50 bg-navy/50" />
                <Dialog.Content aria-describedby={undefined} className="anim-sheet fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col bg-navy py-5">
                  <Dialog.Title className="sr-only">Navigation</Dialog.Title>
                  <div className="mb-6 flex items-center justify-between px-3">
                    <Brand />
                    <Dialog.Close aria-label="Close navigation" className="grid size-8 place-items-center rounded-lg text-white/70 hover:bg-white/10">
                      <X aria-hidden className="size-4" />
                    </Dialog.Close>
                  </div>
                  <NavList shell={shell} onNavigate={() => setNavOpen(false)} />
                  <ReadOnlyFooter repo={shell.repo} />
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>

            <div className="min-w-0 flex-1">
              <SearchPalette totals={shell.totalRecords} />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <SyncStatus repo={shell.repo} />
              <Notifications items={shell.attention} commit={shell.repo.commit} />
              <IdentityMenu repo={shell.repo} approvers={shell.approvers} />
            </div>
          </header>

          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1280px] px-4 py-8 outline-none sm:px-6 lg:px-8 lg:py-10">
            {children}
          </main>
        </div>
      </div>
    </GitHubProvider>
  );
}
