import { Suspense } from 'react';
import { AssumptionsExplorer, DocumentsExplorer, EvidenceExplorer, RequirementsExplorer, RisksExplorer } from '@/components/architecture/explorers.tsx';
import { PageSkeleton } from '@/components/page-skeleton.tsx';
import { RefChips } from '@/components/record-bits.tsx';
import { Card, NeutralPill, PageHeader, Section, SourceLink, Tag, TonePill } from '@/components/ui.tsx';
import { buildLookup } from '@/lib/lookup.ts';
import { getModel } from '@/lib/repo/index.ts';

export const metadata = { title: 'Architecture & Evidence' };
export const dynamic = 'force-dynamic';

const SECTIONS = [
  ['reviews', 'Design reviews'],
  ['requirements', 'Requirements'],
  ['risks', 'Risks'],
  ['assumptions', 'Assumptions'],
  ['evidence', 'Evidence runs'],
  ['documents', 'Documents'],
] as const;

export default async function ArchitecturePage() {
  const m = await getModel();
  const lookup = buildLookup(m);
  return (
    <>
      <PageHeader title="Architecture & Evidence" lede="Design reviews and their gate results, the requirements and risks behind them, and the recorded evidence. Records are shown as written; nothing is scored by the Studio." />
      <nav aria-label="On this page" className="sticky top-14 z-20 -mx-1 mb-8 overflow-x-auto bg-canvas/90 px-1 py-2 backdrop-blur-md">
        <ul className="flex gap-1.5">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="inline-flex h-8 items-center rounded-full border border-hairline-strong bg-surface px-3 text-[13px] font-medium whitespace-nowrap text-ink-2 hover:bg-surface-2">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Section id="reviews" title="Design reviews" aside={`${m.reviews.length} reviews, ${m.metrics.readiness.reviewsApproved} Approved`}>
        <p className="mb-4 max-w-3xl text-[14px] leading-6 text-ink-2">“Declared” is the status the review document states. “Gate result” is what the design gate last computed, taken from a derived snapshot; the Studio does not re-run the gate. A review is Approved only when both say so and a signed approval exists.</p>
        <div className="grid grid-cols-1 gap-4" data-testid="review-list">
          {m.reviews.map((r) => (
            <Card key={r.id} className="p-5">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Tag>{r.id}</Tag>
                <Tag>{r.design}</Tag>
                <TonePill name="blocked">Declared {r.declared}</TonePill>
                {r.computed ? <NeutralPill>Gate result: {r.computed}</NeutralPill> : <NeutralPill>Gate result unavailable</NeutralPill>}
              </div>
              <p className="text-[16px] font-medium">{r.title}</p>
              <dl className="mt-3 grid gap-x-8 gap-y-2 text-[13.5px] sm:grid-cols-3">
                <div><dt className="text-[12px] text-ink-3">Decider</dt><dd>{r.decider}</dd></div>
                <div><dt className="text-[12px] text-ink-3">Blocking reasons</dt><dd className="tnum">{r.blockReasons ?? 'unknown'}</dd></div>
                <div><dt className="text-[12px] text-ink-3">Design ADRs</dt><dd>{r.adrs.length ? <RefChips ids={r.adrs} lookup={lookup} /> : 'None listed'}</dd></div>
              </dl>
              <div className="mt-4">
                <p className="mb-1.5 text-[12.5px] text-ink-3">{r.blockingDecisions.length} open decisions named by the gate</p>
                <RefChips ids={r.blockingDecisions} lookup={lookup} />
              </div>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1">
                <SourceLink src={r.src} />
                <SourceLink src={r.designSrc} />
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section id="requirements" title="Requirements" aside={`${m.metrics.requirements.total} requirements, ${m.metrics.requirements.must} Must`}>
        <Suspense fallback={<PageSkeleton rows={4} />}><RequirementsExplorer items={m.requirements} lookup={lookup} /></Suspense>
      </Section>
      <Section id="risks" title="Risks" aside={`${m.metrics.risks.total} risks, ${m.metrics.risks.open} Open`}>
        <Suspense fallback={<PageSkeleton rows={4} />}><RisksExplorer items={m.risks} lookup={lookup} /></Suspense>
      </Section>
      <Section id="assumptions" title="Assumptions" aside={`${m.metrics.assumptions.total} registered, ${m.metrics.assumptions.unresolved} unresolved`}>
        <Suspense fallback={<PageSkeleton rows={4} />}><AssumptionsExplorer items={m.assumptions} lookup={lookup} /></Suspense>
      </Section>
      <Section id="evidence" title="Evidence runs" aside={`${m.evidence.runs.length} recorded`}>
        <Suspense fallback={<PageSkeleton rows={4} />}><EvidenceExplorer items={m.evidence.runs} sealedThrough={m.evidence.sealedThrough} sealedCount={m.evidence.sealedCount} /></Suspense>
      </Section>
      <Section id="documents" title="Documents" aside={`${m.docs.length} Markdown files under docs/`}>
        <Suspense fallback={<PageSkeleton rows={4} />}><DocumentsExplorer items={m.docs} /></Suspense>
      </Section>
    </>
  );
}
