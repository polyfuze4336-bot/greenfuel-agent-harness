#!/usr/bin/env node
// preToolUse policy guard for the Copilot harness (VS Code, Copilot CLI).
// Contract: https://docs.github.com/en/copilot/reference/hooks-reference (preToolUse).
// Fail-closed on malformed input. No match => emit {} (no decision; normal permission flow applies).
// This is a guardrail, not a sandbox: a shell is expressive enough to evade pattern checks.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const POLICY_PATH = path.join(__dirname, '..', 'policy', 'command-policy.json');
const RANK = { deny: 2, ask: 1 };

const SHELL_TOOL = /bash|powershell|pwsh|terminal|shell|^execute/i;
const WRITE_TOOL = /^(edit|create|apply_patch|str_replace_editor|write|multi_edit|editfiles|createfile|insert_edit_into_file|replace_string_in_file|create_file)$/i;
const READ_TOOL = /^(view|read|readfile|read_file|grep|glob|rg|search)$/i;
const MCP_TOOL = /azure|mcp/i;
const { matchMcp } = require('./mcp-names.cjs');
const engine = require('./permission-engine.cjs');
const enforcement = require('../lib/enforcement.cjs');
let registryCache;
// Any session, not just a specialist agent: a tool that looks like one of this repository's enabled MCP servers but is not
// an exact tool in the registry is refused. This is the guard for clients that have no native tool allow-filter (VS Code).
function unlistedMcpVerdict(toolName) {
  try {
    registryCache ??= JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tools', 'tool-registry.json'), 'utf8'));
  } catch { return null; }
  const m = matchMcp(toolName, registryCache);
  if (!m.server || m.builtIn || m.exact || registryCache.servers?.[m.server]?.status !== 'enabled') return null;
  return { decision: 'deny', id: 'MCP-UNLISTED', reason: `'${toolName}' looks like a tool of the registered MCP server '${m.server}' but is not in the tool registry. Only reviewed tools may be used.` };
}
const PATH_KEYS = new Set(['path', 'filepath', 'file_path', 'file', 'filename', 'uri']);
const WRITE_CMDLET = /\b(set-content|add-content|out-file|new-item|copy-item|move-item|rename-item|tee-object|tee|cp|mv|ni|sc)\b/i;

function loadPolicy(file = POLICY_PATH) {
  const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
  policy._shell = policy.shellRules.map((r) => ({ ...r, re: new RegExp(r.pattern, 'i') }));
  for (const k of ['phaseGatedPaths', 'controlPlanePaths', 'evidenceRecordPaths', 'secretFilePaths']) {
    policy['_' + k] = policy[k].map((p) => new RegExp(p, 'i'));
  }
  policy._mcp = new RegExp(policy.azureMcpMutationPattern, 'i');
  return policy;
}

function normalizeArgs(raw) {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return { command: raw }; }
  }
  return raw && typeof raw === 'object' ? raw : {};
}

