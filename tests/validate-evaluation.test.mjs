// validate-evaluation: a committed-shape evaluation passes, and each way of weakening the framework or forging its record is rejected,
// on a sandbox copy. The sandbox holds a run produced by the real engine with a stand-in for process execution (nothing real runs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { validateEvaluation } from '../harness/scripts/validate-evaluation.mjs';
import { fakeRun, ROOT } from './support/eval-fake.mjs';

const require = createRequire(import.meta.url);
const FILES = ['harness/policy', 'harness/eval', 'harness/lib', 'harness/hooks', 'harness/scripts/evaluate.mjs', 'evaluation', 'docs/evaluation/EVALUATION-FRAMEWORK.md', 'docs/context/REQUIREMENTS.md', 'docs/context/NON-FUNCTIONAL-REQUIREMENTS.md', 'package.json', '.github/workflows/validate.yml'];

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-ve-'));
  for (const f of FILES) { mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); cpSync(path.join(ROOT, f), path.join(root, f), { recursive: true, filter: (s) => !s.includes('.lock') }); }
  const ev = require(path.join(root, 'harness/eval/eval.cjs'));
  const ctx = ev.makeContext({ root, run: fakeRun() });
  for (const t of ev.loadCatalogue(ctx).tests) for (const f of t.runner?.files ?? []) { mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); writeFileSync(path.join(root, f), ''); }
  const r = ev.runEvaluation(ctx);
  writeFileSync(path.join(root, 'docs/evaluation/EVALUATION-REPORT.md'), ev.renderReport(ctx, r.runId));
  return { root, runId: r.runId, ev, ctx };
}
const editJson = (root, rel, fn) => { const f = path.join(root, rel); const j = JSON.parse(readFileSync(f, 'utf8')); fn(j); writeFileSync(f, JSON.stringify(j, null, 2)); };
const editText = (root, rel, fn) => { const f = path.join(root, rel); writeFileSync(f, fn(readFileSync(f, 'utf8'))); };
const errorsOf = (root) => validateEvaluation(root).map((e) => e.msg);
const POLICY = 'harness/policy/evaluation-policy.json';
const CAT = 'evaluation/catalogue/harness.json';

