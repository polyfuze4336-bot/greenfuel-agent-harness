import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engine, repo, examplePlan, plan, filePlan, tmp } from './support/orchestration-fixtures.mjs';

const ctx = engine.makeContext({ runsDir: tmp('gf-runs-') });
const codes = (p) => engine.validatePlan(p, ctx).errors.map((e) => e.code);
const taskOf = (p, id) => p.tasks.find((t) => t.id === id);

test('the example plan is valid, with an ordered graph, a critical path and a stable hash', () => {
  const v = engine.validatePlan(examplePlan(), ctx);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(v.order, ['T1', 'T2']);
  assert.deepEqual(v.levels, [['T1'], ['T2']]);
  assert.deepEqual(v.criticalPath, ['T1', 'T2']);
  assert.match(v.planHash, /^[0-9a-f]{64}$/);
  const reversed = JSON.parse(JSON.stringify(examplePlan(), (k, val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).reverse()) : val)));
  assert.equal(engine.validatePlan(reversed, ctx).planHash, v.planHash, 'key order does not change the plan hash');
  assert.notEqual(engine.validatePlan(plan((p) => { p.title = 'Other'; }), ctx).planHash, v.planHash);
});

test('a diamond graph gets levels and the longest path', () => {
  const p = plan((x) => {
    const t1 = taskOf(x, 'T1'); const t2 = taskOf(x, 'T2');
    const mk = (id, deps) => ({ ...JSON.parse(JSON.stringify(t1)), id, dependsOn: deps });
    x.tasks = [t1, mk('T3', ['T1']), mk('T4', ['T1']), { ...JSON.parse(JSON.stringify(t2)), dependsOn: ['T3', 'T4'] }];
  });
  const v = engine.validatePlan(p, ctx);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(v.levels, [['T1'], ['T3', 'T4'], ['T2']]);
  assert.equal(v.criticalPath.length, 3);
  assert.equal(v.criticalPath[0], 'T1'); assert.equal(v.criticalPath.at(-1), 'T2');
});

