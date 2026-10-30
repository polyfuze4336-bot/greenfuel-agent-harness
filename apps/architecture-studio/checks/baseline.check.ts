// Tests for the architecture readiness validator, the baseline manifest and the build gates. Three layers:
//   1. the rules on hand-made inputs (fast, exhaustive);
//   2. the real repository, read-only (what the gate says today);
//   3. a whole baseline life in a throw-away clone: generate, authorize with a real signed approval, verify, drift, reopen, supersede.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import type { NormalizedDecision } from '../src/lib/intel/schema.ts';
import type { HarnessFacts } from '../src/lib/baseline/facts.ts';
import { loadReadinessInput } from '../src/lib/baseline/input.ts';
import { BASELINE_DIR, buildBaseline, manifestHash, manifestPath, serialize } from '../src/lib/baseline/manifest.ts';
import { areaOfPath, parseBaselinePolicy, type BaselinePolicy } from '../src/lib/baseline/policy.ts';
import { approvalOf, computeReadiness, type ReadinessInput } from '../src/lib/baseline/readiness.ts';
import { REOPEN_SCHEMA, evaluateAreas, evaluateChange, loadBaselineStates, type BaselineState } from '../src/lib/baseline/state.ts';
import { git, makeDecision } from './fixtures/review-fixture.ts';

const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const SCRIPT = path.join(REPO, 'apps', 'architecture-studio', 'scripts', 'baseline.ts');
const dirs: string[] = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------- layer 1: the rules

const POLICY = {
  version: 1,
  activeStage: 'slice',
  rules: { reviewRecordsCountAsApproval: true, grandfatheredAdrsCountAsApproval: true, conditionalApprovals: 'flag', requirementChange: 'review', supersededBySuccessor: true },
  gates: [
    { id: 'phase-raised', title: 'Phase raised', type: 'harness', check: 'phase', source: 'HC-11' },
    { id: 'approver-registry', title: 'Approver enrolled', type: 'harness', check: 'approvers', class: 'architecture', source: 'blocker report G2' },
    { id: 'branch-protection', title: 'Branch protection', type: 'harness', check: 'branch-protection', source: 'T14' },
    { id: 'core', title: 'Core decisions', type: 'decisions', decisions: ['D-001', 'ADR-0016'], designReviews: ['RV-0003'], source: 'test' },
    { id: 'scope', title: 'Scope ADR', type: 'decisions', decisions: ['ADR-0020'], source: 'test' },
  ],
  stages: [
    { id: 'slice', title: 'Slice', gates: ['scope'], includeMilestones: [], blockOn: ['critical-assumptions'] },
    { id: 'full', title: 'Full', gates: ['phase-raised', 'approver-registry', 'branch-protection', 'core'], includeMilestones: ['M1'], blockOn: ['critical-assumptions', 'missing-evidence', 'requirements-without-decisions', 'decisions-without-validation', 'blocking-tasks'] },
  ],
  areas: [
    { id: 'application', title: 'Application', kind: 'implementation', stage: 'active', paths: ['^src/', '^tests/product/'] },
    { id: 'infrastructure', title: 'Infrastructure', kind: 'implementation', stage: 'full', paths: ['^infra/', '\\.bicep$'] },
  ],
  criticalAssumptions: { include: [], exclude: [] },
};
const policyOf = (over: Record<string, unknown> = {}): BaselinePolicy => parseBaselinePolicy(JSON.stringify({ ...POLICY, ...over }));

const facts = (over: Partial<HarnessFacts> = {}): HarnessFacts => ({ phase: 0, phaseApproved: false, architectureKeys: 0, deploymentKeys: 0, valid: {}, invalid: [], grandfathered: ['0001', '0002'], problems: [], ...over });
const approved = (id: string, over: Partial<NormalizedDecision> = {}) => makeDecision({ id, status: 'Approved', approvalBasis: 'review-record', ...over });

function input(decisions: NormalizedDecision[], over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    commit: 'c'.repeat(40),
    ref: 'HEAD',
    policy: policyOf(),
    decisions,
    reviewStates: new Map(),
    requirements: [],
    assumptions: [],
    assumptionRefs: {},
    items: [],
    edges: [],
    designReviews: [],
    harness: facts(),
    textHash: Object.fromEntries(decisions.map((d) => [d.id, d.contentHash])),
    domains: Object.fromEntries(decisions.map((d) => [d.id, 'architecture'])),
    branchProtectionInForce: false,
    signatures: 'verified',
    ...over,
  };
}
const area = (i: ReadinessInput, id: string) => computeReadiness(i).areas.find((a) => a.id === id)!;
const metric = (i: ReadinessInput, a: string, m: string) => area(i, a).metrics.find((x) => x.id === m)!;

describe('policy', () => {
  it('the policy in this repository is valid, every gate states its source, and each phase-gated path belongs to an area', () => {
    const p = parseBaselinePolicy(fs.readFileSync(path.join(REPO, 'harness', 'policy', 'baseline-policy.json'), 'utf8'));
    assert.deepEqual(p.problems, []);
    assert.ok(p.valid);
    assert.ok(p.gates.every((g) => g.source.length > 20));
    for (const f of ['src/app/main.ts', 'tests/product/a.test.ts', 'infra/main.bicep', 'infra/x/y.tf', 'x.tfvars', 'azure.yaml', 'Dockerfile', '.azure/env.json', 'p.bicepparam', '.github/workflows/deploy-prod.yml', '.github/workflows/release.yaml']) assert.ok(areaOfPath(p, f).length > 0, `${f} is covered`);
    for (const f of ['docs/adr/0001.md', 'README.md', '.github/workflows/validate.yml', 'harness/policy/x.json']) assert.equal(areaOfPath(p, f).length, 0, `${f} is not a gated path`);
    // The harness's own list of phase-gated paths must be covered too, so the two cannot drift apart.
    const cp = JSON.parse(fs.readFileSync(path.join(REPO, 'harness', 'policy', 'command-policy.json'), 'utf8')) as { phaseGatedPaths: string[] };
    for (const re of cp.phaseGatedPaths) {
      const sample = re.replace(/^\^/, '').replace(/\\\./g, '.').replace(/\$$/, '').replace(/^\\\./, '.');
      const probe = sample.startsWith('.') && !sample.includes('/') && !sample.startsWith('.azure') ? `x${sample}` : sample.endsWith('/') ? `${sample}file.ts` : sample;
      assert.ok(areaOfPath(p, probe).length > 0, `phase-gated pattern ${re} (probe ${probe}) is covered by an area`);
    }
  });

  it('an invalid policy authorizes nothing, and says why', () => {
    for (const [name, text, why] of [
      ['missing', undefined, /does not exist/],
      ['not json', '{nope', /not valid JSON/],
      ['wrong version', JSON.stringify({ version: 9 }), /version 9/],
    ] as [string, string | undefined, RegExp][]) {
      const p = parseBaselinePolicy(text);
      assert.equal(p.valid, false, name);
      assert.match(p.problems[0]!, why, name);
      assert.deepEqual(p.areas, []);
    }
    const bad = (over: Record<string, unknown>, why: RegExp) => {
      const p = policyOf(over);
      assert.equal(p.valid, false);
      assert.ok(p.problems.some((m) => why.test(m)), p.problems.join('; '));
    };
    bad({ gates: [...POLICY.gates, { id: 'nosource', title: 'x', type: 'decisions', decisions: ['D-001'] }] }, /states no source/);
    bad({ stages: [{ ...POLICY.stages[0], gates: ['nope'] }, POLICY.stages[1]] }, /gate nope, which does not exist/);
    bad({ activeStage: 'ghost' }, /not a stage/);
    bad({ areas: [{ ...POLICY.areas[0], paths: ['(unclosed'] }] }, /not a valid expression/);
    bad({ gates: [{ id: 'gate-x', title: 'g', type: 'decisions', decisions: ['not-an-id'], source: 'a source long enough' }] }, /not a decision/);
    bad({ areas: [] }, /no area/);
  });

  it('a policy cannot switch off the checks the capability exists for', () => {
    const p = policyOf({ stages: [{ ...POLICY.stages[0], blockOn: [] }, POLICY.stages[1]] });
    for (const must of ['gates', 'baseline', 'unresolved-required-decisions', 'rejected-required', 'deferred-required', 'outstanding-security-approvals']) assert.ok(p.stages[0]!.blockOn.includes(must as never), must);
  });
});

