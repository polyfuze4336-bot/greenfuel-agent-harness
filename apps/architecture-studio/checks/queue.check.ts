import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { buildModel } from '../src/lib/repo/build.ts';
import { GitRepositoryAdapter } from '../src/lib/repo/git.ts';
import { deriveWork, extractRefs, SOURCE_PATHS } from '../src/lib/queue/derive.ts';
import { BUILD_ID, analyseBuild, applyDecisionEffects, buildGraph, decisionsImpactedBy, dependentsOf, flagRequirementImpact, impactOf, requirementChanges, requiresClosure, type ReqLike } from '../src/lib/queue/graph.ts';
import { layoutColumns } from '../src/lib/queue/layout.ts';
import { applyWorkOverlay } from '../src/lib/queue/overlay.ts';
import { buildQueue } from '../src/lib/queue/snapshot.ts';
import { explicitDueDate, isFullyFixed, parseBacklog, parseGaps, parseRubric, parseSecurity, parseValidation } from '../src/lib/queue/sources.ts';
import type { Edge, WorkItem } from '../src/lib/queue/types.ts';
import { countViews, inView, mineReason } from '../src/lib/queue/views.ts';
import { GitHubError, LocalGitHub } from '../src/lib/workflow/github.ts';
import { FixtureIdentity, type VerifiedUser } from '../src/lib/workflow/identity.ts';
import { GitPublisher } from '../src/lib/workflow/publish.ts';
import { ReviewService, ServiceError, type ServiceDeps } from '../src/lib/workflow/review.ts';
import { parsePolicy } from '../src/lib/workflow/rules.ts';
import { ReviewStore } from '../src/lib/workflow/store.ts';
import { WorkService, loadWorkStates, type WorkContext } from '../src/lib/workflow/work.ts';
import { WORK_ACTIONS, applyWorkEvent, emptyWorkState, foldWorkEvents, hashWorkEvent, parseWorkEvent, serializeWorkEvent, workEventId, workPermittedIn, type WorkAction, type WorkEvent, type WorkState } from '../src/lib/workflow/work-events.ts';
import { validateWorkRequest, workAvailability } from '../src/lib/workflow/work-rules.ts';
import { parseAccessPolicy } from '../src/lib/auth/access-policy.ts';
import { authorizeWork, type Principal } from '../src/lib/auth/authorize.ts';
import { USERS, git, installTestAuth, makeFixture, policyJson, subjectOf, type Fixture } from './fixtures/review-fixture.ts';

const fixtures: Fixture[] = [];
after(() => {
  for (const f of fixtures) f.cleanup();
});

const root = GitRepositoryAdapter.findRoot(process.cwd());
const adapter = new GitRepositoryAdapter(root, 'HEAD').open();
const model = buildModel(adapter);
const derived = deriveWork({ model, read: (p) => adapter.read(p), exists: (p) => adapter.has(p) });

function item(over: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    kind: 'task', class: 'engineering', title: over.id, description: '', priority: null, priorityBasis: null, critical: false, criticalBasis: null, status: 'Open', sourceStatus: null, statusBasis: '', ownerText: null, ownerRoles: [], assignee: null,
    source: { path: 'docs/state/TODO.md', line: 1 }, relatedDecisions: [], relatedRequirements: [], relatedRisks: [], rubricCriteria: [], links: [], acceptance: null, evidenceRequired: null, dueDate: null, completionEvidence: [], approval: null,
    derivedBlocks: [], reviewNeeded: [], flags: [], missing: [], blocksBuild: false, milestone: null, mode: [], contentHash: `h-${over.id}`, ...over,
  } as WorkItem;
}
const req = (from: string, to: string): Edge => ({ from, to, type: 'requires', basis: 'test' });
const ref = (from: string, to: string): Edge => ({ from, to, type: 'references', basis: 'test' });

// ---------------------------------------------------------------- sources

describe('source parsers', () => {
  it('read the real documents completely', () => {
    const read = (p: string) => adapter.read(p) ?? '';
    assert.equal(parseGaps(read(SOURCE_PATHS.gaps)).length, 24);
    assert.equal(parseBacklog(read(SOURCE_PATHS.backlog)).length, 16);
    assert.equal(parseRubric(read(SOURCE_PATHS.rubric)).length, 20);
    assert.equal(parseValidation(read(SOURCE_PATHS.validation)).length, 12);
    const s = parseSecurity(read(SOURCE_PATHS.security));
    assert.equal(s.findings.length, 20);
    assert.equal(s.open.length, 6);
  });

  it('keep fields apart and never guess', () => {
    const g = parseGaps('| ID | Gap |\n|---|---|\n| G-01 | **No slice.** Detail here | Critical | A4, B3 | Audit 2.11 | build, owner | B-01, B-02 |\n');
    assert.deepEqual({ ...g[0]!, line: 0, text: '' }, { id: 'G-01', title: 'No slice', text: '', severity: 'Critical', criteria: ['A4', 'B3'], evidence: 'Audit 2.11', modes: ['build', 'owner'], closedBy: ['B-01', 'B-02'], line: 0 });
    const b = parseBacklog('### B-09 Artifact (P0, owner, publish)\n- **Criteria:** D1\n- **Dependencies:** B-02, T3\n\n## Next\n- **Criteria:** X\n');
    assert.equal(b.length, 1);
    assert.equal(b[0]!.priority, 'P0');
    assert.deepEqual(b[0]!.modes, ['owner', 'publish']);
    assert.equal(b[0]!.fields.dependencies?.text, 'B-02, T3');
    assert.equal(b[0]!.fields.criteria?.text, 'D1', 'a bullet after the next heading is not attached');
  });

  it('count a security finding as fully fixed only when no limit is marked', () => {
    assert.equal(isFullyFixed('Fixed', 'Own-key schema check'), true);
    assert.equal(isFullyFixed('**Partly fixed**', 'Pattern based'), false);
    assert.equal(isFullyFixed('Fixed', 'Done. **Approver enrollment is not modelled**'), false);
    assert.equal(isFullyFixed('Fixed in the oracle', '**limit**'), false);
    const s = parseSecurity(adapter.read(SOURCE_PATHS.security) ?? '').findings;
    assert.equal(s.find((f) => f.id === 'SF-05')!.fullyFixed, false, 'partly fixed in the review');
    assert.equal(s.find((f) => f.id === 'SF-01')!.fullyFixed, true);
  });

  it('read a due date only when one is written', () => {
    assert.equal(explicitDueDate('Due 2026-11-03 for the panel'), '2026-11-03');
    assert.equal(explicitDueDate('deadline: 2026-12-01'), '2026-12-01');
    assert.equal(explicitDueDate('due two weeks before the panel'), null);
    assert.equal(explicitDueDate('Deferred by the owner 2026-10-29'), null, 'a date is not a due date');
  });
});

