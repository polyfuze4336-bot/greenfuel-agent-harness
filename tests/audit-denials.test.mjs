import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { engine, repo, tmpDir, realModel } from './support/permission-fixtures.mjs';
import { compare, classifyFailure, applyCommands } from '../harness/scripts/verify-github-protection.mjs';

const spec = JSON.parse(readFileSync(path.join(repo, 'harness/policy/github-protection.json'), 'utf8'));
const compliant = {
  required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true, require_code_owner_reviews: true },
  required_status_checks: { strict: true, contexts: ['validate'] }, enforce_admins: { enabled: true }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false },
  required_linear_history: { enabled: true }, required_conversation_resolution: { enabled: true },
};

test('verify-github-protection: a compliant protection response has no differences, and each weakening is reported', () => {
  assert.deepEqual(compare(spec, compliant), []);
  const weaken = {
    requirePullRequest: (r) => { delete r.required_pull_request_reviews; }, enforceAdmins: (r) => { r.enforce_admins.enabled = false; }, allowForcePushes: (r) => { r.allow_force_pushes.enabled = true; },
    allowDeletions: (r) => { r.allow_deletions.enabled = true; }, requireCodeOwnerReview: (r) => { r.required_pull_request_reviews.require_code_owner_reviews = false; }, requiredStatusChecks: (r) => { r.required_status_checks.contexts = []; },
  };
  for (const [name, fn] of Object.entries(weaken)) { const r = JSON.parse(JSON.stringify(compliant)); fn(r); assert.ok(compare(spec, r).some((d) => d.startsWith(name)), name); }
});

test('verify-github-protection: failures are classified from status codes, and apply commands are printed rather than run', () => {
  assert.equal(classifyFailure('gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)').status, 'UNAVAILABLE');
  assert.equal(classifyFailure('gh: Branch not protected (HTTP 404)').status, 'NOT-PROTECTED');
  assert.equal(classifyFailure('network down').status, 'ERROR');
  const cmds = applyCommands(spec);
  assert.ok(cmds.every((c) => c.startsWith('gh api')));
  assert.match(readFileSync(path.join(repo, 'harness/scripts/verify-github-protection.mjs'), 'utf8'), /never runs them/);
});

test('audit-denials: verify passes on an intact chain, fails on tampering, and summary reads without printing arguments', () => {
  const dir = tmpDir('gf-audit-cli-');
  const file = path.join(dir, 'denied-actions.jsonl');
  const ev = { sessionId: 's', toolName: 'powershell', toolArgs: { command: 'az group delete -n harmless-simulated-rg' } };
  for (let i = 0; i < 3; i += 1) engine.writeAudit(realModel, ev, { mode: 'agent', operations: [{ op: 'azure.delete', tier: 4, env: 'azure-nonprod' }], rules: ['DEF-06'], reasons: ['simulated'], targets: [] }, { agent: 'qa-engineer', logDir: dir });
  const run = (cmd) => spawnSync(process.execPath, [path.join(repo, 'harness/scripts/audit-denials.mjs'), cmd, '--file', file], { encoding: 'utf8' });
  assert.equal(run('verify').status, 0, run('verify').stderr);
  const sum = run('summary');
  assert.equal(sum.status, 0);
  assert.match(sum.stdout, /DEF-06/);
  assert.doesNotMatch(sum.stdout, /harmless-simulated-rg/);
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  writeFileSync(file, `${[lines[0], lines[2]].join('\n')}\n`);
  assert.equal(run('verify').status, 1, 'a removed record breaks the chain');
  assert.equal(spawnSync(process.execPath, [path.join(repo, 'harness/scripts/audit-denials.mjs'), 'verify', '--file', path.join(dir, 'missing.jsonl')], { encoding: 'utf8' }).status, 0, 'no log means nothing denied yet');
});

test('audit log writes never contain raw arguments or secrets', () => {
  const dir = tmpDir('gf-audit-redact-');
  const tok = `gh${'p'}_${'Z9y8X7w6V5'.repeat(4)}`;
  engine.writeAudit(realModel, { sessionId: 's', toolName: 'powershell', toolArgs: { command: `curl -H "Authorization: Bearer ${tok}" http://example.invalid` } }, { mode: 'session', operations: [], rules: ['DEF-03'], reasons: ['simulated'], targets: [] }, { agent: null, logDir: dir });
  const text = readFileSync(path.join(dir, 'denied-actions.jsonl'), 'utf8');
  assert.doesNotMatch(text, /Z9y8X7w6V5/);
  const rec = JSON.parse(text.trim());
  assert.equal(rec.agent, null);
  assert.match(rec.argsSha256, /^[0-9a-f]{64}$/);
});
