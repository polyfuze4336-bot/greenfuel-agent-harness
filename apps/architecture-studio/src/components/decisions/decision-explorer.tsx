'use client';

import Link from 'next/link';
import { useCallback, useMemo } from 'react';
import { ArrowUpRight, FilterX, Inbox } from 'lucide-react';
import { useQueryState } from '@/lib/use-query-state.ts';
import { adrTypeLabel } from '@/lib/format.ts';
import type { Lookup } from '@/lib/lookup.ts';
import { STATUS_LABEL, type Decision, type DecisionStatus } from '@/lib/repo/types.ts';
import { ChipGroup, SearchField, SelectField, Sheet, SortHeader, ToggleChip, rowNav } from '../explorer-kit.tsx';
import { Card, EmptyState, SourceLink, StatusPill, Tag, btn } from '../ui.tsx';
import { DecisionDetail } from './decision-detail.tsx';

const STATUS_ORDER: DecisionStatus[] = ['open', 'proposed', 'accepted', 'deferred', 'rejected', 'superseded'];
const rank = (s: DecisionStatus) => STATUS_ORDER.indexOf(s);

type GroupKey = 'none' | 'status' | 'type' | 'milestone' | 'owner';
const groupOf = (d: Decision, g: GroupKey): string => {
  switch (g) {
    case 'status':
      return STATUS_LABEL[d.status];
    case 'type':
      return d.type === 'adr' ? 'Architecture decision records' : 'Open register entries';
    case 'milestone':
      return d.milestone ? `Needed by ${d.milestone}` : 'No milestone (ADRs)';
    case 'owner':
      return (d.owner ?? 'No owner recorded').replace(/\(.*\)/, '').trim().slice(0, 70);
    default:
      return '';
  }
};

const cmp = (a: Decision, b: Decision, sort: string): number => {
  switch (sort) {
    case 'status':
      return rank(a.status) - rank(b.status);
    case 'milestone':
      return (a.milestone ?? 'ZZ').localeCompare(b.milestone ?? 'ZZ');
    case 'title':
      return a.title.localeCompare(b.title);
    case 'type':
      return a.type.localeCompare(b.type);
    default:
      return a.id.localeCompare(b.id, 'en', { numeric: true });
  }
};

function matches(d: Decision, text: string): boolean {
  if (!text) return true;
  const hay = `${d.id} ${d.title} ${d.summary} ${d.owner ?? ''} ${d.statusRaw} ${d.milestone ?? ''} ${d.kind ?? ''}`.toLowerCase();
  return text.split(/\s+/).every((t) => hay.includes(t));
}

