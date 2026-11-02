'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRightLeft, Gavel, Info, TriangleAlert } from 'lucide-react';
import { FIELD_LABEL, type Claim, type DuplicateCandidate, type NormalizedDecision, type OptionInfo, type Suggestion } from '@/lib/intel/schema.ts';
import type { Lookup } from '@/lib/lookup.ts';
import { RefChips, SourceBlock } from '../record-bits.tsx';
import { SourcePreviewButton } from '../source-preview.tsx';
import { AiBadge, NeutralPill, NormStatusPill, SourceLink, Tag, VerdictPill } from '../ui.tsx';
import { RichText } from '../rich-text.tsx';
import { adrTypeLabel } from '@/lib/format.ts';

const APPROVAL_TEXT: Record<NormalizedDecision['approvalBasis'], string> = {
  signed: 'A signed approval record names this decision. The Studio does not verify the signature; run approval.mjs verify.',
  'owner-instruction-unsigned': "Approved on the owner's instruction in chat. No signed approval record exists.",
  'delegated-unsigned': "Decided by the architect on the owner's instruction. No signed approval record exists.",
  'review-record': 'Approved by a Studio review record that was merged to the canonical branch. It is a recorded decision, not a signed approval under ADR 0008.',
  none: 'No approval is recorded for this decision.',
};

function Block({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section className="mt-6" id={id}>
      <h3 className="mb-2 text-[13px] font-semibold text-ink-2">{title}</h3>
      {children}
    </section>
  );
}

const Missing = ({ children }: { children?: ReactNode }) => <p className="text-[13.5px] text-ink-3 italic">{children ?? 'Not stated in any source.'}</p>;

