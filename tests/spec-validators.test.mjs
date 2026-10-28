import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runUtility, UTILITIES, resolveSpecPath, SCHEMAS, canonical, sha256 } from '../harness/scripts/spec-validators.mjs';
import { placement, lineage, method, certificates, resealChain, FIXTURES } from './support/builders.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clone = (v) => JSON.parse(JSON.stringify(v));
const roots = [];
process.on('exit', () => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

// A small sandbox with only what the validators read: the context documents, ADRs and the fixture under test.
function sandbox(files = {}, edits = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gf-spec-'));
  roots.push(root);
  cpSync(path.join(repo, 'docs', 'context'), path.join(root, 'docs', 'context'), { recursive: true });
  cpSync(path.join(repo, 'docs', 'adr'), path.join(root, 'docs', 'adr'), { recursive: true });
  cpSync(path.join(repo, 'docs', 'state'), path.join(root, 'docs', 'state'), { recursive: true });
  cpSync(path.join(repo, 'PROBLEMSTATEMENT.md'), path.join(root, 'PROBLEMSTATEMENT.md'));
  for (const [rel, fn] of Object.entries(edits)) {
    const p = path.join(root, rel);
    const before = readFileSync(p, 'utf8');
    const after = fn(before);
    assert.notEqual(after, before, `edit of ${rel} changed nothing`);
    writeFileSync(p, after);
  }
  for (const [rel, doc] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), typeof doc === 'string' ? doc : JSON.stringify(doc, null, 2));
  }
  return root;
}

const FX = { sovereignty: 'tests/fixtures/sovereignty', 'evidence-lineage': 'tests/fixtures/lineage', 'emissions-methods': 'tests/fixtures/emissions-methods', 'certificate-integrity': 'tests/fixtures/certificates' };
function check(name, doc, edits = {}) {
  const rel = `${FX[name]}/doc.json`;
  const root = sandbox({ [rel]: doc }, edits);
  return runUtility(name, root, rel);
}
const msgs = (r) => r.errors.map((e) => e.msg);
const expectFail = (r, re) => { assert.equal(r.status, 'FAIL', `expected FAIL, got ${r.status}`); assert.ok(msgs(r).some((m) => re.test(m)), `expected ${re}; got:\n${msgs(r).join('\n')}`); };
const mutate = (doc, fn) => { const d = clone(doc); fn(d); return d; };

// ---------- committed fixtures ----------
test('committed fixtures are exactly what the builders produce and pass their validators', () => {
  for (const [rel, build] of Object.entries(FIXTURES)) assert.deepEqual(JSON.parse(readFileSync(path.join(repo, rel), 'utf8')), build(), `${rel} is stale; run node tests/support/builders.mjs --write`);
  for (const [name, dir] of Object.entries(FX)) {
    const r = runUtility(name, repo, dir);
    assert.equal(r.status, 'PASS', `${name}: ${msgs(r).join('; ')}`);
    assert.ok(r.checked >= 1);
  }
});

test('with no specifications present the data-contract validators say EMPTY, never PASS', () => {
  for (const name of ['evidence-lineage', 'emissions-methods', 'certificate-integrity']) {
    const r = runUtility(name, repo);
    assert.equal(r.status, 'EMPTY', name);
    assert.ok(r.notes.some((n) => /nothing was checked/.test(n)), name);
  }
  const s = runUtility('sovereignty', repo);
  assert.equal(s.status, 'PASS');
  assert.ok(s.notes.some((n) => /only the matrix itself was checked/.test(n)));
});

test('every utility is registered, named, and states what it validates', () => {
  assert.deepEqual(Object.keys(UTILITIES).sort(), ['agent-permissions', 'architecture', 'certificate-integrity', 'deployment-readiness', 'emissions-methods', 'evidence-lineage', 'requirements', 'sovereignty', 'tools']);
  for (const u of Object.values(UTILITIES)) assert.ok(u.validates.length > 20);
  assert.equal(runUtility('validate-requirements', repo).name, 'requirements');
  assert.throws(() => runUtility('validate-everything', repo), /unknown utility/);
  assert.throws(() => runUtility('constructor', repo), /unknown utility/);
});