describe('references', () => {
  it('make a dependency "requires" only when the wording says so, and before the id', () => {
    const r = new Map(extractRefs('Still needs the owner sign-in and D-037. Answer D-009; needs counsel. See ADR 0004 for context.').map((x) => [x.id, x.type]));
    assert.equal(r.get('D-037'), 'requires');
    assert.equal(r.get('D-009'), 'references', 'the dependency word comes after the id');
    assert.equal(r.get('ADR-0004'), 'references');
    assert.equal(extractRefs('Blocked by T14 until it lands').find((x) => x.id === 'T14')!.type, 'requires');
    assert.equal(extractRefs('G-5 and CL-15 are the review’s own numbering').length, 0, 'unrecognised ids are not invented into links');
  });
});

// ---------------------------------------------------------------- real repository

describe('the queue derived from this repository', () => {
  const byId = new Map(derived.items.map((i) => [i.id, i]));

  it('has one item per source row, with unique ids', () => {
    assert.equal(derived.items.length, new Set(derived.items.map((i) => i.id)).size);
    const n = (k: WorkItem['kind']) => derived.items.filter((i) => i.kind === k).length;
    assert.equal(n('task'), model.tasks.filter((t) => t.family === 'owner-todo').length);
    assert.equal(n('roadmap'), model.tasks.filter((t) => t.family === 'roadmap').length);
    assert.equal(n('decision'), model.register.records.length);
    assert.equal(n('risk'), model.risks.length);
    assert.equal(n('design-gate'), model.reviews.length);
    assert.equal(n('build-blocker'), model.blockers.length);
    assert.equal(n('backlog'), 16);
    assert.equal(n('gap'), 24);
    assert.equal(n('rubric'), 20);
    assert.equal(n('validation'), 12);
    assert.equal(n('security'), 26);
    assert.equal(n('requirement-gap'), model.requirements.filter((r) => r.openClarifications.length || r.verifyClaims.length).length);
  });

  it('links every item to an authoritative file and line, and the line names the item', () => {
    const idLine = (i: WorkItem) => {
      switch (i.kind) {
        case 'decision':
          return [i.id, i.id.replace('ADR-', 'ADR ')];
        case 'rubric':
          return [i.id.replace('RC-', '')];
        case 'requirement-gap':
          return [i.id.replace('RG-', '')];
        default:
          return [i.id];
      }
    };
    const loose = new Set(['security', 'build-blocker']);
    const bad: string[] = [];
    for (const i of derived.items) {
      if (!adapter.has(i.source.path)) {
        bad.push(`${i.id}: ${i.source.path} does not exist`);
        continue;
      }
      const lines = (adapter.read(i.source.path) ?? '').split('\n');
      if (i.source.line < 1 || i.source.line > lines.length) bad.push(`${i.id}: line ${i.source.line} out of range`);
      else if (!loose.has(i.kind) && !idLine(i).some((x) => lines[i.source.line - 1]!.includes(x))) bad.push(`${i.id}: line ${i.source.line} of ${i.source.path} does not name it`);
    }
    assert.deepEqual(bad, []);
  });

  it('invents no due date, no completion, and no status', () => {
    assert.equal(derived.items.filter((i) => i.dueDate).length, 0, 'no source states a due date');
    for (const i of derived.items) if (i.status === 'Done') assert.ok(i.completionEvidence.some((e) => e.valid), `${i.id} is Done without valid evidence`);
    for (const i of derived.items.filter((x) => x.status === 'Closed, no evidence')) assert.equal(i.completionEvidence.filter((e) => e.valid).length, 0, i.id);
    for (const i of derived.items) assert.equal(i.assignee, null, 'no assignment exists without a merged record');
    // an unmarked roadmap row stays unmarked
    assert.equal(byId.get('R1')!.status, 'Unmarked');
  });

  it('only counts evidence that exists and succeeded', () => {
    const failing = model.evidence.runs.find((r) => r.exitCode !== 0);
    assert.ok(failing, 'the repository records at least one failing run');
    const t = item({ id: 'TX' });
    void t;
    const d = deriveWork({ model: { ...model, tasks: [{ ...model.tasks[0]!, id: 'T900', status: 'done', statusRecorded: true, detail: `Finished. ${failing!.id}` }] }, read: () => undefined, exists: () => false });
    const x = d.items.find((i) => i.id === 'T900')!;
    assert.equal(x.status, 'Closed, no evidence', 'a failed run does not show completion');
    assert.equal(x.completionEvidence[0]!.valid, false);
    const good = model.evidence.runs.find((r) => r.exitCode === 0)!;
    const d2 = deriveWork({ model: { ...model, tasks: [{ ...model.tasks[0]!, id: 'T901', status: 'done', statusRecorded: true, detail: `Finished. ${good.id}` }] }, read: () => undefined, exists: () => false });
    assert.equal(d2.items.find((i) => i.id === 'T901')!.status, 'Done');
  });

  it('keeps rubric criteria apart from engineering work, and classifies by mode', () => {
    const rubric = derived.items.filter((i) => i.kind === 'rubric');
    assert.ok(rubric.every((i) => i.class === 'evidence-gap'));
    assert.equal(derived.items.filter((i) => i.class === 'evidence-gap' && i.kind !== 'rubric').every((i) => i.mode[0] === 'live' || i.mode[0] === 'publish'), true);
    assert.equal(byId.get('B-04')!.class, 'engineering');
    assert.equal(byId.get('B-02')!.class, 'decision', 'owner first');
    assert.equal(byId.get('B-15')!.class, 'evidence-gap', 'rehearsal is evidence only a live session can give');
    assert.deepEqual(byId.get('RC-A4')!.links.filter((l) => l.type === 'requires').map((l) => l.id), ['B-01']);
  });

  it('records dependencies only from the sources, with their basis', () => {
    assert.ok(byId.get('G-01')!.links.some((l) => l.id === 'B-01' && l.type === 'requires'), 'a gap is closed by its backlog item');
    assert.ok(byId.get('B-01')!.links.some((l) => l.id === 'B-02' && l.type === 'requires'), 'the backlog dependencies field');
    assert.ok(byId.get('RV-0001')!.links.every((l) => l.type === 'requires'));
    assert.ok(derived.unresolved.length < 10 && derived.unresolved.every((u) => !derived.items.some((i) => i.id === u.ref)));
    for (const e of derived.edges) assert.ok(e.basis.length > 0);
  });

  it('shows what is missing instead of filling it', () => {
    const risks = derived.items.filter((i) => i.kind === 'risk');
    assert.ok(risks.every((r) => r.acceptance && r.ownerText), 'risks carry a mitigation and an owner role');
    const t = byId.get('T14')!;
    assert.ok(t.missing.includes('priority') && t.missing.includes('acceptance'));
    assert.equal(t.priority, null);
  });

  it('puts the repository blockers on the path to the build', () => {
    const g = buildGraph(derived.items, derived.edges, derived.refNodes);
    const a = analyseBuild(g);
    assert.equal(g.cycles.length, 0, 'no dependency cycle in the repository');
    for (const b of model.blockers) assert.ok(a.blockers.some((x) => x.id === b.id), b.id);
    assert.ok(a.ready.length > 0);
    assert.ok(a.ready.every((r) => r.waitingFor.length === 0));
    assert.ok(a.blockers.every((b) => b.waitingFor.every((w) => a.blockers.some((x) => x.id === w))));
    assert.ok(a.blockers.find((b) => b.id === 'BLK-2')!.waitingFor.includes('BLK-1'), 'raising the phase waits for an approver');
  });
});

