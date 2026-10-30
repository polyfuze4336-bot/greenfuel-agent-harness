import type { NextRequest } from 'next/server';
import { guard, ok, problem } from '@/lib/api.ts';
import { openAdapter } from '@/lib/repo/index.ts';

export const dynamic = 'force-dynamic';

const ALLOWED_PREFIX = ['docs/', 'harness/policy/', 'harness/scripts/'];
const ALLOWED_EXT = /\.(md|json|csv|txt|mjs|cjs|ts|yml|yaml)$/i;
const MAX_BYTES = 600_000;

/** Read-only source preview: lines of a tracked file at the commit being read, with the highlighted line. */
export function GET(req: NextRequest) {
  return guard(async () => {
    const p = req.nextUrl.searchParams.get('path') ?? '';
    const line = Math.max(1, Number(req.nextUrl.searchParams.get('line') ?? 1) || 1);
    const context = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('context') ?? 25) || 25));
    if (!p || p.length > 300 || p.includes('..') || p.startsWith('/') || p.includes('\\') || !ALLOWED_PREFIX.some((x) => p.startsWith(x)) || !ALLOWED_EXT.test(p)) return problem(400, 'Path not allowed', 'Only documentation and policy files can be previewed.');
    const git = openAdapter();
    if (!git.has(p)) return problem(404, 'Path not found', `No file at that path at commit ${git.commit.slice(0, 7)}.`);
    // An earlier version is served only for a commit that is in this file's own history.
    const at = req.nextUrl.searchParams.get('at');
    let commit = git.commit;
    let blob = git.oid(p);
    let text = git.read(p) ?? '';
    if (at) {
      if (!/^[0-9a-f]{40}$/.test(at) || !git.log(50, [p]).some((c) => c.sha === at)) return problem(404, 'Version not found', 'That commit is not in the history of this file.');
      const old = git.readAt(at, p);
      if (old === undefined) return problem(404, 'Version not found', 'The file does not exist at that commit.');
      commit = at;
      blob = undefined;
      text = old;
    }
    if (text.length > MAX_BYTES) return problem(413, 'File too large', 'The file is too large to preview.');
    const all = text.split('\n');
    const start = Math.max(1, line - context);
    const end = Math.min(all.length, line + context);
    return ok({ path: p, commit, blob: blob ?? '', totalLines: all.length, start, end, highlight: line, lines: all.slice(start - 1, end).map((t, i) => ({ n: start + i, text: t.slice(0, 600) })) });
  });
}
