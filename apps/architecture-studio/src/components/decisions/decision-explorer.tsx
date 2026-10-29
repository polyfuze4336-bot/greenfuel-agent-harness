'use client';

import Link from 'next/link';
import { useCallback, useMemo } from 'react';
import { ArrowUpRight, FilterX, Inbox } from 'lucide-react';
import { useQueryState } from '@/lib/use-query-state.ts';
import { adrTypeLabel } from '@/lib/format.ts';
import { STATUSES, type DuplicateCandidate, type NormStatus, type NormalizedDecision, type Suggestion } from '@/lib/intel/schema.ts';
import type { Lookup } from '@/lib/lookup.ts';
import { ChipGroup, SearchField, SelectField, Sheet, SortHeader, ToggleChip, rowNav } from '../explorer-kit.tsx';
import { Card, EmptyState, NormStatusPill, SourceLink, Tag, btn } from '../ui.tsx';
import { DecisionDetail } from './decision-detail.tsx';

const rank = (s: NormStatus) => STATUSES.indexOf(s);
const PRI = { Must: 3, Should: 2, Could: 1 } as const;

type GroupKey = 'none' | 'status' | 'type' | 'category' | 'priority' | 'milestone' | 'owner';
const groupOf = (d: NormalizedDecision, g: GroupKey): string => {
  switch (g) {
    case 'status':
      return d.status;
    case 'type':
      return d.kind === 'adr' ? 'Architecture decision records' : 'Open register entries';
    case 'category':
      return d.category ? adrTypeLabel(d.category) : 'No category stated';
    case 'priority':
      return d.priority ? d.priority.value : 'No priority (no requirement traces to it)';
    case 'milestone':
      return d.milestone ? `Needed by ${d.milestone}` : 'No milestone (ADRs)';
    case 'owner':
      return (d.decisionOwner ?? 'No owner stated').replace(/\(.*\)/, '').trim().slice(0, 70);
    default:
      return '';
  }
};

const cmp = (a: NormalizedDecision, b: NormalizedDecision, sort: string): number => {
  switch (sort) {
    case 'status':
      return rank(a.status) - rank(b.status);
    case 'priority':
      return (PRI[b.priority?.value as keyof typeof PRI] ?? 0) - (PRI[a.priority?.value as keyof typeof PRI] ?? 0);
    case 'milestone':
      return (a.milestone ?? 'ZZ').localeCompare(b.milestone ?? 'ZZ');
    case 'title':
      return a.title.localeCompare(b.title);
    case 'type':
      return a.kind.localeCompare(b.kind);
    default:
      return a.id.localeCompare(b.id, 'en', { numeric: true });
  }
};

function matches(d: NormalizedDecision, text: string): boolean {
  if (!text) return true;
  const hay = `${d.id} ${d.title} ${d.description ?? ''} ${d.businessJustification ?? ''} ${d.decisionOwner ?? ''} ${d.statusRaw} ${d.milestone ?? ''} ${d.category ?? ''} ${d.options.map((o) => o.name).join(' ')}`.toLowerCase();
  return text.split(/\s+/).every((t) => hay.includes(t));
}