// ---------------------------------------------------------------- views

describe('views', () => {
  const items = [
    item({ id: 'A', status: 'Open', assignee: 'me', ownerRoles: [] }),
    item({ id: 'B', status: 'Open', ownerRoles: ['quality-manager'] }),
    item({ id: 'C', status: 'Open', ownerRoles: ['quality-manager'], assignee: 'someone' }),
    item({ id: 'D', status: 'Blocked' }),
    item({ id: 'E', status: 'Open', derivedBlocks: [{ by: 'D-1', reason: 'x' }] }),
    item({ id: 'F', kind: 'risk', critical: true, status: 'Open' }),
    item({ id: 'G', kind: 'decision', critical: true, status: 'Open', approval: { kind: 'decision', by: 'x', state: 'Proposed' } }),
    item({ id: 'H', status: 'Done' }),
    item({ id: 'I', status: 'Closed, no evidence' }),
    item({ id: 'J', status: 'Rejected' }),
    item({ id: 'K', kind: 'rubric', class: 'evidence-gap' }),
    item({ id: 'L', kind: 'gap', status: 'Open' }),
  ];
  const me = { login: 'Me', roles: ['quality-manager'] };
  it('assign each item to the views its rules say, and rubric criteria to their own', () => {
    const ids = (v: Parameters<typeof inView>[1]) => items.filter((i) => inView(i, v, me)).map((i) => i.id);
    assert.deepEqual(ids('all'), 'ABCDEFGHIJL'.split(''));
    assert.deepEqual(ids('evidence'), ['K']);
    assert.deepEqual(ids('mine'), ['A', 'B'], 'assigned to me, or unassigned and naming my role');
    assert.deepEqual(ids('blocked'), ['D', 'E']);
    assert.deepEqual(ids('critical'), ['F'], 'a critical decision is a pending approval, not a critical risk');
    assert.deepEqual(ids('approvals'), ['G']);
    assert.deepEqual(ids('completed'), ['H', 'I']);
    assert.deepEqual(ids('rejected'), ['J']);
    assert.deepEqual(ids('gaps'), ['L']);
    assert.equal(mineReason(items[0]!, me), 'assigned');
    assert.equal(mineReason(items[1]!, me), 'role');
    assert.equal(mineReason(items[1]!, null), null, 'nothing is mine without an identity');
    assert.equal(countViews(items).mine, 0);
  });
});

// ---------------------------------------------------------------- graph and impact rules

describe('dependency graph', () => {
  const items = [item({ id: 'D-1', kind: 'decision', status: 'Open' }), item({ id: 'T1' }), item({ id: 'T2' }), item({ id: 'T3' }), item({ id: 'T4' }), item({ id: 'BLK-1', kind: 'build-blocker', status: 'Blocked' })];
  const edges = [req('T1', 'D-1'), req('T2', 'T1'), ref('T3', 'D-1'), ref('T4', 'T3'), req('BLK-1', 'T2')];
  const g = buildGraph(items, edges);

  it('follows requires transitively and references only one step', () => {
    const d = dependentsOf(g, 'D-1');
    assert.deepEqual(d.map((x) => `${x.id}:${x.type}:${x.depth}`), ['T1:requires:1', 'T2:requires:2', 'BLK-1:requires:3', 'T3:references:1']);
    assert.ok(!d.some((x) => x.id === 'T4'), 'a mention of a mention is not a dependency');
    assert.deepEqual([...requiresClosure(g, 'T2')], ['T1', 'D-1']);
  });

  it('finds the work blocking the build, what can start now, and what each unlocks', () => {
    const a = analyseBuild(g);
    assert.deepEqual(a.blockers.map((b) => b.id), ['BLK-1', 'T2', 'T1', 'D-1']);
    assert.deepEqual(a.ready.map((b) => b.id), ['D-1']);
    assert.equal(a.ready[0]!.unlocks, 3);
    assert.equal(a.blockers.find((b) => b.id === 'T2')!.depth, 2);
  });

  it('drops resolved work from the chain, but not a claim of closure without evidence', () => {
    const done = items.map((i) => (i.id === 'T1' ? { ...i, status: 'Done' as const } : i.id === 'T2' ? { ...i, status: 'Closed, no evidence' as const } : i));
    const a = analyseBuild(buildGraph(done, edges));
    assert.ok(!a.blockers.some((b) => b.id === 'T1'));
    assert.ok(a.blockers.some((b) => b.id === 'T2'), 'closed without evidence still blocks');
    assert.deepEqual(a.ready.map((b) => b.id), ['T2'], 'T2 is now the first thing to prove');
  });

  it('reports a cycle and still finishes', () => {
    const c = buildGraph([item({ id: 'T1' }), item({ id: 'T2' }), item({ id: 'BLK-1', kind: 'build-blocker', status: 'Blocked' })], [req('T1', 'T2'), req('T2', 'T1'), req('BLK-1', 'T1')]);
    assert.equal(c.cycles.length, 1);
    assert.ok(analyseBuild(c).blockers.length >= 2);
    assert.equal(dependentsOf(c, 'T1').length, 2);
  });

  it('lays the chain out in columns, deterministically', () => {
    const a = analyseBuild(g);
    const nodes = [...a.blockers.map((b) => ({ id: b.id, depth: b.depth, unlocks: b.unlocks })), { id: BUILD_ID, depth: 0, unlocks: 0 }];
    const l1 = layoutColumns(nodes);
    const l2 = layoutColumns([...nodes].reverse());
    assert.deepEqual(l1.nodes.sort((x, y) => x.id.localeCompare(y.id)), l2.nodes.sort((x, y) => x.id.localeCompare(y.id)));
    assert.equal(l1.nodes.find((n) => n.id === BUILD_ID)!.x, Math.max(...l1.nodes.map((n) => n.x)), 'the build is the rightmost column');
  });
});