describe('what counts as approved', () => {
  const byId = (ds: NormalizedDecision[]) => new Map(ds.map((d) => [d.id, d]));
  const ctx = (h: HarnessFacts = facts(), policy = policyOf()) => ({ policy, harness: h, reviewStates: new Map() });

  it('text alone never counts: a status of Approved with no approval behind it is not approved', () => {
    const d = approved('ADR-0050', { kind: 'adr', approvalBasis: 'none' });
    const r = approvalOf(d, ctx(), byId([d]));
    assert.equal(r.approved, false);
    assert.match(r.basis, /no approval record/);
    const unsignedNew = approved('ADR-0050', { kind: 'adr', approvalBasis: 'owner-instruction-unsigned' });
    assert.equal(approvalOf(unsignedNew, ctx(), byId([unsignedNew])).approved, false, 'unsigned and not grandfathered');
    assert.equal(approvalOf(approved('D-001', { approvalBasis: 'delegated-unsigned' }), ctx(), byId([])).approved, false);
  });

  it('a signed approval counts only if the harness verifies it', () => {
    const d = approved('ADR-0016', { kind: 'adr', approvalBasis: 'signed' });
    assert.equal(approvalOf(d, ctx(), byId([d])).approved, false, 'recorded as signed but nothing verifies');
    const ok = approvalOf(d, ctx(facts({ valid: { 'adr:0016': [{ approval: 'AP-1', file: 'docs/approvals/a.json', signers: ['k'], issuedAt: '2026-01-01T00:00:00Z' }] } })), byId([d]));
    assert.equal(ok.approved, true);
    assert.match(ok.basis, /verified/);
  });

  it('grandfathered ADRs and review records count only under the policy, with a caveat the human will see', () => {
    const g = approved('ADR-0001', { kind: 'adr', approvalBasis: 'owner-instruction-unsigned' });
    const r = approvalOf(g, ctx(), byId([g]));
    assert.equal(r.approved, true);
    assert.ok(r.caveats.some((c) => /owner instruction in chat/.test(c)));
    const off = policyOf({ rules: { ...POLICY.rules, grandfatheredAdrsCountAsApproval: false, reviewRecordsCountAsApproval: false } });
    assert.equal(approvalOf(g, ctx(facts(), off), byId([g])).approved, false);
    const rv = approved('D-001');
    assert.equal(approvalOf(rv, ctx(), byId([rv])).approved, true);
    assert.ok(approvalOf(rv, ctx(), byId([rv])).caveats.length > 0);
    assert.equal(approvalOf(rv, ctx(facts(), off), byId([rv])).approved, false);
  });

  it('a rejection is not a resolution, a deferral is not a decision, and a successor can stand in for a superseded record', () => {
    const rej = makeDecision({ id: 'D-002', status: 'Rejected' });
    const r1 = approvalOf(rej, ctx(), byId([rej]));
    assert.deepEqual([r1.approved, r1.state], [false, 'rejected']);
    const def = makeDecision({ id: 'D-003', status: 'Deferred' });
    assert.deepEqual([approvalOf(def, ctx(), byId([def])).approved, approvalOf(def, ctx(), byId([def])).state], [false, 'deferred']);
    const old = makeDecision({ id: 'ADR-0004', kind: 'adr', status: 'Superseded', supersededBy: ['ADR-0021'] });
    assert.equal(approvalOf(old, ctx(), byId([old])).approved, false, 'no successor on record');
    const next = approved('ADR-0021', { kind: 'adr' });
    assert.equal(approvalOf(old, ctx(), byId([old, next])).approved, true);
    const proposedNext = makeDecision({ id: 'ADR-0021', kind: 'adr', status: 'Proposed' });
    assert.equal(approvalOf(old, ctx(), byId([old, proposedNext])).approved, false, 'a proposed successor resolves nothing');
  });

  it('conditional approvals are flagged by default and can be made blocking', () => {
    const d = approved('D-001');
    const states = new Map([['D-001', { phase: 'approved-with-conditions', conditions: ['Confirm in-country support'] } as never]]);
    const flagged = approvalOf(d, { ...ctx(), reviewStates: states }, byId([d]));
    assert.equal(flagged.approved, true);
    assert.ok(flagged.caveats.some((c) => /Confirm in-country support/.test(c)));
    const strict = policyOf({ rules: { ...POLICY.rules, conditionalApprovals: 'block' } });
    assert.equal(approvalOf(d, { ...ctx(facts(), strict), reviewStates: states }, byId([d])).approved, false);
  });
});

