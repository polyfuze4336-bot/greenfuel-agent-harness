#!/usr/bin/env node
// Validates the task-execution framework as configuration: the policy, the example plan, the hook registration, the
// orchestrator's wiring, the documents, and the integrity of any run committed to the repository. Zero dependencies.
// Usage: node harness/scripts/validate-orchestration.mjs [--root <dir>] [--json] [--write]
//   --write  regenerates the state and error-class tables in docs/orchestration/ORCHESTRATION.md
// It reads files only (except --write). The engine's behaviour is shown by the tests, not by this script.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const START = '<!-- generated:start (node harness/scripts/validate-orchestration.mjs --write) -->';
const END = '<!-- generated:end -->';
const DOC = 'docs/orchestration/ORCHESTRATION.md';
const STATES = ['PENDING', 'READY', 'RUNNING', 'BLOCKED', 'FAILED', 'VALIDATING', 'AWAITING_APPROVAL', 'COMPLETED', 'CANCELLED'];
const WORKFLOW = ['Understand the request', 'Retrieve relevant project context', 'Identify affected requirements and constraints', 'Create an execution plan', 'Identify dependencies and risks', 'Select the appropriate specialist agent', 'Check required permissions', 'Execute a bounded task', 'Run relevant validation', 'Request independent review', 'Record results and evidence', 'Continue, retry, escalate, or stop'];
const CONTRACT = ['id', 'objective', 'requirements', 'agent', 'inputContext', 'expectedArtifacts', 'permissions', 'dependsOn', 'acceptance', 'maxAttempts', 'status', 'evidence', 'recovery'];
const PROBES = ['rm -rf x', 'az group delete -n x', 'azd up', 'git push origin main', 'node -e 1', 'npm install left-pad', 'npm publish', 'node harness/scripts/approval.mjs sign --file x', 'node harness/scripts/approval.mjs keygen --out x', 'node harness/scripts/tasks.mjs approve --run x', 'node harness/scripts/record-evidence.mjs --id EV-1 -- x', 'node harness/scripts/validate-permissions.mjs --write', 'node --test docs/x.mjs', 'node --test tests/../x.mjs', 'powershell -c x', 'curl http://x'];
const j = (root, p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));
const has = (root, p) => existsSync(path.join(root, p));
const cell = (s) => String(s ?? '').replace(/\|/g, ' / ').replace(/\r?\n/g, ' ').trim();

export function renderOrchestrationTables(root) {
  const m = j(root, 'harness/policy/orchestration-policy.json');
  const L = ['### Task states and allowed transitions', '', '| From | May move to | Note |', '|---|---|---|'];
  for (const s of m.states) {
    const notes = Object.entries(m.transitionNotes ?? {}).filter(([k]) => k.startsWith(`${s}>`)).map(([k, v]) => `${k.split('>')[1]}: ${v}`).join('; ');
    L.push(`| ${s}${m.terminalStates.includes(s) ? ' (terminal)' : ''} | ${m.transitions[s].length ? m.transitions[s].join(', ') : 'nothing'} | ${cell(notes)} |`);
  }
  L.push('', '### Error classes and what the engine does', '', '| Class | Retryable | Action | Backoff (seconds) | Meaning |', '|---|---|---|---|---|');
  for (const [k, d] of Object.entries(m.errorClasses)) L.push(`| ${k} | ${d.retryable ? `yes${d.maxRetries ? `, at most ${d.maxRetries}` : ''}` : 'no'} | ${d.action} | ${d.backoffSeconds ? d.backoffSeconds.join(', ') : 'n/a'} | ${cell(d.meaning)} |`);
  L.push('', '### Run states', '', `${m.runStates.map((s) => `\`${s}\``).join(', ')}. A run is COMPLETED only when every task is COMPLETED and no blocking review verdict (${m.blockingVerdicts.join(', ')}) stands. NEEDS_HUMAN means no task can proceed without a person. STOPPED freezes the run after a policy violation or an internal inconsistency. CLOSED means a human concluded a NEEDS_HUMAN or STOPPED run (\`tasks.mjs close\`); closing approves nothing. While a run is ACTIVE, NEEDS_HUMAN or STOPPED, a delegation without its task marker is denied.`);
  L.push('', '### Limits (working values confirmed by the owner)', '', '| Limit | Value |', '|---|---|');
  for (const [k, v] of Object.entries(m.limits)) L.push(`| ${k} | ${v} |`);
  return L.join('\n');
}