// ---------- path handling ----------
test('path arguments cannot leave the specification and fixture folders', () => {
  for (const p of ['../outside', '/etc/passwd', 'C:\\Windows', 'harness/policy', 'docs/context', 'docs', '.', 'docs/specs/../../harness', 'tests/fixtures/../../harness']) assert.throws(() => resolveSpecPath(repo, p), /path must be/, p);
  assert.doesNotThrow(() => resolveSpecPath(repo, 'docs/specs'));
  assert.doesNotThrow(() => resolveSpecPath(repo, 'tests/fixtures/lineage/valid-lineage.json'));
});

test('invalid JSON and oversized files are reported, not thrown', () => {
  const root = sandbox({ 'tests/fixtures/lineage/bad.json': '{ not json', 'tests/fixtures/lineage/huge.json': `"${'x'.repeat(1_100_000)}"` });
  const r = runUtility('evidence-lineage', root, 'tests/fixtures/lineage');
  assert.equal(r.status, 'FAIL');
  assert.ok(msgs(r).some((m) => /invalid JSON/.test(m)) && msgs(r).some((m) => /larger than/.test(m)));
});

// ---------- sovereignty ----------
test('sovereignty: placements that the matrix forbids or leaves undecided are rejected', () => {
  const p = placement();
  expectFail(check('sovereignty', mutate(p, (d) => { d.placements[0].zone = 'Z4'; d.placements[0].flowId = 'F-07'; })), /prohibited by the matrix/);
  expectFail(check('sovereignty', mutate(p, (d) => { d.placements[0].zone = 'Z6'; d.placements[0].flowId = 'F-09'; })), /prohibited by the matrix/);
  expectFail(check('sovereignty', mutate(p, (d) => { d.placements[0].dataClass = 'DC-09'; })), /not applicable/);
  const cond = check('sovereignty', mutate(p, (d) => { d.placements[1].zone = 'Z3'; d.placements[1].dataClass = 'DC-06'; d.placements[1].flowId = 'F-01'; }));
  expectFail(cond, /needs approvedBy naming an Accepted ADR/);
  assert.ok(msgs(cond).some((m) => /decision D-011 is still open/.test(m)));
  expectFail(check('sovereignty', mutate(p, (d) => { d.placements[1].zone = 'Z3'; d.placements[1].dataClass = 'DC-06'; d.placements[1].flowId = 'F-01'; d.placements[1].approvedBy = 'ADR-0004'; })), /decision D-011 is still open/);
});

test('sovereignty: a region is not residency evidence, outside placements cite a known flow, unknown names fail', () => {
  const p = placement();
  expectFail(check('sovereignty', mutate(p, (d) => { d.placements[1].residencyBasis = 'region'; })), /cloud region is not a residency control/);
  expectFail(check('sovereignty', mutate(p, (d) => { d.placements[1].residencyBasis = 'azure-region'; })), /cloud region is not a residency control/);
  expectFail(check('sovereignty', mutate(p, (d) => { delete d.placements[3].flowId; })), /must cite a flow id/);
  expectFail(check('sovereignty', mutate(p, (d) => { d.placements[3].flowId = 'F-99'; })), /must cite a flow id/);
  expectFail(check('sovereignty', mutate(p, (d) => { d.placements[0].dataClass = 'DC-99'; })), /unknown data class/);
  expectFail(check('sovereignty', mutate(p, (d) => { d.placements[0].zone = 'Z9'; })), /unknown zone/);
  expectFail(check('sovereignty', mutate(p, (d) => { d.schema = 'x'; })), /schema must be/);
  expectFail(check('sovereignty', mutate(p, (d) => { d.placements = []; })), /non-empty array/);
  expectFail(check('sovereignty', mutate(p, (d) => { d.jurisdiction = ''; })), /jurisdiction is required/);
});

