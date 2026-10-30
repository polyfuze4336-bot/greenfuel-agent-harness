// Reads markdown tables out of committed documents, so a slide shows the rows the document holds and not a retyped copy.

export interface Table {
  head: string[];
  rows: string[][];
  /** 1-based line of the header row. */
  line: number;
}

/** Removes markdown emphasis, links and code so a cell can be shown as plain text. */
export function plain(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));

export function parseTables(text: string): Table[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: Table[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|/.test(lines[i]!) || !/^\s*\|[\s\-:|]+\|\s*$/.test(lines[i + 1]!)) continue;
    const head = cells(lines[i]!);
    const rows: string[][] = [];
    let j = i + 2;
    while (j < lines.length && /^\s*\|/.test(lines[j]!)) rows.push(cells(lines[j]!)), j++;
    out.push({ head, rows, line: i + 1 });
    i = j - 1;
  }
  return out;
}

/** The first table whose header begins with the given cells (case-insensitive). */
export function findTable(text: string, headStartsWith: string[]): Table | null {
  const want = headStartsWith.map((h) => h.toLowerCase());
  return parseTables(text).find((t) => want.every((w, i) => (t.head[i] ?? '').toLowerCase().startsWith(w))) ?? null;
}

export type Verdict = 'meets' | 'conditional' | 'does-not-meet' | 'unknown' | 'other';

/** The verdict a comparison cell opens with, e.g. "**Conditional:** ...". Anything else is "other"; nothing is guessed. */
export function verdictOf(cell: string): Verdict {
  const c = plain(cell).toLowerCase();
  if (c.startsWith('does not meet')) return 'does-not-meet';
  if (c.startsWith('conditional')) return 'conditional';
  if (c.startsWith('meets')) return 'meets';
  if (c.startsWith('unknown')) return 'unknown';
  return 'other';
}

/**
 * Shortens text for a slide, preferring to end at a clause boundary so a cell does not stop mid-phrase. The ellipsis always says content
 * was left out; the full text stays in the cited source.
 */
export function clip(s: string, max: number): string {
  const t = plain(s);
  if (t.length <= max) return t;
  const head = t.slice(0, max - 1);
  const floor = Math.floor(max * 0.55);
  const clause = Math.max(head.lastIndexOf('; '), head.lastIndexOf(': '), head.lastIndexOf('. '), head.lastIndexOf(', '), head.lastIndexOf(' ('));
  const cut = clause >= floor ? clause : Math.max(head.lastIndexOf(' '), floor);
  return `${head.slice(0, cut).replace(/[\s,;:(]+$/, '')}…`;
}