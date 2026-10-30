// The life of a baseline after it is generated: is it intact, was it authorized by a human, is it still true, has it been superseded,
// has it been reopened. Everything here is recomputed from git on every call. Nothing is cached in a file, so no file can say a
// baseline is approved: only a verifying signed approval on the ref being read can.
import { spawnSync } from 'node:child_process';
import type { GitRepositoryAdapter } from '../repo/git.ts';
import { sha256 } from '../workflow/events.ts';
import type { ApprovalInfo } from './facts.ts';
import { loadReadinessInput, type LoadOptions } from './input.ts';
import { BASELINE_DIR, BASELINE_ID, GENERATOR, MANIFEST_SCHEMA, buildBaseline, manifestHash, manifestPath, reproducible, requirementHasher, type BaselineManifest } from './manifest.ts';
import { areaOfPath, hashText, stageOf, type BaselinePolicy } from './policy.ts';
import { approvalOf, computeReadiness, reviewApproved, type Readiness, type ReadinessInput, type Reason } from './readiness.ts';

export const REOPEN_SCHEMA = 'greenfuel.baseline-reopen/v1';

export interface Impact {
  /** invalidates: the baseline is no longer true for the areas named. review: someone should look; nothing is blocked by it. */
  severity: 'invalidates' | 'review';
  code: string;
  subject: string;
  text: string;
  areas: string[];
  /** Work that requires the changed decision, so a reader sees what to look at. Advisory. */
  affectedItems: string[];
  /** The authorized reopening that covers this change, if there is one. A change with none was not controlled. */
  controlledBy: string | null;
}

export interface Reopening {
  id: string;
  file: string;
  decisions: string[];
  reason: string;
  authorized: boolean;
  problem: string | null;
}

export interface BaselineState {
  id: string;
  version: number;
  supersedes: string | null;
  scope: BaselineManifest['scope'] | null;
  commit: string | null;
  manifestSha256: string | null;
  status: 'proposed' | 'approved' | 'superseded' | 'invalid';
  authorization: ApprovalInfo | null;
  /** Integrity problems. Any of these makes the baseline invalid. */
  problems: string[];
  notes: string[];
  reopenings: Reopening[];
  impacts: Impact[];
  currentness: 'current' | 'drifted' | 'reopened' | 'not-applicable';
}