describe('impact rules', () => {
  const base = () => [
    item({ id: 'D-1', kind: 'decision', status: 'Rejected', critical: true }),
    item({ id: 'D-2', kind: 'decision', status: 'Deferred', critical: true }),
    item({ id: 'D-3', kind: 'decision', status: 'Deferred', critical: false }),
    item({ id: 'R1', kind: 'roadmap', status: 'Open' }),
    item({ id: 'R2', kind: 'roadmap', status: 'Unmarked' }),
    item({ id: 'B-1', kind: 'backlog', status: 'Open' }),
    item({ id: 'T9', kind: 'task', status: 'Open' }),
    item({ id: 'T10', kind: 'task', status: 'Done' }),
    item({ id: 'T11', kind: 'task', status: 'Open' }),
    item({ id: 'U1', kind: 'task', status: 'Open' }),
    item({ id: 'RV-1', kind: 'design-gate', status: 'Blocked' }),
  ];
  const edges = [req('R1', 'D-1'), req('B-1', 'R1'), ref('T9', 'D-1'), req('T10', 'D-1'), req('RV-1', 'D-1'), req('R2', 'D-2'), req('B-1', 'D-2'), ref('T11', 'D-2'), req('T9', 'D-3'), ref('U1', 'T11')];

  it('rejected decision: flags what requires it and what mentions it, changes no status, touches nothing else', () => {
    const items = base();
    const g = buildGraph(items, edges);
    const { items: out, impacts } = applyDecisionEffects(items, g, [{ decisionId: 'D-1', status: 'Rejected', critical: true }]);
    const flagged = out.filter((i) => i.reviewNeeded.length).map((i) => i.id).sort();
    assert.deepEqual(flagged, ['B-1', 'R1', 'RV-1', 'T10', 'T9'].sort());
    for (const i of out) assert.equal(i.status, items.find((x) => x.id === i.id)!.status, `${i.id} keeps its status`);
    assert.equal(out.find((i) => i.id === 'U1')!.reviewNeeded.length, 0, 'unrelated work is untouched');
    assert.equal(out.find((i) => i.id === 'T11')!.reviewNeeded.length, 0, 'a different decision is not involved');
    assert.deepEqual(impacts[0]!.designGates, ['RV-1']);
    assert.deepEqual(impacts[0]!.requiring.map((x) => x.id).sort(), ['B-1', 'R1', 'RV-1', 'T10'].sort());
    assert.deepEqual(impacts[0]!.mentioning.map((x) => x.id), ['T9']);
  });

  it('critical decision deferred: work that requires it stays blocked, with the reason', () => {
    const items = base();
    const g = buildGraph(items, edges);
    const { items: out, impacts } = applyDecisionEffects(items, g, [{ decisionId: 'D-2', status: 'Deferred', critical: true }]);
    const by = (id: string) => out.find((i) => i.id === id)!;
    assert.equal(by('R2').status, 'Blocked');
    assert.equal(by('B-1').status, 'Blocked');
    assert.deepEqual(by('R2').derivedBlocks.map((d) => d.by), ['D-2']);
    assert.equal(by('T11').status, 'Open', 'mentioning is not requiring');
    assert.equal(by('U1').status, 'Open');
    assert.deepEqual(impacts[0]!.mustRemainBlocked.sort(), ['B-1', 'R2']);
  });

  it('deferral of a decision that is not critical changes nothing', () => {
    const items = base();
    const g = buildGraph(items, edges);
    const { items: out, impacts } = applyDecisionEffects(items, g, [{ decisionId: 'D-3', status: 'Deferred', critical: false }]);
    assert.deepEqual(out, items);
    assert.equal(impacts.length, 0);
  });

  it('leaves finished work alone', () => {
    const items = base();
    const g = buildGraph(items, [req('T10', 'D-2'), req('R2', 'D-2')]);
    const { items: out } = applyDecisionEffects(items, g, [{ decisionId: 'D-2', status: 'Deferred', critical: true }]);
    assert.equal(out.find((i) => i.id === 'T10')!.status, 'Done');
    assert.equal(out.find((i) => i.id === 'T10')!.derivedBlocks.length, 0);
  });

  it('impactOf reports requirements and artefacts for a decision', () => {
    const items = [item({ id: 'D-1', kind: 'decision', relatedRequirements: ['NFR-004'] }), item({ id: 'RG-NFR-004', kind: 'requirement-gap' })];
    const g = buildGraph(items, [req('RG-NFR-004', 'D-1')]);
    const r = impactOf({ graph: g, items: new Map(items.map((i) => [i.id, i])), artefactsFor: () => [{ path: 'docs/architecture/designs/DES-0001.md', area: 'design', authority: 'authoritative' }] }, 'D-1', 'rejected');
    assert.deepEqual(r.requirements, ['NFR-004']);
    assert.equal(r.artefacts.length, 1);
  });
});

describe('requirement changes', () => {
  const r = (id: string, over: Partial<ReqLike> = {}): ReqLike => ({ id, title: id, priority: 'Must', cls: 'A', justification: 'j', acceptance: 'a', validation: 'v', evidenceRequired: 'e', decisions: [], dependsOn: [], openClarifications: [], verifyClaims: [], ...over });
  const before = [r('NFR-001'), r('NFR-002'), r('NFR-003', { decisions: ['D-5'] }), r('SEC-001')];
  const after = [r('NFR-001', { acceptance: 'changed' }), r('NFR-002'), r('NFR-003', { decisions: ['D-5'], priority: 'Should' }), r('NFR-009')];

  it('detects added, removed and changed requirements by field', () => {
    assert.deepEqual(requirementChanges(before, after), [
      { id: 'NFR-001', change: 'changed', fields: ['acceptance'] },
      { id: 'NFR-003', change: 'changed', fields: ['priority'] },
      { id: 'NFR-009', change: 'added', fields: [] },
      { id: 'SEC-001', change: 'removed', fields: [] },
    ]);
    assert.deepEqual(requirementChanges(before, before), []);
  });

  it('flags only the decisions a changed requirement directly touches, and changes no status', () => {
    const changes = requirementChanges(before, after);
    const decisions = [{ id: 'D-1', relatedRequirements: ['NFR-001'] }, { id: 'D-5', relatedRequirements: [] }, { id: 'D-7', relatedRequirements: ['NFR-002'] }, { id: 'D-8', relatedRequirements: [] }];
    const impacted = decisionsImpactedBy(changes, after, decisions);
    assert.deepEqual([...impacted.keys()].sort(), ['D-1', 'D-5'], 'D-1 lists NFR-001; the changed NFR-003 lists D-5; NFR-002 did not change');
    const items = [item({ id: 'D-1', kind: 'decision', status: 'Done' }), item({ id: 'D-5', kind: 'decision' }), item({ id: 'D-7', kind: 'decision' }), item({ id: 'T1' })];
    const out = flagRequirementImpact(items, impacted, changes);
    assert.deepEqual(out.filter((i) => i.reviewNeeded.length).map((i) => i.id), ['D-1', 'D-5']);
    assert.equal(out.find((i) => i.id === 'D-1')!.status, 'Done', 'an approved decision stays approved; it is only flagged');
    assert.equal(out.find((i) => i.id === 'T1')!.reviewNeeded.length, 0);
  });
});

describe('the whole snapshot', () => {
  const snap = buildQueue(model, adapter, { work: new Map(), roleAliases: { 'programme-owner': ['programme owner'] }, completionRoles: ['programme-owner'], canonicalRef: 'origin/main' });
  it('counts each view from the same rules, marks build blockers, and loses nothing', () => {
    assert.equal(snap.items.length, derived.items.length);
    const evidenceGaps = derived.items.filter((i) => i.class === 'evidence-gap').length;
    assert.equal(evidenceGaps, 21, '20 rubric criteria and one backlog item that only a live session can evidence (B-15)');
    assert.equal(snap.counts.evidence, evidenceGaps);
    assert.equal(snap.counts.all, snap.items.length - evidenceGaps);
    assert.ok(snap.items.filter((i) => i.blocksBuild).length === snap.blocking.analysis.blockers.length);
    assert.ok(snap.blocking.nodes.some((n) => n.id === BUILD_ID));
    assert.equal(snap.impacts.length, 0, 'no decision is rejected or critical-deferred in the repository today');
    assert.deepEqual(snap.workProblems, []);
  });
});

