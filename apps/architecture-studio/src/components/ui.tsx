'use client';

import { createContext, useCallback, useContext, useState, type ComponentType, type ReactNode } from 'react';
import { AlertTriangle, Bot, Check, CircleCheck, CircleDashed, CircleDot, CircleHelp, CircleMinus, CirclePause, CircleX, Copy, ExternalLink, GitBranch, OctagonAlert, Replace, type LucideProps } from 'lucide-react';
import { srcLink, type GitHubCtx } from '@/lib/links.ts';
import type { NormStatus, Verdict } from '@/lib/intel/schema.ts';
import { STATUS_LABEL, TASK_STATUS_LABEL, type DecisionStatus, type Src, type TaskStatus } from '@/lib/repo/types.ts';

const Ctx = createContext<GitHubCtx>({ githubUrl: null, links: {} });
export const GitHubProvider = ({ value, children }: { value: GitHubCtx; children: ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export const useGitHub = () => useContext(Ctx);

type Icon = ComponentType<LucideProps>;
interface Tone {
  fg: string;
  bg: string;
  icon: Icon;
}
const tone = (name: string, icon: Icon): Tone => ({ fg: `var(--s-${name}-fg)`, bg: `var(--s-${name}-bg)`, icon });

const DECISION_TONE: Record<DecisionStatus, Tone> = {
  open: tone('open', CircleDashed),
  proposed: tone('proposed', CircleDot),
  accepted: tone('accepted', CircleCheck),
  rejected: tone('rejected', CircleX),
  deferred: tone('deferred', CirclePause),
  superseded: tone('neutral', Replace),
};

const TASK_TONE: Record<TaskStatus, Tone> = {
  open: tone('open', CircleDashed),
  deferred: tone('deferred', CirclePause),
  approved: tone('accepted', CircleCheck),
  decided: tone('accepted', CircleCheck),
  done: tone('accepted', CircleCheck),
  agreed: tone('accepted', CircleCheck),
  'not-granted': tone('rejected', CircleMinus),
  unmarked: tone('neutral', CircleHelp),
};

export function Pill({ t, children, title }: { t: Tone; children: ReactNode; title?: string }) {
  const I = t.icon;
  return (
    <span title={title} className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium leading-5 whitespace-nowrap" style={{ color: t.fg, background: t.bg }}>
      <I aria-hidden className="size-3.5 shrink-0" strokeWidth={2.2} />
      {children}
    </span>
  );
}

export const StatusPill = ({ status, label }: { status: DecisionStatus; label?: string }) => <Pill t={DECISION_TONE[status]}>{label ?? STATUS_LABEL[status]}</Pill>;
export const TaskPill = ({ status }: { status: TaskStatus }) => <Pill t={TASK_TONE[status]}>{TASK_STATUS_LABEL[status]}</Pill>;
export const BlockedPill = ({ reason }: { reason?: string }) => (
  <Pill t={tone('blocked', OctagonAlert)} title={reason}>
    Blocked
  </Pill>
);
export const NeutralPill = ({ children, title }: { children: ReactNode; title?: string }) => <Pill t={tone('neutral', CircleMinus)} title={title}>{children}</Pill>;

const NORM_TONE: Record<NormStatus, Tone> = {
  Proposed: tone('proposed', CircleDot),
  'Pending Review': tone('open', CircleDashed),
  Approved: tone('accepted', CircleCheck),
  Rejected: tone('rejected', CircleX),
  Deferred: tone('deferred', CirclePause),
  Superseded: tone('neutral', Replace),
  Blocked: tone('blocked', OctagonAlert),
};
export const NormStatusPill = ({ status }: { status: NormStatus }) => <Pill t={NORM_TONE[status]}>{status}</Pill>;

const VERDICT_TONE: Record<Verdict, { t: Tone; label: string }> = {
  meets: { t: tone('accepted', CircleCheck), label: 'Meets' },
  conditional: { t: tone('open', CircleDashed), label: 'Conditional' },
  'does-not-meet': { t: tone('rejected', CircleX), label: 'Does not meet' },
  unknown: { t: tone('neutral', CircleHelp), label: 'Unknown' },
};
export const VerdictPill = ({ verdict }: { verdict: Verdict }) => <Pill t={VERDICT_TONE[verdict].t}>{VERDICT_TONE[verdict].label}</Pill>;

/** Marks AI-written material. It is always visible, never colour-only, and says what the material is not. */
export function AiBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border border-dashed border-hairline-strong bg-surface-2 px-1.5 py-px text-[10.5px] font-semibold tracking-wide whitespace-nowrap text-ink-2 uppercase ${className}`}>
      <Bot aria-hidden className="size-3" />
      AI suggestion · unreviewed · not evidence
    </span>
  );
}

/** A pill chosen by name, so server components can use it (they cannot pass icon functions to client components). */
export type ToneName = 'blocked' | 'neutral' | 'open' | 'accepted' | 'deferred' | 'rejected' | 'proposed';
const TONE_ICON: Record<ToneName, Icon> = { blocked: OctagonAlert, accepted: CircleCheck, open: CircleDashed, neutral: CircleMinus, deferred: CirclePause, rejected: CircleX, proposed: CircleDot };
export const TonePill = ({ name, children, title }: { name: ToneName; children: ReactNode; title?: string }) => <Pill t={tone(name, TONE_ICON[name])} title={title}>{children}</Pill>;

export function Tag({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center rounded-md border border-hairline bg-surface-2 px-1.5 py-px font-mono text-[11.5px] leading-5 text-ink-2">
      {children}
    </span>
  );
}

/** A link to the file on GitHub when a pushed commit holds an identical copy, otherwise an honest "local only" label. */
export function SourceLink({ src, className = '' }: { src: Src; className?: string }) {
  const ctx = useGitHub();
  const l = srcLink(ctx, src);
  const body = (
    <>
      <GitBranch aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate font-mono text-[12px]">{l.label}</span>
      {l.href ? <ExternalLink aria-hidden className="size-3 shrink-0" /> : null}
    </>
  );
  if (l.href)
    return (
      <a href={l.href} target="_blank" rel="noreferrer noopener" title={l.title} aria-label={`${l.label} on GitHub (opens in a new tab)`} className={`inline-flex max-w-full items-center gap-1.5 rounded-md text-accent hover:underline ${className}`}>
        {body}
      </a>
    );
  return (
    <span title={`${src.path}\n${l.title}`} className={`inline-flex max-w-full items-center gap-1.5 text-ink-3 ${className}`}>
      {body}
      <span className="rounded bg-[var(--s-open-bg)] px-1 text-[10.5px] font-semibold tracking-wide text-[var(--s-open-fg)] uppercase">{l.state === 'no-remote' ? 'No remote' : 'Local only'}</span>
    </span>
  );
}

export function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState<'idle' | 'ok' | 'fail'>('idle');
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone('ok');
    } catch {
      setDone('fail');
    }
    setTimeout(() => setDone('idle'), 1800);
  }, [text]);
  return (
    <button type="button" onClick={copy} className={`inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-surface px-2.5 py-1 text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-surface-2 ${className}`}>
      {done === 'ok' ? <Check aria-hidden className="size-3.5" /> : done === 'fail' ? <AlertTriangle aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
      <span aria-live="polite">{done === 'ok' ? 'Copied' : done === 'fail' ? 'Copy failed' : label}</span>
    </button>
  );
}

export function PageHeader({ title, lede, children }: { title: string; lede?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
      <div className="max-w-3xl">
        <h1 className="text-[28px] leading-9 font-semibold">{title}</h1>
        {lede ? <p className="mt-1 text-[15px] text-ink-2">{lede}</p> : null}
      </div>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </header>
  );
}

export function Section({ id, title, aside, children }: { id?: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-h` : undefined} className="mb-10 scroll-mt-24">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 id={id ? `${id}-h` : undefined} className="text-[19px] font-semibold">
          {title}
        </h2>
        {aside ? <div className="text-[13px] text-ink-3">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className = '', 'data-testid': testId }: { children: ReactNode; className?: string; 'data-testid'?: string }) {
  return <div data-testid={testId} className={`rounded-2xl border border-hairline bg-surface ${className}`}>{children}</div>;
}

export function EmptyState({ icon: I, title, children, action }: { icon: Icon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-center px-6 py-14 text-center">
      <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
        <I aria-hidden className="size-6" strokeWidth={1.75} />
      </span>
      <p className="text-[17px] font-semibold">{title}</p>
      {children ? <p className="mt-1 max-w-md text-[14px] text-ink-2">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export const btn = 'inline-flex items-center justify-center gap-2 rounded-lg border border-hairline-strong bg-surface px-3 py-1.5 text-[13.5px] font-medium text-ink transition-colors hover:bg-surface-2 active:bg-hairline disabled:opacity-50';
export const btnPrimary = 'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-3.5 py-1.5 text-[13.5px] font-medium text-accent-ink transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-50';

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

export function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] font-medium tracking-wide text-ink-3 uppercase">{label}</dt>
      <dd className="mt-0.5 text-[14px] text-ink">{children}</dd>
    </div>
  );
}
