import type { StudioModel } from './repo/types.ts';

export type SearchKind = 'decision' | 'task' | 'requirement' | 'risk' | 'assumption' | 'document';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  href: string;
  external?: boolean;
}

interface Entry extends SearchHit {
  haystack: string;
  idLower: string;
  titleLower: string;
}

const entry = (h: SearchHit, text: string): Entry => ({ ...h, haystack: `${h.id} ${h.title} ${text}`.toLowerCase(), idLower: h.id.toLowerCase(), titleLower: h.title.toLowerCase() });

export function buildIndex(m: StudioModel): Entry[] {
  const out: Entry[] = [];
  for (const d of m.decisions) out.push(entry({ kind: 'decision', id: d.id, title: d.title, subtitle: `${d.type === 'adr' ? 'ADR' : 'Open decision'} · ${d.statusRaw.split(/[ (]/)[0]}`, href: `/decisions?id=${encodeURIComponent(d.id)}` }, `${d.summary} ${d.owner ?? ''} ${d.milestone ?? ''}`));
  for (const t of m.tasks) out.push(entry({ kind: 'task', id: t.id, title: t.title, subtitle: `${t.family === 'roadmap' ? 'Roadmap' : 'Owner task'} · ${t.status}${t.blocked ? ' · blocked' : ''}`, href: `/queue?id=${encodeURIComponent(t.id)}` }, `${t.detail} ${t.blocks}`));
  for (const r of m.requirements) out.push(entry({ kind: 'requirement', id: r.id, title: r.title, subtitle: `Requirement · ${r.priority}`, href: `/architecture?rq=${encodeURIComponent(r.id)}#requirements` }, `${r.acceptance} ${r.justification}`));
  for (const r of m.risks) out.push(entry({ kind: 'risk', id: r.id, title: r.title, subtitle: `Risk · ${r.status}`, href: `/architecture?rk=${encodeURIComponent(r.id)}#risks` }, `${r.cause} ${r.mitigation}`));
  for (const a of m.assumptions) out.push(entry({ kind: 'assumption', id: a.id, title: a.text, subtitle: `Assumption · ${a.resolved ? 'resolved' : 'unresolved'}`, href: `/architecture?as=${encodeURIComponent(a.id)}#assumptions` }, `${a.basis} ${a.riskIfWrong}`));
  for (const d of m.docs) out.push(entry({ kind: 'document', id: d.path, title: d.title, subtitle: `Document · ${d.authority}`, href: `/architecture?dq=${encodeURIComponent(d.path)}#documents` }, ''));
  return out;
}

const rank = (e: Entry, tokens: string[]): number => {
  let score = 0;
  for (const t of tokens) {
    if (e.idLower === t) score += 100;
    else if (e.idLower.startsWith(t)) score += 60;
    else if (e.titleLower.includes(t)) score += 30;
    else if (e.haystack.includes(t)) score += 10;
    else return -1;
  }
  return score;
};

export function search(m: StudioModel, query: string, kinds?: SearchKind[], limit = 40): SearchHit[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!tokens.length) return [];
  return buildIndex(m)
    .filter((e) => !kinds || kinds.includes(e.kind))
    .map((e) => ({ e, s: rank(e, tokens) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.e.id.localeCompare(b.e.id))
    .slice(0, limit)
    .map(({ e }) => ({ kind: e.kind, id: e.id, title: e.title, subtitle: e.subtitle, href: e.href }));
}
