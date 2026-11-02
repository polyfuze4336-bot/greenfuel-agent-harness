import { Compass, GitPullRequest, Presentation, Scale, type LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Key into the live counts passed from the repository, if the item has a meaningful count. */
  count?: 'decisions' | 'approvals';
  countLabel?: string;
  /** Pages that belong to this destination without being primary navigation. They keep their own addresses. */
  also?: string[];
  /** Go-to shortcut: press g, then this key. */
  key: string;
}

/** The four places the Studio is organised around. Everything else is reached from inside one of them. */
export const NAV: NavItem[] = [
  { href: '/', label: 'Overview', icon: Compass, key: 'o' },
  { href: '/decisions', label: 'Decisions', icon: Scale, count: 'decisions', countLabel: 'pending decisions', also: ['/queue', '/architecture'], key: 'd' },
  { href: '/changes', label: 'Changes', icon: GitPullRequest, count: 'approvals', countLabel: 'outstanding approvals', also: ['/approvals', '/baseline'], key: 'c' },
  { href: '/presentation', label: 'Presentation', icon: Presentation, key: 'p' },
];

export interface SectionTab {
  href: string;
  label: string;
  /** Other paths that keep this tab current, for example a sub-page of it. */
  alsoActive?: string[];
}

/** The pages inside a destination. Shown as tabs only on the pages themselves, never on a single record. */
export const SECTION_TABS: Record<string, SectionTab[]> = {
  '/decisions': [
    { href: '/decisions', label: 'Register' },
    { href: '/queue', label: 'Work queue', alsoActive: ['/queue/blocking'] },
    { href: '/architecture', label: 'Architecture & evidence' },
  ],
  '/changes': [
    { href: '/changes', label: 'Updates' },
    { href: '/approvals', label: 'Approvals' },
    { href: '/baseline', label: 'Readiness' },
  ],
};

const within = (pathname: string, href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));

export const isActive = (pathname: string, item: Pick<NavItem, 'href' | 'also'>) => within(pathname, item.href) || (item.also ?? []).some((h) => within(pathname, h));

/** The tabs to show for this page, or null when the page is a record or has no section. */
export function tabsFor(pathname: string): { section: string; tabs: SectionTab[] } | null {
  for (const [section, tabs] of Object.entries(SECTION_TABS)) {
    if (tabs.some((t) => pathname === t.href || (t.alsoActive ?? []).includes(pathname))) return { section, tabs };
  }
  return null;
}

export const tabActive = (pathname: string, t: SectionTab) => pathname === t.href || (t.alsoActive ?? []).includes(pathname);