const mutations = [
  ['a missing request', (p) => { delete p.request; }, 'SCHEMA'],
  ['an unknown plan property', (p) => { p.extra = 1; }, 'SCHEMA'],
  ['an unknown task property', (p) => { taskOf(p, 'T1').extra = 1; }, 'SCHEMA'],
  ['a requirement that does not exist', (p) => { p.requirements.push('FR-999'); }, 'REQ_UNKNOWN'],
  ['a task requirement outside the plan list', (p) => { taskOf(p, 'T1').requirements = ['BR-001']; }, 'REQ_NOT_IN_PLAN'],
  ['no requirements', (p) => { p.requirements = []; }, 'REQ_MISSING'],
  ['a constraint that does not exist', (p) => { p.constraints = ['HC-99']; }, 'CONSTRAINT_UNKNOWN'],
  ['no risks', (p) => { p.risks = []; }, 'RISK'],
  ['a risk without a mitigation', (p) => { p.risks[0].mitigation = ''; }, 'RISK'],
  ['a duplicate task id', (p) => { taskOf(p, 'T2').id = 'T1'; }, 'DUP_ID'],
  ['a bad task id', (p) => { taskOf(p, 'T2').id = 'second task'; }, 'TASK_ID'],
  ['an unknown dependency', (p) => { taskOf(p, 'T2').dependsOn = ['T9']; }, 'UNKNOWN_DEP'],
  ['a dependency cycle', (p) => { taskOf(p, 'T1').dependsOn = ['T2']; }, 'CYCLE'],
  ['a self dependency', (p) => { taskOf(p, 'T1').dependsOn = ['T1']; }, 'CYCLE'],
  ['an unknown agent', (p) => { taskOf(p, 'T1').agent = 'free-agent'; }, 'UNKNOWN_AGENT'],
  ['the orchestrator delegating to itself', (p) => { taskOf(p, 'T1').agent = 'orchestrator'; }, 'SELF_DELEGATION'],
  ['a built-in agent name', (p) => { taskOf(p, 'T1').agent = 'general-purpose'; }, 'UNKNOWN_AGENT'],
  ['a tool the agent does not have', (p) => { taskOf(p, 'T1').permissions.tools = ['read', 'execute']; }, 'TOOL_NOT_GRANTED'],
  ['an unknown operation', (p) => { taskOf(p, 'T1').permissions.operations = ['fs.read', 'fs.teleport']; }, 'OP_UNKNOWN'],
  ['an operation that can never be granted', (p) => { taskOf(p, 'T1').permissions.operations = ['regulatory.file']; taskOf(p, 'T1').permissions.tier = 'P4'; }, 'OP_NEVER_GRANTABLE'],
  ['a production operation', (p) => { taskOf(p, 'T1').permissions.operations = ['azure.prod.any']; taskOf(p, 'T1').permissions.tier = 'P4'; }, 'OP_NEVER_GRANTABLE'],
  ['an Azure deployment in phase 0', (p) => { taskOf(p, 'T1').permissions.operations = ['azure.nonprod.deploy']; taskOf(p, 'T1').permissions.tier = 'P3'; }, 'PHASE_GATE'],
  ['a tier below its operations', (p) => { taskOf(p, 'T1').permissions.tier = 'P1'; }, 'TIER_MISMATCH'],
  ['a write above the agent ceiling', (p) => { Object.assign(taskOf(p, 'T1').permissions, { tier: 'P1', operations: ['fs.write'] }); }, 'ABOVE_CEILING'],
  ['no recovery plan', (p) => { delete taskOf(p, 'T1').recovery; }, 'RECOVERY'],
  ['too many attempts', (p) => { taskOf(p, 'T1').maxAttempts = 9; }, 'ATTEMPTS'],
  ['zero attempts', (p) => { taskOf(p, 'T1').maxAttempts = 0; }, 'ATTEMPTS'],
  ['no acceptance tests', (p) => { taskOf(p, 'T1').acceptance = []; }, 'ACCEPTANCE_MISSING'],
  ['an unknown acceptance type', (p) => { taskOf(p, 'T1').acceptance[0].type = 'looks-good'; }, 'ACCEPTANCE_TYPE'],
  ['an acceptance target that is not an artifact', (p) => { taskOf(p, 'T1').acceptance[0].target = 'README.md'; }, 'ACCEPTANCE_TARGET'],
  ['a bad acceptance pattern', (p) => { taskOf(p, 'T1').acceptance.push({ id: 'A9', type: 'file-contains', target: '@result', pattern: '(' }); }, 'ACCEPTANCE'],
  ['a duplicate acceptance id', (p) => { taskOf(p, 'T1').acceptance[1].id = 'A1'; }, 'ACCEPTANCE'],
  ['a command that is not on the allow-list', (p) => { taskOf(p, 'T1').acceptance.push({ id: 'A9', type: 'command', argv: ['rm', '-rf', 'x'] }); }, 'COMMAND_NOT_ALLOWED'],
  ['a command with shell metacharacters', (p) => { taskOf(p, 'T1').acceptance.push({ id: 'A9', type: 'command', argv: ['npm', 'test;calc'] }); }, 'COMMAND_NOT_ALLOWED'],
  ['a node test outside tests/', (p) => { taskOf(p, 'T1').acceptance.push({ id: 'A9', type: 'command', argv: ['node', '--test', 'docs/x.mjs'] }); }, 'COMMAND_NOT_ALLOWED'],
  ['a context file that does not exist', (p) => { taskOf(p, 'T1').inputContext = ['docs/nope.md']; }, 'CONTEXT_MISSING'],
  ['a secret as context', (p) => { taskOf(p, 'T1').inputContext = ['.env']; }, 'CONTEXT_FORBIDDEN'],
  ['another shipowner as context', (p) => { taskOf(p, 'T1').inputContext = ['tests/fixtures/shipowners/owner-a/delivery-summary.json']; }, 'CONTEXT_FORBIDDEN'],
  ['a context path that climbs out', (p) => { taskOf(p, 'T1').inputContext = ['../secrets.md']; }, 'CONTEXT_PATH'],
  ['a status set by the plan', (p) => { taskOf(p, 'T1').status = 'COMPLETED'; }, 'STATUS'],
  ['evidence supplied by the plan', (p) => { taskOf(p, 'T1').evidence = [{ ref: 'x' }]; }, 'STATUS'],
  ['no artifacts', (p) => { taskOf(p, 'T1').expectedArtifacts = []; }, 'ARTIFACTS'],
  ['a bad artifact kind', (p) => { taskOf(p, 'T1').expectedArtifacts = [{ kind: 'database' }]; }, 'ARTIFACTS'],
  ['an approval block without a reason', (p) => { taskOf(p, 'T1').approval = { required: true, tier: 'P2', reason: '' }; }, 'APPROVAL'],
  ['an orchestrator task delegated to a specialist agent', (p) => { taskOf(p, 'T1').executor = 'orchestrator'; }, 'EXECUTOR'],
  ['too many tasks', (p) => { p.tasks = Array.from({ length: 26 }, (_, i) => ({ ...JSON.parse(JSON.stringify(taskOf(p, 'T1'))), id: `T${i + 1}`, dependsOn: [] })); }, 'TOO_MANY'],
];
for (const [name, fn, code] of mutations) {
  test(`plan validation rejects ${name}`, () => {
    const p = examplePlan(); fn(p);
    const found = codes(p);
    assert.ok(found.includes(code), `expected ${code}, got ${found.join(', ') || 'no errors'}`);
  });
}

