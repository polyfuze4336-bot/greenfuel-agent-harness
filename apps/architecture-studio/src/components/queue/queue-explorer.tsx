'use client';

import { useEffect, useMemo, useState } from 'react';
import { FilterX, Inbox, LogIn } from 'lucide-react';
import { useQueryState } from '@/lib/use-query-state.ts';
import { PRIORITIES, PRIORITY_RANK, KIND_LABEL, WORK_STATUSES, type Priority, type WorkItem } from '@/lib/queue/types.ts';
import { PRIMARY_VIEWS, VIEWS, VIEW_RULE, countViews, inView, mineReason, type View } from '@/lib/queue/views.ts';
import { ChipGroup, SearchField, SelectField, Sheet, SortHeader, ToggleChip, rowNav } from '../explorer-kit.tsx';
import { Card, EmptyState, SourceLink, Tag, btn } from '../ui.tsx';
import { ItemSheet } from './item-sheet.tsx';
import { useQueue } from './queue-data.tsx';
import { QueueError, QueueLoading, QueueTabs, SourceStrip } from './queue-frame.tsx';
import { PriorityTag, WorkStatusPill } from './work-bits.tsx';

const PAGE = 100;

const VIEW_SHORT: Record<View, string> = {
  all: 'All',
  mine: 'My attention',
  approvals: 'Pending approvals',
  blocked: 'Blocked',
  critical: 'Critical',
  pending: 'Pending',
  gaps: 'Architecture gaps',
  completed: 'Completed',
  rejected: 'Rejected or cancelled',
  evidence: 'Evidence gaps',
};

type GroupKey = 'none' | 'kind' | 'status' | 'priority' | 'class';
const num = (id: string) => Number(id.replace(/\D/g, '')) || 0;
const idCmp = (a: WorkItem, b: WorkItem) => a.id.replace(/[\d-]+$/, '').localeCompare(b.id.replace(/[\d-]+$/, '')) || num(a.id) - num(b.id) || a.id.localeCompare(b.id);
const pr = (i: WorkItem) => (i.priority ? PRIORITY_RANK[i.priority] : 9);

const cmp = (a: WorkItem, b: WorkItem, sort: string, next: Record<string, number>): number => {
  switch (sort) {
    case 'next':
      // Best first. Work with no ranked action (closed, or not actionable) comes after everything that has one.
      return (next[b.id] ?? -1e9) - (next[a.id] ?? -1e9);
    case 'title':
      return a.title.localeCompare(b.title);
    case 'status':
      return WORK_STATUSES.indexOf(a.status) - WORK_STATUSES.indexOf(b.status);
    case 'id':
      return idCmp(a, b);
    default:
      return pr(a) - pr(b);
  }
};

