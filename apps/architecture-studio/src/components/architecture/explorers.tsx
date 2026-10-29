'use client';

import { useMemo, useState } from 'react';
import { Check, FileText, FilterX } from 'lucide-react';
import { useQueryState } from '@/lib/use-query-state.ts';
import type { Lookup } from '@/lib/lookup.ts';
import type { Assumption, Doc, EvidenceRun, Requirement, Risk } from '@/lib/repo/types.ts';
import { ChipGroup, SearchField, SelectField, Sheet, ToggleChip, rowNav } from '../explorer-kit.tsx';
import { RefChips, SourceBlock } from '../record-bits.tsx';
import { Card, EmptyState, Meta, NeutralPill, Pill, SourceLink, Tag, btn } from '../ui.tsx';

const hay = (...p: (string | undefined)[]) => p.join(' ').toLowerCase();
const matchAll = (text: string, h: string) => !text || text.split(/\s+/).every((t) => h.includes(t));

function Count({ shown, total, noun }: { shown: number; total: number; noun: string }) {
  return (
    <p role="status" aria-live="polite" className="mb-2 text-[13px] text-ink-3">
      Showing <span className="font-medium text-ink tnum">{shown}</span> of <span className="tnum">{total}</span> {noun}
    </p>
  );
}

function NoMatch({ onClear, noun }: { onClear: () => void; noun: string }) {
  return (
    <EmptyState icon={FilterX} title={`No ${noun} match`} action={<button type="button" onClick={onClear} className={btn}>Clear filters</button>}>
      Try fewer words or remove a filter.
    </EmptyState>
  );
}

// ---- requirements