function relPath(p, cwd) {
  let s = String(p).replace(/\\/g, '/').replace(/^\.\//, '');
  const base = String(cwd || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (base && s.toLowerCase().startsWith(base.toLowerCase() + '/')) s = s.slice(base.length + 1);
  return s;
}

function collectPaths(args, cwd) {
  const out = [];
  const walk = (v, key) => {
    if (typeof v === 'string') {
      if (PATH_KEYS.has(String(key).toLowerCase())) out.push(relPath(v.replace(/^file:\/\/\/?/, ''), cwd));
      for (const m of v.matchAll(/\*\*\* (?:Add|Update|Delete) File: (.+)/g)) out.push(relPath(m[1].trim(), cwd));
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(args, '');
  return out;
}

function azVerdict(segment, policy) {
  const m = segment.match(/(?:^|[\s(])az(?:\.cmd)?\s+(.*)$/i);
  if (!m) return null;
  const tokens = [];
  for (const t of m[1].trim().split(/\s+/)) {
    if (!t || t.startsWith('-') || /^["'$@]/.test(t)) break;
    tokens.push(t.toLowerCase());
  }
  const joined = tokens.join(' ');
  if (policy.azureAlwaysAsk.some((p) => joined === p || joined.startsWith(p + ' '))) {
    return { decision: 'ask', id: 'AZ-CONTEXT', reason: 'Changing Azure login/context requires explicit human action.' };
  }
  const verb = tokens[tokens.length - 1] || '';
  if (tokens[0] === 'bicep' && policy.azureBicepSafeVerbs.includes(verb)) return null;
  if (policy.azureReadVerbs.includes(verb) || /^(list|show|get)-/.test(verb)) return null;
  return { decision: policy.azureMutationDecision, id: 'AZ-MUTATE', reason: `Azure CLI verb '${verb || 'unknown'}' is not on the read-only allow-list. No autonomous Azure changes.` };
}

function pathVerdicts(paths, kind, policy) {
  const out = [];
  for (const p of paths) {
    if (policy._secretFilePaths.some((re) => re.test(p))) out.push({ decision: 'deny', id: 'SECRET-FILE', reason: `Secret-bearing file '${p}' must not be read or written by an agent.` });
    if (kind === 'read') continue;
    if (policy.phase === 0 && policy._phaseGatedPaths.some((re) => re.test(p))) out.push({ decision: 'deny', id: 'PHASE-GATE', reason: `Phase ${policy.phase}: '${p}' is application/IaC code. Not permitted until an approved ADR raises the phase.` });
    if (policy._evidenceRecordPaths.some((re) => re.test(p))) out.push({ decision: 'deny', id: 'EVIDENCE-RECORD', reason: `'${p}' is written only by harness/scripts/record-evidence.mjs.` });
    if (policy._controlPlanePaths.some((re) => re.test(p))) out.push({ decision: 'ask', id: 'CONTROL-PLANE', reason: `'${p}' is harness control-plane. Changes need explicit human approval.` });
  }
  return out;
}

function shellPaths(command, cwd) {
  const paths = [];
  if (WRITE_CMDLET.test(command)) {
    for (const t of command.split(/[\s"'`,;=()]+/)) if (t) paths.push(relPath(t, cwd));
  }
  for (const m of command.matchAll(/(?:^|\s)\d?>>?\s*["']?([^\s"']+)/g)) paths.push(relPath(m[1], cwd));
  return paths;
}

function evaluate(event, policy, opts = {}) {
  const toolName = event.toolName ?? event.tool_name;
  if (typeof toolName !== 'string' || !toolName) return { decision: 'deny', id: 'MALFORMED', reason: 'Hook event has no tool name.' };
  const args = normalizeArgs(event.toolArgs ?? event.tool_input);
  const cwd = event.cwd;
  const verdicts = [];

  if (SHELL_TOOL.test(toolName)) {
    const command = String(args.command ?? args.cmd ?? args.input ?? '');
    for (const r of policy._shell) if (r.re.test(command)) verdicts.push({ decision: r.decision, id: r.id, reason: r.reason });
    for (const seg of command.split(/&&|\|\||[;|\n]/)) { const v = azVerdict(seg, policy); if (v) verdicts.push(v); }
    verdicts.push(...pathVerdicts(shellPaths(command, cwd), 'write', policy));
    verdicts.push(...pathVerdicts(command.split(/[\s"'`,;=()]+/).filter(Boolean).map((t) => relPath(t, cwd)).filter((t) => policy._secretFilePaths.some((re) => re.test(t))), 'read', policy));
  } else if (WRITE_TOOL.test(toolName)) {
    verdicts.push(...pathVerdicts(collectPaths(args, cwd), 'write', policy));
  } else if (READ_TOOL.test(toolName)) {
    verdicts.push(...pathVerdicts(collectPaths(args, cwd), 'read', policy));
  } else if (MCP_TOOL.test(toolName) && policy._mcp.test(JSON.stringify(args))) {
    verdicts.push({ decision: policy.azureMutationDecision, id: 'AZ-MCP-MUTATE', reason: `Azure/MCP tool '${toolName}' appears to request a mutating operation.` });
  }

  const unlisted = unlistedMcpVerdict(toolName);
  if (unlisted) verdicts.push(unlisted);

  // Least-privilege model, applied to every session: secrets, shipowner and jurisdiction isolation, destructive or
  // unapproved Azure operations, regulatory filings and settlements. Named agents get the full model in agent-guard.
  let decision = null;
  try {
    decision = engine.decide({ agent: null, tool: toolName, args: event.toolArgs ?? event.tool_input ?? {}, cwd, phase: policy.phase ?? 0, registry: registryCache ?? undefined, consume: Boolean(opts.consume), logDir: opts.logDir, scope: opts.scope, approvals: opts.approvals, now: opts.now, headCommit: opts.headCommit });
    if (decision.decision === 'deny') verdicts.push({ decision: 'deny', id: decision.rules[0] ?? 'PERMISSION', reason: `${decision.reasons[0]} [${decision.rules.join(', ')}]` });
    if (opts.onDecision) opts.onDecision(decision);
  } catch (e) {
    verdicts.push({ decision: 'deny', id: 'PERMISSION-ERROR', reason: `permission engine error (${e.message}); denying` });
  }

  verdicts.sort((a, b) => RANK[b.decision] - RANK[a.decision]);
  const top = verdicts[0] || null;
  if (top && top.decision !== 'allow' && opts.audit) {
    try { engine.writeAudit(engine.loadModel(), event, { ...(decision ?? { mode: 'session', operations: [], targets: [] }), rules: [...new Set([top.id, ...(decision?.rules ?? [])])], reasons: [top.reason] }, { agent: null, logDir: opts.logDir }); } catch { /* never let logging change the decision */ }
  }
  return top;
}

function main() {
  let event;
  try {
    event = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (!event || typeof event !== 'object') throw new Error('not an object');
  } catch (err) {
    process.stderr.write(`policy-guard: unparseable hook event (${err.message}); denying.\n`);
    process.exit(2);
  }
  let verdict; let engineDecision = null; let policy;
  try {
    policy = loadPolicy();
    verdict = evaluate(event, policy, { audit: true, consume: true, onDecision: (d) => { engineDecision = d; } });
  } catch (err) {
    // Fail closed: a policy file that is missing or corrupt, or any unexpected error, blocks the call. A crash that exits with another code could be read as "no objection".
    process.stderr.write(`policy-guard: ${err.message}; denying.\n`);
    process.stdout.write(JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: `[HARNESS-POLICY FAIL-CLOSED] the policy could not be evaluated (${String(err.message).slice(0, 120)})` }));
    process.exit(2);
  }
  // Evidence that enforcement ran, and a record of every decision. Neither may change the decision.
  try {
    enforcement.writeHeartbeat({ hook: 'policy-guard', sessionId: event.sessionId, phase: policy.phase ?? 0 });
    engine.decisionEvent(engine.loadModel(), event, verdict, { agent: null, hook: 'policy-guard', decision: engineDecision });
  } catch { /* ignore */ }
  process.stdout.write(verdict
    ? JSON.stringify({ permissionDecision: verdict.decision, permissionDecisionReason: `[HARNESS-POLICY ${verdict.id}] ${verdict.reason}` })
    : '{}');
}

module.exports = { evaluate, loadPolicy };
if (require.main === module) main();
