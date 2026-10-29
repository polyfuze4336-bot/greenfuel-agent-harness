import type { ChangeSet, FieldChange, NormalizedDecision, RecordChange } from './schema.ts';

// Change detection between two registers. Compares record content (not line numbers or commit ids), reports which
// fields moved, and raises alerts for the changes a governance reviewer must not miss.

const COMPARED: (keyof NormalizedDecision)[] = ['title', 'description', 'businessJustification', 'category', 'tags', 'milestone', 'priority', 'status', 'statusRaw', 'approvalBasis', 'recommendedOption', 'options', 'implications', 'dependsOn', 'dependedOnBy', 'supersedes', 'supersededBy', 'blockingRequirements', 'relatedAdrs', 'relatedRisks', 'relatedTasks', 'relatedReviews', 'requiredApproverRole', 'decisionOwner', 'decisionDate', 'approvalHistory', 'evidence', 'rubric', 'citedBy', 'missing'];

const strip = (v: unknown): string => JSON.stringify(v, (k, x) => (k === 'line' || k === 'commit' || k === 'blob' ? undefined : x)) ?? 'null';
const short = (s: string) => (s.length > 140 ? `${s.slice(0, 139)}…` : s);

function show(v: unknown): string {
  if (v === null || v === undefined) return 'none';
  if (typeof v === 'string') return v || 'empty';
  if (Array.isArray(v)) return `${v.length} item(s)`;
  return short(strip(v));
}

function fieldChanges(a: NormalizedDecision, b: NormalizedDecision): FieldChange[] {
  const out: FieldChange[] = [];
  for (const k of COMPARED) {
    if (strip(a[k]) !== strip(b[k])) out.push({ field: String(k), from: k === 'status' || k === 'statusRaw' || k === 'title' || k === 'approvalBasis' ? String(a[k]) : show(a[k]), to: k === 'status' || k === 'statusRaw' || k === 'title' || k === 'approvalBasis' ? String(b[k]) : show(b[k]) });
  }
  return out;
}

function alertsFor(prev: NormalizedDecision | null, next: NormalizedDecision | null): string[] {
  const a: string[] = [];
  if (prev && !next) {
    if (prev.status === 'Approved') a.push(`${prev.id} was Approved and is no longer in the register`);
    if (prev.status === 'Rejected') a.push(`${prev.id} was Rejected and is no longer in the register`);
  }
  if (prev && next) {
    if (prev.status === 'Approved' && next.status !== 'Approved') a.push(`${next.id} was Approved and is now ${next.status}`);
    if (prev.status === 'Rejected' && next.status !== 'Rejected') a.push(`${next.id} was Rejected and is now ${next.status}`);
    if (prev.status !== 'Approved' && next.status === 'Approved') a.push(`${next.id} became Approved: confirm the approval (basis: ${next.approvalBasis})`);
  }
  if (next && !prev && next.status === 'Approved') a.push(`${next.id} appeared as Approved: confirm the approval (basis: ${next.approvalBasis})`);
  if (next && next.status === 'Approved' && next.approvalHistory.length === 0) a.push(`${next.id} is Approved with no approval event recorded`);
  return a;
}

export function diffRegisters(prev: NormalizedDecision[] | null, next: NormalizedDecision[], fromCommit: string | null, toCommit: string, files: ChangeSet['files'] = []): ChangeSet {
  const records: RecordChange[] = [];
  const before = new Map((prev ?? []).map((r) => [r.id, r]));
  const after = new Map(next.map((r) => [r.id, r]));
  let unchanged = 0;
  for (const [id, n] of after) {
    const p = before.get(id) ?? null;
    if (!p) {
      records.push({ id, kind: 'added', title: n.title, fields: [], alerts: prev ? alertsFor(null, n) : [] });
    } else if (p.contentHash !== n.contentHash) {
      records.push({ id, kind: 'changed', title: n.title, fields: fieldChanges(p, n), alerts: alertsFor(p, n) });
    } else unchanged++;
  }
  for (const [id, p] of before) if (!after.has(id)) records.push({ id, kind: 'removed', title: p.title, fields: [], alerts: alertsFor(p, null) });
  records.sort((x, y) => x.id.localeCompare(y.id, 'en', { numeric: true }));
  const counts = {
    added: records.filter((r) => r.kind === 'added').length,
    removed: records.filter((r) => r.kind === 'removed').length,
    changed: records.filter((r) => r.kind === 'changed').length,
    unchanged,
    alerts: records.reduce((n, r) => n + r.alerts.length, 0),
  };
  return { fromCommit, toCommit, initial: prev === null, records, files, counts };
}
