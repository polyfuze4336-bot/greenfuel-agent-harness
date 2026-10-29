import Link from 'next/link';
import { ArrowUpRight, OctagonAlert, ShieldAlert } from 'lucide-react';
import { Card, PageHeader, Section, Tag } from '@/components/ui.tsx';
import { StatusBar } from '@/components/status-bar.tsx';
import { utcDate } from '@/lib/format.ts';
import { getModel } from '@/lib/repo/index.ts';
import { STATUS_LABEL, type DecisionStatus } from '@/lib/repo/types.ts';

export const dynamic = 'force-dynamic';

const ORDER: DecisionStatus[] = ['accepted', 'proposed', 'open', 'deferred', 'rejected', 'superseded'];

function Metric({ label, value, caption, href, tone }: { label: string; value: string | number; caption: string; href: string; tone?: 'bad' }) {
  return (
    <Link prefetch={false} href={href} className="group flex flex-col gap-1.5 bg-surface px-5 py-4 transition-colors hover:bg-surface-2">
      <span className="flex items-center justify-between text-[13px] font-medium text-ink-2">
        {label}
        <ArrowUpRight aria-hidden className="size-3.5 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      </span>
      <span className={`text-[28px] leading-8 font-semibold tracking-[-0.02em] tnum ${tone === 'bad' ? 'text-[var(--s-rejected-fg)]' : ''}`}>{value}</span>
      <span className="text-[12.5px] leading-[18px] text-ink-3">{caption}</span>
    </Link>
  );
}