export function validateOrchestration(root) {
  const errors = [];
  const fail = (msg) => errors.push({ check: 'orchestration', msg });
  try { check(root, fail); } catch (e) { fail(`the framework configuration is malformed and could not be fully evaluated (${e.message})`); }
  return errors;
}

function check(root, fail) {
  for (const f of ['harness/policy/orchestration-policy.json', 'harness/orchestration/engine.cjs', 'harness/hooks/delegation-guard.cjs', '.github/hooks/orchestration.json', 'harness/scripts/tasks.mjs', 'docs/orchestration/ORCHESTRATION.md', 'docs/orchestration/TASK-CONTRACT.md', 'docs/orchestration/templates/EXAMPLE-PLAN.json']) if (!has(root, f)) { fail(`missing ${f}`); if (f.endsWith('orchestration-policy.json')) return; }
  const m = j(root, 'harness/policy/orchestration-policy.json');
  const agents = j(root, 'harness/policy/agent-policy.json');

  if (JSON.stringify(m.states) !== JSON.stringify(STATES)) fail(`states must be exactly ${STATES.join(', ')}`);
  if (m.schema !== 'greenfuel.orchestration-policy/v1') fail('policy schema must be greenfuel.orchestration-policy/v1');
  for (const s of m.terminalStates) if (!m.states.includes(s)) fail(`terminal state ${s} is not a state`);
  if (JSON.stringify(Object.keys(m.transitions).sort()) !== JSON.stringify([...m.states].sort())) fail('transitions must define every state exactly once');
  for (const [from, tos] of Object.entries(m.transitions)) for (const to of tos) { if (!m.states.includes(to)) fail(`transition ${from} to ${to}: unknown state`); if (to === from) fail(`transition ${from} to itself`); }
  for (const s of m.terminalStates) if (s === 'CANCELLED' && m.transitions[s].length) fail('CANCELLED must have no outgoing transition');
  const into = (t) => Object.entries(m.transitions).filter(([, v]) => v.includes(t)).map(([k]) => k);
  if (JSON.stringify(into('COMPLETED')) !== JSON.stringify(['VALIDATING'])) fail('COMPLETED may be entered only from VALIDATING: nothing is complete until its acceptance tests ran');
  if (JSON.stringify(into('RUNNING').sort()) !== JSON.stringify(['READY'])) fail('RUNNING may be entered only from READY: a task starts only when its dependencies and approvals are met');
  if (!into('READY').includes('AWAITING_APPROVAL')) fail('an approved task must be able to move from AWAITING_APPROVAL to READY');
  const seen = new Set(['PENDING']); const q = ['PENDING'];
  while (q.length) for (const n of m.transitions[q.shift()] ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); }
  for (const s of m.states) if (!seen.has(s)) fail(`state ${s} cannot be reached from PENDING`);
  for (const k of Object.keys(m.transitionNotes ?? {})) { const [a, b] = k.split('>'); if (!m.transitions[a]?.includes(b)) fail(`transition note ${k} describes a transition that does not exist`); }
  for (const [from, tos] of Object.entries(m.transitions)) for (const to of tos) {
    const odd = [['RUNNING', 'AWAITING_APPROVAL'], ['RUNNING', 'READY'], ['COMPLETED', 'VALIDATING'], ['COMPLETED', 'READY'], ['COMPLETED', 'PENDING'], ['FAILED', 'READY'], ['FAILED', 'PENDING'], ['READY', 'PENDING'], ['AWAITING_APPROVAL', 'PENDING'], ['VALIDATING', 'BLOCKED']];
    if (odd.some(([a, b]) => a === from && b === to) && !m.transitionNotes?.[`${from}>${to}`]) fail(`transition ${from} to ${to} is unusual and needs a transitionNote saying when it is allowed`);
  }

  for (const [k, d] of Object.entries(m.errorClasses)) {
    if (typeof d.retryable !== 'boolean' || !['retry', 'block', 'escalate', 'stop'].includes(d.action) || !d.meaning) fail(`error class ${k} needs retryable, action and meaning`);
    if (d.retryable !== (d.action === 'retry')) fail(`error class ${k}: retryable must be true exactly when the action is retry`);
    if (d.retryable && !(Array.isArray(d.backoffSeconds) && d.backoffSeconds.length)) fail(`error class ${k}: a retryable class needs backoffSeconds`);
  }
  for (const k of ['TRANSIENT', 'INTERRUPTED', 'ACCEPTANCE_FAILED', 'INPUT_MISSING', 'PERMISSION_DENIED', 'CONFLICT', 'POLICY_VIOLATION', 'INTERNAL', 'UNKNOWN']) if (!m.errorClasses[k]) fail(`error class ${k} is required`);
  for (const k of ['PERMISSION_DENIED', 'POLICY_VIOLATION', 'CONFLICT', 'INTERNAL']) if (m.errorClasses[k]?.retryable) fail(`error class ${k} must never be retryable: retrying a refusal is a bypass`);
  for (const c of m.classifierPatterns) { if (!m.errorClasses[c.class]) fail(`classifier pattern names unknown class ${c.class}`); try { new RegExp(c.pattern, 'i'); } catch { fail(`classifier pattern for ${c.class} is not a valid regular expression`); } }
  const first = (cls) => m.classifierPatterns.findIndex((c) => c.class === cls);
  if (first('PERMISSION_DENIED') !== 0) fail('PERMISSION_DENIED must be the first classifier, so a denial is never reclassified as something retryable');

  for (const t of m.acceptanceTypes) if (!['file-exists', 'file-contains', 'file-not-contains', 'headings', 'min-words', 'json-valid', 'verdict', 'cites-requirements', 'no-secret', 'command'].includes(t)) fail(`unknown acceptance type ${t}`);
  for (const p of m.commandAllowList) {
    if (!p.startsWith('^') || !p.endsWith('$')) fail(`command allow-list pattern ${p} must be anchored at both ends`);
    try { new RegExp(p); } catch { fail(`command allow-list pattern ${p} is not a valid regular expression`); }
  }
  for (const probe of PROBES) if (m.commandAllowList.some((p) => new RegExp(p).test(probe))) fail(`the command allow-list permits a dangerous command: ${probe}`);
  for (const a of m.reviewerAgents) if (!agents.agents[a]) fail(`reviewer agent ${a} is not in agent-policy.json`);
  for (const v of m.blockingVerdicts) if (!m.verdicts.includes(v)) fail(`blocking verdict ${v} is not a verdict`);
  for (const [k, v] of Object.entries(m.limits)) if (!Number.isInteger(v) || v < 1) fail(`limit ${k} must be a positive integer`);
  if (m.limits.maxAttemptsCap > 5) fail('maxAttemptsCap above 5 defeats the bounded-retry rule');
  if (!m.delegation.requireSync) fail('tracked delegation must be synchronous so the result can be captured');
  if (!m.delegation.denyUntrackedWhileRunActive) fail('untracked delegation must be denied while a run is active, or the marker can be skipped');
  try { new RegExp(m.delegation.markerPattern); } catch { fail('delegation markerPattern is not a valid regular expression'); }
  if (!m.runsDir.startsWith('docs/state/runs')) fail('runsDir must be docs/state/runs');
  const perm = j(root, 'harness/policy/permissions.json');
  const cp = perm.pathClasses.find((c) => c.id === 'control-plane');
  if (!cp || !new RegExp(cp.pattern).test('docs/state/runs/RUN-0123456789/run.json')) fail('permissions.json must classify docs/state/runs/ as control plane so agents cannot edit run state');
  if (!new RegExp(cp.pattern).test('harness/policy/orchestration-policy.json')) fail('the orchestration policy must be control plane');

  const hooks = j(root, '.github/hooks/orchestration.json').hooks ?? {};
  if (!/delegation-guard\.cjs pre/.test(hooks.preToolUse?.[0]?.command ?? '')) fail('.github/hooks/orchestration.json must register the delegation guard for preToolUse');
  if (!/delegation-guard\.cjs post/.test(hooks.postToolUse?.[0]?.command ?? '')) fail('.github/hooks/orchestration.json must register the delegation guard for postToolUse');

  if (has(root, '.github/agents/orchestrator.agent.md')) {
    const t = readFileSync(path.join(root, '.github/agents/orchestrator.agent.md'), 'utf8');
    const toolsLine = /^tools:.*$/m.exec(t)?.[0] ?? '';
    for (const tool of ['check_plan', 'get_run_status']) if (!toolsLine.includes(`greenfuel-tools/${tool}`)) fail(`the orchestrator's tools line must grant greenfuel-tools/${tool}`);
    if (!t.includes('TASK-REF:')) fail('the orchestrator must be told to put the TASK-REF marker in delegation prompts');
    if (/(edit|execute|powershell|shell)/.test(toolsLine)) fail('the framework must not give the orchestrator an edit or execute tool; it stays read-only');
  } else fail('missing the orchestrator agent');
  if (agents.agents.orchestrator && (agents.agents.orchestrator.writes.length || agents.agents.orchestrator.commands.length)) fail('the orchestrator must keep no write scope and no commands');

  if (has(root, 'docs/orchestration/templates/EXAMPLE-PLAN.json')) {
    const engine = require(path.join(root, 'harness/orchestration/engine.cjs'));
    const v = engine.validatePlan(readFileSync(path.join(root, 'docs/orchestration/templates/EXAMPLE-PLAN.json'), 'utf8'), engine.makeContext({ root }));
    if (!v.ok) fail(`the example plan is invalid: ${v.errors.map((e) => `${e.task}/${e.code}`).join(', ')}`);
  }

  if (has(root, 'docs/orchestration/ORCHESTRATION.md')) {
    const text = readFileSync(path.join(root, DOC), 'utf8').replace(/\r\n/g, '\n');
    for (const s of WORKFLOW) if (!text.toLowerCase().includes(s.toLowerCase())) fail(`${DOC} must describe the workflow step "${s}"`);
    for (const s of STATES) if (!text.includes(s)) fail(`${DOC} must mention state ${s}`);
    const a = text.indexOf(START); const b = text.indexOf(END);
    if (a < 0 || b < a) fail(`${DOC}: generated table markers are missing`);
    else if (text.slice(a + START.length, b).trim() !== renderOrchestrationTables(root).trim()) fail(`${DOC}: the generated tables are out of date; run node harness/scripts/validate-orchestration.mjs --write`);
  }
  if (has(root, 'docs/orchestration/TASK-CONTRACT.md')) {
    const text = readFileSync(path.join(root, 'docs/orchestration/TASK-CONTRACT.md'), 'utf8');
    for (const f of CONTRACT) if (!new RegExp(`\`${f}\``).test(text)) fail(`TASK-CONTRACT.md must document the field ${f}`);
    for (const t of m.acceptanceTypes) if (!text.includes(`\`${t}\``)) fail(`TASK-CONTRACT.md must document the acceptance type ${t}`);
  }

  // Runs committed to the repository: intact, and none left ACTIVE (an ACTIVE run blocks ad hoc delegation).
  const runsDir = path.join(root, m.runsDir);
  if (existsSync(runsDir)) {
    const engine = require(path.join(root, 'harness/orchestration/engine.cjs'));
    const ctx = engine.makeContext({ root });
    for (const d of readdirSync(runsDir).filter((x) => /^RUN-[0-9a-f]{10}$/.test(x))) {
      const v = engine.verifyRun(ctx, d);
      if (!v.ok) fail(`run ${d} failed its integrity check: ${v.problems.join('; ')}`);
      else if (process.env.CI && engine.loadRun(ctx, d, { readOnly: true }).state === 'ACTIVE') fail(`run ${d} is ACTIVE; finish, stop or cancel it before committing, because an active run blocks untracked delegation`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root');
  const root = path.resolve(i > 0 ? process.argv[i + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  if (process.argv.includes('--write')) {
    const file = path.join(root, DOC);
    const text = readFileSync(file, 'utf8'); const crlf = text.includes('\r\n'); const t = text.replace(/\r\n/g, '\n');
    const a = t.indexOf(START); const b = t.indexOf(END);
    if (a < 0 || b < a) { console.error(`validate-orchestration: markers missing in ${DOC}`); process.exit(2); }
    const out = `${t.slice(0, a + START.length)}\n\n${renderOrchestrationTables(root)}\n\n${t.slice(b)}`;
    writeFileSync(file, crlf ? out.replace(/\n/g, '\r\n') : out);
    console.log(`validate-orchestration: regenerated tables in ${DOC}`);
    process.exit(0);
  }
  const errors = validateOrchestration(root);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ root, ok: !errors.length, errors }, null, 2));
  else if (errors.length) { for (const e of errors) console.error(`FAIL [${e.check}] ${e.msg}`); console.error(`${errors.length} problem(s).`); } else console.log('validate-orchestration: OK');
  process.exit(errors.length ? 1 : 0);
}
