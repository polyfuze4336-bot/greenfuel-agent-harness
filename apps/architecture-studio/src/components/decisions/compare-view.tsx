'use client';

import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import type { AlternativesView, ComparedOption } from '@/lib/intel/compare.ts';
import type { Lookup } from '@/lib/lookup.ts';
import { SelectField } from '../explorer-kit.tsx';
import { AiBadge, Card, NeutralPill, NormStatusPill, SourceLink, Tag, VerdictPill } from '../ui.tsx';
import { SuggestionList } from './decision-detail.tsx';
import { RichText } from '../rich-text.tsx';

const th = 'border-b border-hairline px-4 py-3 text-left align-top font-medium';
const td = 'border-b border-hairline px-4 py-3 align-top text-[13px] leading-5';

function Head({ o }: { o: ComparedOption }) {
  return (
    <th scope="col" className={`${th} ${o.recommended ? 'border-t-[3px] border-t-[var(--accent)] bg-accent-soft/50' : ''}`} data-testid={o.recommended ? 'recommended-column' : 'option-column'}>
      <span className="flex flex-wrap items-center gap-1.5">
        <Tag>{o.key}</Tag>
        {o.recommended ? <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-ink">Recommended</span> : null}
      </span>
      <span className="mt-1.5 block text-[14px] font-semibold">{o.name}</span>
    </th>
  );
}

export function CompareView({ view, lookup }: { view: AlternativesView; lookup: Lookup }) {
  const [against, setAgainst] = useState('');
  const shown = useMemo(() => (against ? view.options.filter((o) => o.recommended || o.key === against) : view.options), [view.options, against]);
  const hasRecommended = view.recommendedKey !== null;
  const choices = view.options.filter((o) => !o.recommended);
  const m = view.matrix;

  if (view.options.length === 0) {
    return (
      <div className="space-y-6">
        <Card className="p-6 text-[14px] text-ink-2" data-testid="compare-empty">
          {view.notes.join(' ')}
        </Card>
        {view.suggestedAlternatives.length ? (
          <section>
            <h2 className="mb-2 text-[16px] font-semibold">Suggested alternatives</h2>
            <SuggestionList items={view.suggestedAlternatives} lookup={lookup} />
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <NormStatusPill status={view.status} />
        <p className="text-[14px] text-ink-2">
          {hasRecommended ? (
            <>
              The source recommends option <strong className="text-ink">{view.recommendedKey}</strong>. It is shown first.
            </>
          ) : (
            'No option is recommended in the source.'
          )}
        </p>
        <SelectField label={hasRecommended ? 'Compare the recommended option against' : 'Show'} value={against} onChange={setAgainst} options={[{ value: '', label: hasRecommended ? 'All alternatives' : 'All options' }, ...(hasRecommended ? choices : view.options).map((o) => ({ value: o.key, label: `${o.key}: ${o.name.slice(0, 48)}` }))]} />
      </div>

      {view.notes.length ? (
        <ul className="space-y-1.5">
          {view.notes.map((n) => (
            <li key={n} className="flex items-start gap-2 text-[13px] text-ink-2">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
              {n}
            </li>
          ))}
        </ul>
      ) : null}

      <section aria-labelledby="recorded-h">
        <div className="mb-2 flex items-baseline justify-between gap-4">
          <h2 id="recorded-h" className="text-[18px] font-semibold">
            Recorded in the repository
          </h2>
          <p className="text-[12.5px] text-ink-3">Every cell is text from a source file. Nothing here is generated.</p>
        </div>
        <Card className="overflow-x-auto">
          {/* Equal columns, so every option is visible at once on a desktop; a narrower screen scrolls rather than squeezing a column to nothing. */}
          <table className="w-full table-fixed border-collapse text-left" style={{ minWidth: 170 + shown.length * 210 }} data-testid="compare-table">
            <caption className="sr-only">Options side by side. The first column is the row label.</caption>
            <thead>
              <tr>
                <th scope="col" className={`${th} w-[170px] text-[12px] text-ink-3`}>
                  Option
                </th>
                {shown.map((o) => (
                  <Head key={o.key} o={o} />
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" className={`${td} text-[12px] font-medium text-ink-3`}>
                  Disposition in the source
                </th>
                {shown.map((o) => (
                  <td key={o.key} className={td}>
                    {o.disposition ? <NeutralPill>{o.disposition}</NeutralPill> : <span className="text-ink-3 italic">Not stated</span>}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row" className={`${td} text-[12px] font-medium text-ink-3`}>
                  Summary
                </th>
                {shown.map((o) => (
                  <td key={o.key} className={td}>
                    {o.summary ?? <span className="text-ink-3 italic">Not stated</span>}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row" className={`${td} text-[12px] font-medium text-ink-3`}>
                  Recorded trade-offs
                </th>
                {shown.map((o) => (
                  <td key={o.key} className={td}>
                    {o.tradeoffs ?? <span className="text-ink-3 italic">Not stated</span>}
                  </td>
                ))}
              </tr>
              {m
                ? m.rows.map((row) => (
                    <tr key={row.criterion} data-testid="matrix-row">
                      <th scope="row" className={`${td} text-[12.5px] font-medium`}>
                        {row.criterion}
                        <span className="mt-1 block font-normal">
                          <SourceLink src={{ path: m.src.path, line: row.line }} />
                        </span>
                      </th>
                      {shown.map((o) => {
                        const c = o.matrixColumn ? row.cells[o.matrixColumn] : undefined;
                        return (
                          <td key={o.key} className={`${td} ${o.recommended ? 'bg-accent-soft/30' : ''}`}>
                            {c ? (
                              <>
                                <VerdictPill verdict={c.verdict} />
                                <span className="mt-1.5 block text-ink-2">{c.text.replace(/^(Meets|Does not meet|Conditional|Unknown)(: )?/i, '')}</span>
                              </>
                            ) : (
                              <span className="text-ink-3 italic">Not in the comparison table</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                : null}
              <tr>
                <th scope="row" className={`${td} text-[12px] font-medium text-ink-3`}>
                  {m ? 'Positive and negative consequences recorded in the ADR' : 'Recorded strengths and weaknesses'}
                </th>
                {shown.map((o) => {
                  const own = (cs: typeof o.recorded.pros) => (m ? cs.filter((c) => c.criterion?.startsWith('ADR Consequences')) : cs);
                  const pros = own(o.recorded.pros);
                  const cons = own(o.recorded.cons);
                  return (
                    <td key={o.key} className={td}>
                      {pros.length + cons.length === 0 ? (
                        <span className="text-ink-3 italic">None recorded</span>
                      ) : (
                        <>
                          {pros.length ? (
                            <ul className="mb-2 list-disc space-y-1 pl-4 marker:text-[var(--s-accepted-fg)]">
                              {pros.map((c, i) => (
                                <li key={i}>
                                  <RichText text={c.text} /> <SourceLink src={c.src} />
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {cons.length ? (
                            <ul className="list-disc space-y-1 pl-4 marker:text-[var(--s-rejected-fg)]">
                              {cons.map((c, i) => (
                                <li key={i}>
                                  <RichText text={c.text} /> <SourceLink src={c.src} />
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </Card>
        {m ? (
          <p className="mt-2 text-[12.5px] text-ink-3">
            Criteria and verdicts are from the design comparison table in {m.designId}, columns tied to options by {m.mapping}. Counts of verdicts are deliberately not totalled: they are not a score.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="ai-h" data-testid="ai-section">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2 id="ai-h" className="text-[18px] font-semibold">
            AI suggestions
          </h2>
          <AiBadge />
        </div>
        <p className="mb-3 max-w-3xl text-[13px] leading-5 text-ink-3">An AI proposed these to help a person think. They sit apart from the record: they change no status, are not evidence and grant no approval. Confidence is not proof of technical or regulatory correctness, so each needs checking by a qualified person.</p>
        {shown.some((o) => o.suggested.pros.length + o.suggested.cons.length > 0) ? (
          <Card className="overflow-x-auto border-dashed">
            <table className="w-full min-w-[720px] border-collapse text-left" data-testid="suggestion-table">
              <caption className="sr-only">AI suggested pros and cons per option</caption>
              <thead>
                <tr>
                  <th scope="col" className={`${th} w-[170px] text-[12px] text-ink-3`}>
                    Option
                  </th>
                  {shown.map((o) => (
                    <th key={o.key} scope="col" className={th}>
                      <Tag>{o.key}</Tag> <span className="ml-1 text-[13px] font-semibold">{o.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(['pros', 'cons'] as const).map((k) => (
                  <tr key={k}>
                    <th scope="row" className={`${td} text-[12px] font-medium text-ink-3`}>
                      Suggested {k === 'pros' ? 'strengths' : 'weaknesses'}
                    </th>
                    {shown.map((o) => (
                      <td key={o.key} className={td}>
                        {o.suggested[k].length ? (
                          <ul className="space-y-2">
                            {o.suggested[k].map((s) => (
                              <li key={s.id}>
                                <span className="mb-0.5 flex items-center gap-1.5">
                                  <Tag>{s.id}</Tag>
                                  <span className="text-[10.5px] font-semibold tracking-wide text-ink-3 uppercase">AI suggestion</span>
                                </span>
                                {s.text}
                                <span className="mt-0.5 block text-[12px] text-ink-3">Why: {s.rationale}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-ink-3 italic">No suggestion</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : (
          <p className="text-[13.5px] text-ink-3">No AI suggestion exists for these options.</p>
        )}
        {view.suggestedAlternatives.length ? (
          <div className="mt-5">
            <h3 className="mb-2 text-[14px] font-semibold">Suggested additional alternatives</h3>
            <SuggestionList items={view.suggestedAlternatives} lookup={lookup} />
          </div>
        ) : null}
        {view.suggestedConsequences.length ? (
          <div className="mt-5">
            <h3 className="mb-2 text-[14px] font-semibold">Suggested consequences</h3>
            <SuggestionList items={view.suggestedConsequences} lookup={lookup} />
          </div>
        ) : null}
      </section>
    </div>
  );
}
