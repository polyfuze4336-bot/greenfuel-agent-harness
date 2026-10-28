#!/usr/bin/env node
// Validates the repair loop as configuration and as data: the policy, the wiring (permissions, agent commands, ignore rules), the
// documents, the emissions fixture's disclaimer, and the integrity of every loop committed under docs/state/loops. Zero dependencies.
// Usage: node harness/scripts/validate-loop.mjs [--root <dir>] [--json]
// It reads files only. The loop's behaviour (repair, diagnose, escalate, stop) is shown by tests/loop-engine.test.mjs.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const j = (root, p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));
const has = (root, p) => existsSync(path.join(root, p));
const STATES = ['PLAN', 'EXECUTE', 'VERIFY', 'CRITIQUE', 'DIAGNOSE', 'REPAIR', 'PASSED', 'ESCALATED', 'STOPPED', 'CANCELLED'];
const STOP = ['HARD_CONSTRAINT_VIOLATION', 'PERMISSION_VIOLATION', 'ACCESS_VIOLATION', 'SENSITIVE_DATA', 'MISSING_CONTEXT', 'UNSAFE_ACTION', 'TEST_TAMPERING', 'UNTRACKED_CHANGE'];
const ESCALATE = ['REPEATED_FAILURE', 'BUDGET_EXHAUSTED', 'NON_IDEMPOTENT_FAILURE', 'REVIEW_BLOCK', 'POLICY_VIOLATION'];
const REPAIR = ['BUILD_ERROR', 'TEST_FAILURE', 'CONTRACT_FAILURE', 'CALCULATION_MISMATCH', 'TIMEOUT', 'REVIEW_REWORK'];
const MUST_FORBID = ['azure.delete', 'azure.prod.any', 'secret.read', 'regulatory.file', 'commercial.settle', 'data.cross-shipowner', 'data.cross-jurisdiction', 'git.protected.modify', 'control-plane.write'];
const DANGEROUS = ['node -e 1', 'node -p 1', 'npm install left-pad', 'npx something', 'node harness/scripts/loop.mjs verify --loop LOOP-0123456789', 'node harness/scripts/approval.mjs sign --file x', 'node --test ../x.mjs', 'node --test --import ./x.mjs y.mjs', 'node --test --require x.js y.mjs', 'powershell -c x', 'git push origin main', 'az group delete -n x', 'curl http://x', 'node harness/scripts/record-evidence.mjs --id EV-1 -- x', 'node harness/scripts/memory.mjs approve DEC-1'];
const DOC_TOPICS = {
  'docs/loop/LOOP.md': ['Loop states', 'Failure classes', 'Retry budget', 'Test selection', 'Independent review', 'Recovery', 'Human escalation', 'Evidence', 'Enforced', 'Human procedure', 'Limits', 'Native'],
  'docs/loop/LOOP-VALIDATION-REPORT.md': ['Scenario', 'What was run', 'Not shown'],
};

export function validateLoop(root) {
  const errors = [];
  const fail = (msg) => errors.push({ check: 'loop', msg });
  try { check(root, fail); } catch (e) { fail(`the loop configuration is malformed and could not be fully evaluated (${e.message})`); }
  return errors;
}