// ---------------------------------------------------------------- work-item events and rules

const auth = installTestAuth();
const owner = { login: 'test-owner', githubId: 1001, name: 'Test Owner', verifiedBy: 'test-fixture' as const, provider: 'github' as const, subject: '1001', tenantId: null };
function ev(itemId: string, seq: number, action: WorkAction, prev: string | null, over: Partial<WorkEvent> = {}): WorkEvent {
  const body = {
    schema: 'greenfuel.work-item-event/v2' as const, id: workEventId(itemId, seq), itemId, seq, action, actor: owner, createdAt: new Date(Date.UTC(2026, 9, 30, 1, seq)).toISOString(),
    basis: { itemHash: 'h', sourceStatus: 'x', sourcePath: 'docs/state/TODO.md' }, prevHash: prev, assignee: null, priority: null, dueDate: null, rationale: null, comment: null, evidence: [], blockedBy: [],
    roleCheck: { critical: false, required: [], held: ['architecture-owner'], namedRoles: [], outstanding: [], policySource: 'canonical' as const, domain: 'architecture', policyHash: '', checks: [], authAgeSeconds: 0, mfa: false }, ...over,
  };
  const eventHash = hashWorkEvent(body);
  return { ...body, eventHash, signature: auth.signer.sign(eventHash) } as WorkEvent;
}
function chain(itemId: string, steps: [WorkAction, Partial<WorkEvent>?][]): WorkState {
  let s = emptyWorkState(itemId);
  for (const [i, [a, o]] of steps.entries()) {
    const r = applyWorkEvent(s, ev(itemId, i + 1, a, s.headHash, o));
    assert.ok(!('error' in r), `${a}: ${'error' in r ? r.error : ''}`);
    s = r as WorkState;
  }
  return s;
}

describe('work-item state machine', () => {
  it('walks the completion lifecycle, and Done exists only after approval', () => {
    let s = chain('T1', [['assign', { assignee: 'test-owner' }], ['submit-for-review', { evidence: ['EV-0001'] }]]);
    assert.equal(s.phase, 'in-review');
    assert.equal(s.submittedBy, 'test-owner');
    assert.equal(s.completedBy, null);
    s = chain('T1', [['submit-for-review', { evidence: ['EV-0001'] }], ['approve-completion']]);
    assert.equal(s.phase, 'completed');
    assert.equal(s.completedBy?.action, 'approve-completion');
    s = chain('T1', [['submit-for-review', { evidence: ['EV-0001'] }], ['reject-completion', { rationale: 'Evidence does not cover it.' }]]);
    assert.equal(s.phase, 'active');
    assert.equal(s.completedBy, null);
    s = chain('T1', [['submit-for-review', { evidence: ['EV-0001'] }], ['approve-completion'], ['reopen', { rationale: 'It regressed in a later change.' }]]);
    assert.equal(s.phase, 'active');
    assert.deepEqual(s.evidence, [], 'a reopened item must be proven again');
  });

  it('refuses the moves the lifecycle does not allow', () => {
    const bad = (steps: [WorkAction, Partial<WorkEvent>?][], next: WorkAction) => {
      const s = chain('T2', steps);
      assert.ok('error' in applyWorkEvent(s, ev('T2', s.events.length + 1, next, s.headHash)), `${next} after ${steps.map((x) => x[0]).join(', ')}`);
    };
    bad([], 'approve-completion');
    bad([], 'reject-completion');
    bad([['mark-blocked']], 'submit-for-review');
    bad([['request-clarification']], 'submit-for-review');
    bad([['submit-for-review']], 'mark-blocked');
    bad([['submit-for-review'], ['approve-completion']], 'assign');
    bad([['submit-for-review'], ['approve-completion']], 'submit-for-review');
    bad([['submit-for-review'], ['approve-completion']], 'approve-completion');
    assert.deepEqual(workPermittedIn('completed'), ['comment', 'reopen']);
    assert.ok(WORK_ACTIONS.every((a) => ['assign', 'prioritize', 'comment', 'mark-blocked', 'unblock', 'request-clarification', 'submit-for-review', 'approve-completion', 'reject-completion', 'reopen'].includes(a)));
  });

  it('keeps assignee, priority and blockers as the latest recorded values', () => {
    const s = chain('T3', [['assign', { assignee: 'a', dueDate: '2026-11-01' }], ['prioritize', { priority: 'High', rationale: 'It gates three decisions.' }], ['assign', { assignee: 'b' }], ['mark-blocked', { blockedBy: ['T1'], rationale: 'Waiting for T1 to land.' }]]);
    assert.equal(s.assignee, 'b');
    assert.equal(s.dueDate, '2026-11-01', 'a later assignment without a date keeps the agreed one');
    assert.equal(s.priority, 'High');
    assert.deepEqual(s.blockedBy, ['T1']);
    const u = applyWorkEvent(s, ev('T3', 5, 'unblock', s.headHash, { rationale: 'T1 has landed.' }));
    assert.deepEqual((u as WorkState).blockedBy, []);
  });

  it('detects an edited, missing or forged event', () => {
    const a = ev('T4', 1, 'comment', null, { comment: 'one' });
    assert.ok('event' in parseWorkEvent(serializeWorkEvent(a)));
    assert.ok('error' in parseWorkEvent(JSON.stringify({ ...a, comment: 'edited' })));
    assert.ok('error' in parseWorkEvent(JSON.stringify({ ...a, extra: 1 })));
    assert.ok('error' in parseWorkEvent(JSON.stringify({ ...a, priority: 'Urgent' })));
    assert.match(foldWorkEvents('T4', [a, ev('T4', 3, 'comment', a.eventHash)]).problems[0]!, /expected sequence 2/);
    assert.match(foldWorkEvents('T4', [a, ev('T4', 2, 'comment', 'a'.repeat(64))]).problems[0]!, /prevHash/);
    assert.match(foldWorkEvents('T4', [ev('T4', 1, 'approve-completion', null)]).problems[0]!, /not allowed while the item is none/);
  });
});

