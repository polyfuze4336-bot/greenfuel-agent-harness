'use client';

import * as Dialog from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { useEffect, useState } from 'react';
import { Check, ExternalLink, Keyboard, LogOut, Monitor, Moon, ShieldCheck, Sun, X } from 'lucide-react';
import type { RepoMeta } from '@/lib/repo/types.ts';

type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'studio:theme';

export function applyTheme(t: Theme) {
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

const initials = (name: string | undefined) =>
  (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?';

const SHORTCUTS: [string, string][] = [
  ['Ctrl K  or  /', 'Open search'],
  ['↑ ↓', 'Move through search results, or table rows'],
  ['Enter', 'Open the selected result or row'],
  ['Esc', 'Close search, a panel or a menu'],
  ['Tab', 'Move between controls'],
  ['N  /  P', 'Review page: next or previous pending decision'],
  ['A  R  D  V  C  O  M', 'Review page: approve, reject, defer, request revision, comment, reopen, recommend (each opens a dialog; nothing is submitted by a key)'],
];

export function IdentityMenu({ repo, approvers }: { repo: RepoMeta; approvers: number }) {
  const [theme, setTheme] = useState<Theme>('system');
  const [keys, setKeys] = useState(false);
  const [who, setWho] = useState<{ login: string; provider: string; roles: string[]; mode: string } | null>(null);
  const loadWho = async () => {
    try {
      const r = await fetch('/api/v1/auth/session', { cache: 'no-store', credentials: 'same-origin' });
      const b = (await r.json()) as { authenticated?: boolean; mode?: string; user?: { login: string; provider: string; roles: string[] } };
      setWho(b.authenticated && b.user ? { ...b.user, mode: b.mode ?? '' } : null);
    } catch {
      setWho(null);
    }
  };
  const signOut = async () => {
    await fetch('/api/v1/auth/signout', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' });
    window.location.assign('/');
  };
  useEffect(() => {
    void loadWho();
    const t = (localStorage.getItem(THEME_KEY) as Theme | null) ?? 'system';
    setTheme(t);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => (localStorage.getItem(THEME_KEY) ?? 'system') === 'system' && applyTheme('system');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const choose = (v: string) => {
    const t = v as Theme;
    setTheme(t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* theme still applies for this page view */
    }
    applyTheme(t);
  };
  const user = repo.gitUser;
  const item = 'flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] text-ink outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-ink';

  return (
    <>
      <Menu.Root modal={false} onOpenChange={(o) => o && void loadWho()}>
        <Menu.Trigger asChild>
          <button type="button" aria-label={`${initials(user?.name)} account menu${user?.name ? ` for ${user.name}` : ''}`} className="grid size-9 place-items-center rounded-full bg-navy text-[12.5px] font-semibold text-white ring-1 ring-white/20 transition-opacity hover:opacity-90">
            {initials(user?.name)}
          </button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="end" sideOffset={8} className="anim-pop z-50 w-72 rounded-2xl bg-surface p-1.5" style={{ boxShadow: 'var(--shadow-pop)' }}>
            <div className="px-2.5 pt-2 pb-2.5">
              {who ? (
                <div data-testid="menu-identity">
                  <p className="text-[11.5px] font-medium tracking-wide text-ink-3 uppercase">Signed in{who.provider === 'entra' ? ' with Microsoft' : ' (development)'}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-[14px] font-semibold">
                    <ShieldCheck aria-hidden className="size-4 text-[var(--s-accepted-fg)]" />
                    {who.login}
                  </p>
                  <p className="text-[13px] text-ink-2">{who.roles.length ? who.roles.join(', ') : 'No role (read only)'}</p>
                  <p className="mt-2 text-[12px] leading-[18px] text-ink-3">Roles come from the access policy and, with Entra, your Entra assignment. They are checked on the server for every action.</p>
                </div>
              ) : (
                <>
                  <p className="text-[11.5px] font-medium tracking-wide text-ink-3 uppercase">Not signed in</p>
                  <p className="mt-1 text-[14px] font-semibold">{user?.name || 'No git identity'}</p>
                  <p className="mt-2 text-[12px] leading-[18px] text-ink-3">
                    Acting needs a sign-in. The local git name is shown for context only; it is not an authenticated user. {approvers === 0 ? 'No approver is enrolled.' : `${approvers} approver(s) are enrolled.`}
                  </p>
                </>
              )}
            </div>
            <Menu.Separator className="my-1 h-px bg-hairline" />
            <Menu.Label className="px-2.5 pt-1.5 pb-1 text-[11.5px] font-medium tracking-wide text-ink-3 uppercase">Appearance</Menu.Label>
            <Menu.RadioGroup value={theme} onValueChange={choose}>
              {(
                [
                  ['system', 'System', Monitor],
                  ['light', 'Light', Sun],
                  ['dark', 'Dark', Moon],
                ] as const
              ).map(([v, label, I]) => (
                <Menu.RadioItem key={v} value={v} className={item}>
                  <I aria-hidden className="size-4 text-ink-3" />
                  <span className="flex-1">{label}</span>
                  <Menu.ItemIndicator>
                    <Check aria-hidden className="size-4 text-accent" />
                  </Menu.ItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            {who?.roles.includes('administrator') ? (
              <Menu.Item asChild className={item}>
                <a href="/access" data-testid="access-link">
                  <ShieldCheck aria-hidden className="size-4 text-ink-3" />
                  Access review
                </a>
              </Menu.Item>
            ) : null}
            {who ? (
              <Menu.Item className={item} onSelect={() => void signOut()}>
                <LogOut aria-hidden className="size-4 text-ink-3" />
                Sign out
              </Menu.Item>
            ) : null}
            <Menu.Separator className="my-1 h-px bg-hairline" />
            <Menu.Item className={item} onSelect={() => setKeys(true)}>
              <Keyboard aria-hidden className="size-4 text-ink-3" />
              Keyboard shortcuts
            </Menu.Item>
            {repo.githubUrl ? (
              <Menu.Item asChild className={item}>
                <a href={repo.githubUrl} target="_blank" rel="noreferrer noopener">
                  <ExternalLink aria-hidden className="size-4 text-ink-3" />
                  Open repository on GitHub
                </a>
              </Menu.Item>
            ) : null}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>

      <Dialog.Root open={keys} onOpenChange={setKeys}>
        <Dialog.Portal>
          <Dialog.Overlay className="anim-fade fixed inset-0 z-50 bg-navy/40 backdrop-blur-[2px]" />
          <Dialog.Content className="anim-pop fixed top-[18vh] left-1/2 z-50 w-[440px] max-w-[calc(100vw-24px)] -translate-x-1/2 rounded-2xl bg-surface p-5" style={{ boxShadow: 'var(--shadow-sheet)' }}>
            <div className="flex items-start justify-between">
              <Dialog.Title className="text-[17px] font-semibold">Keyboard shortcuts</Dialog.Title>
              <Dialog.Close aria-label="Close" className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2">
                <X aria-hidden className="size-4" />
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">Keys that work anywhere in the Studio.</Dialog.Description>
            <dl className="mt-3 divide-y divide-hairline">
              {SHORTCUTS.map(([k, d]) => (
                <div key={k} className="flex items-center justify-between gap-4 py-2.5 text-[13.5px]">
                  <dt className="text-ink-2">{d}</dt>
                  <dd className="rounded-md border border-hairline-strong bg-surface-2 px-2 py-0.5 font-mono text-[12px] whitespace-nowrap">{k}</dd>
                </div>
              ))}
            </dl>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
