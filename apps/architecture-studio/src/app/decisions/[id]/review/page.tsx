import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRightLeft, ChevronLeft } from 'lucide-react';
import { DecisionDetail, LaneNotice } from '@/components/decisions/decision-detail.tsx';
import { ReviewRail } from '@/components/review/review-rail.tsx';
import { ConsequencesBlock, DiagramsBlock, PacketBlock, Required, RequirementsRisks, VersionsBlock } from '@/components/review/review-packet.tsx';
import { Card, NormStatusPill, Tag } from '@/components/ui.tsx';
import { duplicatesFor } from '@/lib/intel/duplicates.ts';
import { buildLookup } from '@/lib/lookup.ts';
import { getModel, openAdapter } from '@/lib/repo/index.ts';
import { consequencesOf, findDiagrams } from '@/lib/workflow/context.ts';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Review ${decodeURIComponent(id)}` };
}

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const m = await getModel();
  const d = m.register.records.find((x) => x.id === id);
  if (!d) notFound();
  const git = openAdapter();
  const byId = new Map(m.register.records.map((r) => [r.id, r]));
  const reqIds = new Set(d.blockingRequirements.map((r) => r.id));
  const reqs = m.requirements.filter((r) => r.decisions.includes(d.id) || reqIds.has(r.id));
  const risks = m.risks.filter((r) => r.decisions.includes(d.id) || d.relatedRisks.includes(r.id));
  const options = d.options.map((o) => ({ key: o.key, name: o.name, recommended: o.recommended }));

  return (
    <div className="mx-auto max-w-[1240px]">
      <Link href={`/decisions?id=${d.id}`} className="mb-5 inline-flex items-center gap-1 text-[13.5px] font-medium text-accent hover:underline">
        <ChevronLeft aria-hidden className="size-4" />
        Decision Register
      </Link>
      <header className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Tag>{d.id}</Tag>
          <span data-testid="review-status">
            <NormStatusPill status={d.status} />
          </span>
          <span className="text-[12.5px] text-ink-3">{d.kind === 'adr' ? 'Architecture decision record' : 'Open register entry'}</span>
        </div>
        <h1 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.01em]">{d.title}</h1>
        <div className="max-w-3xl">
          <LaneNotice natures={d.natures} />
        </div>
        {d.review ? (
          <p className="mt-2 max-w-3xl text-[13.5px] leading-5 text-ink-2">
            Status comes from a review record on the canonical branch. The source file says &ldquo;{d.statusRaw}&rdquo;.
          </p>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Card className="overflow-hidden">
            <Required d={d} dependents={d.dependedOnBy.length} blocked={d.blockingRequirements.length} />
            <ConsequencesBlock c={consequencesOf(d, byId)} />
          </Card>
          <Card className="overflow-hidden">
            <PacketBlock
              title="Recommended option, alternatives, pros and cons"
              id="record"
              hint={
                <>
                  Every field is copied from the source, with its line. A field the sources do not state is shown as not stated.{' '}
                  <Link href={`/decisions/${d.id}/compare`} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                    <ArrowRightLeft aria-hidden className="size-3.5" />
                    Compare alternatives side by side
                  </Link>
                </>
              }
            >
              <DecisionDetail d={d} lookup={buildLookup(m)} duplicates={duplicatesFor(d.id, m.register.duplicates)} suggestions={m.register.suggestions} bare />
            </PacketBlock>
          </Card>
          <Card className="overflow-hidden">
            <RequirementsRisks d={d} reqs={reqs} risks={risks} />
            <DiagramsBlock diagrams={findDiagrams(git, d)} />
            <VersionsBlock d={d} commits={git.log(8, [d.source.path])} />
          </Card>
        </div>
        <aside aria-label="Review actions" className="min-w-0">
          <ReviewRail id={d.id} options={options} />
        </aside>
      </div>
    </div>
  );
}