describe('work-item rules', () => {
  const policy = parseAccessPolicy(policyJson(), 'canonical');
  const inReview = chain('T5', [['submit-for-review', { evidence: ['EV-0001'] }]]);
  const principal = (u: { login: string; id: number }): Principal => ({ provider: 'github', subject: String(u.id), tenantId: null, login: u.login, name: null, id: u.id, type: 'User', verifiedBy: 'test-fixture', entraRoles: [], entraGroups: [], mfa: false, authAt: Date.parse('2026-10-30T00:00:00Z') });
  const ctx = { policy, now: Date.parse('2026-10-30T00:05:00Z'), devApprovals: true } as const;
  const can = (u: { login: string; id: number }, action: Parameters<typeof authorizeWork>[0]['action'], submitter: string | null = null) => authorizeWork({ principal: principal(u), action, itemId: 'T5', submitter }, ctx);

  it('lets an architecture owner act, a viewer only read, and nobody decide who holds no approval permission', () => {
    assert.equal(can(USERS.owner, 'assign').ok, true);
    assert.equal(can(USERS.contrib, 'comment').ok, true);
    assert.equal(can(USERS.outsider, 'comment').code, 'missing-permission', 'a viewer cannot comment');
    assert.equal(can(USERS.outsider, 'assign').code, 'missing-permission');
    assert.equal(can({ login: 'test-owner', id: 9999 }, 'assign').code, 'missing-permission', 'right login, wrong id: only a viewer');
    const none = authorizeWork({ principal: principal(USERS.owner), action: 'assign', itemId: 'T5', submitter: null }, { ...ctx, policy: parseAccessPolicy(policyJson({ people: [] }), 'canonical') });
    assert.equal(none.code, 'missing-permission');
  });

  it('keeps completion approval to an architecture owner, and from the submitter', () => {
    const submitter = subjectOf(USERS.owner);
    assert.equal(can(USERS.security, 'approve-completion', submitter).code, 'missing-permission');
    assert.equal(can(USERS.admin, 'approve-completion', submitter).code, 'missing-permission', 'an administrator does not approve');
    assert.equal(can(USERS.owner, 'approve-completion', submitter).code, 'sod-submitter');
    assert.equal(can(USERS.owner, 'reject-completion', submitter).code, 'sod-submitter');
    assert.equal(can(USERS.owner2, 'approve-completion', submitter).ok, true);
    void inReview;
  });
  it('offers each action only where it makes sense for the kind and source status', () => {
    const allowed = (i: WorkItem, s = emptyWorkState(i.id)) => workAvailability(i, s).filter((a) => a.allowed).map((a) => a.action);
    assert.ok(allowed(item({ id: 'T6' })).includes('submit-for-review'));
    assert.ok(!allowed(item({ id: 'T6' })).includes('approve-completion'), 'nothing to approve before it is submitted');
    assert.deepEqual(allowed(item({ id: 'T7', status: 'Done' })), ['comment', 'reopen']);
    assert.deepEqual(allowed(item({ id: 'T8', status: 'Superseded' })), ['comment']);
    assert.deepEqual(allowed(item({ id: 'T9', status: 'Rejected' })), ['comment', 'reopen']);
    assert.ok(allowed(item({ id: 'T10', status: 'Closed, no evidence' })).includes('submit-for-review'), 'a claimed closure can be backed with evidence');
    const dec = workAvailability(item({ id: 'D-1', kind: 'decision' }), emptyWorkState('D-1'));
    assert.match(dec.find((a) => a.action === 'submit-for-review')!.reason ?? '', /decision review workflow/);
    assert.equal(dec.find((a) => a.action === 'assign')!.allowed, true);
    assert.equal(workAvailability(item({ id: 'BLK-1', kind: 'build-blocker' }), emptyWorkState('BLK-1')).find((a) => a.action === 'submit-for-review')!.allowed, false, 'a derived blocker clears when the fact changes');
    assert.equal(workAvailability(item({ id: 'T11' }), inReview).find((a) => a.action === 'approve-completion')!.allowed, true);
    assert.ok(workAvailability(item({ id: 'T11' }), { ...emptyWorkState('T11'), problems: ['x'] }).every((a) => !a.allowed));
  });

  it('validates what each request must contain', () => {
    const base = { expectedRevision: 'r', idempotencyKey: 'abcdefgh-1' };
    const bad = (r: object) => assert.equal(validateWorkRequest({ ...base, ...r } as never).ok, false, JSON.stringify(r));
    const good = (r: object) => assert.equal(validateWorkRequest({ ...base, ...r } as never).ok, true, JSON.stringify(r));
    bad({ action: 'assign' });
    bad({ action: 'assign', assignee: 'a', dueDate: '2026-13-45' });
    bad({ action: 'assign', assignee: 'a', dueDate: '2026-02-30' });
    bad({ action: 'assign', assignee: 'a', dueDate: 'next week' });
    good({ action: 'assign', assignee: 'a' });
    good({ action: 'assign', assignee: 'a', dueDate: '2026-11-04' });
    bad({ action: 'prioritize', priority: 'High' });
    bad({ action: 'prioritize', priority: 'Urgent', rationale: 'A long enough reason.' });
    good({ action: 'prioritize', priority: 'High', rationale: 'A long enough reason.' });
    bad({ action: 'comment', comment: '  ' });
    bad({ action: 'mark-blocked', rationale: 'short' });
    bad({ action: 'request-clarification' });
    bad({ action: 'submit-for-review', evidence: [] });
    bad({ action: 'submit-for-review', evidence: ['notes.txt'] });
    bad({ action: 'submit-for-review', evidence: ['docs/../secrets'] });
    bad({ action: 'submit-for-review', evidence: ['EV-12'] });
    good({ action: 'submit-for-review', evidence: ['EV-0001', 'tests/x.test.mjs'] });
    bad({ action: 'reject-completion', rationale: 'no' });
    bad({ action: 'reopen' });
    good({ action: 'approve-completion' });
    bad({ action: 'nope' });
    assert.equal(validateWorkRequest({ action: 'comment', comment: 'x' }).ok, false, 'revision and key are required');
  });
});

describe('overlay of merged work-item events', () => {
  it('shows assignment, priority and status only from the canonical record, and Done only after approval with evidence', () => {
    const items = [item({ id: 'T1', missing: ['priority', 'owner'] }), item({ id: 'T2' }), item({ id: 'T3' }), item({ id: 'T4' })];
    const states = new Map<string, WorkState>([
      ['T1', chain('T1', [['assign', { assignee: 'test-owner' }], ['prioritize', { priority: 'Critical', rationale: 'It gates the build.' }]])],
      ['T2', chain('T2', [['submit-for-review', { evidence: ['EV-0001'] }]])],
      ['T3', chain('T3', [['submit-for-review', { evidence: ['EV-0001'] }], ['approve-completion']])],
      ['T4', chain('T4', [['mark-blocked', { rationale: 'Waiting for the quality manager.' }]])],
    ]);
    const out = new Map(applyWorkOverlay(items, states, ['programme-owner'], 'origin/main').map((i) => [i.id, i]));
    assert.equal(out.get('T1')!.assignee, 'test-owner');
    assert.equal(out.get('T1')!.priority, 'Critical');
    assert.match(out.get('T1')!.priorityBasis ?? '', /Set by @test-owner/);
    assert.deepEqual(out.get('T1')!.missing, []);
    assert.equal(out.get('T1')!.status, 'Open', 'assigning does not change the status');
    assert.equal(out.get('T2')!.status, 'In review');
    assert.equal(out.get('T2')!.approval?.kind, 'completion');
    assert.equal(out.get('T2')!.completionEvidence.length, 0, 'not Done, so no completion evidence yet');
    assert.equal(out.get('T3')!.status, 'Done');
    assert.equal(out.get('T3')!.completionEvidence[0]!.ref, 'EV-0001');
    assert.equal(out.get('T4')!.status, 'Blocked');
    assert.ok(out.get('T4')!.flags.some((f) => f.code === 'marked-blocked'));
  });
});