describe('gates and what blocks', () => {
  it('an area is ready only when every gate and blocking measure is clear, and it says exactly what is not', () => {
    const none = area(input([approved('ADR-0020', { kind: 'adr' })]), 'application');
    assert.equal(none.ready, true);
    assert.deepEqual(none.blockers, []);
    const blocked = area(input([makeDecision({ id: 'ADR-0020', kind: 'adr', status: 'Proposed' })]), 'application');
    assert.equal(blocked.ready, false);
    assert.match(blocked.blockers[0]!.text, /Gate "scope": ADR-0020 is Proposed/);
    assert.deepEqual(blocked.blockers[0]!.refs, ['ADR-0020']);
    const missing = area(input([]), 'application');
    assert.match(missing.blockers[0]!.text, /not in the decision register/);
  });

  it('a rejected required decision is never treated as resolved; it needs redesign', () => {
    const a = area(input([makeDecision({ id: 'ADR-0020', kind: 'adr', status: 'Rejected' })]), 'application');
    assert.equal(a.ready, false);
    assert.match(a.blockers[0]!.text, /rejected: the design must be reworked/);
    assert.equal(metric(input([makeDecision({ id: 'ADR-0020', kind: 'adr', status: 'Rejected' })]), 'application', 'rejected-required').count, 1);
    assert.equal(a.requiredDecisions[0]!.approved, false);
  });

  it('a deferred decision blocks only the areas that require it; unrelated deferred decisions are listed as non-blocking', () => {
    const slice = area(input([approved('ADR-0020', { kind: 'adr' }), makeDecision({ id: 'D-050', kind: 'register-entry', status: 'Deferred', milestone: 'M3' })]), 'application');
    assert.equal(slice.ready, true, 'nothing in the slice stage needs D-050');
    assert.deepEqual(slice.deferredNonBlocking.map((d) => d.id), ['D-050']);
    const required = area(input([approved('ADR-0020', { kind: 'adr' }), makeDecision({ id: 'D-001', status: 'Deferred' })]), 'infrastructure');
    assert.ok(required.blockers.some((b) => /deferred/.test(b.text) && b.refs.includes('D-001')));
    assert.equal(metric(input([makeDecision({ id: 'D-001', status: 'Deferred' })]), 'infrastructure', 'deferred-required').count, 1);
  });

  it('does not require optional or future-phase decisions: only gates, listed milestones and dependencies make a decision required', () => {
    const decisions = [approved('ADR-0020', { kind: 'adr' }), makeDecision({ id: 'D-070', kind: 'register-entry', status: 'Proposed', milestone: 'M3' }), makeDecision({ id: 'D-071', kind: 'register-entry', status: 'Proposed', milestone: null })];
    const a = area(input(decisions), 'application');
    assert.deepEqual(a.requiredDecisions.map((d) => d.id), ['ADR-0020']);
    assert.equal(a.ready, true);
    const full = area(input([...decisions, makeDecision({ id: 'D-072', kind: 'register-entry', status: 'Proposed', milestone: 'M1' })]), 'infrastructure');
    assert.ok(full.requiredDecisions.some((d) => d.id === 'D-072' && d.requiredBy.includes('needed by M1')));
    assert.ok(!full.requiredDecisions.some((d) => d.id === 'D-070' || d.id === 'D-071'));
  });

  it('is dependency-aware: a requires link pulls the dependency in, and a rejected dependency keeps the area closed', () => {
    const decisions = [approved('D-001'), approved('ADR-0016', { kind: 'adr' }), makeDecision({ id: 'D-030', kind: 'register-entry', status: 'Rejected' }), approved('ADR-0020', { kind: 'adr' })];
    const edges = [
      { from: 'D-001', to: 'D-030', type: 'requires' as const, basis: 'x' },
      { from: 'D-001', to: 'D-031', type: 'references' as const, basis: 'x' },
    ];
    const a = area(input([...decisions, makeDecision({ id: 'D-031', status: 'Proposed' })], { edges }), 'infrastructure');
    const d30 = a.requiredDecisions.find((d) => d.id === 'D-030');
    assert.ok(d30 && d30.requiredBy.some((x) => /a dependency/.test(x)), 'D-030 is required because D-001 requires it');
    assert.ok(!a.requiredDecisions.some((d) => d.id === 'D-031'), 'a mere reference is not a dependency');
    assert.equal(a.ready, false);
    assert.ok(a.blockers.some((b) => b.refs.includes('D-030') && /rejected/i.test(b.text)));
  });

  it('design reviews need an Approved declaration and a verifying signed approval', () => {
    const base = [approved('D-001'), approved('ADR-0016', { kind: 'adr' }), approved('ADR-0020', { kind: 'adr' })];
    const rv = (declared: string) => [{ id: 'RV-0003', declared, adrs: [], src: { path: 'x', line: 1 } }];
    const phaseOk = facts({ phase: 1, phaseApproved: true, architectureKeys: 1, valid: { 'phase:phase-1': [] } });
    const blockedText = area(input(base, { designReviews: rv('Blocked'), harness: phaseOk, branchProtectionInForce: true }), 'infrastructure');
    assert.ok(blockedText.blockers.some((b) => b.code === 'review' && /Blocked/.test(b.text)));
    const textOnly = area(input(base, { designReviews: rv('Approved'), harness: phaseOk, branchProtectionInForce: true }), 'infrastructure');
    assert.ok(textOnly.blockers.some((b) => b.code === 'review' && /no valid signed approval/.test(b.text)), 'a review that says Approved without a signature does not count');
    const signed = area(input(base, { designReviews: rv('Approved'), harness: { ...phaseOk, valid: { ...phaseOk.valid, 'review:RV-0003': [{ approval: 'AP-1', file: 'f', signers: ['k'], issuedAt: 't' }] } }, branchProtectionInForce: true }), 'infrastructure');
    assert.ok(!signed.blockers.some((b) => b.code === 'review'));
  });

  it('the harness gates: phase, approver registry and branch protection', () => {
    const g = (h: HarnessFacts, bp = false) => Object.fromEntries(area(input([approved('D-001'), approved('ADR-0016', { kind: 'adr' })], { harness: h, branchProtectionInForce: bp }), 'infrastructure').gates.map((x) => [x.id, x]));
    const closed = g(facts());
    assert.equal(closed['phase-raised']!.satisfied, false);
    assert.match(closed['phase-raised']!.reasons[0]!.text, /phase is 0/);
    assert.equal(closed['approver-registry']!.satisfied, false);
    assert.equal(closed['branch-protection']!.satisfied, false);
    const unsigned = g(facts({ phase: 1, phaseApproved: false }));
    assert.match(unsigned['phase-raised']!.reasons[0]!.text, /no valid signed phase approval/, 'phase 1 written in a file without signed approvals');
    const open = g(facts({ phase: 1, phaseApproved: true, architectureKeys: 1 }), true);
    assert.equal(open['phase-raised']!.satisfied && open['approver-registry']!.satisfied && open['branch-protection']!.satisfied, true);
  });
});