export function QueueExplorer() {
  const { data, session, error, loading, reload, signIn } = useQueue();
  const qs = useQueryState();
  const legacyBlocked = qs.get('blocked') === '1' && !qs.get('view');
  const view = ((VIEWS as readonly string[]).includes(qs.get('view')) ? qs.get('view') : legacyBlocked ? 'blocked' : 'all') as View;
  const text = qs.get('q').trim().toLowerCase();
  const statuses = qs.list('status');
  const priorities = qs.list('priority');
  const kind = qs.get('kind');
  const buildOnly = qs.get('build') === '1';
  const prereqOnly = qs.get('prereq') === '1';
  const group = (qs.get('group') || 'none') as GroupKey;
  const sort = qs.get('sort') || 'next';
  const dir: 'asc' | 'desc' = qs.get('dir') === 'desc' ? 'desc' : 'asc';
  const selectedId = qs.get('id');

  const items = useMemo(() => data?.items ?? [], [data]);
  const me = useMemo(() => (session?.authenticated && session.user ? { login: session.user.login, roles: session.user.roles } : null), [session]);
  const counts = useMemo(() => countViews(items, me), [items, me]);

  const inScope = useMemo(() => items.filter((i) => inView(i, view, me)), [items, view, me]);
  const base = useMemo(
    () => (i: WorkItem) =>
      (!text || text.split(/\s+/).every((w) => `${i.id} ${i.title} ${i.description} ${i.ownerText ?? ''} ${i.assignee ?? ''} ${i.relatedDecisions.join(' ')} ${i.relatedRequirements.join(' ')}`.toLowerCase().includes(w))) &&
      (!kind || i.kind === kind) &&
      (!buildOnly || i.blocksBuild) &&
      (!prereqOnly || i.flags.some((f) => f.code === 'unmet-prerequisite')),
    [text, kind, buildOnly, prereqOnly],
  );
  const statusCounts = useMemo(() => {
    const c = Object.fromEntries(WORK_STATUSES.map((s) => [s, 0])) as Record<string, number>;
    for (const i of inScope) if (base(i) && (priorities.length === 0 || (i.priority && priorities.includes(i.priority)))) c[i.status]!++;
    return c;
  }, [inScope, base, priorities]);
  const priorityCounts = useMemo(() => {
    const c = Object.fromEntries(PRIORITIES.map((p) => [p, 0])) as Record<Priority, number>;
    for (const i of inScope) if (base(i) && (statuses.length === 0 || statuses.includes(i.status)) && i.priority) c[i.priority]++;
    return c;
  }, [inScope, base, statuses]);

  const filtered = useMemo(() => {
    const out = inScope.filter((i) => base(i) && (statuses.length === 0 || statuses.includes(i.status)) && (priorities.length === 0 || (i.priority && priorities.includes(i.priority))));
    const next = data?.next ?? {};
    out.sort((a, b) => (cmp(a, b, sort, next) || idCmp(a, b)) * (dir === 'asc' ? 1 : -1));
    return out;
  }, [inScope, base, statuses, priorities, sort, dir, data]);

  const groups = useMemo(() => {
    if (group === 'none') return [{ name: '', items: filtered }];
    const key = (i: WorkItem) => (group === 'kind' ? KIND_LABEL[i.kind] : group === 'status' ? i.status : group === 'priority' ? (i.priority ?? 'No priority stated') : i.class);
    const map = new Map<string, WorkItem[]>();
    for (const i of filtered) map.set(key(i), [...(map.get(key(i)) ?? []), i]);
    return [...map.entries()].map(([name, list]) => ({ name, items: list }));
  }, [filtered, group]);

  // Only the first PAGE rows are in the page at once: all 329 items made the Work Queue about 10,000 DOM nodes and 24,000 px tall.
  const [limit, setLimit] = useState(PAGE);
  // A string, not the array: `filtered` is a new array whenever any dependency is a new object, which would reset the window at once.
  const filterSignature = `${group}|${filtered.map((i) => i.id).join(',')}`;
  useEffect(() => setLimit(PAGE), [filterSignature]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const selectedPos = selectedId ? flat.findIndex((i) => i.id === selectedId) : -1;
  const shown = Math.max(limit, selectedPos + 1);
  const visibleGroups = useMemo(() => {
    let left = shown;
    return groups
      .map((g) => {
        const items = g.items.slice(0, Math.max(0, left));
        left -= g.items.length;
        return { name: g.name, total: g.items.length, items };
      })
      .filter((g) => g.items.length > 0);
  }, [groups, shown]);

  if (error && !data) return <QueueError message={error} onRetry={() => void reload()} />;
  if (loading || !data) return <QueueLoading />;

  const filtersActive = !!(text || statuses.length || priorities.length || kind || buildOnly || prereqOnly);
  const clear = () => qs.set({ q: null, status: null, priority: null, kind: null, build: null, prereq: null });
  const toggle = (k: 'status' | 'priority', cur: string[], v: string) => qs.set({ [k]: (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]).join(',') || null });
  const onSort = (f: string) => qs.set(sort === f ? { dir: dir === 'asc' ? 'desc' : 'asc' } : { sort: f === 'next' ? null : f, dir: null });
  const setView = (v: View) => qs.set({ view: v === 'all' ? null : v, blocked: null, status: null, priority: null });
  const kinds = [...new Set(inScope.map((i) => i.kind))].sort();
  const statusOptions = WORK_STATUSES.filter((s) => inScope.some((i) => i.status === s));
  const selected = selectedId ? items.find((i) => i.id === selectedId) : undefined;
  const cols = 6;

  return (
    <div>
      <QueueTabs />
      <SourceStrip data={data} />

      <div role="group" aria-label="Queue views" className="mb-1 flex flex-wrap gap-1.5">
        {PRIMARY_VIEWS.map((v) => (
          <button key={v} type="button" data-testid={`view-${v}`} aria-pressed={v === view} onClick={() => setView(v)} className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[13.5px] font-medium transition-colors ${v === view ? 'border-selected bg-selected text-selected-ink' : 'border-hairline-strong bg-surface text-ink-2 hover:bg-surface-2'}`}>
            {VIEW_SHORT[v]}
            <span className={`tnum text-[12px] ${v === view ? 'text-white/70' : 'text-ink-3'}`} data-testid={`count-${v}`}>
              {v === 'mine' && !me ? '–' : counts[v]}
            </span>
          </button>
        ))}
      </div>
      <div role="group" aria-label="Narrower views" className="mb-1 flex flex-wrap items-center gap-x-1 gap-y-1 text-[12.5px]">
        <span className="mr-1 text-ink-3">Narrower:</span>
        {VIEWS.filter((v) => !PRIMARY_VIEWS.includes(v)).map((v) => (
          <button key={v} type="button" data-testid={`view-${v}`} aria-pressed={v === view} onClick={() => setView(v)} className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition-colors ${v === view ? 'bg-selected text-selected-ink' : 'text-ink-2 hover:bg-surface-2'}`}>
            {VIEW_SHORT[v]}
            <span className={`tnum text-[11.5px] ${v === view ? 'text-white/70' : 'text-ink-3'}`} data-testid={`count-${v}`}>{counts[v]}</span>
          </button>
        ))}
      </div>
      <p className="mb-5 text-[12.5px] leading-5 text-ink-3" data-testid="view-rule">
        {VIEW_RULE[view]}
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <SearchField value={qs.get('q')} onChange={(v) => qs.set({ q: v })} label="Search the queue" placeholder="Search id, text, owner, decision, requirement" />
        <SelectField label="Kind" value={kind} onChange={(v) => qs.set({ kind: v })} options={[{ value: '', label: 'All kinds' }, ...kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))]} />
        <SelectField label="Group by" value={group} onChange={(v) => qs.set({ group: v === 'none' ? null : v })} options={[{ value: 'none', label: 'No grouping' }, { value: 'kind', label: 'Kind' }, { value: 'status', label: 'Status' }, { value: 'priority', label: 'Priority' }, { value: 'class', label: 'Class of work' }]} />
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2.5">
        <ChipGroup label="Status" selected={statuses} onToggle={(v) => toggle('status', statuses, v)} options={statusOptions.map((s) => ({ value: s, label: s, count: statusCounts[s] }))} />
        <ChipGroup label="Priority" selected={priorities} onToggle={(v) => toggle('priority', priorities, v)} options={PRIORITIES.map((p) => ({ value: p, label: p, count: priorityCounts[p] }))} />
        <ToggleChip label="Blocks the build" pressed={buildOnly} onToggle={() => qs.set({ build: buildOnly ? null : '1' })} count={inScope.filter((i) => base(i) && i.blocksBuild).length} />
        <ToggleChip label="States an unmet prerequisite" pressed={prereqOnly} onToggle={() => qs.set({ prereq: prereqOnly ? null : '1' })} count={inScope.filter((i) => i.flags.some((f) => f.code === 'unmet-prerequisite')).length} />
      </div>

      <div className="mb-2 flex items-center justify-between text-[13px] text-ink-3">
        <p role="status" aria-live="polite" data-testid="result-count">
          Showing <span className="font-medium text-ink tnum">{filtered.length}</span> of <span className="tnum">{inScope.length}</span> in {VIEW_SHORT[view]}
          {sort === 'next' ? <span data-testid="order-note"> · in next-best-action order</span> : null}
        </p>
        {sort !== 'next' ? (
          <button type="button" data-testid="order-next" onClick={() => qs.set({ sort: null, dir: null })} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-accent hover:bg-accent-soft">
            Back to next-best-action order
          </button>
        ) : null}
        {filtersActive ? (
          <button type="button" onClick={clear} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-accent hover:bg-accent-soft">
            <FilterX aria-hidden className="size-3.5" />
            Clear filters
          </button>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        {view === 'mine' && !me ? (
          <EmptyState
            icon={LogIn}
            title="Sign in to see your tasks"
            action={
              <button type="button" className={btn} data-testid="mine-sign-in" onClick={() => void signIn()}>
                {session?.mode === 'entra' ? 'Sign in with Microsoft' : 'Sign in with GitHub'}
              </button>
            }
          >
            My tasks are items assigned to you and unassigned items whose owner text names a role you hold. The Studio learns who you are from your sign-in, never from what you type.
          </EmptyState>
        ) : inScope.length === 0 ? (
          <EmptyState icon={Inbox} title={`Nothing in ${VIEW_SHORT[view]}`}>
            {view === 'mine' ? 'Nothing is assigned to you through a merged record, and no unassigned open item names a role you hold.' : view === 'rejected' ? 'No work item is rejected or superseded at this commit.' : 'No item matches this view’s rule at this commit.'}
          </EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState icon={FilterX} title="No items match these filters" action={<button type="button" onClick={clear} className={btn}>Clear filters</button>}>
            Try removing a status or priority, or searching with fewer words.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto" onKeyDown={rowNav}>
            <table className="w-full min-w-[860px] text-left text-[13.5px]" data-testid="queue-table">
              <caption className="sr-only">Work items. Press the arrow keys to move between rows and Enter to open one.</caption>
              <thead className="border-b border-hairline bg-surface-2 text-[12px] text-ink-3">
                <tr>
                  <SortHeader label="ID" field="id" sort={sort} dir={dir} onSort={onSort} className="w-[92px] pl-5" />
                  <SortHeader label="Item" field="title" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader label="Priority" field="priority" sort={sort} dir={dir} onSort={onSort} className="w-[96px]" />
                  <SortHeader label="Status" field="status" sort={sort} dir={dir} onSort={onSort} className="w-[170px]" />
                  <th scope="col" className="hidden w-[170px] py-2.5 pr-4 font-medium lg:table-cell">Owner</th>
                  <th scope="col" className="hidden w-[150px] py-2.5 pr-5 font-medium xl:table-cell">Source</th>
                </tr>
              </thead>
              {visibleGroups.map((g) => (
                <tbody key={g.name || 'all'} className="divide-y divide-hairline border-b border-hairline last:border-b-0">
                  {g.name ? (
                    <tr className="bg-surface-2/70">
                      <th scope="colgroup" colSpan={cols} className="px-5 py-2 text-[12.5px] font-semibold text-ink-2">
                        {g.name} <span className="ml-1 font-normal text-ink-3 tnum">{g.total}</span>
                      </th>
                    </tr>
                  ) : null}
                  {g.items.map((i) => (
                    <tr key={i.id} data-testid="queue-row" data-id={i.id} className={`transition-colors hover:bg-surface-2 ${i.id === selectedId ? 'bg-accent-soft/60' : ''}`}>
                      <td className="py-3 pl-5 align-top">
                        <Tag>{i.id}</Tag>
                      </td>
                      <td className="py-3 pr-4 align-top">
                        <button type="button" data-row-btn onClick={() => qs.set({ id: i.id }, 'push')} className="block w-full text-left">
                          <span className="clamp-2 font-medium text-ink">{i.title}</span>
                          <span className="mt-0.5 block text-[12.5px] text-ink-3">
                            {KIND_LABEL[i.kind]}
                            {i.blocksBuild ? ' · blocks the build' : ''}
                            {i.derivedBlocks.length ? ' · blocked by a deferred decision' : ''}
                            {i.reviewNeeded.length ? ' · flagged for review' : ''}
                          </span>
                        </button>
                      </td>
                      <td className="py-3 pr-4 align-top">
                        <PriorityTag priority={i.priority} />
                      </td>
                      <td className="py-3 pr-4 align-top">
                        <WorkStatusPill status={i.status} title={i.statusBasis} />
                      </td>
                      <td className="hidden py-3 pr-4 align-top lg:table-cell">
                        <span className="clamp-2 text-[13px] text-ink-2">{i.assignee ? `@${i.assignee}` : (i.ownerText ?? <span className="text-ink-3">Not stated</span>)}</span>
                        {mineReason(i, me) === 'role' ? <span className="block text-[11.5px] text-ink-3">your role</span> : null}
                      </td>
                      <td className="hidden max-w-[150px] py-3 pr-5 align-top xl:table-cell">
                        <SourceLink src={i.source} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
            {flat.length > shown ? (
              <div className="flex items-center justify-between gap-3 border-t border-hairline px-5 py-3 text-[13px] text-ink-2">
                <span data-testid="queue-window">
                  Showing <span className="font-medium tnum text-ink">{shown}</span> of <span className="tnum">{flat.length}</span>
                </span>
                <button type="button" className={btn} onClick={() => setLimit(shown + PAGE)}>
                  Show {Math.min(PAGE, flat.length - shown)} more
                </button>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      <Sheet open={!!selected} onClose={() => qs.set({ id: null })} title={selected ? KIND_LABEL[selected.kind] : 'Work item'}>
        {selected ? <ItemSheet id={selected.id} data={data} session={session} onChanged={() => void reload()} onSignIn={signIn} onOpen={(id) => qs.set({ id }, 'push')} /> : null}
      </Sheet>
    </div>
  );
}
