// The architecture readiness validator. Pure: it takes facts read from a repository and returns, for each kind of work, whether the
// architecture is ready to authorize it and, when it is not, exactly why. It reads no file, runs no command and asks no model.
//
// What it will not do: treat a rejected decision as resolved, treat text as an approval, require a decision that no gate, milestone or
// dependency makes necessary, or call anything ready on the strength of a count. Every number it returns names its members.
import type { Assumption, DesignReview, Requirement } from '../repo/types.ts';
import type { NormalizedDecision } from '../intel/schema.ts';
import type { Edge, WorkItem } from '../queue/types.ts';
import { isResolved } from '../queue/graph.ts';
import type { ReviewState } from '../workflow/events.ts';
import type { HarnessFacts } from './facts.ts';
import { stageOf, type Area, type BaselinePolicy, type Blocking, type Gate, type Stage } from './policy.ts';

export interface ReadinessInput {
  commit: string;
  ref: string;
  policy: BaselinePolicy;
  decisions: NormalizedDecision[];
  reviewStates: Map<string, ReviewState>;
  requirements: Requirement[];
  assumptions: Assumption[];
  /** Assumption ids each decision cites (from the register's own references). */
  assumptionRefs: Record<string, string[]>;
  items: WorkItem[];
  edges: Edge[];
  designReviews: Pick<DesignReview, 'id' | 'declared' | 'adrs' | 'src'>[];
  harness: HarnessFacts;
  /** A hash of what each decision says, apart from where it is cited and how it is connected, so a later citation does not look like an edit. */
  textHash: Record<string, string>;
  /** The approval domain each decision falls into under the access policy (architecture, security, regulatory, ...). */
  domains: Record<string, string>;
  branchProtectionInForce: boolean;
  /** How the review records and approvals were read: with signatures checked, or the chain only. */
  signatures: 'verified' | 'not-verified';
}

export interface Reason {
  code: string;
  text: string;
  refs: string[];
}

export type DecisionState = 'approved' | 'pending' | 'rejected' | 'deferred' | 'superseded' | 'missing';

export interface DecisionRow {
  id: string;
  title: string;
  kind: 'adr' | 'register-entry' | 'missing';
  status: string;
  state: DecisionState;
  approved: boolean;
  basis: string;
  caveats: string[];
  /** Why it counts: which gates, milestones or dependencies make it required. */
  requiredBy: string[];
  domain: string;
  milestone: string | null;
  needsSecurityApproval: boolean;
  evidence: 'none' | 'unresolved' | 'failing' | 'present';
  validated: boolean;
  source: { path: string; line: number } | null;
}

export interface GateResult {
  id: string;
  title: string;
  source: string;
  satisfied: boolean;
  reasons: Reason[];
  decisions: string[];
  designReviews: string[];
}

export interface Metric {
  id: string;
  label: string;
  count: number;
  members: string[];
  rule: string;
  /** Whether a non-zero count blocks this area. */
  blocks: boolean;
}

export interface AreaReadiness {
  id: string;
  title: string;
  kind: Area['kind'];
  stage: string;
  stageTitle: string;
  paths: string[];
  gates: GateResult[];
  requiredDecisions: DecisionRow[];
  requiredReviews: { id: string; satisfied: boolean }[];
  metrics: Metric[];
  /** Everything that stands in the way, in the order to read it. Empty when the architecture is ready for this area. */
  blockers: Reason[];
  ready: boolean;
  deferredNonBlocking: DecisionRow[];
  /** Work items found by following "requires" links from the gates; the tasks the area cannot start without. */
  closureItems: string[];
}

export interface Readiness {
  commit: string;
  policyHash: string;
  policyProblems: string[];
  signatures: ReadinessInput['signatures'];
  areas: AreaReadiness[];
  /** Counts that do not depend on the area. */
  global: { decisions: number; approved: number; pending: number; rejected: number; deferred: number; superseded: number; requirements: number; mustRequirements: number };
}

const num = (id: string) => /^ADR-(\d{4})$/.exec(id)?.[1] ?? null;
const isDecisionId = (id: string) => /^(?:ADR-\d{4}|D-\d{3})$/.test(id);

