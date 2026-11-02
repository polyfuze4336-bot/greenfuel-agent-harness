import Link from 'next/link';
import { ArrowRight, ArrowUpRight, FileClock, GitPullRequest, History, OctagonAlert } from 'lucide-react';
import { Card, PageHeader, Section, Tag, TonePill, type ToneName } from '@/components/ui.tsx';
import { QuietEmpty } from '@/components/quiet-empty.tsx';
import { RecentChanges } from '@/components/recent-changes.tsx';
import { authConfig } from '@/lib/auth/config.ts';
import { utcDateTime } from '@/lib/format.ts';
import { getModel } from '@/lib/repo/index.ts';
import { runtime } from '@/lib/workflow/http.ts';
import { PROPOSAL_LABEL, type ProposalState } from '@/lib/workflow/labels.ts';
import { isOpen, type AuditEntry, type Proposal } from '@/lib/workflow/store.ts';

export const metadata = { title: 'Changes' };
export const dynamic = 'force-dynamic';

const TONE: Record<ProposalState, ToneName> = {
  'locally-submitted': 'open',
  'awaiting-github-update': 'open',
  'pull-request-created': 'proposed',
  'awaiting-merge': 'proposed',
  applied: 'accepted',
  failed: 'rejected',
  conflicted: 'blocked',
};

const subjectHref = (p: Proposal) => (p.family === 'work' ? `/queue?id=${encodeURIComponent(p.decisionId)}` : `/decisions/${encodeURIComponent(p.decisionId)}`);