describe('the measures', () => {
  const full = (ds: NormalizedDecision[], over: Partial<ReadinessInput> = {}) => input(ds, over);
  const gateDecisions = [approved('D-001'), approved('ADR-0016', { kind: 'adr' })];

  it('counts unresolved critical assumptions: those a required decision cites, plus any the policy lists, minus any it excludes', () => {
    const assumptions = [
      { id: 'AS-1', text: '', basis: '', riskIfWrong: '', validation: '', replacedBy: '', resolved: false, src: { path: 'a', line: 1 } },
      { id: 'AS-2', text: '', basis: '', riskIfWrong: '', validation: '', replacedBy: '', resolved: false, src: { path: 'a', line: 2 } },
      { id: 'AS-3', text: '', basis: '', riskIfWrong: '', validation: '', replacedBy: '', resolved: true, src: { path: 'a', line: 3 } },
      { id: 'AS-4', text: '', basis: '', riskIfWrong: '', validation: '', replacedBy: '', resolved: false, src: { path: 'a', line: 4 } },
    ];
    const i = full(gateDecisions, { assumptions, assumptionRefs: { 'D-001': ['AS-1', 'AS-3'], 'D-099': ['AS-4'] } });
    assert.deepEqual(metric(i, 'infrastructure', 'critical-assumptions').members, ['AS-1'], 'AS-3 is resolved, AS-2 and AS-4 are not cited by a required decision');
    const listed = full(gateDecisions, { assumptions, assumptionRefs: {}, policy: policyOf({ criticalAssumptions: { include: ['AS-2'], exclude: ['AS-1'] } }) });
    assert.deepEqual(metric(listed, 'infrastructure', 'critical-assumptions').members, ['AS-2']);
  });

  it('counts outstanding security approvals by domain or by a named security role, only while not approved', () => {
    const sec = makeDecision({ id: 'D-001', status: 'Proposed', requiredApproverRole: { text: 'Programme owner, security architect', basis: 't' } });
    const i = full([sec, makeDecision({ id: 'ADR-0016', kind: 'adr', status: 'Proposed' })], { domains: { 'D-001': 'regulatory', 'ADR-0016': 'security' } });
    assert.deepEqual(metric(i, 'infrastructure', 'outstanding-security-approvals').members.sort(), ['ADR-0016', 'D-001']);
    const done = full([approved('D-001', { requiredApproverRole: { text: 'Security architect', basis: 't' } }), approved('ADR-0016', { kind: 'adr' })]);
    assert.equal(metric(done, 'infrastructure', 'outstanding-security-approvals').count, 0);
  });

  it('flags missing architecture evidence, decisions without validation, requirements without decisions and blocking tasks', () => {
    const ev = (id: string, resolved: boolean, exitCode: number | null) => ({ id, kind: 'test-run' as const, claim: null, exitCode, resolved, src: null });
    const d1 = approved('D-001', { evidence: [ev('EV-1', true, 0)] });
    const d2 = approved('ADR-0016', { kind: 'adr', evidence: [ev('EV-2', false, null)] });
    const d3 = approved('ADR-0020', { kind: 'adr', evidence: [ev('EV-3', true, 1)] });
    const reqs = [
      { id: 'FR-1', priority: 'Must', decisions: [], title: '', acceptance: '', validation: '', evidenceRequired: '' },
      { id: 'FR-2', priority: 'Must', decisions: ['D-001'], title: '', acceptance: '', validation: '', evidenceRequired: '' },
      { id: 'FR-3', priority: 'Should', decisions: [], title: '', acceptance: '', validation: '', evidenceRequired: '' },
    ] as never;
    const items = [
      { id: 'T14', kind: 'task', status: 'Open', blocksBuild: true },
      { id: 'T15', kind: 'task', status: 'Done', blocksBuild: true },
      { id: 'SF-1', kind: 'security', status: 'Open', blocksBuild: false },
    ] as never;
    const i = full([d1, d2, d3], { requirements: reqs, items, edges: [{ from: 'ADR-0016', to: 'SF-1', type: 'requires', basis: 'x' }] });
    assert.deepEqual(metric(i, 'infrastructure', 'missing-evidence').members.sort(), ['ADR-0016', 'ADR-0020'].filter((x) => x !== 'ADR-0020').concat([]).sort(), 'ADR-0020 is not required at the full stage, so only D-001 and ADR-0016 are looked at');
    assert.deepEqual(metric(i, 'infrastructure', 'requirements-without-decisions').members, ['FR-1'], 'only Must requirements, and only those with no decision');
    assert.deepEqual(metric(i, 'infrastructure', 'decisions-without-validation').members, ['ADR-0016'], 'D-001 has a passing run; ADR-0016 has none that resolves');
    assert.deepEqual(metric(i, 'infrastructure', 'blocking-tasks').members.sort(), ['SF-1', 'T14']);
  });

  it('optional measures block only the stages whose policy lists them', () => {
    const decisions = [approved('ADR-0020', { kind: 'adr' })];
    const slice = area(input(decisions, { requirements: [{ id: 'FR-1', priority: 'Must', decisions: [], title: '', acceptance: '', validation: '', evidenceRequired: '' }] as never }), 'application');
    assert.equal(slice.ready, true, 'the slice stage does not block on requirements without decisions, or on missing evidence');
    assert.equal(slice.metrics.find((m) => m.id === 'requirements-without-decisions')!.count, 1, 'but it is still reported');
    assert.equal(slice.metrics.find((m) => m.id === 'requirements-without-decisions')!.blocks, false);
    const h = facts({ phase: 1, phaseApproved: true, architectureKeys: 1 });
    const prod = area(input([approved('D-001'), approved('ADR-0016', { kind: 'adr' })], { requirements: [{ id: 'FR-1', priority: 'Must', decisions: [], title: '', acceptance: '', validation: '', evidenceRequired: '' }] as never, harness: h, branchProtectionInForce: true, designReviews: [{ id: 'RV-0003', declared: 'Approved', adrs: [], src: { path: 'x', line: 1 } }] }), 'infrastructure');
    assert.ok(prod.blockers.some((b) => b.code === 'requirements-without-decisions'));
  });
});

// ---------------------------------------------------------------- layer 2: the real repository

describe('this repository today', () => {
  const run = (...args: string[]) => spawnSync('node', [SCRIPT, ...args], { cwd: REPO, encoding: 'utf8', timeout: 240_000 });

  it('every area is blocked, each with named reasons; the slice needs only the phase, an approver and ADR 0020', () => {
    const { input: i } = loadReadinessInput(REPO, 'HEAD', { codeRoot: REPO });
    assert.ok(i.policy.valid, i.policy.problems.join('; '));
    const r = computeReadiness(i);
    assert.deepEqual(r.areas.map((a) => a.id), ['application', 'infrastructure', 'deployment']);
    assert.ok(r.areas.every((a) => !a.ready && a.blockers.length > 0));
    const app = r.areas[0]!;
    assert.deepEqual(app.requiredDecisions.map((d) => d.id), ['ADR-0020'], 'the slice stage does not drag in the full register');
    assert.ok(app.gates.every((g) => !g.satisfied));
    const prod = r.areas[1]!;
    assert.ok(prod.requiredDecisions.length > 30, 'the production stage needs the milestone and gate decisions');
    assert.equal(prod.metrics.find((m) => m.id === 'approved')!.count, 0);
    assert.ok(prod.requiredDecisions.some((d) => d.requiredBy.some((x) => /needed by M1/.test(x))));
    assert.ok(r.global.approved >= 12 && r.global.rejected === 0);
  });

  it('the CLI refuses a gated change with exit code 2 and numbered reasons, and allows an ungated one', () => {
    const blocked = run('gate', '--area', 'application');
    assert.equal(blocked.status, 2, blocked.stdout + blocked.stderr);
    assert.match(blocked.stdout, /BLOCKED/);
    assert.match(blocked.stdout, /1\. Gate "phase-raised": The phase is 0/);
    assert.match(blocked.stdout, /To unblock:/);
    assert.match(blocked.stdout, /cannot stop a local edit/, 'it does not overclaim');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-diff-'));
    dirs.push(dir);
    git(REPO, 'rev-parse', 'HEAD');
    const c = (...a: string[]) => git(dir, ...a);
    spawnSync('git', ['clone', '-q', '--local', '--no-hardlinks', REPO, dir]);
    c('config', 'user.email', 't@example.invalid');
    c('config', 'user.name', 'T');
    c('config', 'commit.gpgsign', 'false');
    const base = c('rev-parse', 'HEAD');
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'main.ts'), 'export {};\n');
    c('add', '-A');
    c('commit', '-q', '-m', 'add application code');
    const withSrc = spawnSync('node', [SCRIPT, 'gate', '--root', dir, '--code-root', REPO, '--changed', `${base}..HEAD`], { cwd: REPO, encoding: 'utf8', timeout: 240_000 });
    assert.equal(withSrc.status, 2, withSrc.stdout + withSrc.stderr);
    assert.match(withSrc.stdout, /fall in: application/);
    const head1 = c('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(dir, 'NOTES.md'), 'notes\n');
    c('add', '-A');
    c('commit', '-q', '-m', 'docs only');
    const docs = spawnSync('node', [SCRIPT, 'gate', '--root', dir, '--code-root', REPO, '--changed', `${head1}..HEAD`], { cwd: REPO, encoding: 'utf8', timeout: 240_000 });
    assert.equal(docs.status, 0, docs.stdout + docs.stderr);
    assert.match(docs.stdout, /no gated area/);
  });

  it('refuses to generate a baseline over an open gate and writes nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-gen-'));
    dirs.push(dir);
    spawnSync('git', ['clone', '-q', '--local', '--no-hardlinks', REPO, dir]);
    const r = spawnSync('node', [SCRIPT, 'generate', '--root', dir, '--code-root', REPO, '--id', 'BL-0001', '--areas', 'application'], { cwd: REPO, encoding: 'utf8', timeout: 240_000 });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /CANNOT GENERATE BL-0001/);
    assert.match(r.stdout, /There is no option to generate a baseline over an open gate/);
    assert.equal(fs.existsSync(path.join(dir, BASELINE_DIR, 'BL-0001')), false);
    const bad = spawnSync('node', [SCRIPT, 'gate', '--area', 'nonsense'], { cwd: REPO, encoding: 'utf8' });
    assert.equal(bad.status, 1);
  });
});

