/**
 * Inline formatting for text copied from repository Markdown: **bold** and `code` only. Anything else, including an unmatched marker,
 * is shown exactly as written, so nothing is invented or silently dropped. Line breaks are kept by the caller (whitespace-pre-line).
 * No HTML is ever produced from the text; the component that uses these tokens renders them as plain React elements.
 */
export type RichToken = { kind: 'text' | 'bold' | 'code'; value: string };

const INLINE = /(\*\*[^*\n]+?\*\*|`[^`\n]+`)/g;

export function tokenizeInline(text: string): RichToken[] {
  const out: RichToken[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', value: text.slice(last, at) });
    const raw = m[0];
    out.push(raw.startsWith('**') ? { kind: 'bold', value: raw.slice(2, -2) } : { kind: 'code', value: raw.slice(1, -1) });
    last = at + raw.length;
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
  return out;
}

/** True when the text still contains Markdown emphasis or code markers once tokenized, which would mean a marker was left unrendered. */
export function hasUnrenderedMarkers(text: string): boolean {
  return tokenizeInline(text).some((t) => t.kind === 'text' && /\*\*|`/.test(t.value));
}
