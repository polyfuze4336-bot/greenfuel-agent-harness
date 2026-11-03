import Link from 'next/link';
import { ArrowUpRight, CircleAlert, FileClock, GitPullRequest, History } from 'lucide-react';
import { Card, PageHeader, Section, Tag, TonePill, type ToneName } from '@/components/ui.tsx';
import { QuietEmpty } from '@/components/quiet-empty.tsx';
import { RecentChanges } from '@/components/recent-changes.tsx';
import { FreshnessBar } from '@/components/overview/freshness-bar.tsx';
import { ReadinessCard } from '@/components/overview/readiness-card.tsx';
import { authConfig } from '@/lib/auth/config.ts';
import { lastReconcile } from '@/lib/github/reconcile.ts';
import { affectedTasks, baselineChanges, decisionHistory } from '@/lib/next/changes.ts';
import { getNextView } from '@/lib/next/server.ts';
import { utcDate, utcDateTime } from '@/lib/format.ts';
import { pageSession, runtime } from '@/lib/workflow/http.ts';
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

function Fold({ id, title, count, aside, children, open }: { id: string; title: string; count: number; aside?: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details id={id} data-testid={id} open={open} className="group mb-3 rounded-2xl border border-hairline bg-surface">
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
        <h2 className="text-[15px] font-semibold">
          {title} <span className="ml-1 text-[13px] font-medium text-ink-3 tnum" data-testid={`${id}-count`}>{count}</span>
        </h2>
        {aside ? <span className="text-[12.5px] text-ink-3">{aside}</span> : null}
      </summary>
      <div className="border-t border-hairline">{children}</div>
    </details>
  );
}

const Quiet = ({ children, testid }: { children: React.ReactNode; testid?: string }) => <p data-testid={testid} className="px-5 py-4 text-[13.5px] text-ink-3">{children}</p>;