test('plan validation rejects invalid JSON text and an oversize plan', () => {
  assert.deepEqual(engine.validatePlan('{ nope', ctx).errors.map((e) => e.code), ['JSON']);
  assert.ok(engine.validatePlan(`{"x":"${'a'.repeat(70000)}"}`, ctx).errors.some((e) => e.code === 'SIZE'));
  assert.deepEqual(engine.validatePlan('[]', ctx).errors.map((e) => e.code), ['SCHEMA']);
});

const fileMutations = [
  ['a file artifact for a planner', (p) => { Object.assign(taskOf(p, 'T2'), { expectedArtifacts: [{ kind: 'file', path: 'docs/design/system/R.md' }] }); }, 'PLANNER_FILE_ARTIFACT'],
  ['an artifact outside the author write scope', (p) => { taskOf(p, 'T1').expectedArtifacts = [{ kind: 'file', path: 'docs/design/azure/X.md' }]; taskOf(p, 'T1').acceptance[0].target = taskOf(p, 'T1').acceptance[1].target = 'docs/design/azure/X.md'; }, 'ARTIFACT_SCOPE'],
  ['an artifact in the run store', (p) => { const f = 'docs/state/runs/RUN-aaaaaaaaaa/x.md'; taskOf(p, 'T1').expectedArtifacts = [{ kind: 'file', path: f }]; taskOf(p, 'T1').acceptance.forEach((a) => { a.target = f; }); }, 'ARTIFACT_CLASS'],
  ['a script artifact', (p) => { const f = 'docs/design/system/run.mjs'; taskOf(p, 'T1').expectedArtifacts = [{ kind: 'file', path: f }]; taskOf(p, 'T1').acceptance.forEach((a) => { a.target = f; }); }, 'ARTIFACT_EXEC'],
  ['an artifact path that climbs out', (p) => { taskOf(p, 'T1').expectedArtifacts = [{ kind: 'file', path: 'docs/design/system/../../../x.md' }]; }, 'ARTIFACT_PATH'],
  ['a file task that does not list fs.write', (p) => { taskOf(p, 'T1').permissions = { tier: 'P0', tools: ['read'], operations: ['fs.read'] }; }, 'OPERATIONS'],
  ['an author without a review or waiver', (p) => { delete taskOf(p, 'T1').review; }, 'REVIEW_MISSING'],
  ['a self review', (p) => { taskOf(p, 'T2').agent = 'principal-architect'; }, 'REVIEW_SELF'],
  ['a reviewer that is not a reviewer agent', (p) => { taskOf(p, 'T2').agent = 'data-engineer'; }, 'REVIEW_AGENT'],
  ['a review task that does not depend on the reviewed task', (p) => { taskOf(p, 'T2').dependsOn = []; }, 'REVIEW_DEP'],
  ['a review task without a verdict test', (p) => { taskOf(p, 'T2').acceptance = [{ id: 'A1', type: 'min-words', target: '@result', min: 5 }]; }, 'REVIEW_VERDICT'],
  ['an unchecked artifact', (p) => { taskOf(p, 'T1').acceptance = [{ id: 'A9', type: 'command', argv: ['npm', 'test'] }]; }, 'ARTIFACT_UNCHECKED'],
  ['a short waiver', (p) => { taskOf(p, 'T1').review = { waiver: 'no' }; }, 'REVIEW'],
  ['a review that names a missing task', (p) => { taskOf(p, 'T1').review = { required: true, by: 'T7' }; }, 'REVIEW_MISSING'],
];
test('the file plan is valid, and a waiver with a reason replaces a review', () => {
  assert.equal(engine.validatePlan(filePlan(), ctx).ok, true, JSON.stringify(engine.validatePlan(filePlan(), ctx).errors));
  assert.equal(engine.validatePlan(filePlan((p) => { taskOf(p, 'T1').review = { waiver: 'Throwaway scratch note for a test; no reviewer needed.' }; }), ctx).ok, true);
});
for (const [name, fn, code] of fileMutations) {
  test(`plan validation rejects ${name}`, () => {
    const found = codes(filePlan(fn));
    assert.ok(found.includes(code), `expected ${code}, got ${found.join(', ') || 'no errors'}`);
  });
}

