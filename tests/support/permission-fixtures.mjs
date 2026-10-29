// Support for the permission tests. Everything here is a harmless simulation: keys are generated in memory and thrown away,
// resource groups and subscriptions are fictional, and no Azure, GitHub or network call is made.
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const engine = require('../../harness/hooks/permission-engine.cjs');
export const guard = require('../../harness/hooks/agent-guard.cjs');
export const sessionGuard = require('../../harness/hooks/policy-guard.cjs');
export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const agentPolicy = JSON.parse(readFileSync(path.join(repo, 'harness/policy/agent-policy.json'), 'utf8'));
export const registry = JSON.parse(readFileSync(path.join(repo, 'harness/tools/tool-registry.json'), 'utf8'));
export const realModel = engine.loadModel();

const dirs = [];
process.on('exit', () => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
export const tmpDir = (p = 'gf-perm-') => { const d = mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };
export const LOG = tmpDir('gf-log-');

export const makeKey = (tiers = ['P2', 'P3', 'P4']) => ({ ...engine.generateApproverKey(), tiers });

// The real model with a registry of ephemeral approvers, so signed approvals can be tested without any real key.
export function syntheticModel(keys, mutate) {
  const perm = JSON.parse(JSON.stringify(realModel.perm));
  if (mutate) mutate(perm);
  const m = engine.loadModel();
  return { ...m, perm, classifiers: perm.classifiers.map((c) => ({ ...c, re: new RegExp(c.pattern, 'i') })), approvers: keys.map((k) => ({ keyId: k.keyId, role: 'test-approver', tiers: k.tiers, classes: [...new Set(k.tiers.map((t) => (t === 'P2' ? 'repository' : 'deployment')))], publicKeyPem: k.publicKeyPem })) };
}

export function approval({ tier, ops, agents, env, scope = {}, minutes, uses = 1, signers, now = new Date(), breakGlass = false, reference, id }) {
  const lim = realModel.perm.approvals.limits[tier];
  const mins = minutes ?? Math.min(30, lim.maxLifetimeMinutes);
  let rec = {
    schema: 'greenfuel.approval/v1', id: id ?? `AP-${Math.random().toString(16).slice(2, 14)}`, tier, operations: ops, agents, environment: env, scope,
    reason: 'harmless simulation', breakGlass, ...(breakGlass ? { reference: reference ?? 'SIM-1' } : {}), issuedAt: new Date(now.getTime() - 60000).toISOString(),
    expiresAt: new Date(now.getTime() - 60000 + mins * 60000).toISOString(), maxUses: uses, nonce: Math.random().toString(16).slice(2).padEnd(32, '0'), signatures: [],
  };
  for (const k of signers ?? []) rec = engine.signApproval(rec, k.privateKeyPem, k.keyId);
  return rec;
}

// Run a hook as a separate process, exactly as Copilot does: JSON on stdin, decision JSON on stdout.
export function runHook(script, argv, event, env = {}) {
  const r = spawnSync(process.execPath, [path.join(repo, 'harness', 'hooks', script), ...argv], { input: JSON.stringify({ sessionId: 'sim', cwd: repo, ...event }), encoding: 'utf8', cwd: repo,   env: { ...process.env, HARNESS_SCOPE_SHIPOWNER: '', HARNESS_SCOPE_JURISDICTION: '', HARNESS_LOG_DIR: LOG, ...env } });
  let out = {};
  try { out = r.stdout.trim() ? JSON.parse(r.stdout) : {}; } catch { out = { unparseable: r.stdout }; }
  return { status: r.status, denied: out.permissionDecision === 'deny', ask: out.permissionDecision === 'ask', reason: out.permissionDecisionReason ?? '', stderr: r.stderr };
}
export const agentHook = (agent, toolName, toolArgs, env) => runHook('agent-guard.cjs', [agent], { toolName, toolArgs }, env);
export const sessionHook = (toolName, toolArgs, env) => runHook('policy-guard.cjs', [], { toolName, toolArgs }, env);
export const outputHook = (toolName, toolArgs, text, env) => {
  const r = spawnSync(process.execPath, [path.join(repo, 'harness', 'hooks', 'tool-output-guard.cjs')], { input: JSON.stringify({ sessionId: 'sim', cwd: repo, toolName, toolArgs, toolResult: { resultType: 'success', textResultForLlm: text } }), encoding: 'utf8', cwd: repo, env: { ...process.env, HARNESS_SCOPE_SHIPOWNER: '', HARNESS_SCOPE_JURISDICTION: '', HARNESS_LOG_DIR: tmpDir('gf-out-'), ...env } });
  const o = r.stdout.trim() ? JSON.parse(r.stdout) : {};
  return o.modifiedResult?.textResultForLlm ?? text;
};

export const AGENTS = Object.keys(agentPolicy.agents);
// Values shaped like secrets are assembled at run time so no test file contains one.
export const fakeToken = () => `gh${'p'}_${'Q1w2E3r4T5'.repeat(4)}`;