function ClaimList({ claims, empty }: { claims: Claim[]; empty: string }) {
  if (!claims.length) return <p className="text-[12.5px] text-ink-3">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {claims.map((c, i) => (
        <li key={i} className="text-[13px] leading-5 text-ink-2">
          <RichText text={c.text} />
          <span className="ml-2 inline-block align-middle">
            <SourceLink src={c.src} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function OptionCard({ o, recommended }: { o: OptionInfo; recommended: boolean }) {
  const n = o.pros.length + o.cons.length + o.conditional.length + o.unknown.length;
  return (
    <details data-testid="option-card" className="group rounded-xl border border-hairline bg-surface" open={recommended}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 rounded-xl px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
        <Tag>{o.key}</Tag>
        <span className="min-w-0 flex-1 text-[14px] font-medium">{o.name}</span>
        {recommended ? <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-semibold text-accent">Recommended</span> : null}
        {o.disposition ? <NeutralPill>{o.disposition}</NeutralPill> : null}
      </summary>
      <div className="space-y-3 border-t border-hairline px-3.5 py-3">
        {o.summary ? <p className="text-[13.5px] leading-5 text-ink-2">{o.summary}</p> : <Missing>No summary recorded for this option.</Missing>}
        {o.tradeoffs ? (
          <p className="text-[13px] leading-5 text-ink-2">
            <span className="font-medium text-ink">Recorded trade-offs: </span>
            {o.tradeoffs}
          </p>
        ) : null}
        {n === 0 ? (
          <Missing>No pros or cons are recorded for this option. The Studio does not invent them.</Missing>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-[12px] font-semibold text-[var(--s-accepted-fg)]">Recorded strengths ({o.pros.length})</p>
              <ClaimList claims={o.pros} empty="None recorded." />
            </div>
            <div>
              <p className="mb-1 text-[12px] font-semibold text-[var(--s-rejected-fg)]">Recorded weaknesses ({o.cons.length})</p>
              <ClaimList claims={o.cons} empty="None recorded." />
            </div>
            {o.conditional.length ? (
              <div className="sm:col-span-2">
                <p className="mb-1 text-[12px] font-semibold text-[var(--s-open-fg)]">Conditional ({o.conditional.length})</p>
                <ClaimList claims={o.conditional} empty="" />
              </div>
            ) : null}
            {o.unknown.length ? (
              <div className="sm:col-span-2">
                <p className="mb-1 text-[12px] font-semibold text-ink-3">Unknown ({o.unknown.length})</p>
                <ClaimList claims={o.unknown} empty="" />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </details>
  );
}

const IMPLICATIONS: [keyof NormalizedDecision['implications'], string][] = [
  ['cost', 'Cost'],
  ['security', 'Security'],
  ['reliability', 'Reliability'],
  ['dataSovereignty', 'Data sovereignty'],
  ['operational', 'Operational'],
];

export function SuggestionList({ items, lookup, empty }: { items: Suggestion[]; lookup: Lookup; empty?: string }) {
  if (!items.length) return empty ? <p className="text-[13px] text-ink-3">{empty}</p> : null;
  return (
    <ul className="space-y-2.5" data-testid="suggestion-list">
      {items.map((s) => (
        <li key={s.id} className="rounded-xl border border-dashed border-hairline-strong bg-surface-2 px-3.5 py-3">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <AiBadge />
            <Tag>{s.id}</Tag>
            <span className="text-[12px] text-ink-3">
              {s.kind}
              {s.optionKey ? ` · option ${s.optionKey}` : ''}
            </span>
          </div>
          <p className="text-[13.5px] leading-5"><RichText text={s.text} /></p>
          <p className="mt-1.5 text-[12.5px] leading-5 text-ink-3">
            <span className="font-medium">Why: </span>
            {s.rationale}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-3">
            Drawn from <RefChips ids={s.basedOn.filter((b) => !b.includes('/'))} lookup={lookup} />
            {s.basedOn.filter((b) => b.includes('/')).map((b) => (
              <SourceLink key={b} src={{ path: b, line: 1 }} />
            ))}
          </div>
          <p className="mt-1 text-[11.5px] text-ink-3">
            Written by {s.generatedBy.tool} on {s.generatedBy.date}. A suggestion, not a fact: it changes no status and grants no approval.
          </p>
        </li>
      ))}
    </ul>
  );
}

export function DecisionDetail({ d, lookup, duplicates = [], suggestions = [], titleAs = 'h2', bare = false }: { d: NormalizedDecision; lookup: Lookup; duplicates?: DuplicateCandidate[]; suggestions?: Suggestion[]; titleAs?: 'h1' | 'h2'; bare?: boolean }) {
  const Title = titleAs;
  const mine = suggestions.filter((s) => s.decisionId === d.id);
  const prov = Object.entries(d.fieldSources);
  return (
    <article data-testid="decision-detail" aria-label={`${d.id} ${d.title}`}>
      {bare ? null : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Tag>{d.id}</Tag>
            <NormStatusPill status={d.status} />
            {d.status === 'Approved' && d.approvalBasis !== 'signed' ? <NeutralPill title={APPROVAL_TEXT[d.approvalBasis]}>Unsigned</NeutralPill> : null}
            <span className="text-[12.5px] text-ink-3">{d.kind === 'adr' ? `Architecture decision record${d.category ? ` · ${adrTypeLabel(d.category)}` : ''}` : 'Open register entry'}</span>
          </div>
          <Title className="text-[22px] leading-[1.25] font-semibold">{d.title}</Title>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link href={`/decisions/${d.id}/review`} className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90">
              <Gavel aria-hidden className="size-3.5" />
              Review and decide
            </Link>
            <Link href={`/decisions/${d.id}/compare`} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-surface-2">
              <ArrowRightLeft aria-hidden className="size-3.5" />
              Compare alternatives
            </Link>
            <SourcePreviewButton src={{ path: d.source.path, line: d.source.line }} />
          </div>
        </>
      )}

      <Block title="Status, verbatim from the source">
        <blockquote className="rounded-xl border-l-[3px] border-hairline-strong bg-surface-2 px-4 py-3 text-[13.5px] leading-6 text-ink-2">{d.statusRaw || 'No status recorded'}</blockquote>
        <p className="mt-2 text-[12.5px] leading-5 text-ink-3">
          <span className="font-medium">Rule: </span>
          {d.statusRule}
        </p>
        <p className="mt-1.5 flex items-start gap-2 text-[13px] text-ink-2">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
          {APPROVAL_TEXT[d.approvalBasis]}
        </p>
      </Block>

      {d.flags.length > 0 ? (
        <Block title="Flagged for human review">
          <ul className="space-y-2">
            {d.flags.map((f, i) => (
              <li key={i} className="flex gap-2.5 rounded-xl px-3.5 py-2.5 text-[13.5px] leading-5" style={{ background: 'var(--s-open-bg)', color: 'var(--s-open-fg)' }}>
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      <Block title={FIELD_LABEL.description!}>{d.description ? <p className="text-[14px] leading-6 whitespace-pre-line text-ink"><RichText text={d.description} /></p> : <Missing />}</Block>
      <Block title={FIELD_LABEL.businessJustification!}>{d.businessJustification ? <p className="text-[14px] leading-6 whitespace-pre-line text-ink"><RichText text={d.businessJustification} /></p> : <Missing />}</Block>

      <Block title={FIELD_LABEL.recommendedOption!}>
        {d.recommendedOption ? (
          <p className="text-[14.5px]">
            <Tag>{d.recommendedOption.key}</Tag> <span className="font-medium">{d.recommendedOption.name}</span> <span className="text-ink-3">({d.recommendedOption.disposition})</span>
          </p>
        ) : (
          <Missing>{d.kind === 'register-entry' ? 'None. The register records known options and states that none is chosen.' : 'The source does not mark a selected or proposed option.'}</Missing>
        )}
      </Block>

      <Block title={`${FIELD_LABEL.options!} (${d.options.length})`}>
        {d.options.length ? (
          <div className="space-y-2">
            {d.options.map((o) => (
              <OptionCard key={o.key} o={o} recommended={o.recommended} />
            ))}
          </div>
        ) : (
          <Missing />
        )}
      </Block>

      <Block title="Implications">
        <dl className="space-y-3">
          {IMPLICATIONS.map(([k, label]) => {
            const v = d.implications[k];
            return (
              <div key={k}>
                <dt className="text-[12px] font-medium text-ink-3">{label}</dt>
                <dd className="text-[13.5px] leading-5 text-ink-2">
                  {v ? (
                    <>
                      <span className="whitespace-pre-line"><RichText text={v.text} /></span>
                      <span className="mt-1 block">
                        <SourceLink src={v.src} />
                      </span>
                    </>
                  ) : (
                    <span className="text-ink-3 italic">Not stated in any source.</span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </Block>

      <Block title="Dependencies">
        <p className="mb-1.5 text-[12.5px] text-ink-3">Cites</p>
        <RefChips ids={d.dependsOn} lookup={lookup} empty="Cites no other decision." />
        <p className="mt-3 mb-1.5 text-[12.5px] text-ink-3">Cited by</p>
        <RefChips ids={d.dependedOnBy} lookup={lookup} empty="No decision cites this one." />
      </Block>
      <Block title={`Blocking requirements (${d.blockingRequirements.length})`}>
        {d.blockingRequirements.length ? (
          <>
            <p className="mb-1.5 text-[12.5px] text-ink-3">{d.kind === 'register-entry' ? 'Requirements whose traceability row cites this decision, so they cannot be fully accepted until it is made.' : 'Requirements this ADR addresses that still name an open clarification.'}</p>
            <ul className="flex flex-wrap gap-1.5">
              {d.blockingRequirements.map((r) => (
                <li key={r.id}>
                  <Link href={lookup[r.id]?.href ?? `/architecture?rq=${r.id}#requirements`} title={`${lookup[r.id]?.title ?? r.id}${r.priority ? ` (${r.priority})` : ''}`} className="inline-flex items-center gap-1 rounded-md border border-hairline bg-surface-2 px-1.5 py-px font-mono text-[12px] leading-5 text-accent hover:border-accent">
                    {r.id}
                    {r.priority ? <span className="text-[10.5px] text-ink-3">{r.priority}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Missing>No requirement is recorded as blocked by this decision.</Missing>
        )}
      </Block>
      <Block title="Related ADRs, risks, tasks and reviews">
        <div className="space-y-2.5 text-[12.5px] text-ink-3">
          {[
            ['ADRs', d.relatedAdrs],
            ['Risks', d.relatedRisks],
            ['Tasks', d.relatedTasks],
            ['Design reviews', d.relatedReviews],
          ].map(([label, ids]) => (
            <div key={label as string}>
              <p className="mb-1">{label as string}</p>
              <RefChips ids={ids as string[]} lookup={lookup} empty="None recorded." />
            </div>
          ))}
        </div>
      </Block>

      <Block title="People and dates">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13.5px]">
          <div>
            <dt className="text-[12px] font-medium text-ink-3">{FIELD_LABEL.requiredApproverRole}</dt>
            <dd>{d.requiredApproverRole ? d.requiredApproverRole.text : <span className="text-ink-3 italic">Not stated in any source.</span>}</dd>
          </div>
          <div>
            <dt className="text-[12px] font-medium text-ink-3">{FIELD_LABEL.decisionOwner}</dt>
            <dd>{d.decisionOwner ?? <span className="text-ink-3 italic">Not stated in any source.</span>}</dd>
          </div>
          <div>
            <dt className="text-[12px] font-medium text-ink-3">{FIELD_LABEL.decisionDate}</dt>
            <dd>{d.decisionDate ?? <span className="text-ink-3 italic">Not stated in any source.</span>}</dd>
          </div>
          <div>
            <dt className="text-[12px] font-medium text-ink-3">{FIELD_LABEL.priority}</dt>
            <dd>
              {d.priority ? (
                <>
                  {d.priority.value} <span className="block text-[12px] text-ink-3">{d.priority.basis}</span>
                </>
              ) : (
                <span className="text-ink-3 italic">No requirement traces to it.</span>
              )}
            </dd>
          </div>
          {d.milestone ? (
            <div>
              <dt className="text-[12px] font-medium text-ink-3">Needed by</dt>
              <dd>{d.milestone}</dd>
            </div>
          ) : null}
        </dl>
      </Block>

      <Block title="Approval history">
        {d.approvalHistory.length ? (
          <ol className="space-y-2.5" data-testid="approval-history">
            {d.approvalHistory.map((e, i) => (
              <li key={i} className="rounded-xl border border-hairline px-3.5 py-2.5 text-[13px] leading-5">
                <span className="flex flex-wrap items-center gap-2">
                  <NeutralPill>{e.type === 'status-line' ? 'Status line' : e.type === 'signed-approval' ? 'Signed approval record' : 'Owner decision log'}</NeutralPill>
                  <span className="text-ink-3">{e.date ?? 'no date'}</span>
                  {e.actor ? <span className="text-ink-3">· {e.actor}</span> : null}
                </span>
                <span className="mt-1 block text-ink-2"><RichText text={e.text} /></span>
                <span className="mt-1 block">
                  <SourceLink src={e.src} />
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <Missing>No approval event is recorded.</Missing>
        )}
      </Block>

      <Block title={`${FIELD_LABEL.evidence} (${d.evidence.length})`}>
        {d.evidence.length ? (
          <ul className="space-y-1.5 text-[13px]">
            {d.evidence.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2">
                <Tag>{e.id}</Tag>
                <span className="text-ink-3">{e.kind === 'test-run' ? 'recorded run' : e.kind}</span>
                {e.claim ? <span className="text-ink-2">{e.claim}</span> : null}
                {e.kind === 'test-run' && e.resolved ? <span className="text-ink-3">exit {e.exitCode}</span> : null}
                {!e.resolved ? <NeutralPill title="Cited, but no record with this id exists at this commit">Not found</NeutralPill> : e.src ? <SourceLink src={e.src} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <Missing>No evidence record is cited by this decision.</Missing>
        )}
      </Block>

      <Block title={`${FIELD_LABEL.rubric} (${d.rubric.length})`}>
        {d.rubric.length ? (
          <>
            <p className="mb-1.5 text-[12.5px] text-ink-3">Where the rubric traceability document cites this decision or its design. A citation index, not a score.</p>
            <ul className="space-y-1.5 text-[13px]">
              {d.rubric.map((r, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <Tag>{r.criterion}</Tag>
                  <span className="text-ink-2">{r.title}</span>
                  <NeutralPill>{r.label}</NeutralPill>
                  {r.via === 'design' ? <span className="text-[12px] text-ink-3">via its design</span> : null}
                  <SourceLink src={r.src} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Missing>The rubric document does not cite this decision.</Missing>
        )}
      </Block>

      {duplicates.length > 0 ? (
        <Block title="Possible duplicates and overlaps" id="duplicates">
          <ul className="space-y-2" data-testid="duplicate-list">
            {duplicates.map((x, i) => {
              const other = x.a === d.id ? x.b : x.a;
              return (
                <li key={i} className="rounded-xl border border-hairline px-3.5 py-2.5 text-[13px] leading-5">
                  <span className="flex flex-wrap items-center gap-2">
                    <NeutralPill>{x.kind}</NeutralPill>
                    {other !== d.id ? <RefChips ids={[other]} lookup={lookup} /> : null}
                    <span className="text-ink-3">score {x.score}</span>
                  </span>
                  <span className="mt-1 block text-ink-2">{x.reasons.join('; ')}</span>
                  <span className="mt-1 block text-[12px] text-ink-3">A candidate for a person to review. Nothing was merged or hidden.</span>
                </li>
              );
            })}
          </ul>
        </Block>
      ) : null}

      <Block title={`AI suggestions (${mine.length})`} id="suggestions">
        {mine.length ? (
          <>
            <p className="mb-2 text-[12.5px] leading-5 text-ink-3">Written by an AI to help a person think. They are not part of the record, change no status, are not evidence and grant no approval. Confidence is not proof; each needs checking by a qualified person.</p>
            <SuggestionList items={mine} lookup={lookup} />
          </>
        ) : (
          <Missing>No AI suggestion exists for this decision.</Missing>
        )}
      </Block>

      <Block title="Not stated in any source">
        {d.missing.length ? (
          <ul className="flex flex-wrap gap-1.5" data-testid="missing-fields">
            {d.missing.map((m) => (
              <li key={m} className="rounded-md border border-dashed border-hairline-strong px-1.5 py-px text-[12px] text-ink-3">
                {FIELD_LABEL[m] ?? m}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-3">Every field of the schema is populated from a source.</p>
        )}
      </Block>

      <div className="mt-8 border-t border-hairline pt-6">
        <h3 className="mb-2 text-[13px] font-semibold text-ink-2">Source in the repository</h3>
        <dl className="mb-3 grid grid-cols-[110px_1fr] gap-y-1 text-[12.5px]">
          <dt className="text-ink-3">File</dt>
          <dd className="font-mono break-all">{d.source.path}</dd>
          <dt className="text-ink-3">Commit</dt>
          <dd className="font-mono break-all" data-testid="source-commit">{d.source.commit}</dd>
          <dt className="text-ink-3">Blob</dt>
          <dd className="font-mono break-all">{d.source.blob}</dd>
          <dt className="text-ink-3">Line</dt>
          <dd>{d.source.line}</dd>
        </dl>
        {prov.length ? (
          <details className="mb-4 rounded-xl border border-hairline">
            <summary className="cursor-pointer px-3.5 py-2 text-[13px] font-medium">Field provenance ({prov.length} fields)</summary>
            <table className="w-full border-t border-hairline text-left text-[12.5px]" data-testid="provenance-table">
              <caption className="sr-only">Where each populated field came from</caption>
              <thead className="text-ink-3">
                <tr>
                  <th scope="col" className="px-3.5 py-1.5 font-medium">Field</th>
                  <th scope="col" className="py-1.5 font-medium">Source</th>
                  <th scope="col" className="py-1.5 pr-3.5 font-medium">Rule</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline align-top">
                {prov.map(([f, s]) => (
                  <tr key={f}>
                    <td className="px-3.5 py-1.5">{FIELD_LABEL[f] ?? f}</td>
                    <td className="py-1.5 pr-3">
                      <SourceLink src={s} />
                    </td>
                    <td className="py-1.5 pr-3.5 text-ink-3">{s.rule}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ) : null}
        {d.citedBy.length ? (
          <details className="mb-4 rounded-xl border border-hairline">
            <summary className="cursor-pointer px-3.5 py-2 text-[13px] font-medium">Cited by {d.citedBy.length} other file(s)</summary>
            <ul className="space-y-1 border-t border-hairline px-3.5 py-2 text-[12.5px]">
              {d.citedBy.map((p) => (
                <li key={p}>
                  <SourceLink src={{ path: p, line: 1 }} />
                  <span className="ml-2 font-mono text-ink-3">{p}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <SourceBlock src={d.source} label="Source link and history" />
      </div>
    </article>
  );
}
