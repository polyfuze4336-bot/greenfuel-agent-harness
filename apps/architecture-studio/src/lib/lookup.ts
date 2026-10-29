import type { StudioModel } from './repo/types.ts';

export interface LookupEntry {
  title: string;
  href: string;
  kind: 'decision' | 'task' | 'requirement' | 'risk' | 'assumption' | 'review';
}
export type Lookup = Record<string, LookupEntry>;

/** id -> title and in-app link, so any record can render its connections without carrying whole objects. */
export function buildLookup(m: StudioModel): Lookup {
  const l: Lookup = {};
  for (const d of m.decisions) l[d.id] = { title: d.title, href: `/decisions?id=${encodeURIComponent(d.id)}`, kind: 'decision' };
  for (const t of m.tasks) l[t.id] = { title: t.title, href: `/queue?id=${encodeURIComponent(t.id)}`, kind: 'task' };
  for (const r of m.requirements) l[r.id] = { title: r.title, href: `/architecture?rq=${encodeURIComponent(r.id)}#requirements`, kind: 'requirement' };
  for (const r of m.risks) l[r.id] = { title: r.title, href: `/architecture?rk=${encodeURIComponent(r.id)}#risks`, kind: 'risk' };
  for (const a of m.assumptions) l[a.id] = { title: a.text, href: `/architecture?as=${encodeURIComponent(a.id)}#assumptions`, kind: 'assumption' };
  for (const r of m.reviews) l[r.id] = { title: r.title, href: '/architecture#reviews', kind: 'review' };
  return l;
}
