'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Lock, RotateCw, ShieldAlert } from 'lucide-react';
import type { BaselineView as View } from '@/lib/baseline/server.ts';
import type { AreaReadiness, Metric } from '@/lib/baseline/readiness.ts';
import type { AreaGate, BaselineState } from '@/lib/baseline/state.ts';
import { hintFor } from '@/lib/baseline/render.ts';
import { Card, CopyButton, Section, Skeleton, Tag, btn } from '../ui.tsx';

type Problem = { detail?: string };

/** An id in the text becomes a link to the record, so every reason can be followed to its source. */
function Linked({ id }: { id: string }) {
  if (/^(?:D-\d{3}|ADR-\d{4})$/.test(id)) return <Link href={`/decisions/${id}`} className="font-mono text-[12.5px] text-accent hover:underline">{id}</Link>;
  if (/^RV-\d{4}$/.test(id)) return <Link href="/architecture#reviews" className="font-mono text-[12.5px] text-accent hover:underline">{id}</Link>;
  if (/^(?:T\d+|B-\d+|R\d+b?|V-\d+|SF-\d+)$/.test(id)) return <Link href={`/queue?q=${id}`} className="font-mono text-[12.5px] text-accent hover:underline">{id}</Link>;
  return <span className="font-mono text-[12.5px]">{id}</span>;
}

