import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { GitRepositoryAdapter } from '../src/lib/repo/git.ts';
import { buildRegister } from '../src/lib/intel/engine.ts';
import { classify, parseAccessPolicy } from '../src/lib/auth/access-policy.ts';
import { NATURES, reviewLane, type NormalizedDecision } from '../src/lib/intel/schema.ts';
import { toRow } from '../src/lib/intel/row.ts';
import { policyJson } from './fixtures/review-fixture.ts';

// The Decision Workspace's promises, tested on small controlled repositories: what each kind of record is, that nothing is invented,
// that bad references and duplicate ids are reported, and that reading changes nothing.

function git(root: string, ...a: string[]) {
  const r = spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

const dirs: string[] = [];
function makeRepo(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-ws-'));
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

const adr = (n: string, body = 'Build it.', supersedes = 'none', reqs = '') => `# ADR ${n}: Decision number ${n}\n\n- **Status:** Proposed\n- **Type:** Design\n- **Date:** 2026-10-28\n- **Deciders:** Enterprise architect\n- **Supersedes:** ${supersedes}\n\n## Context\nSome context.\n\n## Options considered\n\n1. **A. Do nothing.** Not selected.\n2. **B. Build it (selected).** Trade-offs: costs more.\n\n## Decision\n${body}\n${reqs ? `\n## Requirements addressed\n${reqs}\n` : ''}`;
const reg = (rows: [string, string, string, string][]) =>
  `# Register\n\n| ID | Kind | Decision or clarification needed | Why it matters | Known options (none chosen) | Owner role | Needed by | Status |\n|---|---|---|---|---|---|---|---|\n${rows.map(([id, kind, title, owner]) => `| ${id} | ${kind} | ${title} | Because | Option one; option two | ${owner} | M1 | Open |`).join('\n')}\n`;
const REQS = '| ID | Caps | Requirement | Cls | Pri | Business justification | Acceptance criteria |\n|---|---|---|---|---|---|---|\n| FR-001 | X | Do a thing | A | Must | why | ok |\n| FR-002 | X | Do more | A | Should | why | ok |\n';
const trace = (rows: string[]) => `| ID | Source | Validation method | Evidence required | Decisions | Depends on | Open (C) | Verify (D) |\n|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`;

const rec = (records: NormalizedDecision[], id: string) => records.find((r) => r.id === id)!;

describe('what a record is: stakeholder fact, regulatory claim, or architecture choice', () => {
  const r = makeRepo({
    'docs/adr/0001-a.md': adr('0001'),
    'docs/context/DECISION-REGISTER.md': reg([
      ['D-001', 'C', 'Which ports', 'Programme owner'],
      ['D-002', 'D', 'Who verifies citations', 'Compliance counsel'],
      ['D-003', 'X', 'Hosting model', 'Enterprise architect'],
      ['D-004', 'C+D', 'Residency law', 'Programme owner with compliance counsel'],
      ['D-005', 'X+C', 'Cross-border data', 'Enterprise architect'],
      ['D-006', 'X+D', 'Where inference runs', 'Enterprise architect'],
      ['D-007', 'Q', 'Unknown kind letter', 'Programme owner'],
      ['D-008', '', 'No kind stated', 'Programme owner'],
    ]),
  });
  const records = buildRegister(r.open()).snapshot.records;

  it('takes the nature from the register Kind column and from the file type for an ADR, and nowhere else', () => {
    assert.deepEqual(rec(records, 'ADR-0001').natures, ['architecture-choice']);
    assert.deepEqual(rec(records, 'D-001').natures, ['stakeholder-clarification']);
    assert.deepEqual(rec(records, 'D-002').natures, ['regulatory-verification']);
    assert.deepEqual(rec(records, 'D-003').natures, ['architecture-choice']);
    assert.deepEqual([...rec(records, 'D-004').natures].sort(), ['regulatory-verification', 'stakeholder-clarification']);
    assert.deepEqual([...rec(records, 'D-005').natures].sort(), ['architecture-choice', 'stakeholder-clarification']);
    assert.ok(NATURES.length === 3);
  });

  it('never interprets a Kind letter the legend does not define, and never guesses a missing one', () => {
    assert.deepEqual(rec(records, 'D-007').natures, []);
    assert.ok(rec(records, 'D-007').flags.some((f) => f.code === 'kind-unrecognised'));
    assert.deepEqual(rec(records, 'D-008').natures, []);
    assert.ok(rec(records, 'D-008').missing.includes('natures'), 'an unstated kind is listed as not stated');
    assert.equal(rec(records, 'D-001').missing.includes('natures'), false);
    assert.ok(rec(records, 'D-001').fieldSources.natures?.rule.includes('Kind'), 'the nature has a recorded source and rule');
  });

  it('puts every record in exactly one review lane, the most restrictive nature winning', () => {
    const lane = (id: string) => reviewLane(rec(records, id).natures);
    assert.equal(lane('ADR-0001'), 'architecture');
    assert.equal(lane('D-003'), 'architecture');
    assert.equal(lane('D-001'), 'stakeholder');
    assert.equal(lane('D-002'), 'verification');
    assert.equal(lane('D-004'), 'verification', 'C+D is a verification: the regulatory part decides');
    assert.equal(lane('D-005'), 'stakeholder', 'X+C waits for the business fact before it is an approvable choice');
    assert.equal(lane('D-006'), 'verification');
    assert.equal(lane('D-007'), 'unclassified');
    assert.equal(lane('D-008'), 'unclassified');
    assert.equal(toRow(rec(records, 'D-001')).lane, 'stakeholder');
  });

  it('the server classification follows the nature, not the owner: a clarification owned by the programme owner is not an architecture approval', () => {
    const policy = parseAccessPolicy(policyJson(), 'canonical');
    const cls = (id: string) => {
      const d = rec(records, id);
      return classify(policy, { id: d.id, kind: d.kind, approverText: d.requiredApproverRole?.text ?? null, natures: d.natures });
    };
    assert.equal(cls('D-001').domain, 'clarification');
    assert.match(cls('D-001').basis, /stakeholder clarification/);
    assert.equal(cls('D-002').domain, 'regulatory');
    assert.equal(cls('D-004').domain, 'regulatory');
    assert.equal(cls('D-005').domain, 'clarification');
    assert.equal(cls('D-003').domain, 'architecture');
    assert.equal(cls('ADR-0001').domain, 'architecture');
    assert.equal(cls('D-007').domain, 'unclassified');
    assert.equal(cls('D-008').domain, 'unclassified');
    // Without natures (an old caller) the previous behaviour is unchanged.
    assert.equal(classify(policy, { id: 'D-001', kind: 'register-entry', approverText: 'Programme owner' }).domain, 'architecture');
  });
});

describe('references are checked, and bad ones are reported and not dropped', () => {
  const r = makeRepo({
    'docs/adr/0001-a.md': adr('0001', 'Builds on D-001 and D-099, and on ADR 0002 and ADR 0098.', 'ADR 0097', 'FR-001, FR-999'),
    'docs/adr/0002-b.md': adr('0002'),
    'docs/context/DECISION-REGISTER.md': reg([['D-001', 'X', 'Hosting', 'Enterprise architect']]),
    'docs/context/REQUIREMENTS.md': REQS,
    'docs/context/REQUIREMENTS-TRACEABILITY.md': trace(['| FR-001 | s | v | e | D-001 | – | D-098 | – |', '| FR-002 | s | v | e | – | – | – | – |']),
  });
  const { snapshot } = buildRegister(r.open());
  const a1 = rec(snapshot.records, 'ADR-0001');

  it('flags a cited decision that does not exist, and keeps the valid ones', () => {
    const bad = a1.invalidReferences.filter((x) => x.kind === 'decision').map((x) => x.id).sort();
    assert.deepEqual(bad, ['ADR-0097', 'ADR-0098', 'D-099']);
    assert.ok(a1.dependsOn.includes('ADR-0002') && a1.dependsOn.includes('D-001'), 'valid citations stay');
    assert.equal(a1.invalidReferences.some((x) => x.id === 'ADR-0002' || x.id === 'D-001'), false);
  });

  it('flags a cited requirement that does not exist, and lists the real ones with how they relate', () => {
    assert.deepEqual(a1.invalidReferences.filter((x) => x.kind === 'requirement').map((x) => x.id), ['FR-999']);
    assert.deepEqual(a1.relatedRequirements.map((x) => x.id), ['FR-001']);
    const d1 = rec(snapshot.records, 'D-001');
    const rel = Object.fromEntries(d1.relatedRequirements.map((x) => [x.id, x.relation]));
    assert.equal(rel['FR-001'], 'blocked-until-decided');
  });

  it('turns each invalid reference into a visible flag on the record, with the id in the text', () => {
    for (const id of ['ADR-0097', 'ADR-0098', 'D-099', 'FR-999']) assert.ok(a1.flags.some((f) => f.code === 'invalid-reference' && f.text.includes(id)), id);
  });

  it('reports a traceability row that cites a decision that does not exist, once, with where', () => {
    const hits = snapshot.warnings.filter((w) => w.includes('D-098'));
    assert.equal(hits.length, 1, snapshot.warnings.join('\n'));
    assert.match(hits[0]!, /REQUIREMENTS-TRACEABILITY\.md.*FR-001.*does not exist/);
  });

  it('flags nothing when every reference resolves', () => {
    const ok = makeRepo({ 'docs/adr/0001-a.md': adr('0001', 'See D-001.', 'none', 'FR-001'), 'docs/context/DECISION-REGISTER.md': reg([['D-001', 'X', 'Hosting', 'Enterprise architect']]), 'docs/context/REQUIREMENTS.md': REQS, 'docs/context/REQUIREMENTS-TRACEABILITY.md': trace(['| FR-001 | s | v | e | D-001 | – | – | – |']) });
    const s = buildRegister(ok.open()).snapshot;
    for (const x of s.records) assert.deepEqual(x.invalidReferences, [], x.id);
    assert.deepEqual(s.warnings.filter((w) => /does not exist/.test(w)), []);
  });
});

describe('duplicate ids are detected, not merged', () => {
  it('keeps both records, reports the collision, and fails validation', () => {
    const r = makeRepo({ 'docs/adr/0001-a.md': adr('0001'), 'docs/adr/0001-b.md': adr('0001', 'A different decision with the same number.') });
    const { snapshot } = buildRegister(r.open());
    assert.equal(snapshot.records.filter((x) => x.id === 'ADR-0001').length, 2, 'neither record is dropped or merged');
    assert.ok(snapshot.duplicates.some((d) => d.kind === 'id-collision' && d.a === 'ADR-0001'));
    assert.ok(snapshot.validation.issues.some((i) => i.id === 'ADR-0001' && /more than once/.test(i.message)));
    assert.ok(snapshot.validation.valid < snapshot.validation.checked);
  });
});

describe('record counts reconcile with the files', () => {
  it('one record per ADR file and per register row, counted independently of the parser', () => {
    const files: Record<string, string> = { 'docs/adr/0001-a.md': adr('0001'), 'docs/adr/0002-b.md': adr('0002'), 'docs/adr/0003-c.md': adr('0003'), 'docs/adr/README.md': '# Index\n', 'docs/context/DECISION-REGISTER.md': reg([['D-001', 'C', 'a', 'x'], ['D-002', 'D', 'b', 'x'], ['D-003', 'X', 'c', 'x'], ['D-004', 'C+D', 'd', 'x']]) };
    const r = makeRepo(files);
    const s = buildRegister(r.open()).snapshot;
    const adrFiles = git(r.root, 'ls-tree', '-r', '--name-only', 'HEAD', 'docs/adr').split('\n').filter((f) => /\/\d{4}-.*\.md$/.test(f)).length;
    const rows = (git(r.root, 'show', 'HEAD:docs/context/DECISION-REGISTER.md').match(/^\| D-\d{3} /gm) ?? []).length;
    assert.equal(s.stats.byKind.adr, adrFiles);
    assert.equal(s.stats.byKind['register-entry'], rows);
    assert.equal(s.records.length, adrFiles + rows);
    const byLane = { architecture: 0, stakeholder: 0, verification: 0, unclassified: 0 };
    for (const x of s.records) byLane[reviewLane(x.natures)]++;
    assert.deepEqual(byLane, { architecture: 4, stakeholder: 1, verification: 2, unclassified: 0 }, 'every record is in exactly one lane');
  });
});

describe('statuses and unknown fields', () => {
  it('keeps the status text exactly as written, and leaves an unstated field explicitly unknown', () => {
    const r = makeRepo({ 'docs/adr/0001-a.md': '# ADR 0001: Bare\n\n- **Status:** Accepted (2026-10-28, programme owner, by instruction in chat)\n', 'docs/context/DECISION-REGISTER.md': reg([['D-001', 'C', 'Ports', 'Programme owner']]) });
    const s = buildRegister(r.open()).snapshot;
    const a = rec(s.records, 'ADR-0001');
    assert.equal(a.statusRaw, 'Accepted (2026-10-28, programme owner, by instruction in chat)');
    assert.equal(a.status, 'Approved');
    assert.notEqual(a.approvalBasis, 'signed');
    for (const f of ['description', 'recommendedOption', 'options', 'implications.cost', 'implications.security', 'implications.reliability', 'implications.dataSovereignty']) assert.ok(a.missing.includes(f), f);
    assert.equal(a.implications.cost, null);
    const d = rec(s.records, 'D-001');
    assert.equal(d.statusRaw, 'Open');
    assert.equal(d.recommendedOption, null, 'no option is recommended unless the source says so');
    assert.deepEqual(d.relatedRequirements, []);
  });
});

describe('reading changes nothing', () => {
  it('building the whole read model leaves the repository, its files and its refs exactly as they were', () => {
    const r = makeRepo({ 'docs/adr/0001-a.md': adr('0001', 'See D-001.'), 'docs/context/DECISION-REGISTER.md': reg([['D-001', 'X', 'Hosting', 'Enterprise architect']]), 'docs/context/REQUIREMENTS.md': REQS });
    const snapshotOf = () => {
      const h = crypto.createHash('sha256');
      for (const f of git(r.root, 'ls-files').split('\n').sort()) h.update(f).update(fs.readFileSync(path.join(r.root, f)));
      return { files: h.digest('hex'), head: git(r.root, 'rev-parse', 'HEAD'), refs: git(r.root, 'for-each-ref'), status: git(r.root, 'status', '--porcelain'), index: git(r.root, 'ls-files', '-s') };
    };
    const before = snapshotOf();
    const adapter = r.open();
    buildRegister(adapter);
    buildRegister(adapter);
    adapter.log(5, ['docs/adr/0001-a.md']);
    assert.deepEqual(snapshotOf(), before);
    assert.equal(before.status, '');
  });
});
