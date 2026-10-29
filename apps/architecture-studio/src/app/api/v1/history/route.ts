import type { NextRequest } from 'next/server';
import { guard, ok, problem } from '@/lib/api.ts';
import { openAdapter } from '@/lib/repo/index.ts';

export const dynamic = 'force-dynamic';

/** Recent commits that touched one repository file. The path must exist in the tree at the commit being read. */
export function GET(req: NextRequest) {
  return guard(async () => {
    const p = req.nextUrl.searchParams.get('path') ?? '';
    if (!p || p.length > 300 || p.includes('..') || p.startsWith('/') || p.includes('\\')) return problem(400, 'Invalid path', 'A repository-relative path is required.');
    const git = openAdapter();
    if (!git.has(p)) return problem(404, 'Path not found', `No file at that path at commit ${git.commit.slice(0, 7)}.`);
    return ok({ path: p, commit: git.commit, entries: git.log(5, [p]).map((e) => ({ sha: e.sha, short: e.sha.slice(0, 7), date: e.date, author: e.author, subject: e.subject })) });
  });
}