export function RequirementsExplorer({ items, lookup }: { items: Requirement[]; lookup: Lookup }) {
  const qs = useQueryState();
  const text = qs.get('rq').trim().toLowerCase();
  const priorities = qs.list('rp');
  const group = qs.get('rg');
  const selId = qs.get('req');
  const filtered = useMemo(() => items.filter((r) => matchAll(text, hay(r.id, r.title, r.acceptance, r.justification, r.decisions.join(' '))) && (priorities.length === 0 || priorities.includes(r.priority)) && (!group || r.group === group)), [items, text, priorities, group]);
  const groups = [...new Set(items.map((r) => r.group))];
  const sel = selId ? items.find((r) => r.id === selId) : undefined;
  const clear = () => qs.set({ rq: null, rp: null, rg: null });
  const [limit, setLimit] = useState(25);
  const shown = text || priorities.length || group ? filtered : filtered.slice(0, limit);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-3">
        <SearchField value={qs.get('rq')} onChange={(v) => qs.set({ rq: v })} label="Search requirements" placeholder="Search requirement id or text" />
        <SelectField label="Group" value={group} onChange={(v) => qs.set({ rg: v })} options={[{ value: '', label: 'All groups' }, ...groups.map((g) => ({ value: g, label: g }))]} />
        <ChipGroup label="Priority" selected={priorities} onToggle={(p) => qs.set({ rp: (priorities.includes(p) ? priorities.filter((x) => x !== p) : [...priorities, p]).join(',') || null })} options={['Must', 'Should', 'Could'].map((p) => ({ value: p, label: p, count: items.filter((r) => r.priority === p).length }))} />
      </div>
      <Count shown={filtered.length} total={items.length} noun="requirements" />
      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <NoMatch onClear={clear} noun="requirements" />
        ) : (
          <div className="overflow-x-auto" onKeyDown={rowNav}>
            <table className="w-full min-w-[640px] text-left text-[13.5px]" data-testid="requirements-table">
              <caption className="sr-only">Requirements and the decisions they trace to</caption>
              <thead className="border-b border-hairline bg-surface-2 text-[12px] text-ink-3">
                <tr>
                  <th scope="col" className="w-[100px] py-2.5 pl-5 font-medium">ID</th>
                  <th scope="col" className="py-2.5 font-medium">Requirement</th>
                  <th scope="col" className="w-[80px] py-2.5 font-medium">Priority</th>
                  <th scope="col" className="hidden w-[130px] py-2.5 pr-5 font-medium md:table-cell">Decisions traced</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {shown.map((r) => (
                  <tr key={r.id} className={`hover:bg-surface-2 ${r.id === selId ? 'bg-accent-soft/60' : ''}`}>
                    <td className="py-2.5 pl-5 align-top"><Tag>{r.id}</Tag></td>
                    <td className="py-2.5 pr-4 align-top">
                      <button type="button" data-row-btn onClick={() => qs.set({ req: r.id }, 'push')} className="block w-full text-left"><span className="clamp-2">{r.title}</span></button>
                    </td>
                    <td className="py-2.5 pr-4 align-top text-ink-2">{r.priority}</td>
                    <td className="hidden py-2.5 pr-5 align-top text-ink-2 tnum md:table-cell">{r.decisions.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length < filtered.length ? (
              <div className="border-t border-hairline p-3 text-center">
                <button type="button" onClick={() => setLimit((n) => n + 25)} className={btn}>Show 25 more</button>
              </div>
            ) : null}
          </div>
        )}
      </Card>
      <Sheet open={!!sel} onClose={() => qs.set({ req: null })} title="Requirement">
        {sel ? (
          <article data-testid="requirement-detail" aria-label={`${sel.id} ${sel.title}`}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Tag>{sel.id}</Tag>
              <NeutralPill>{sel.priority}</NeutralPill>
              <span className="text-[12.5px] text-ink-3" title="A: stated in the case study. B: proposed architecture assumption. C: needs stakeholder clarification. D: needs verification.">Class {sel.cls}</span>
            </div>
            <h2 className="text-[20px] leading-[1.3] font-semibold">{sel.title}</h2>
            <dl className="mt-5 grid gap-4">
              <Meta label="Business justification">{sel.justification}</Meta>
              <Meta label="Acceptance criteria">{sel.acceptance}</Meta>
              <Meta label="Validation method">{sel.validation || 'Not recorded'}</Meta>
              <Meta label="Evidence required">{sel.evidenceRequired || 'Not recorded'}</Meta>
              <Meta label="Case-study source">{sel.traceSource || 'Not recorded'}</Meta>
            </dl>
            <section className="mt-6"><h3 className="mb-2 text-[13px] font-semibold text-ink-2">Related decisions</h3><RefChips ids={sel.decisions} lookup={lookup} empty="None recorded." /></section>
            <section className="mt-6"><h3 className="mb-2 text-[13px] font-semibold text-ink-2">Open stakeholder clarifications (C)</h3><RefChips ids={sel.openClarifications} lookup={lookup} empty="None recorded." /></section>
            <section className="mt-6"><h3 className="mb-2 text-[13px] font-semibold text-ink-2">Claims needing verification (D)</h3><RefChips ids={sel.verifyClaims} lookup={lookup} empty="None recorded." /></section>
            <section className="mt-6"><h3 className="mb-2 text-[13px] font-semibold text-ink-2">Depends on</h3><RefChips ids={sel.dependsOn} lookup={lookup} empty="None recorded." /></section>
            <div className="mt-8 border-t border-hairline pt-6"><SourceBlock src={sel.src} /></div>
          </article>
        ) : null}
      </Sheet>
    </div>
  );
}

// ---- risks