test('sovereignty: a placement becomes legitimate only when the decision is Decided and an Accepted ADR is cited', () => {
  const p = mutate(placement(), (d) => { d.placements[1].zone = 'Z3'; d.placements[1].dataClass = 'DC-06'; d.placements[1].flowId = 'F-01'; d.placements[1].approvedBy = 'ADR-0003'; });
  const decided = check('sovereignty', p, { 'docs/context/DECISION-REGISTER.md': (t) => t.replace(/(\| D-011 \|.*\| )Open( \|)/, '$1Decided (ADR-0003)$2') });
  assert.equal(decided.status, 'PASS', msgs(decided).join('; '));
});

test('sovereignty: the matrix itself is checked against the classification and the register', () => {
  const edit = (fn) => runUtility('sovereignty', sandbox({}, { 'docs/context/SOVEREIGNTY-MATRIX.md': fn }));
  expectFail(edit((t) => t.replace('| DC-01 Raw delivery measurement data | Yes | Yes | No | No |', '| DC-01 Raw delivery measurement data | Yes | Yes | No | Yes |')), /DC-01 is Port-bound, so Z4/);
  expectFail(edit((t) => t.replace('| DC-01 Raw delivery measurement data | Yes | Yes | No |', '| DC-01 Raw delivery measurement data | Yes | Yes | Yes |')), /DC-01 is Port-bound, so Z3/);
  expectFail(edit((t) => t.replace('Cond (D-014)', 'Cond (D-998)')), /must name a decision in the register/);
  expectFail(edit((t) => t.replace('| DC-18 Synthetic and test data', '| DC-77 Synthetic and test data')), /DC-18 is in DATA-CLASSIFICATION but has no placement row/);
  expectFail(edit((t) => t.replace('| DC-05 Methodology and reference data | Yes | Yes | Yes | Yes (no sensitive data)', '| DC-05 Methodology and reference data | Yes | Yes | Maybe | Yes (no sensitive data)')), /is not Yes, No, Cond/);
  expectFail(edit((t) => t.replace('| DC-04 Feedstock certificates | Yes | Yes | TBD (D-009) |', '| DC-04 Feedstock certificates | Yes | Yes | Yes |')), /undecided residency/);
});

// ---------- evidence lineage ----------
test('lineage: structural defects are rejected', () => {
  const l = lineage();
  const rec = (d, id) => d.records.find((r) => r.id === id);
  expectFail(check('evidence-lineage', mutate(l, (d) => { d.records[1].id = 'R1'; })), /duplicate id/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { rec(d, 'C1').inputs = ['R1', 'NOPE']; })), /input 'NOPE' does not exist/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { rec(d, 'C1').inputs = ['C1']; })), /itself as input/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { rec(d, 'C1').inputs = []; })), /needs inputs/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { rec(d, 'C1').inputs = ['R1', 'E1']; rec(d, 'E1').inputs = ['C1']; })), /cycle in lineage/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { rec(d, 'K1').inputs = ['R1']; })), /certificate cannot take a raw as input/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { rec(d, 'C1').kind = 'invoice'; })), /unknown kind/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { d.schema = 'wrong'; })), /schema must be/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { d.records.push({ id: 'REF', kind: 'reference-data', origin: 'document' }, { id: 'C2', kind: 'calculation', origin: 'deterministic-calc', inputs: ['REF'], methodologyVersion: 'a', factorSetVersion: 'b', build: 'c' }); })), /C2: does not trace back to any raw record/);
});

test('lineage: raw data is append-only, timed, sourced and hashed', () => {
  const l = lineage();
  expectFail(check('evidence-lineage', mutate(l, (d) => { d.records[1].sequence = 1; })), /not greater than the previous 1/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { d.records[1].sequence = 0; })), /not greater than the previous/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { d.records[0].sequence = '1'; })), /integer sequence/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { delete d.records[0].trustedTime; })), /trustedTime/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { d.records[0].trustedTime = '2030-13-45T00:00:00Z'; })), /trustedTime/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { d.records[0].source = ''; })), /need a source/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { d.records[0].content = 'edited after hashing'; })), /contentSha256 does not match the content/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { d.records[0].contentSha256 = 'abc'; })), /64 hex/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { d.records[0].inputs = ['R2']; })), /raw records have no inputs/);
});

