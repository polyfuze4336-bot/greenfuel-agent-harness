import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateReviewFile, coverage } from '../harness/scripts/design-gate.mjs';
import { validateArchitecture } from '../harness/scripts/validate-architecture.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DES = 'docs/architecture/designs/DES-0001-delivery-measurement-storage-topology.md';
const RV = 'docs/architecture/reviews/RV-0001-delivery-measurement-storage-topology.md';
const ADR4 = 'docs/adr/0004-delivery-measurement-storage-topology.md';
const REG = 'docs/context/DECISION-REGISTER.md';
const HC = 'docs/architecture/HARD-CONSTRAINTS.md';

function sandbox(changes, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gf-gate-'));
  cpSync(repo, dir, { recursive: true, filter: (s) => !/[\\/](\.git|node_modules)([\\/]|$)/.test(s) });
  try {
    for (const [file, edit] of Object.entries(changes)) {
      const p = path.join(dir, file);
      const before = readFileSync(p, 'utf8');
      const after = edit(before);
      assert.notEqual(after, before, `mutation of ${file} changed nothing`);
      writeFileSync(p, after);
    }
    return fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const gate = (changes, opts) => sandbox(changes, (dir) => evaluateReviewFile(dir, RV, opts));
const arch = (changes) => sandbox(changes, (dir) => validateArchitecture(dir).map((e) => e.msg));
const has = (list, re) => assert.ok(list.some((m) => re.test(m)), `expected ${re} in:\n${list.join('\n')}`);

test('real example: computed Blocked, declared Blocked, no errors anywhere', () => {
  const r = evaluateReviewFile(repo, RV);
  assert.equal(r.computed, 'Blocked');
  assert.equal(r.review.status, 'Blocked');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(validateArchitecture(repo), []);
  has(r.block, /D-009 \(M1\) is Open/);
  has(r.block, /PV-04 not assessed/);
  has(r.block, /critical question DQ-03-02 is unanswered/);
  has(r.block, /SEC-001 \(Must\) is Partial/);
});

test('reviewer override makes a requirement count as the worse status', () => {
  const r = evaluateReviewFile(repo, RV);
  has(r.block, /BR-007 \(Must\) is Partial/);
  has(r.block, /FR-001 \(Must\) is Partial/);
});

test('declaring Approved while the gate computes Blocked is an error', () => {
  const r = gate({ [RV]: (t) => t.replace('- **Status:** Blocked', '- **Status:** Approved') });
  assert.equal(r.computed, 'Blocked');
  has(r.errors, /declared status 'Approved' is not allowed when the gate computes Blocked/);
  has(r.errors, /Approved requires checkpoint CP4/);
  has(r.errors, /named human decider/);
});

test('a hard-constraint violation on the selected option rejects, and only Rejected is allowed', () => {
  const edit = { [RV]: (t) => t.replace('| C | HC-01 | Conditional |', '| C | HC-01 | Violated |') };
  const blocked = gate(edit);
  assert.equal(blocked.computed, 'Rejected');
  has(blocked.reject, /HC-01 violated by option C/);
  has(blocked.errors, /declared status 'Blocked' is not allowed when the gate computes Rejected/);
  const rejected = gate({ ...edit, [RV]: (t) => edit[RV](t).replace('- **Status:** Blocked', '- **Status:** Rejected') });
  assert.deepEqual(rejected.errors, []);
  assert.equal(rejected.computed, 'Rejected');
});

test('a failed perspective rejects', () => {
  assert.equal(gate({ [RV]: (t) => t.replace('| PV-03 | Concern |', '| PV-03 | Fail |') }).computed, 'Rejected');
});

test('what-if: selecting the central option is rejected; the exit code is 3', () => {
  const r = evaluateReviewFile(repo, RV, { select: 'B' });
  assert.equal(r.computed, 'Rejected');
  has(r.reject, /HC-01 violated by option B/);
  const cli = spawnSync(process.execPath, ['harness/scripts/design-gate.mjs', RV, '--select', 'B'], { cwd: repo, encoding: 'utf8' });
  assert.equal(cli.status, 3);
  assert.match(cli.stdout, /Computed: Rejected/);
  const normal = spawnSync(process.execPath, ['harness/scripts/design-gate.mjs', RV], { cwd: repo, encoding: 'utf8' });
  assert.equal(normal.status, 0);
});

test('an option marked rejected needs a Violated verdict', () => {
  has(gate({ [RV]: (t) => t.replace('| B | HC-01 | Violated |', '| B | HC-01 | Conditional |') }).errors, /option B is marked Rejected \(hard constraint\) but has no Violated verdict/);
});

test('structure errors: missing perspective, missing scope row, unknown risk, concern without risk, missing critical question', () => {
  has(gate({ [RV]: (t) => t.replace(/^\| PV-10 .*\r?\n/m, '') }).errors, /missing perspective PV-10/);
  has(gate({ [DES]: (t) => t.replace(/^\| NFR-017 .*\r?\n/m, '') }).errors, /scope requires a trace row for NFR-017/);
  has(gate({ [DES]: (t) => t.replace('| RK-001 | Open until D-009 is Decided |', '| RK-099 | Open until D-009 is Decided |') }).errors, /unknown risk RK-099/);
  has(gate({ [RV]: (t) => t.replace('| DES-0001 sections 1 and 6 | RK-004 |', '| DES-0001 sections 1 and 6 | none |') }).errors, /PV-01: a Concern needs a linked risk/);
  has(gate({ [RV]: (t) => t.replace(/^\| DQ-01-01 .*\r?\n/m, '') }).errors, /critical question DQ-01-01 has no disposition/);
});

test('a class A requirement cannot be waived', () => {
  has(gate({ [DES]: (t) => t.replace('| Unresolved | Disconnection test (plan); needs D-020 |', '| Waived (ADR-0003) | Disconnection test (plan); needs D-020 |') }).errors, /NFR-004: cannot be waived/);
});

test('Answered needs a real reference', () => {
  has(gate({ [RV]: (t) => t.replace('| DQ-01-01 | Answered | Serves BR-002, BR-006 and BR-007. No measure or baseline exists and none is invented (D-034) | DES-0001 section 1 |', '| DQ-01-01 | Answered | Serves BR-002, BR-006 and BR-007. No measure or baseline exists and none is invented (D-034) | none |') }).errors, /DQ-01-01: Answered needs a reference/);
});

const POSITIVE = {
  [DES]: (t) => t.replace(/\| (Partial|Unresolved) \|/g, '| Addressed |'),
  [REG]: (t) => t.replace(/\| Open \|/g, '| Decided (ADR-0003) |'),
  [RV]: (t) => t
    .replace(/^(\| C \| HC-\d\d \| )(Conditional|Unresolved)/gm, '$1Satisfied')
    .replace(/\| (Concern|Not assessed) \|/g, '| Pass |')
    .replace(/\| Partial \|/g, '| Addressed |')
    .replace(/^(\| DQ-\d\d-\d\d \| )Unanswered( \|.*)\| none \|(\r?)$/gm, '$1Answered$2| DES-0001 |$3')
    .replace('- **Status:** Blocked', '- **Status:** Approved')
    .replace('- **Checkpoint:** CP3', '- **Checkpoint:** CP4')
    .replace('- **Decider:** pending', '- **Decider:** Example Person (programme owner)'),
};

test('positive path: with every blocker cleared the gate computes Approvable and Approved is accepted', () => {
  const r = gate(POSITIVE);
  assert.deepEqual(r.errors, []);
  assert.equal(r.computed, 'Approvable');
  assert.deepEqual(r.reject.concat(r.block), []);
});

test('a generic or model decider is refused even when everything else passes', () => {
  const r = gate({ ...POSITIVE, [RV]: (t) => POSITIVE[RV](t).replace('Example Person (programme owner)', 'design-reviewer (reviewer)') });
  has(r.errors, /named human decider/);
});

test('Not applicable is refused for constraint-bound requirements and needs reviewer confirmation otherwise', () => {
  has(gate({ [DES]: (t) => t.replace('| Addressed | Interrupted-synchronisation tests (plan) |', '| Not applicable | Interrupted-synchronisation tests (plan) |') }).errors, /NFR-005: cannot be Not applicable/);
  has(gate({ [DES]: (t) => t.replace('| Partial | End-to-end trace of one delivery (plan) |', '| Not applicable | End-to-end trace of one delivery (plan) |') }).errors, /NFR-013: Not applicable needs the reviewer's confirmation/);
});

test('a requirement claimed in the design but not traced is an error', () => {
  has(gate({ [DES]: (t) => t.replace(/^\| BR-002 .*\r?\n/m, '') }).errors, /BR-002 is claimed in the design or its ADR but has no trace row/);
});

test('scope and tags must come from the fixed vocabularies', () => {
  has(gate({ [DES]: (t) => t.replace('- **Scope capabilities:** SOV, EDG', '- **Scope capabilities:** none') }).errors, /Scope capabilities must be a non-empty list/);
  has(gate({ [DES]: (t) => t.replace('- **Tags:** DATA, EDGE, OPS', '- **Tags:** none') }).errors, /Tags must be a non-empty list/);
});

test('Decided in the register needs an Accepted ADR', () => {
  const r = gate({ [REG]: (t) => t.replace(/\| M1 \| Open \|/, '| M1 | Decided (ADR-0004) |') });
  has(r.ctxErrors, /Decided needs an Accepted ADR, but ADR-0004 is Proposed/);
});

test('Satisfied verdicts and every perspective must cite something', () => {
  has(gate({ [RV]: (t) => t.replace('The design relies on no scheme or standard as binding (CN-004). Candidates V-10 and V-22 appear only as unverified', 'The design is fine') }).errors, /C\/HC-10: a Satisfied verdict must cite/);
  has(gate({ [RV]: (t) => t.replace('| DES-0001 sections 1 and 6 | RK-004 |', '| none | RK-004 |') }).errors, /PV-01: a reference to the design/);
});

test('what-if with an incomplete screen is Blocked, exit code 2', () => {
  const r = evaluateReviewFile(repo, RV, { select: 'E' });
  assert.equal(r.computed, 'Blocked');
  has(r.block, /option E is unscreened: 1 of 12/);
  const cli = spawnSync(process.execPath, ['harness/scripts/design-gate.mjs', RV, '--select', 'E'], { cwd: repo, encoding: 'utf8' });
  assert.equal(cli.status, 2);
});

test('Design ADR cannot be Accepted while its review is Blocked, and needs its sections', () => {
  has(arch({ [ADR4]: (t) => t.replace('- **Status:** Proposed', '- **Status:** Accepted') }), /ADR-0004: cannot be Accepted while review RV-0001 is Blocked/);
  has(arch({ [ADR4]: (t) => t.replace(/^## Reversibility\r?\n/m, '') }), /ADR-0004: section 'Reversibility' is missing or empty/);
  has(arch({ [ADR4]: (t) => t.replace('Review: RV-0001', 'Review: RV-0009').replace('- **Review:** RV-0001', '- **Review:** RV-0009') }), /Design ADR must name an existing review/);
});

test('figures and compliance lint', () => {
  has(arch({ [DES]: (t) => t + '\nEstimated cost is 5000 USD per month.\n' }), /possible a monetary amount/);
  has(arch({ [DES]: (t) => t + '\nThe store gives 99.9 percent availability.\n' }), /possible a percentage/);
  has(arch({ [DES]: (t) => t + '\nThe platform is compliant with the scheme.\n' }), /possible a compliance claim/);
  assert.deepEqual(arch({ [DES]: (t) => t + '\nA placeholder of 5000 USD for discussion only.\n' }), []);
  has(arch({ [DES]: (t) => t + '\nEstimated cost: 5000 USD (candidate)\n' }), /possible a monetary amount/);
});

test('every case-study constraint must be covered by a hard constraint', () => {
  has(arch({ [HC]: (t) => t.replace('| Edge-to-shore connectivity can be intermittent | CS-C7 |', '| Edge-to-shore connectivity can be intermittent | CS-P1 |') }), /case-study constraint CS-C7 is not covered/);
});

test('coverage reports traced and untraced requirements', () => {
  const c = coverage(repo);
  assert.ok(c.traced > 0 && c.traced < c.total);
  assert.ok(c.mustUntraced.length > 0);
});