// ---------------------------------------------------------------- service, against a local bare "GitHub"

function world(policy?: string, github?: (real: LocalGitHub) => LocalGitHub) {
  const fx = makeFixture({ policy });
  fixtures.push(fx);
  fx.setIdentity(USERS.owner);
  const real = new LocalGitHub(path.join(fx.state, 'prs.json'), fx.remote);
  const identity = new FixtureIdentity(path.join(fx.state, 'identity.json'));
  const store = new ReviewStore(path.join(fx.state, 'review'));
  let t = Date.parse('2026-10-30T00:00:00Z');
  const deps: ServiceDeps = { root: fx.work, readRef: 'HEAD', canonicalRef: 'origin/main', store, github: github ? github(real) : real, publisher: new GitPublisher(fx.work), identity, now: () => new Date((t += 1000)) };
  const review = new ReviewService(deps);
  const work = new WorkService(deps, review);
  const ctx: WorkContext = { evidenceRuns: new Map([['EV-0001', { exitCode: 0 }], ['EV-0002', { exitCode: 1 }]]), knownItems: new Set(['T1', 'T2', 'T3', 'B-01', 'D-010']) };
  let n = 0;
  const key = () => `wkey-${++n}-abcdefgh`;
  const as = async (u: (typeof USERS)[keyof typeof USERS]): Promise<VerifiedUser> => {
    fx.setIdentity(u);
    return identity.verify();
  };
  const act = async (it: WorkItem, u: VerifiedUser | null, action: WorkAction, extra: Record<string, unknown> = {}) => {
    const v = work.view(it, u);
    return work.submit(u, it, { action, expectedRevision: v.revision, idempotencyKey: key(), ...extra }, ctx);
  };
  const land = async (it: WorkItem, u: VerifiedUser, action: WorkAction, extra: Record<string, unknown> = {}) => {
    const { proposal } = await act(it, u, action, extra);
    const sent = await work.sync(proposal.id);
    assert.equal(sent.state, 'pull-request-created');
    fx.merge(sent.prNumber!);
    const done = await work.sync(proposal.id);
    assert.equal(done.state, 'applied', done.lastError?.message);
    return done;
  };
  return { fx, store, real, review, work, ctx, as, act, land, key };
}
const code = (c: string) => (e: unknown) => e instanceof ServiceError && e.code === c;
const OWNERS = policyJson();

