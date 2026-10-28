#!/usr/bin/env node
// Validates the evaluation framework as configuration and as data: the policy, the catalogues, the control-plane wiring, the
// documents, and every committed run (each recorded status is re-derived from its evidence, and the committed report must be
// exactly what the latest run generates). Zero dependencies.
// Usage: node harness/scripts/validate-evaluation.mjs [--root <dir>] [--json]
// It reads files only and never runs a test. Running the evaluation is a human step: node harness/scripts/evaluate.mjs run.
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const j = (root, p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));
const has = (root, p) => existsSync(path.join(root, p));
const DOMAINS = ['REQ', 'ARC', 'FUN', 'DAT', 'SOV', 'SEC', 'REL', 'OBS', 'PRF', 'AZR', 'OPS', 'CST'];
const GATES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'];
const RED_TEAM = ['RT-01', 'RT-02', 'RT-03', 'RT-04', 'RT-05', 'RT-06', 'RT-07', 'RT-08', 'RT-09', 'RT-10', 'RT-11'];
const STATUSES = ['PASS', 'FAIL', 'BLOCKED', 'PENDING'];
// Commands the allow-list must refuse: shells, option injection, installs, network, approvals and anything that writes records.
const DANGEROUS = ['node -e 1', 'node -p 1', 'npm install left-pad', 'npx something', 'node --test --import ./x.mjs y.mjs', 'node --test --require x.js y.mjs', 'node --test --test-reporter=tap ../x.mjs', 'node --test --test-reporter=tap /etc/x.mjs',
  'node --test --test-reporter=tap', 'node --test --test-reporter=spec x.mjs', 'powershell -c x', 'git push origin main', 'az group delete -n x', 'curl http://x',
  'node harness/scripts/approval.mjs sign --file x', 'node harness/scripts/memory.mjs approve DEC-1', 'node harness/scripts/loop.mjs verify --loop LOOP-0123456789', 'node harness/scripts/tasks.mjs submit x',
  'node harness/scripts/record-evidence.mjs --id EV-1 -- x', 'node harness/scripts/evaluate.mjs run', 'node harness/scripts/validate-memory.mjs ../x', 'node harness/scripts/validate-loop.mjs;x'];
const DOC_TOPICS = {
  'docs/evaluation/EVALUATION-FRAMEWORK.md': ['Domains', 'Quality gates', 'Result statuses', 'Separation of the suites', 'Red-team scenarios', 'Running', 'Enforced', 'Human procedure', 'Findings', 'Limits', 'Native'],
};

export function validateEvaluation(root) {
  const errors = [];
  const fail = (msg) => errors.push({ check: 'evaluation', msg });
  try { check(root, fail); } catch (e) { fail(`the evaluation framework is malformed and could not be fully evaluated (${e.message})`); }
  return errors;
}