function check(root, fail) {
  for (const f of ['harness/policy/loop-policy.json', 'harness/loop/loop.cjs', 'harness/scripts/loop.mjs', 'docs/loop/LOOP.md', 'docs/loop/LOOP-VALIDATION-REPORT.md', 'tests/fixtures/loop/emissions/EXPECTED.md']) if (!has(root, f)) { fail(`missing ${f}`); if (f.endsWith('loop-policy.json') || f.endsWith('loop.cjs')) return; }
  const P = j(root, 'harness/policy/loop-policy.json');
  if (P.schema !== 'greenfuel.loop-policy/v1') fail('policy schema must be greenfuel.loop-policy/v1');

  // state machine
  if (JSON.stringify(P.states) !== JSON.stringify(STATES)) fail(`states must be exactly ${STATES.join(', ')}`);
  if (JSON.stringify(Object.keys(P.transitions).sort()) !== JSON.stringify([...STATES].sort())) fail('transitions must define every state exactly once');
  for (const [from, tos] of Object.entries(P.transitions)) for (const to of tos) { if (!STATES.includes(to)) fail(`transition ${from} to ${to}: unknown state`); if (to === from) fail(`transition ${from} to itself`); }
  for (const s of P.terminalStates) if ((P.transitions[s] ?? []).length) fail(`terminal state ${s} must have no outgoing transition`);
  if (JSON.stringify([...P.terminalStates].sort()) !== JSON.stringify(['CANCELLED', 'ESCALATED', 'PASSED', 'STOPPED'])) fail('terminal states must be PASSED, ESCALATED, STOPPED and CANCELLED');
  const into = (t) => Object.entries(P.transitions).filter(([, v]) => v.includes(t)).map(([k]) => k).sort();
  if (JSON.stringify(into('PASSED')) !== JSON.stringify(['CRITIQUE', 'VERIFY'])) fail('PASSED may be entered only from VERIFY or CRITIQUE: success is never declared, it is verified');
  if (JSON.stringify(into('VERIFY')) !== JSON.stringify(['EXECUTE', 'REPAIR'])) fail('VERIFY may be entered only after an attempt (from EXECUTE or REPAIR)');
  if (!into('REPAIR').includes('DIAGNOSE')) fail('REPAIR must be reachable from DIAGNOSE so a repair after a failed repair passes through a diagnosis');
  if (JSON.stringify(into('REPAIR')) !== JSON.stringify(['CRITIQUE', 'DIAGNOSE', 'VERIFY'])) fail('REPAIR may be entered only from VERIFY or CRITIQUE (the loop decides, first failure) or DIAGNOSE (after a diagnosis)');
  if (!(P.transitions.DIAGNOSE ?? []).includes('REPAIR') || (P.transitions.DIAGNOSE ?? []).includes('VERIFY')) fail('DIAGNOSE may lead to REPAIR but never straight to VERIFY');
  for (const s of STATES) if (!P.stateNotes[s]) fail(`stateNotes needs ${s}`);

  // limits
  const L = P.limits;
  if (!(Number.isInteger(L.maxRepairAttempts) && L.maxRepairAttempts >= 1 && L.maxRepairAttempts <= 3)) fail('maxRepairAttempts must be 1 to 3 (the owner set 3 as the default and maximum)');
  if (!(Number.isInteger(L.maxIdenticalFailures) && L.maxIdenticalFailures >= 1 && L.maxIdenticalFailures <= 2)) fail('maxIdenticalFailures must be 1 to 2 (the owner set 2)');
  for (const k of ['timeoutSeconds', 'wallBudgetSeconds', 'maxCheckRuns', 'outputMaxBytes', 'leaseMinutes', 'maxChangedFiles', 'maxChecks', 'maxActions', 'textMax', 'maxWorkspaceFiles', 'maxWorkspaceBytes']) if (!(Number.isInteger(L[k]) && L[k] > 0)) fail(`limits.${k} must be a positive integer`);
  if (L.timeoutSeconds > L.wallBudgetSeconds) fail('a single check timeout cannot exceed the whole wall-clock budget');

  // failure classes
  for (const c of STOP) if (P.failureClasses[c]?.action !== 'stop') fail(`${c} must stop the loop at once`);
  for (const c of ESCALATE) if (P.failureClasses[c]?.action !== 'escalate') fail(`${c} must escalate to a person`);
  for (const c of REPAIR) if (P.failureClasses[c]?.action !== 'repair') fail(`${c} must be repairable`);
  for (const [c, d] of Object.entries(P.failureClasses)) if (![...STOP, ...ESCALATE, ...REPAIR].includes(c) || !['repair', 'escalate', 'stop'].includes(d.action) || !d.meaning) fail(`failure class ${c} is unknown or malformed`);
  for (const c of [...STOP, ...ESCALATE]) if (!P.severityOrder.includes(c) && !['REPEATED_FAILURE', 'BUDGET_EXHAUSTED', 'NON_IDEMPOTENT_FAILURE', 'REVIEW_BLOCK'].includes(c)) fail(`severityOrder must rank ${c}`);
  for (const c of P.severityOrder) if (!P.failureClasses[c]) fail(`severityOrder names unknown class ${c}`);
  if (P.severityOrder.indexOf('HARD_CONSTRAINT_VIOLATION') > P.severityOrder.indexOf('BUILD_ERROR')) fail('a hard-constraint violation must outrank a build error');
  for (const [k, c] of Object.entries(P.checkKinds)) if (!P.failureClasses[c]) fail(`check kind ${k} maps to unknown class ${c}`);
  if (JSON.stringify([...P.kindOrder].sort()) !== JSON.stringify(Object.keys(P.checkKinds).sort())) fail('kindOrder must list every check kind');
  for (const o of P.outputPatterns) { try { new RegExp(o.pattern); } catch { fail(`outputPatterns: invalid pattern ${o.pattern}`); } if (!P.failureClasses[o.class]) fail(`outputPatterns: unknown class ${o.class}`); }
  for (const b of P.bypassPhrases) { try { new RegExp(b); } catch { fail(`bypassPhrases: invalid pattern ${b}`); } }

  // commands, operations, classes
  if (!P.commandAllowList.length) fail('commandAllowList is required');
  for (const p of P.commandAllowList) { if (!p.startsWith('^') || !p.endsWith('$')) fail(`command pattern must be anchored: ${p}`); try { new RegExp(p); } catch { fail(`invalid command pattern ${p}`); } }
  const lp = require(path.join(root, 'harness/loop/loop.cjs'));
  const lctx = lp.makeContext({ root });
  for (const c of DANGEROUS) if (!lp.commandProblems(lctx, c.split(' '))) fail(`the loop would accept a dangerous check command: ${c}`);
  const perm = j(root, 'harness/policy/permissions.json');
  for (const o of [...P.forbiddenOps, ...P.noAutoRetryOps]) if (!perm.operations[o]) fail(`operation ${o} is not in permissions.json`);
  for (const o of MUST_FORBID) if (!P.forbiddenOps.includes(o)) fail(`forbiddenOps must include ${o}`);
  for (const o of P.noAutoRetryOps) if (P.forbiddenOps.includes(o)) fail(`${o} is both forbidden and no-auto-retry`);
  for (const c of ['control-plane', 'secret', 'shipowner', 'jurisdiction']) if (!P.protectedClasses.includes(c)) fail(`protectedClasses must include ${c}`);
  if (!P.reviewerAgents.length) fail('reviewerAgents is required');
  const ap = j(root, 'harness/policy/agent-policy.json');
  for (const r of P.reviewerAgents) if (!ap.agents[r]) fail(`reviewer ${r} is not an agent in agent-policy.json`);
  if (!P.sensitiveContent.length) fail('sensitiveContent markers are required');

  // toolchain pin
  const t = P.toolchains?.tsc;
  if (!t || !/^\d+\.\d+\.\d+$/.test(t.version ?? '') || !/^[0-9a-f]{64}$/.test(t.entrySha256 ?? '') || !/^sha(1|256|512)-/.test(t.lockIntegrity ?? '')) fail('the tsc toolchain must pin an exact version, a lock integrity and the entry file SHA-256');

  // wiring
  const cp = perm.pathClasses.find((c) => c.id === 'control-plane');
  if (!cp || !new RegExp(cp.pattern).test('docs/state/loops/LOOP-0123456789/loop.json')) fail('permissions.json: docs/state/loops/ must be a control-plane path so agents cannot write it');
  if (!new RegExp(cp?.pattern ?? '$^').test('harness/loop/loop.cjs')) fail('permissions.json: harness/ must stay a control-plane path');
  const grants = P.agentCommands ?? {};
  for (const [name, subs] of Object.entries(grants)) { if (!ap.agents[name]) fail(`agentCommands names unknown agent ${name}`); if (subs.some((s) => !['status', 'verify', 'verify-store'].includes(s))) fail(`agentCommands.${name}: only status, verify and verify-store may be run by an agent`); }
  const SUBS = ['init', 'begin', 'end', 'verify', 'diagnose', 'critique', 'resume', 'cancel', 'status', 'list', 'verify-store', 'report'];
  for (const [name, a] of Object.entries(ap.agents)) for (const sub of SUBS) {
    const cmd = `node harness/scripts/loop.mjs ${sub} --loop LOOP-0123456789`;
    const may = (a.commands ?? []).some((c) => new RegExp(c).test(cmd));
    const allowed = (grants[name] ?? []).includes(sub);
    if (may && !allowed) fail(`agent ${name} may run 'loop.mjs ${sub}', which loop-policy agentCommands does not grant`);
    if (!may && allowed) fail(`loop-policy grants ${name} 'loop.mjs ${sub}' but its command allow-list does not permit it`);
  }
  for (const cmd of ['node harness/scripts/loop.mjs init --task t.json --workspace .harness-work/x', 'node harness/scripts/loop.mjs verify --loop LOOP-0123456789 --x', 'node harness/scripts/loop.mjs verify --loop ../x']) for (const [name, a] of Object.entries(ap.agents)) if ((a.commands ?? []).some((c) => new RegExp(c).test(cmd))) fail(`agent ${name} may run a loop command outside the granted form: ${cmd}`);
  if (!has(root, '.gitignore') || !/^\.harness-work\/$/m.test(readFileSync(path.join(root, '.gitignore'), 'utf8'))) fail('.gitignore must ignore .harness-work/ (loop workspaces)');
  if (!has(root, '.gitignore') || !/^\.harness-toolchain\/$/m.test(readFileSync(path.join(root, '.gitignore'), 'utf8'))) fail('.gitignore must ignore .harness-toolchain/');

  // documents
  for (const [doc, topics] of Object.entries(DOC_TOPICS)) {
    if (!has(root, doc)) continue;
    const text = readFileSync(path.join(root, doc), 'utf8');
    for (const h of topics) if (!text.includes(h)) fail(`${doc}: must cover '${h}'`);
    for (const line of text.split('\n')) if (/\b(is|are|was|were) (a )?(certified|compliant|approved by (a )?(regulator|scheme))\b/i.test(line) && !/\b(not|never|no|without)\b/i.test(line)) fail(`${doc}: must not claim certification or compliance (${line.trim().slice(0, 60)})`);
  }
  if (has(root, 'tests/fixtures/loop/emissions/EXPECTED.md')) {
    const doc = readFileSync(path.join(root, 'tests/fixtures/loop/emissions/EXPECTED.md'), 'utf8');
    if (!/not a certification-scheme factor/i.test(doc) || !/test fixture only/i.test(doc)) fail('the emissions fixture must say it is a test fixture only and not a certification-scheme factor');
    const data = j(root, 'tests/fixtures/loop/emissions/workspace/fixture-data.json');
    if (!/FIXTURE ONLY/.test(data.note ?? '')) fail('the emissions fixture data must be labelled FIXTURE ONLY');
    if (!doc.includes(`**${data.expectedKg} kg**`)) fail('the documented expected result and the fixture data disagree');
  }

  // committed loops
  const loop = require(path.join(root, 'harness/loop/loop.cjs'));
  const ctx = loop.makeContext({ root, loopsDir: path.join(root, P.loopsDir) });
  for (const id of loop.listLoops(ctx)) {
    const v = loop.verifyLoop(ctx, id);
    if (!v.ok) fail(`loop ${id} failed its integrity check: ${v.problems.join('; ')}`);
    const state = JSON.parse(readFileSync(path.join(ctx.loopsDir, id, 'loop.json'), 'utf8')).state;
    if (!P.terminalStates.includes(state) && process.env.CI) fail(`loop ${id} is ${state}; finish, stop or cancel it before committing`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root');
  const root = path.resolve(i > 0 ? process.argv[i + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const errors = validateLoop(root);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ root, ok: !errors.length, errors }, null, 2));
  else if (errors.length) { for (const e of errors) console.error(`FAIL [${e.check}] ${e.msg}`); console.error(`${errors.length} problem(s).`); } else console.log('validate-loop: OK');
  process.exit(errors.length ? 1 : 0);
}
