// validate-loop: the committed configuration passes, and each way of loosening the loop is rejected on a sandbox copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { repo } from './support/permission-fixtures.mjs';
import { validateLoop } from '../harness/scripts/validate-loop.mjs';

const FILES = ['harness/policy', 'harness/loop', 'harness/hooks', 'harness/scripts/loop.mjs', 'harness/tools/tool-registry.json', 'docs/loop', 'docs/state/loops', 'tests/fixtures/loop/emissions', '.gitignore'];
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vl-'));
  for (const f of FILES) { if (!fs.existsSync(path.join(repo, f))) continue; mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); cpSync(path.join(repo, f), path.join(root, f), { recursive: true, filter: (s) => !s.includes('.lock') }); }
  return root;
}
const editJson = (root, rel, fn) => { const f = path.join(root, rel); const j = JSON.parse(readFileSync(f, 'utf8')); fn(j); writeFileSync(f, JSON.stringify(j, null, 2)); };
const editText = (root, rel, fn) => { const f = path.join(root, rel); writeFileSync(f, fn(readFileSync(f, 'utf8'))); };
const errorsOf = (root) => validateLoop(root).map((e) => e.msg);
const POLICY = 'harness/policy/loop-policy.json';

test('the committed loop configuration, documents and recorded loops pass', () => assert.deepEqual(errorsOf(repo), []));

