'use client';

import { useEffect } from 'react';
import { ErrorPanel } from '@/components/error-panel.tsx';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <ErrorPanel title="This page could not be shown" message="Something went wrong while reading or rendering repository data. Nothing was changed." code={error.digest ? `ref ${error.digest}` : undefined} onRetry={reset} />;
}