export function DecisionExplorer({ records, duplicates, suggestions, lookup }: { records: NormalizedDecision[]; duplicates: DuplicateCandidate[]; suggestions: Suggestion[]; lookup: Lookup }) {
  const qs = useQueryState();
  const text = qs.get('q').trim().toLowerCase();
  const statuses = qs.list('status');
  const type = qs.get('type');
  const milestone = qs.get('milestone');
  const priority = qs.get('priority');
  const category = qs.get('category');
  const scope = qs.get('scope');
  const group = (qs.get('group') || 'none') as GroupKey;
  const sort = qs.get('sort') || 'id';
  const dir: 'asc' | 'desc' = qs.get('dir') === 'desc' ? 'desc' : 'asc';
  const selectedId = qs.get('id');

  const dupIds = useMemo(() => new Set(duplicates.flatMap((d) => (d.a === d.b ? [d.a] : [d.a, d.b]))), [duplicates]);
  const sugIds = useMemo(() => new Set(suggestions.map((s) => s.decisionId)), [suggestions]);
  const categories = useMemo(() => [...new Set(records.flatMap((d) => (d.category ? [adrTypeLabel(d.category)] : [])))].sort(), [records]);

  const baseFilter = useCallback(
    (d: NormalizedDecision) =>
      matches(d, text) &&
      (!type || d.kind === type) &&
      (!milestone || d.milestone === milestone) &&
      (!priority || (priority === 'none' ? !d.priority : d.priority?.value === priority)) &&
      (!category || (d.category ? adrTypeLabel(d.category) === category : false)) &&
      (scope !== 'gate' || d.relatedReviews.length > 0) &&
      (scope !== 'review' || d.flags.length > 0) &&
      (scope !== 'duplicate' || dupIds.has(d.id)) &&
      (scope !== 'suggestions' || sugIds.has(d.id)) &&
      (scope !== 'missing' || d.missing.length > 0),
    [text, type, milestone, priority, category, scope, dupIds, sugIds],
  );

  const counts = useMemo(() => {
    const c = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<NormStatus, number>;
    for (const d of records) if (baseFilter(d)) c[d.status]++;
    return c;
  }, [records, baseFilter]);

  const filtered = useMemo(() => {
    const out = records.filter((d) => baseFilter(d) && (statuses.length === 0 || statuses.includes(d.status)));
    out.sort((a, b) => (cmp(a, b, sort) || cmp(a, b, 'id')) * (dir === 'asc' ? 1 : -1));
    return out;
  }, [records, baseFilter, statuses, sort, dir]);

  const groups = useMemo(() => {
    if (group === 'none') return [{ name: '', items: filtered }];
    const map = new Map<string, NormalizedDecision[]>();
    for (const d of filtered) {
      const k = groupOf(d, group);
      map.set(k, [...(map.get(k) ?? []), d]);
    }
    const entries = [...map.entries()];
    if (group === 'status') entries.sort((a, b) => rank(a[1][0]!.status) - rank(b[1][0]!.status));
    else entries.sort((a, b) => a[0].localeCompare(b[0]));
    return entries.map(([name, items]) => ({ name, items }));
  }, [filtered, group]);

  const filtersActive = !!(text || statuses.length || type || milestone || priority || category || scope);
  const clear = () => qs.set({ q: null, status: null, type: null, milestone: null, priority: null, category: null, scope: null });
  const toggleStatus = (s: string) => qs.set({ status: (statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s]).join(',') || null });
  const toggleScope = (s: string) => qs.set({ scope: scope === s ? null : s });
  const onSort = (f: string) => qs.set(sort === f ? { dir: dir === 'asc' ? 'desc' : 'asc' } : { sort: f === 'id' ? null : f, dir: null });
  const selected = selectedId ? records.find((d) => d.id === selectedId) : undefined;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <SearchField value={qs.get('q')} onChange={(v) => qs.set({ q: v })} label="Search decisions" placeholder="Search id, title, owner, text" />
        <SelectField label="Type" value={type} onChange={(v) => qs.set({ type: v })} options={[{ value: '', label: 'All types' }, { value: 'adr', label: 'ADRs' }, { value: 'register-entry', label: 'Open register entries' }]} />
        <SelectField label="Priority" value={priority} onChange={(v) => qs.set({ priority: v })} options={[{ value: '', label: 'Any priority' }, { value: 'Must', label: 'Must' }, { value: 'Should', label: 'Should' }, { value: 'Could', label: 'Could' }, { value: 'none', label: 'None traced' }]} />
        <SelectField label="Category" value={category} onChange={(v) => qs.set({ category: v })} options={[{ value: '', label: 'Any category' }, ...categories.map((c) => ({ value: c, label: c.length > 42 ? `${c.slice(0, 41)}…` : c }))]} />
        <SelectField label="Needed by" value={milestone} onChange={(v) => qs.set({ milestone: v })} options={[{ value: '', label: 'Any milestone' }, { value: 'M1', label: 'M1' }, { value: 'M2', label: 'M2' }]} />
        <SelectField label="Group by" value={group} onChange={(v) => qs.set({ group: v === 'none' ? null : v })} options={[{ value: 'none', label: 'No grouping' }, { value: 'status', label: 'Status' }, { value: 'type', label: 'Type' }, { value: 'category', label: 'Category' }, { value: 'priority', label: 'Priority' }, { value: 'milestone', label: 'Milestone' }, { value: 'owner', label: 'Owner or decider' }]} />
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2.5">
        <ChipGroup label="Status" selected={statuses} onToggle={toggleStatus} options={STATUSES.map((s) => ({ value: s, label: s, count: counts[s] }))} />
        <div role="group" aria-label="Scope" className="flex flex-wrap items-center gap-1.5">
          <ToggleChip label="Gates a design review" pressed={scope === 'gate'} onToggle={() => toggleScope('gate')} />
          <ToggleChip label="Flagged for review" pressed={scope === 'review'} onToggle={() => toggleScope('review')} />
          <ToggleChip label="Duplicate or overlap candidate" pressed={scope === 'duplicate'} onToggle={() => toggleScope('duplicate')} />
          <ToggleChip label="Has AI suggestions" pressed={scope === 'suggestions'} onToggle={() => toggleScope('suggestions')} />
          <ToggleChip label="Has fields not stated" pressed={scope === 'missing'} onToggle={() => toggleScope('missing')} />
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between text-[13px] text-ink-3">
        <p role="status" aria-live="polite" data-testid="result-count">
          Showing <span className="font-medium text-ink tnum">{filtered.length}</span> of <span className="tnum">{records.length}</span> decisions
        </p>
        {filtersActive ? (
          <button type="button" onClick={clear} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-accent hover:bg-accent-soft">
            <FilterX aria-hidden className="size-3.5" />
            Clear filters
          </button>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        {records.length === 0 ? (
          <EmptyState icon={Inbox} title="No decisions at this commit">The repository has no ADRs in docs/adr and no entries in the decision register at the commit being read.</EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState icon={FilterX} title="No decisions match these filters" action={<button type="button" onClick={clear} className={btn}>Clear filters</button>}>
            Try removing a status or searching with fewer words. {records.length} decisions exist at this commit.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto" onKeyDown={rowNav}>
            <table className="w-full min-w-[760px] text-left text-[13.5px]" data-testid="decision-table">
              <caption className="sr-only">Decisions. Press the arrow keys to move between rows and Enter to open one.</caption>
              <thead className="border-b border-hairline bg-surface-2 text-[12px] text-ink-3">
                <tr>
                  <SortHeader label="ID" field="id" sort={sort} dir={dir} onSort={onSort} className="w-[104px] pl-5" />
                  <SortHeader label="Decision" field="title" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader label="Status" field="status" sort={sort} dir={dir} onSort={onSort} className="w-[136px]" />
                  <SortHeader label="Priority" field="priority" sort={sort} dir={dir} onSort={onSort} className="hidden w-[84px] md:table-cell" />
                  <SortHeader label="Needed by" field="milestone" sort={sort} dir={dir} onSort={onSort} className="hidden w-[96px] lg:table-cell" />
                  <th scope="col" className="hidden w-[132px] py-2.5 pr-5 font-medium xl:table-cell">Source</th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.name || 'all'} className="divide-y divide-hairline border-b border-hairline last:border-b-0">
                  {g.name ? (
                    <tr className="bg-surface-2/70">
                      <th scope="colgroup" colSpan={6} className="px-5 py-2 text-[12.5px] font-semibold text-ink-2">
                        {g.name} <span className="ml-1 font-normal text-ink-3 tnum">{g.items.length}</span>
                      </th>
                    </tr>
                  ) : null}
                  {g.items.map((d) => (
                    <tr key={d.id} data-testid="decision-row" aria-selected={d.id === selectedId} className={`transition-colors hover:bg-surface-2 ${d.id === selectedId ? 'bg-accent-soft/60' : ''}`}>
                      <td className="py-3 pl-5 align-top whitespace-nowrap">
                        <Tag>{d.id}</Tag>
                      </td>
                      <td className="py-3 pr-4 align-top">
                        <button type="button" data-row-btn onClick={() => qs.set({ id: d.id }, 'push')} className="block w-full text-left">
                          <span className="clamp-2 font-medium text-ink">{d.title}</span>
                          <span className="mt-0.5 block text-[12.5px] text-ink-3">
                            {d.kind === 'adr' ? adrTypeLabel(d.category ?? undefined) : (d.category ?? 'Open entry')}
                            {d.status === 'Approved' && d.approvalBasis !== 'signed' ? ' · unsigned' : ''}
                            {d.relatedReviews.length && d.kind === 'adr' ? ` · ${d.relatedReviews.join(', ')}` : ''}
                            {d.flags.length ? ' · flagged for review' : ''}
                            {dupIds.has(d.id) ? ' · overlap candidate' : ''}
                            {sugIds.has(d.id) ? ' · AI suggestions' : ''}
                          </span>
                        </button>
                      </td>
                      <td className="py-3 pr-4 align-top">
                        <NormStatusPill status={d.status} />
                      </td>
                      <td className="hidden py-3 pr-4 align-top text-ink-2 md:table-cell">{d.priority?.value ?? <span className="text-ink-3">–</span>}</td>
                      <td className="hidden py-3 pr-4 align-top text-ink-2 lg:table-cell">{d.milestone ?? '–'}</td>
                      <td className="hidden max-w-[132px] py-3 pr-5 align-top xl:table-cell">
                        <SourceLink src={{ path: d.source.path, line: d.source.line }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </Card>

      <Sheet open={!!selected} onClose={() => qs.set({ id: null })} title="Decision">
        {selected ? (
          <>
            <DecisionDetail d={selected} lookup={lookup} duplicates={duplicates.filter((x) => x.a === selected.id || x.b === selected.id)} suggestions={suggestions} />
            <div className="mt-6">
              <Link href={`/decisions/${selected.id}`} className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-accent hover:underline">
                Open as a full page
                <ArrowUpRight aria-hidden className="size-3.5" />
              </Link>
            </div>
          </>
        ) : null}
      </Sheet>
    </div>
  );
}