export default async function ChangesPage() {
  const v = await getNextView(await pageSession());
  const m = v.queue.model;
  const publicView = authConfig().mode === 'public-readonly';
  const store = runtime().service.deps.store;
  const all = store.list().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const needsAttention = all.filter((p) => p.state === 'failed' || p.state === 'conflicted');
  const waiting = all.filter((p) => isOpen(p.state));
  const reconcile = lastReconcile();
  const reconcileFailures = reconcile?.failures ?? [];
  // Sign-in and sign-out are not approvals; the history is the review actions and their outcomes, including refusals.
  const audit = publicView ? [] : store.readAudit({ limit: 60 }).filter((e) => e.action !== 'signin' && e.action !== 'signout').slice(0, 10);
  const titles = new Map(m.register.records.map((d) => [d.id, d.title]));
  const history = decisionHistory(m.register.records, 10);
  const changes = baselineChanges(v.baseline.baselines);
  const affected = affectedTasks(v.queue.snapshot.items);
  const stale = v.stale;
  const unreachable = v.freshness.state === 'stale';
  const stuck = needsAttention.length + reconcileFailures.length;

  return (
    <>
      <PageHeader title="Changes" lede="What is moving between this Studio and GitHub, what has gone stale, and whether the architecture is ready to build on. GitHub stays the source of truth: a change counts only after it is merged.">
        <FreshnessBar initial={v.freshness} />
      </PageHeader>

      {unreachable ? (
        <div role="alert" data-testid="outage-banner" className="mb-6 flex items-start gap-3 rounded-2xl border border-[var(--s-open-fg)]/40 bg-[var(--s-open-bg)] px-5 py-3.5 text-[14px] text-[var(--s-open-fg)]">
          <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          <p>
            <span className="font-semibold">GitHub may be unreachable.</span> This Studio last synced {Math.round((v.freshness.ageSeconds ?? 0) / 60)} minutes ago and is showing the last copy it has, from commit <span className="font-mono">{v.freshness.commitShort}</span>. Nothing here is lost: it catches up on its own when GitHub answers, or press Refresh.
          </p>
        </div>
      ) : null}

      <ReadinessCard o={v.overview} compact />

      <Section id="conflicts" title="Sync failures" aside={stuck > 0 ? `${stuck} need a person` : 'none'}>
        {stuck > 0 ? (
          <Card className="overflow-hidden border-[var(--s-rejected-fg)]/40">
            {needsAttention.length > 0 ? <ProposalList items={needsAttention} /> : null}
            {reconcileFailures.length > 0 ? (
              <ul className="divide-y divide-hairline border-t border-hairline first:border-t-0" data-testid="reconcile-failures">
                {reconcileFailures.map((f, i) => (
                  <li key={i} className="px-5 py-3 text-[13.5px] text-ink-2">The last check against GitHub could not complete: {f.message}</li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : (
          <Card>
            <Quiet testid="no-failures">No change is stuck. Everything the Studio sent reached GitHub, or is waiting for a person to merge it.</Quiet>
          </Card>
        )}
      </Section>

      <Section id="pending" title="Pending GitHub pull requests" aside={`${waiting.length} in flight`}>
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

      <Fold id="history" title="Decision history" count={history.length} aside={`latest recorded, from ${m.repo.commitShort}`} open>
        {history.length === 0 ? (
          <Quiet>No decision carries a dated record yet.</Quiet>
        ) : (
          <ul className="divide-y divide-hairline" data-testid="decision-history">
            {history.map((h, i) => (
              <li key={i} className="flex flex-wrap items-start gap-x-4 gap-y-0.5 px-5 py-3 text-[13.5px]">
                <span className="w-[88px] shrink-0 pt-px text-[12.5px] text-ink-3 tnum">{utcDate(h.at)}</span>
                <span className="min-w-0 flex-1">
                  <Link href={h.href} className="font-medium hover:underline"><span className="font-mono text-[12.5px]">{h.decisionId}</span> {titles.get(h.decisionId)}</Link>
                  <span className="block text-[12.5px] text-ink-3">{h.source}{h.signed ? ', signed' : ', not signed'}{h.actor ? ` · ${h.actor}` : ''}{h.more ? ` · ${h.more} more record${h.more === 1 ? '' : 's'}` : ''} · {h.text.slice(0, 140)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {audit.length > 0 ? (
          <div className="border-t border-hairline">
            <p className="px-5 pt-3 text-[12px] font-medium text-ink-3">Actions recorded by this Studio</p>
            <AuditList items={audit} />
          </div>
        ) : null}
        <p className="border-t border-hairline px-5 py-2.5 text-[12.5px] text-ink-3">
          <Link href="/approvals" className="font-medium text-accent hover:underline">Approval authority</Link> shows who may approve what.
        </p>
      </Fold>

      <Fold id="baseline-changes" title="Architecture baseline changes" count={changes.length} aside={v.baseline.baselines.length ? `${v.baseline.baselines.length} baseline${v.baseline.baselines.length === 1 ? '' : 's'}` : 'none authorized yet'} open={changes.length > 0}>
        {changes.length === 0 ? (
          <Quiet testid="no-baseline-changes">{v.baseline.baselines.some((b) => b.status === 'approved') ? 'Nothing has changed since the authorized baseline.' : 'No baseline has been authorized yet, so there is nothing to have changed since.'}</Quiet>
        ) : (
          <ul className="divide-y divide-hairline" data-testid="baseline-change-list">
            {changes.map((c, i) => (
              <li key={i} className="px-5 py-3 text-[13.5px]">
                <span className="mr-2 rounded bg-surface-2 px-1.5 py-px font-mono text-[11.5px] text-ink-3">{c.baseline}</span>
                <span className={c.severity === 'invalidates' ? 'font-medium text-[var(--s-rejected-fg)]' : 'text-ink-2'}>{c.severity === 'invalidates' ? 'Invalidates it' : 'Look at it'}</span>
                <span className="text-ink-2">: {c.text}</span>
                <span className="block text-[12.5px] text-ink-3">{c.controlledBy ? `Made under authorized reopening ${c.controlledBy}.` : 'Not made under an authorized reopening.'}</span>
              </li>
            ))}
          </ul>
        )}
      </Fold>

      <Fold id="stale-evidence" title="Stale evidence" count={stale.length} aside="missing, failing or older than the decision" open={stale.length > 0}>
        {stale.length === 0 ? (
          <Quiet testid="no-stale-evidence">Every evidence record a decision cites exists, passed, and is newer than the decision.</Quiet>
        ) : (
          <ul className="divide-y divide-hairline" data-testid="stale-list">
            {stale.map((s, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 px-5 py-3 text-[13.5px]">
                <Link href={`/decisions?id=${encodeURIComponent(s.decisionId)}`} className="font-mono text-[12.5px] font-medium text-accent hover:underline">{s.decisionId}</Link>
                <span className="rounded bg-surface-2 px-1.5 py-px text-[11.5px] font-semibold text-ink-3 uppercase">{s.kind}</span>
                <span className="min-w-0 flex-1 text-ink-2">{s.text}</span>
              </li>
            ))}
          </ul>
        )}
      </Fold>

      <Fold id="affected-tasks" title="Affected tasks" count={affected.length} aside="blocked or flagged by a decision or requirement change" open={affected.length > 0 && affected.length <= 8}>
        {affected.length === 0 ? (
          <Quiet testid="no-affected-tasks">No open task is blocked or flagged by a change to a decision or requirement.</Quiet>
        ) : (
          <ul className="divide-y divide-hairline" data-testid="affected-list">
            {affected.slice(0, 25).map((a, i) => (
              <li key={i} className="px-5 py-3 text-[13.5px]">
                <Link href={a.href} className="font-medium hover:underline"><span className="font-mono text-[12.5px]">{a.id}</span> {a.title}</Link>
                <span className="block text-[12.5px] text-ink-3">{a.kind === 'blocked' ? 'Cannot proceed' : 'Look again'} · {a.why}</span>
              </li>
            ))}
            {affected.length > 25 ? <li className="px-5 py-3 text-[12.5px] text-ink-3">And {affected.length - 25} more in the <Link href="/queue?view=blocked" className="font-medium text-accent hover:underline">work queue</Link>.</li> : null}
          </ul>
        )}
      </Fold>

      <Fold id="repo-changes" title="Repository changes" count={Math.min(m.recentCommits.length, 15)} aside={`commits at ${m.repo.commitShort}`}>
        <RecentChanges commits={m.recentCommits.slice(0, 15)} />
        <p className="flex items-center gap-1.5 border-t border-hairline px-5 py-2.5 text-[12.5px] text-ink-3">
          <History aria-hidden className="size-3.5" />
          Read from the commit the Studio is serving; a newer GitHub commit appears within a minute.
        </p>
      </Fold>
    </>
  );
}