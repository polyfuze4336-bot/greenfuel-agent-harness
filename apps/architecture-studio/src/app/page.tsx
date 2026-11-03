import { PageHeader } from '@/components/ui.tsx';
import { ActionList } from '@/components/overview/action-list.tsx';
import { FreshnessBar } from '@/components/overview/freshness-bar.tsx';
import { NextActionCard } from '@/components/overview/next-action-card.tsx';
import { ReadinessCard } from '@/components/overview/readiness-card.tsx';
import { getNextView } from '@/lib/next/server.ts';
import type { ListItem } from '@/lib/next/overview.ts';
import type { NextAction } from '@/lib/next/types.ts';
import { pageSession } from '@/lib/workflow/http.ts';

export const dynamic = 'force-dynamic';

const row = (a: NextAction): ListItem => ({ key: a.key, title: a.title, detail: a.detail, href: a.href, meta: null, action: a });

export default async function Overview() {
  const v = await getNextView(await pageSession());
  const o = v.overview;
  const lanes = o.awaiting.byLane;
  const laneNote = [lanes.architecture ? `${lanes.architecture} to decide` : '', lanes.stakeholder ? `${lanes.stakeholder} answers needed` : '', lanes.verification ? `${lanes.verification} to verify` : ''].filter(Boolean).join(' · ');

  return (
    <>
      <PageHeader title="Overview" lede="What to do next to move the architecture toward an approved build.">
        <FreshnessBar initial={v.freshness} />
      </PageHeader>

      <NextActionCard next={o.next} then={o.then.map(row)} waiting={o.waitingOnOthers.map(row)} signedIn={!!v.me} readyForBaseline={o.readiness.ready} />
      <ReadinessCard o={o} />

      <div className="mb-8 grid gap-x-6 gap-y-6 lg:grid-cols-2">
        <ActionList id="attention" title="Decisions awaiting review" count={o.awaiting.count} items={o.awaiting.items} empty="No decision waits for review." viewAll={{ href: '/decisions?status=Proposed,Pending%20Review,Blocked', label: laneNote || 'All decisions' }} />
        <ActionList id="blockers" title="Critical blockers" count={o.blockers.count} items={o.blockers.items} empty="Nothing stands between the architecture and the next phase." tone="warn" viewAll={{ href: '/queue/blocking', label: 'What blocks the build' }} />
        <ActionList id="tasks" title="Tasks needing attention" count={o.tasks.count} items={o.tasks.items} empty="No open task ranks for attention." viewAll={{ href: '/queue?view=pending', label: 'Work queue' }} />
        <ActionList id="rework" title="Rejected, needing rework" count={o.rework.count} items={o.rework.items} empty="No rejected decision is still needed." tone="warn" />
        <ActionList id="approved" title="Recently approved" count={o.recentlyApproved.count} items={o.recentlyApproved.items} empty="No decision carries an approval date yet." viewAll={{ href: '/decisions?status=Approved', label: 'All approved' }} />
      </div>
    </>
  );
}
