import { Suspense } from 'react';
import { ShieldOff } from 'lucide-react';
import { PendingApprovals } from '@/components/approvals/pending-approvals.tsx';
import { CopyButton, Card, PageHeader, Section, SourceLink, StatusPill, Tag } from '@/components/ui.tsx';
import { PageSkeleton } from '@/components/page-skeleton.tsx';
import { buildLookup } from '@/lib/lookup.ts';
import { getModel } from '@/lib/repo/index.ts';
import Link from 'next/link';

export const metadata = { title: 'Approvals' };
export const dynamic = 'force-dynamic';

const STEPS: { title: string; cmd: string; note: string }[] = [
  { title: 'Enroll once, on your own computer', cmd: 'node harness/scripts/approval.mjs enroll --out <folder outside the repository> --holder "Full Name" --classes architecture,repository', note: 'Creates your key pair and an enrollment request. It registers nothing.' },
  { title: 'Register the key', cmd: 'node harness/scripts/approval.mjs register --request docs/approvals/enrollment/ENR-x.json', note: 'You confirm the fingerprint you compared out of band. The registry change must arrive in a GitHub-verified commit.' },
  { title: 'Create a decision request', cmd: 'node harness/scripts/approval.mjs decision --type adr --id <four digits> --reason "<your reason>" --out docs/approvals/AP-x.json', note: 'Bound to the exact text now in the repository. Use the Copy request command button on a row above for a filled-in version.' },
  { title: 'Sign it', cmd: 'node harness/scripts/approval.mjs sign --file docs/approvals/AP-x.json --key <private.pem>', note: 'Asks for your passphrase. Refuses to run without an interactive terminal.' },
  { title: 'Verify it', cmd: 'node harness/scripts/approval.mjs verify --file docs/approvals/AP-x.json', note: 'Read-only check against the registry.' },
];

export default async function ApprovalsPage() {
  const m = await getModel();
  const a = m.approvals;
  const grand = m.decisions.filter((d) => a.grandfatheredAccepted.includes(d.id));
  return (
    <>
      <PageHeader title="Approvals" lede="Who may approve, what is waiting, and what has been accepted without a signature. The Studio never signs: a person signs, at their own computer, with their own key." />

      <Section title="Approval authority" aside="From harness/policy/approvers.json and docs/approvals">
        <Card className="overflow-hidden">
          <dl className="grid grid-cols-1 gap-px bg-hairline sm:grid-cols-3">
            {[
              ['Enrolled approvers', a.enrolledApprovers, 'Public keys in the registry'],
              ['Signed approval records', a.signedRecords, 'Files in docs/approvals'],
              ['Implementation phase', a.phase ?? 'unknown', 'From docs/state/STATE.md'],
            ].map(([k, v, c]) => (
              <div key={String(k)} className="bg-surface px-5 py-4">
                <dt className="text-[13px] font-medium text-ink-2">{k}</dt>
                <dd className="mt-1 text-[28px] leading-8 font-semibold tracking-[-0.02em] tnum" data-testid={`authority-${String(k).split(' ')[0]!.toLowerCase()}`}>{v}</dd>
                <dd className="text-[12.5px] text-ink-3">{c}</dd>
              </div>
            ))}
          </dl>
          {a.enrolledApprovers === 0 ? (
            <div className="flex gap-3 border-t border-hairline px-5 py-4 text-[14px] leading-6" style={{ background: 'var(--s-open-bg)', color: 'var(--s-open-fg)' }}>
              <ShieldOff aria-hidden className="mt-1 size-[18px] shrink-0" />
              <p>
                <strong>No approver is enrolled, so no signed approval of any class can exist.</strong> Every new ADR acceptance, every design approval and any phase change waits on this. Naming and enrolling approvers is owner action T3/T13.
              </p>
            </div>
          ) : null}
        </Card>
        {a.validatorOutput ? (
          <div className="mt-4">
            <p className="mb-1.5 text-[12.5px] text-ink-3">Output of <span className="font-mono">validate-approvals</span>, as recorded in a derived file (not re-run by the Studio):</p>
            <pre className="overflow-x-auto rounded-xl border border-hairline bg-surface-2 px-4 py-3 font-mono text-[12.5px] leading-5 whitespace-pre-wrap text-ink-2">{a.validatorOutput}</pre>
            <div className="mt-1.5">
              <SourceLink src={{ path: a.validatorSrc, line: 1 }} />
            </div>
          </div>
        ) : null}
      </Section>

      <Section id="outstanding" title="Outstanding approvals" aside={`${a.pending.length} waiting`}>
        <Suspense fallback={<PageSkeleton rows={4} />}>
          <PendingApprovals items={a.pending} lookup={buildLookup(m)} />
        </Suspense>
      </Section>

      <Section id="unsigned" title="Accepted without a signature" aside={`${grand.length} ADRs`}>
        <p className="mb-3 max-w-3xl text-[14px] leading-6 text-ink-2">These ADRs say Accepted because the owner instructed it in chat before signed approvals existed. The harness exempts ADRs 0001 to 0015 from the signature rule (a fixed list). They are accepted, not signed.</p>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[13.5px]" data-testid="grandfathered-table">
            <caption className="sr-only">ADRs accepted without a signature</caption>
            <thead className="border-b border-hairline bg-surface-2 text-[12px] text-ink-3">
              <tr>
                <th scope="col" className="w-[110px] py-2.5 pl-5 font-medium">ID</th>
                <th scope="col" className="py-2.5 font-medium">Decision</th>
                <th scope="col" className="w-[110px] py-2.5 font-medium">Status</th>
                <th scope="col" className="hidden w-[110px] py-2.5 pr-5 font-medium md:table-cell">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {grand.map((d) => (
                <tr key={d.id} className="hover:bg-surface-2">
                  <td className="py-2.5 pl-5">
                    <Link href={`/decisions?id=${d.id}`} className="font-mono text-[12.5px] font-medium text-accent hover:underline">{d.id}</Link>
                  </td>
                  <td className="py-2.5 pr-4">{d.title}</td>
                  <td className="py-2.5 pr-4"><StatusPill status={d.status} /></td>
                  <td className="hidden py-2.5 pr-5 text-ink-2 md:table-cell">{d.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Section>

      <Section id="how" title="How a signature is made" aside={<SourceLink src={{ path: 'harness/scripts/approval.mjs', line: 1 }} />}>
        <p className="mb-4 max-w-3xl text-[14px] leading-6 text-ink-2">These commands are copied from the usage header of the approval tool. They are run by a person in a terminal; the Studio never runs them and holds no key.</p>
        <ol className="space-y-3">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <Card className="p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[14px] font-medium">
                    <span className="mr-2 text-ink-3 tnum">{i + 1}.</span>
                    {s.title}
                  </p>
                  <CopyButton text={s.cmd} />
                </div>
                <pre className="overflow-x-auto rounded-lg bg-surface-2 px-3 py-2 font-mono text-[12.5px] leading-5 whitespace-pre-wrap text-ink-2">{s.cmd}</pre>
                <p className="mt-2 text-[12.5px] text-ink-3">{s.note}</p>
              </Card>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[12.5px] text-ink-3">
          <Tag>read-only</Tag> This page changes nothing. Decisions are reviewed one at a time on each decision&rsquo;s review page, which proposes them as pull requests. Signed approvals still use the commands above.
        </p>
      </Section>
    </>
  );
}
