// Formatting that is identical on the server and in the browser, so hydration never disagrees.

export function utcDate(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 10)}`;
}

export function utcDateTime(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export const adrTypeLabel = (t: string | undefined): string => (!t || t.startsWith('(none') ? 'Written before ADR types existed' : t);

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function relativeFrom(iso: string, nowMs: number): string {
  const diff = nowMs - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return 'unknown';
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
