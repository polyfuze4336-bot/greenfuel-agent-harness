#!/usr/bin/env node
// Per-agent preToolUse guard. Registered in each agent's own `hooks` frontmatter, so it runs only while that
// agent is active: node harness/hooks/agent-guard.cjs <agent-name>
// Enforces, from harness/policy/agent-policy.json and harness/tools/tool-registry.json: write scope, command allow-list,
// per-agent MCP tool grants, web access limited to approved hosts, and delegation;
// and refuses any agent-written "Status: Approved/Accepted". Unrecognised tools are denied (fail closed).
// Fail-closed on unknown agent or unparseable input. This is a guardrail, not a sandbox: it narrows what a
// correctly configured agent can do; it does not replace approvals, sandboxing or review.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { matchMcp } = require('./mcp-names.cjs');

const ROOT = path.join(__dirname, '..', '..');
const PATH_KEYS = new Set(['path', 'filepath', 'file_path', 'file', 'filename', 'uri']);
const AGENT_KEYS = new Set(['agent_type', 'agent', 'agentname', 'subagent_type', 'agent_name']);
const CHAINING = /[;&|<>`]|\$\(/;
// Tool names are compared lower-case with separators removed, so apply_patch, applyPatch and apply-patch are one name.
const RUNNING_SHELL_SAFE = /^(read|list|stop)(powershell|bash|shell)$/;
const RUNNING_SHELL_INPUT = /^write(powershell|bash|shell)$/;
const SHELL = /(powershell|pwsh|bash|terminal|shell|execute|^cmd$|^run(in)?command)/;
const WEB = /(web|fetch|url|browser|http)/;
const TASK = /^(task|agent|runsubagent|customagent|subagent)$/;
const SEND_TO_AGENT = /^writeagent$/;
const WRITE = /(edit|create|write|patch|replace|insert|delete|remove|rename|move|save|append|mkdir|touch|overwrite)/;
// Read-type tools are listed by exact name. Anything else that is not classified above is denied, so a new or
// mutating tool (store_memory, session_*, a future write tool) is never allowed by a prefix match.
const READ_SAFE = /^(view|read|grep|glob|search|ls|reportintent|readagent|listagents|skill|askuser|sql|toolsearchtool|taskcomplete|exitplanmode|lsp|readfile|listdir|filesearch|grepsearch|semanticsearch|usages|problems|managetodolist)$/;
const APPROVAL = /\bstatus\b[\s:*_`|-]{0,12}(approved|accepted)\b/i;

const load = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const globToRe = (g) => new RegExp('^' + g.split('**').map((s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('.*') + '$', 'i');
const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');

// Resolve a tool-supplied path to repository-relative forward-slash paths, or null if it is unsafe or outside.
// Returns { lexical, real }: both must satisfy a write scope, so a link inside a scope cannot lead to another one.
function toRel(raw, cwd) {
  let s = String(raw);
  if (/^file:/i.test(s)) {
    try { s = decodeURIComponent(s.replace(/^file:\/\/\/?/i, '')); } catch { return null; }
    if (/^\/[A-Za-z]:/.test(s)) s = s.slice(1);
  }
  if (!s || s.includes('\0') || s.includes('%') || /^[\\/]{2}/.test(s)) return null;
  const abs = path.resolve(cwd || ROOT, s);
  const lexical = path.relative(ROOT, abs);
  if (!lexical || lexical.startsWith('..') || path.isAbsolute(lexical)) return null;
  const real = realRel(abs);
  if (real === null) return null;
  return { lexical: lexical.split(path.sep).join('/'), real: real.split(path.sep).join('/') };
}

// Path below the real repository root after following links and junctions in the nearest existing ancestor.
function realRel(abs) {
  try {
    let cur = abs;
    while (!fs.existsSync(cur)) { const up = path.dirname(cur); if (up === cur) return null; cur = up; }
    const target = path.join(fs.realpathSync.native(cur), path.relative(cur, abs));
    const r = path.relative(fs.realpathSync.native(ROOT), target);
    return !r || r.startsWith('..') || path.isAbsolute(r) ? null : r;
  } catch { return null; }
}

function strings(v, out = [], key = '') {
  if (typeof v === 'string') out.push([key, v]);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out, key));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) strings(x, out, k);
  return out;
}

const deny = (reason) => ({ decision: 'deny', reason });

let registryCache = null;
const loadRegistry = () => (registryCache ??= load('harness/tools/tool-registry.json'));