export function RisksExplorer({ items, lookup }: { items: Risk[]; lookup: Lookup }) {
  const qs = useQueryState();
  const text = qs.get('rk').trim().toLowerCase();
  const filtered = useMemo(() => items.filter((r) => matchAll(text, hay(r.id, r.title, r.cause, r.mitigation, r.owner, r.links))), [items, text]);
  return (
    <div>
      <div className="mb-3"><SearchField value={qs.get('rk')} onChange={(v) => qs.set({ rk: v })} label="Search risks" placeholder="Search risk id or text" /></div>
      <Count shown={filtered.length} total={items.length} noun="risks" />
      <Card className="overflow-hidden">
        {filtered.length === 0 ? <NoMatch onClear={() => qs.set({ rk: null })} noun="risks" /> : (
          <ul className="divide-y divide-hairline" data-testid="risk-list">
            {filtered.map((r) => (
              <li key={r.id} className="px-5 py-4">
                <div className="mb-1 flex flex-wrap items-center gap-2"><Tag>{r.id}</Tag><NeutralPill>{r.status}</NeutralPill><span className="text-[12.5px] text-ink-3">Impact {r.impact} · Likelihood {r.likelihood} · {r.owner}</span></div>
                <p className="text-[14.5px] font-medium">{r.title}</p>
                <p className="mt-1 text-[13px] leading-5 text-ink-2"><span className="text-ink-3">Mitigation: </span>{r.mitigation}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3"><RefChips ids={r.decisions} lookup={lookup} /><SourceLink src={r.src} /></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---- assumptions

export function AssumptionsExplorer({ items, lookup }: { items: Assumption[]; lookup: Lookup }) {
  const qs = useQueryState();
  const text = qs.get('as').trim().toLowerCase();
  const unresolvedOnly = qs.get('au') === '1';
  const filtered = useMemo(() => items.filter((a) => matchAll(text, hay(a.id, a.text, a.basis, a.replacedBy, a.riskIfWrong)) && (!unresolvedOnly || !a.resolved)), [items, text, unresolvedOnly]);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchField value={qs.get('as')} onChange={(v) => qs.set({ as: v })} label="Search assumptions" placeholder="Search assumption id or text" />
        <ToggleChip label="Unresolved only" pressed={unresolvedOnly} onToggle={() => qs.set({ au: unresolvedOnly ? null : '1' })} count={items.filter((a) => !a.resolved).length} />
      </div>
      <Count shown={filtered.length} total={items.length} noun="assumptions" />
      <Card className="overflow-hidden">
        {filtered.length === 0 ? <NoMatch onClear={() => qs.set({ as: null, au: null })} noun="assumptions" /> : (
          <ul className="divide-y divide-hairline" data-testid="assumption-list">
            {filtered.map((a) => (
              <li key={a.id} className="px-5 py-4">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Tag>{a.id}</Tag>
                  {a.resolved ? <Pill t={{ fg: 'var(--s-accepted-fg)', bg: 'var(--s-accepted-bg)', icon: Check }}>Replaced by an Accepted ADR</Pill> : <NeutralPill>Unresolved</NeutralPill>}
                  <span className="text-[12.5px] text-ink-3">Class B: proposed architecture assumption</span>
                </div>
                <p className="text-[14.5px] font-medium">{a.text}</p>
                <p className="mt-1 text-[13px] leading-5 text-ink-2"><span className="text-ink-3">Risk if wrong: </span>{a.riskIfWrong}</p>
                <p className="text-[13px] leading-5 text-ink-2"><span className="text-ink-3">How it will be validated: </span>{a.validation}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3"><span className="text-[12.5px] text-ink-3">Replaced by:</span><RefChips ids={a.replacedBy.match(/D-\d{3}/g) ?? []} lookup={lookup} />{!(a.replacedBy.match(/D-\d{3}/g) ?? []).length ? <span className="text-[13px] text-ink-2">{a.replacedBy || 'nothing named'}</span> : null}<SourceLink src={a.src} /></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---- evidence runs

export function EvidenceExplorer({ items, sealedThrough, sealedCount }: { items: EvidenceRun[]; sealedThrough: string | null; sealedCount: number | null }) {
  const qs = useQueryState();
  const text = qs.get('ev').trim().toLowerCase();
  const nonZero = qs.get('en') === '1';
  const filtered = useMemo(() => items.filter((e) => matchAll(text, hay(e.id, e.claim)) && (!nonZero || e.exitCode !== 0)), [items, text, nonZero]);
  const [limit, setLimit] = useState(15);
  const shown = text || nonZero ? filtered : filtered.slice(0, limit);
  const total = items.length;
  const bad = items.filter((e) => e.exitCode !== 0).length;
  return (
    <div>
      <p className="mb-3 max-w-3xl text-[14px] leading-6 text-ink-2">
        {total} recorded command runs. {bad} exited non-zero and were recorded on purpose, as evidence of what failed. {sealedThrough ? `The manifest is sealed through ${sealedThrough} (${sealedCount} records).` : 'No sealed manifest was found.'} The Studio lists these records; it does not re-verify their hashes.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchField value={qs.get('ev')} onChange={(v) => qs.set({ ev: v })} label="Search evidence runs" placeholder="Search run id or claim" />
        <ToggleChip label="Non-zero exit only" pressed={nonZero} onToggle={() => qs.set({ en: nonZero ? null : '1' })} count={bad} />
      </div>
      <Count shown={filtered.length} total={total} noun="runs" />
      <Card className="overflow-x-auto">
        {filtered.length === 0 ? <NoMatch onClear={() => qs.set({ ev: null, en: null })} noun="evidence runs" /> : (
          <>
            <table className="w-full min-w-[640px] text-left text-[13.5px]" data-testid="evidence-table">
              <caption className="sr-only">Recorded evidence runs</caption>
              <thead className="border-b border-hairline bg-surface-2 text-[12px] text-ink-3"><tr><th scope="col" className="w-[100px] py-2.5 pl-5 font-medium">Run</th><th scope="col" className="py-2.5 font-medium">Claim</th><th scope="col" className="w-[80px] py-2.5 font-medium">Exit</th><th scope="col" className="hidden w-[120px] py-2.5 pr-5 font-medium md:table-cell">Source</th></tr></thead>
              <tbody className="divide-y divide-hairline">
                {shown.map((e) => (
                  <tr key={e.id} className="hover:bg-surface-2">
                    <td className="py-2.5 pl-5 align-top"><Tag>{e.id}</Tag></td>
                    <td className="py-2.5 pr-4 align-top"><span className="clamp-2">{e.claim}</span></td>
                    <td className="py-2.5 pr-4 align-top tnum">{e.exitCode === 0 ? <span className="text-[var(--s-accepted-fg)]">0</span> : <span className="font-medium text-[var(--s-rejected-fg)]">{e.exitCode ?? 'none'}</span>}</td>
                    <td className="hidden py-2.5 pr-5 align-top md:table-cell"><SourceLink src={e.src} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length < filtered.length ? <div className="border-t border-hairline p-3 text-center"><button type="button" onClick={() => setLimit((n) => n + 15)} className={btn}>Show 15 more</button></div> : null}
          </>
        )}
      </Card>
    </div>
  );
}

// ---- documents

const AUTH_LABEL: Record<Doc['authority'], string> = { authoritative: 'Authoritative', derived: 'Derived', reference: 'Reference' };

export function DocumentsExplorer({ items }: { items: Doc[] }) {
  const qs = useQueryState();
  const text = qs.get('dq').trim().toLowerCase();
  const auth = qs.list('da');
  const area = qs.get('dr');
  const areas = [...new Set(items.map((d) => d.area))].sort();
  const filtered = useMemo(() => items.filter((d) => matchAll(text, hay(d.path, d.title)) && (auth.length === 0 || auth.includes(d.authority)) && (!area || d.area === area)), [items, text, auth, area]);
  const [limit, setLimit] = useState(30);
  const filtering = !!(text || auth.length || area);
  const shown = filtering ? filtered : filtered.slice(0, limit);
  return (
    <div>
      <p className="mb-3 max-w-3xl text-[14px] leading-6 text-ink-2">Authoritative files are the source of truth for decisions, tasks and approvals. Derived files are generated and are never edited by hand. Reference files explain and support.</p>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-3">
        <SearchField value={qs.get('dq')} onChange={(v) => qs.set({ dq: v })} label="Search documents" placeholder="Search path or title" />
        <SelectField label="Area" value={area} onChange={(v) => qs.set({ dr: v })} options={[{ value: '', label: 'All areas' }, ...areas.map((a) => ({ value: a, label: a }))]} />
        <ChipGroup label="Authority" selected={auth} onToggle={(a) => qs.set({ da: (auth.includes(a) ? auth.filter((x) => x !== a) : [...auth, a]).join(',') || null })} options={(['authoritative', 'derived', 'reference'] as const).map((a) => ({ value: a, label: AUTH_LABEL[a], count: items.filter((d) => d.authority === a).length }))} />
      </div>
      <Count shown={filtered.length} total={items.length} noun="documents" />
      <Card className="overflow-x-auto">
        {filtered.length === 0 ? <NoMatch onClear={() => qs.set({ dq: null, da: null, dr: null })} noun="documents" /> : (
          <>
            <ul className="divide-y divide-hairline" data-testid="document-list">
              {shown.map((d) => (
                <li key={d.path} className="flex items-start gap-3 px-5 py-3">
                  <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1"><span className="block text-[14px]">{d.title}</span><span className="block font-mono text-[12px] break-all text-ink-3">{d.path}</span></span>
                  <span className="hidden shrink-0 sm:block"><NeutralPill>{AUTH_LABEL[d.authority]}</NeutralPill></span>
                  <span className="hidden max-w-[130px] shrink-0 md:block"><SourceLink src={{ path: d.path, line: 1 }} /></span>
                </li>
              ))}
            </ul>
            {shown.length < filtered.length ? <div className="border-t border-hairline p-3 text-center"><button type="button" onClick={() => setLimit((n) => n + 30)} className={btn}>Show 30 more</button></div> : null}
          </>
        )}
      </Card>
    </div>
  );
}
