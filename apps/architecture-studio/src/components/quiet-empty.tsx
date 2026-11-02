import type { ComponentType, ReactNode } from 'react';
import type { LucideProps } from 'lucide-react';

/** The same empty state as EmptyState, for server components. It renders its icon on the server, so no function crosses into a client component. */
export function QuietEmpty({ icon: I, title, children }: { icon: ComponentType<LucideProps>; title: string; children?: ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-3 grid size-11 place-items-center rounded-2xl bg-accent-soft text-accent">
        <I aria-hidden className="size-5" strokeWidth={1.75} />
      </span>
      <p className="text-[16px] font-semibold">{title}</p>
      {children ? <p className="mt-1 max-w-md text-[14px] text-ink-2">{children}</p> : null}
    </div>
  );
}
