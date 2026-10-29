import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, after } from 'node:test';
import { GitRepositoryAdapter } from '../src/lib/repo/git.ts';
import { buildRegister, changesBetween, FileStateStore, MemoryStateStore, syncRegister } from '../src/lib/intel/engine.ts';
import { buildModel } from '../src/lib/repo/build.ts';
import { compareAlternatives } from '../src/lib/intel/compare.ts';
import { diffRegisters } from '../src/lib/intel/diff.ts';
import { validateRecord } from '../src/lib/intel/validate.ts';
import { parseOptions, sectionAt } from '../src/lib/intel/extract.ts';
import { STATUSES, type NormalizedDecision } from '../src/lib/intel/schema.ts';

// ---- helpers: tiny throw-away git repositories, so behaviour is tested on controlled sources

function git(root: string, ...a: string[]) {
  const r = spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

const tmpDirs: string[] = [];
function makeRepo(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-intel-'));
  tmpDirs.push(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@example.invalid');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'core.autocrlf', 'false');
  const commit = (changes: Record<string, string | null>, msg = 'change') => {
    for (const [p, c] of Object.entries(changes)) {
      const f = path.join(root, p);
      if (c === null) fs.rmSync(f, { force: true });
      else {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, c);
      }
    }
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', msg);
    return git(root, 'rev-parse', 'HEAD');
  };
  const first = commit(files, 'initial');
  const open = (ref = 'HEAD') => new GitRepositoryAdapter(root, ref).open();
  return { root, commit, open, first };
}

const adr = (n: string, status: string, extra: { title?: string; review?: string; body?: string; supersedes?: string; options?: string } = {}) =>
  `# ADR ${n}: ${extra.title ?? `Decision number ${n}`}\n\n- **Status:** ${status}\n- **Type:** Design\n- **Date:** 2026-10-28\n- **Deciders:** Programme owner\n- **Supersedes:** ${extra.supersedes ?? 'none'}\n${extra.review ? `- **Review:** ${extra.review}\n` : ''}\n## Context\nSome context.\n\n## Options considered\n\n${extra.options ?? '1. **A. Do nothing.** Not selected.\n2. **B. Build it (selected).** Trade-offs: costs more.'}\n\n## Decision\n${extra.body ?? 'Build it.'}\n`;
const REGISTER = `# Register\n\n| ID | Kind | Decision or clarification needed | Why it matters | Known options (none chosen) | Owner role | Needed by | Status |\n|---|---|---|---|---|---|---|---|\n| D-001 | C | Which ports are in scope | Drives hosting | One port; many ports | Programme owner | M1 | Open |\n`;
const REVIEW = (st: string) => `# RV-0001: review\n\n- **Review ID:** RV-0001\n- **Design:** DES-0001\n- **Status:** ${st}\n- **Decider:** pending\n`;

after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('status normalisation', () => {
  it('maps every recorded status without promoting anything', () => {
    const r = makeRepo({
      'docs/adr/0001-a.md': adr('0001', 'Accepted (2026-10-28, programme owner, by instruction in chat)'),
      'docs/adr/0002-b.md': adr('0002', 'Rejected (2026-10-28, programme owner)'),
      'docs/adr/0003-c.md': adr('0003', 'Superseded by ADR 0009'),
      'docs/adr/0004-d.md': adr('0004', 'Deferred'),
      'docs/adr/0005-e.md': adr('0005', 'Proposed'),
      'docs/adr/0006-f.md': adr('0006', 'Proposed', { review: 'RV-0001' }),
      'docs/architecture/reviews/RV-0001-x.md': REVIEW('Blocked'),
      'docs/context/DECISION-REGISTER.md': REGISTER,
    });
    const { snapshot } = buildRegister(r.open());
    const st = Object.fromEntries(snapshot.records.map((x) => [x.id, x.status]));
    assert.deepEqual(st, { 'ADR-0001': 'Approved', 'ADR-0002': 'Rejected', 'ADR-0003': 'Superseded', 'ADR-0004': 'Deferred', 'ADR-0005': 'Proposed', 'ADR-0006': 'Blocked', 'D-001': 'Pending Review' });
    for (const x of snapshot.records) assert.ok((STATUSES as readonly string[]).includes(x.status));
    const rec = snapshot.records.find((x) => x.id === 'ADR-0001')!;
    assert.equal(rec.approvalBasis, 'owner-instruction-unsigned');
    assert.ok(rec.flags.some((f) => f.code === 'unsigned'));
  });

  it('keeps approved decisions approved and rejected decisions rejected across unrelated changes', () => {
    const r = makeRepo({ 'docs/adr/0001-a.md': adr('0001', 'Accepted (2026-10-28, programme owner)'), 'docs/adr/0002-b.md': adr('0002', 'Rejected (2026-10-28, owner)'), 'docs/adr/0003-c.md': adr('0003', 'Proposed') });
    const before = buildRegister(r.open()).snapshot.records;
    r.commit({ 'docs/adr/0003-c.md': adr('0003', 'Proposed', { body: 'Reworded decision text.' }), 'docs/README.md': '# readme\n' });
    const after2 = buildRegister(r.open()).snapshot.records;
    const status = (rs: NormalizedDecision[], id: string) => rs.find((x) => x.id === id)!.status;
    assert.equal(status(after2, 'ADR-0001'), 'Approved');
    assert.equal(status(after2, 'ADR-0002'), 'Rejected');
    assert.equal(status(after2, 'ADR-0003'), 'Proposed');
    assert.equal(before.find((x) => x.id === 'ADR-0001')!.contentHash, after2.find((x) => x.id === 'ADR-0001')!.contentHash);
  });

  it('an unrecognised status is shown as Proposed and flagged, never as Approved', () => {
    const r = makeRepo({ 'docs/adr/0001-a.md': adr('0001', 'Probably fine') });
    const rec = buildRegister(r.open()).snapshot.records[0]!;
    assert.equal(rec.status, 'Proposed');
    assert.ok(rec.flags.length > 0);
  });
});

describe('missing fields are not fabricated', () => {
  it('a bare ADR yields nulls, empty lists and an honest missing list', () => {
    const r = makeRepo({ 'docs/adr/0001-a.md': '# ADR 0001: Bare\n\n- **Status:** Proposed\n' });
    const { snapshot } = buildRegister(r.open());
    const rec = snapshot.records[0]!;
    assert.equal(rec.description, null);
    assert.equal(rec.businessJustification, null);
    assert.equal(rec.category, null);
    assert.equal(rec.priority, null);
    assert.equal(rec.recommendedOption, null);
    assert.deepEqual(rec.options, []);
    assert.equal(rec.decisionDate, null);
    assert.equal(rec.decisionOwner, null);
    assert.equal(rec.requiredApproverRole, null);
    assert.deepEqual(Object.values(rec.implications), [null, null, null, null, null]);
    assert.deepEqual(rec.approvalHistory, []);
    assert.deepEqual(rec.evidence, []);
    assert.deepEqual(rec.rubric, []);
    for (const f of ['description', 'businessJustification', 'category', 'priority', 'recommendedOption', 'options', 'decisionOwner', 'decisionDate', 'implications.cost', 'evidence', 'rubric', 'approvalHistory']) assert.ok(rec.missing.includes(f), `${f} should be listed as missing`);
    assert.equal(snapshot.validation.valid, 1, JSON.stringify(snapshot.validation.issues));
  });

  it('register entries have no recommended option, no pros or cons and no implications', () => {
    const r = makeRepo({ 'docs/context/DECISION-REGISTER.md': REGISTER });
    const rec = buildRegister(r.open()).snapshot.records[0]!;
    assert.equal(rec.recommendedOption, null);
    assert.equal(rec.options.length, 2);
    for (const o of rec.options) assert.deepEqual([o.pros, o.cons, o.conditional, o.unknown, o.disposition, o.tradeoffs], [[], [], [], [], null, null]);
    assert.deepEqual(Object.values(rec.implications), [null, null, null, null, null]);
    assert.equal(rec.priority, null);
    assert.ok(rec.missing.includes('recommendedOption'));
  });

  it('priority comes only from requirements that trace to the decision', () => {
    const r = makeRepo({
      'docs/context/DECISION-REGISTER.md': REGISTER,
      'docs/context/REQUIREMENTS.md': '| ID | Caps | Requirement | Cls | Pri | Business justification | Acceptance criteria |\n|---|---|---|---|---|---|---|\n| FR-001 | X | Do a thing | A | Should | why | ok |\n| FR-002 | X | Do more | A | Must | why | ok |\n',
      'docs/context/REQUIREMENTS-TRACEABILITY.md': '| ID | Source | Validation method | Evidence required | Decisions | Depends on | Open (C) | Verify (D) |\n|---|---|---|---|---|---|---|---|\n| FR-001 | s | v | e | D-001 | – | – | – |\n| FR-002 | s | v | e | – | – | – | – |\n',
    });
    const rec = buildRegister(r.open()).snapshot.records[0]!;
    assert.equal(rec.priority?.value, 'Should');
    assert.deepEqual(rec.blockingRequirements, [{ id: 'FR-001', priority: 'Should' }]);
  });
});

describe('duplicate detection', () => {
  it('finds identical titles, similar titles, id collisions and supersession gaps', () => {
    const r = makeRepo({
      'docs/adr/0001-a.md': adr('0001', 'Accepted (2026-10-28, owner)', { title: 'Hold delivery measurements in jurisdiction local stores' }),
      'docs/adr/0002-b.md': adr('0002', 'Proposed', { title: 'Hold delivery measurements in jurisdiction local stores' }),
      'docs/adr/0003-c.md': adr('0003', 'Proposed', { title: 'Keep delivery measurement data in jurisdiction-local authoritative stores' }),
      'docs/adr/0004-d.md': adr('0004', 'Proposed', { title: 'Choose the certificate signing mechanism' }),
      'docs/adr/0004-e.md': adr('0004', 'Proposed', { title: 'A second file claiming the same number' }),
      'docs/adr/0005-f.md': adr('0005', 'Accepted (2026-10-28, owner)', { title: 'Replacement for the first', supersedes: 'ADR 0001' }),
    });
    const { snapshot } = buildRegister(r.open());
    const kinds = (a: string, b: string) => snapshot.duplicates.filter((d) => (d.a === a && d.b === b) || (d.a === b && d.b === a)).map((d) => d.kind);
    assert.ok(kinds('ADR-0001', 'ADR-0002').includes('exact-title'));
    assert.ok(kinds('ADR-0001', 'ADR-0003').includes('similar') || kinds('ADR-0002', 'ADR-0003').includes('similar'));
    assert.ok(snapshot.duplicates.some((d) => d.kind === 'id-collision' && d.a === 'ADR-0004'));
    assert.ok(snapshot.duplicates.some((d) => d.kind === 'supersession-gap' && d.a === 'ADR-0005' && d.b === 'ADR-0001'));
    assert.ok(snapshot.validation.issues.some((i) => i.id === 'ADR-0004' && /more than once/.test(i.message)));
    // detection never merges or hides: all records are still present
    assert.equal(snapshot.records.length, 6);
  });

  it('does not flag unrelated decisions', () => {
    const r = makeRepo({ 'docs/adr/0001-a.md': adr('0001', 'Proposed', { title: 'Choose the certificate signing mechanism' }), 'docs/adr/0002-b.md': adr('0002', 'Proposed', { title: 'Select the edge buffering approach' }) });
    assert.deepEqual(buildRegister(r.open()).snapshot.duplicates, []);
  });
});

describe('change detection and incremental synchronisation', () => {
  it('reports the first sync as initial, then exactly what changed, and re-parses only changed files', () => {
    const r = makeRepo({
      'docs/adr/0001-a.md': adr('0001', 'Accepted (2026-10-28, programme owner)'),
      'docs/adr/0002-b.md': adr('0002', 'Proposed'),
      'docs/adr/0003-c.md': adr('0003', 'Proposed', { title: 'Removed later' }),
      'docs/context/DECISION-REGISTER.md': REGISTER,
      'docs/other.md': '# Other\nCites D-001.\n',
    });
    const store = new MemoryStateStore();
    const s1 = syncRegister(r.open(), store, () => '2026-10-30T00:00:00.000Z');
    assert.equal(s1.changes.initial, true);
    assert.equal(s1.changes.counts.added, 4);
    assert.equal(s1.snapshot.stats.filesReused, 0);

    // nothing changed: nothing reported, nothing re-parsed
    const s2 = syncRegister(r.open(), store);
    assert.equal(s2.changes.initial, false);
    assert.deepEqual([s2.changes.counts.added, s2.changes.counts.removed, s2.changes.counts.changed], [0, 0, 0]);
    assert.equal(s2.snapshot.stats.filesReparsed, 0);

    r.commit({ 'docs/adr/0002-b.md': adr('0002', 'Accepted (2026-10-30, programme owner)'), 'docs/adr/0003-c.md': null, 'docs/adr/0004-d.md': adr('0004', 'Proposed', { title: 'Brand new' }) });
    const s3 = syncRegister(r.open(), store);
    const by = Object.fromEntries(s3.changes.records.map((c) => [c.id, c]));
    assert.equal(by['ADR-0002']?.kind, 'changed');
    assert.deepEqual(by['ADR-0002']?.fields.find((f) => f.field === 'status'), { field: 'status', from: 'Proposed', to: 'Approved' });
    assert.ok(by['ADR-0002']!.alerts.some((a) => /became Approved/.test(a)));
    assert.equal(by['ADR-0003']?.kind, 'removed');
    assert.equal(by['ADR-0004']?.kind, 'added');
    assert.equal(by['ADR-0001'], undefined, 'an untouched decision must not appear');
    assert.deepEqual(s3.changes.files.map((f) => `${f.change}:${f.path}`).sort(), ['added:docs/adr/0004-d.md', 'changed:docs/adr/0002-b.md', 'removed:docs/adr/0003-c.md']);
    assert.equal(s3.snapshot.stats.filesReparsed, 2, 'only the two files with a new blob are parsed again');
    assert.equal(s3.snapshot.stats.filesRemoved, 1);
  });

  it('an incremental result equals a full rebuild', () => {
    const r = makeRepo({ 'docs/adr/0001-a.md': adr('0001', 'Proposed'), 'docs/adr/0002-b.md': adr('0002', 'Proposed'), 'docs/context/DECISION-REGISTER.md': REGISTER });
    const store = new MemoryStateStore();
    syncRegister(r.open(), store);
    r.commit({ 'docs/adr/0001-a.md': adr('0001', 'Accepted (2026-10-30, programme owner)'), 'docs/context/DECISION-REGISTER.md': REGISTER.replace('Open', 'Open') + '| D-002 | X | Another | Why | A; B | Architect | M2 | Open |\n' });
    const inc = syncRegister(r.open(), store).snapshot.records;
    const full = buildRegister(r.open()).snapshot.records;
    assert.deepEqual(JSON.parse(JSON.stringify(inc)), JSON.parse(JSON.stringify(full)));
  });

  it('flags an Approved decision that stops being Approved, and a Rejected one that is reopened', () => {
    const r = makeRepo({ 'docs/adr/0001-a.md': adr('0001', 'Accepted (2026-10-28, owner)'), 'docs/adr/0002-b.md': adr('0002', 'Rejected (2026-10-28, owner)') });
    const a = r.first;
    r.commit({ 'docs/adr/0001-a.md': adr('0001', 'Proposed'), 'docs/adr/0002-b.md': adr('0002', 'Proposed') });
    const c = changesBetween(r.open(a), r.open());
    const alerts = c.records.flatMap((x) => x.alerts).join(' | ');
    assert.match(alerts, /ADR-0001 was Approved and is now Proposed/);
    assert.match(alerts, /ADR-0002 was Rejected and is now Proposed/);
    assert.equal(c.fromCommit, a);
  });

  it('detects an unreviewed jump to Approved with no history, and compares two commits', () => {
    const r = makeRepo({ 'docs/adr/0001-a.md': adr('0001', 'Proposed') });
    const first = r.first;
    r.commit({ 'docs/adr/0001-a.md': adr('0001', 'Accepted') });
    const c = changesBetween(r.open(first), r.open());
    assert.equal(c.counts.changed, 1);
    assert.ok(c.counts.alerts >= 1);
    assert.match(c.records[0]!.alerts.join(' '), /became Approved/);
  });

  it('persists the baseline in the Studio cache folder and never in the repository', () => {
    const r = makeRepo({ 'docs/adr/0001-a.md': adr('0001', 'Proposed') });
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-cache-'));
    tmpDirs.push(cache);
    const before = git(r.root, 'status', '--porcelain') + git(r.root, 'rev-parse', 'HEAD');
    const store = new FileStateStore(cache);
    syncRegister(r.open(), store);
    assert.ok(fs.existsSync(store.file));
    assert.equal(git(r.root, 'status', '--porcelain') + git(r.root, 'rev-parse', 'HEAD'), before);
    assert.equal(syncRegister(r.open(), store).snapshot.stats.filesReparsed, 0, 'a new process reuses the saved fragments');
  });
});

describe('parsers', () => {
  it('reads options, letters, dispositions and trade-offs from ADR text', () => {
    const text = '## Options considered\n\n1. **A. Do nothing.** Leave it. Trade-offs: no binding. Not selected.\n2. **B. Central store.** One store. **Rejected (hard constraint):** breaks HC-01.\n3. **Native-first (chosen).** Trade-offs: less automation.\n4. **Federated (option D).** Later. Deferred: unknown.\n';
    const o = parseOptions(sectionAt(text, 'Options considered'));
    assert.deepEqual(o.map((x) => [x.key, x.disposition]), [['A', 'Not selected'], ['B', 'Rejected (hard constraint)'], ['#3', 'Chosen'], ['D', 'Deferred']]);
    assert.equal(o[0]!.tradeoffs, 'no binding. Not selected.');
    assert.equal(o[2]!.name, 'Native-first');
  });

  it('section lines point at the real line in the file', () => {
    const text = '# T\n\n## Decision\n\nBody line\n';
    const s = sectionAt(text, 'Decision')!;
    assert.equal(text.split('\n')[s.line - 1], 'Body line');
  });
});

describe('schema validation', () => {
  const rec = () => buildRegister(makeRepo({ 'docs/adr/0001-a.md': adr('0001', 'Accepted (2026-10-28, owner, by instruction in chat)') }).open()).snapshot.records[0]!;
  it('accepts a normal record', () => assert.deepEqual(validateRecord(rec()), []));
  it('rejects the cases that would hide a governance problem', () => {
    const bad = (m: (r: NormalizedDecision) => void) => {
      const r = JSON.parse(JSON.stringify(rec())) as NormalizedDecision;
      m(r);
      return validateRecord(r).map((i) => i.field + ': ' + i.message).join(' | ');
    };
    assert.match(bad((r) => (r.status = 'Maybe' as never)), /seven statuses/);
    assert.match(bad((r) => (r.approvalHistory = [])), /Approved without any approval event/);
    assert.match(bad((r) => (r.approvalBasis = 'signed')), /says signed/);
    assert.match(bad((r) => (r.source.commit = 'abc')), /40-character/);
    assert.match(bad((r) => r.missing.push('decisionOwner')), /populated but listed as missing/);
    assert.match(bad((r) => (r.missing = r.missing.filter((m) => m !== 'priority'))), /empty but not listed/);
    assert.match(bad((r) => (r.implications.cost = { text: 'x', src: { path: '', line: 0, rule: '' } })), /recorded source|needs a path/);
    assert.match(bad((r) => r.options.push({ key: 'Z', name: 'z', summary: null, disposition: null, recommended: false, tradeoffs: null, pros: [{ text: 'free pro', src: { path: '', line: 0 }, basis: 'recorded' }], cons: [], conditional: [], unknown: [], mapping: null, matrixColumn: null, src: { path: 'p', line: 1 } })), /recorded text with a source/);
  });
});

describe('AI suggestions stay separate and labelled', () => {
  const SUG = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ schema: 'x', suggestions: [{ id: 'S-001', decisionId: 'ADR-0001', optionKey: 'B', kind: 'pro', text: 'It may be simpler.', rationale: 'General practice.', basedOn: ['ADR-0001', 'docs/adr/0001-a.md'], label: 'AI SUGGESTION', reviewState: 'unreviewed', generatedBy: { kind: 'ai', tool: 'test', date: '2026-10-30' }, ...over }] }, null, 2);

  it('never changes the record: records are identical with and without the suggestions file', () => {
    const base = { 'docs/adr/0001-a.md': adr('0001', 'Proposed') };
    const without = makeRepo(base);
    const withS = makeRepo({ ...base, 'docs/architecture-studio/suggestions/s.json': SUG() });
    const a = buildRegister(without.open()).snapshot;
    const b = buildRegister(withS.open()).snapshot;
    assert.equal(b.suggestions.length, 1);
    assert.equal(b.suggestions[0]!.label, 'AI SUGGESTION');
    assert.equal(b.suggestions[0]!.reviewState, 'unreviewed');
    const strip = (rs: NormalizedDecision[]) => JSON.stringify(rs, (k, v) => (k === 'commit' || k === 'blob' ? undefined : v));
    assert.equal(strip(a.records), strip(b.records));
    assert.ok(b.records[0]!.options.every((o) => o.pros.every((p) => p.basis === 'recorded')));
  });

  it('rejects anything that could grant approval, invent evidence or smuggle in confidence', () => {
    const base = { 'docs/adr/0001-a.md': adr('0001', 'Proposed') };
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ['a status field', { status: 'Approved' }, /unknown field "status"/],
      ['a confidence score', { confidence: 0.99 }, /unknown field "confidence"/],
      ['a reviewed state', { reviewState: 'reviewed' }, /reviewState/],
      ['an unlabelled suggestion', { label: 'FACT' }, /label/],
      ['an unknown decision', { decisionId: 'ADR-0099' }, /decisionId/],
      ['an unknown option', { optionKey: 'Q' }, /optionKey/],
      ['invented evidence', { basedOn: ['EV-9999'] }, /basedOn/],
      ['a missing author', { generatedBy: { kind: 'human' } }, /generatedBy/],
    ];
    for (const [name, over, re] of cases) {
      const r = makeRepo({ ...base, 'docs/architecture-studio/suggestions/s.json': SUG(over) });
      const snap = buildRegister(r.open()).snapshot;
      assert.equal(snap.suggestions.length, 0, `${name} must be rejected`);
      assert.match(snap.warnings.join('\n'), re, name);
    }
  });

  it('shows suggestions beside recorded material in Compare Alternatives, never inside it', () => {
    const r = makeRepo({ 'docs/adr/0001-a.md': adr('0001', 'Proposed'), 'docs/architecture-studio/suggestions/s.json': SUG() });
    const { snapshot } = buildRegister(r.open());
    const v = compareAlternatives(snapshot.records[0]!, snapshot.suggestions);
    const b = v.options.find((o) => o.key === 'B')!;
    assert.equal(b.recorded.pros.length, 0);
    assert.equal(b.suggested.pros.length, 1);
    assert.equal(v.recommendedKey, 'B');
    assert.equal(v.options[0]!.key, 'B', 'the recommended option comes first');
  });
});