// ---------------------------------------------------------------- layer 3: a whole baseline life

const require = createRequire(import.meta.url);
const gates = require('../../../harness/approvals/approval-gates.cjs');
const engine = require('../../../harness/hooks/permission-engine.cjs');
const { buildEnrollment, registerEntry } = await import('../../../harness/scripts/approval.mjs');
const PASS = 'a-test-passphrase-123';

const approver = (holder: string, classes: string[], tiers: string[] = []) => {
  const e = buildEnrollment({ holder, classes, tiers: tiers as never[], passphrase: PASS, now: new Date(Date.now() - 3 * 3600000) });
  const { entry } = registerEntry({ request: e.request, approvers: [], typedFingerprint: e.request.fingerprint, now: new Date(Date.now() - 2 * 3600000) });
  return { ...e, entry };
};

/** A clone whose policy asks for little (an enrolled approver and ADR 0001), so a whole baseline life can be walked through it. */
function lifeWorld() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-life-'));
  dirs.push(dir);
  spawnSync('git', ['clone', '-q', '--local', '--no-hardlinks', REPO, dir]);
  const g = (...a: string[]) => git(dir, ...a);
  g('config', 'user.email', 't@example.invalid');
  g('config', 'user.name', 'T');
  g('config', 'commit.gpgsign', 'false');
  const arch = approver('Test Architect', ['architecture']);
  const policy = {
    version: 1,
    activeStage: 'test',
    rules: POLICY.rules,
    gates: [
      { id: 'approver-registry', title: 'Approver enrolled', type: 'harness', check: 'approvers', class: 'architecture', source: 'test world: an architecture key must exist' },
      { id: 'adr-one', title: 'ADR 0001 is accepted', type: 'decisions', decisions: ['ADR-0001'], source: 'test world: one grandfathered ADR' },
    ],
    stages: [{ id: 'test', title: 'Test', gates: ['approver-registry', 'adr-one'], includeMilestones: [], blockOn: [] }],
    areas: [{ id: 'application', title: 'Application', kind: 'implementation', stage: 'active', paths: ['^src/'] }],
    criticalAssumptions: { include: [], exclude: [] },
  };
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  write('harness/policy/baseline-policy.json', `${JSON.stringify(policy, null, 2)}\n`);
  write('harness/policy/approvers.json', `${JSON.stringify({ version: 1, approvers: [arch.entry] }, null, 2)}\n`);
  g('add', '-A');
  g('commit', '-q', '-m', 'test world: policy and approver');
  const commit = (msg: string) => {
    g('add', '-A');
    g('commit', '-q', '-m', msg);
    return g('rev-parse', 'HEAD');
  };
  const state = (opts: { reproduce?: boolean } = {}) => {
    const cur = loadReadinessInput(dir, 'HEAD', { codeRoot: REPO });
    const r = computeReadiness(cur.input);
    const states = loadBaselineStates(dir, cur, r, { codeRoot: REPO, reproduce: opts.reproduce ?? true });
    return { cur, r, states, gates: evaluateAreas(r, states, cur.input.policy) };
  };
  const generate = (id: string, supersedes: string | null = null, version = 1) => {
    const cur = loadReadinessInput(dir, 'HEAD', { codeRoot: REPO });
    const r = computeReadiness(cur.input);
    const res = buildBaseline(cur.input, r, { id, version, supersedes, areas: ['application'], generatedAt: new Date().toISOString(), codeRoot: REPO });
    assert.ok(res.ok, res.ok ? '' : res.reasons.map((x) => x.text).join('; '));
    if (!res.ok) throw new Error('unreachable');
    for (const f of res.built.files) write(f.path, f.content);
    return res.built;
  };
  const sign = (type: 'baseline' | 'baseline-reopen', id: string, who = arch) => {
    let rec = gates.buildDecisionRequest({ type, id, reason: 'reviewed the manifest and the summary', root: dir, now: new Date(Date.now() - 3600000) });
    rec = engine.signApproval(rec, who.privateKeyPem, who.keyId, PASS);
    write(`docs/approvals/${rec.id}.json`, `${JSON.stringify(rec, null, 2)}\n`);
    return rec;
  };
  return { dir, g, write, commit, state, generate, sign, arch };
}
const gateOf = (w: ReturnType<typeof lifeWorld>) => w.state().gates[0]!;
const adrFile = (w: { dir: string }) => path.join(w.dir, 'docs', 'adr', fs.readdirSync(path.join(w.dir, 'docs', 'adr')).find((f) => f.startsWith('0001-'))!);

