'use client';

import { ErrorPanel } from './error-panel.tsx';

export function RepoUnavailable({ message, code }: { message: string; code?: string }) {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4">
      <div>
        <ErrorPanel title="The repository could not be read" message={message} code={code} />
        <p className="mx-auto mt-4 max-w-lg text-center text-[13px] text-ink-3">
          The Studio reads the git repository it lives in. Set <span className="font-mono">STUDIO_REPO_ROOT</span> to point at a repository, or <span className="font-mono">STUDIO_REF</span> to read a branch or commit other than HEAD.
        </p>
      </div>
    </main>
  );
}