/** Whether a decision counts as approved under the policy, and on what basis. Text alone never does. */
export function approvalOf(d: NormalizedDecision, i: Pick<ReadinessInput, 'policy' | 'harness' | 'reviewStates'>, byId: Map<string, NormalizedDecision>): { approved: boolean; basis: string; caveats: string[]; state: DecisionState } {
  const caveats: string[] = [];
  const rules = i.policy.rules;
  if (d.status === 'Superseded') {
    const succ = d.supersededBy.map((id) => byId.get(id)).filter((x): x is NormalizedDecision => !!x);
    const ok = rules.supersededBySuccessor && succ.some((s) => s.status === 'Approved' && s.id !== d.id);
    if (ok) return { approved: true, basis: `superseded by ${succ.find((s) => s.status === 'Approved')!.id}`, caveats, state: 'superseded' };
    return { approved: false, basis: 'superseded, with no approved successor', caveats, state: 'superseded' };
  }
  if (d.status === 'Rejected') return { approved: false, basis: 'rejected: redesign needed, not resolved', caveats, state: 'rejected' };
  if (d.status === 'Deferred') return { approved: false, basis: 'deferred', caveats, state: 'deferred' };
  if (d.status !== 'Approved') return { approved: false, basis: d.statusRule || 'no decision has been recorded', caveats, state: 'pending' };

  const adrNum = d.kind === 'adr' ? num(d.id) : null;
  let approved = false;
  let basis = '';
  switch (d.approvalBasis) {
    case 'signed':
      // The register says a signed record exists. The harness is asked, so a record that does not verify is not accepted.
      approved = !!adrNum && !!i.harness.valid[`adr:${adrNum}`];
      basis = approved ? 'signed approval (verified)' : 'a signed approval is recorded but does not verify';
      break;
    case 'review-record':
      approved = rules.reviewRecordsCountAsApproval;
      basis = approved ? 'review record on the canonical branch' : 'a review record only; the policy does not count it';
      if (approved) caveats.push('Approved by a Studio review record, which is not a harness-signed approval (ADR 0008). The baseline authorization is the signed act.');
      break;
    case 'owner-instruction-unsigned':
      approved = rules.grandfatheredAdrsCountAsApproval && !!adrNum && i.harness.grandfathered.includes(adrNum);
      basis = approved ? 'accepted by owner instruction in chat before signing existed (unsigned)' : 'accepted by instruction, unsigned, and not a grandfathered ADR';
      if (approved) caveats.push('Accepted by owner instruction in chat; no signed approval exists.');
      break;
    default:
      basis = 'the status says Approved but no approval record supports it';
  }
  const rs = i.reviewStates.get(d.id);
  if (approved && rs?.phase === 'approved-with-conditions') {
    if (rules.conditionalApprovals === 'block') {
      approved = false;
      basis = 'approved with conditions, and the policy blocks on conditions';
    }
    caveats.push(`Approved with conditions: ${rs.conditions.join('; ')}`);
  }
  return { approved, basis, caveats, state: approved ? 'approved' : 'pending' };
}

/** The id of a design review's approval record, if one verifies. */
export const reviewApproved = (i: Pick<ReadinessInput, 'harness' | 'designReviews'>, id: string) => !!i.designReviews.find((r) => r.id === id && /^approved\b/i.test(r.declared)) && !!i.harness.valid[`review:${id}`];

function evidenceOf(d: NormalizedDecision): DecisionRow['evidence'] {
  if (!d.evidence.length) return 'none';
  if (d.evidence.some((e) => !e.resolved)) return 'unresolved';
  const runs = d.evidence.filter((e) => e.kind === 'test-run');
  if (runs.length && runs.every((e) => e.exitCode !== 0)) return 'failing';
  return 'present';
}

const hasValidation = (d: NormalizedDecision, approvedReviews: Set<string>) => d.evidence.some((e) => e.resolved && e.kind === 'test-run' && e.exitCode === 0) || d.relatedReviews.some((r) => approvedReviews.has(r));

