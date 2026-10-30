'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, RotateCw } from 'lucide-react';
import type { AccessReport } from '@/lib/auth/review.ts';
import { Card, Section, Skeleton, Tag, btn } from '../ui.tsx';

type Report = AccessReport & { decisionsByDomain: Record<string, { total: number; noDesignatedApprover: number }> };
type Problem = { detail?: string; code?: string };

async function call<T>(url: string, init?: RequestInit, csrf?: string) {
  const r = await fetch(url, { credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', ...(csrf ? { 'x-studio-csrf': csrf } : {}) } });
  const body = (await r.json().catch(() => null)) as (T & Problem) | null;
  return { ok: r.ok, status: r.status, body };
}

export function AccessReview() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<{ status: number; detail: string } | null>(null);
  const [csrf, setCsrf] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [s, r] = await Promise.all([call<{ csrf?: string }>('/api/v1/auth/session'), call<Report>('/api/v1/access/review')]);
    if (s.body?.csrf) setCsrf(s.body.csrf);
    if (r.ok && r.body) setReport(r.body);
    else setError({ status: r.status, detail: r.body?.detail ?? `HTTP ${r.status}` });
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const attest = async () => {
    setBusy(true);
    const r = await call<{ at: string }>('/api/v1/access/attest', { method: 'POST', body: JSON.stringify({ note }) }, csrf);
    setBusy(false);
    setMessage(r.ok ? 'Recorded in the audit log.' : (r.body?.detail ?? 'Not recorded.'));
    if (r.ok) void load();
  };
  const suspend = async (subject: string, lift: boolean) => {
    const reason = lift ? '' : (window.prompt(`Why suspend ${subject}? (at least 10 characters)`) ?? '');
    if (!lift && reason.trim().length < 10) return;
    setBusy(true);
    const r = await call('/api/v1/access/suspend', { method: 'POST', body: JSON.stringify({ subject, reason, lift }) }, csrf);
    setBusy(false);
    setMessage(r.ok ? (lift ? 'Suspension lifted.' : 'Suspended. Their sessions have ended.') : (r.body?.detail ?? 'Not changed.'));
    void load();
  };

  if (error)
    return (
      <Card className="p-5">
        <div role="alert" data-testid="access-denied" className="flex items-start gap-3 text-[13.5px] text-[var(--s-rejected-fg)]">
          <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">{error.status === 401 ? 'Sign in to review access.' : error.status === 403 ? 'Access review is for Administrators.' : 'The access review could not be loaded.'}</p>
            <p>{error.detail}</p>
            <button type="button" className={`${btn} mt-3`} onClick={() => void load()}>
              <RotateCw aria-hidden className="size-3.5" />
              Retry
            </button>
          </div>
        </div>
      </Card>
    );
  if (!report)
    return (
      <div role="status" aria-busy="true" aria-label="Loading access review" className="space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-48" />
      </div>
    );

  return (
    <div data-testid="access-review" className="space-y-8">
      <Section title="Findings" aside={`${report.findings.length}`}>
        {report.findings.length === 0 ? (
          <p className="text-[13.5px] text-ink-2">Nothing in the policy or the audit log needs attention.</p>
        ) : (
          <ul className="space-y-2" data-testid="access-findings">
            {report.findings.map((f, i) => (
              <li key={i} className="flex gap-2 text-[13.5px] leading-5">
                <AlertCircle aria-hidden className={`mt-0.5 size-4 shrink-0 ${f.severity === 'attention' ? 'text-[var(--s-open-fg)]' : 'text-ink-3'}`} />
                <span>
                  <span className="font-medium">{f.severity === 'attention' ? 'Needs attention. ' : 'Note. '}</span>
                  {f.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Who holds access" aside={`${report.people.length} enrolled`}>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <caption className="sr-only">People enrolled in the access policy</caption>
            <thead>
              <tr className="border-b border-hairline text-[11.5px] tracking-wide text-ink-3 uppercase">
                <th scope="col" className="px-3 py-2">Person</th>
                <th scope="col" className="px-3 py-2">Roles</th>
                <th scope="col" className="px-3 py-2">Status</th>
                <th scope="col" className="px-3 py-2">Enrollment</th>
                <th scope="col" className="px-3 py-2">Designated for</th>
                <th scope="col" className="px-3 py-2">Activity</th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {report.people.map((p) => (
                <tr key={p.subject} data-testid="access-person" className="border-b border-hairline align-top last:border-0">
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{p.login}</p>
                    <p className="font-mono text-[11.5px] break-all text-ink-3">{p.subject}</p>
                  </td>
                  <td className="px-3 py-2.5">{p.roles.length ? p.roles.map((r) => <Tag key={r}>{r}</Tag>) : '—'}</td>
                  <td className="px-3 py-2.5">{p.status}</td>
                  <td className="px-3 py-2.5 text-ink-2">
                    {p.basis}, from {p.enrolledAt}
                    {p.revokedAt ? `, revoked ${p.revokedAt}` : ''}
                    {p.flags.map((f) => (
                      <p key={f} className="mt-1 text-[12px] text-[var(--s-open-fg)]">
                        {f}
                      </p>
                    ))}
                  </td>
                  <td className="px-3 py-2.5 text-ink-2">{p.designatedFor.join(', ') || '—'}</td>
                  <td className="px-3 py-2.5 text-ink-2">
                    {p.approvalsRecorded} decided, {p.deniedAttempts} refused
                  </td>
                  <td className="px-3 py-2.5">
                    <button type="button" className={btn} disabled={busy} onClick={() => void suspend(p.subject, p.status === 'suspended')}>
                      {p.status === 'suspended' ? 'Lift suspension' : 'Suspend'}
                    </button>
                  </td>
                </tr>
              ))}
              {report.people.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-ink-3">
                    Nobody is enrolled.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>
        <p className="mt-2 text-[12.5px] leading-5 text-ink-3">
          Suspending ends a person&apos;s sessions at once and refuses every later request. It does not change the policy: removing the enrollment is still a reviewed change to <span className="font-mono">harness/policy/access-policy.json</span>.
        </p>
      </Section>

      <Section title="Approval domains" aside="how records are classified">
        <ul className="grid gap-2 sm:grid-cols-2" data-testid="access-domains">
          {Object.entries(report.decisionsByDomain).map(([d, v]) => (
            <li key={d} className="rounded-xl border border-hairline px-3.5 py-2.5 text-[13.5px]">
              <span className="font-medium">{d}</span>: {v.total} records
              {d === 'regulatory' || d === 'unclassified' ? <span className="text-ink-3"> (never approvable in the Studio)</span> : v.noDesignatedApprover ? <span className="text-[var(--s-open-fg)]"> · {v.noDesignatedApprover} with no designated approver</span> : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Policy and attestation">
        <p className="text-[13.5px] leading-6 text-ink-2">
          Policy <span className="font-mono">{report.policy.hash.slice(0, 12)}</span>, read from {report.policy.source}. {report.policy.pinned ? (report.policy.pinMismatch ? 'It does NOT match the pinned hash.' : 'It matches the hash pinned by this server.') : 'This server does not pin it.'}
        </p>
        <p className="mt-1 text-[13.5px] text-ink-2" data-testid="last-attestation">
          {report.lastAttestation ? `Last reviewed ${report.lastAttestation.at.slice(0, 10)} by ${report.lastAttestation.by} (policy ${report.lastAttestation.policyHash?.slice(0, 12) ?? 'unknown'}).` : 'Never attested.'}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input aria-label="Review note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Note (optional)" className="min-w-0 flex-1 rounded-lg border border-hairline-strong bg-surface px-3 py-1.5 text-[13.5px]" />
          <button type="button" data-testid="attest" className={btn} disabled={busy || report.policy.pinMismatch} onClick={() => void attest()}>
            <CheckCircle2 aria-hidden className="size-4" />
            Record that I reviewed access
          </button>
        </div>
        <p role="status" data-testid="access-message" className="mt-2 min-h-5 text-[12.5px] text-ink-3">
          {message || 'This records who looked and which policy they saw. It grants nothing and approves nothing.'}
        </p>
      </Section>

      <Section title="Live sessions" aside={`${report.sessions.length}`}>
        {report.sessions.length === 0 ? (
          <p className="text-[13.5px] text-ink-3">No active sessions.</p>
        ) : (
          <ul className="space-y-1 text-[13.5px] text-ink-2">
            {report.sessions.map((s, i) => (
              <li key={i}>
                {s.login} ({s.provider}), last seen {new Date(s.lastSeenAt).toISOString().slice(11, 19)} UTC
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
