// The architecture baseline manifest: a frozen, hashable record of which decisions were approved, on what basis, at which commit, for
// which kinds of work. It is generated only when every gate of the scope is satisfied. It is never approved by being generated: it is
// authorized by a signed approval (harness/approvals/approval-gates.cjs, subject type "baseline") bound to the hash of the manifest,
// so changing one byte afterwards voids the authorization.
import type { NormalizedDecision } from '../intel/schema.ts';
import { canonicalJson, sha256 } from '../workflow/events.ts';
import { loadRegistry } from './facts.ts';
import type { ReadinessInput, Readiness, Reason, DecisionRow } from './readiness.ts';
import { renderMatrix, renderReport, renderSummary } from './render.ts';

export const MANIFEST_SCHEMA = 'greenfuel.architecture-baseline/v1';
export const GENERATOR = { name: 'architecture-studio/baseline', version: 1 };
export const BASELINE_DIR = 'docs/baselines';
export const BASELINE_ID = /^BL-\d{4}$/;

export interface DecisionSnapshot {
  id: string;
  title: string;
  kind: 'adr' | 'register-entry';
  status: string;
  statusRaw: string;
  basis: string;
  caveats: string[];
  domain: string;
  milestone: string | null;
  approvedOption: { key: string; name: string; recommended: boolean } | null;
  conditions: string[];
  decidingEvent: { id: string; eventHash: string; path: string } | null;
  approval: { approval: string; file: string } | null;
  contentHash: string;
  source: { path: string; line: number; blob: string; commit: string };
  requiredBy: string[];
}

export interface BaselineManifest {
  schema: typeof MANIFEST_SCHEMA;
  id: string;
  version: number;
  supersedes: string | null;
  /** Each area, the stage it was baselined at, and the decisions that area needed: what a reopening of one decision affects. */
  scope: { areas: { id: string; stage: string; decisions: string[] }[] };
  source: { commit: string; policyPath: string; policyHash: string };
  generator: { name: string; version: number };
  generatedAt: string;
  /** How the review records were read when this was generated. Not part of what is compared when the manifest is re-made. */
  verification: { reviewSignatures: 'verified' | 'not-verified' };
  gates: { id: string; title: string; source: string }[];
  requiredDecisions: DecisionSnapshot[];
  requiredReviews: { id: string; approval: { approval: string; file: string } | null }[];
  /** The requirements that the required decisions answer, with the decisions that cite each, so a changed requirement names what to review. */
  requirements: { id: string; sha256: string; decisions: string[] }[];
  deferredNonBlocking: { id: string; title: string; milestone: string | null }[];
  caveats: { decision: string; text: string }[];
  metrics: { area: string; id: string; label: string; count: number }[];
  artifacts: { path: string; sha256: string }[];
}

export interface BuildOptions {
  id: string;
  version: number;
  supersedes: string | null;
  areas: string[];
  generatedAt: string;
  codeRoot: string;
}

export interface BuiltBaseline {
  manifest: BaselineManifest;
  /** Every file to write, as repository-relative path and content. The manifest is last. */
  files: { path: string; content: string }[];
}

/** How a requirement is hashed for the manifest and for change detection: the harness's canonical form of the fields that carry meaning. */
export function requirementHasher(codeRoot: string): (r: { title: string; priority: string; acceptance: string; validation: string; evidenceRequired: string }) => string {
  const reg = loadRegistry(codeRoot);
  return (r) => reg.sha256(reg.canonical({ title: r.title, priority: r.priority, acceptance: r.acceptance, validation: r.validation, evidenceRequired: r.evidenceRequired }));
}

export const manifestPath = (id: string) => `${BASELINE_DIR}/${id}/manifest.json`;
export const serialize = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

/** The hash an approval is bound to: the harness's own canonical form of the manifest, so the two sides cannot disagree. */
export function manifestHash(m: unknown, codeRoot: string): string {
  const reg = loadRegistry(codeRoot);
  const copy = JSON.parse(JSON.stringify(m)) as Record<string, unknown>;
  delete copy.authorization;
  return reg.sha256(reg.canonical(copy));
}

