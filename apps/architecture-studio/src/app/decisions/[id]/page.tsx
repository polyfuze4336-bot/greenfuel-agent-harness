import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { DecisionDetail } from '@/components/decisions/decision-detail.tsx';
import { Card } from '@/components/ui.tsx';
import { buildLookup } from '@/lib/lookup.ts';
import { getModel } from '@/lib/repo/index.ts';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: decodeURIComponent(id) };
}

export default async function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await getModel();
  const d = m.decisions.find((x) => x.id === decodeURIComponent(id));
  if (!d) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/decisions" className="mb-5 inline-flex items-center gap-1 text-[13.5px] font-medium text-accent hover:underline">
        <ChevronLeft aria-hidden className="size-4" />
        Decision Register
      </Link>
      <Card className="p-7">
        <DecisionDetail d={d} lookup={buildLookup(m)} titleAs="h1" />
      </Card>
    </div>
  );
}