const STATE_TONE: Record<string, string> = {
  approved: 'bg-[var(--s-accepted-bg)] text-[var(--s-accepted-fg)]',
  open: 'bg-[var(--s-accepted-bg)] text-[var(--s-accepted-fg)]',
  proposed: 'bg-[var(--s-open-bg)] text-[var(--s-open-fg)]',
  blocked: 'bg-[var(--s-rejected-bg)] text-[var(--s-rejected-fg)]',
  invalid: 'bg-[var(--s-rejected-bg)] text-[var(--s-rejected-fg)]',
  superseded: 'bg-surface-2 text-ink-2',
};
const Pill = ({ s, children }: { s: string; children: React.ReactNode }) => <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${STATE_TONE[s] ?? 'bg-surface-2 text-ink-2'}`}>{children}</span>;

function Verdict({ a, g, view }: { a: AreaReadiness; g: AreaGate; view: View }) {
  const open = g.state === 'open';
  return (
    <Card className="p-6" data-testid="verdict">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[19px] font-semibold tracking-[-0.01em]">{a.title}</h2>
        <Pill s={g.state}>{open ? 'Authorized' : 'Blocked'}</Pill>
        <span data-testid="verdict-state" className="sr-only">{g.state}</span>
      </div>
      <p className="mt-1 text-[13.5px] text-ink-2">
        Stage <span className="font-medium text-ink">{a.stage}</span>: {a.stageTitle}. Covers {a.paths.map((p) => <code key={p} className="mr-1 rounded bg-surface-2 px-1 font-mono text-[12px]">{p}</code>)}
      </p>
      <p className="mt-2 text-[13.5px] text-ink-2">
        {g.baseline ? <>Covered by baseline <span className="font-mono">{g.baseline.id}</span> v{g.baseline.version} ({g.baseline.status}, {g.baseline.currentness}).</> : 'No approved baseline covers this area.'}
        {view.readiness.signatures === 'not-verified' ? ' Review-record signatures were not checked here.' : ''}
      </p>
      {open ? (
        <p className="mt-4 flex items-start gap-2 text-[14px] leading-6"><CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--s-accepted-fg)]" />Every gate is met and an authorized baseline is current. CI will authorize this kind of work; it cannot stop a local edit.</p>
      ) : (
        <div className="mt-4">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink-2"><ShieldAlert aria-hidden className="size-4" />Why this is blocked ({g.reasons.length})</h3>
          <ol data-testid="reasons" className="mt-2 space-y-3 text-[13.5px] leading-6">
            {g.reasons.map((r, i) => (
              <li key={i} className="list-decimal pl-1 marker:text-ink-3 ml-5">
                <span>{r.text}</span>
                {r.refs.filter((x) => !x.includes('/')).length ? <span className="ml-2 inline-flex flex-wrap gap-1.5">{r.refs.filter((x) => !x.includes('/')).slice(0, 10).map((x) => <Linked key={x} id={x} />)}</span> : null}
                {hintFor(r.code) ? <p className="text-[12.5px] text-ink-3">To unblock: {hintFor(r.code)}</p> : null}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}

function Measures({ ms }: { ms: Metric[] }) {
  return (
    <Card className="overflow-x-auto">
      <table data-testid="measures" className="w-full min-w-[640px] text-left text-[13.5px]">
        <caption className="sr-only">Build-readiness measures for the selected area</caption>
        <thead>
          <tr className="border-b border-hairline text-[11.5px] tracking-wide text-ink-3 uppercase">
            <th scope="col" className="px-4 py-2.5">Measure</th>
            <th scope="col" className="px-3 py-2.5 text-right">Count</th>
            <th scope="col" className="px-3 py-2.5">Blocks this area</th>
            <th scope="col" className="px-4 py-2.5">Members and rule</th>
          </tr>
        </thead>
        <tbody>
          {ms.map((m) => (
            <tr key={m.id} data-testid={`measure-${m.id}`} data-count={m.count} className="border-b border-hairline align-top last:border-0">
              <th scope="row" className="px-4 py-2.5 font-medium">{m.label}</th>
              <td className="tnum px-3 py-2.5 text-right font-semibold">{m.count}</td>
              <td className="px-3 py-2.5">{m.blocks ? (m.count ? <span className="font-medium text-[var(--s-rejected-fg)]">Yes</span> : 'Would, if non-zero') : 'No: shown for information'}</td>
              <td className="px-4 py-2.5 text-ink-2">
                <details>
                  <summary className="cursor-pointer text-[12.5px] text-accent">{m.count ? `${m.count} member${m.count === 1 ? '' : 's'}` : 'None'} and the rule</summary>
                  {m.members.length ? <p className="mt-1.5 flex flex-wrap gap-1.5">{m.members.map((x) => <Linked key={x} id={x} />)}</p> : null}
                  <p className="mt-1.5 text-[12.5px] leading-5 text-ink-3">{m.rule}</p>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Baselines({ list }: { list: BaselineState[] }) {
  if (!list.length) return <p data-testid="no-baselines" className="text-[13.5px] leading-6 text-ink-2">No baseline exists. One is generated only when an area has nothing blocking it; it is then authorized by a person.</p>;
  return (
    <div data-testid="baselines" className="space-y-3">
      {list.map((b) => (
        <Card key={b.id} className="p-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-[14px] font-semibold">{b.id}</span>
            <span className="text-[13px] text-ink-3">v{b.version}</span>
            <Pill s={b.status}>{b.status}</Pill>
            {b.status === 'approved' ? <Tag>{b.currentness}</Tag> : null}
            <span className="text-[12.5px] text-ink-3">{b.scope?.areas.map((a) => `${a.id}@${a.stage}`).join(', ')}</span>
          </div>
          {b.commit ? <p className="mt-1.5 text-[12.5px] text-ink-3">Source commit <span className="font-mono">{b.commit.slice(0, 12)}</span>{b.authorization ? <> · authorized by approval <span className="font-mono">{b.authorization.approval}</span></> : ' · not authorized'}</p> : null}
          {b.problems.map((p) => <p key={p} className="mt-1.5 text-[13px] text-[var(--s-rejected-fg)]">{p}</p>)}
          {b.impacts.filter((i) => i.severity === 'invalidates').slice(0, 5).map((i, n) => <p key={n} className="mt-1.5 text-[13px]">Change: {i.text}{i.controlledBy ? ` (controlled by ${i.controlledBy})` : ' (not under an authorized reopening)'}</p>)}
          {b.reopenings.map((r) => <p key={r.id} className="mt-1.5 text-[13px]">Reopening <span className="font-mono">{r.id}</span>: {r.authorized ? 'authorized' : `no effect${r.problem ? ` (${r.problem})` : ''}`}</p>)}
        </Card>
      ))}
    </div>
  );
}

export function BaselineView() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [area, setArea] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch('/api/v1/baseline', { credentials: 'same-origin', cache: 'no-store' });
      const body = (await r.json().catch(() => null)) as (View & Problem) | null;
      if (!r.ok || !body) throw new Error(body?.detail ?? `HTTP ${r.status}`);
      setView(body);
      setArea((cur) => cur || new URLSearchParams(window.location.search).get('area') || body.readiness.areas[0]?.id || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The build-readiness view could not be loaded.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const choose = (id: string) => {
    setArea(id);
    const u = new URL(window.location.href);
    u.searchParams.set('area', id);
    window.history.replaceState(null, '', u);
  };

  if (error)
    return (
      <Card className="p-5">
        <div role="alert" data-testid="baseline-error" className="flex items-start gap-3 text-[13.5px] text-[var(--s-rejected-fg)]">
          <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">Build readiness could not be computed.</p>
            <p>{error}</p>
            <button type="button" className={`${btn} mt-3`} onClick={() => void load()}>
              <RotateCw aria-hidden className="size-3.5" />
              Retry
            </button>
          </div>
        </div>
      </Card>
    );
  if (!view)
    return (
      <div role="status" aria-busy="true" aria-label="Loading build readiness" className="space-y-4" data-testid="baseline-loading">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );

  if (!view.policy.valid)
    return (
      <Card className="p-6" data-testid="policy-invalid">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold"><Lock aria-hidden className="size-4" />Nothing is authorized: the baseline policy is invalid</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[13.5px] text-ink-2">{view.policy.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        <p className="mt-3 text-[12.5px] text-ink-3">A gate that cannot read its policy fails closed. The policy is harness/policy/baseline-policy.json, changed only by a reviewed pull request.</p>
      </Card>
    );

  const a = view.readiness.areas.find((x) => x.id === area) ?? view.readiness.areas[0]!;
  const g = view.gates.find((x) => x.area === a.id)!;
  return (
    <div data-testid="baseline-view" className="space-y-8">
      <div role="group" aria-label="Area" className="flex flex-wrap gap-2">
        {view.readiness.areas.map((x) => {
          const gate = view.gates.find((y) => y.area === x.id)!;
          return (
            <button key={x.id} type="button" data-testid={`area-${x.id}`} aria-pressed={x.id === a.id} onClick={() => choose(x.id)} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13.5px] font-medium ${x.id === a.id ? 'border-accent bg-accent-soft text-ink' : 'border-hairline-strong bg-surface hover:bg-surface-2'}`}>
              {x.title}
              <Pill s={gate.state}>{gate.state === 'open' ? 'Authorized' : 'Blocked'}</Pill>
            </button>
          );
        })}
      </div>

      <Verdict a={a} g={g} view={view} />

      <Section title="Build-readiness measures" aside={`${a.id}, at commit ${view.commit.slice(0, 7)}`}>
        <Measures ms={a.metrics} />
      </Section>

      <Section title="Gates" aside={`${a.gates.filter((x) => x.satisfied).length} of ${a.gates.length} met`}>
        <Card className="overflow-x-auto">
          <table data-testid="gates" className="w-full min-w-[640px] text-left text-[13.5px]">
            <caption className="sr-only">Gates this area needs at its stage</caption>
            <thead>
              <tr className="border-b border-hairline text-[11.5px] tracking-wide text-ink-3 uppercase">
                <th scope="col" className="px-4 py-2.5">Gate</th>
                <th scope="col" className="px-3 py-2.5">State</th>
                <th scope="col" className="px-4 py-2.5">Why, and where the gate comes from</th>
              </tr>
            </thead>
            <tbody>
              {a.gates.map((x) => (
                <tr key={x.id} data-testid={`gate-${x.id}`} data-satisfied={x.satisfied} className="border-b border-hairline align-top last:border-0">
                  <th scope="row" className="px-4 py-2.5 font-medium">{x.title}<span className="block font-mono text-[11.5px] font-normal text-ink-3">{x.id}</span></th>
                  <td className="px-3 py-2.5"><Pill s={x.satisfied ? 'open' : 'blocked'}>{x.satisfied ? 'Met' : 'Unmet'}</Pill></td>
                  <td className="px-4 py-2.5 text-ink-2">
                    {x.reasons.map((r, i) => <p key={i} className="mb-1 text-[13px]">{r.text}</p>)}
                    <p className="text-[12px] text-ink-3">Source: {x.source}</p>
                  </td>
                </tr>
              ))}
              {!a.gates.length ? <tr><td colSpan={3} className="px-4 py-6 text-center text-ink-3">This area names no gate.</td></tr> : null}
            </tbody>
          </table>
        </Card>
      </Section>

      <Section title="Required decisions" aside={`${a.requiredDecisions.length} for this area`}>
        {a.requiredDecisions.length === 0 ? (
          <p data-testid="no-required" className="text-[13.5px] text-ink-2">No decision is required at this stage.</p>
        ) : (
          <Card className="overflow-x-auto">
            <table data-testid="required-decisions" className="w-full min-w-[640px] text-left text-[13px]">
              <caption className="sr-only">Decisions required for the selected area</caption>
              <thead>
                <tr className="border-b border-hairline text-[11.5px] tracking-wide text-ink-3 uppercase">
                  <th scope="col" className="px-4 py-2.5">Decision</th>
                  <th scope="col" className="px-3 py-2.5">Status</th>
                  <th scope="col" className="px-3 py-2.5">Counts as approved</th>
                  <th scope="col" className="px-4 py-2.5">Required because</th>
                </tr>
              </thead>
              <tbody>
                {a.requiredDecisions.map((d) => (
                  <tr key={d.id} className="border-b border-hairline align-top last:border-0">
                    <th scope="row" className="px-4 py-2 font-normal"><Linked id={d.id} /><span className="block max-w-[34ch] truncate text-ink-2">{d.title}</span></th>
                    <td className="px-3 py-2">{d.status}</td>
                    <td className="px-3 py-2">{d.approved ? 'Yes' : 'No'}<span className="block text-[12px] text-ink-3">{d.basis}</span></td>
                    <td className="px-4 py-2 text-ink-2">{d.requiredBy.join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        {a.deferredNonBlocking.length ? (
          <p data-testid="deferred-nonblocking" className="mt-3 text-[13px] leading-6 text-ink-2">
            Deferred and not blocking this area ({a.deferredNonBlocking.length}): {a.deferredNonBlocking.map((d) => <span key={d.id} className="mr-2"><Linked id={d.id} /></span>)}
          </p>
        ) : null}
      </Section>

      <Section title="Baselines" aside={`${view.baselines.length} on the repository`}>
        <Baselines list={view.baselines} />
      </Section>

      <Section title="How a baseline is authorized">
        <Card className="p-5" data-testid="authorize-steps">
          <p className="text-[13.5px] leading-6 text-ink-2">The Studio does not generate, authorize or reopen a baseline. It shows what is true. A person does these steps at their own computer, and CI checks them.</p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-[13px] leading-6">
            {[
              ['Generate (refused unless every gate is met)', `node apps/architecture-studio/scripts/baseline.ts generate --id BL-0001 --areas ${a.id}`],
              ['Read SUMMARY.md and its caveats, then request the approval', 'node harness/scripts/approval.mjs decision --type baseline --id BL-0001 --reason "<why>" --out <file outside the repository>'],
              ['Sign it with an architecture-class key, then commit the record to docs/approvals/ in a pull request', 'node harness/scripts/approval.mjs sign --file <that file> --key <your key>'],
              ['Verify what CI will see', 'node apps/architecture-studio/scripts/baseline.ts verify --id BL-0001'],
            ].map(([what, cmd]) => (
              <li key={what}>
                {what}
                <span className="mt-1 flex items-start gap-2"><code className="min-w-0 flex-1 rounded bg-surface-2 px-2 py-1 font-mono text-[12px] break-all">{cmd}</code><CopyButton text={cmd!} /></span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[12.5px] leading-5 text-ink-3">Authorizing a baseline does not raise the phase; both are needed. Changing an approved decision afterwards, without an authorized reopening, blocks the area. CI can stop a pull request or a workflow from being authorized; it cannot stop an edit on a local computer.</p>
        </Card>
      </Section>
    </div>
  );
}
