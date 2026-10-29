'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, GitCompareArrows, RefreshCw, TriangleAlert } from 'lucide-react';
import { FIELD_LABEL, type ChangeSet, type DuplicateCandidate, type RegisterStats, type ValidationIssue } from '@/lib/intel/schema.ts';
import { Card, NeutralPill, Skeleton, btn, btnPrimary } from '../ui.tsx';
import { SelectField } from '../explorer-kit.tsx';

interface Props {
  stats: RegisterStats;
  validation: { checked: number; valid: number; issues: ValidationIssue[] };
  duplicates: DuplicateCandidate[];
  suggestionCount: number;
  commit: string;
  refs: string[];
  warnings: string[];
}

type Load<T> = { s: 'idle' } | { s: 'loading' } | { s: 'error'; message: string } | { s: 'ok'; data: T };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const body = (await r.json().catch(() => null)) as (T & { detail?: string }) | null;
  if (!r.ok || !body) throw new Error((body as { detail?: string } | null)?.detail ?? `HTTP ${r.status}`);
  return body;
}

function Changes({ c }: { c: ChangeSet }) {
  if (c.initial)
    return (
      <p role="status" className="text-[13.5px] text-ink-2">
        First synchronisation: {c.counts.added} records were read and saved as the baseline. Future syncs report what changed against it.
      </p>
    );
  const none = c.records.length === 0 && c.files.length === 0;
  return (
    <div data-testid="changes-result">
      <p role="status" className="mb-3 text-[13.5px] text-ink-2">
        {c.fromCommit ? (
          <>
            From <span className="font-mono">{c.fromCommit.slice(0, 7)}</span> to <span className="font-mono">{c.toCommit.slice(0, 7)}</span>:{' '}
          </>
        ) : null}
        <strong className="text-ink">{c.counts.added}</strong> added, <strong className="text-ink">{c.counts.changed}</strong> changed, <strong className="text-ink">{c.counts.removed}</strong> removed, {c.counts.unchanged} unchanged
        {c.counts.alerts ? (
          <>
            , <strong className="text-[var(--s-rejected-fg)]">{c.counts.alerts} alert(s)</strong>
          </>
        ) : null}
        .
      </p>
      {none ? <p className="text-[13.5px] text-ink-3">The register and its source files are unchanged.</p> : null}
      <ul className="space-y-2">
        {c.records.map((r) => (
          <li key={r.id} className="rounded-xl border border-hairline px-3.5 py-2.5 text-[13px] leading-5">
            <span className="flex flex-wrap items-center gap-2">
              <Link href={`/decisions?id=${r.id}`} className="font-mono text-[12.5px] font-medium text-accent hover:underline">
                {r.id}
              </Link>
              <NeutralPill>{r.kind}</NeutralPill>
              <span className="min-w-0 flex-1 truncate text-ink-2">{r.title}</span>
            </span>
            {r.alerts.map((a) => (
              <span key={a} className="mt-1.5 flex items-start gap-2 rounded-lg px-2.5 py-1.5" style={{ background: 'var(--s-rejected-bg)', color: 'var(--s-rejected-fg)' }}>
                <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                {a}
              </span>
            ))}
            {r.fields.length ? (
              <ul className="mt-1.5 space-y-0.5 text-ink-3">
                {r.fields.slice(0, 8).map((f) => (
                  <li key={f.field}>
                    <span className="text-ink-2">{FIELD_LABEL[f.field] ?? f.field}</span>: {f.from} → {f.to}
                  </li>
                ))}
                {r.fields.length > 8 ? <li>and {r.fields.length - 8} more fields</li> : null}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
      {c.files.length ? (
        <details className="mt-3 rounded-xl border border-hairline">
          <summary className="cursor-pointer px-3.5 py-2 text-[13px] font-medium">{c.files.length} source file(s) differ</summary>
          <ul className="space-y-0.5 border-t border-hairline px-3.5 py-2 font-mono text-[12px] text-ink-2">
            {c.files.map((f) => (
              <li key={f.path}>
                <span className="text-ink-3">{f.change}</span> {f.path}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function RegisterHealth({ stats, validation, duplicates, suggestionCount, commit, refs, warnings }: Props) {
  const [against, setAgainst] = useState(refs[0] ?? '');
  const [res, setRes] = useState<Load<ChangeSet>>({ s: 'idle' });
  const [baseline, setBaseline] = useState<{ commit: string; savedAt: string } | null | undefined>(undefined);

  const loadBaseline = useCallback(() => {
    call<{ baseline: { commit: string; savedAt: string } | null }>('/api/v1/register/sync')
      .then((b) => setBaseline(b.baseline))
      .catch(() => setBaseline(null));
  }, []);
  useEffect(loadBaseline, [loadBaseline]);

  const run = async (fn: () => Promise<ChangeSet | null>) => {
    setRes({ s: 'loading' });
    try {
      const data = await fn();
      setRes(data ? { s: 'ok', data } : { s: 'error', message: 'No baseline exists yet. Use "Sync now" to create one.' });
    } catch (e) {
      setRes({ s: 'error', message: e instanceof Error ? e.message : 'Request failed.' });
    }
  };
  const compare = () => run(async () => (await call<{ changes: ChangeSet }>(`/api/v1/register/changes?from=${encodeURIComponent(against)}`)).changes);
  const sinceSync = () => run(async () => (await call<{ changes: ChangeSet | null }>('/api/v1/register/changes')).changes);
  const sync = () =>
    run(async () => {
      const r = await call<{ changes: ChangeSet }>('/api/v1/register/sync', { method: 'POST' });
      loadBaseline();
      return r.changes;
    });

  const total = stats.total;
  const fields = Object.entries(stats.populated);
  const invalid = validation.checked - validation.valid;

  return (
    <Card className="mb-6 overflow-hidden" data-testid="register-health">
      <div className="grid gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Records', `${total}`, `${stats.byKind.adr} ADRs and ${stats.byKind['register-entry']} register entries, read at ${commit.slice(0, 7)}`],
          ['Schema validation', `${validation.valid} of ${validation.checked} valid`, invalid ? `${validation.issues.length} issue(s) to fix` : 'Every populated field has a source; every empty field is declared'],
          ['Overlap candidates', `${duplicates.length}`, duplicates.length ? 'For a person to review; nothing is merged' : 'No duplicate, collision or supersession gap found'],
          ['AI suggestions', `${suggestionCount}`, 'Unreviewed, kept apart from the record'],
        ].map(([k, v, c]) => (
          <div key={k} className="bg-surface px-5 py-4">
            <p className="text-[12.5px] font-medium text-ink-2">{k}</p>
            <p className="mt-0.5 text-[20px] leading-7 font-semibold tracking-[-0.01em] tnum" data-testid={`health-${String(k).split(' ')[0]!.toLowerCase()}`}>
              {v}
            </p>
            <p className="mt-0.5 text-[12px] leading-[18px] text-ink-3">{c}</p>
          </div>
        ))}
      </div>

      {warnings.length ? (
        <div className="flex gap-2.5 border-t border-hairline px-5 py-3 text-[13px] leading-5" style={{ background: 'var(--s-open-bg)', color: 'var(--s-open-fg)' }}>
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="divide-y divide-hairline border-t border-hairline">
        <details>
          <summary className="cursor-pointer px-5 py-3 text-[13.5px] font-medium">How complete is the register? (fields populated from a source)</summary>
          <div className="px-5 pb-4">
            <p className="mb-2 max-w-3xl text-[12.5px] leading-5 text-ink-3">A field is filled only when a repository file states it. The rest stay empty and are listed on each decision; the Studio does not fill gaps.</p>
            <table className="w-full max-w-2xl text-left text-[12.5px]" data-testid="completeness-table">
              <caption className="sr-only">Number of records with each field populated</caption>
              <tbody>
                {fields.map(([f, n]) => (
                  <tr key={f}>
                    <th scope="row" className="w-[240px] py-1 pr-3 font-normal text-ink-2">
                      {FIELD_LABEL[f] ?? f}
                    </th>
                    <td className="py-1 pr-3">
                      <div className="h-1.5 w-full rounded-full bg-hairline" aria-hidden>
                        <div className="h-1.5 rounded-full bg-accent" style={{ width: `${(n / total) * 100}%` }} />
                      </div>
                    </td>
                    <td className="w-[70px] py-1 text-right tnum">
                      {n} of {total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        {duplicates.length ? (
          <details>
            <summary className="cursor-pointer px-5 py-3 text-[13.5px] font-medium">Duplicate and overlap candidates ({duplicates.length})</summary>
            <ul className="space-y-2 px-5 pb-4" data-testid="overlap-list">
              {duplicates.map((d, i) => (
                <li key={i} className="rounded-xl border border-hairline px-3.5 py-2.5 text-[13px] leading-5">
                  <span className="flex flex-wrap items-center gap-2">
                    <NeutralPill>{d.kind}</NeutralPill>
                    <Link href={`/decisions?id=${d.a}`} className="font-mono text-[12.5px] text-accent hover:underline">
                      {d.a}
                    </Link>
                    {d.a !== d.b ? (
                      <>
                        <span className="text-ink-3">and</span>
                        <Link href={`/decisions?id=${d.b}`} className="font-mono text-[12.5px] text-accent hover:underline">
                          {d.b}
                        </Link>
                      </>
                    ) : null}
                    <span className="text-ink-3">score {d.score}</span>
                  </span>
                  <span className="mt-1 block text-ink-2">{d.reasons.join('; ')}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <details>
          <summary className="cursor-pointer px-5 py-3 text-[13.5px] font-medium">Repository changes and synchronisation</summary>
          <div className="px-5 pb-5">
            <p className="mb-3 max-w-3xl text-[12.5px] leading-5 text-ink-3">
              Compare the register with another commit, or synchronise to save a baseline and see what changed since. Synchronisation re-reads only source files whose git blob changed and saves its baseline in the Studio&apos;s own cache folder; the repository is never touched.
              {baseline ? (
                <>
                  {' '}
                  Last sync: commit <span className="font-mono">{baseline.commit.slice(0, 7)}</span> at <span data-testid="baseline-time">{baseline.savedAt.slice(0, 16).replace('T', ' ')} UTC</span>.
                </>
              ) : baseline === null ? (
                ' No sync has been saved yet.'
              ) : null}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <SelectField label="Compare with" value={against} onChange={setAgainst} options={refs.map((r) => ({ value: r, label: r }))} />
              <button type="button" onClick={compare} disabled={!against || res.s === 'loading'} className={btn}>
                <GitCompareArrows aria-hidden className="size-4" />
                Show changes
              </button>
              <button type="button" onClick={sinceSync} disabled={res.s === 'loading'} className={btn}>
                Changes since last sync
              </button>
              <button type="button" onClick={sync} disabled={res.s === 'loading'} className={btnPrimary}>
                <RefreshCw aria-hidden className={`size-4 ${res.s === 'loading' ? 'animate-spin' : ''}`} />
                Sync now
              </button>
            </div>
            <div className="mt-4" aria-live="polite">
              {res.s === 'loading' ? (
                <div role="status" aria-busy="true" aria-label="Comparing" className="space-y-2">
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                </div>
              ) : res.s === 'error' ? (
                <div role="alert" className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px]" style={{ background: 'var(--s-rejected-bg)', color: 'var(--s-rejected-fg)' }}>
                  <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {res.message}
                </div>
              ) : res.s === 'ok' ? (
                <Changes c={res.data} />
              ) : null}
            </div>
          </div>
        </details>
      </div>
    </Card>
  );
}