export default async function Overview() {
  const m = await getModel();
  const { decisions: d, tasks: t, approvals: a, readiness: r } = m.metrics;
  const t2 = m.tasks.find((x) => x.id === 'T2');
  const m1 = m.decisions.filter((x) => x.type === 'register' && x.milestone === 'M1' && x.status === 'open');
  const counts = Object.fromEntries(ORDER.map((s) => [s, m.decisions.filter((x) => x.status === s).length])) as Record<DecisionStatus, number>;
  const grandfathered = m.approvals.grandfatheredAccepted.length;

  return (
    <>
      <PageHeader title="Overview" lede={<>Every figure on this page is derived from the repository at commit <span className="font-mono text-[14px]">{m.repo.commitShort}</span> ({utcDate(m.repo.commitDate)}). Definitions are under each number.</>} />

      <Card className="mb-8 overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[1.15fr_1fr]">
          <div className="p-6 lg:border-r lg:border-hairline">
            <p className="mb-2 flex items-center gap-2 text-[13px] font-medium text-ink-2">
              <OctagonAlert aria-hidden className="size-4 text-[var(--s-rejected-fg)]" />
              Architecture readiness
            </p>
            <p data-testid="readiness-label" className="text-[26px] leading-8 font-semibold tracking-[-0.02em]">{r.label}</p>
            <ul className="mt-4 space-y-2 text-[14px] leading-6 text-ink-2">
              <li>
                <span className="tnum font-medium text-ink">{r.reviewsApproved} of {r.reviewsTotal}</span> design reviews are Approved. {r.reviewsBlocked} are Blocked by {r.gateDecisions} open decisions.
              </li>
              <li>
                <span className="tnum font-medium text-ink">{a.enrolledApprovers}</span> approvers are enrolled, and <span className="tnum font-medium text-ink">{a.signedRecords}</span> signed approval records exist.
              </li>
              <li>Implementation phase: <span className="font-medium text-ink">{r.phase ?? 'unknown'}</span>{r.phase === '0' ? ' (not unlocked).' : '.'}</li>
            </ul>
            <p className="mt-4 text-[12.5px] leading-5 text-ink-3">This is a statement of what the design gate and approval registry say, not a percentage. It changes only when those records change.</p>
          </div>
          <div className="p-6">
            <p className="mb-3 text-[13px] font-medium text-ink-2">All {d.total} decisions by recorded status</p>
            <StatusBar parts={ORDER.map((s) => ({ key: s, label: STATUS_LABEL[s], value: counts[s] }))} />
            <p className="mt-4 text-[12.5px] leading-5 text-ink-3">{d.adrs} ADRs and {d.register} open register entries. Accepted means the status line says Accepted; it does not mean signed.</p>
          </div>
        </div>
      </Card>

      <Section title="Key figures" aside="Select a figure to see its records">
        <Card className="overflow-hidden">
          <div className="grid grid-cols-1 gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Total decisions" value={d.total} caption={`${d.adrs} ADRs plus ${d.register} register entries`} href="/decisions" />
            <Metric label="Pending decisions" value={d.pending} caption={`${d.open} Open and ${d.proposed} Proposed`} href="/decisions?status=open,proposed" />
            <Metric label="Accepted decisions" value={d.accepted} caption={`${d.acceptedSigned} with a signed approval record. ${grandfathered} were accepted by owner instruction before signing existed.`} href="/decisions?status=accepted" />
            <Metric label="Rejected decisions" value={d.rejected} caption="No ADR or register entry has a Rejected status." href="/decisions?status=rejected" />
            <Metric label="Deferred decisions" value={d.deferred} caption={t2 && t2.status === 'deferred' ? 'No decision has a Deferred status. Owner task T2 records that answering the register was deferred.' : 'No decision has a Deferred status.'} href="/decisions?status=deferred" />
            <Metric label="Blocked tasks" value={t.blocked} caption={`of ${t.ownerTodo} owner tasks state an unmet prerequisite (rule-based)`} href="/queue?blocked=1" tone={t.blocked > 0 ? 'bad' : undefined} />
            <Metric label="Outstanding approvals" value={a.outstanding} caption={`${a.adrs} Proposed ADRs and ${a.reviews} design reviews`} href="/approvals" />
            <Metric label="Architecture readiness" value={r.reviewsApproved === r.reviewsTotal && r.reviewsTotal > 0 ? 'Gate passed' : 'Not ready'} caption={`${r.reviewsApproved} of ${r.reviewsTotal} design reviews Approved`} href="/architecture#reviews" tone={r.reviewsApproved < r.reviewsTotal ? 'bad' : undefined} />
          </div>
        </Card>
      </Section>

      <Section id="blockers" title="Critical blockers" aside={`${m.blockers.length} found, each derived from a repository fact`}>
        {m.blockers.length === 0 ? (
          <p className="text-[14px] text-ink-2">No blocker is derivable from the repository at this commit.</p>
        ) : (
          <Card>
            <ul className="divide-y divide-hairline">
              {m.blockers.map((b) => (
                <li key={b.id}>
                  <Link prefetch={false} href={b.href ?? '/'} className="flex items-start gap-4 px-5 py-4 transition-colors hover:bg-surface-2">
                    <ShieldAlert aria-hidden className="mt-0.5 size-[18px] shrink-0 text-[var(--s-rejected-fg)]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <Tag>{b.id}</Tag>
                        <span className="text-[15px] font-medium">{b.title}</span>
                      </span>
                      <span className="mt-1 block text-[13.5px] leading-5 text-ink-2">{b.detail}</span>
                      <span className="mt-1 block text-[12px] text-ink-3">Basis: {b.basis}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>

      <Section title="Needed by milestone M1" aside={`${m1.length} open decisions, before options analysis can start`}>
        {m1.length === 0 ? (
          <p className="text-[14px] text-ink-2">No open decision is pinned to M1.</p>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13.5px]">
              <caption className="sr-only">Open decisions needed by milestone M1</caption>
              <thead className="text-[12px] text-ink-3">
                <tr className="border-b border-hairline">
                  <th scope="col" className="px-5 py-2.5 font-medium">ID</th>
                  <th scope="col" className="py-2.5 font-medium">Decision or clarification needed</th>
                  <th scope="col" className="py-2.5 pr-5 font-medium">Owner role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {m1.map((x) => (
                  <tr key={x.id} className="hover:bg-surface-2">
                    <td className="px-5 py-2.5 align-top whitespace-nowrap">
                      <Link prefetch={false} href={`/decisions?id=${x.id}`} className="font-mono text-[12.5px] font-medium text-accent hover:underline">{x.id}</Link>
                    </td>
                    <td className="py-2.5 pr-4 align-top">{x.title}</td>
                    <td className="py-2.5 pr-5 align-top text-ink-2">{x.owner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </Section>

      <Section title="Recent repository activity" aside={`Last ${m.recentCommits.length} commits at ${m.repo.commitShort}`}>
        <Card>
          <ul className="divide-y divide-hairline">
            {m.recentCommits.map((c) => (
              <li key={c.sha} className="flex items-start gap-4 px-5 py-3 text-[13.5px]">
                <span className="w-[60px] shrink-0 pt-px font-mono text-[12.5px] text-ink-3">{c.short}</span>
                <span className="min-w-0 flex-1">
                  <span className="block">{c.subject}</span>
                  <span className="block text-[12px] text-ink-3">{c.author} · {utcDate(c.date)}</span>
                </span>
                {c.localOnly ? <span className="rounded bg-[var(--s-open-bg)] px-1.5 text-[10.5px] leading-5 font-semibold tracking-wide whitespace-nowrap text-[var(--s-open-fg)] uppercase">Not pushed</span> : null}
              </li>
            ))}
          </ul>
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

      <p className="text-[12.5px] leading-5 text-ink-3">
        Counting rules are documented in <span className="font-mono">docs/architecture-studio/DATA-MAPPING.md</span>. The tests compare these figures with the independent discovery snapshot.
      </p>
    </>
  );
}
