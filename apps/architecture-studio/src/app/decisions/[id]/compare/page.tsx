import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { CompareView } from '@/components/decisions/compare-view.tsx';
import { LaneNotice } from '@/components/decisions/decision-detail.tsx';
import { PageHeader, Tag } from '@/components/ui.tsx';
import { compareAlternatives } from '@/lib/intel/compare.ts';
import { buildLookup } from '@/lib/lookup.ts';
import { getModel } from '@/lib/repo/index.ts';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Compare alternatives: ${decodeURIComponent(id)}` };
}

export default async function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await getModel();
  const d = m.register.records.find((x) => x.id === decodeURIComponent(id));
  if (!d) notFound();
  const view = compareAlternatives(d, m.register.suggestions);
  return (
    <>
      <Link href={`/decisions?id=${d.id}`} className="mb-5 inline-flex items-center gap-1 text-[13.5px] font-medium text-accent hover:underline">
        <ChevronLeft aria-hidden className="size-4" />
        Back to {d.id}
      </Link>
      <PageHeader
        title="Compare alternatives"
        lede={
          <>
            <Tag>{d.id}</Tag> <span className="ml-1">{d.title}</span>
          </>
        }
      />
      <div className="mb-6 max-w-3xl">
        <LaneNotice natures={d.natures} />
      </div>
      <CompareView view={view} lookup={buildLookup(m)} />
    </>
  );
}
