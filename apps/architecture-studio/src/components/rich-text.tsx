import { tokenizeInline } from '@/lib/rich-text.ts';

/** Renders repository text with **bold** and `code` shown as formatting instead of raw markers. Inline: safe inside a paragraph or span. */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {tokenizeInline(text).map((t, i) =>
        t.kind === 'bold' ? (
          <strong key={i} className="font-semibold">
            {t.value}
          </strong>
        ) : t.kind === 'code' ? (
          <code key={i} className="rounded bg-[var(--s-code-bg,rgba(15,35,55,0.06))] px-1 py-px font-mono text-[0.92em]">
            {t.value}
          </code>
        ) : (
          <span key={i}>{t.value}</span>
        ),
      )}
    </>
  );
}
