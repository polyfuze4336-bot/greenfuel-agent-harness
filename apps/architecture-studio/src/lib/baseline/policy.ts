// The baseline policy: which gates exist, which stage of the programme is active, and which kinds of work each stage and area
// covers. Data in harness/policy/baseline-policy.json. A missing, unreadable or invalid policy authorizes nothing: every area stays
// blocked and the reason says why.
import crypto from 'node:crypto';

export const BASELINE_POLICY_PATH = 'harness/policy/baseline-policy.json';

/** What can block an area. The first group blocks in every stage and cannot be removed by a policy. */
export const ALWAYS_BLOCKING = ['gates', 'baseline', 'unresolved-required-decisions', 'rejected-required', 'deferred-required', 'outstanding-security-approvals'] as const;
export const OPTIONAL_BLOCKING = ['critical-assumptions', 'missing-evidence', 'requirements-without-decisions', 'decisions-without-validation', 'blocking-tasks'] as const;
export type Blocking = (typeof ALWAYS_BLOCKING)[number] | (typeof OPTIONAL_BLOCKING)[number];

export type HarnessCheck = 'phase' | 'approvers' | 'branch-protection';

export type Gate =
  | { id: string; title: string; source: string; type: 'harness'; check: HarnessCheck; class: string | null }
  | { id: string; title: string; source: string; type: 'decisions'; decisions: string[]; designReviews: string[] };

export interface Stage {
  id: string;
  title: string;
  gates: string[];
  includeMilestones: string[];
  blockOn: Blocking[];
}

export interface Area {
  id: string;
  title: string;
  kind: 'implementation' | 'deployment';
  /** A stage id, or "active" for the policy's activeStage. */
  stage: string;
  paths: RegExp[];
  pathSources: string[];
}

export interface BaselinePolicy {
  version: number;
  /** sha256 of the policy text. A baseline records it: a changed policy makes an older baseline stale. */
  hash: string;
  valid: boolean;
  problems: string[];
  activeStage: string;
  rules: {
    reviewRecordsCountAsApproval: boolean;
    grandfatheredAdrsCountAsApproval: boolean;
    conditionalApprovals: 'flag' | 'block';
    requirementChange: 'review' | 'block';
    supersededBySuccessor: boolean;
  };
  gates: Gate[];
  stages: Stage[];
  areas: Area[];
  criticalAssumptions: { include: string[]; exclude: string[] };
}

export const hashText = (t: string) => crypto.createHash('sha256').update(t.replace(/\r\n/g, '\n')).digest('hex');

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : []);
const ID = /^[a-z][a-z0-9-]{1,40}$/;
const DECISION_ID = /^(?:ADR-\d{4}|D-\d{3})$/;
const REVIEW_ID = /^RV-\d{4}$/;

export function emptyBaselinePolicy(problem: string, hash = ''): BaselinePolicy {
  return {
    version: 1,
    hash,
    valid: false,
    problems: [problem],
    activeStage: '',
    rules: { reviewRecordsCountAsApproval: false, grandfatheredAdrsCountAsApproval: false, conditionalApprovals: 'block', requirementChange: 'block', supersededBySuccessor: false },
    gates: [],
    stages: [],
    areas: [],
    criticalAssumptions: { include: [], exclude: [] },
  };
}

