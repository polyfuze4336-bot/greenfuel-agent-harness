const COLOR: Record<string, string> = {
  approved: 'var(--s-accepted-fg)',
  accepted: 'var(--s-accepted-fg)',
  proposed: 'var(--s-proposed-fg)',
  'pending-review': 'var(--s-open-fg)',
  open: 'var(--s-open-fg)',
  blocked: '#c2410c',
  deferred: 'var(--s-deferred-fg)',
  rejected: 'var(--s-rejected-fg)',
  superseded: 'var(--s-neutral-fg)',
};

export interface Part {
  key: string;
  label: string;
  value: number;
}

/** A single proportional bar. The legend carries every number, so colour is never the only signal. */
export function StatusBar({ parts }: { parts: Part[] }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  const summary = parts.map((p) => `${p.label} ${p.value}`).join(', ');
  return (
    <div>
      <div role="img" aria-label={`${total} decisions: ${summary}`} className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-hairline">
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <span key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: COLOR[p.key] }} className="first:rounded-l-full last:rounded-r-full" />
          ))}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-ink-2">
              <span aria-hidden className="size-2.5 rounded-full" style={{ background: COLOR[p.key], opacity: p.value === 0 ? 0.35 : 1 }} />
              {p.label}
            </span>
            <span className="font-medium tnum">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
