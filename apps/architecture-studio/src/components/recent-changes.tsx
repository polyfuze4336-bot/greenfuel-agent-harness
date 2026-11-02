import { GitCommitHorizontal } from 'lucide-react';
import { QuietEmpty } from './quiet-empty.tsx';
import { utcDate } from '@/lib/format.ts';
import type { CommitInfo } from '@/lib/repo/types.ts';

/** Commits from the repository, newest first. Shared by the Overview and the Changes page, so both tell the same story. */
export function RecentChanges({ commits }: { commits: CommitInfo[] }) {
  if (commits.length === 0) return <QuietEmpty icon={GitCommitHorizontal} title="No commits to show">The repository history could not be read at this commit.</QuietEmpty>;
  return (
    <ul className="divide-y divide-hairline" data-testid="recent-changes">
      {commits.map((c) => (
        <li key={c.sha} className="flex items-start gap-4 px-5 py-3 text-[13.5px]">
          <span className="w-[60px] shrink-0 pt-px font-mono text-[12.5px] text-ink-3">{c.short}</span>
          <span className="min-w-0 flex-1">
            <span className="block">{c.subject}</span>
            <span className="block text-[12px] text-ink-3">{utcDate(c.date)}</span>
          </span>
          {c.localOnly ? <span className="rounded bg-[var(--s-open-bg)] px-1.5 text-[10.5px] leading-5 font-semibold tracking-wide whitespace-nowrap text-[var(--s-open-fg)] uppercase">Not pushed</span> : null}
        </li>
      ))}
    </ul>
  );
}