function snapshotOf(d: NormalizedDecision, row: DecisionRow, i: ReadinessInput): DecisionSnapshot {
  const rs = i.reviewStates.get(d.id);
  const ev = rs?.decidingEvent ?? null;
  const adrNum = /^ADR-(\d{4})$/.exec(d.id)?.[1];
  const signed = adrNum ? i.harness.valid[`adr:${adrNum}`]?.[0] : undefined;
  return {
    id: d.id,
    title: d.title,
    kind: d.kind,
    status: d.status,
    statusRaw: d.statusRaw,
    basis: row.basis,
    caveats: row.caveats,
    domain: row.domain,
    milestone: d.milestone,
    approvedOption: rs?.approvedOption ?? (d.status === 'Approved' && d.recommendedOption ? { key: d.recommendedOption.key, name: d.recommendedOption.name, recommended: true } : null),
    conditions: rs?.conditions ?? [],
    decidingEvent: ev ? { id: ev.id, eventHash: ev.eventHash, path: `docs/decision-reviews/${ev.decisionId}/${String(ev.seq).padStart(4, '0')}-${ev.action}.json` } : null,
    approval: signed ? { approval: signed.approval, file: signed.file } : null,
    contentHash: i.textHash[d.id] ?? d.contentHash,
    source: { path: d.source.path, line: d.source.line, blob: d.source.blob, commit: d.source.commit },
    requiredBy: row.requiredBy,
  };
}

export function registerSnapshot(i: ReadinessInput, r: Readiness): string {
  const rowIds = new Map<string, DecisionRow>();
  for (const a of r.areas) for (const d of [...a.requiredDecisions, ...a.deferredNonBlocking]) rowIds.set(d.id, d);
  const records = [...i.decisions].sort((a, b) => a.id.localeCompare(b.id)).map((d) => {
    const rs = i.reviewStates.get(d.id);
    return {
      id: d.id,
      title: d.title,
      kind: d.kind,
      status: d.status,
      statusRaw: d.statusRaw,
      approvalBasis: d.approvalBasis,
      priority: d.priority?.value ?? null,
      milestone: d.milestone,
      category: d.category,
      requiredApprover: d.requiredApproverRole?.text ?? null,
      owner: d.decisionOwner,
      domain: i.domains[d.id] ?? 'unclassified',
      dependsOn: d.dependsOn,
      supersedes: d.supersedes,
      supersededBy: d.supersededBy,
      relatedRisks: d.relatedRisks,
      relatedTasks: d.relatedTasks,
      evidence: d.evidence.map((e) => ({ id: e.id, resolved: e.resolved, exitCode: e.exitCode })),
      approvedOption: rs?.approvedOption ?? null,
      conditions: rs?.conditions ?? [],
      decidingEvent: rs?.decidingEvent ? { id: rs.decidingEvent.id, eventHash: rs.decidingEvent.eventHash } : null,
      contentHash: i.textHash[d.id] ?? d.contentHash,
      source: { path: d.source.path, line: d.source.line, commit: d.source.commit, blob: d.source.blob },
    };
  });
  return serialize({ schema: 'greenfuel.decision-register-snapshot/v1', commit: i.commit, count: records.length, records });
}

/**
 * Build the baseline for the named areas, or say why it cannot be built. It refuses unless every blocking measure and every gate of
 * every area is satisfied: there is no flag to build a baseline over an open gate.
 */