test('lineage: no model origin, calculations record version and build, certificates need a human approval', () => {
  const l = lineage();
  const rec = (d, id) => d.records.find((r) => r.id === id);
  expectFail(check('evidence-lineage', mutate(l, (d) => { rec(d, 'R1').origin = 'model'; })), /a model cannot be the origin/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { rec(d, 'C1').origin = 'model'; })), /a model cannot be the origin/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { rec(d, 'C1').origin = 'sensor'; })), /not permitted for calculation/);
  for (const k of ['methodologyVersion', 'factorSetVersion', 'build']) expectFail(check('evidence-lineage', mutate(l, (d) => { delete rec(d, 'C1')[k]; })), new RegExp(`calculation must record ${k}`));
  expectFail(check('evidence-lineage', mutate(l, (d) => { rec(d, 'C1').result.value = 2; })), /resultSha256 does not match the result/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { delete rec(d, 'K1').approval; })), /human quality-manager approval/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { rec(d, 'K1').approval.approverType = 'model'; })), /human quality-manager approval/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { rec(d, 'K1').approval.role = 'commercial-reviewer'; })), /human quality-manager approval/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { rec(d, 'K1').approval.approvedBy = ''; })), /human quality-manager approval/);
  expectFail(check('evidence-lineage', mutate(l, (d) => { rec(d, 'K1').origin = 'deterministic-calc'; })), /not permitted for certificate/);
});

// ---------- emissions methods ----------
test('methods: determinism, units, provenance and the no-invention rule', () => {
  const m = method();
  const reseal = (d) => { const { definitionSha256, ...rest } = d; d.definitionSha256 = sha256(canonical(rest)); };
  const m2 = (fn) => mutate(m, (d) => { fn(d); reseal(d); });
  expectFail(check('emissions-methods', m2((d) => { d.usesModel = true; })), /usesModel must be false/);
  expectFail(check('emissions-methods', m2((d) => { d.deterministic = false; })), /deterministic must be true/);
  expectFail(check('emissions-methods', m2((d) => { d.inputs[0].unit = ''; })), /name and a unit/);
  expectFail(check('emissions-methods', m2((d) => { d.outputs = []; })), /outputs must be a non-empty array/);
  expectFail(check('emissions-methods', m2((d) => { d.referenceData.version = 'latest'; })), /semantic version/);
  expectFail(check('emissions-methods', m2((d) => { d.version = '1.0'; })), /version must be/);
  expectFail(check('emissions-methods', m2((d) => { d.status = 'Approved'; })), /status must be/);
  expectFail(check('emissions-methods', m2((d) => { delete d.factors[0].source; })), /needs a cited source/);
  expectFail(check('emissions-methods', m2((d) => { d.factors[0].unit = ''; })), /needs a unit/);
  expectFail(check('emissions-methods', m2((d) => { d.schemeCandidate = 'V-99'; })), /not in CERTIFICATION-SCHEMES/);
});

test('methods: a record cannot change without a new version, and a real method needs a source and a verifier', () => {
  const m = method();
  expectFail(check('emissions-methods', mutate(m, (d) => { d.factors[0].value = 2; })), /definitionSha256 does not match/);
  expectFail(check('emissions-methods', mutate(m, (d) => { d.definitionSha256 = 'f'.repeat(64); })), /definitionSha256 does not match/);
  const real = mutate(m, (d) => { delete d.synthetic; const { definitionSha256, ...rest } = d; d.definitionSha256 = sha256(canonical(rest)); });
  const r = check('emissions-methods', real);
  expectFail(r, /non-synthetic method needs a sourceCitation/);
  assert.ok(msgs(r).some((x) => /needs verifiedBy/.test(x)));
});