const mutations = [
  ['more than 3 repair attempts', (r) => editJson(r, POLICY, (j) => { j.limits.maxRepairAttempts = 5; }), /maxRepairAttempts must be 1 to 3/],
  ['more than 2 identical failures', (r) => editJson(r, POLICY, (j) => { j.limits.maxIdenticalFailures = 3; }), /maxIdenticalFailures must be 1 to 2/],
  ['a check timeout longer than the whole budget', (r) => editJson(r, POLICY, (j) => { j.limits.timeoutSeconds = 5000; }), /cannot exceed the whole wall-clock budget/],
  ['a hard-constraint violation that can be repaired', (r) => editJson(r, POLICY, (j) => { j.failureClasses.HARD_CONSTRAINT_VIOLATION.action = 'repair'; }), /HARD_CONSTRAINT_VIOLATION must stop the loop at once/],
  ['a permission violation that only escalates', (r) => editJson(r, POLICY, (j) => { j.failureClasses.PERMISSION_VIOLATION.action = 'escalate'; }), /PERMISSION_VIOLATION must stop the loop at once/],
  ['tampering that can be repaired', (r) => editJson(r, POLICY, (j) => { j.failureClasses.TEST_TAMPERING.action = 'repair'; }), /TEST_TAMPERING must stop/],
  ['a repeated failure that is retried', (r) => editJson(r, POLICY, (j) => { j.failureClasses.REPEATED_FAILURE.action = 'repair'; }), /REPEATED_FAILURE must escalate/],
  ['a build error that is not repairable', (r) => editJson(r, POLICY, (j) => { j.failureClasses.BUILD_ERROR.action = 'escalate'; }), /BUILD_ERROR must be repairable/],
  ['a hard constraint ranked below a build error', (r) => editJson(r, POLICY, (j) => { j.severityOrder = ['BUILD_ERROR', ...j.severityOrder.filter((c) => c !== 'BUILD_ERROR')]; }), /must outrank a build error/],
  ['PASSED reachable from a repair', (r) => editJson(r, POLICY, (j) => { j.transitions.REPAIR.push('PASSED'); }), /PASSED may be entered only from VERIFY or CRITIQUE/],
  ['a terminal state that can continue', (r) => editJson(r, POLICY, (j) => { j.transitions.STOPPED = ['REPAIR']; }), /terminal state STOPPED must have no outgoing/],
  ['a diagnosis that can be skipped', (r) => editJson(r, POLICY, (j) => { j.transitions.DIAGNOSE.push('VERIFY'); }), /DIAGNOSE may lead to REPAIR but never straight to VERIFY|VERIFY may be entered only after an attempt/],
  ['a state added', (r) => editJson(r, POLICY, (j) => { j.states.push('SUCCESS'); j.transitions.SUCCESS = []; }), /states must be exactly/],
  ['an inline interpreter on the allow-list', (r) => editJson(r, POLICY, (j) => { j.commandAllowList.push('^node -e .*$'); }), /dangerous check command: node -e 1/],
  ['node options that load code on the allow-list', (r) => editJson(r, POLICY, (j) => { j.commandAllowList[0] = '^node --test( [A-Za-z0-9_./-]+)+$'; }), /dangerous check command: node --test --import/],
  ['an unanchored command pattern', (r) => editJson(r, POLICY, (j) => { j.commandAllowList.push('npm test'); }), /must be anchored/],
  ['destructive Azure operations allowed in a loop', (r) => editJson(r, POLICY, (j) => { j.forbiddenOps = j.forbiddenOps.filter((o) => o !== 'azure.delete'); }), /forbiddenOps must include azure\.delete/],
  ['an unknown operation', (r) => editJson(r, POLICY, (j) => { j.noAutoRetryOps.push('azure.make-coffee'); }), /not in permissions\.json/],
  ['isolation classes dropped from the protected classes', (r) => editJson(r, POLICY, (j) => { j.protectedClasses = ['audit']; }), /protectedClasses must include/],
  ['a reviewer that is not an agent', (r) => editJson(r, POLICY, (j) => { j.reviewerAgents.push('friend'); }), /not an agent in agent-policy\.json/],
  ['an unpinned toolchain', (r) => editJson(r, POLICY, (j) => { delete j.toolchains.tsc.entrySha256; }), /must pin an exact version/],
  ['the loop store no longer control plane', (r) => editJson(r, 'harness/policy/permissions.json', (j) => { const c = j.pathClasses.find((x) => x.id === 'control-plane'); c.pattern = c.pattern.replace('docs/state/loops/|', ''); }), /docs\/state\/loops\/ must be a control-plane path/],
  ['an agent allowed to run any loop command', (r) => editJson(r, 'harness/policy/agent-policy.json', (j) => { j.agents['qa-engineer'].commands.push('^node harness/scripts/loop\\.mjs( [-\\w./:=]+)*$'); }), /may run 'loop\.mjs (begin|end|init)/],
  ['an agent granted a loop command by policy but not by its allow-list', (r) => editJson(r, POLICY, (j) => { j.agentCommands['design-reviewer'] = ['status']; }), /grants design-reviewer 'loop\.mjs status' but its command allow-list/],
  ['an agent allowed a subcommand the policy does not grant', (r) => editJson(r, 'harness/policy/agent-policy.json', (j) => { j.agents['design-reviewer'].commands.push('^node harness/scripts/loop\\.mjs status --loop LOOP-[0-9a-f]{10}$'); }), /design-reviewer may run 'loop\.mjs status', which loop-policy agentCommands does not grant/],
  ['a grant of a human-only subcommand', (r) => editJson(r, POLICY, (j) => { j.agentCommands['qa-engineer'].push('begin'); }), /only status, verify and verify-store may be run by an agent/],
  ['workspaces no longer ignored', (r) => editText(r, '.gitignore', (t) => t.replace('.harness-work/', '')), /\.gitignore must ignore \.harness-work\//],
  ['a document that dropped a required topic', (r) => editText(r, 'docs/loop/LOOP.md', (t) => t.replaceAll('Limits', 'Notes')), /must cover 'Limits'/],
  ['a document that claims certification', (r) => editText(r, 'docs/loop/LOOP.md', (t) => `${t}\nThe emissions fixture is certified.\n`), /must not claim certification or compliance/],
  ['an emissions fixture that lost its disclaimer', (r) => editText(r, 'tests/fixtures/loop/emissions/EXPECTED.md', (t) => t.replace('not a certification-scheme factor', 'a factor')), /must say it is a test fixture only/],
  ['an expected result that disagrees with the data', (r) => editText(r, 'tests/fixtures/loop/emissions/EXPECTED.md', (t) => t.replace('**2500 kg**', '**1002.5 kg**')), /documented expected result and the fixture data disagree/],
  ['a recorded loop whose log was altered', (r) => { const d = path.join(r, 'docs/state/loops'); const id = fs.readdirSync(d).find((x) => x.startsWith('LOOP-')); editText(r, `docs/state/loops/${id}/events.jsonl`, (t) => t.replace('"action":"verify-start"', '"action":"verify-skip"')); }, /failed its integrity check/],
  ['a recorded loop whose evidence was altered', (r) => { const d = path.join(r, 'docs/state/loops'); const id = fs.readdirSync(d).find((x) => x.startsWith('LOOP-')); const c = path.join(d, id, 'checks'); const f = fs.readdirSync(c).find((x) => x.endsWith('.json')); editText(r, `docs/state/loops/${id}/checks/${f}`, (t) => t.replace('"exitCode"', '"exitCodeX"')); }, /failed its integrity check/],
];
for (const [name, mutate, re] of mutations) {
  test(`validate-loop rejects ${name}`, (t) => {
    const root = sandbox(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    assert.deepEqual(errorsOf(root), [], 'the sandbox copy starts clean');
    mutate(root);
    const errs = errorsOf(root);
    assert.ok(errs.some((e) => re.test(e)), `expected ${re}, got:\n${errs.join('\n') || '(nothing)'}`);
  });
}
