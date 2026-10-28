import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContext, contextStats } from '../harness/scripts/validate-context.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQ = 'docs/context/REQUIREMENTS.md';
const TRACE = 'docs/context/REQUIREMENTS-TRACEABILITY.md';
const REG = 'docs/context/DECISION-REGISTER.md';
const MAN = 'docs/context/context-manifest.json';

function mutated(changes) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gf-context-'));
  cpSync(repo, dir, { recursive: true, filter: (s) => !/[\\/](\.git|node_modules|\.harness-work|\.harness-toolchain|escape-link)([\\/]|$)/.test(s) });
  try {
    for (const [file, fn] of Object.entries(changes)) {
      const p = path.join(dir, file);
      const before = readFileSync(p, 'utf8');
      const after = fn(before);
      assert.notEqual(after, before, `mutation of ${file} changed nothing`);
      writeFileSync(p, after);
    }
    return validateContext(dir).map((e) => e.msg);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const has = (msgs, re) => assert.ok(msgs.some((m) => re.test(m)), `expected a message matching ${re}; got:\n${msgs.join('\n')}`);

test('real baseline has no context problems', () => assert.deepEqual(validateContext(repo), []));

test('baseline counts match what the documents state', () => {
  const s = contextStats(repo);
  assert.equal(s.requirements.total, s.requirements.byClass.A + s.requirements.byClass.B);
  assert.equal(s.requirements.total, Object.values(s.requirements.byFamily).reduce((a, b) => a + b, 0));
  assert.equal(s.decisions.total, Object.values(s.decisions.byKind).reduce((a, b) => a + b, 0));
  assert.ok(s.profiles.every((p) => p.rowFilteredBytes <= p.wholeDocumentBytes || p.requirements === 0));
});

test('duplicate requirement id is rejected', () => {
  has(mutated({ [REQ]: (t) => t.replace('| BR-002 |', '| BR-001 |') }), /BR-001 is defined more than once/);
});

test('a pipe inside a cell is rejected', () => {
  has(mutated({ [REQ]: (t) => t.replace('| Defines scope |', '| Defines scope | and |') }), /BR-001 has 8 cells/);
});

test('invalid class and priority are rejected', () => {
  const m = mutated({ [REQ]: (t) => t.replace('| BR-001 | DEA,EAA,DRA,MBA,CCA |', '| BR-001 | DEA,EAA,DRA,MBA,CCA |').replace(/\| A \| Must \| Defines scope/, '| C | Urgent | Defines scope') });
  has(m, /BR-001: class 'C'/);
  has(m, /BR-001: priority 'Urgent'/);
});

test('unknown capability tag is rejected', () => {
  has(mutated({ [REQ]: (t) => t.replace('| BR-002 | XC |', '| BR-002 | XYZ |') }), /BR-002: caps 'XYZ'/);
});

test('requirement without a traceability row is rejected, and so is an orphan row', () => {
  has(mutated({ [TRACE]: (t) => t.replace(/^\| BR-009 .*\r?\n/m, '') }), /BR-009: no traceability row/);
  has(mutated({ [REQ]: (t) => t.replace(/^\| BR-009 .*\r?\n/m, '') }), /BR-009: traceability row has no requirement/);
});

test('class A must cite the case study; class B must cite ARCH', () => {
  has(mutated({ [TRACE]: (t) => t.replace('| BR-001 | CS-CAP-1; CS-CAP-2; CS-CAP-3; CS-CAP-4; CS-CAP-5 |', '| BR-001 | ARCH |') }), /BR-001: class A must cite CS-/);
  has(mutated({ [TRACE]: (t) => t.replace('| BR-008 | ARCH |', '| BR-008 | CS-C1 |') }), /BR-008: class B must cite ARCH/);
});

test('unknown references are rejected', () => {
  has(mutated({ [TRACE]: (t) => t.replace('| FR-001 | CS-CAP-1 | Test; Review | Hash-comparison test report with a simulated meter; interface specification | D-018; D-019 |', '| FR-001 | CS-CAP-1 | Test; Review | Hash-comparison test report with a simulated meter; interface specification | D-018; D-999 |') }), /unknown decision D-999/);
  has(mutated({ [TRACE]: (t) => t.replace('| V-10; V-22; V-23 |', '| V-10; V-99 |') }), /unknown scheme candidate V-99/);
  has(mutated({ [TRACE]: (t) => t.replace('| ADR-0002 | – | – | – |', '| ADR-0099 | – | – | – |') }), /unknown ADR ADR-0099/);
  has(mutated({ 'docs/context/ASSUMPTIONS.md': (t) => t + '\nSee FR-999 and CS-C9.\n' }), /unknown requirement FR-999/);
});

test('Open (C) must list clarifications, not architecture decisions', () => {
  has(mutated({ [TRACE]: (t) => t.replace('| BR-008 | ARCH | Review | Approved value measures and baselines per capability | D-034 | – | D-034 |', '| BR-008 | ARCH | Review | Approved value measures and baselines per capability | D-034 | – | D-010 |') }), /Open \(C\) lists D-010/);
});

test('decision register shape is enforced', () => {
  has(mutated({ [REG]: (t) => t.replace('| D-003 | C |', '| D-003 | Q |') }), /D-003: kind 'Q'/);
  has(mutated({ [REG]: (t) => t.replace(/\| M1 \| Open \|(\r?\n)\| D-004/, '| M9 | Open |$1| D-004') }), /needed-by 'M9'/);
});

test('manifest: uncovered requirement, missing file and unlisted source document are rejected', () => {
  has(mutated({ [MAN]: (t) => t.replace('"include": ["BR-*"]', '"include": ["BR-001"]') }), /BR-008 is not reachable/);
  has(mutated({ [MAN]: (t) => t.replace('docs/context/BUSINESS-CASE.md"', 'docs/context/NOPE.md"') }), /missing file docs\/context\/NOPE\.md/);
  has(mutated({ [MAN]: (t) => t.replace('"docs/context/REQUIREMENTS.md", "docs/context/NON-FUNCTIONAL-REQUIREMENTS.md", "docs/context/REQUIREMENTS-TRACEABILITY.md", "docs/context/DATA-CLASSIFICATION.md"', '"docs/context/REQUIREMENTS.md", "docs/context/REQUIREMENTS-TRACEABILITY.md", "docs/context/DATA-CLASSIFICATION.md"') }), /capability-dea: selects requirements from docs\/context\/NON-FUNCTIONAL-REQUIREMENTS\.md/);
});