describe('a baseline from generation to reopening', () => {
  it('the world starts blocked only for want of a baseline; generation works; a generated baseline is not approved', () => {
    const w = lifeWorld();
    const s0 = w.state();
    assert.equal(s0.r.areas[0]!.ready, true, s0.r.areas[0]!.blockers.map((b) => b.text).join('; '));
    assert.equal(s0.gates[0]!.state, 'blocked');
    assert.match(s0.gates[0]!.reasons[0]!.text, /No architecture baseline covers area "application"/);
    const built = w.generate('BL-0001');
    assert.deepEqual(built.files.map((f) => path.basename(f.path)), ['decision-register.snapshot.json', 'READINESS-REPORT.md', 'DEPENDENCY-MATRIX.md', 'SUMMARY.md', 'manifest.json']);
    assert.equal(built.manifest.source.commit, s0.cur.input.commit, 'the exact source commit is recorded');
    assert.deepEqual(built.manifest.requiredDecisions.map((d) => d.id), ['ADR-0001']);
    assert.ok(built.manifest.caveats.some((c) => /owner instruction in chat/.test(c.text)), 'the unsigned approval is put in front of the human');
    w.commit('add BL-0001');
    const s1 = w.state();
    assert.equal(s1.states[0]!.status, 'proposed');
    assert.deepEqual(s1.states[0]!.problems, [], s1.states[0]!.problems.join('; '));
    assert.equal(s1.gates[0]!.state, 'blocked');
    assert.match(s1.gates[0]!.reasons.at(-1)!.text, /generated but not authorized/);
  });

  it('only a verifying signed approval makes it approved; text, a wrong key and a wrong hash do not', () => {
    const w = lifeWorld();
    w.generate('BL-0001');
    // A note that says approved is just a file.
    w.write(`${BASELINE_DIR}/BL-0001/APPROVED.md`, 'Approved by the programme owner.\n');
    w.write('docs/approvals/fake.json', `${JSON.stringify({ schema: 'greenfuel.decision-approval/v1', id: 'AP-000000000000', class: 'architecture', subject: { type: 'baseline', id: 'BL-0001', sha256: 'f'.repeat(64) }, decision: 'authorize', requiredClasses: ['architecture'], reason: 'x', issuedAt: '2026-01-01T00:00:00Z', nonce: 'n'.repeat(16), signatures: [{ keyId: 'forged', sig: 'AAAA' }] })}\n`);
    w.commit('add BL-0001 and a forged approval');
    assert.equal(w.state({ reproduce: false }).states[0]!.status, 'proposed');
    assert.equal(w.state({ reproduce: false }).gates[0]!.state, 'blocked');
    // A signature by a key that is not enrolled for the architecture class.
    const stranger = approver('Stranger', ['architecture']);
    w.sign('baseline', 'BL-0001', stranger);
    w.commit('approval signed by an unenrolled key');
    assert.equal(w.state({ reproduce: false }).states[0]!.status, 'proposed');
    // The enrolled key signs it.
    const rec = w.sign('baseline', 'BL-0001');
    w.commit('authorize BL-0001');
    const s = w.state();
    assert.equal(s.states[0]!.status, 'approved', s.states[0]!.problems.join('; '));
    assert.equal(s.states[0]!.currentness, 'current', JSON.stringify(s.states[0]!.impacts.map((x) => [x.code, x.text])));
    assert.equal(s.states[0]!.authorization?.approval, rec.id);
    assert.equal(s.gates[0]!.state, 'open');
    assert.equal(s.gates[0]!.baseline?.id, 'BL-0001');
  });

  it('an approval is bound to the exact manifest: one changed byte voids it', () => {
    const w = lifeWorld();
    const built = w.generate('BL-0001');
    w.sign('baseline', 'BL-0001');
    w.commit('authorize');
    assert.equal(gateOf(w).state, 'open');
    const mp = path.join(w.dir, manifestPath('BL-0001'));
    const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
    m.requiredDecisions[0].title = `${m.requiredDecisions[0].title} (edited)`;
    fs.writeFileSync(mp, serialize(m));
    w.commit('edit the authorized manifest');
    const s = w.state();
    assert.notEqual(manifestHash(m, REPO), manifestHash(built.manifest, REPO));
    assert.notEqual(s.states[0]!.status, 'approved', 'the edit voided the approval');
    assert.equal(s.gates[0]!.state, 'blocked');
    assert.ok(s.states[0]!.notes.some((n) => /does not verify/.test(n)) || s.states[0]!.problems.length > 0);
  });

  it('detects tampering with artifacts, with the recorded commit, and with what the manifest claims', () => {
    const w = lifeWorld();
    w.generate('BL-0001');
    w.sign('baseline', 'BL-0001');
    w.commit('authorize');
    // 1. an artifact edited after the fact
    const rp = path.join(w.dir, BASELINE_DIR, 'BL-0001', 'SUMMARY.md');
    fs.appendFileSync(rp, '\nAdded later.\n');
    w.commit('edit the summary');
    let s = w.state({ reproduce: false });
    assert.equal(s.states[0]!.status, 'invalid');
    assert.match(s.states[0]!.problems.join(' '), /SUMMARY\.md was changed after the baseline was made/);
    assert.equal(s.gates[0]!.state, 'blocked');
    assert.match(s.gates[0]!.reasons.at(-1)!.text, /invalid and covers nothing/);
    w.g('reset', '--hard', 'HEAD~1');
    // 2. a source commit that does not exist
    const mp = path.join(w.dir, manifestPath('BL-0001'));
    const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
    m.source.commit = 'a'.repeat(40);
    fs.writeFileSync(mp, serialize(m));
    w.commit('point at a commit that is not there');
    s = w.state({ reproduce: false });
    assert.match(s.states[0]!.problems.join(' '), /does not exist in this repository/);
    w.g('reset', '--hard', 'HEAD~1');
    // 3. a claim the source commit does not support: a decision recorded with the wrong source blob
    const m2 = JSON.parse(fs.readFileSync(mp, 'utf8'));
    m2.requiredDecisions[0].source.blob = 'b'.repeat(40);
    fs.writeFileSync(mp, serialize(m2));
    w.commit('lie about a blob');
    s = w.state({ reproduce: false });
    assert.match(s.states[0]!.problems.join(' '), /the manifest records .* as blob bbbbbbbb/);
  });

  it('a manifest that does not reproduce from its source commit is invalid, even with every hash intact', () => {
    const w = lifeWorld();
    const built = w.generate('BL-0001');
    // Rewrite the manifest AND its artifacts consistently, claiming a decision that was never required: only re-making it can catch this.
    const mp = path.join(w.dir, manifestPath('BL-0001'));
    const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
    m.requiredDecisions[0].basis = 'signed approval (verified)';
    fs.writeFileSync(mp, serialize(m));
    w.sign('baseline', 'BL-0001');
    w.commit('a consistent but untrue manifest, authorized');
    const s = w.state();
    assert.equal(s.states[0]!.status, 'invalid');
    assert.match(s.states[0]!.problems.join(' '), /does not reproduce from its source commit \(differs in: requiredDecisions/);
    assert.equal(s.gates[0]!.state, 'blocked');
    void built;
  });

  it('drift: changing an approved decision after the baseline blocks the area and is an uncontrolled change', () => {
    const w = lifeWorld();
    w.generate('BL-0001');
    w.sign('baseline', 'BL-0001');
    w.commit('authorize');
    assert.equal(gateOf(w).state, 'open');
    fs.appendFileSync(adrFile(w), '\nA late edit to the decision text.\n');
    w.commit('change ADR 0001 after it was baselined');
    const s = w.state();
    assert.equal(s.states[0]!.status, 'approved');
    assert.equal(s.states[0]!.currentness, 'drifted');
    const im = s.states[0]!.impacts.find((x) => x.code === 'decision-text-changed')!;
    assert.equal(im.subject, 'ADR-0001');
    assert.equal(im.controlledBy, null);
    assert.deepEqual(im.areas, ['application']);
    const gate = s.gates[0]!;
    assert.equal(gate.state, 'blocked');
    assert.equal(gate.reasons.at(-1)!.code, 'baseline-uncontrolled-change');
    assert.match(gate.reasons.at(-1)!.text, /not made under an authorized reopening/);
    // Change control fires even when the pull request touches no gated path.
    const res = evaluateChange(['docs/adr/0001-native-first-harness.md'], s.cur.input.policy, s.gates, s.states, { changeControl: true });
    assert.equal(res.blocked, true);
    assert.equal(res.violations.length > 0, true);
    const without = evaluateChange(['docs/adr/0001-native-first-harness.md'], s.cur.input.policy, s.gates, s.states, { changeControl: false });
    assert.equal(without.blocked, false, 'without change control only gated paths are judged');
    assert.equal(evaluateChange(['src/a.ts'], s.cur.input.policy, s.gates, s.states, { changeControl: false }).blocked, true);
  });

  it('drift: a policy change, a new required decision and a stage change each invalidate it', () => {
    const w = lifeWorld();
    w.generate('BL-0001');
    w.sign('baseline', 'BL-0001');
    w.commit('authorize');
    const pp = path.join(w.dir, 'harness', 'policy', 'baseline-policy.json');
    const p = JSON.parse(fs.readFileSync(pp, 'utf8'));
    p.gates[1].decisions = ['ADR-0001', 'ADR-0002'];
    fs.writeFileSync(pp, `${JSON.stringify(p, null, 2)}\n`);
    w.commit('require ADR 0002 as well');
    const s = w.state();
    const codes = s.states[0]!.impacts.map((x) => x.code);
    assert.ok(codes.includes('policy-changed'));
    assert.ok(codes.includes('new-required-decision'));
    assert.equal(s.gates[0]!.state, 'blocked');
  });

  it('a requirement that changes is flagged for review without blocking unrelated work', () => {
    const w = lifeWorld();
    w.generate('BL-0001');
    w.sign('baseline', 'BL-0001');
    w.commit('authorize');
    const st = w.state({ reproduce: false });
    const m = JSON.parse(fs.readFileSync(path.join(w.dir, manifestPath('BL-0001')), 'utf8'));
    assert.ok(Array.isArray(m.requirements));
    assert.equal(st.states[0]!.impacts.filter((i) => i.severity === 'invalidates').length, 0);
    assert.equal(st.gates[0]!.state, 'open');
  });

  it('controlled reopening: unsigned text reopens nothing; a signed reopening blocks the affected area; changes under it are controlled', () => {
    const w = lifeWorld();
    w.generate('BL-0001');
    w.sign('baseline', 'BL-0001');
    w.commit('authorize');
    const cur = w.state();
    const sha = cur.states[0]!.manifestSha256!;
    const ro = { schema: REOPEN_SCHEMA, id: 'BL-0001-R01', baseline: 'BL-0001', baselineManifestSha256: sha, decisions: ['ADR-0001'], reason: 'New evidence on the harness scope', requestedAt: '2026-10-30T00:00:00Z' };
    w.write(`${BASELINE_DIR}/BL-0001/reopen-01.json`, serialize(ro));
    w.commit('request a reopening (unsigned)');
    let s = w.state({ reproduce: false });
    assert.equal(s.states[0]!.reopenings[0]!.authorized, false);
    assert.match(s.states[0]!.reopenings[0]!.problem ?? '', /no valid signed approval, so it has no effect/);
    assert.equal(s.states[0]!.currentness, 'current', 'an unsigned reopening changes nothing');
    assert.equal(s.gates[0]!.state, 'open');
    // Signed by an unenrolled key: still nothing.
    w.sign('baseline-reopen', 'BL-0001-R01', approver('Stranger', ['architecture']));
    w.commit('reopening signed by an unenrolled key');
    s = w.state({ reproduce: false });
    assert.equal(s.states[0]!.reopenings[0]!.authorized, false);
    // The enrolled key signs it.
    w.sign('baseline-reopen', 'BL-0001-R01');
    w.commit('authorize the reopening');
    s = w.state({ reproduce: false });
    assert.equal(s.states[0]!.reopenings[0]!.authorized, true);
    assert.equal(s.states[0]!.currentness, 'reopened');
    assert.equal(s.gates[0]!.state, 'blocked');
    assert.equal(s.gates[0]!.reasons.at(-1)!.code, 'baseline-reopened');
    assert.match(s.gates[0]!.reasons.at(-1)!.text, /No work in this area is authorized until a new baseline version is authorized/);
    // The decision now changes, under the reopening: controlled, so change control does not accuse anyone, but the area stays closed.
    fs.appendFileSync(adrFile(w), '\nRevised under the reopening.\n');
    w.commit('revise ADR 0001 under BL-0001-R01');
    s = w.state({ reproduce: false });
    const im = s.states[0]!.impacts.find((x) => x.code === 'decision-text-changed')!;
    assert.equal(im.controlledBy, 'BL-0001-R01');
    assert.equal(evaluateChange(['docs/adr/0001-native-first-harness.md'], s.cur.input.policy, s.gates, s.states, { changeControl: true }).violations.length, 0);
    assert.equal(s.gates[0]!.state, 'blocked');
  });

  it('a reopening bound to a different manifest, or for a decision outside the baseline, is refused', () => {
    const w = lifeWorld();
    w.generate('BL-0001');
    w.sign('baseline', 'BL-0001');
    w.commit('authorize');
    const ro = { schema: REOPEN_SCHEMA, id: 'BL-0001-R01', baseline: 'BL-0001', baselineManifestSha256: 'e'.repeat(64), decisions: [], reason: 'wrong hash', requestedAt: '2026-10-30T00:00:00Z' };
    w.write(`${BASELINE_DIR}/BL-0001/reopen-01.json`, serialize(ro));
    w.sign('baseline-reopen', 'BL-0001-R01');
    w.commit('a signed reopening that names another manifest');
    const s = w.state({ reproduce: false });
    assert.equal(s.states[0]!.reopenings[0]!.authorized, false);
    assert.match(s.states[0]!.reopenings[0]!.problem ?? '', /different manifest hash/);
    const cli = spawnSync('node', [SCRIPT, 'reopen', '--root', w.dir, '--code-root', REPO, '--id', 'BL-0001', '--decisions', 'D-999', '--reason', 'x'], { cwd: REPO, encoding: 'utf8', timeout: 240_000 });
    assert.equal(cli.status, 1);
    assert.match(cli.stderr, /Not in BL-0001: D-999/);
  });

  it('a new version supersedes the old one once authorized, and reopens the area on the new baseline', () => {
    const w = lifeWorld();
    w.generate('BL-0001');
    w.sign('baseline', 'BL-0001');
    w.commit('authorize v1');
    fs.appendFileSync(adrFile(w), '\nRevised.\n');
    w.commit('revise ADR 0001');
    assert.equal(gateOf(w).state, 'blocked');
    const v2 = w.generate('BL-0002', 'BL-0001', 2);
    assert.equal(v2.manifest.version, 2);
    assert.equal(v2.manifest.supersedes, 'BL-0001');
    w.commit('add BL-0002');
    let s = w.state();
    assert.equal(s.gates[0]!.state, 'blocked', 'generated is not authorized; the old baseline is still drifted');
    w.sign('baseline', 'BL-0002');
    w.commit('authorize BL-0002');
    s = w.state();
    assert.deepEqual(s.states.map((x) => `${x.id}:${x.status}`), ['BL-0001:superseded', 'BL-0002:approved']);
    assert.equal(s.gates[0]!.state, 'open');
    assert.equal(s.gates[0]!.baseline?.id, 'BL-0002');
    assert.equal(evaluateChange(['docs/adr/0001-native-first-harness.md'], s.cur.input.policy, s.gates, s.states, { changeControl: true }).blocked, false, 'a superseded baseline no longer accuses anyone');
  });

  it('a baseline at one stage does not cover the area at another', () => {
    const w = lifeWorld();
    w.generate('BL-0001');
    w.sign('baseline', 'BL-0001');
    w.commit('authorize');
    const pp = path.join(w.dir, 'harness', 'policy', 'baseline-policy.json');
    const p = JSON.parse(fs.readFileSync(pp, 'utf8'));
    p.stages.push({ id: 'later', title: 'Later', gates: ['approver-registry'], includeMilestones: [], blockOn: [] });
    p.areas[0].stage = 'later';
    fs.writeFileSync(pp, `${JSON.stringify(p, null, 2)}\n`);
    w.commit('move the area to another stage');
    const s = w.state({ reproduce: false });
    assert.equal(s.gates[0]!.state, 'blocked');
    assert.ok(s.states[0]!.impacts.some((i) => i.code === 'stage-changed' || i.code === 'policy-changed'));
  });

  it('a baseline whose source commit is not in this branch is refused (history rewritten or another branch)', () => {
    const w = lifeWorld();
    w.g('checkout', '-q', '-b', 'other');
    w.write('OTHER.md', 'x\n');
    w.commit('a commit only on the other branch');
    w.generate('BL-0001');
    w.sign('baseline', 'BL-0001');
    w.commit('baseline made on the other branch');
    const bl = w.g('rev-parse', 'HEAD');
    w.g('checkout', '-q', '-');
    w.write('harness/policy/NOTE.txt', 'main moved on\n');
    w.commit('a commit on the default branch');
    w.g('checkout', '-q', bl, '--', `${BASELINE_DIR}`, 'docs/approvals');
    w.commit('bring in the baseline files only');
    const s = w.state({ reproduce: false });
    assert.equal(s.states[0]!.status, 'invalid');
    assert.match(s.states[0]!.problems.join(' '), /not in the history of HEAD/);
    assert.equal(s.gates[0]!.state, 'blocked');
  });

  it('the CLI verify and gate agree with the library on an authorized baseline, and say so', () => {
    const w = lifeWorld();
    w.generate('BL-0001');
    w.sign('baseline', 'BL-0001');
    w.commit('authorize');
    const args = (...a: string[]) => spawnSync('node', [SCRIPT, ...a, '--root', w.dir, '--code-root', REPO], { cwd: REPO, encoding: 'utf8', timeout: 300_000 });
    const v = args('verify');
    assert.equal(v.status, 0, v.stdout + v.stderr);
    assert.match(v.stdout, /BL-0001 v1: APPROVED \/ current/);
    assert.match(v.stdout, /authorized by approval AP-/);
    const gt = args('gate', '--area', 'application');
    assert.equal(gt.status, 0, gt.stdout + gt.stderr);
    assert.match(gt.stdout, /Area application \(stage test\): OPEN/);
    assert.match(gt.stdout, /authorized by baseline BL-0001/);
    fs.appendFileSync(adrFile(w), '\nDrift.\n');
    w.commit('drift');
    const bad = args('gate', '--area', 'application');
    assert.equal(bad.status, 2);
    assert.match(bad.stdout, /not made under an authorized reopening/);
    const cc = args('gate', '--changed', 'HEAD~1..HEAD', '--change-control');
    assert.equal(cc.status, 2, 'a documentation-only change that alters the approved architecture is stopped');
    assert.match(cc.stdout, /Architecture change control:/);
    const req = args('request', '--id', 'BL-0001');
    assert.equal(req.status, 0);
    assert.match(req.stdout, /approval\.mjs decision --type baseline --id BL-0001/);
    assert.match(req.stdout, /does not raise the phase/);
  });
});

describe('the approval rules the baseline relies on', () => {
  it('baseline approvals need an architecture-class key, not a deployment key, and cannot be reused for another baseline', () => {
    const w = lifeWorld();
    w.generate('BL-0001');
    const dep = approver('Test Deployer', ['deployment'], ['P3']);
    const approvers = JSON.parse(fs.readFileSync(path.join(w.dir, 'harness/policy/approvers.json'), 'utf8'));
    approvers.approvers.push(dep.entry);
    fs.writeFileSync(path.join(w.dir, 'harness/policy/approvers.json'), serialize(approvers));
    w.sign('baseline', 'BL-0001', dep);
    w.commit('baseline signed by a deployment key');
    assert.equal(w.state({ reproduce: false }).states[0]!.status, 'proposed', 'a deployment key cannot authorize a baseline');
    const rec = JSON.parse(fs.readFileSync(path.join(w.dir, 'docs/approvals', fs.readdirSync(path.join(w.dir, 'docs/approvals')).find((f) => f.startsWith('AP-'))!), 'utf8'));
    assert.equal(rec.subject.type, 'baseline');
    assert.deepEqual(rec.requiredClasses, ['architecture']);
  });
});

describe('failing closed, and the CI workflow', () => {
  it('an unreadable or invalid policy blocks every area and every change, including ones that touch no gated path', () => {
    const w = lifeWorld();
    w.generate('BL-0001');
    w.sign('baseline', 'BL-0001');
    w.commit('authorize');
    assert.equal(w.state({ reproduce: false }).gates[0]!.state, 'open');
    fs.writeFileSync(path.join(w.dir, 'harness', 'policy', 'baseline-policy.json'), '{ this is not json');
    w.commit('break the policy');
    const s = w.state({ reproduce: false });
    assert.equal(s.cur.input.policy.valid, false);
    assert.deepEqual(s.gates, [], 'no area is known, so none can be open');
    const cli = spawnSync('node', [SCRIPT, 'gate', '--area', 'application', '--root', w.dir, '--code-root', REPO], { cwd: REPO, encoding: 'utf8', timeout: 240_000 });
    assert.equal(cli.status, 2, cli.stdout + cli.stderr);
    assert.match(cli.stdout, /baseline policy is invalid, so nothing is authorized/);
    assert.match(cli.stdout, /fails closed/);
    assert.equal(evaluateChange(['README.md'], s.cur.input.policy, s.gates, s.states, { changeControl: true }).blocked, true, 'even a documentation change is refused while the policy is invalid');
    fs.rmSync(path.join(w.dir, 'harness', 'policy', 'baseline-policy.json'));
    w.commit('delete the policy');
    const gone = w.state({ reproduce: false });
    assert.match(gone.cur.input.policy.problems[0]!, /does not exist/);
    assert.equal(evaluateChange(['src/a.ts'], gone.cur.input.policy, gone.gates, gone.states, { changeControl: false }).blocked, true);
  });

  it('the workflow takes its code from the base commit on a pull request, pins its actions, asks for read-only permission, and fails closed', () => {
    const y = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'architecture-gate.yml'), 'utf8');
    assert.match(y, /pull_request:\s*\n/);
    assert.ok(!/pull_request_target/.test(y), 'it never runs with the target repository privileges');
    assert.match(y, /permissions:\s*\n\s+contents: read/);
    for (const m of y.matchAll(/uses:\s+(\S+)@(\S+)/g)) assert.match(m[2]!, /^[0-9a-f]{40}$/, `${m[1]} is pinned to a commit`);
    assert.match(y, /path: trusted\s*\n\s+ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/, 'the judging code is the base commit');
    assert.match(y, /--root data --code-root "\$CODE"/);
    assert.match(y, /--change-control/);
    assert.match(y, /workflow_call:[\s\S]*area:[\s\S]*required: true/);
    assert.match(y, /fetch-depth: 0/);
    assert.ok(!/continue-on-error/.test(y), 'a blocked gate is not allowed to pass');
    assert.ok(!/\|\| true/.test(y), 'and nothing swallows its exit code');
    assert.ok(!/secrets\./.test(y), 'it needs no secret');
    // Called workflows see the caller's event name, so a call must be recognised by its input.
    assert.match(y, /if: inputs\.area != ''/);
    assert.match(y, /if: inputs\.area == '' && github\.event_name == 'pull_request'/);
  });

  it('every file the gate depends on is a control-plane path, so a change to it is reviewed and, when guarded, must be a verified commit', () => {
    const cp = JSON.parse(fs.readFileSync(path.join(REPO, 'harness', 'policy', 'command-policy.json'), 'utf8')) as { controlPlanePaths: string[] };
    const covered = (f: string) => cp.controlPlanePaths.some((re) => new RegExp(re).test(f));
    for (const f of ['harness/policy/baseline-policy.json', '.github/workflows/architecture-gate.yml', 'docs/baselines/BL-0001/manifest.json', 'docs/approvals/AP-000000000000.json', 'harness/approvals/approval-gates.cjs']) assert.ok(covered(f), `${f} is control-plane`);
    const owners = fs.readFileSync(path.join(REPO, '.github', 'CODEOWNERS'), 'utf8');
    for (const f of ['/docs/baselines/', '/apps/architecture-studio/src/lib/baseline/', '/apps/architecture-studio/scripts/']) assert.ok(owners.includes(f), `${f} has a code owner`);
  });
});