function evalGate(g: Gate, i: ReadinessInput, rows: Map<string, DecisionRow>): GateResult {
  const reasons: Reason[] = [];
  const base = { id: g.id, title: g.title, source: g.source };
  if (g.type === 'harness') {
    const h = i.harness;
    if (g.check === 'phase') {
      if (h.phase === 0) reasons.push({ code: 'phase-0', text: 'The phase is 0. Implementation is not unlocked until a human raises it with signed architecture and deployment approvals.', refs: ['harness/policy/command-policy.json'] });
      else if (!h.phaseApproved) reasons.push({ code: 'phase-unsigned', text: `The phase is ${h.phase} but no valid signed phase approval (architecture and deployment keys) exists for phase-${h.phase}.`, refs: ['docs/approvals/'] });
    } else if (g.check === 'approvers') {
      const need = g.class ?? 'architecture';
      if (h.architectureKeys < 1 && need === 'architecture') reasons.push({ code: 'no-approver', text: 'No approver with an architecture-class key is enrolled, so no baseline can be authorized and no signed approval of that class can exist.', refs: ['harness/policy/approvers.json'] });
    } else if (g.check === 'branch-protection' && !i.branchProtectionInForce) {
      reasons.push({ code: 'no-branch-protection', text: 'Branch protection is not in force on main (TODO T14), so a CI gate can be bypassed by anyone who can push.', refs: ['harness/policy/github-protection.json', 'docs/state/TODO.md'] });
    }
    return { ...base, satisfied: reasons.length === 0, reasons, decisions: [], designReviews: [] };
  }
  for (const id of g.decisions) {
    const r = rows.get(id);
    if (!r || r.state === 'missing') reasons.push({ code: 'missing', text: `${id} is named by this gate but is not in the decision register.`, refs: [id] });
    else if (!r.approved) reasons.push({ code: r.state, text: `${id} is ${r.status}${r.state === 'rejected' ? ' (rejected: the design must be reworked; a rejection resolves nothing)' : r.state === 'deferred' ? ' (deferred: the gate stays closed until it is decided)' : ''}. ${r.basis}.`, refs: [id] });
  }
  for (const rv of g.designReviews) {
    const review = i.designReviews.find((x) => x.id === rv);
    const approved = !!review && /^approved\b/i.test(review.declared) && !!i.harness.valid[`review:${rv}`];
    if (!approved) reasons.push({ code: 'review', text: `Design review ${rv} is ${review ? review.declared : 'not found'}${review && /^approved\b/i.test(review.declared) ? ', but has no valid signed approval' : ''}. It must be Approved with a signed architecture approval.`, refs: [rv] });
  }
  return { ...base, satisfied: reasons.length === 0, reasons, decisions: g.decisions, designReviews: g.designReviews };
}

/** Follow "requires" links from the subjects. Returns every id reached, so dependencies of a required decision are required too. */
function closure(start: string[], edges: Edge[]): string[] {
  const out = new Map<string, string[]>();
  for (const e of edges) if (e.type === 'requires') out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const seen = new Set(start);
  const queue = [...start];
  while (queue.length) {
    const x = queue.shift()!;
    for (const y of out.get(x) ?? []) if (!seen.has(y)) (seen.add(y), queue.push(y));
  }
  return [...seen];
}