// ---- the real repository

const root = GitRepositoryAdapter.findRoot(process.cwd());
describe('the real repository populates the register', () => {
  let adapter: GitRepositoryAdapter;
  let snap: ReturnType<typeof buildRegister>['snapshot'];
  let snapshotFile: { counts: Record<string, any> };
  before(() => {
    adapter = new GitRepositoryAdapter(root, 'HEAD').open();
    snap = buildRegister(adapter).snapshot;
    snapshotFile = JSON.parse(adapter.read('docs/architecture-studio/inventory.snapshot.json') ?? '{}');
  });

  it('has one record per ADR and per register entry, matching the independent discovery counts', () => {
    assert.equal(snap.stats.byKind.adr, snapshotFile.counts.adr.total);
    assert.equal(snap.stats.byKind['register-entry'], snapshotFile.counts.decisionRegister.total);
    assert.equal(snap.stats.byStatus.Approved, snapshotFile.counts.adr.byClass.Accepted);
    const proposed = snap.stats.byStatus.Proposed + snap.stats.byStatus.Blocked;
    assert.equal(proposed, snapshotFile.counts.adr.byClass.Proposed, 'every Proposed ADR is Proposed or Blocked, never Approved');
    assert.equal(snap.stats.byStatus['Pending Review'], snapshotFile.counts.decisionRegister.byStatus.Open);
    assert.equal(snap.stats.byStatus.Rejected, snapshotFile.counts.adr.rejected);
  });

  it('passes schema validation for every record', () => {
    assert.deepEqual(snap.validation.issues, []);
    assert.equal(snap.validation.valid, snap.validation.checked);
  });

  it('preserves provenance: commit, blob, file and line are real for every record and every claim', () => {
    const lines = (p: string) => (adapter.read(p) ?? '').split('\n').length;
    for (const r of snap.records) {
      assert.equal(r.source.commit, adapter.commit);
      assert.equal(r.source.blob, git(root, 'rev-parse', `${adapter.commit}:${r.source.path}`), `${r.id} blob`);
      assert.ok(r.source.line >= 1 && r.source.line <= lines(r.source.path), `${r.id} line`);
      if (r.kind === 'register-entry') assert.ok((adapter.read(r.source.path) ?? '').split('\n')[r.source.line - 1]!.includes(r.id), `${r.id} register row`);
      const srcs = [
        ...Object.values(r.fieldSources),
        ...r.options.flatMap((o) => [o.src, ...[...o.pros, ...o.cons, ...o.conditional, ...o.unknown].map((c) => c.src)]),
        ...r.approvalHistory.map((e) => e.src),
        ...r.evidence.flatMap((e) => (e.src ? [e.src] : [])),
        ...r.rubric.map((x) => x.src),
      ];
      for (const s of srcs) {
        assert.ok(adapter.has(s.path), `${r.id}: ${s.path} is not in the tree`);
        assert.ok(s.line >= 1 && s.line <= lines(s.path), `${r.id}: ${s.path}:${s.line} is out of range`);
      }
    }
  });

  it('keeps existing Accepted ADRs Approved (unsigned) and Proposed ADRs unapproved', () => {
    const accepted = snap.records.filter((r) => r.kind === 'adr' && /^Accepted/.test(r.statusRaw));
    assert.ok(accepted.length >= 13);
    for (const r of accepted) {
      assert.equal(r.status, 'Approved', r.id);
      assert.notEqual(r.approvalBasis, 'signed', `${r.id}: no signed approval record exists in this repository`);
    }
    for (const r of snap.records.filter((x) => x.kind === 'adr' && /^Proposed/.test(x.statusRaw))) assert.ok(['Proposed', 'Blocked'].includes(r.status), r.id);
    assert.equal(snap.records.filter((r) => r.kind === 'register-entry' && r.status !== 'Pending Review').length, 0);
  });

  it('agrees with the legacy parser on ids and statuses', () => {
    const model = buildModel(adapter);
    const ids = snap.records.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual([...model.decisions.map((d) => d.id)].sort(), [...ids].sort());
    for (const d of model.decisions) {
      const r = snap.records.find((x) => x.id === d.id)!;
      const ok = d.status === 'accepted' ? ['Approved'] : d.status === 'open' ? ['Pending Review'] : d.status === 'proposed' ? ['Proposed', 'Blocked'] : d.status === 'rejected' ? ['Rejected'] : d.status === 'superseded' ? ['Superseded'] : ['Deferred'];
      assert.ok(ok.includes(r.status), `${d.id}: legacy ${d.status} but register ${r.status}`);
      assert.equal(r.statusRaw, d.statusRaw);
      assert.equal(r.source.path, d.src.path);
    }
  });

  it('fills pros, cons and the recommended option only from the design comparison and ADR text', () => {
    const a = snap.records.find((r) => r.id === 'ADR-0004')!;
    assert.equal(a.recommendedOption?.key, 'C');
    assert.equal(a.options.length, 5);
    assert.ok(a.comparison && a.comparison.columns.length === 5);
    const b = a.options.find((o) => o.key === 'B')!;
    assert.equal(b.disposition, 'Rejected (hard constraint)');
    assert.ok(b.cons.some((c) => /Residency/.test(c.text)));
    assert.ok(b.cons.every((c) => c.src.path.startsWith('docs/architecture/designs/')));
    const reg = snap.records.find((r) => r.id === 'D-013')!;
    assert.ok(reg.options.length >= 3);
    assert.ok(reg.options.every((o) => !o.pros.length && !o.cons.length), 'a register entry has no recorded pros or cons');
    assert.equal(reg.recommendedOption, null);
  });

  it('records blocking requirements, evidence, rubric and approval history where the repository states them', () => {
    const a = snap.records.find((r) => r.id === 'ADR-0004')!;
    assert.ok(a.evidence.some((e) => e.kind === 'test-run' && e.resolved));
    assert.ok(a.relatedReviews.includes('RV-0001'));
    const d = snap.records.find((r) => r.id === 'D-009')!;
    assert.ok(d.blockingRequirements.length > 0);
    const one = snap.records.find((r) => r.id === 'ADR-0001')!;
    assert.ok(one.approvalHistory.some((e) => e.type === 'status-line' && e.date === '2026-10-28'));
    assert.ok(snap.records.some((r) => r.rubric.length > 0));
  });

  it('shows AI suggestions as separate, labelled and unreviewed', () => {
    assert.ok(snap.suggestions.length > 0, 'the committed suggestions file should load');
    assert.deepEqual(snap.warnings.filter((w) => /rejected/.test(w)), []);
    for (const s of snap.suggestions) assert.deepEqual([s.label, s.reviewState, s.generatedBy.kind], ['AI SUGGESTION', 'unreviewed', 'ai']);
    const d010 = snap.records.find((r) => r.id === 'D-010')!;
    const v = compareAlternatives(d010, snap.suggestions);
    assert.ok(v.options.every((o) => o.recorded.pros.length === 0 && o.recorded.cons.length === 0));
    assert.ok(v.options.some((o) => o.suggested.pros.length > 0));
  });

  it('incremental re-read of the real repository reuses every file and equals a full build', () => {
    const cache = new Map<string, any>();
    const first = buildRegister(adapter, cache);
    const second = buildRegister(adapter, cache);
    assert.equal(second.snapshot.stats.filesReparsed, 0);
    assert.equal(second.snapshot.stats.filesReused, first.snapshot.stats.filesRead);
    assert.equal(JSON.stringify(first.snapshot.records), JSON.stringify(second.snapshot.records));
  });

  it('diffing a register with itself reports nothing', () => {
    const c = diffRegisters(snap.records, snap.records, adapter.commit, adapter.commit);
    assert.deepEqual([c.counts.added, c.counts.removed, c.counts.changed, c.counts.alerts], [0, 0, 0, 0]);
  });
});
