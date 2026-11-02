import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { RepoUnavailable } from '@/components/repo-unavailable.tsx';
import { AppShell, type ShellData } from '@/components/shell/app-shell.tsx';
import { LoginScreen } from '@/components/login-screen.tsx';
import { authorizeAccess } from '@/lib/auth/authorize.ts';
import { authConfig, authContextFor } from '@/lib/auth/config.ts';
import { serverSession } from '@/lib/auth/server.ts';
import { GitError, getModel } from '@/lib/repo/index.ts';
import { runtime } from '@/lib/workflow/http.ts';
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
  // In Entra mode nothing is rendered, and the repository is not even read, for someone who may not read.
  if (authConfig().mode === 'entra') {
    const rt = runtime();
    const s = await serverSession();
    const allowed = authorizeAccess(s?.user ?? null, 'read', authContextFor(rt.service.policy()));
    if (!allowed.ok) {
      return (
        <html lang="en" suppressHydrationWarning>
          <body>
            <LoginScreen reason={s ? (allowed.reason ?? 'You have no role in the Architecture Studio.') : 'Sign in to continue.'} entraConfigured={!!rt.entra} />
          </body>
        </html>
      );
    }
  }
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
      <body>
        {authConfig().mode === 'public-readonly' && (
          <div role="note" data-testid="public-readonly-banner" style={{ padding: '6px 12px', fontSize: 13, textAlign: 'center', background: 'var(--banner-bg, #fff4ce)', color: 'var(--banner-fg, #3b2f00)' }}>
            Public read-only view of the repository. There is no sign-in on this deployment, so nothing can be approved, proposed or changed here.
          </div>
        )}
        {shell ? <AppShell shell={shell}>{children}</AppShell> : <RepoUnavailable message={failure?.message ?? ''} code={failure?.code} />}
      </body>
    </html>
  );
}