function ProposalList({ items }: { items: Proposal[] }) {
  return (
    <ul className="divide-y divide-hairline">
      {items.map((p) => (
        <li key={p.id} data-testid="proposal-row" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3.5">
          <Tag>{p.decisionId}</Tag>
          <span className="min-w-0 flex-1 text-[14px]">
            <Link href={subjectHref(p)} className="font-medium hover:underline">{p.action.replace(/-/g, ' ')}</Link>
            <span className="block text-[12.5px] text-ink-3">Updated {utcDateTime(p.updatedAt)}{p.lastError ? ` · ${p.lastError.message}` : ''}</span>
          </span>
          <TonePill name={TONE[p.state]}>{PROPOSAL_LABEL[p.state]}</TonePill>
          {p.prUrl && p.prNumber ? (
            <a href={p.prUrl} target="_blank" rel="noreferrer noopener" aria-label={`Pull request ${p.prNumber} on GitHub (opens in a new tab)`} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
              #{p.prNumber}
              <ArrowUpRight aria-hidden className="size-3.5" />
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function AuditList({ items }: { items: AuditEntry[] }) {
  if (items.length === 0) return <p className="px-5 py-4 text-[14px] text-ink-2">No review action has been recorded by this Studio yet.</p>;
  return (
    <ul className="divide-y divide-hairline" data-testid="audit-list">
      {items.map((e) => (
        <li key={e.hash} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-5 py-3 text-[13.5px]">
          <span className="w-[150px] shrink-0 pt-px text-[12.5px] text-ink-3 tnum">{utcDateTime(e.at)}</span>
          <span className="min-w-0 flex-1">
            <span className="font-medium">{e.action.replace(/-/g, ' ')}</span>
            {e.decisionId ? <> on <span className="font-mono text-[12.5px]">{e.decisionId}</span></> : null}
            <span className="block text-[12.5px] text-ink-3">{e.actor ?? 'no signed-in person'} · {e.outcome}{e.code ? ` (${e.code})` : ''}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function ChangesPage() {
  const m = await getModel();
  const publicView = authConfig().mode === 'public-readonly';
  const store = runtime().service.deps.store;
  const all = store.list().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const needsAttention = all.filter((p) => p.state === 'failed' || p.state === 'conflicted');
  const waiting = all.filter((p) => isOpen(p.state));
  // Sign-in and sign-out are not approvals; the history is the review actions and their outcomes, including refusals.
  const audit = publicView ? [] : store.readAudit({ limit: 60 }).filter((e) => e.action !== 'signin' && e.action !== 'signout').slice(0, 15);
  const { readiness: r, approvals: a } = m.metrics;
  const unsigned = m.approvals.grandfatheredAccepted.length;

  return (
    <>
      <PageHeader title="Changes" lede="What is moving between this Studio and GitHub, who approved what, and whether the architecture is ready to build on. GitHub stays the source of truth: a change counts only after it is merged." />

      <Card className="mb-8 flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4">
        <OctagonAlert aria-hidden className={`size-5 ${r.reviewsApproved === r.reviewsTotal && r.reviewsTotal > 0 ? 'text-[var(--s-accepted-fg)]' : 'text-[var(--s-rejected-fg)]'}`} />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-ink-2">Architecture readiness</p>
          <p className="text-[18px] leading-7 font-semibold tracking-[-0.015em]">{r.label}</p>
        </div>
        <p className="max-w-xl text-[13.5px] leading-5 text-ink-2">{r.reviewsApproved} of {r.reviewsTotal} design reviews approved. {a.outstanding} approvals outstanding.</p>
        <Link href="/baseline" className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-accent hover:underline">
          Readiness detail
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </Card>

      {needsAttention.length > 0 ? (
        <Section id="conflicts" title="Conflicts and failures" aside={`${needsAttention.length} need a person`}>
          <Card className="overflow-hidden border-[var(--s-rejected-fg)]/40">
            <ProposalList items={needsAttention} />
          </Card>
        </Section>
      ) : null}

      <Section id="pending" title="Pending GitHub updates" aside={`${waiting.length} in flight`}>
        <Card className="overflow-hidden">
          {waiting.length > 0 ? (
            <ProposalList items={waiting} />
          ) : publicView ? (
            <QuietEmpty icon={GitPullRequest} title="This is a read-only view">Changes are proposed and tracked in the Studio running with a signed-in approver. Merged changes still appear below, because they are read from GitHub.</QuietEmpty>
          ) : (
            <QuietEmpty icon={GitPullRequest} title="Nothing is waiting on GitHub">No decision or task change is queued, open as a pull request, or awaiting merge.</QuietEmpty>
          )}
        </Card>
      </Section>

      <Section id="approvals" title="Approval history" aside={<Link href="/approvals" className="font-medium text-accent hover:underline">Approval authority</Link>}>
        <Card className="overflow-hidden">
          <dl className="grid gap-px bg-hairline sm:grid-cols-3">
            {[
              ['Signed approval records', a.signedRecords, 'Files in docs/approvals'],
              ['Enrolled approvers', a.enrolledApprovers, 'Public keys in the registry'],
              ['Accepted without a signature', unsigned, 'Grandfathered ADRs, accepted before signatures existed'],
            ].map(([k, v, c]) => (
              <div key={String(k)} className="bg-surface px-5 py-3.5">
                <dt className="text-[12.5px] font-medium text-ink-2">{k}</dt>
                <dd className="text-[24px] leading-8 font-semibold tracking-[-0.02em] tnum">{v}</dd>
                <dd className="text-[12px] text-ink-3">{c}</dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-hairline">
            {publicView ? (
              <QuietEmpty icon={FileClock} title="Review actions are not shown here">This public read-only view has no sign-in, so it records no review actions. Signed approvals live in the repository and are counted above.</QuietEmpty>
            ) : (
              <AuditList items={audit} />
            )}
          </div>
        </Card>
      </Section>

      <Section id="history" title="Repository changes" aside={`Last ${Math.min(m.recentCommits.length, 15)} commits at ${m.repo.commitShort}`}>
        <Card>
          <RecentChanges commits={m.recentCommits.slice(0, 15)} />
        </Card>
        <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-ink-3">
          <History aria-hidden className="size-3.5" />
          Read from the commit the Studio is serving; a newer GitHub commit appears within a minute.
        </p>
      </Section>
    </>
  );
}