test('a sandbox with a real engine-made run, its report and the committed configuration passes', () => {
  const s = sandbox(); try { assert.deepEqual(errorsOf(s.root), []); } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

const mutations = [
  ['a domain removed', (s) => editJson(s.root, POLICY, (j) => { j.domains = j.domains.filter((d) => d.id !== 'PRF'); }), /domains must be exactly/],
  ['a red-team scenario removed', (s) => editJson(s.root, POLICY, (j) => { j.redTeam.pop(); }), /red-team scenarios must be exactly/],
  ['a gate removed', (s) => editJson(s.root, POLICY, (j) => { j.gates = j.gates.filter((g) => g.id !== 'G7'); }), /gates must be exactly/],
  ['a gate that can skip its predecessor', (s) => editJson(s.root, POLICY, (j) => { j.gates.find((g) => g.id === 'G4').dependsOn = ['G2']; }), /G4 must depend on exactly the previous gate/],
  ['a gate with no dependency', (s) => editJson(s.root, POLICY, (j) => { j.gates.find((g) => g.id === 'G6').dependsOn = []; }), /G6 must depend on exactly the previous gate/],
  ['a fifth status', (s) => editJson(s.root, POLICY, (j) => { j.statuses.push('SKIPPED'); }), /statuses must be exactly/],
  ['a missing production-agent scope', (s) => editJson(s.root, POLICY, (j) => { delete j.scopes['production-agent']; }), /scopes must define production-agent/],
  ['the no-score rule removed', (s) => editJson(s.root, POLICY, (j) => { j.gateRules = j.gateRules.filter((r) => !/no score/i.test(r)); }), /gateRules must state/],
  ['the entry-criteria rule removed', (s) => editJson(s.root, POLICY, (j) => { j.gateRules = j.gateRules.filter((r) => !/entry/i.test(r)); }), /gateRules must state/],
  ['an inline interpreter on the allow-list', (s) => editJson(s.root, POLICY, (j) => { j.commandAllowList.push('^node -e .*$'); }), /accepts 'node -e 1'/],
  ['node options that load code', (s) => editJson(s.root, POLICY, (j) => { j.commandAllowList[0] = '^node --test( [A-Za-z0-9_./-]+)+$'; }), /accepts 'node --test --import/],
  ['a parent path allowed in a test file argument', (s) => editJson(s.root, POLICY, (j) => { j.commandAllowList[0] = '^node --test --test-reporter=tap( [A-Za-z0-9_./-]+)+$'; }), /accepts 'node --test --test-reporter=tap \.\.\/x\.mjs'/],
  ['the evaluation runner itself on the allow-list', (s) => editJson(s.root, POLICY, (j) => { j.commandAllowList[1] = j.commandAllowList[1].replace('validate-evaluation', 'validate-evaluation|evaluate'); }), /accepts 'node harness\/scripts\/evaluate\.mjs run'/],
  ['approval signing on the allow-list', (s) => editJson(s.root, POLICY, (j) => { j.commandAllowList[1] = j.commandAllowList[1].replace('validate-evaluation', 'validate-evaluation|approval'); }), /accepts 'node harness\/scripts\/approval\.mjs sign/],
  ['a result in the catalogue', (s) => editJson(s.root, CAT, (j) => { j.tests[0].status = 'PASS'; }), /catalogue: .*must not carry results/],
  ['an executable production-agent test', (s) => editJson(s.root, 'evaluation/catalogue/production.json', (j) => { const t = j.tests.find((x) => x.id === 'EVAL-PRD-SEC-003'); t.mode = 'executable'; delete t.pendingReason; t.runner = { type: 'command', argv: ['node', 'harness/scripts/validate-tools.mjs'], expect: { exit: 0 } }; }), /production-agent test must be pending/],
  ['evaluation paths that are not control plane', (s) => editJson(s.root, 'harness/policy/permissions.json', (j) => { const c = j.pathClasses.find((x) => x.id === 'control-plane'); c.pattern = c.pattern.replace('evaluation/|docs/evaluation/|', ''); }), /evaluation\/catalogue\/harness\.json must be a control-plane path/],
  ['the committed runs not protected as control plane', (s) => editJson(s.root, 'harness/policy/permissions.json', (j) => { const c = j.pathClasses.find((x) => x.id === 'control-plane'); c.pattern = c.pattern.replace('|docs/evaluation/', ''); }), /docs\/evaluation\/EVALUATION-REPORT\.md must be a control-plane path/],
  ['an agent granted the evaluation runner', (s) => editJson(s.root, 'harness/policy/agent-policy.json', (j) => { j.agents['qa-engineer'].commands.push('^node harness/scripts/evaluate\\.mjs run$'); }), /no agent may be granted evaluate\.mjs/],
  ['the validator missing from package.json', (s) => editJson(s.root, 'package.json', (j) => { j.scripts = { test: 'node --test' }; }), /package\.json must run the evaluation validator/],
  ['a framework document heading removed', (s) => editText(s.root, 'docs/evaluation/EVALUATION-FRAMEWORK.md', (t) => t.replace(/^#+ .*Human procedure.*$/m, '')), /needs a heading about 'Human procedure'/],
  ['the framework document missing', (s) => fs.rmSync(path.join(s.root, 'docs/evaluation/EVALUATION-FRAMEWORK.md')), /missing docs\/evaluation\/EVALUATION-FRAMEWORK\.md/],
  ['the report missing', (s) => fs.rmSync(path.join(s.root, 'docs/evaluation/EVALUATION-REPORT.md')), /missing docs\/evaluation\/EVALUATION-REPORT\.md/],
  ['a report edited by hand', (s) => editText(s.root, 'docs/evaluation/EVALUATION-REPORT.md', (t) => t.replace('| **FAIL**', '| **PASS**').replace('**BLOCKED**', '**PASS**').concat('\nAll gates passed.\n')), /does not match what EVRUN-/],
  ['a report claiming a pending test passed', (s) => editText(s.root, 'docs/evaluation/EVALUATION-REPORT.md', (t) => t.replace(/(\| EVAL-PRD-SEC-003 \|.*)\*\*PENDING\*\*/, '$1**PASS**')), /does not match what EVRUN-/],
  ['every run deleted', (s) => fs.rmSync(path.join(s.root, 'docs/evaluation/runs'), { recursive: true, force: true }), /there is no committed full evaluation run/],
  ['a catalogue changed after the run', (s) => editJson(s.root, 'evaluation/catalogue/harness.json', (j) => { j.tests.find((t) => t.id === 'EVAL-HRN-REQ-001').remediation = 'A different remediation text after the run was made'; }), /committed run is stale/],
  ['no CI re-run in the workflow', (s) => editText(s.root, '.github/workflows/validate.yml', (t) => t.replace(/evaluate\.mjs rerun/g, 'evaluate.mjs validate')), /must run evaluate\.mjs rerun/],
  ['a tolerated difference on a control test', (s) => editJson(s.root, POLICY, (j) => { j.ciRerun.allowedDifferences.push({ id: 'EVAL-HRN-SEC-001', status: 'BLOCKED', reason: 'a long enough reason to pass the length rule here' }); }), /guards a control or a hard constraint/],
  ['a tolerated difference that is a failure', (s) => editJson(s.root, POLICY, (j) => { j.ciRerun.allowedDifferences[0].status = 'FAIL'; }), /may only differ as BLOCKED/],
  ['a tolerated difference with no reason', (s) => editJson(s.root, POLICY, (j) => { j.ciRerun.allowedDifferences[0].reason = 'x'; }), /needs a reason/],
  ['a tolerated difference for an unknown test', (s) => editJson(s.root, POLICY, (j) => { j.ciRerun.allowedDifferences[0].id = 'EVAL-HRN-NOPE-001'; }), /not a catalogue test/],
  ['the CI re-run policy removed', (s) => editJson(s.root, POLICY, (j) => { delete j.ciRerun; }), /ciRerun\.allowedDifferences must be a list/],
  ['a recorded status forged', (s) => editJson(s.root, `docs/evaluation/runs/${s.runId}/run.json`, (j) => { j.tests.find((t) => t.id === 'EVAL-PRD-SEC-003').status = 'PASS'; }), /EVAL-PRD-SEC-003: recorded PASS but the evidence derives PENDING/],
  ['an evidence file edited', (s) => editJson(s.root, `docs/evaluation/runs/${s.runId}/results/EVAL-HRN-SEC-001.json`, (j) => { j.exitCode = 0; j.ran = true; j.status = 'PASS'; j.extra = 1; }), /EVAL-HRN-SEC-001: evidence file altered/],
  ['an evidence file deleted', (s) => fs.rmSync(path.join(s.root, `docs/evaluation/runs/${s.runId}/results/EVAL-HRN-SEC-001.json`)), /EVAL-HRN-SEC-001: evidence file missing/],
  ['a gate forged to PASS', (s) => editJson(s.root, `docs/evaluation/runs/${s.runId}/run.json`, (j) => { j.gates.find((g) => g.id === 'G4').status = 'PASS'; }), /recorded gates differ/],
  ['a hard-constraint verdict forged', (s) => editJson(s.root, `docs/evaluation/runs/${s.runId}/run.json`, (j) => { j.hardConstraints.find((h) => h.id === 'HC-11').verdict = 'VIOLATED'; }), /hard-constraint matrix differs/],
];
for (const [what, mutate, re] of mutations) {
  test(`validate-evaluation rejects ${what}`, () => {
    const s = sandbox();
    try { mutate(s); const errs = errorsOf(s.root); assert.ok(errs.some((e) => re.test(e)), `not rejected for the right reason: ${errs.join(' | ').slice(0, 400) || 'no error reported'}`); } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
  });
}

test('a partial run is never accepted as the full run behind the report', () => {
  const s = sandbox();
  try {
    const partialCtx = s.ev.makeContext({ root: s.root, run: fakeRun() });
    s.ev.runEvaluation(partialCtx, { ids: ['EVAL-HRN-SEC-001'] });
    assert.deepEqual(errorsOf(s.root), [], 'a later partial run does not disturb the report of the latest full run');
    fs.rmSync(path.join(s.root, `docs/evaluation/runs/${s.runId}`), { recursive: true, force: true });
    assert.ok(errorsOf(s.root).some((e) => /there is no committed full evaluation run/.test(e)), 'only a partial run remains: the report has no full run behind it');
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});
