import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { RepoUnavailable } from '@/components/repo-unavailable.tsx';
import { AppShell, type ShellData } from '@/components/shell/app-shell.tsx';
import { GitError, getModel } from '@/lib/repo/index.ts';
import { repoCtx } from '@/lib/links.ts';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Architecture Studio', template: '%s · Architecture Studio' },
  description: 'A read-only view of the architecture decisions, tasks, approvals and evidence in the GreenFuel agent harness repository.',
};

export const viewport: Viewport = { themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f4f6f9' }, { media: '(prefers-color-scheme: dark)', color: '#0a141e' }] };

export const dynamic = 'force-dynamic';

// Applies the saved theme before first paint so there is no flash.
const THEME_SCRIPT = `try{var t=localStorage.getItem('studio:theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  let shell: ShellData | null = null;
  let failure: { message: string; code?: string } | null = null;
  try {
    const m = await getModel();
    shell = {
      repo: m.repo,
      counts: { decisions: m.metrics.decisions.pending, queue: m.metrics.tasks.blocked, approvals: m.metrics.approvals.outstanding },
      attention: m.attention,
      approvers: m.approvals.enrolledApprovers,
      totalRecords: m.decisions.length + m.tasks.length + m.requirements.length + m.risks.length + m.assumptions.length + m.docs.length,
      gh: repoCtx(m.repo, m.links),
    };
  } catch (e) {
    failure = e instanceof GitError ? { message: e.message, code: e.code } : { message: 'The Studio could not read the repository.' };
  }
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{shell ? <AppShell shell={shell}>{children}</AppShell> : <RepoUnavailable message={failure?.message ?? ''} code={failure?.code} />}</body>
    </html>
  );
}
