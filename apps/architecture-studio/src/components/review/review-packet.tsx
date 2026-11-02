import Link from 'next/link';
import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import type { NormalizedDecision } from '@/lib/intel/schema.ts';
import type { Consequences, Diagram } from '@/lib/workflow/context.ts';
import type { Requirement, Risk } from '@/lib/repo/types.ts';
import { utcDate } from '@/lib/format.ts';
import { RichText } from '../rich-text.tsx';
import { SourcePreviewButton } from '../source-preview.tsx';
import { NeutralPill, SourceLink, Tag } from '../ui.tsx';

export function PacketBlock({ title, id, children, hint }: { title: string; id?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-h` : undefined} className="border-t border-hairline px-7 py-5 first:border-t-0">
      <h2 id={id ? `${id}-h` : undefined} className="text-[15px] font-semibold">
        {title}
      </h2>
      {hint ? <p className="mt-0.5 text-[12.5px] leading-5 text-ink-3">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

const Missing = ({ children }: { children?: ReactNode }) => <p className="text-[13.5px] text-ink-3 italic">{children ?? 'Not stated in any source.'}</p>;

export function Required({ d, dependents, blocked }: { d: NormalizedDecision; dependents: number; blocked: number }) {
  return (
    <>
      <PacketBlock title="What decision is required" id="required">
        {d.description ? <p className="text-[14.5px] leading-6 whitespace-pre-line"><RichText text={d.description} /></p> : <Missing />}
      </PacketBlock>
      <PacketBlock title="Why it matters" id="why">
        {d.businessJustification ? <p className="text-[14.5px] leading-6 whitespace-pre-line"><RichText text={d.businessJustification} /></p> : <Missing />}
        <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-[13.5px] sm:grid-cols-2">
          <div>
            <dt className="inline text-ink-3">Priority: </dt>
            <dd className="inline font-medium">{d.priority ? `${d.priority.value} (${d.priority.basis})` : 'Not stated'}</dd>
          </div>
          <div>
            <dt className="inline text-ink-3">Decisions that cite it: </dt>
            <dd className="inline font-medium">{dependents}</dd>
          </div>
          <div>
            <dt className="inline text-ink-3">Requirements waiting on it: </dt>
            <dd className="inline font-medium">{blocked}</dd>
          </div>
          <div>
            <dt className="inline text-ink-3">Needed by: </dt>
            <dd className="inline font-medium">{d.milestone ?? 'Not stated'}</dd>
          </div>
        </dl>
      </PacketBlock>
      <PacketBlock title="Business and technical context" id="context">
        <dl className="grid gap-x-6 gap-y-1.5 text-[13.5px] sm:grid-cols-2">
          <div>
            <dt className="inline text-ink-3">Category: </dt>
            <dd className="inline font-medium">{d.category ?? 'Not stated'}</dd>
          </div>
          <div>
            <dt className="inline text-ink-3">Decision owner: </dt>
            <dd className="inline font-medium">{d.decisionOwner ?? 'Not stated'}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="inline text-ink-3">Required approver role: </dt>
            <dd className="inline font-medium">{d.requiredApproverRole?.text ?? 'Not stated'}</dd>
          </div>
        </dl>
        <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-5 text-ink-3">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          Source: <SourceLink src={{ path: d.source.path, line: d.source.line }} className="inline-flex" />
        </p>
      </PacketBlock>
    </>
  );
}

export function ConsequencesBlock({ c }: { c: Consequences }) {
  const list = (items: Consequences['ifApproved']) => (
    <ul className="space-y-2 text-[13.5px] leading-5">
      {items.map((x, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-ink-3" />
          <span>
            <RichText text={x.text} />
            {x.src ? (
              <>
                {' '}
                <SourceLink src={x.src} className="inline-flex" />
              </>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <PacketBlock title="Consequences of approval or rejection" id="consequences" hint="Taken from relationships and sections recorded in the repository. Nothing here is predicted by a model.">
      <div className="grid gap-5 md:grid-cols-2">
        <div data-testid="if-approved">
          <h3 className="mb-2 text-[13px] font-semibold text-ink-2">If approved</h3>
          {list(c.ifApproved)}
        </div>
        <div data-testid="if-rejected">
          <h3 className="mb-2 text-[13px] font-semibold text-ink-2">If rejected</h3>
          {list(c.ifRejected)}
        </div>
      </div>
      <div className="mt-4 rounded-xl bg-surface-2 px-4 py-3">
        <h3 className="mb-1.5 text-[13px] font-semibold text-ink-2">Either way</h3>
        {list(c.always)}
      </div>
    </PacketBlock>
  );
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function RequirementsRisks({ d, reqs, risks }: { d: NormalizedDecision; reqs: Requirement[]; risks: Risk[] }) {
  return (
    <PacketBlock title="Relevant requirements, risks and dependencies" id="requirements">
      <h3 className="mb-1.5 text-[13px] font-semibold text-ink-2">Requirements ({reqs.length})</h3>
      {reqs.length ? (
        <ul data-testid="requirements-list" className="divide-y divide-hairline rounded-xl border border-hairline">
          {reqs.map((r) => (
            <li key={r.id} className="px-3.5 py-2.5 text-[13.5px] leading-5">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/architecture?rq=${r.id}#requirements`} className="font-mono text-[12.5px] font-medium text-accent hover:underline">
                  {r.id}
                </Link>
                <NeutralPill>{r.priority || 'No priority'}</NeutralPill>
                <span className="min-w-0 flex-1 font-medium">{r.title}</span>
              </div>
              {r.acceptance ? <p className="mt-1 text-ink-2">Acceptance: {clip(r.acceptance, 220)}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <Missing>No requirement traces to this decision.</Missing>
      )}
      <h3 className="mt-5 mb-1.5 text-[13px] font-semibold text-ink-2">Risks ({risks.length})</h3>
      {risks.length ? (
        <ul data-testid="risks-list" className="divide-y divide-hairline rounded-xl border border-hairline">
          {risks.map((r) => (
            <li key={r.id} className="px-3.5 py-2.5 text-[13.5px] leading-5">
              <div className="flex flex-wrap items-center gap-2">
                <Tag>{r.id}</Tag>
                <span className="min-w-0 flex-1 font-medium">{r.title}</span>
                <NeutralPill>{r.status || 'No status'}</NeutralPill>
              </div>
              {r.mitigation ? <p className="mt-1 text-ink-2">Mitigation: {clip(r.mitigation, 220)}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <Missing>No risk is linked to this decision.</Missing>
      )}
      <h3 className="mt-5 mb-1.5 text-[13px] font-semibold text-ink-2">Dependencies</h3>
      <DependencyLine d={d} />
    </PacketBlock>
  );
}

export function DependencyLine({ d }: { d: NormalizedDecision }) {
  const link = (id: string) => (
    <Link key={id} href={`/decisions/${id}/review`} className="font-mono text-[12.5px] font-medium text-accent hover:underline">
      {id}
    </Link>
  );
  const join = (ids: string[]) => ids.flatMap((id, i) => (i ? [', ', link(id)] : [link(id)]));
  return (
    <div data-testid="dependencies" className="space-y-1 text-[13.5px] leading-6">
      <p>
        <span className="text-ink-3">Depends on: </span>
        {d.dependsOn.length ? join(d.dependsOn) : <span className="text-ink-3">none recorded</span>}
      </p>
      <p>
        <span className="text-ink-3">Cited by decisions: </span>
        {d.dependedOnBy.length ? join(d.dependedOnBy) : <span className="text-ink-3">none recorded</span>}
      </p>
    </div>
  );
}

export function DiagramsBlock({ diagrams }: { diagrams: Diagram[] }) {
  return (
    <PacketBlock title="Related architecture diagrams" id="diagrams" hint="Mermaid source found in the decision's own file and in documents that cite it. It is shown as source because no diagram renderer is an approved dependency (T61).">
      {diagrams.length ? (
        <ul data-testid="diagram-list" className="space-y-4">
          {diagrams.map((g) => (
            <li key={`${g.path}:${g.line}`} className="rounded-xl border border-hairline">
              <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3.5 py-2 text-[12.5px]">
                <NeutralPill>{g.relation === 'in-source' ? 'In the decision file' : g.relation === 'mentions-decision' ? 'Mentions this decision' : 'In a citing document'}</NeutralPill>
                <span className="font-medium">{g.heading ?? 'Untitled section'}</span>
                <SourceLink src={{ path: g.path, line: g.line }} className="ml-auto" />
              </div>
              <pre tabIndex={0} aria-label={`Mermaid source from ${g.path}`} className="max-h-72 overflow-auto bg-surface-2 px-3.5 py-3 font-mono text-[12px] leading-5">
                {g.text}
              </pre>
            </li>
          ))}
        </ul>
      ) : (
        <Missing>No diagram is recorded in the decision's file or in the documents that cite it.</Missing>
      )}
    </PacketBlock>
  );
}

export function VersionsBlock({ d, commits }: { d: NormalizedDecision; commits: { sha: string; date: string; author: string; subject: string }[] }) {
  return (
    <PacketBlock title="Previous versions of the source" id="versions" hint="Commits that changed the file this decision is read from. Each version opens read-only.">
      {commits.length ? (
        <ul data-testid="versions-list" className="divide-y divide-hairline rounded-xl border border-hairline">
          {commits.map((c) => (
            <li key={c.sha} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5 text-[13.5px]">
              <span className="font-mono text-[12.5px] text-ink-2">{c.sha.slice(0, 7)}</span>
              <span className="min-w-0 flex-1">{c.subject}</span>
              <span className="text-[12.5px] text-ink-3">
                {c.author} · {utcDate(c.date)}
              </span>
              <SourcePreviewButton src={{ path: d.source.path, line: d.source.line }} at={c.sha} label="View this version" />
            </li>
          ))}
        </ul>
      ) : (
        <Missing>No commit history is available for this file.</Missing>
      )}
    </PacketBlock>
  );
}