export function DecisionExplorer({ decisions, lookup }: { decisions: Decision[]; lookup: Lookup }) {
  const qs = useQueryState();
  const text = qs.get('q').trim().toLowerCase();
  const statuses = qs.list('status');
  const type = qs.get('type');
  const milestone = qs.get('milestone');
  const scope = qs.get('scope');
  const group = (qs.get('group') || 'none') as GroupKey;
  const sort = qs.get('sort') || 'id';
  const dir: 'asc' | 'desc' = qs.get('dir') === 'desc' ? 'desc' : 'asc';
  const selectedId = qs.get('id');

  const baseFilter = useCallback(
    (d: Decision) => matches(d, text) && (!type || d.type === type) && (!milestone || d.milestone === milestone) && (scope !== 'gate' || d.refs.reviews.length > 0) && (scope !== 'review' || d.flags.review.length > 0),
    [text, type, milestone, scope],
  );

  const counts = useMemo(() => {
    const c = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<DecisionStatus, number>;
    for (const d of decisions) if (baseFilter(d)) c[d.status]++;
    return c;
  }, [decisions, baseFilter]);

  const filtered = useMemo(() => {
    const out = decisions.filter((d) => baseFilter(d) && (statuses.length === 0 || statuses.includes(d.status)));
    out.sort((a, b) => (cmp(a, b, sort) || cmp(a, b, 'id')) * (dir === 'asc' ? 1 : -1));
    return out;
  }, [decisions, baseFilter, statuses, sort, dir]);

  const groups = useMemo(() => {
    if (group === 'none') return [{ name: '', items: filtered }];
    const map = new Map<string, Decision[]>();
    for (const d of filtered) {
      const k = groupOf(d, group);
      map.set(k, [...(map.get(k) ?? []), d]);
    }
    const entries = [...map.entries()];
    if (group === 'status') entries.sort((a, b) => rank(a[1][0]!.status) - rank(b[1][0]!.status));
    else entries.sort((a, b) => a[0].localeCompare(b[0]));
    return entries.map(([name, items]) => ({ name, items }));
  }, [filtered, group]);

  const filtersActive = !!(text || statuses.length || type || milestone || scope);
  const clear = () => qs.set({ q: null, status: null, type: null, milestone: null, scope: null });
  const toggleStatus = (s: string) => qs.set({ status: (statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s]).join(',') || null });
  const onSort = (f: string) => qs.set(sort === f ? { dir: dir === 'asc' ? 'desc' : 'asc' } : { sort: f === 'id' ? null : f, dir: null });
  const selected = selectedId ? decisions.find((d) => d.id === selectedId) : undefined;
  const open = (id: string) => qs.set({ id }, 'push');
  const close = () => qs.set({ id: null });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <SearchField value={qs.get('q')} onChange={(v) => qs.set({ q: v })} label="Search decisions" placeholder="Search id, title, owner, text" />
        <SelectField label="Type" value={type} onChange={(v) => qs.set({ type: v })} options={[{ value: '', label: 'All types' }, { value: 'adr', label: 'ADRs' }, { value: 'register', label: 'Open register entries' }]} />
        <SelectField label="Needed by" value={milestone} onChange={(v) => qs.set({ milestone: v })} options={[{ value: '', label: 'Any milestone' }, { value: 'M1', label: 'M1' }, { value: 'M2', label: 'M2' }]} />
        <SelectField label="Group by" value={group} onChange={(v) => qs.set({ group: v === 'none' ? null : v })} options={[{ value: 'none', label: 'No grouping' }, { value: 'status', label: 'Status' }, { value: 'type', label: 'Type' }, { value: 'milestone', label: 'Milestone' }, { value: 'owner', label: 'Owner or decider' }]} />
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2.5">
        <ChipGroup label="Status" selected={statuses} onToggle={toggleStatus} options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s], count: counts[s] }))} />
        <div role="group" aria-label="Scope" className="flex items-center gap-1.5">
          <ToggleChip label="Gates a design review" pressed={scope === 'gate'} onToggle={() => qs.set({ scope: scope === 'gate' ? null : 'gate' })} />
          <ToggleChip label="Flagged for review" pressed={scope === 'review'} onToggle={() => qs.set({ scope: scope === 'review' ? null : 'review' })} />
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between text-[13px] text-ink-3">
        <p role="status" aria-live="polite" data-testid="result-count">
          Showing <span className="font-medium text-ink tnum">{filtered.length}</span> of <span className="tnum">{decisions.length}</span> decisions
        </p>
        {filtersActive ? (
          <button type="button" onClick={clear} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-accent hover:bg-accent-soft">
            <FilterX aria-hidden className="size-3.5" />
            Clear filters
          </button>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        {decisions.length === 0 ? (
          <EmptyState icon={Inbox} title="No decisions at this commit">The repository has no ADRs in docs/adr and no entries in the decision register at the commit being read.</EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState icon={FilterX} title="No decisions match these filters" action={<button type="button" onClick={clear} className={btn}>Clear filters</button>}>
            Try removing a status or searching with fewer words. {decisions.length} decisions exist at this commit.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto" onKeyDown={rowNav}>
            <table className="w-full min-w-[720px] text-left text-[13.5px]" data-testid="decision-table">
              <caption className="sr-only">Decisions. Press the arrow keys to move between rows and Enter to open one.</caption>
              <thead className="border-b border-hairline bg-surface-2 text-[12px] text-ink-3">
                <tr>
                  <SortHeader label="ID" field="id" sort={sort} dir={dir} onSort={onSort} className="w-[104px] pl-5" />
                  <SortHeader label="Decision" field="title" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader label="Status" field="status" sort={sort} dir={dir} onSort={onSort} className="w-[120px]" />
                  <SortHeader label="Type" field="type" sort={sort} dir={dir} onSort={onSort} className="hidden w-[120px] md:table-cell" />
                  <SortHeader label="Needed by" field="milestone" sort={sort} dir={dir} onSort={onSort} className="hidden w-[100px] md:table-cell" />
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
                        <button type="button" data-row-btn onClick={() => open(d.id)} className="block w-full text-left">
                          <span className="clamp-2 font-medium text-ink">{d.title}</span>
                          <span className="mt-0.5 block text-[12.5px] text-ink-3">
                            {d.type === 'adr' ? adrTypeLabel(d.adrType) : kindLabel(d.kind)}
                            {d.flags.grandfathered ? ' · unsigned, accepted by owner instruction' : ''}
                            {d.flags.review.length ? ' · flagged for review' : ''}
                            {d.refs.reviews.length ? ` · gates ${d.refs.reviews.length} design review${d.refs.reviews.length > 1 ? 's' : ''}` : ''}
                          </span>
                        </button>
                      </td>
                      <td className="py-3 pr-4 align-top">
                        <StatusPill status={d.status} />
                      </td>
                      <td className="hidden py-3 pr-4 align-top text-ink-2 md:table-cell">{d.type === 'adr' ? 'ADR' : 'Open decision'}</td>
                      <td className="hidden py-3 pr-4 align-top text-ink-2 md:table-cell">{d.milestone ?? '–'}</td>
                      <td className="hidden max-w-[132px] py-3 pr-5 align-top xl:table-cell">
                        <SourceLink src={d.src} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </Card>

      <Sheet open={!!selected} onClose={close} title="Decision">
        {selected ? (
          <>
            <DecisionDetail d={selected} lookup={lookup} />
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

const kindLabel = (k?: string) => (k ? `Open ${k.includes('X') ? 'architecture decision' : k.includes('D') ? 'verification' : 'clarification'}${k.includes('+') || k.length > 1 ? ` (${k})` : ''}` : 'Open entry');