export function computeReadiness(i: ReadinessInput): Readiness {
  const byId = new Map(i.decisions.map((d) => [d.id, d]));
  const itemById = new Map(i.items.map((x) => [x.id, x]));
  const approvedReviews = new Set(i.designReviews.filter((r) => /^approved\b/i.test(r.declared) && i.harness.valid[`review:${r.id}`]).map((r) => r.id));

  const rows = new Map<string, DecisionRow>();
  for (const d of i.decisions) {
    const a = approvalOf(d, i, byId);
    const text = d.requiredApproverRole?.text ?? '';
    const domain = i.domains[d.id] ?? 'unclassified';
    rows.set(d.id, {
      id: d.id,
      title: d.title,
      kind: d.kind,
      status: d.status,
      state: a.state,
      approved: a.approved,
      basis: a.basis,
      caveats: a.caveats,
      requiredBy: [],
      domain,
      milestone: d.milestone,
      needsSecurityApproval: domain === 'security' || /security/i.test(text),
      evidence: evidenceOf(d),
      validated: a.approved && hasValidation(d, approvedReviews),
      source: { path: d.source.path, line: d.source.line },
    });
  }
  const rowOf = (id: string): DecisionRow => rows.get(id) ?? { id, title: '(not in the register)', kind: 'missing', status: 'missing', state: 'missing', approved: false, basis: 'not in the decision register', caveats: [], requiredBy: [], domain: 'unclassified', milestone: null, needsSecurityApproval: false, evidence: 'none', validated: false, source: null };

  // Requirements that no decision answers: no decision in the traceability and none that lists it as a blocked requirement.
  const answered = new Set<string>();
  for (const d of i.decisions) for (const r of d.blockingRequirements) answered.add(r.id);
  const uncovered = i.requirements.filter((r) => r.priority.toLowerCase().startsWith('must') && r.decisions.length === 0 && !answered.has(r.id)).map((r) => r.id);

  const critical = (id: string, requiredIds: Set<string>): boolean => {
    if (i.policy.criticalAssumptions.exclude.includes(id)) return false;
    if (i.policy.criticalAssumptions.include.includes(id)) return true;
    for (const dec of requiredIds) if ((i.assumptionRefs[dec] ?? []).includes(id)) return true;
    return false;
  };

  const areas: AreaReadiness[] = i.policy.areas.map((area) => {
    const stage = stageOf(i.policy, area) as Stage;
    if (!stage) {
      return { id: area.id, title: area.title, kind: area.kind, stage: area.stage, stageTitle: '', paths: area.pathSources, gates: [], requiredDecisions: [], requiredReviews: [], metrics: [], blockers: [{ code: 'policy', text: `Area ${area.id} names a stage that does not exist, so it cannot be authorized.`, refs: [] }], ready: false, deferredNonBlocking: [], closureItems: [] };
    }
    const gates = stage.gates.map((id) => i.policy.gates.find((g) => g.id === id)).filter((g): g is Gate => !!g);
    const gateResults = gates.map((g) => evalGate(g, i, rows));

    // Required decisions: named by a gate of this stage, needed by a listed milestone, or required by (a link from) something that is.
    const why = new Map<string, string[]>();
    const add = (id: string, because: string) => why.set(id, [...(why.get(id) ?? []), because]);
    const reviewIds = new Set<string>();
    for (const g of gates) {
      if (g.type !== 'decisions') continue;
      for (const id of g.decisions) add(id, `gate ${g.id}`);
      for (const r of g.designReviews) reviewIds.add(r);
    }
    for (const d of i.decisions) if (d.kind === 'register-entry' && d.milestone && stage.includeMilestones.includes(d.milestone)) add(d.id, `needed by ${d.milestone}`);
    const seeds = [...why.keys(), ...reviewIds];
    const reached = closure(seeds, i.edges);
    const closureItems: string[] = [];
    for (const id of reached) {
      if (seeds.includes(id)) continue;
      if (isDecisionId(id)) add(id, 'a dependency (requires link) of a required decision or review');
      else if (/^RV-\d{4}$/.test(id)) reviewIds.add(id);
      else closureItems.push(id);
    }
    const requiredIds = new Set(why.keys());
    const required: DecisionRow[] = [...requiredIds].sort().map((id) => ({ ...rowOf(id), requiredBy: why.get(id)! }));
    const reviews = [...reviewIds].sort().map((id) => ({ id, satisfied: approvedReviews.has(id) }));

    const pending = required.filter((r) => !r.approved && r.state !== 'rejected' && r.state !== 'deferred');
    const rejected = required.filter((r) => r.state === 'rejected');
    const deferred = required.filter((r) => r.state === 'deferred');
    const security = required.filter((r) => r.needsSecurityApproval && !r.approved);
    const approved = required.filter((r) => r.approved);
    const critAssumptions = i.assumptions.filter((a) => !a.resolved && critical(a.id, requiredIds)).map((a) => a.id);
    const missingEvidence = required.filter((r) => r.evidence !== 'present').map((r) => r.id);
    const withoutValidation = approved.filter((r) => !r.validated).map((r) => r.id);
    const blockingKinds = new Set(['task', 'roadmap', 'backlog', 'validation', 'security']);
    // Tasks reached by requires links from the gates, plus the work the queue's own build analysis says the build cannot start without.
    const tasks = [...new Set([...closureItems, ...i.items.filter((x) => x.blocksBuild).map((x) => x.id)])].filter((id) => {
      const it = itemById.get(id);
      return !!it && blockingKinds.has(it.kind) && !isResolved(it.status);
    });

    const blocks = (b: Blocking) => stage.blockOn.includes(b);
    const metrics: Metric[] = [
      { id: 'required-decisions', label: 'Required decisions', count: required.length, members: required.map((r) => r.id), rule: 'Named by a gate of the stage, needed by a listed milestone, or a requires-dependency of one of those.', blocks: false },
      { id: 'approved', label: 'Approved', count: approved.length, members: approved.map((r) => r.id), rule: 'Status Approved with a basis the policy accepts. Text alone never counts.', blocks: false },
      { id: 'unresolved-required-decisions', label: 'Not yet decided', count: pending.length, members: pending.map((r) => r.id), rule: 'Required and Proposed, Pending Review, Blocked, Open or missing.', blocks: blocks('unresolved-required-decisions') },
      { id: 'rejected-required', label: 'Rejected, redesign required', count: rejected.length, members: rejected.map((r) => r.id), rule: 'A rejection is not a resolution: the dependent design must change and the decision be taken again.', blocks: blocks('rejected-required') },
      { id: 'deferred-required', label: 'Deferred and required', count: deferred.length, members: deferred.map((r) => r.id), rule: 'A deferred decision that a gate needs. Deferred decisions that nothing needs are listed separately as non-blocking.', blocks: blocks('deferred-required') },
      { id: 'critical-assumptions', label: 'Unresolved critical assumptions', count: critAssumptions.length, members: critAssumptions, rule: 'Unresolved, and cited by a required decision or listed as critical in the policy.', blocks: blocks('critical-assumptions') },
      { id: 'outstanding-security-approvals', label: 'Outstanding security approvals', count: security.length, members: security.map((r) => r.id), rule: 'Required, not approved, and either in the security approval domain or naming a security role as approver.', blocks: blocks('outstanding-security-approvals') },
      { id: 'missing-evidence', label: 'Missing architecture evidence', count: missingEvidence.length, members: missingEvidence, rule: 'Required decisions that cite no evidence record, or cite one that does not exist or whose only runs failed.', blocks: blocks('missing-evidence') },
      { id: 'requirements-without-decisions', label: 'Must requirements without a decision', count: uncovered.length, members: uncovered, rule: 'No decision appears against the requirement in the traceability, and no decision lists it as blocked by it. Not limited to the area.', blocks: blocks('requirements-without-decisions') },
      { id: 'decisions-without-validation', label: 'Approved decisions without validation', count: withoutValidation.length, members: withoutValidation, rule: 'Approved and required, with no passing test run and no approved design review behind it.', blocks: blocks('decisions-without-validation') },
      { id: 'blocking-tasks', label: 'Blocking tasks', count: tasks.length, members: tasks, rule: 'Unresolved task, roadmap, backlog, validation or security items reached by requires links from the gates, or on the build path of the Work Queue analysis.', blocks: blocks('blocking-tasks') },
    ];

    const blockers: Reason[] = [];
    for (const g of gateResults) for (const r of g.reasons) blockers.push({ ...r, text: `Gate "${g.id}": ${r.text}` });
    for (const m of metrics) {
      if (!m.blocks || m.count === 0) continue;
      // The unmet gates already named the decisions in the order of the gate; the metric lines add what no gate said.
      if (['unresolved-required-decisions', 'rejected-required', 'deferred-required'].includes(m.id)) {
        const extra = m.members.filter((id) => !blockers.some((b) => b.refs.includes(id)));
        if (!extra.length) continue;
        blockers.push({ code: m.id, text: `${m.label}: ${extra.join(', ')}. ${m.rule}`, refs: extra });
      } else blockers.push({ code: m.id, text: `${m.label}: ${m.count} (${m.members.slice(0, 12).join(', ')}${m.members.length > 12 ? ', ...' : ''}). ${m.rule}`, refs: m.members });
    }
    const nonBlocking = i.decisions.filter((d) => d.status === 'Deferred' && !requiredIds.has(d.id)).map((d) => ({ ...rowOf(d.id), requiredBy: [] as string[] }));
    return { id: area.id, title: area.title, kind: area.kind, stage: stage.id, stageTitle: stage.title, paths: area.pathSources, gates: gateResults, requiredDecisions: required, requiredReviews: reviews, metrics, blockers, ready: blockers.length === 0, deferredNonBlocking: nonBlocking, closureItems };
  });

  const all = [...rows.values()];
  return {
    commit: i.commit,
    policyHash: i.policy.hash,
    policyProblems: i.policy.problems,
    signatures: i.signatures,
    areas,
    global: {
      decisions: all.length,
      approved: all.filter((r) => r.approved).length,
      pending: all.filter((r) => r.state === 'pending').length,
      rejected: all.filter((r) => r.state === 'rejected').length,
      deferred: all.filter((r) => r.state === 'deferred').length,
      superseded: all.filter((r) => r.state === 'superseded').length,
      requirements: i.requirements.length,
      mustRequirements: i.requirements.filter((r) => r.priority.toLowerCase().startsWith('must')).length,
    },
  };
}
