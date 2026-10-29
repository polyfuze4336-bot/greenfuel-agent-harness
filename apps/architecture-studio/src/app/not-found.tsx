'use client';

import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { EmptyState, btnPrimary } from '@/components/ui.tsx';

export default function NotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title="That record is not at this commit"
      action={
        <Link href="/decisions" className={btnPrimary}>
          Go to the Decision Register
        </Link>
      }
    >
      The link may point to a record that was renamed, removed, or that exists only on another branch. Use search to find it.
    </EmptyState>
  );
}
