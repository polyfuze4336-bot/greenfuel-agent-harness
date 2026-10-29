'use client';

import { useMemo } from 'react';
import { FilterX, Inbox, TriangleAlert } from 'lucide-react';
import { useQueryState } from '@/lib/use-query-state.ts';
import type { Lookup } from '@/lib/lookup.ts';
import { TASK_STATUS_LABEL, type Task, type TaskStatus } from '@/lib/repo/types.ts';
import { ChipGroup, SearchField, SelectField, Sheet, SortHeader, ToggleChip, rowNav } from '../explorer-kit.tsx';
import { RefChips, SourceBlock } from '../record-bits.tsx';
import { BlockedPill, Card, EmptyState, Meta, SourceLink, TaskPill, Tag, btn } from '../ui.tsx';

const STATUS_ORDER: TaskStatus[] = ['open', 'deferred', 'not-granted', 'unmarked', 'approved', 'decided', 'agreed', 'done'];
const rank = (s: TaskStatus) => STATUS_ORDER.indexOf(s);
const num = (id: string) => Number(id.replace(/\D/g, '')) || 0;

type GroupKey = 'none' | 'section' | 'status' | 'family';

const cmp = (a: Task, b: Task, sort: string): number => {
  switch (sort) {
    case 'status':
      return rank(a.status) - rank(b.status);
    case 'title':
      return a.title.localeCompare(b.title);
    case 'blocked':
      return Number(b.blocked) - Number(a.blocked);
    default:
      return a.family.localeCompare(b.family) || num(a.id) - num(b.id);
  }
};

