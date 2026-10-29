import { Suspense } from 'react';
import { CircleDashed, Video } from 'lucide-react';
import { DeckExplorer, QaExplorer } from '@/components/presentation/explorers.tsx';
import { PageSkeleton } from '@/components/page-skeleton.tsx';
import { Card, NeutralPill, PageHeader, Section, SourceLink, Tag } from '@/components/ui.tsx';
import { utcDateTime } from '@/lib/format.ts';
import { getModel } from '@/lib/repo/index.ts';

export const metadata = { title: 'Presentation Studio' };
export const dynamic = 'force-dynamic';

export default async function PresentationPage() {
  const m = await getModel();
  const p = m.presentation;
  const rehearsed = p.rehearsal.filter((r) => r.rehearsed).length;
  const pkgDocs = m.docs.filter((d) => d.path.startsWith('docs/capstone/presentation/'));
  return (
    <>
      <PageHeader title="Presentation Studio" lede="The capstone presentation package as it exists in the repository, and how much of it a person has actually rehearsed. The Studio does not edit slides." />

      <Section id="rehearsal" title="Rehearsal status" aside={`${rehearsed} of ${p.rehearsal.length} criteria rehearsed`}>
        <p className="mb-4 max-w-3xl text-[14px] leading-6 text-ink-2">A criterion changes status only when a named person has observed the behaviour and recorded it. Until then, delivery and consultative behaviour are <strong>not verified</strong>, whatever the preparation material says.</p>
        <Card>
          {p.rehearsal.length === 0 ? (
            <p className="px-5 py-8 text-center text-[14px] text-ink-2">No rehearsal scorecard was found at this commit.</p>
          ) : (
            <ul className="divide-y divide-hairline" data-testid="rehearsal-list">
              {p.rehearsal.map((r) => (
                <li key={r.id} className="flex items-center gap-4 px-5 py-3">
                  <Tag>{r.id}</Tag>
                  <span className="min-w-0 flex-1 text-[14.5px]">{r.title}</span>
                  <NeutralPill title="Status text from the scorecard">{r.rehearsed ? 'Rehearsed' : 'Not rehearsed'}</NeutralPill>
                  <span className="hidden w-[130px] md:block"><SourceLink src={r.src} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      <Section id="deck" title="Deck" aside={<SourceLink src={{ path: 'docs/capstone/presentation/deck/index.html', line: 1 }} />}>
        <Suspense fallback={<PageSkeleton rows={4} />}><DeckExplorer slides={p.slides} /></Suspense>
      </Section>

      <Section id="qa" title="Panel questions" aside={`${p.qa.length} questions`}>
        <Suspense fallback={<PageSkeleton rows={4} />}><QaExplorer items={p.qa} /></Suspense>
      </Section>

      <Section id="recordings" title="Recorded runs" aside={`${p.recordings.length} recordings`}>
        <p className="mb-4 max-w-3xl text-[14px] leading-6 text-ink-2">Each file is a captured run of candidate code on synthetic data. A recording is never presented as live: say so, with its date, if you play one.</p>
        <Card>
          {p.recordings.length === 0 ? (
            <p className="px-5 py-8 text-center text-[14px] text-ink-2">No recordings were found at this commit.</p>
          ) : (
            <ul className="divide-y divide-hairline" data-testid="recording-list">
              {p.recordings.map((r) => (
                <li key={r.path} className="flex items-start gap-4 px-5 py-3">
                  <Video aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-medium">{r.title}</span>
                    <span className="block text-[12.5px] text-ink-3">{r.scenario} · recorded {utcDateTime(r.recordedAt)} at commit <span className="font-mono">{r.gitHead}</span></span>
                  </span>
                  <NeutralPill>{r.notLive ? 'Recorded, not live' : 'Unmarked'}</NeutralPill>
                  <span className="hidden w-[130px] md:block"><SourceLink src={{ path: r.path, line: 1 }} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      <Section id="package" title="Package documents" aside={`${pkgDocs.length} files`}>
        <Card>
          {pkgDocs.length === 0 ? (
            <p className="flex items-center gap-2 px-5 py-8 text-[14px] text-ink-2"><CircleDashed aria-hidden className="size-4" />No presentation documents were found at this commit.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {pkgDocs.map((d) => (
                <li key={d.path} className="flex items-center gap-4 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px]">{d.title}</span>
                    <span className="block font-mono text-[12px] text-ink-3">{d.path}</span>
                  </span>
                  <span className="max-w-[130px]"><SourceLink src={{ path: d.path, line: 1 }} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>
    </>
  );
}
