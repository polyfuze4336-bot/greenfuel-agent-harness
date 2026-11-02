import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { GitRepositoryAdapter } from '../src/lib/repo/git.ts';
import { buildModel } from '../src/lib/repo/build.ts';
import { analyzeImpact, classifyDocument, findCycles } from '../src/lib/impact/analyze.ts';
import { IMPACT_ACTIONS, type ImpactAction } from '../src/lib/impact/types.ts';

// Decision Impact Analysis on small controlled repositories. The graph is built only from references a record states; an AI
// relationship is shown as unverified and never counted; nothing here changes a status.

function git(root: string, ...a: string[]) {
  const r = spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
const dirs: string[] = [];
function makeRepo(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-impact-'));
  dirs.push(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@example.invalid');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'core.autocrlf', 'false');
  for (const [p, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), c);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'initial');
  return { root, open: () => new GitRepositoryAdapter(root, 'HEAD').open() };
}
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const adr = (n: string, context = 'Some context.', status = 'Proposed', reqs = '') => `# ADR ${n}: Decision number ${n}\n\n- **Status:** ${status}\n- **Type:** Design\n- **Date:** 2026-10-28\n- **Deciders:** Enterprise architect\n- **Supersedes:** none\n\n## Context\n${context}\n\n## Options considered\n\n1. **A. Do nothing.** Not selected.\n2. **B. Build it (selected).** Trade-offs: costs more.\n\n## Decision\nBuild it.\n\n## Cost and operational implications\nRuns on one small service.\n${reqs ? `\n## Requirements addressed\n${reqs}\n` : ''}`;
const reg = (rows: [string, string, string][]) =>
  `# Register\n\n| ID | Kind | Decision or clarification needed | Why it matters | Known options (none chosen) | Owner role | Needed by | Status |\n|---|---|---|---|---|---|---|---|\n${rows.map(([id, kind, title]) => `| ${id} | ${kind} | ${title} | Because | Option one; option two | Enterprise architect | M1 | Open |`).join('\n')}\n`;
const REQS = '| ID | Caps | Requirement | Cls | Pri | Business justification | Acceptance criteria |\n|---|---|---|---|---|---|---|\n| FR-001 | X | Do a thing | A | Must | why | ok |\n| FR-002 | X | Do more | A | Should | why | ok |\n';
const trace = (rows: string[]) => `| ID | Source | Validation method | Evidence required | Decisions | Depends on | Open (C) | Verify (D) |\n|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
const suggestionFile = (items: object[]) => JSON.stringify({ notice: 'n', schema: 's', suggestions: items });
const relSuggestion = (id: string, decisionId: string, targetId: string) => ({
  id, decisionId, optionKey: null, kind: 'relationship', targetId, text: `${decisionId} may be related to ${targetId}.`, rationale: 'because', basedOn: [decisionId, targetId],
  label: 'AI SUGGESTION', reviewState: 'unreviewed', generatedBy: { kind: 'ai', tool: 'Test tool', date: '2026-11-02' },
});

function world(extra: Record<string, string> = {}) {
  return makeRepo({
    'docs/adr/0001-base.md': adr('0001', 'Some context.', 'Proposed', 'FR-001, FR-002'),
    'docs/adr/0002-next.md': adr('0002', 'Builds on ADR 0001.'),
    'docs/adr/0003-later.md': adr('0003', 'Builds on ADR 0002.'),
    'docs/adr/0004-loop-a.md': adr('0004', 'Needs ADR 0005.'),
    'docs/adr/0005-loop-b.md': adr('0005', 'Needs ADR 0004.'),
    'docs/adr/0006-dangling.md': adr('0006', 'Needs ADR 0098 and D-099.'),
    'docs/context/DECISION-REGISTER.md': reg([['D-001', 'X', 'Hosting model'], ['D-002', 'C', 'Which ports']]),
    'docs/context/REQUIREMENTS.md': REQS,
    'docs/context/REQUIREMENTS-TRACEABILITY.md': trace(['| FR-001 | s | v | e | D-001 | – | D-002 | – |', '| FR-002 | s | v | e | – | – | – | – |']),
    ...extra,
  });
}
const input = (r: ReturnType<typeof makeRepo>) => {
  const m = buildModel(r.open());
  return { commit: m.repo.commit, records: m.register.records, requirements: m.requirements, risks: m.risks, tasks: m.tasks, reviews: m.reviews, docs: m.docs, qa: m.presentation.qa, suggestions: m.register.suggestions, queue: null };
};
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('dependency detection: only what a record states', () => {
  const r = world();
  const inp = input(r);
  const res = analyzeImpact(inp, 'ADR-0001', 'approve')!;

  it('puts what cites the decision, or is named by it, in the directly affected group', () => {
    assert.ok(ids(res.direct).includes('ADR-0002'), 'ADR 0002 says it builds on ADR 0001');
    assert.ok(ids(res.direct).includes('FR-001') && ids(res.direct).includes('FR-002'), 'both traceability rows name it');
  });

  it('reaches a further decision only as potentially affected, through the one that links it', () => {
    const p = res.potential.find((x) => x.id === 'ADR-0003');
    assert.ok(p, 'ADR 0003 builds on ADR 0002, which builds on ADR 0001');
    assert.equal(p!.via, 'ADR-0002');
    assert.equal(p!.tier, 'potential');
    assert.equal(ids(res.direct).includes('ADR-0003'), false);
  });

  it('gives every item the reference that put it there', () => {
    for (const it of [...res.direct, ...res.potential]) assert.ok(it.relation.length > 0, it.id);
    for (const it of res.direct) assert.ok(it.src === null || (it.src.path.length > 0 && it.src.line > 0), it.id);
  });

  it('invents nothing: an unrelated decision is not affected, and an unknown id has no analysis', () => {
    const none = analyzeImpact(inp, 'ADR-0005', 'approve')!;
    assert.equal(ids(none.direct).includes('ADR-0001'), false);
    assert.equal(analyzeImpact(inp, 'ADR-9999', 'approve'), null);
  });

  it('summary counts equal the lists', () => {
    assert.equal(res.summary.direct, res.direct.length);
    assert.equal(res.summary.potential, res.potential.length);
    assert.equal(res.summary.blocking, res.blocking.length);
    assert.equal(res.summary.followUp, res.followUp.length);
  });
});

describe('approval, rejection, deferral and revision are each analysed, and none changes anything', () => {
  const r = world();
  const inp = input(r);
  const before = git(r.root, 'rev-parse', 'HEAD') + git(r.root, 'status', '--porcelain');
  const by = (a: ImpactAction) => analyzeImpact(inp, 'ADR-0001', a)!;

  it('names the status each action would lead to, and says the Studio does not change it', () => {
    assert.equal(by('approve').statusAfter, 'Approved');
    assert.equal(by('reject').statusAfter, 'Rejected');
    assert.equal(by('defer').statusAfter, 'Deferred');
    assert.equal(by('revise').statusAfter, 'Pending Review');
    for (const a of IMPACT_ACTIONS) assert.match(by(a).statusNote, /GitHub|review record|Studio/i);
  });

  it('shows different follow-up work for approval and for rejection', () => {
    const ap = by('approve').followUp.map((f) => f.text).join('|');
    const rj = by('reject').followUp.map((f) => f.text).join('|');
    assert.notEqual(ap, rj);
    assert.ok(by('reject').followUp.length > 0, 'a rejection has follow-up: dependants must be reconsidered');
  });

  it('lists possible rework on rejection, from what already cites the decision', () => {
    const rej = by('reject');
    assert.ok(rej.rework.length > 0);
    for (const it of rej.rework) assert.ok([...rej.direct, ...rej.potential].some((x) => x.id === it.id), `${it.id} is rework only if it is already in the analysis`);
  });

  it('never states effort, and states a count, not a guess', () => {
    for (const a of IMPACT_ACTIONS) {
      assert.equal(by(a).estimate.effort, null);
      assert.ok(by(a).estimate.counts.length > 0);
    }
  });

  it('is pure: the repository is the same after every analysis', () => {
    for (const a of IMPACT_ACTIONS) by(a);
    assert.equal(git(r.root, 'rev-parse', 'HEAD') + git(r.root, 'status', '--porcelain'), before);
  });
});

describe('blocking dependencies', () => {
  const r = world();
  const inp = input(r);

  it('names an unresolved decision this one rests on, with its status', () => {
    const res = analyzeImpact(inp, 'ADR-0002', 'approve')!;
    const b = res.blocking.find((x) => x.id === 'ADR-0001');
    assert.ok(b, 'ADR 0002 rests on ADR 0001, which is only Proposed');
    assert.equal(b!.direction, 'rests-on');
    assert.equal(b!.status, 'Proposed');
  });

  it('names what waits for this decision, and keeps a dependent decision in the directly affected list', () => {
    const res = analyzeImpact(inp, 'ADR-0001', 'approve')!;
    assert.ok(res.blocking.every((x) => x.direction === 'waits-for-this' || x.direction === 'rests-on'));
    assert.ok(ids(res.direct).includes('ADR-0002'));
  });

  it('does not count a dependency that has already been approved as blocking', () => {
    const r2 = makeRepo({
      'docs/adr/0001-base.md': adr('0001', 'Fine.', 'Accepted (2026-10-28, programme owner)'),
      'docs/adr/0002-next.md': adr('0002', 'Builds on ADR 0001.'),
      'docs/context/DECISION-REGISTER.md': reg([['D-001', 'X', 'Hosting model']]),
    });
    const res = analyzeImpact(input(r2), 'ADR-0002', 'approve')!;
    assert.equal(res.blocking.some((x) => x.id === 'ADR-0001'), false);
  });
});

describe('missing references are reported, not followed or dropped', () => {
  const r = world();
  const res = analyzeImpact(input(r), 'ADR-0006', 'approve')!;

  it('lists each reference that points at nothing', () => {
    const u = ids(res.unresolved);
    assert.ok(u.includes('ADR-0098') && u.includes('D-099'), u.join(','));
    assert.equal(res.summary.unresolved, res.unresolved.length);
  });

  it('never puts a missing record in the affected lists', () => {
    for (const x of [...res.direct, ...res.potential, ...res.blocking]) assert.ok(!['ADR-0098', 'D-099'].includes(x.id));
  });

  it('says where the broken reference is made', () => {
    for (const x of res.unresolved) assert.ok(x.via.length > 0);
  });
});

describe('cyclic dependencies are reported and terminate', () => {
  const r = world();
  const inp = input(r);

  it('finds the cycle, once, in a stable order', () => {
    const cycles = findCycles(inp.records);
    assert.equal(cycles.length, 1);
    assert.deepEqual([...new Set(cycles[0]!)].sort(), ['ADR-0004', 'ADR-0005']);
    assert.equal(cycles[0]![0], cycles[0]![cycles[0]!.length - 1], 'the path is shown closed, so the loop is visible');
    assert.deepEqual(findCycles(inp.records), cycles);
  });

  it('reports it on the decisions in the cycle, and the analysis terminates without repeating anything', () => {
    const res = analyzeImpact(inp, 'ADR-0004', 'reject')!;
    assert.ok(res.cycles.length >= 1);
    const keys = [...res.direct, ...res.potential].map((x) => `${x.id}|${x.tier}`);
    assert.equal(new Set(keys).size, keys.length, 'no item is listed twice');
    assert.equal(ids(res.potential).includes('ADR-0004'), false, 'a decision is never its own downstream impact');
  });

  it('a decision that depends on itself is reported as a one-step cycle, and a chain is not a cycle', () => {
    assert.deepEqual(findCycles([{ id: 'ADR-0001', dependsOn: ['ADR-0001'] }]), [['ADR-0001', 'ADR-0001']]);
    assert.equal(findCycles([{ id: 'A', dependsOn: ['B'] }, { id: 'B', dependsOn: [] }]).length, 0);
  });

  it('does not report a cycle for a decision that is not in one', () => {
    assert.deepEqual(analyzeImpact(inp, 'ADR-0001', 'approve')!.cycles, []);
  });
});

describe('AI relationship suggestions are labelled unverified and never counted', () => {
  const sug = (items: object[]) => world({ 'docs/architecture-studio/suggestions/rel.json': suggestionFile(items) });

  it('shows a suggested relationship apart, with its source and who made it', () => {
    const r = sug([relSuggestion('S-900', 'ADR-0001', 'D-001')]);
    const res = analyzeImpact(input(r), 'ADR-0001', 'approve')!;
    assert.equal(res.unverified.length, 1);
    const u = res.unverified[0]!;
    assert.equal(u.targetId, 'D-001');
    assert.equal(u.nowExplicit, false);
    assert.equal(u.generatedBy.tool, 'Test tool');
    assert.match(u.src.path, /suggestions\/rel\.json$/);
  });

  it('does not count it, and does not add its target to any affected list or blocking list', () => {
    const base = analyzeImpact(input(world()), 'ADR-0001', 'approve')!;
    const withS = analyzeImpact(input(sug([relSuggestion('S-900', 'ADR-0001', 'D-001')])), 'ADR-0001', 'approve')!;
    assert.equal(withS.summary.direct, base.summary.direct);
    assert.equal(withS.summary.potential, base.summary.potential);
    assert.equal(withS.summary.blocking, base.summary.blocking);
    assert.equal(withS.direct.some((x) => x.id === 'D-001'), false);
    assert.equal(withS.summary.unverified, 1);
  });

  it('shows it on the target decision too, so the link is visible from both ends', () => {
    const r = sug([relSuggestion('S-900', 'ADR-0001', 'D-001')]);
    const res = analyzeImpact(input(r), 'D-001', 'approve')!;
    assert.equal(res.unverified.length, 1);
  });

  it('marks it as now explicit once a repository record states the same link itself', () => {
    const r = sug([relSuggestion('S-900', 'ADR-0002', 'ADR-0001')]);
    const res = analyzeImpact(input(r), 'ADR-0002', 'approve')!;
    assert.equal(res.unverified[0]!.nowExplicit, true, 'ADR 0002 itself says it builds on ADR 0001');
  });

  it('ignores a suggestion that names a record that does not exist or the decision itself', () => {
    const r = sug([relSuggestion('S-901', 'ADR-0001', 'D-777'), relSuggestion('S-902', 'ADR-0001', 'ADR-0001')]);
    const res = analyzeImpact(input(r), 'ADR-0001', 'approve')!;
    assert.equal(res.unverified.length, 0);
  });
});

describe('document classification only sorts a citation that exists', () => {
  it('classifies by where the document lives, and a decision record is not a document kind', () => {
    assert.equal(classifyDocument('docs/adr/0001-x.md'), 'adr');
    assert.equal(typeof classifyDocument('docs/architecture/designs/DES-0003-target-system-architecture.md'), 'string');
    assert.equal(typeof classifyDocument('docs/state/TODO.md'), 'string');
  });
});