export function QueueExplorer({ tasks, lookup }: { tasks: Task[]; lookup: Lookup }) {
  const qs = useQueryState();
  const text = qs.get('q').trim().toLowerCase();
  const statuses = qs.list('status');
  const family = qs.get('family');
  const blockedOnly = qs.get('blocked') === '1';
  const section = qs.get('section');
  const group = (qs.get('group') || 'none') as GroupKey;
  const sort = qs.get('sort') || 'id';
  const dir: 'asc' | 'desc' = qs.get('dir') === 'desc' ? 'desc' : 'asc';
  const selectedId = qs.get('id');

  const sections = useMemo(() => [...new Set(tasks.map((t) => t.section))], [tasks]);

  const base = useMemo(
    () => (t: Task) => (!text || text.split(/\s+/).every((w) => `${t.id} ${t.detail} ${t.blocks} ${t.section} ${t.approvalNeeded ?? ''}`.toLowerCase().includes(w))) && (!family || t.family === family) && (!blockedOnly || t.blocked) && (!section || t.section === section),
    [text, family, blockedOnly, section],
  );

  const counts = useMemo(() => {
    const c = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<TaskStatus, number>;
    for (const t of tasks) if (base(t)) c[t.status]++;
    return c;
  }, [tasks, base]);

  const filtered = useMemo(() => {
    const out = tasks.filter((t) => base(t) && (statuses.length === 0 || statuses.includes(t.status)));
    out.sort((a, b) => (cmp(a, b, sort) || cmp(a, b, 'id')) * (dir === 'asc' ? 1 : -1));
    return out;
  }, [tasks, base, statuses, sort, dir]);

  const groups = useMemo(() => {
    if (group === 'none') return [{ name: '', items: filtered }];
    const key = (t: Task) => (group === 'section' ? t.section : group === 'status' ? TASK_STATUS_LABEL[t.status] : t.family === 'owner-todo' ? 'Owner tasks' : 'Roadmap items');
    const map = new Map<string, Task[]>();
    for (const t of filtered) map.set(key(t), [...(map.get(key(t)) ?? []), t]);
    return [...map.entries()].map(([name, items]) => ({ name, items }));
  }, [filtered, group]);

  const filtersActive = !!(text || statuses.length || family || blockedOnly || section);
  const clear = () => qs.set({ q: null, status: null, family: null, blocked: null, section: null });
  const toggleStatus = (s: string) => qs.set({ status: (statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s]).join(',') || null });
  const onSort = (f: string) => qs.set(sort === f ? { dir: dir === 'asc' ? 'desc' : 'asc' } : { sort: f === 'id' ? null : f, dir: null });
  const selected = selectedId ? tasks.find((t) => t.id === selectedId) : undefined;
  const statusOptions = STATUS_ORDER.filter((s) => tasks.some((t) => t.status === s));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <SearchField value={qs.get('q')} onChange={(v) => qs.set({ q: v })} label="Search tasks" placeholder="Search id, text, what it blocks" />
        <SelectField label="Source" value={family} onChange={(v) => qs.set({ family: v })} options={[{ value: '', label: 'All sources' }, { value: 'owner-todo', label: 'Owner tasks (TODO)' }, { value: 'roadmap', label: 'Roadmap items' }]} />
        <SelectField label="Section" value={section} onChange={(v) => qs.set({ section: v })} options={[{ value: '', label: 'All sections' }, ...sections.map((s) => ({ value: s, label: s.length > 46 ? `${s.slice(0, 45)}…` : s }))]} />
        <SelectField label="Group by" value={group} onChange={(v) => qs.set({ group: v === 'none' ? null : v })} options={[{ value: 'none', label: 'No grouping' }, { value: 'section', label: 'Section' }, { value: 'status', label: 'Status' }, { value: 'family', label: 'Source' }]} />
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2.5">
        <ChipGroup label="Status" selected={statuses} onToggle={toggleStatus} options={statusOptions.map((s) => ({ value: s, label: TASK_STATUS_LABEL[s], count: counts[s] }))} />
        <ToggleChip label="Blocked only" pressed={blockedOnly} onToggle={() => qs.set({ blocked: blockedOnly ? null : '1' })} count={tasks.filter((t) => base(t) && t.blocked).length} />
      </div>

      <div className="mb-2 flex items-center justify-between text-[13px] text-ink-3">
        <p role="status" aria-live="polite" data-testid="result-count">
          Showing <span className="font-medium text-ink tnum">{filtered.length}</span> of <span className="tnum">{tasks.length}</span> tasks
        </p>
        {filtersActive ? (
          <button type="button" onClick={clear} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-accent hover:bg-accent-soft">
            <FilterX aria-hidden className="size-3.5" />
            Clear filters
          </button>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        {tasks.length === 0 ? (
          <EmptyState icon={Inbox} title="No tasks at this commit">docs/state/TODO.md has no task rows and the roadmap has no items at the commit being read.</EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState icon={FilterX} title="No tasks match these filters" action={<button type="button" onClick={clear} className={btn}>Clear filters</button>}>
            {blockedOnly ? 'No task states an unmet prerequisite under the other filters.' : 'Try removing a status or searching with fewer words.'}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto" onKeyDown={rowNav}>
            <table className="w-full min-w-[720px] text-left text-[13.5px]" data-testid="queue-table">
              <caption className="sr-only">Tasks. Press the arrow keys to move between rows and Enter to open one.</caption>
              <thead className="border-b border-hairline bg-surface-2 text-[12px] text-ink-3">
                <tr>
                  <SortHeader label="ID" field="id" sort={sort} dir={dir} onSort={onSort} className="w-[84px] pl-5" />
                  <SortHeader label="Task" field="title" sort={sort} dir={dir} onSort={onSort} />
                  <SortHeader label="Status" field="status" sort={sort} dir={dir} onSort={onSort} className="w-[150px]" />
                  <SortHeader label="Blocked" field="blocked" sort={sort} dir={dir} onSort={onSort} className="hidden w-[110px] md:table-cell" />
                  <th scope="col" className="hidden w-[132px] py-2.5 pr-5 font-medium xl:table-cell">Source</th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.name || 'all'} className="divide-y divide-hairline border-b border-hairline last:border-b-0">
                  {g.name ? (
                    <tr className="bg-surface-2/70">
                      <th scope="colgroup" colSpan={5} className="px-5 py-2 text-[12.5px] font-semibold text-ink-2">
                        {g.name} <span className="ml-1 font-normal text-ink-3 tnum">{g.items.length}</span>
                      </th>
                    </tr>
                  ) : null}
                  {g.items.map((t) => (
                    <tr key={`${t.family}:${t.id}`} data-testid="queue-row" className={`transition-colors hover:bg-surface-2 ${t.id === selectedId ? 'bg-accent-soft/60' : ''}`}>
                      <td className="py-3 pl-5 align-top">
                        <Tag>{t.id}</Tag>
                      </td>
                      <td className="py-3 pr-4 align-top">
                        <button type="button" data-row-btn onClick={() => qs.set({ id: t.id }, 'push')} className="block w-full text-left">
                          <span className="clamp-2 font-medium text-ink">{t.title}</span>
                          <span className="mt-0.5 block text-[12.5px] text-ink-3">
                            {t.family === 'roadmap' ? 'Roadmap' : t.section}
                            {t.ambiguous ? ' · status needs review' : ''}
                          </span>
                        </button>
                      </td>
                      <td className="py-3 pr-4 align-top">
                        <TaskPill status={t.status} />
                      </td>
                      <td className="hidden py-3 pr-4 align-top md:table-cell">{t.blocked ? <BlockedPill reason={t.blockedBy} /> : <span className="text-ink-3">–</span>}</td>
                      <td className="hidden max-w-[132px] py-3 pr-5 align-top xl:table-cell">
                        <SourceLink src={t.src} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </Card>

      <Sheet open={!!selected} onClose={() => qs.set({ id: null })} title={selected?.family === 'roadmap' ? 'Roadmap item' : 'Owner task'}>
        {selected ? <TaskDetail t={selected} lookup={lookup} /> : null}
      </Sheet>
    </div>
  );
}

function TaskDetail({ t, lookup }: { t: Task; lookup: Lookup }) {
  return (
    <article data-testid="task-detail" aria-label={`${t.id} ${t.title}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Tag>{t.id}</Tag>
        <TaskPill status={t.status} />
        {t.blocked ? <BlockedPill reason={t.blockedBy} /> : null}
        <span className="text-[12.5px] text-ink-3">{t.family === 'roadmap' ? 'Implementation roadmap' : t.section}</span>
      </div>
      <h2 className="text-[19px] leading-[1.3] font-semibold">{t.title}</h2>

      {t.ambiguous ? (
        <p className="mt-4 flex gap-2.5 rounded-xl px-3.5 py-2.5 text-[13.5px] leading-5" style={{ background: 'var(--s-open-bg)', color: 'var(--s-open-fg)' }}>
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          The status of this row is ambiguous (several status words, or none). A person should confirm it.
        </p>
      ) : null}
      {!t.statusRecorded ? <p className="mt-4 text-[13.5px] text-ink-2">The source row records no status for this item, so none is shown as fact.</p> : null}

      {t.blocked ? (
        <section className="mt-6">
          <h3 className="mb-2 text-[13px] font-semibold text-ink-2">Why it is shown as blocked</h3>
          <p className="text-[14px] leading-6">{t.blockedBy}</p>
          <p className="mt-1 text-[12.5px] text-ink-3">Rule: the task is not closed and its own text names an unmet prerequisite (“Until …”, “blocked by …”) or it is Not granted.</p>
        </section>
      ) : null}

      <section className="mt-6">
        <h3 className="mb-2 text-[13px] font-semibold text-ink-2">Full text of the row</h3>
        <p className="text-[14px] leading-6 text-ink-2">{t.detail}</p>
      </section>

      <dl className="mt-6 grid grid-cols-1 gap-4">
        {t.blocks ? <Meta label="What this blocks">{t.blocks}</Meta> : null}
        {t.approvalNeeded ? <Meta label="Approval needed">{t.approvalNeeded}</Meta> : null}
      </dl>

      <section className="mt-6">
        <h3 className="mb-2 text-[13px] font-semibold text-ink-2">Decisions it mentions</h3>
        <RefChips ids={[...t.refs.adrs.map((n) => `ADR-${n}`), ...t.refs.decisions]} lookup={lookup} empty="No decision is mentioned in this row." />
      </section>
      <section className="mt-6">
        <h3 className="mb-2 text-[13px] font-semibold text-ink-2">Other tasks it mentions</h3>
        <RefChips ids={t.refs.tasks} lookup={lookup} empty="No other task is mentioned in this row." />
      </section>

      <div className="mt-8 border-t border-hairline pt-6">
        <SourceBlock src={t.src} />
      </div>
    </article>
  );
}
