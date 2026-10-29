'use client';

import { AlertOctagon, RotateCw } from 'lucide-react';
import { btnPrimary } from './ui.tsx';

export function ErrorPanel({ title, message, code, onRetry }: { title: string; message: string; code?: string; onRetry?: () => void }) {
  return (
    <div role="alert" data-testid="error-panel" className="mx-auto mt-10 max-w-lg rounded-2xl border border-hairline bg-surface p-8 text-center">
      <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl text-[var(--s-rejected-fg)]" style={{ background: 'var(--s-rejected-bg)' }}>
        <AlertOctagon aria-hidden className="size-6" strokeWidth={1.75} />
      </span>
      <h1 className="text-[20px] font-semibold">{title}</h1>
      <p className="mt-2 text-[14.5px] text-ink-2">{message}</p>
      {code ? <p className="mt-2 font-mono text-[12px] text-ink-3">{code}</p> : null}
      <div className="mt-6 flex justify-center gap-2">
        <button type="button" onClick={onRetry ?? (() => window.location.reload())} className={btnPrimary}>
          <RotateCw aria-hidden className="size-4" />
          Try again
        </button>
      </div>
    </div>
  );
}
