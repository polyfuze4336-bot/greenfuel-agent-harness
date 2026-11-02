import Link from 'next/link';
import { ArrowRight, ArrowUpRight, CircleCheck, Gavel, OctagonAlert, ShieldAlert } from 'lucide-react';
import { Card, PageHeader, Section, Tag } from '@/components/ui.tsx';
import { RecentChanges } from '@/components/recent-changes.tsx';
import { StatusBar } from '@/components/status-bar.tsx';
import { utcDate } from '@/lib/format.ts';
import { getModel } from '@/lib/repo/index.ts';
import type { NormStatus } from '@/lib/intel/schema.ts';
import { runtime } from '@/lib/workflow/http.ts';
import { pendingOrder } from '@/lib/workflow/runtime.ts';

export const dynamic = 'force-dynamic';

const ORDER: NormStatus[] = ['Approved', 'Proposed', 'Pending Review', 'Blocked', 'Deferred', 'Rejected', 'Superseded'];

function Metric({ label, value, caption, href, tone }: { label: string; value: string | number; caption: string; href: string; tone?: 'bad' }) {
  return (
    <Link prefetch={false} href={href} className="group flex flex-col gap-1 bg-surface px-5 py-4 transition-colors hover:bg-surface-2">
      <span className="flex items-center justify-between text-[13px] font-medium text-ink-2">
        {label}
        <ArrowUpRight aria-hidden className="size-3.5 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      </span>
      <span className={`text-[26px] leading-8 font-semibold tracking-[-0.02em] tnum ${tone === 'bad' ? 'text-[var(--s-rejected-fg)]' : ''}`}>{value}</span>
      <span className="text-[12.5px] leading-[18px] text-ink-3">{caption}</span>
    </Link>
  );
}

function Row({ href, title, detail, trailing }: { href: string; title: string; detail: string; trailing?: string }) {
  return (
    <li>
      <Link prefetch={false} href={href} className="group flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2">
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-medium">{title}</span>
          <span className="mt-0.5 block text-[13px] leading-5 text-ink-2">{detail}</span>
        </span>
        {trailing ? <span className="shrink-0 pt-0.5 text-[13px] font-medium text-ink-2 tnum">{trailing}</span> : null}
        <ArrowRight aria-hidden className="mt-1 size-4 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      </Link>
    </li>
  );
}