test('methods: Verified needs a named human, evidence and a verified scheme; duplicates are refused', () => {
  const verified = (fn) => mutate(method(), (d) => { d.status = 'Verified'; fn(d); const { definitionSha256, ...rest } = d; d.definitionSha256 = sha256(canonical(rest)); });
  const r = check('emissions-methods', verified(() => {}));
  expectFail(r, /Verified needs verification/);
  assert.ok(msgs(r).some((x) => /needs a sourceCitation/.test(x)));
  assert.ok(msgs(r).some((x) => /scheme V-01 is 'Candidate'/.test(x)), 'a candidate scheme cannot back a Verified method');
  const full = verified((d) => { d.sourceCitation = 'SYNTHETIC'; d.verification = { verifiedBy: 'SYNTHETIC-VERIFIER', verifiedAt: '2030-01-01T00:00:00Z', evidence: 'EV-SYNTHETIC' }; d.factors[0].verifiedBy = 'SYNTHETIC-VERIFIER'; });
  const stillCandidate = check('emissions-methods', full);
  expectFail(stillCandidate, /scheme V-01 is 'Candidate'/);
  const dup = sandbox({ 'tests/fixtures/emissions-methods/a.json': method(), 'tests/fixtures/emissions-methods/b.json': method() });
  expectFail(runUtility('emissions-methods', dup, 'tests/fixtures/emissions-methods'), /defined more than once/);
});

// ---------- certificates ----------
test('certificates: tampering with a payload, a field or the order breaks the chain', () => {
  const c = certificates();
  expectFail(check('certificate-integrity', mutate(c, (d) => { d.certificates[0].payload.quantity = 'changed'; })), /payloadSha256 does not match the payload/);
  expectFail(check('certificate-integrity', mutate(c, (d) => { d.certificates[0].status = 'Superseded'; })), /recordSha256 does not match the record/);
  expectFail(check('certificate-integrity', mutate(c, (d) => { d.certificates.reverse(); })), /sequence must be 1/);
  expectFail(check('certificate-integrity', mutate(c, (d) => { d.certificates[1].previousSha256 = 'a'.repeat(64); })), /chain is broken/);
  expectFail(check('certificate-integrity', mutate(c, (d) => { d.certificates[0].previousSha256 = 'a'.repeat(64); })), /chain is broken/);
  expectFail(check('certificate-integrity', mutate(c, (d) => { d.certificates[0].recordSha256 = 'z'; })), /recordSha256 does not match/);
  const resealedAfterEdit = resealChain(mutate(c, (d) => { d.certificates[0].payload.quantity = 'changed'; }));
  assert.equal(check('certificate-integrity', resealedAfterEdit).status, 'PASS', 'a fully re-sealed chain is internally consistent; tamper evidence needs the head hash anchored outside the file (D-013)');
});

test('certificates: local hosting, human approval and methodology traceability are mandatory', () => {
  const c = certificates();
  const re = (fn) => resealChain(mutate(c, fn));
  expectFail(check('certificate-integrity', re((d) => { d.certificates[0].hosting.zone = 'Z4'; })), /locally hosted/);
  expectFail(check('certificate-integrity', re((d) => { d.certificates[0].hosting.zone = 'Z3'; })), /locally hosted/);
  expectFail(check('certificate-integrity', re((d) => { delete d.certificates[0].hosting; })), /locally hosted/);
  expectFail(check('certificate-integrity', re((d) => { delete d.certificates[0].approval; })), /Issued needs a human quality-manager approval/);
  expectFail(check('certificate-integrity', re((d) => { d.certificates[1].approval.approverType = 'model'; })), /Filed needs a human quality-manager approval/);
  expectFail(check('certificate-integrity', re((d) => { d.certificates[1].approval.role = 'agent'; })), /Filed needs a human quality-manager approval/);
  expectFail(check('certificate-integrity', re((d) => { d.certificates[0].methodology.definitionSha256 = 'x'; })), /methodology needs ref and definitionSha256/);
  expectFail(check('certificate-integrity', re((d) => { d.certificates[0].status = 'Approved'; })), /status must be/);
  expectFail(check('certificate-integrity', re((d) => { d.certificates[1].id = d.certificates[0].id; })), /duplicate id/);
  expectFail(check('certificate-integrity', re((d) => { d.certificates[0].jurisdiction = ''; })), /jurisdiction is required/);
  const draft = re((d) => { delete d.certificates[0].approval; d.certificates[0].status = 'Draft'; });
  assert.equal(check('certificate-integrity', draft).status, 'PASS', 'a Draft needs no approval, only Issued and Filed do');
});

