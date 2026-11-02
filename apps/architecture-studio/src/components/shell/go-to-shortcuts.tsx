'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { NAV } from './nav.ts';

const TYPING = /^(INPUT|TEXTAREA|SELECT)$/;

/**
 * Press g, then o, d, c or p, to go to Overview, Decisions, Changes or Presentation. It does nothing while someone is typing,
 * while a dialog is open, or with a modifier key held, so it never competes with a form or with the screen reader's own keys.
 */
export function GoToShortcuts() {
  const router = useRouter();
  useEffect(() => {
    let armedAt = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing) return;
      if (t && (TYPING.test(t.tagName) || t.isContentEditable)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const key = e.key.toLowerCase();
      if (key === 'g') {
        armedAt = Date.now();
        return;
      }
      if (armedAt && Date.now() - armedAt < 1500) {
        armedAt = 0;
        const dest = NAV.find((n) => n.key === key);
        if (dest) {
          e.preventDefault();
          router.push(dest.href);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);
  return null;
}
