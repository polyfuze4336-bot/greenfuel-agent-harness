'use client';

import * as Popover from '@radix-ui/react-popover';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Bell, CircleAlert, Info, OctagonAlert } from 'lucide-react';
import type { Attention } from '@/lib/repo/types.ts';

const KEY = 'studio:read-notifications';

export function Notifications({ items, commit }: { items: Attention[]; commit: string }) {
  const [read, setRead] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const stamp = (a: Attention) => `${commit.slice(0, 7)}:${a.id}:${a.title}`;
  useEffect(() => {
    try {
      setRead(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]);
    } catch {
      setRead([]);
    }
  }, []);
  const persist = useCallback((next: string[]) => {
    setRead(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next.slice(-200)));
    } catch {
      /* private mode: read state simply is not remembered */
    }
  }, []);
  const unread = items.filter((a) => !read.includes(stamp(a)));
  const icon = (l: Attention['level']) => (l === 'critical' ? <OctagonAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--s-rejected-fg)]" /> : l === 'warning' ? <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--s-open-fg)]" /> : <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--s-proposed-fg)]" />);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" aria-label={`Notifications, ${unread.length} unread`} className="relative grid size-9 place-items-center rounded-lg border border-hairline-strong bg-surface text-ink-2 transition-colors hover:bg-surface-2">
          <Bell aria-hidden className="size-[18px]" />
          {unread.length > 0 ? <span className="absolute -top-1.5 -right-1.5 grid min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[11px] leading-[18px] font-semibold text-accent-ink tnum">{unread.length}</span> : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="anim-pop z-50 w-[420px] max-w-[calc(100vw-24px)] rounded-2xl bg-surface" style={{ boxShadow: 'var(--shadow-pop)' }}>
          <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <div>
              <p className="text-[15px] font-semibold">Needs attention</p>
              <p className="text-[12.5px] text-ink-3">Derived from the repository. Nothing here is a message from a person.</p>
            </div>
            <button type="button" disabled={unread.length === 0} onClick={() => persist([...read, ...items.map(stamp)])} className="rounded-md px-2 py-1 text-[13px] font-medium text-accent hover:bg-accent-soft disabled:text-ink-3 disabled:hover:bg-transparent">
              Mark all as read
            </button>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-[14px] text-ink-2">Nothing needs attention at this commit.</p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-hairline overflow-y-auto">
              {items.map((a) => {
                const isRead = read.includes(stamp(a));
                return (
                  <li key={a.id}>
                    <Link href={a.href} onClick={() => { persist([...new Set([...read, stamp(a)])]); setOpen(false); }} className="flex gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
                      {icon(a.level)}
                      <span className="min-w-0">
                        <span className={`block text-[13.5px] ${isRead ? 'font-normal text-ink-2' : 'font-semibold text-ink'}`}>
                          {a.title}
                          {isRead ? null : <span className="sr-only"> (unread)</span>}
                        </span>
                        <span className="block text-[12.5px] leading-5 text-ink-3">{a.detail}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