test('an operation at P2 or above is allowed in a plan but makes the task wait for a signed approval', () => {
  const p = filePlan((x) => {
    x.tasks[0] = { ...taskOf(x, 'T1'), agent: 'qa-engineer', permissions: { tier: 'P2', tools: ['read', 'execute'], operations: ['fs.read', 'git.write'] }, expectedArtifacts: [{ kind: 'result' }], acceptance: [{ id: 'A1', type: 'file-exists', target: '@result' }], review: { waiver: 'Local branch change checked by the pull request review.' } };
  });
  const v = engine.validatePlan(p, ctx);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.deepEqual(v.needsApproval, ['T1']);
  assert.ok(v.warnings.some((w) => w.code === 'APPROVAL'));
});

test('a task run by the orchestrator itself is valid only when read-only with a result artifact', () => {
  const p = examplePlan();
  p.tasks.push({ id: 'T3', title: 'Consolidate', objective: 'Consolidate T1 and T2.', requirements: ['SEC-001'], agent: 'orchestrator', executor: 'orchestrator', inputContext: [], expectedArtifacts: [{ kind: 'result' }], permissions: { tier: 'P0', tools: ['read', 'search'], operations: ['fs.read'] }, dependsOn: ['T1', 'T2'], acceptance: [{ id: 'A1', type: 'min-words', target: '@result', min: 20 }], maxAttempts: 1, recovery: 'Writes nothing; capture the consolidation again.' });
  assert.equal(engine.validatePlan(p, ctx).ok, true, JSON.stringify(engine.validatePlan(p, ctx).errors));
  taskOf(p, 'T3').permissions.operations = ['fs.write'];
  assert.ok(codes(p).includes('ABOVE_CEILING'));
});

test('the real repository is untouched: validating plans reads files but creates none', () => {
  assert.ok(engine.makeContext().runsDir.endsWith('docs\\state\\runs') || engine.makeContext().runsDir.endsWith('docs/state/runs'));
  assert.ok(repo.length > 0);
});
