'use client';

import { useMemo, useState } from 'react';
import { FilterX } from 'lucide-react';
import { useQueryState } from '@/lib/use-query-state.ts';
import type { QaItem, Slide } from '@/lib/repo/types.ts';
import { SearchField, SelectField } from '../explorer-kit.tsx';
import { Card, EmptyState, SourceLink, Tag, btn } from '../ui.tsx';

const hay = (...p: string[]) => p.join(' ').toLowerCase();
const all = (text: string, h: string) => !text || text.split(/\s+/).every((t) => h.includes(t));

const PART: Record<string, string> = { M: 'Core talk', E: 'Executive appendix', T: 'Technical appendix' };

export function DeckExplorer({ slides }: { slides: Slide[] }) {
  const qs = useQueryState();
  const text = qs.get('sq').trim().toLowerCase();
  const part = qs.get('sp');
  const filtered = useMemo(() => slides.filter((s) => all(text, hay(s.id, s.title, s.kicker)) && (!part || s.id.startsWith(part))), [slides, text, part]);
  const parts = ['M', 'E', 'T'].filter((p) => slides.some((s) => s.id.startsWith(p)));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-3">
        <SearchField value={qs.get('sq')} onChange={(v) => qs.set({ sq: v })} label="Search slides" placeholder="Search slide id or headline" />
        <SelectField label="Part" value={part} onChange={(v) => qs.set({ sp: v })} options={[{ value: '', label: 'All parts' }, ...parts.map((p) => ({ value: p, label: `${PART[p] ?? p} (${slides.filter((s) => s.id.startsWith(p)).length})` }))]} />
      </div>
      <p role="status" aria-live="polite" className="mb-2 text-[13px] text-ink-3">Showing <span className="font-medium text-ink tnum">{filtered.length}</span> of <span className="tnum">{slides.length}</span> slides</p>
      <Card>
        {filtered.length === 0 ? (
          <EmptyState icon={FilterX} title="No slides match" action={<button type="button" onClick={() => qs.set({ sq: null, sp: null })} className={btn}>Clear filters</button>} />
        ) : (
          <ol className="divide-y divide-hairline" data-testid="slide-list">
            {filtered.map((s) => (
              <li key={s.id} className="flex items-baseline gap-4 px-5 py-3">
                <Tag>{s.id}</Tag>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-medium">{s.title}</span>
                  <span className="block text-[12.5px] text-ink-3">{s.kicker}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

export function QaExplorer({ items }: { items: QaItem[] }) {
  const qs = useQueryState();
  const text = qs.get('qq').trim().toLowerCase();
  const area = qs.get('qa');
  const areas = [...new Set(items.map((i) => i.area))].sort();
  const filtered = useMemo(() => items.filter((i) => all(text, hay(i.id, i.question, i.area, i.slide, i.uncertain)) && (!area || i.area === area)), [items, text, area]);
  const [limit, setLimit] = useState(12);
  const filtering = !!(text || area);
  const shown = filtering ? filtered : filtered.slice(0, limit);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-3">
        <SearchField value={qs.get('qq')} onChange={(v) => qs.set({ qq: v })} label="Search panel questions" placeholder="Search question text" />
        <SelectField label="Area" value={area} onChange={(v) => qs.set({ qa: v })} options={[{ value: '', label: 'All areas' }, ...areas.map((a) => ({ value: a, label: `${a} (${items.filter((i) => i.area === a).length})` }))]} />
      </div>
      <p role="status" aria-live="polite" className="mb-2 text-[13px] text-ink-3">Showing <span className="font-medium text-ink tnum">{filtered.length}</span> of <span className="tnum">{items.length}</span> questions</p>
      <Card>
        {filtered.length === 0 ? (
          <EmptyState icon={FilterX} title="No questions match" action={<button type="button" onClick={() => qs.set({ qq: null, qa: null })} className={btn}>Clear filters</button>} />
        ) : (
          <>
            <ul className="divide-y divide-hairline" data-testid="qa-list">
              {shown.map((q) => (
                <li key={q.id}>
                  <details className="group px-5 py-3">
                    <summary className="flex cursor-pointer list-none items-baseline gap-4 rounded-md [&::-webkit-details-marker]:hidden">
                      <Tag>{q.id}</Tag>
                      <span className="min-w-0 flex-1 text-[14.5px] font-medium">{q.question}</span>
                      <span className="hidden shrink-0 text-[12.5px] text-ink-3 sm:block">{q.area} · {q.slide}</span>
                    </summary>
                    <div className="mt-3 ml-[calc(1rem+3.2rem)] space-y-2 text-[13.5px] leading-6 text-ink-2">
                      <p><span className="text-ink-3">Uncertain: </span>{q.uncertain || 'Not recorded.'}</p>
                      <p className="text-[12.5px] text-ink-3">The recommended response, evidence and when to concede are in the source file. The Studio shows the question and its stated uncertainty only.</p>
                      <SourceLink src={q.src} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
            {shown.length < filtered.length ? <div className="border-t border-hairline p-3 text-center"><button type="button" onClick={() => setLimit((n) => n + 12)} className={btn}>Show 12 more</button></div> : null}
          </>
        )}
      </Card>
    </div>
  );
}
