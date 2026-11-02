'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { tabActive, tabsFor } from './nav.ts';

/** The pages inside Decisions or Changes. Plain links, so each page keeps its own address and the back button works. */
export function SectionTabs() {
  const pathname = usePathname();
  const found = tabsFor(pathname);
  if (!found) return null;
  return (
    <nav aria-label="Section" data-testid="section-tabs" className="-mt-2 mb-6 overflow-x-auto border-b border-hairline">
      <ul className="flex min-w-max gap-1">
        {found.tabs.map((t) => {
          const active = tabActive(pathname, t);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={`relative block px-3 pt-2 pb-2.5 text-[13.5px] transition-colors ${active ? 'font-semibold text-ink after:absolute after:inset-x-3 after:bottom-[-1px] after:h-[2px] after:rounded-full after:bg-accent' : 'text-ink-2 hover:text-ink'}`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