describe('work-item service', () => {
  it('assigns through a pull request: nothing is assigned until the merge is verified', async () => {
    const w = world();
    const it = item({ id: 'T1' });
    const u = await w.as(USERS.owner);
    await assert.rejects(w.act(it, u, 'assign', { assignee: 'nobody' }), code('invalid'), 'an unregistered person cannot be assigned');
    await assert.rejects(w.act(it, u, 'assign', { assignee: 'test-owner', dueDate: '2026-99-99' }), code('invalid'));
    const before = git(w.fx.work, 'status', '--porcelain');
    const { proposal } = await w.act(it, u, 'assign', { assignee: 'test-contrib', dueDate: '2026-11-05' });
    assert.equal(proposal.family, 'work');
    assert.ok(proposal.branch.startsWith('work-item/T1/0001-assign-'));
    const sent = await w.work.sync(proposal.id);
    assert.equal(sent.state, 'pull-request-created');
    assert.equal(w.work.canonical().states.get('T1'), undefined, 'a pull request is not an assignment');
    assert.equal(git(w.fx.remote, 'rev-parse', 'refs/heads/main'), git(w.fx.work, 'rev-parse', 'origin/main'), 'main is untouched');
    w.fx.merge(sent.prNumber!);
    assert.equal((await w.work.sync(proposal.id)).state, 'applied');
    const s = w.work.canonical().states.get('T1')!;
    assert.equal(s.assignee, 'test-contrib');
    assert.equal(s.dueDate, '2026-11-05');
    assert.equal(git(w.fx.work, 'status', '--porcelain'), before, 'the working tree was not touched');
    const file = git(w.fx.remote, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'refs/heads/main');
    assert.equal(file, 'docs/work-items/T1/0001-assign.json');
  });

  it('completes work only with evidence that exists and succeeded, and a second person approves it', async () => {
    const w = world(OWNERS);
    const it = item({ id: 'T2' });
    const u = await w.as(USERS.owner);
    await assert.rejects(w.act(it, u, 'submit-for-review'), code('invalid'), 'evidence is required');
    await assert.rejects(w.act(it, u, 'submit-for-review', { evidence: ['EV-9999'] }), code('evidence-not-found'));
    await assert.rejects(w.act(it, u, 'submit-for-review', { evidence: ['EV-0002'] }), code('evidence-failed'), 'a failing run is not completion evidence');
    await assert.rejects(w.act(it, u, 'submit-for-review', { evidence: ['docs/proof/missing.md'] }), code('evidence-not-found'));
    w.fx.commitToMain({ 'docs/proof/result.md': 'proof\n' });
    git(w.fx.work, 'fetch', '-q', 'origin');
    await assert.rejects(w.act(it, u, 'approve-completion'), code('not-allowed'), 'nothing is submitted yet');
    await w.land(it, u, 'submit-for-review', { evidence: ['EV-0001', 'docs/proof/result.md'] });
    assert.equal(w.work.canonical().states.get('T2')!.phase, 'in-review');

    await assert.rejects(w.act(it, u, 'approve-completion'), code('sod-submitter'), 'the submitter may not approve their own work');
    const q = await w.as(USERS.security);
    await assert.rejects(w.act(it, q, 'approve-completion'), code('missing-permission'));
    const o2 = await w.as(USERS.owner2);
    await w.land(it, o2, 'approve-completion', { rationale: 'Evidence covers the acceptance criteria.' });
    const s = w.work.canonical().states.get('T2')!;
    assert.equal(s.phase, 'completed');
    const out = applyWorkOverlay([it], new Map([['T2', s]]), ['programme-owner'], 'origin/main')[0]!;
    assert.equal(out.status, 'Done');
    assert.deepEqual(out.completionEvidence.map((e) => e.ref), ['EV-0001', 'docs/proof/result.md']);
    assert.ok(out.completionEvidence.every((e) => e.valid));
    await assert.rejects(w.act(it, o2, 'approve-completion'), code('not-allowed'), 'completed work cannot be approved again');
    await w.land(it, o2, 'reopen', { rationale: 'A later change broke the behaviour.' });
    assert.equal(applyWorkOverlay([it], new Map([['T2', w.work.canonical().states.get('T2')!]]), [], 'origin/main')[0]!.status, 'Open');
  });

  it('returns rejected completion to work, with the reason on record', async () => {
    const w = world(OWNERS);
    const it = item({ id: 'T3' });
    const u = await w.as(USERS.owner);
    await w.land(it, u, 'submit-for-review', { evidence: ['EV-0001'] });
    const o2 = await w.as(USERS.owner2);
    await assert.rejects(w.act(it, o2, 'reject-completion'), code('invalid'), 'a rejection needs a reason');
    await w.land(it, o2, 'reject-completion', { rationale: 'The evidence is for a different change.' });
    const s = w.work.canonical().states.get('T3')!;
    assert.equal(s.phase, 'active');
    assert.equal(s.completedBy, null);
    const out = applyWorkOverlay([it], new Map([['T3', s]]), [], 'origin/main')[0]!;
    assert.equal(out.status, 'Open');
    assert.ok(out.flags.some((f) => f.code === 'completion-rejected' && /different change/.test(f.text)));
  });

  it('blocks, asks for clarification, and clears them, each with a reason', async () => {
    const w = world();
    const it = item({ id: 'T1' });
    const u = await w.as(USERS.owner);
    await assert.rejects(w.act(it, u, 'mark-blocked', { rationale: 'too short' }), code('invalid'));
    await assert.rejects(w.act(it, u, 'mark-blocked', { rationale: 'Waiting for a decision.', blockedBy: ['T404'] }), code('invalid'), 'the blocker must be a real work item');
    await assert.rejects(w.act(it, u, 'mark-blocked', { rationale: 'Waiting for a decision.', blockedBy: ['T1'] }), code('invalid'), 'an item cannot block itself');
    await w.land(it, u, 'mark-blocked', { rationale: 'Waiting for the sovereignty decision.', blockedBy: ['D-010'] });
    assert.equal(applyWorkOverlay([it], w.work.canonical().states, [], 'o')[0]!.status, 'Blocked');
    await assert.rejects(w.act(it, u, 'submit-for-review', { evidence: ['EV-0001'] }), code('not-allowed'), 'clear the block first');
    await w.land(it, u, 'request-clarification', { rationale: 'Which port is in scope for the first release?' });
    assert.equal(applyWorkOverlay([it], w.work.canonical().states, [], 'o')[0]!.status, 'Awaiting clarification');
    await w.land(it, u, 'unblock', { rationale: 'The owner answered in the register.' });
    assert.equal(applyWorkOverlay([it], w.work.canonical().states, [], 'o')[0]!.status, 'Open');
  });

  it('refuses the unauthorised, the unauthenticated and the stale, and de-duplicates', async () => {
    const w = world();
    const it = item({ id: 'T1' });
    await assert.rejects(w.act(it, null, 'comment', { comment: 'hello' }), code('unauthenticated'));
    const out = await w.as(USERS.outsider);
    await assert.rejects(w.act(it, out, 'assign', { assignee: 'test-owner' }), code('missing-permission'));
    await assert.rejects(w.act(it, out, 'comment', { comment: 'A question from outside the team.' }), code('missing-permission'), 'a viewer cannot comment');
    const contrib = await w.as(USERS.contrib);
    const { proposal } = await w.act(it, contrib, 'comment', { comment: 'A question from the team.' });
    assert.equal(proposal.state, 'locally-submitted');
    await w.work.sync(proposal.id);

    const w2 = world();
    const u = await w2.as(USERS.owner);
    const v = w2.work.view(it, u);
    const req = { action: 'comment' as const, comment: 'once', expectedRevision: v.revision, idempotencyKey: 'dup-work-key-1' };
    const [a, b] = await Promise.all([w2.work.submit(u, it, req, w2.ctx), w2.work.submit(u, it, req, w2.ctx)]);
    assert.equal(a.proposal.id, b.proposal.id);
    assert.deepEqual([a.duplicate, b.duplicate].sort(), [false, true]);
    await assert.rejects(w2.work.submit(u, it, { ...req, comment: 'two', idempotencyKey: 'dup-work-key-2' }, w2.ctx), code('stale-revision'));
    const v2 = w2.work.view(it, u);
    await assert.rejects(w2.work.submit(u, it, { ...req, comment: 'two', idempotencyKey: 'dup-work-key-3', expectedRevision: v2.revision }, w2.ctx), code('proposal-open'));
    assert.equal(w2.store.list().length, 1);
    w2.fx.setIdentity(USERS.security);
    await assert.rejects(w2.work.submit(u, it, { ...req, idempotencyKey: 'dup-work-key-4' }, w2.ctx), code('identity-changed'));
  });

  it('keeps decision proposals and work proposals for the same id apart', async () => {
    const w = world();
    const it = item({ id: 'D-010', kind: 'decision' });
    const u = await w.as(USERS.owner);
    const { proposal } = await w.act(it, u, 'assign', { assignee: 'test-owner' });
    assert.equal(w.store.openFor('D-010', 'work')?.id, proposal.id);
    assert.equal(w.store.openFor('D-010'), null, 'the decision workflow does not see the work proposal');
    assert.equal(w.store.openFor('D-010', 'decision'), null);
  });

  it('survives GitHub being unreachable, through the same pipeline as decisions', async () => {
    const w = world();
    const it = item({ id: 'T1' });
    const u = await w.as(USERS.owner);
    const { proposal } = await w.act(it, u, 'comment', { comment: 'Sent while GitHub is down.' });
    git(w.fx.work, 'remote', 'set-url', 'origin', path.join(w.fx.dir, 'nowhere.git'));
    const failed = await w.work.sync(proposal.id);
    assert.equal(failed.state, 'awaiting-github-update');
    assert.equal(failed.lastError?.retryable, true);
    git(w.fx.work, 'remote', 'set-url', 'origin', w.fx.remote);
    assert.equal((await w.work.sync(proposal.id)).state, 'pull-request-created');
  });

  it('reports a competing event as a conflict, and ignores a tampered work-item file', async () => {
    const w = world();
    const it = item({ id: 'T1' });
    const u = await w.as(USERS.owner);
    const { proposal } = await w.act(it, u, 'comment', { comment: 'Mine.' });
    w.fx.commitToMain({ 'docs/work-items/T1/0001-comment.json': serializeWorkEvent(ev('T1', 1, 'comment', null, { comment: 'Theirs, first.' })) });
    assert.equal((await w.work.sync(proposal.id)).state, 'conflicted');

    const w2 = world();
    const forged = { ...ev('T2', 1, 'assign', null, { assignee: 'test-owner' }), assignee: 'someone-else' };
    w2.fx.commitToMain({ 'docs/work-items/T2/0001-assign.json': `${JSON.stringify(forged, null, 2)}\n` });
    git(w2.fx.work, 'fetch', '-q', 'origin');
    const s = loadWorkStates(new GitRepositoryAdapter(w2.fx.work, 'origin/main').open()).get('T2')!;
    assert.equal(s.assignee, null);
    assert.ok(s.problems.some((p) => /eventHash does not match/.test(p)));
    assert.ok(workAvailability(it, s).every((a) => !a.allowed), 'an inconsistent record offers no action');
    void GitHubError;
    void fs;
  });
});
