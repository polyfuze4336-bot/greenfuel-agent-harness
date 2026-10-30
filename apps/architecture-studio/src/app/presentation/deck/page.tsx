import { Suspense } from 'react';
import { DeckStudio } from '@/components/deck/deck-studio.tsx';
import { PageHeader } from '@/components/ui.tsx';

export const metadata = { title: 'Deck builder · Presentation Studio' };
export const dynamic = 'force-dynamic';

export default function DeckPage() {
  return (
    <>
      <PageHeader title="Deck builder" lede="Generates an editable PowerPoint for the capstone from the repository, its evidence and the rubric. Every slide names its sources. A sample is always buildable; a final deck is refused until the architecture it presents is approved and every slide has been reviewed." />
      <Suspense>
        <DeckStudio />
      </Suspense>
    </>
  );
}