const git = (root: string, args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
const isAncestor = (root: string, a: string, b: string) => git(root, ['merge-base', '--is-ancestor', a, b]).status === 0;
const blobAt = (root: string, commit: string, p: string): string | null => {
  const r = git(root, ['rev-parse', '--verify', '--quiet', `${commit}:${p}`]);
  return r.status === 0 ? r.stdout.trim() : null;
};

function parseManifest(text: string | undefined): BaselineManifest | string {
  if (text === undefined) return 'the manifest file is missing';
  try {
    const m = JSON.parse(text) as BaselineManifest;
    if (m.schema !== MANIFEST_SCHEMA) return 'the manifest has the wrong schema';
    if (!BASELINE_ID.test(m.id) || !Number.isInteger(m.version) || !Array.isArray(m.requiredDecisions) || !Array.isArray(m.artifacts) || !m.scope?.areas?.length || !/^[0-9a-f]{40,64}$/.test(m.source?.commit ?? '')) return 'the manifest is missing required fields';
    return m;
  } catch {
    return 'the manifest is not valid JSON';
  }
}

function reopenings(adapter: GitRepositoryAdapter, m: BaselineManifest, valid: ReadinessInput['harness']['valid'], sha: string): Reopening[] {
  const out: Reopening[] = [];
  for (const f of adapter.list(`${BASELINE_DIR}/${m.id}/`).filter((p) => /\/reopen-\d{2}\.json$/.test(p))) {
    const n = /reopen-(\d{2})\.json$/.exec(f)![1]!;
    const id = `${m.id}-R${n}`;
    let rec: { schema?: string; baseline?: string; baselineManifestSha256?: string; decisions?: unknown; reason?: unknown } | null = null;
    try {
      rec = JSON.parse(adapter.read(f) ?? '');
    } catch {
      rec = null;
    }
    if (!rec || rec.schema !== REOPEN_SCHEMA || rec.baseline !== m.id || !Array.isArray(rec.decisions) || typeof rec.reason !== 'string' || !rec.reason.trim()) {
      out.push({ id, file: f, decisions: [], reason: '', authorized: false, problem: 'not a well-formed reopening record' });
      continue;
    }
    const decisions = (rec.decisions as unknown[]).filter((x): x is string => typeof x === 'string');
    // A record that no enrolled architecture key has signed reopens nothing. Text cannot reopen the architecture, just as it cannot approve it.
    const signed = !!valid[`baseline-reopen:${id}`];
    const bound = rec.baselineManifestSha256 === sha;
    out.push({ id, file: f, decisions, reason: rec.reason, authorized: signed && bound, problem: !signed ? 'no valid signed approval, so it has no effect' : !bound ? 'it names a different manifest hash than this baseline' : null });
  }
  return out;
}

/** What has changed since the baseline, and which of those changes a human authorized. Pure. */
export function detectImpacts(m: BaselineManifest, cur: ReadinessInput, readiness: Readiness, reopen: Reopening[], hashReq: ReturnType<typeof requirementHasher>): Impact[] {
  const out: Impact[] = [];
  const byId = new Map(cur.decisions.map((d) => [d.id, d]));
  const dependents = (id: string): string[] => {
    const seen = new Set<string>();
    const queue = [id];
    while (queue.length) {
      const x = queue.shift()!;
      for (const e of cur.edges) if (e.type === 'requires' && e.to === x && !seen.has(e.from)) (seen.add(e.from), queue.push(e.from));
    }
    return [...seen].filter((s) => s !== id && !/^BLK-/.test(s)).sort();
  };
  const authorized = reopen.filter((r) => r.authorized);
  const controlled = (id: string) => authorized.find((r) => !r.decisions.length || r.decisions.includes(id))?.id ?? null;
  const areasOf = (id: string) => m.scope.areas.filter((a) => a.decisions.includes(id)).map((a) => a.id);
  const all = m.scope.areas.map((a) => a.id);
  const push = (i: Omit<Impact, 'controlledBy'> & { controlledBy?: string | null }) => out.push({ controlledBy: null, ...i });

  if (m.source.policyHash !== cur.policy.hash) push({ severity: 'invalidates', code: 'policy-changed', subject: 'baseline-policy', text: 'The baseline policy changed after this baseline was made, so what it required may no longer be what is required.', areas: all, affectedItems: [], controlledBy: authorized[0]?.id ?? null });

  for (const snap of m.requiredDecisions) {
    const d = byId.get(snap.id);
    const areas = areasOf(snap.id);
    const base = { subject: snap.id, areas: areas.length ? areas : all, affectedItems: dependents(snap.id), controlledBy: controlled(snap.id) };
    if (!d) {
      push({ ...base, severity: 'invalidates', code: 'decision-removed', text: `${snap.id} was in the baseline and is no longer in the register.` });
      continue;
    }
    const a = approvalOf(d, cur, byId);
    if (!a.approved) push({ ...base, severity: 'invalidates', code: 'decision-not-approved', text: `${snap.id} was ${snap.status} in the baseline and is now ${d.status} (${a.basis}).` });
    const nowHash = cur.textHash[d.id] ?? d.contentHash;
    if (nowHash !== snap.contentHash) push({ ...base, severity: 'invalidates', code: 'decision-text-changed', text: `The text of ${snap.id} changed after it was baselined (${snap.contentHash.slice(0, 8)} to ${nowHash.slice(0, 8)}). An approval covers the text that was approved.` });
    const nowEvent = cur.reviewStates.get(snap.id)?.decidingEvent?.eventHash ?? null;
    if (nowEvent !== (snap.decidingEvent?.eventHash ?? null)) push({ ...base, severity: 'invalidates', code: 'decision-redecided', text: `${snap.id} was decided again after the baseline: a different deciding record is now in force.` });
  }

  const known = new Set(m.requiredDecisions.map((d) => d.id));
  for (const sa of m.scope.areas) {
    const ar = readiness.areas.find((x) => x.id === sa.id);
    if (!ar) {
      push({ severity: 'invalidates', code: 'area-removed', subject: sa.id, text: `Area ${sa.id} is no longer in the policy.`, areas: [sa.id], affectedItems: [] });
      continue;
    }
    for (const d of ar.requiredDecisions) if (!known.has(d.id)) push({ severity: 'invalidates', code: 'new-required-decision', subject: d.id, text: `${d.id} is now required for ${sa.id} (${d.requiredBy.join('; ')}) and the baseline does not cover it.`, areas: [sa.id], affectedItems: dependents(d.id), controlledBy: authorized[0]?.id ?? null });
    const stage = stageOf(cur.policy, cur.policy.areas.find((x) => x.id === sa.id) ?? cur.policy.areas[0]!);
    if (stage && stage.id !== sa.stage) push({ severity: 'invalidates', code: 'stage-changed', subject: sa.id, text: `Area ${sa.id} was baselined at stage ${sa.stage} and is now at stage ${stage.id}.`, areas: [sa.id], affectedItems: [] });
    if (!ar.ready) push({ severity: 'invalidates', code: 'gate-unmet', subject: sa.id, text: `Area ${sa.id} no longer meets its gates: ${ar.blockers[0]?.text ?? 'see the readiness report'}`, areas: [sa.id], affectedItems: [], controlledBy: authorized[0]?.id ?? null });
  }
  for (const rv of m.requiredReviews) if (rv.approval && !reviewApproved(cur, rv.id)) push({ severity: 'invalidates', code: 'review-not-approved', subject: rv.id, text: `Design review ${rv.id} was approved in the baseline and no longer is.`, areas: all, affectedItems: [] });

  const curReq = new Map(cur.requirements.map((r) => [r.id, r]));
  for (const rq of m.requirements) {
    const r = curReq.get(rq.id);
    const block = cur.policy.rules.requirementChange === 'block';
    const why = block ? 'The policy treats a changed requirement as invalidating.' : 'Nothing is blocked by this alone; the decisions that answer it should be reviewed.';
    if (!r) push({ severity: block ? 'invalidates' : 'review', code: 'requirement-removed', subject: rq.id, text: `Requirement ${rq.id} was removed. ${why}`, areas: all, affectedItems: rq.decisions, controlledBy: authorized[0]?.id ?? null });
    else if (hashReq(r) !== rq.sha256) push({ severity: block ? 'invalidates' : 'review', code: 'requirement-changed', subject: rq.id, text: `Requirement ${rq.id} changed after the baseline. ${why}`, areas: all, affectedItems: rq.decisions, controlledBy: authorized[0]?.id ?? null });
  }  return out;
}

export interface StateOptions extends LoadOptions {
  /** Re-make each baseline from its source commit and compare. Slower; the gate and verify do it, the live page does not. */
  reproduce: boolean;
}

/** Every baseline on the ref, with its integrity, authorization, drift and reopenings. */
export function loadBaselineStates(root: string, current: { input: ReadinessInput; adapter: GitRepositoryAdapter }, readiness: Readiness, o: StateOptions): BaselineState[] {
  const { input, adapter } = current;
  const paths = adapter.list(`${BASELINE_DIR}/`).filter((p) => /^docs\/baselines\/[^/]+\/manifest\.json$/.test(p));
  const states: BaselineState[] = [];
  const parsed = new Map<string, BaselineManifest>();

  for (const p of paths) {
    const folder = p.split('/')[2]!;
    const mm = parseManifest(adapter.read(p));
    if (typeof mm === 'string') {
      states.push({ id: folder, version: 0, supersedes: null, scope: null, commit: null, manifestSha256: null, status: 'invalid', authorization: null, problems: [mm], notes: [], reopenings: [], impacts: [], currentness: 'not-applicable' });
      continue;
    }
    const problems: string[] = [];
    const notes: string[] = [];
    if (mm.id !== folder) problems.push(`The manifest says ${mm.id} but sits in ${folder}.`);
    parsed.set(mm.id, mm);

    for (const a of mm.artifacts) {
      const text = adapter.read(a.path);
      if (text === undefined) problems.push(`${a.path} is missing.`);
      else if (sha256(text.replace(/\r\n/g, '\n')) !== a.sha256) problems.push(`${a.path} was changed after the baseline was made.`);
    }
    const c = mm.source.commit;
    if (git(root, ['cat-file', '-e', `${c}^{commit}`]).status !== 0) problems.push(`The source commit ${c.slice(0, 12)} does not exist in this repository.`);
    else {
      if (!isAncestor(root, c, adapter.commit)) problems.push(`The source commit ${c.slice(0, 12)} is not in the history of ${adapter.ref}: history was rewritten, or the baseline is from another branch.`);
      for (const d of mm.requiredDecisions) {
        const blob = blobAt(root, c, d.source.path);
        if (blob !== d.source.blob) problems.push(`${d.id}: the manifest records ${d.source.path} as blob ${d.source.blob.slice(0, 8)} at ${c.slice(0, 8)}, but git has ${blob ? blob.slice(0, 8) : 'no such file'}.`);
        if (d.decidingEvent && blobAt(root, c, d.decidingEvent.path) === null) problems.push(`${d.id}: the deciding record ${d.decidingEvent.path} is not in the source commit.`);
      }
      const policyAtC = git(root, ['show', `${c}:${mm.source.policyPath}`]);
      if (policyAtC.status !== 0 || hashText(policyAtC.stdout) !== mm.source.policyHash) problems.push('The policy hash recorded in the manifest is not the policy at its source commit.');
    }

    const sha = manifestHash(mm, o.codeRoot);
    const authorization = input.harness.valid[`baseline:${mm.id}`]?.[0] ?? null;
    if (!authorization) {
      const bad = input.harness.invalid.find((x) => x.file.includes(mm.id));
      if (bad) notes.push(`An approval record exists but does not verify: ${bad.reason}.`);
    }
    if (mm.verification.reviewSignatures === 'not-verified') notes.push('Review-record signatures were not checked when this baseline was generated.');

    if (o.reproduce && !problems.length) {
      if (mm.generator.version !== GENERATOR.version) notes.push(`Generated by tool version ${mm.generator.version}; this is ${GENERATOR.version}. It was not re-made.`);
      else {
        try {
          const at = loadReadinessInput(root, c, { ...o, reviewsRef: undefined });
          const r = computeReadiness(at.input);
          const rebuilt = buildBaseline(at.input, r, { id: mm.id, version: mm.version, supersedes: mm.supersedes, areas: mm.scope.areas.map((a) => a.id), generatedAt: mm.generatedAt, codeRoot: o.codeRoot });
          if (!rebuilt.ok) problems.push(`At its own source commit the scope was not ready (${rebuilt.reasons[0]?.text.slice(0, 160)}), so the manifest cannot be true.`);
          else if (reproducible(rebuilt.built.manifest) !== reproducible(mm)) {
            const a = JSON.parse(reproducible(rebuilt.built.manifest)) as Record<string, unknown>;
            const b = JSON.parse(reproducible(mm)) as Record<string, unknown>;
            problems.push(`The manifest does not reproduce from its source commit (differs in: ${Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).join(', ') || 'unknown'}).`);
          }
        } catch (e) {
          problems.push(`Could not re-make the manifest from its source commit: ${e instanceof Error ? e.message.slice(0, 160) : 'unknown error'}.`);
        }
      }
    }

    const reopen = reopenings(adapter, mm, input.harness.valid, sha);
    states.push({ id: mm.id, version: mm.version, supersedes: mm.supersedes, scope: mm.scope, commit: c, manifestSha256: sha, status: problems.length ? 'invalid' : authorization ? 'approved' : 'proposed', authorization, problems, notes, reopenings: reopen, impacts: [], currentness: 'not-applicable' });
  }

  // A baseline is superseded once a newer one that names it is itself authorized and intact.
  for (const s of states) {
    if (s.status !== 'approved') continue;
    if (states.some((x) => x.supersedes === s.id && x.status === 'approved')) s.status = 'superseded';
  }
  // Drift and reopening are judged only for approved baselines: a proposal or an invalid one covers nothing, so it can drift from nothing.
  for (const s of states) {
    if (s.status !== 'approved') continue;
    const m = parsed.get(s.id)!;
    s.impacts = detectImpacts(m, input, readiness, s.reopenings, requirementHasher(o.codeRoot));
    const anyAuthorized = s.reopenings.some((r) => r.authorized);
    const invalidating = s.impacts.filter((x) => x.severity === 'invalidates');
    s.currentness = anyAuthorized ? 'reopened' : invalidating.length ? 'drifted' : 'current';
  }
  return states.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- gates

export interface AreaGate {
  area: string;
  title: string;
  stage: string;
  kind: 'implementation' | 'deployment';
  state: 'open' | 'blocked';
  /** The live architecture meets the gates and measures for this area. A necessary condition, not a sufficient one. */
  ready: boolean;
  reasons: Reason[];
  baseline: { id: string; version: number; status: BaselineState['status']; currentness: BaselineState['currentness'] } | null;
}

function baselineReasons(areaId: string, stageId: string, states: BaselineState[]): { reasons: Reason[]; covering: BaselineState | null } {
  const covers = (s: BaselineState) => s.scope?.areas.some((a) => a.id === areaId && a.stage === stageId);
  const approved = states.filter((s) => s.status === 'approved' && covers(s)).sort((a, b) => b.version - a.version);
  const sameAreaStale = states.filter((s) => s.status === 'approved' && s.scope?.areas.some((a) => a.id === areaId && a.stage !== stageId));
  const cur = approved[0] ?? null;
  const out: Reason[] = [];
  if (cur) {
    const mine = cur.impacts.filter((x) => x.severity === 'invalidates' && (x.areas.includes(areaId) || !x.areas.length));
    const reopen = cur.reopenings.filter((r) => r.authorized && (!r.decisions.length || cur.scope!.areas.find((a) => a.id === areaId)!.decisions.some((d) => r.decisions.includes(d))));
    if (reopen.length) out.push({ code: 'baseline-reopened', text: `Baseline ${cur.id} v${cur.version} was reopened under ${reopen.map((r) => r.id).join(', ')} (${reopen[0]!.reason.slice(0, 120)}). No work in this area is authorized until a new baseline version is authorized.`, refs: [cur.id, ...reopen.map((r) => r.id)] });
    else if (mine.length) {
      const uncontrolled = mine.filter((x) => !x.controlledBy);
      out.push({ code: uncontrolled.length ? 'baseline-uncontrolled-change' : 'baseline-reopened', text: `Baseline ${cur.id} v${cur.version} no longer matches the repository${uncontrolled.length ? ', and the change was not made under an authorized reopening' : ''}: ${mine.slice(0, 4).map((x) => x.text).join(' ')}${mine.length > 4 ? ` (and ${mine.length - 4} more)` : ''}`, refs: [cur.id, ...mine.map((x) => x.subject)] });
    }
    return { reasons: out, covering: cur };
  }
  const proposed = states.filter((s) => s.status === 'proposed' && covers(s));
  const invalid = states.filter((s) => s.status === 'invalid' && (s.scope === null || covers(s)));
  const superseded = states.filter((s) => s.status === 'superseded' && covers(s));
  if (proposed.length) out.push({ code: 'baseline', text: `Baseline ${proposed.map((s) => s.id).join(', ')} is generated but not authorized. A human must sign it: node harness/scripts/approval.mjs decision --type baseline --id ${proposed[0]!.id} --reason "..." (then sign it with an architecture-class key).`, refs: proposed.map((s) => s.id) });
  for (const s of invalid) out.push({ code: 'baseline', text: `Baseline ${s.id} is invalid and covers nothing: ${s.problems[0] ?? 'unknown problem'}${s.problems.length > 1 ? ` (and ${s.problems.length - 1} more)` : ''}`, refs: [s.id] });
  for (const s of sameAreaStale) out.push({ code: 'baseline', text: `Baseline ${s.id} covers this area at stage ${s.scope!.areas.find((a) => a.id === areaId)!.stage}, but the area is now at stage ${stageId}. A new baseline is needed.`, refs: [s.id] });
  if (superseded.length && !out.length) out.push({ code: 'baseline', text: `Baseline ${superseded.map((s) => s.id).join(', ')} was superseded and the newer one does not cover this area.`, refs: superseded.map((s) => s.id) });
  if (!out.length) out.push({ code: 'baseline', text: `No architecture baseline covers area "${areaId}" at stage ${stageId}. When the architecture is ready, generate one (baseline generate) and have a human authorize it.`, refs: [] });
  return { reasons: out, covering: null };
}

export function evaluateAreas(readiness: Readiness, states: BaselineState[], policy: BaselinePolicy): AreaGate[] {
  return readiness.areas.map((a) => {
    const reasons: Reason[] = [];
    if (!policy.valid) for (const p of policy.problems) reasons.push({ code: 'policy', text: `The baseline policy is invalid, so nothing is authorized: ${p}`, refs: ['harness/policy/baseline-policy.json'] });
    reasons.push(...a.blockers);
    const b = baselineReasons(a.id, a.stage, states);
    reasons.push(...b.reasons);
    const cov = b.covering;
    return { area: a.id, title: a.title, stage: a.stage, kind: a.kind, state: reasons.length === 0 && policy.valid ? 'open' : 'blocked', ready: a.ready, reasons, baseline: cov ? { id: cov.id, version: cov.version, status: cov.status, currentness: cov.currentness } : null };
  });
}

export interface ChangeResult {
  blocked: boolean;
  touched: string[];
  blockedAreas: AreaGate[];
  /** Uncontrolled changes to an approved architecture, reported whether or not a gated path changed. */
  violations: Reason[];
}

export function evaluateChange(files: string[], policy: BaselinePolicy, gates: AreaGate[], states: BaselineState[], o: { changeControl: boolean }): ChangeResult {
  const touched = [...new Set(files.flatMap((f) => areaOfPath(policy, f).map((a) => a.id)))].sort();
  const blockedAreas = gates.filter((g) => touched.includes(g.area) && g.state === 'blocked');
  const violations: Reason[] = [];
  if (o.changeControl) {
    for (const s of states) {
      if (s.status !== 'approved') continue;
      for (const im of s.impacts) if (im.severity === 'invalidates' && !im.controlledBy) violations.push({ code: 'baseline-uncontrolled-change', text: `Baseline ${s.id}: ${im.text}`, refs: [s.id, im.subject] });
    }
  }
  return { blocked: (!policy.valid && files.length > 0) || blockedAreas.length > 0 || violations.length > 0, touched, blockedAreas, violations };
}

export { manifestPath };
