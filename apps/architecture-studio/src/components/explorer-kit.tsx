'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from 'lucide-react';

export function SearchField({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder: string }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    if (local === value) return;
    const t = setTimeout(() => onChange(local), 120);
    return () => clearTimeout(t);
  }, [local, value, onChange]);
  return (
    <label className="relative block w-full sm:w-[320px]">
      <span className="sr-only">{label}</span>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
      <input type="search" value={local} onChange={(e) => setLocal(e.target.value)} placeholder={placeholder} autoComplete="off" spellCheck={false} className="h-9 w-full rounded-lg border border-hairline-strong bg-surface pr-8 pl-9 text-[14px] text-ink placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden" />
      {local ? (
        <button type="button" aria-label="Clear search" onClick={() => setLocal('')} className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-md text-ink-3 hover:bg-surface-2">
          <X aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </label>
  );
}

export function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const id = useId();
  return (
    <div className="flex min-w-0 max-w-full items-center gap-2">
      <label htmlFor={id} className="text-[12.5px] whitespace-nowrap text-ink-3">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 min-w-0 max-w-[min(56vw,320px)] rounded-lg border border-hairline-strong bg-surface px-2.5 text-[13.5px] text-ink">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ChipGroup({ label, options, selected, onToggle }: { label: string; options: { value: string; label: string; count?: number }[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span aria-hidden className="mr-1 text-[12.5px] text-ink-3">
        {label}
      </span>
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button key={o.value} type="button" aria-pressed={on} onClick={() => onToggle(o.value)} className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors ${on ? 'border-navy bg-navy text-white' : 'border-hairline-strong bg-surface text-ink-2 hover:bg-surface-2'}`}>
            {o.label}
            {o.count !== undefined ? <span className={`tnum text-[12px] ${on ? 'text-white/70' : 'text-ink-3'}`}>{o.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function ToggleChip({ label, pressed, onToggle, count }: { label: string; pressed: boolean; onToggle: () => void; count?: number }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onToggle} className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors ${pressed ? 'border-navy bg-navy text-white' : 'border-hairline-strong bg-surface text-ink-2 hover:bg-surface-2'}`}>
      {label}
      {count !== undefined ? <span className={`tnum text-[12px] ${pressed ? 'text-white/70' : 'text-ink-3'}`}>{count}</span> : null}
    </button>
  );
}

export function SortHeader({ label, field, sort, dir, onSort, className = '' }: { label: string; field: string; sort: string; dir: 'asc' | 'desc'; onSort: (f: string) => void; className?: string }) {
  const active = sort === field;
  return (
    <th scope="col" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`py-2.5 font-medium ${className}`}>
      <button type="button" onClick={() => onSort(field)} className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 -ml-1 hover:bg-hairline/60">
        {label}
        {active ? dir === 'asc' ? <ArrowUp aria-hidden className="size-3.5" /> : <ArrowDown aria-hidden className="size-3.5" /> : <ArrowUpDown aria-hidden className="size-3.5 opacity-40" />}
      </button>
    </th>
  );
}

/** Arrow-key navigation between row buttons marked with data-row-btn. */
export function rowNav(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-row-btn]')];
  const i = rows.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : e.key === 'ArrowDown' ? Math.min(i + 1, rows.length - 1) : Math.max(i - 1, 0);
  rows[next]?.focus();
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  // The sheet is opened from a row button, not a Dialog.Trigger, so restore focus to whatever had it before opening.
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement as HTMLElement | null;
  }, [open]);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-40 bg-navy/35" />
        <Dialog.Content
          aria-describedby={undefined}
          data-testid="detail-sheet"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (opener.current && opener.current !== document.body && document.contains(opener.current)) opener.current.focus();
          }}
          className="anim-sheet fixed inset-y-0 right-0 z-50 flex w-[600px] max-w-full flex-col bg-surface"
          style={{ boxShadow: 'var(--shadow-sheet)' }}
        >
          <div className="flex items-center justify-between border-b border-hairline px-6 py-3.5">
            <Dialog.Title className="text-[13px] font-medium text-ink-3">{title}</Dialog.Title>
            <Dialog.Close aria-label="Close panel" className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2">
              <X aria-hidden className="size-[18px]" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