// ---------- deployment readiness ----------
test('readiness: the real repository is NOT-READY and lists why', () => {
  const r = runUtility('deployment-readiness', repo);
  assert.equal(r.status, 'NOT-READY');
  for (const re of [/Phase 0/, /No infrastructure specification/, /No design review has status Approved/, /milestone-1 decisions are still open/, /No human decider/]) assert.ok(msgs(r).some((m) => re.test(m)), String(re));
  assert.ok(r.notes.some((n) => /not an approval/.test(n)));
});

test('readiness: each blocker clears only when its own recorded condition is met, and a self-declared approval does not count', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gf-ready-'));
  roots.push(root);
  cpSync(repo, root, { recursive: true, filter: (s) => !/[\\/](\.git|node_modules|\.harness-logs|\.harness-work|\.harness-toolchain|escape-link)([\\/]|$)/.test(s) });
  const edit = (rel, fn) => { const p = path.join(root, rel); const b = readFileSync(p, 'utf8'); const a = fn(b); assert.notEqual(a, b, rel); writeFileSync(p, a); };
  const blockers = () => msgs(runUtility('deployment-readiness', root));
  const has = (re) => blockers().some((m) => re.test(m));
  assert.ok(has(/Phase 0/) && has(/No infrastructure specification/) && has(/No design review has status Approved/) && has(/No human decider/) && has(/milestone-1 decisions/));
  edit('harness/policy/command-policy.json', (t) => t.replace('"phase": 0', '"phase": 1'));
  assert.equal(has(/Phase 0/), false);
  mkdirSync(path.join(root, 'infra'));
  writeFileSync(path.join(root, 'infra', 'main.bicep'), '// placeholder\n');
  assert.equal(has(/No infrastructure specification/), false);
  edit('docs/state/TODO.md', (t) => t.replace(/(\| T3 \|.*)Deferred/, '$1Named'));
  assert.equal(has(/No human decider/), false);
  rmSync(path.join(root, 'docs', 'context', 'DECISION-REGISTER.md'));
  assert.equal(has(/milestone-1 decisions/), false);
  edit('docs/architecture/reviews/RV-0001-delivery-measurement-storage-topology.md', (t) => t.replace('- **Status:** Blocked', '- **Status:** Approved'));
  assert.equal(has(/No design review has status Approved/), false, 'the declared status is seen');
  assert.ok(has(/architecture records have \d+ problem/), 'but the gate-consistency checks contradict a declared approval, so readiness stays blocked');
  const r = runUtility('deployment-readiness', root);
  assert.equal(r.status, 'NOT-READY');
  edit('harness/tools/tool-registry.json', (t) => t.replace('"status": "enabled"', '"status": "bogus"'));
  assert.ok(has(/tool configuration has \d+ problem/));
});

// ---------- command line ----------
test('command line: exit codes distinguish pass, fail, empty, not-ready and misuse', () => {
  const cli = (...a) => spawnSync(process.execPath, [path.join(repo, 'harness/scripts/spec-validators.mjs'), ...a], { encoding: 'utf8', cwd: repo });
  assert.equal(cli('requirements').status, 0);
  assert.equal(cli('evidence-lineage').status, 0);
  assert.equal(cli('evidence-lineage', '--require').status, 1);
  assert.equal(cli('evidence-lineage', '--path', 'tests/fixtures/lineage').status, 0);
  assert.equal(cli('deployment-readiness').status, 2);
  assert.equal(cli('nonsense').status, 4);
  assert.equal(cli().status, 4);
  assert.equal(cli('sovereignty', '--path', '../x').status, 4);
  const json = JSON.parse(cli('evidence-lineage', '--json').stdout);
  assert.equal(json.status, 'EMPTY');
});

test('the schemas are marked candidate so nobody mistakes them for decisions', () => {
  for (const s of Object.values(SCHEMAS)) assert.match(s, /\/v0-candidate$/);
  assert.equal(existsSync(path.join(repo, 'docs', 'specs', 'README.md')), true);
});
