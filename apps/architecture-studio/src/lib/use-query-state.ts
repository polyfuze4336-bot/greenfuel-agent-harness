'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

/**
 * Filter state kept in the URL so a view can be shared or bookmarked. Updates use history.replaceState, which Next.js
 * keeps in sync with useSearchParams without a server round trip, so filtering is instant and never re-reads git.
 */
export function useQueryState() {
  const sp = useSearchParams();
  const pathname = usePathname();
  const params = useMemo(() => new URLSearchParams(sp.toString()), [sp]);

  const set = useCallback(
    (updates: Record<string, string | null | undefined>, mode: 'replace' | 'push' = 'replace') => {
      const next = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === undefined || v === '') next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      const url = `${pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
      if (mode === 'push') window.history.pushState(null, '', url);
      else window.history.replaceState(null, '', url);
    },
    [pathname],
  );

  const get = useCallback((k: string) => params.get(k) ?? '', [params]);
  const list = useCallback((k: string) => (params.get(k) ?? '').split(',').filter(Boolean), [params]);
  return { get, list, set, params };
}