export function buildBaseline(i: ReadinessInput, r: Readiness, o: BuildOptions): { ok: true; built: BuiltBaseline } | { ok: false; reasons: Reason[] } {
  const reasons: Reason[] = [];
  if (!BASELINE_ID.test(o.id)) reasons.push({ code: 'id', text: `The baseline id must look like BL-0001 (got "${o.id.slice(0, 20)}").`, refs: [] });
  if (!i.policy.valid) for (const p of i.policy.problems) reasons.push({ code: 'policy', text: `The baseline policy is invalid: ${p}`, refs: [] });
  if (!o.areas.length) reasons.push({ code: 'scope', text: 'Name at least one area.', refs: [] });
  const chosen = o.areas.map((id) => r.areas.find((a) => a.id === id));
  o.areas.forEach((id, n) => {
    const a = chosen[n];
    if (!a) reasons.push({ code: 'scope', text: `Area "${id}" is not in the policy.`, refs: [] });
    else if (!a.ready) for (const b of a.blockers) reasons.push({ ...b, text: `${a.id}: ${b.text}` });
  });
  if (reasons.length) return { ok: false, reasons };
  const areas = chosen as NonNullable<(typeof chosen)[number]>[];

  const byId = new Map(i.decisions.map((d) => [d.id, d]));
  const rows = new Map<string, DecisionRow>();
  for (const a of areas) for (const d of a.requiredDecisions) rows.set(d.id, rows.has(d.id) ? { ...d, requiredBy: [...new Set([...rows.get(d.id)!.requiredBy, ...d.requiredBy])] } : d);
  const requiredDecisions = [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)).filter((d) => byId.has(d.id)).map((d) => snapshotOf(byId.get(d.id)!, d, i));
  const reviewIds = [...new Set(areas.flatMap((a) => a.requiredReviews.map((x) => x.id)))].sort();
  const reqIds = new Set(requiredDecisions.flatMap((d) => byId.get(d.id)!.blockingRequirements.map((x) => x.id)));
  const hashReq = requirementHasher(o.codeRoot);
  const requirements = i.requirements.filter((x) => reqIds.has(x.id)).sort((a, b) => a.id.localeCompare(b.id)).map((x) => ({ id: x.id, sha256: hashReq(x), decisions: requiredDecisions.filter((d) => byId.get(d.id)!.blockingRequirements.some((b) => b.id === x.id)).map((d) => d.id) }));
  const deferred = new Map<string, { id: string; title: string; milestone: string | null }>();
  for (const a of areas) for (const d of a.deferredNonBlocking) deferred.set(d.id, { id: d.id, title: d.title, milestone: d.milestone });

  const dir = `${BASELINE_DIR}/${o.id}`;
  const draft: BaselineManifest = {
    schema: MANIFEST_SCHEMA,
    id: o.id,
    version: o.version,
    supersedes: o.supersedes,
    scope: { areas: areas.map((a) => ({ id: a.id, stage: a.stage, decisions: a.requiredDecisions.map((d) => d.id) })) },
    source: { commit: i.commit, policyPath: 'harness/policy/baseline-policy.json', policyHash: i.policy.hash },
    generator: GENERATOR,
    generatedAt: o.generatedAt,
    verification: { reviewSignatures: i.signatures },
    gates: [...new Map(areas.flatMap((a) => a.gates).map((g) => [g.id, { id: g.id, title: g.title, source: g.source }])).values()],
    requiredDecisions,
    requiredReviews: reviewIds.map((id) => ({ id, approval: i.harness.valid[`review:${id}`]?.[0] ? { approval: i.harness.valid[`review:${id}`]![0]!.approval, file: i.harness.valid[`review:${id}`]![0]!.file } : null })),
    requirements,
    deferredNonBlocking: [...deferred.values()].sort((a, b) => a.id.localeCompare(b.id)),
    caveats: requiredDecisions.flatMap((d) => d.caveats.map((text) => ({ decision: d.id, text }))),
    metrics: areas.flatMap((a) => a.metrics.map((m) => ({ area: a.id, id: m.id, label: m.label, count: m.count }))),
    artifacts: [],
  };

  // Only the area(s) in scope go into the report and matrix, so the artifacts describe exactly what is being authorized.
  const scoped: Readiness = { ...r, areas };
  const parts = [
    { path: `${dir}/decision-register.snapshot.json`, content: registerSnapshot(i, r) },
    { path: `${dir}/READINESS-REPORT.md`, content: renderReport(scoped) },
    { path: `${dir}/DEPENDENCY-MATRIX.md`, content: renderMatrix(scoped, i) },
    { path: `${dir}/SUMMARY.md`, content: renderSummary(draft) },
  ];
  const manifest: BaselineManifest = { ...draft, artifacts: parts.map((p) => ({ path: p.path, sha256: sha256(p.content) })) };
  return { ok: true, built: { manifest, files: [...parts, { path: manifestPath(o.id), content: serialize(manifest) }] } };
}

/** The part of a manifest that must be identical when it is re-made from its source commit. */
export function reproducible(m: BaselineManifest): string {
  const { generatedAt: _g, verification: _v, ...rest } = m;
  return canonicalJson(rest);
}