export default async function Overview() {
  const m = await getModel();
  const { tasks: t, approvals: a, readiness: r } = m.metrics;
  const store = runtime().service.deps.store;
  const queue = pendingOrder(m.register.records, (id) => !!store.openFor(id));
  const next = queue[0];
  const rs = m.register.stats;
  const counts = rs.byStatus;
  const pendingN = counts.Proposed + counts['Pending Review'] + counts.Blocked;
  const flagged = m.register.records.filter((x) => x.flags.length > 0).length;
  const m1 = m.register.records.filter((x) => x.kind === 'register-entry' && x.milestone === 'M1' && x.status === 'Pending Review').length;
  const ready = r.reviewsApproved === r.reviewsTotal && r.reviewsTotal > 0;
  const approvedUnsigned = m.register.records.filter((x) => x.status === 'Approved' && x.approvalBasis !== 'signed').length;

  return (
    <>
      <PageHeader title="Overview" lede={<>Everything here is read from the repository at commit <span className="font-mono text-[14px]">{m.repo.commitShort}</span> ({utcDate(m.repo.commitDate)}).</>}>
        {next ? (
          <Link href={`/decisions/${next.id}/review`} data-testid="start-review" className="inline-flex items-center gap-2 rounded-lg bg-selected px-3.5 py-2 text-[13.5px] font-medium text-selected-ink hover:opacity-90">
            <Gavel aria-hidden className="size-4" />
            Review next decision
          </Link>
        ) : null}
      </PageHeader>

      <Card className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4">
        {ready ? <CircleCheck aria-hidden className="size-5 text-[var(--s-accepted-fg)]" /> : <OctagonAlert aria-hidden className="size-5 text-[var(--s-rejected-fg)]" />}
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-ink-2">Architecture readiness</p>
          <p data-testid="readiness-label" className="text-[20px] leading-7 font-semibold tracking-[-0.015em]">{r.label}</p>
        </div>
        <p className="max-w-xl text-[13.5px] leading-5 text-ink-2">
          {r.reviewsApproved} of {r.reviewsTotal} design reviews are approved. {a.enrolledApprovers} approvers are enrolled and {a.signedRecords} signed approval records exist. Implementation phase: {r.phase ?? 'unknown'}.
        </p>
        <Link href="/baseline" data-testid="baseline-link" className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-accent hover:underline">
          Build authorization
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </Card>

      <div className="mb-2 grid gap-x-6 lg:grid-cols-2">
        <div className="min-w-0">
        <Section id="attention" title="Needs your attention" aside={`${queue.length} decisions waiting`}>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-hairline">
              {next ? <Row href={`/decisions/${next.id}/review`} title={`Review ${next.id}`} detail={next.title} trailing="Next" /> : null}
              <Row href="/decisions?status=Proposed,Pending%20Review,Blocked" title="Decisions awaiting a decision" detail={`${counts['Pending Review']} pending review, ${counts.Proposed} proposed, ${counts.Blocked} blocked`} trailing={String(pendingN)} />
              <Row href="/approvals" title="Approvals outstanding" detail={`${a.adrs} proposed ADRs and ${a.reviews} design reviews need a signed approval`} trailing={String(a.outstanding)} />
              {m1 > 0 ? <Row href="/decisions?milestone=M1&status=open" title="Needed by milestone M1" detail="Open decisions that must be settled before options analysis can start" trailing={String(m1)} /> : null}
              {flagged > 0 ? <Row href="/decisions?scope=review" title="Flagged for human review" detail="The register validator marked these records for a person to look at" trailing={String(flagged)} /> : null}
            </ul>
          </Card>
        </Section>


        <Section title="What changed recently" aside={<Link href="/changes" className="font-medium text-accent hover:underline">All changes</Link>}>
          <Card>
            <RecentChanges commits={m.recentCommits.slice(0, 6)} />
          </Card>
        </Section>
        </div>
        <Section id="blockers" title="What is blocking progress" aside={`${m.blockers.length} found, each from a repository fact`}>
          {m.blockers.length === 0 ? (
            <Card className="px-5 py-4 text-[14px] text-ink-2">No blocker is derivable from the repository at this commit.</Card>
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-hairline">
                {m.blockers.map((b) => (
                  <li key={b.id}>
                    <Link prefetch={false} href={b.href ?? '/'} className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2">
                      <ShieldAlert aria-hidden className="mt-0.5 size-[17px] shrink-0 text-[var(--s-rejected-fg)]" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <Tag>{b.id}</Tag>
                          <span className="text-[14.5px] font-medium">{b.title}</span>
                        </span>
                        <span className="mt-1 block text-[13px] leading-5 text-ink-2">{b.detail}</span>
                        <span className="mt-1 block text-[12px] text-ink-3">Basis: {b.basis}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="border-t border-hairline px-5 py-3 text-[13px]">
                <Link href="/queue/blocking" className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
                  What is blocking the build?
                  <ArrowRight aria-hidden className="size-4" />
                </Link>
              </div>
            </Card>
          )}
        </Section>

      </div>

      <Section title="At a glance" aside="Select a figure to see its records">
        <Card className="overflow-hidden">
          <div className="grid grid-cols-1 gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Pending decisions" value={pendingN} caption={`of ${rs.total} (${rs.byKind.adr} ADRs, ${rs.byKind['register-entry']} register entries)`} href="/decisions?status=Proposed,Pending%20Review,Blocked" />
            <Metric label="Approved decisions" value={counts.Approved} caption={`${counts.Approved - approvedUnsigned} with a signed record; ${approvedUnsigned} on the owner's instruction, unsigned`} href="/decisions?status=Approved" />
            <Metric label="Blocked tasks" value={t.blocked} caption={`of ${t.ownerTodo} owner tasks state an unmet prerequisite`} href="/queue?prereq=1" tone={t.blocked > 0 ? 'bad' : undefined} />
            <Metric label="Outstanding approvals" value={a.outstanding} caption={`${a.adrs} Proposed ADRs and ${a.reviews} design reviews`} href="/approvals" />
          </div>
          <div className="border-t border-hairline px-5 py-4">
            <p className="mb-3 text-[13px] font-medium text-ink-2">All {rs.total} decisions by status</p>
            <StatusBar parts={ORDER.map((s) => ({ key: s.toLowerCase().replace(' ', '-'), label: s, value: counts[s] }))} />
          </div>
        </Card>
      </Section>

      {m.warnings.length > 0 ? (
        <Section title="Read warnings">
          <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-ink-2">
            {m.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
