import type { RepoMeta, Src } from './repo/types.ts';

export type LinkState = 'on-github' | 'local-only' | 'no-remote';

export interface GitHubCtx {
  githubUrl: string | null;
  links: Record<string, string | null>;
}

export interface SrcLink {
  href: string | null;
  state: LinkState;
  label: string;
  title: string;
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

/**
 * A permalink exists only when a pushed commit holds a byte-identical copy of the file, so the link always shows
 * what the Studio read. Otherwise the record is reported as local-only rather than linking to something different.
 */
export function srcLink(ctx: GitHubCtx, src: Src): SrcLink {
  const label = `${src.path.split('/').pop()}:${src.line}`;
  if (!ctx.githubUrl) return { href: null, state: 'no-remote', label, title: 'No GitHub remote is configured for this repository.' };
  const commit = ctx.links[src.path];
  if (!commit) return { href: null, state: 'local-only', label, title: 'This file, as read, is not on GitHub yet: no pushed commit holds an identical copy.' };
  return { href: `${ctx.githubUrl}/blob/${commit}/${encodePath(src.path)}#L${src.line}`, state: 'on-github', label, title: `Permalink at commit ${commit.slice(0, 7)}` };
}

export function repoCtx(repo: RepoMeta, links: Record<string, string | null>): GitHubCtx {
  return { githubUrl: repo.githubUrl, links };
}

export const approvalCommand = (kind: 'adr' | 'design-review', id: string): string => {
  const [type, subject] = kind === 'adr' ? (['adr', id.replace('ADR-', '')] as const) : (['review', id] as const);
  return `node harness/scripts/approval.mjs decision --type ${type} --id ${subject} --reason "<your reason>" --out docs/approvals/AP-${subject}.json`;
};