function webCheck(agentName, agent, pairs, policy) {
  if (!agent.web) return deny(`${agentName} has no web access`);
  const urls = pairs.filter(([k]) => k.toLowerCase() === 'url').map(([, v]) => v);
  if (!urls.length) return deny('web search and requests without a URL are not permitted; fetch a specific page on an approved host');
  for (const u of urls) {
    let parsed;
    try { parsed = new URL(u); } catch { return deny(`not a valid URL: ${u.slice(0, 80)}`); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return deny('only plain https URLs without credentials are permitted');
    const host = parsed.hostname.toLowerCase();
    if (!(policy.webHosts ?? []).includes(host)) return deny(`host '${host}' is not on the approved documentation host list (exact host names only)`);
  }
  return null;
}

function evaluate(event, agentName, policy, phase, registry = null) {
  const agent = policy.agents[agentName];
  if (!agent) return deny(`unknown agent '${agentName}'`);
  const tool = event.toolName ?? event.tool_name;
  if (typeof tool !== 'string' || !tool) return deny('no tool name in event');
  const n = norm(tool);
  let args = event.toolArgs ?? event.tool_input ?? {};
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = { command: args }; } }
  const pairs = strings(args);

  const reg = registry ?? loadRegistry();
  const mm = matchMcp(tool, reg);
  if (mm.server) {
    const granted = mm.exact && (agent.mcp ?? []).includes(`${mm.exact.server}/${mm.exact.tool}`);
    return granted ? null : deny(`MCP tool '${tool}' is not granted to ${agentName}`);
  }
  if (RUNNING_SHELL_SAFE.test(n)) return null;
  if (RUNNING_SHELL_INPUT.test(n)) return deny('input to a running shell cannot be checked against the allow-list');

  if (SHELL.test(n)) {
    if (!agent.commands.length) return deny(`${agentName} may not run commands`);
    const cmd = String(args.command ?? args.cmd ?? args.input ?? '').trim();
    if (!cmd || CHAINING.test(cmd)) return deny('only a single simple command is allowed (no chaining, pipes or redirection)');
    if (!agent.commands.some((c) => new RegExp(c).test(cmd))) return deny(`command not on ${agentName}'s allow-list: ${cmd.slice(0, 80)}`);
    return null;
  }

  if (SEND_TO_AGENT.test(n)) return agent.delegatesTo.length ? null : deny(`${agentName} may not delegate`);

  if (TASK.test(n)) {
    if (!agent.delegatesTo.length) return deny(`${agentName} may not delegate`);
    const named = pairs.filter(([k]) => AGENT_KEYS.has(k.toLowerCase())).map(([, v]) => v);
    if (!named.length) return deny('delegation must name its target agent');
    for (const target of named) {
      if (target === agentName) return deny('self-delegation is not allowed');
      if (!agent.delegatesTo.includes(target)) return deny(`${target} is not a permitted delegation target for ${agentName}`);
    }
    return null;
  }

  if (WEB.test(n)) return webCheck(agentName, agent, pairs, policy);

  if (WRITE.test(n)) {
    const globs = [...agent.writes, ...(phase >= 1 ? agent.writesPhase1 : [])];
    if (!globs.length) return deny(`${agentName} is read-only${phase < 1 && agent.writesPhase1.length ? ' until the phase is raised' : ''}`);
    const targets = [];
    for (const [k, v] of pairs) {
      if (PATH_KEYS.has(k.toLowerCase())) targets.push(v);
      for (const m of v.matchAll(/\*\*\* (?:Add|Update|Delete) File: (.+)/g)) targets.push(m[1].trim());
    }
    if (!targets.length) return deny('cannot determine the file being written');
    const res = globs.map(globToRe);
    const bad = [];
    for (const t of targets) {
      const rel = toRel(t, event.cwd);
      if (rel === null || !res.some((re) => re.test(rel.lexical)) || !res.some((re) => re.test(rel.real))) bad.push(t);
    }
    if (bad.length) return deny(`${agentName} may write only ${globs.join(', ')}; refused: ${bad.join(', ')}`);
    for (const [k, v] of pairs) if (!PATH_KEYS.has(k.toLowerCase()) && APPROVAL.test(v)) return deny('agents cannot set a Status of Approved or Accepted; a named human makes that change');
    return null;
  }

  if (READ_SAFE.test(n)) return null;
  return deny(`tool '${tool}' is not classified; add it to the guard deliberately before an agent may use it`);
}

function main() {
  const agentName = process.argv[2];
  let event;
  try { event = JSON.parse(fs.readFileSync(0, 'utf8')); if (!event || typeof event !== 'object') throw new Error('not an object'); } catch (e) {
    process.stderr.write(`agent-guard: unparseable event (${e.message}); denying.\n`); process.exit(2);
  }
  let verdict;
  try { verdict = evaluate(event, agentName, load('harness/policy/agent-policy.json'), load('harness/policy/command-policy.json').phase ?? 0); } catch (e) {
    process.stderr.write(`agent-guard: ${e.message}; denying.\n`); process.exit(2);
  }
  process.stdout.write(verdict ? JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: `[AGENT-GUARD ${agentName}] ${verdict.reason}` }) : '{}');
}

module.exports = { evaluate, globToRe, toRel };
if (require.main === module) main();
