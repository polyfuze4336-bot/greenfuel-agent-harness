import { Compass, Layers3, ListChecks, Presentation, Scale, ShieldCheck, type LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Key into the live counts passed from the repository, if the item has a meaningful count. */
  count?: 'decisions' | 'queue' | 'approvals';
  countLabel?: string;
}

export const NAV: NavItem[] = [
  { href: '/', label: 'Overview', icon: Compass },
  { href: '/decisions', label: 'Decision Register', icon: Scale, count: 'decisions', countLabel: 'pending decisions' },
  { href: '/queue', label: 'Work Queue', icon: ListChecks, count: 'queue', countLabel: 'blocked tasks' },
  { href: '/approvals', label: 'Approvals', icon: ShieldCheck, count: 'approvals', countLabel: 'outstanding approvals' },
  { href: '/architecture', label: 'Architecture & Evidence', icon: Layers3 },
  { href: '/presentation', label: 'Presentation Studio', icon: Presentation },
];

export const isActive = (pathname: string, href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));