function check(root, fail) {
  const required = ['harness/policy/evaluation-policy.json', 'harness/eval/eval.cjs', 'harness/scripts/evaluate.mjs', 'evaluation/catalogue/harness.json', 'evaluation/catalogue/production.json',
    'evaluation/checks/harness.eval.mjs', 'evaluation/checks/production-contract.eval.mjs', 'evaluation/fixtures/malicious-feedstock-certificate.txt', 'docs/evaluation/EVALUATION-FRAMEWORK.md', 'docs/evaluation/EVALUATION-REPORT.md'];
  for (const f of required) if (!has(root, f)) { fail(`missing ${f}`); if (f.endsWith('evaluation-policy.json') || f.endsWith('eval.cjs')) return; }
  const P = j(root, 'harness/policy/evaluation-policy.json');
  if (P.schema !== 'greenfuel.evaluation-policy/v1') fail('policy schema must be greenfuel.evaluation-policy/v1');
  if (JSON.stringify(P.statuses) !== JSON.stringify(STATUSES)) fail(`statuses must be exactly ${STATUSES.join(', ')}`);
  if (JSON.stringify(P.domains.map((d) => d.id)) !== JSON.stringify(DOMAINS)) fail(`domains must be exactly ${DOMAINS.join(', ')} (the twelve required domains)`);
  if (JSON.stringify(P.redTeam.map((r) => r.id)) !== JSON.stringify(RED_TEAM)) fail(`red-team scenarios must be exactly ${RED_TEAM.join(', ')}`);
  if (JSON.stringify(P.gates.map((g) => g.id)) !== JSON.stringify(GATES)) fail(`gates must be exactly ${GATES.join(', ')}`);
  P.gates.forEach((g, i) => { if (JSON.stringify(g.dependsOn) !== JSON.stringify(i ? [GATES[i - 1]] : [])) fail(`${g.id} must depend on exactly the previous gate, so progression cannot skip a gate`); });
  if (P.hardConstraints.length !== 12) fail('hardConstraints must list HC-01 to HC-12');
  for (const s of ['harness', 'production-contract', 'production-agent']) if (!P.scopes?.[s]) fail(`scopes must define ${s}: harness and production tests stay separate`);
  if (!P.gateRules.some((r) => /no score/i.test(r)) || !P.gateRules.some((r) => /hard constraint/i.test(r)) || !P.gateRules.some((r) => /entry/i.test(r))) fail('gateRules must state: no score, hard-constraint reporting, entry criteria');
  if (!(P.limits.timeoutSeconds > 0 && P.limits.outputMaxBytes > 0 && P.limits.actualMax > 0)) fail('limits must be positive');

  // the command allow-list is the runner's only authority: it must accept what the catalogue uses and refuse what must never run
  const list = P.commandAllowList.map((s) => new RegExp(s));
  for (const d of DANGEROUS) if (list.some((r) => r.test(d))) fail(`the command allow-list accepts '${d}'`);
  if (!list.some((r) => r.test('node --test --test-reporter=tap tests/x.test.mjs')) || !list.some((r) => r.test('node harness/scripts/validate-memory.mjs'))) fail('the command allow-list must accept the commands the catalogue uses');

  // catalogue, through the engine's own validation
  const ev = require(path.join(root, 'harness/eval/eval.cjs'));
  const ctx = ev.makeContext({ root, policy: P });
  for (const p of ev.validateCatalogue(ctx)) fail(`catalogue: ${p}`);
  const cat = ev.loadCatalogue(ctx);
  // the two suites stay apart and the production agent suite is entirely pending
  for (const t of cat.tests) if (t.scope === 'production-agent' && t.mode !== 'pending') fail(`${t.id}: a production-agent test must be pending until a human raises the phase`);

  // wiring: the evaluation is control plane, so an agent cannot edit a test or a result to make it pass
  const perm = j(root, 'harness/policy/permissions.json'); const cp = perm.pathClasses.find((c) => c.id === 'control-plane');
  for (const p of ['evaluation/catalogue/harness.json', 'evaluation/checks/harness.eval.mjs', 'evaluation/fixtures/x.txt', 'docs/evaluation/EVALUATION-REPORT.md', 'docs/evaluation/runs/EVRUN-0123456789/run.json', 'harness/eval/eval.cjs', 'harness/policy/evaluation-policy.json']) {
    if (!cp || !new RegExp(cp.pattern).test(p)) fail(`permissions.json: ${p} must be a control-plane path so no agent can write it`);
  }
  const agent = j(root, 'harness/policy/agent-policy.json');
  const agentCommands = Object.values(agent.agents ?? {}).flatMap((a) => a.commands ?? []);
  if (agentCommands.some((c) => /\bevaluate\b/.test(c))) fail('agent-policy.json: no agent may be granted evaluate.mjs; running the evaluation is a human step, so an agent cannot produce or alter a result');
  const ci = has(root, '.github/workflows/validate.yml') ? readFileSync(path.join(root, '.github/workflows/validate.yml'), 'utf8') : '';
  if (ci && !/evaluat/i.test(ci) && !/npm run validate|validate-harness/.test(ci)) fail('CI must run the validators, which include validate-evaluation');
  const pkg = j(root, 'package.json');
  if (!/validate-evaluation|validate-harness|npm run validate/.test(JSON.stringify(pkg.scripts))) fail('package.json must run the evaluation validator');

  // CI re-run: the tolerated differences are few, named, reasoned, and can never excuse a failure or a control test
  const rr = P.ciRerun?.allowedDifferences;
  if (!Array.isArray(rr)) fail('policy ciRerun.allowedDifferences must be a list (it may be empty): CI re-runs the evaluation and compares it with the committed run');
  else {
    const entryIds = new Set(cat.tests.filter((t) => t.entry).map((t) => t.id));
    for (const a of rr) {
      const t = cat.tests.find((x) => x.id === a.id);
      if (!t) fail(`ciRerun: ${a.id} is not a catalogue test`);
      else if (t.entry || (t.hardConstraints ?? []).length) fail(`ciRerun: ${a.id} guards a control or a hard constraint and cannot be a tolerated difference`);
      if (a.status !== 'BLOCKED') fail(`ciRerun: ${a.id} may only differ as BLOCKED (a skipped test), never PASS, FAIL or PENDING`);
      if (typeof a.reason !== 'string' || a.reason.trim().length < 25) fail(`ciRerun: ${a.id} needs a reason of 25 characters or more`);
      if (entryIds.has(a.id)) fail(`ciRerun: ${a.id} is an entry test`);
    }
    if (rr.length > 3) fail('ciRerun: more than three tolerated differences: the re-run no longer reproduces the committed run');
  }
  const wf = has(root, '.github/workflows/validate.yml') ? readFileSync(path.join(root, '.github/workflows/validate.yml'), 'utf8') : '';
  if (!/evaluate\.mjs rerun/.test(wf)) fail('.github/workflows/validate.yml must run evaluate.mjs rerun so CI re-runs the evaluation and compares it with the committed run');

  // documents
  for (const [f, topics] of Object.entries(DOC_TOPICS)) {
    if (!has(root, f)) continue;
    const text = readFileSync(path.join(root, f), 'utf8');
    for (const t of topics) if (!new RegExp(`^#{1,3} .*${t}`, 'm').test(text)) fail(`${f}: needs a heading about '${t}'`);
  }

  // committed runs: every status re-derives from its evidence, and the report is exactly the latest run
  const runs = ev.listRuns(ctx);
  const fullRuns = [];
  for (const id of runs) {
    const r = ev.verifyRun(ctx, id);
    for (const p of r.problems.filter((x) => !x.startsWith('note:'))) fail(`${id}: ${p}`);
    if (r.ok) { const run = j(root, `docs/evaluation/runs/${id}/run.json`); if (!run.partial) fullRuns.push({ id, startedAt: run.startedAt }); }
  }
  if (!fullRuns.length) fail('there is no committed full evaluation run: the report cannot be traced to evidence');
  else {
    const latest = fullRuns.sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1).id;
    const expected = ev.renderReport(ctx, latest);
    const actual = readFileSync(path.join(root, 'docs/evaluation/EVALUATION-REPORT.md'), 'utf8').replace(/\r\n/g, '\n');
    if (actual !== expected) fail(`docs/evaluation/EVALUATION-REPORT.md does not match what ${latest} generates; regenerate it with evaluate.mjs report --run ${latest} --write, never edit it`);
    // a report may not claim a result the run did not produce
    const run = j(root, `docs/evaluation/runs/${latest}/run.json`);
    const { sha256: sha, canonical: canon } = require(path.join(root, 'harness/hooks/permission-engine.cjs'));
    if (run.catalogueSha256 !== cat.sha256) fail(`${latest} was made with a different catalogue from the current one: the committed run is stale, run the evaluation again`);
    if (run.policySha256 !== sha(canon(P))) fail(`${latest} was made with a different evaluation policy from the current one: the committed run is stale, run the evaluation again`);
    for (const t of run.tests) if (t.status === 'PASS' && !has(root, `docs/evaluation/runs/${latest}/${t.evidenceRef}`)) fail(`${t.id}: PASS without an evidence file`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const ri = args.indexOf('--root');
  const root = ri >= 0 ? path.resolve(args[ri + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const errors = validateEvaluation(root);
  if (args.includes('--json')) console.log(JSON.stringify({ ok: !errors.length, errors }, null, 2));
  else if (errors.length) { for (const e of errors) console.error(`validate-evaluation: ${e.msg}`); } else console.log('validate-evaluation: OK');
  process.exit(errors.length ? 1 : 0);
}
