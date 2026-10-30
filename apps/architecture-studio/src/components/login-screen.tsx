'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, LogIn } from 'lucide-react';
import { btnPrimary } from './ui.tsx';

// Plain reasons for the sign-in codes. The code itself is also shown so a failure can be matched to the audit log.
const REASON: Record<string, string> = {
  'no-access': 'You signed in to Microsoft, but you have no role in the Architecture Studio. Ask an Administrator to assign you one.',
  'policy-invalid': 'The access policy is not trusted by this server, so nobody can sign in until it is fixed.',
  'not-configured': 'Microsoft Entra sign-in is not configured on this server.',
  'idp-unreachable': 'Microsoft Entra ID could not be reached. Try again in a moment.',
  'idp-refused': 'Microsoft Entra ID did not complete the sign-in.',
  'unknown-state': 'That sign-in was not started here, has expired, or was already used. Start again.',
  'browser-mismatch': 'That sign-in was started in a different browser. Start again in this one.',
  'stale-login': 'A fresh sign-in was required and the one received was not recent. Sign in again.',
  'bad-tenant': 'That account belongs to a different tenant than this Studio accepts.',
};

export function LoginScreen({ reason, entraConfigured }: { reason: string; entraConfigured: boolean }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(new URLSearchParams(window.location.search).get('error'));
  }, []);
  const next = typeof window === 'undefined' ? '/' : window.location.pathname === '/login' ? '/' : window.location.pathname;
  return (
    <main className="mx-auto grid min-h-screen max-w-[440px] place-items-center px-6">
      <div data-testid="login-screen" className="w-full rounded-2xl border border-hairline bg-surface p-8" style={{ boxShadow: 'var(--shadow-sheet)' }}>
        <h1 className="text-[22px] font-semibold tracking-tight">Architecture Decision Studio</h1>
        <p className="mt-2 text-[14px] leading-6 text-ink-2">Sign in with your Microsoft work account. What you can see and do depends on the role assigned to you, and the server checks it on every request.</p>
        {error ? (
          <p role="alert" data-testid="login-error" className="mt-4 flex gap-2 rounded-xl px-3.5 py-2.5 text-[13.5px] leading-5" style={{ background: 'var(--s-rejected-bg)', color: 'var(--s-rejected-fg)' }}>
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              {REASON[error] ?? 'Sign-in could not be completed.'} <span className="font-mono text-[12px]">({error.slice(0, 40).replace(/[^a-z0-9-]/gi, '')})</span>
            </span>
          </p>
        ) : (
          <p role="status" className="mt-4 text-[13px] leading-5 text-ink-3">
            {reason}
          </p>
        )}
        {entraConfigured ? (
          <a data-testid="login-button" href={`/api/v1/auth/entra/login?next=${encodeURIComponent(next)}`} className={`${btnPrimary} mt-6 w-full justify-center`}>
            <LogIn aria-hidden className="size-4" />
            Sign in with Microsoft
          </a>
        ) : (
          <p role="alert" className="mt-6 text-[13px] leading-5 text-[var(--s-rejected-fg)]">
            Microsoft Entra ID is not configured on this server, so sign-in is unavailable. An operator must set the STUDIO_ENTRA_* settings.
          </p>
        )}
      </div>
    </main>
  );
}
