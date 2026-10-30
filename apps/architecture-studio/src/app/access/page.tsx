import type { Metadata } from 'next';
import { AccessReview } from '@/components/access/access-review.tsx';
import { PageHeader } from '@/components/ui.tsx';

export const metadata: Metadata = { title: 'Access review' };
export const dynamic = 'force-dynamic';

// The page is a shell. Everything it shows comes from /api/v1/access/review, which refuses anyone without the Administrator permission.
export default function AccessPage() {
  return (
    <>
      <PageHeader title="Access review" lede="Who can do what, whether that is still justified, and what looks wrong. Administrators review access here; approving architecture decisions is a separate role." />
      <AccessReview />
    </>
  );
}
