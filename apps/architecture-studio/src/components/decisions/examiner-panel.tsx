'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bot, Check, Clipboard, Info, RotateCw, ShieldAlert } from 'lucide-react';
import { BASIS_LABEL, BASIS_MEANING, type AiClaim, type Basis, type ExaminerDossier, type ExaminerEntry } from '@/lib/examiner/types.ts';
import { AiBadge, SourceLink, Skeleton } from '../ui.tsx';

const TONE: Record<Basis, { fg: string; bg: string }> = {
  'verified-fact': { fg: 'var(--s-accepted-fg)', bg: 'var(--s-accepted-bg)' },
  'approved-decision': { fg: 'var(--s-accepted-fg)', bg: 'var(--s-accepted-bg)' },
  'proposed-interpretation': { fg: 'var(--s-proposed-fg)', bg: 'var(--s-proposed-bg)' },
  'unverified-assumption': { fg: 'var(--s-open-fg)', bg: 'var(--s-open-bg)' },
  'ai-generated': { fg: 'var(--s-neutral-fg)', bg: 'var(--s-neutral-bg)' },
};

/** Which kind of statement this is. Always words, never colour alone. */
function BasisBadge({ basis }: { basis: Basis }) {
  const t = TONE[basis];
  return (
    <span title={BASIS_MEANING[basis]} data-testid="basis" data-basis={basis} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-4 font-semibold whitespace-nowrap ${basis === 'ai-generated' ? 'border border-dashed border-hairline-strong' : ''}`} style={{ color: t.fg, background: t.bg }}>
      {basis === 'ai-generated' ? <Bot aria-hidden className="size-3" /> : null}
      {BASIS_LABEL[basis]}
    </span>
  );
}

function Entry({ e }: { e: ExaminerEntry }) {
  return (
    <li className="py-2.5" data-testid="examiner-entry">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <BasisBadge basis={e.basis} />
        {e.note ? <span className="text-[11.5px] text-ink-3">{e.note}</span> : null}
      </div>
      <p className="text-[13.5px] leading-5 text-ink">{e.text}</p>
      {e.sources.length ? (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          {e.sources.slice(0, 3).map((s) => <SourceLink key={`${s.path}:${s.line}`} src={s} />)}
        </div>
      ) : null}
    </li>
  );
}

function Claim({ c }: { c: AiClaim }) {
  return (
    <li className="py-2.5" data-testid="ai-claim" data-supported={c.supported}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <AiBadge />
        {c.supported ? <span className="text-[11.5px] text-ink-3">Every citation checked out</span> : <span className="rounded-full bg-[var(--s-rejected-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--s-rejected-fg)]">Unsupported: not verified</span>}
        {c.injection ? <span className="rounded-full bg-[var(--s-open-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--s-open-fg)]">Instruction-like text, treated as data</span> : null}
      </div>
      <p className="text-[13.5px] leading-5 text-ink">{c.text}</p>
      <ul className="mt-1 space-y-0.5 text-[12px] text-ink-3">
        {c.evidence.length === 0 ? <li>No citation given.</li> : null}
        {c.evidence.map((v, i) => (
          <li key={i}>
            {v.verified ? <SourceLink src={{ path: v.path, line: v.line ?? 1 }} /> : <span className="font-mono">{v.path || '(no path)'}{v.line ? `:${v.line}` : ''}</span>}
            {v.problem ? <span className="ml-2 text-[var(--s-rejected-fg)]">{v.problem}</span> : null}
          </li>
        ))}
      </ul>
    </li>
  );
}

const POSITION_NOTE: Record<ExaminerDossier['headline']['position'], string> = {
  'Not ready to defend': 'The record has gaps a panel would find at once.',
  'Defensible with conditions': 'Defensible if the listed conditions are met.',
  'Defensible on the record': 'No gap is recorded. That is not proof it is right.',
  'Not an architecture decision': 'It is settled by a fact or a verification, not by choosing.',
};

export function ExaminerPanel({ id }: { id: string }) {
  const [d, setD] = useState<ExaminerDossier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');

  useEffect(() => {
    const ctl = new AbortController();
    setD(null);
    setError(null);
    fetch(`/api/v1/decisions/${encodeURIComponent(id)}/examiner`, { signal: ctl.signal, credentials: 'same-origin' })
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as (ExaminerDossier & { detail?: string }) | null;
        if (!r.ok || !body || !('sections' in body)) throw new Error(body?.detail ?? `HTTP ${r.status}`);
        setD(body);
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError') setError(e instanceof Error ? e.message : 'Could not load the challenge.');
      });
    return () => ctl.abort();
  }, [id, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const copy = useCallback(async () => {
    if (!d) return;
    try {
      await navigator.clipboard.writeText(d.prompt);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
    setTimeout(() => setCopied('idle'), 2000);
  }, [d]);

  if (error)
    return (
      <div role="alert" className="flex items-center gap-3 rounded-xl bg-[var(--s-rejected-bg)] px-3.5 py-3 text-[13px] text-[var(--s-rejected-fg)]">
        <AlertTriangle aria-hidden className="size-4 shrink-0" />
        <span className="flex-1">The challenge could not be loaded: {error}</span>
        <button type="button" onClick={retry} className="inline-flex items-center gap-1 font-medium underline">
          <RotateCw aria-hidden className="size-3.5" />
          Retry
        </button>
      </div>
    );
  if (!d)
    return (
      <div role="status" aria-busy="true" aria-label="Loading challenge" data-testid="examiner-loading" className="space-y-2">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );

  const aiBySection = (key: string) => (d.ai?.claims ?? []).filter((c) => c.section === key);
  const unsupported = (d.ai?.claims ?? []).filter((c) => !c.supported);

  return (
    <div data-testid="examiner-panel">
      <div className="rounded-xl border border-hairline bg-surface-2 px-4 py-3" data-testid="examiner-position">
        <p className="text-[12px] text-ink-3">The Examiner&rsquo;s position</p>
        <p className="text-[18px] leading-7 font-semibold tracking-[-0.01em]">{d.headline.position}</p>
        <p className="text-[12.5px] leading-5 text-ink-3">{POSITION_NOTE[d.headline.position]} This is not an approval or a recommendation to approve. A person decides.</p>
        {d.headline.reasons.length ? <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px] leading-5 text-ink-2">{d.headline.reasons.map((r, i) => <li key={i}>{r.text}</li>)}</ul> : null}
      </div>

      <section className="mt-4" aria-labelledby="against-h">
        <h3 id="against-h" className="mb-1 text-[13px] font-semibold text-ink-2">The strongest argument against</h3>
        <ul className="rounded-xl border border-hairline px-3.5" data-testid="examiner-headline"><Entry e={d.headline.counterArgument} /></ul>
      </section>

      {d.injection.length ? (
        <div role="note" data-testid="injection-warning" className="mt-4 flex gap-2.5 rounded-xl px-3.5 py-3 text-[13px] leading-5" style={{ background: 'var(--s-open-bg)', color: 'var(--s-open-fg)' }}>
          <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="block font-semibold">Instruction-like text was found in the source ({d.injection.length})</span>
            It was treated as data. It changed nothing here and was removed from the prompt. First: {d.injection[0]!.where}, “{d.injection[0]!.excerpt}”
          </span>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-1.5" data-testid="basis-legend" aria-label="What kind of statement each line is">
        {(Object.keys(BASIS_LABEL) as Basis[]).map((b) => (
          <span key={b} className="inline-flex items-center gap-1.5 text-[12px] text-ink-3">
            <BasisBadge basis={b} />
            <span className="tnum">{d.basisCounts[b]}</span>
          </span>
        ))}
      </div>

      <div className="mt-4 divide-y divide-hairline rounded-xl border border-hairline" data-testid="examiner-sections">
        {d.sections.filter((s) => s.key !== 'against').map((s) => {
          const ai = aiBySection(s.key);
          return (
            <details key={s.key} data-section={s.key}>
              <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 text-[13.5px] [&::-webkit-details-marker]:hidden">
                <span className="font-medium">{s.title}</span>
                <span className="tnum text-ink-3">{s.entries.length}{ai.length ? ` + ${ai.length} AI` : ''}</span>
              </summary>
              <div className="border-t border-hairline px-3.5">
                {s.empty ? <p className="py-3 text-[13px] text-ink-3 italic">{s.empty}</p> : <ul className="divide-y divide-hairline">{s.entries.map((e, i) => <Entry key={i} e={e} />)}</ul>}
                {ai.filter((c) => c.supported).length ? <ul className="divide-y divide-hairline border-t border-hairline">{ai.filter((c) => c.supported).map((c, i) => <Claim key={i} c={c} />)}</ul> : null}
              </div>
            </details>
          );
        })}
      </div>

      {d.ai ? (
        <section className="mt-5" data-testid="ai-challenge">
          <h3 className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-ink-2">
            AI challenge on file
            <AiBadge />
          </h3>
          <p className="text-[12px] leading-5 text-ink-3">
            Written by {d.ai.agent} using {d.ai.tool} on {d.ai.date}. Unreviewed. Its citations were checked against the repository: {d.ai.claims.filter((c) => c.supported).length} of {d.ai.claims.length} claim(s) check out and are shown in their sections above. <SourceLink src={{ path: d.ai.path, line: 1 }} />
          </p>
          {unsupported.length ? (
            <details className="mt-2 rounded-xl border border-[var(--s-rejected-fg)]/40" data-testid="ai-unsupported">
              <summary className="cursor-pointer px-3.5 py-2.5 text-[13px] font-medium text-[var(--s-rejected-fg)]">Unsupported claims, not verified ({unsupported.length})</summary>
              <ul className="divide-y divide-hairline border-t border-hairline px-3.5">{unsupported.map((c, i) => <Claim key={i} c={c} />)}</ul>
            </details>
          ) : null}
          {d.ai.notAssessed.length ? <p className="mt-2 text-[12px] text-ink-3">Not assessed by the critic: {d.ai.notAssessed.join('; ')}</p> : null}
          {d.ai.problems.length ? <p className="mt-2 text-[12px] text-[var(--s-open-fg)]">Skipped when reading the file: {d.ai.problems.join('; ')}</p> : null}
        </section>
      ) : null}

      <section className="mt-5">
        <h3 className="mb-1 text-[13px] font-semibold text-ink-2">Run the critic</h3>
        <p className="text-[12.5px] leading-5 text-ink-3">The Studio cannot call the Copilot agents itself. This prepares the request for the <span className="font-mono">architecture-critic</span> and <span className="font-mono">principal-architect</span> agents in VS Code. Their answer appears above only after a person merges it and its citations check out.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={copy} data-testid="copy-prompt" className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-surface-2">
            {copied === 'ok' ? <Check aria-hidden className="size-3.5" /> : <Clipboard aria-hidden className="size-3.5" />}
            <span aria-live="polite">{copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy failed' : 'Copy prompt for the critic'}</span>
          </button>
        </div>
        <details className="mt-2 rounded-xl border border-hairline">
          <summary className="cursor-pointer px-3.5 py-2 text-[12.5px] font-medium">Show the prompt</summary>
          <pre data-testid="critic-prompt" className="max-h-72 overflow-auto border-t border-hairline px-3.5 py-2.5 font-mono text-[11.5px] leading-5 whitespace-pre-wrap text-ink-2">{d.prompt}</pre>
        </details>
      </section>

      <details className="mt-5 rounded-xl border border-hairline">
        <summary className="flex cursor-pointer items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-medium"><Info aria-hidden className="size-4" />Limits of this challenge</summary>
        <ul className="list-disc space-y-1 border-t border-hairline px-3.5 py-3 pl-8 text-[12.5px] leading-5 text-ink-2" data-testid="examiner-limits">{d.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </details>
      <p className="mt-4 text-[11.5px] text-ink-3">At commit <span className="font-mono">{d.commit.slice(0, 7)}</span>.</p>
    </div>
  );
}