export function parseBaselinePolicy(text: string | undefined): BaselinePolicy {
  if (text === undefined) return emptyBaselinePolicy(`${BASELINE_POLICY_PATH} does not exist, so no work can be authorized.`);
  const hash = hashText(text);
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return emptyBaselinePolicy(`${BASELINE_POLICY_PATH} is not valid JSON, so no work can be authorized.`, hash);
  }
  if (o.version !== 1) return emptyBaselinePolicy(`${BASELINE_POLICY_PATH} has version ${String(o.version)}; this tool reads version 1.`, hash);
  const problems: string[] = [];
  const bad = (m: string) => problems.push(m);

  const gates: Gate[] = [];
  for (const raw of Array.isArray(o.gates) ? o.gates : []) {
    const g = obj(raw);
    const id = typeof g.id === 'string' ? g.id : '';
    const base = { id, title: typeof g.title === 'string' ? g.title : id, source: typeof g.source === 'string' ? g.source : '' };
    if (!ID.test(id) || gates.some((x) => x.id === id)) {
      bad(`A gate has a missing, malformed or repeated id (${id || 'none'}).`);
      continue;
    }
    if (!base.source) bad(`Gate ${id} states no source. A gate must say where its grouping comes from.`);
    if (g.type === 'harness') {
      if (g.check !== 'phase' && g.check !== 'approvers' && g.check !== 'branch-protection') {
        bad(`Gate ${id} names an unknown harness check.`);
        continue;
      }
      gates.push({ ...base, type: 'harness', check: g.check, class: typeof g.class === 'string' ? g.class : null });
    } else if (g.type === 'decisions') {
      const decisions = strs(g.decisions);
      const designReviews = strs(g.designReviews);
      if (decisions.some((d) => !DECISION_ID.test(d)) || designReviews.some((r) => !REVIEW_ID.test(r))) {
        bad(`Gate ${id} names an id that is not a decision (D-nnn, ADR-nnnn) or a design review (RV-nnnn).`);
        continue;
      }
      if (!decisions.length && !designReviews.length) {
        bad(`Gate ${id} names no decision and no design review.`);
        continue;
      }
      gates.push({ ...base, type: 'decisions', decisions, designReviews });
    } else bad(`Gate ${id} has an unknown type.`);
  }

  const stages: Stage[] = [];
  for (const raw of Array.isArray(o.stages) ? o.stages : []) {
    const s = obj(raw);
    const id = typeof s.id === 'string' ? s.id : '';
    if (!ID.test(id) || stages.some((x) => x.id === id)) {
      bad(`A stage has a missing, malformed or repeated id (${id || 'none'}).`);
      continue;
    }
    const used = strs(s.gates);
    for (const g of used) if (!gates.some((x) => x.id === g)) bad(`Stage ${id} names gate ${g}, which does not exist.`);
    const extra = strs(s.blockOn).filter((b): b is Blocking => (OPTIONAL_BLOCKING as readonly string[]).includes(b));
    for (const b of strs(s.blockOn)) if (!(OPTIONAL_BLOCKING as readonly string[]).includes(b) && !(ALWAYS_BLOCKING as readonly string[]).includes(b)) bad(`Stage ${id} lists ${b}, which is not something that can block.`);
    // The always-blocking set is forced in: a policy cannot switch off the checks the capability exists for.
    stages.push({ id, title: typeof s.title === 'string' ? s.title : id, gates: used.filter((g) => gates.some((x) => x.id === g)), includeMilestones: strs(s.includeMilestones), blockOn: [...ALWAYS_BLOCKING, ...extra] });
  }
  const activeStage = typeof o.activeStage === 'string' ? o.activeStage : '';
  if (!stages.some((s) => s.id === activeStage)) bad(`activeStage "${activeStage}" is not a stage.`);

  const areas: Area[] = [];
  for (const raw of Array.isArray(o.areas) ? o.areas : []) {
    const a = obj(raw);
    const id = typeof a.id === 'string' ? a.id : '';
    if (!ID.test(id) || areas.some((x) => x.id === id)) {
      bad(`An area has a missing, malformed or repeated id (${id || 'none'}).`);
      continue;
    }
    const stage = typeof a.stage === 'string' ? a.stage : '';
    if (stage !== 'active' && !stages.some((s) => s.id === stage)) bad(`Area ${id} names stage "${stage}", which does not exist.`);
    const paths: RegExp[] = [];
    const sources = strs(a.paths);
    for (const p of sources) {
      try {
        if (p.length > 120) throw new Error('too long');
        paths.push(new RegExp(p));
      } catch {
        bad(`Area ${id} has a path pattern that is not a valid expression: ${p.slice(0, 40)}.`);
      }
    }
    if (!paths.length) bad(`Area ${id} covers no path.`);
    areas.push({ id, title: typeof a.title === 'string' ? a.title : id, kind: a.kind === 'deployment' ? 'deployment' : 'implementation', stage, paths, pathSources: sources });
  }
  if (!areas.length) bad('The policy defines no area, so no path is covered.');

  const r = obj(o.rules);
  const ca = obj(o.criticalAssumptions);
  return {
    version: 1,
    hash,
    valid: problems.length === 0,
    problems,
    activeStage,
    rules: {
      reviewRecordsCountAsApproval: r.reviewRecordsCountAsApproval === true,
      grandfatheredAdrsCountAsApproval: r.grandfatheredAdrsCountAsApproval === true,
      conditionalApprovals: r.conditionalApprovals === 'block' ? 'block' : 'flag',
      requirementChange: r.requirementChange === 'block' ? 'block' : 'review',
      supersededBySuccessor: r.supersededBySuccessor === true,
    },
    gates,
    stages,
    areas,
    criticalAssumptions: { include: strs(ca.include), exclude: strs(ca.exclude) },
  };
}

/** The stage that governs an area right now. */
export function stageOf(p: BaselinePolicy, a: Area): Stage | undefined {
  return p.stages.find((s) => s.id === (a.stage === 'active' ? p.activeStage : a.stage));
}

export const areaOfPath = (p: BaselinePolicy, file: string): Area[] => p.areas.filter((a) => a.paths.some((re) => re.test(file)));
