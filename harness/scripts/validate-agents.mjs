#!/usr/bin/env node
// Validates the specialist custom agents against harness/policy/agent-policy.json. Zero dependencies.
// Usage: node harness/scripts/validate-agents.mjs [--root <dir>] [--json] [--list] [--versions]
// What it checks (and why): the policy is the source of truth for roles, tools, write scopes, command
// allow-lists and delegation. Native Copilot features carry what they can (tools, agents, hooks); this
// script checks that every agent file matches the policy and that the policy itself is safe and acyclic.
// It reads files only; it never runs agents and cannot prove how a given Copilot build behaves.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContext, hasContext } from './validate-context.mjs';

const POLICY = 'harness/policy/agent-policy.json';
const MANIFEST = 'docs/context/context-manifest.json';
const AGENT_DIR = '.github/agents';
const INSTR_DIR = '.github/instructions';
const CONTROL_PLANE = ['.github/', 'harness/', '.vscode/', 'docs/context/', 'package.json'];
const GUARD = /^node harness\/hooks\/agent-guard\.cjs ([a-z][a-z0-9-]*)$/;
const DANGEROUS = [
  'az group create x', 'az deployment group create x', 'azd up', 'azd deploy', 'terraform apply', 'git push', 'git push origin main',
  'git commit -m x', 'git reset --hard', 'git checkout main', 'npm install x', 'npm publish', 'rm -rf x', 'Remove-Item x', 'node -e x',
  'node --eval x', 'node --test --eval x', 'node --test --import=x.mjs', 'git diff --output=x', 'git log --output=x', 'git status; rm x',
  'npm test && rm x', 'npm test | tee x', 'npm run build', 'curl http://x', 'gh pr merge 1', 'gh pr create', 'gh pr view 1 --web', 'gh run watch 1',
  'gh api -X POST repos/x/y', 'gh workflow run x', 'gh repo delete x', 'gh run view 1 --web',
  'node harness/scripts/record-evidence.mjs --id EV-0001 --claim "x" --out src/api -- npm test',
  'node harness/scripts/record-evidence.mjs --id EV-0001 --claim "x" -- node -e x',
  'node harness/scripts/record-evidence.mjs --id EV-0001 --claim "x" -- azd up',
  'node harness/scripts/record-evidence.mjs --id EV-0001 --claim "x" -- npm install x',
  'node harness/scripts/record-evidence.mjs --id EV-0001 --claim "x" -- git push',
  'node harness/scripts/record-evidence.mjs --out x --id EV-0001 --claim "x" -- npm test',
];

const unquote = (s) => s.trim().replace(/^['"]|['"]$/g, '');

function parseList(value) {
  const m = String(value ?? '').match(/^\[(.*)\]$/);
  if (!m) return null;
  return m[1].split(',').map(unquote).filter(Boolean);
}

export function parseAgent(text) {
  const norm = text.replace(/\r\n/g, '\n');
  const m = norm.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const keys = [];
  const values = {};
  const lines = m[1].split('\n');
  for (const line of lines) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) { keys.push(kv[1]); values[kv[1]] = kv[2].trim(); }
  }
  const hookEvents = [];
  const hookCommands = [];
  const hookTypes = [];
  const hookTimeouts = [];
  let inHooks = false;
  for (const line of lines) {
    if (/^hooks:\s*$/.test(line)) { inHooks = true; continue; }
    if (inHooks && /^\S/.test(line)) inHooks = false;
    if (!inHooks) continue;
    const ev = line.match(/^ {2}([A-Za-z]\w*):\s*$/);
    if (ev) hookEvents.push(ev[1]);
    const cmd = line.match(/^\s+(?:-\s+)?command:\s*(.+)$/);
    if (cmd) hookCommands.push(unquote(cmd[1]));
    const ty = line.match(/^\s+(?:-\s+)?type:\s*(.+)$/);
    if (ty) hookTypes.push(unquote(ty[1]));
    const to = line.match(/^\s+(?:-\s+)?timeoutSec:\s*(.+)$/);
    if (to) hookTimeouts.push(unquote(to[1]));
  }
  const body = m[2];
  const sections = new Map();
  const parts = body.split(/^## (.+)$/m);
  for (let i = 1; i < parts.length; i += 2) sections.set(parts[i].trim(), parts[i + 1] ?? '');
  return { keys, values, hookEvents, hookCommands, hookTypes, hookTimeouts, body, sections };
}

function cycle(graph) {
  const state = new Map();
  const visit = (n, trail) => {
    if (state.get(n) === 2) return null;
    if (state.get(n) === 1) return [...trail.slice(trail.indexOf(n)), n];
    state.set(n, 1);
    for (const next of graph[n] ?? []) { const c = visit(next, [...trail, n]); if (c) return c; }
    state.set(n, 2);
    return null;
  };
  for (const n of Object.keys(graph)) { const c = visit(n, []); if (c) return c; }
  return null;
}

const prefixOf = (g) => g.split('**')[0];
const overlaps = (a, b) => { const pa = prefixOf(a); const pb = prefixOf(b); return pa.startsWith(pb) || pb.startsWith(pa); };

export function validateAgents(root) {
  const errors = [];
  const fail = (msg) => errors.push({ check: 'agents', msg });
  const read = (p) => readFileSync(path.join(root, p), 'utf8');

  if (!existsSync(path.join(root, POLICY))) { fail(`missing ${POLICY}`); return errors; }
  let policy;
  try { policy = JSON.parse(read(POLICY)); } catch (e) { fail(`${POLICY}: invalid JSON (${e.message})`); return errors; }
  const agents = policy.agents ?? {};
  const names = Object.keys(agents);
  const classes = policy.classes ?? {};
  const aliases = new Set(policy.toolAliases ?? []);
  const allowedKeys = new Set(policy.frontmatter?.allowed ?? []);
  const forbidden = policy.frontmatter?.forbidden ?? {};

  let profiles = new Set();
  if (existsSync(path.join(root, MANIFEST))) {
    try { profiles = new Set(Object.keys(JSON.parse(read(MANIFEST)).profiles ?? {})); } catch { fail(`${MANIFEST}: invalid JSON`); }
  }
  const ctx = hasContext(root) ? loadContext(root) : null;
  const hardConstraints = existsSync(path.join(root, 'docs/architecture/HARD-CONSTRAINTS.md'))
    ? new Set(read('docs/architecture/HARD-CONSTRAINTS.md').match(/HC-\d\d/g) ?? []) : null;
  const sovereignty = existsSync(path.join(root, 'docs/context/SOVEREIGNTY-MATRIX.md')) ? read('docs/context/SOVEREIGNTY-MATRIX.md') : null;
  let phase = 0;
  try { phase = JSON.parse(read('harness/policy/command-policy.json')).phase ?? 0; } catch { fail('harness/policy/command-policy.json is missing or invalid'); }

  // Policy self-consistency.
  for (const [cls, def] of Object.entries(classes)) for (const t of def.allowedTools) if (!aliases.has(t)) fail(`policy: class ${cls} allows unknown tool '${t}'`);
  for (const [k] of Object.entries(forbidden)) if (allowedKeys.has(k)) fail(`policy: key '${k}' is both allowed and forbidden`);

  const delegation = {};
  const dependency = {};
  const owned = [];
  for (const [name, a] of Object.entries(agents)) {
    const at = `policy ${name}`;
    const cls = classes[a.class];
    if (!cls) { fail(`${at}: unknown class '${a.class}'`); continue; }
    for (const t of a.tools) {
      if (!aliases.has(t)) fail(`${at}: unknown tool alias '${t}'`);
      if (!cls.allowedTools.includes(t)) fail(`${at}: tool '${t}' is not allowed for class ${a.class}`);
    }
    if (new Set(a.tools).size !== a.tools.length) fail(`${at}: duplicate tools`);
    const has = (t) => a.tools.includes(t);
    if (has('agent') !== (a.delegatesTo.length > 0)) fail(`${at}: the 'agent' tool and delegatesTo must go together`);
    if (a.delegatesTo.length && name !== 'orchestrator') fail(`${at}: only the orchestrator may delegate`);
    if (name === 'orchestrator' && !a.disableModelInvocation) fail(`${at}: orchestrator must be disable-model-invocation: true so no agent can re-enter it`);
    if (has('edit') !== (a.writes.length > 0)) fail(`${at}: 'edit' tool and a phase-0 write scope must go together`);
    if (!has('edit') && a.writesPhase1.length) fail(`${at}: phase-1 write scope without the edit tool`);
    if (has('execute') !== (a.commands.length > 0)) fail(`${at}: 'execute' tool and a command allow-list must go together`);
    if (has('web') !== Boolean(a.web)) fail(`${at}: 'web' tool and web flag disagree`);
    if (a.class === 'planner' && (has('edit') || has('execute') || has('web'))) fail(`${at}: planners must not edit, execute or use the web`);
    if (a.class === 'author' && has('execute')) fail(`${at}: authors must not execute commands`);
    if (a.class === 'executor' && !has('execute')) fail(`${at}: an executor must have execute (otherwise it is an author)`);
    for (const g of [...a.writes, ...a.writesPhase1]) {
      if (/^\*|^\.\.|^\/|^[A-Za-z]:|\\/.test(g)) fail(`${at}: write scope '${g}' must be a relative forward-slash path under a named folder`);
      if (CONTROL_PLANE.some((c) => g.startsWith(c) || c.startsWith(g))) fail(`${at}: write scope '${g}' touches the control plane`);
      owned.push([name, g]);
    }
    for (const g of a.writes) if (!g.startsWith('docs/')) fail(`${at}: phase-0 write scope '${g}' must be under docs/`);
    for (const g of a.writesPhase1) if (g.startsWith('docs/')) fail(`${at}: phase-1 scope '${g}' should be product paths, not docs`);
    for (const c of a.commands) {
      let re;
      try { re = new RegExp(c); } catch { fail(`${at}: command pattern is not a valid regex: ${c}`); continue; }
      if (!c.startsWith('^') || !c.endsWith('$')) fail(`${at}: command pattern must be anchored with ^ and $: ${c}`);
      if (/\.\*/.test(c.replace(/\(\?!\.\*(?:[^()]|\([^()]*\))*\)/g, ''))) fail(`${at}: command pattern has an open-ended '.*'; list the permitted argument forms instead: ${c}`);
      for (const bad of DANGEROUS) if (re.test(bad)) fail(`${at}: command pattern ${c} permits a dangerous command: '${bad}'`);
    }
    for (const p of a.profiles) if (profiles.size && !profiles.has(p)) fail(`${at}: context profile '${p}' does not exist in the manifest`);
    for (const d of a.delegatesTo) {
      if (!agents[d]) fail(`${at}: delegatesTo unknown agent '${d}'`);
      if (d === name) fail(`${at}: delegates to itself`);
      if (d === 'orchestrator') fail(`${at}: must not delegate to the orchestrator`);
    }
    for (const d of a.dependsOn) {
      if (!agents[d]) fail(`${at}: dependsOn unknown agent '${d}'`);
      if (d === name) fail(`${at}: depends on itself`);
    }
    delegation[name] = a.delegatesTo;
    dependency[name] = a.dependsOn;
  }
  const dc = cycle(delegation);
  if (dc) fail(`delegation graph has a cycle: ${dc.join(' -> ')}`);
  const pc = cycle(dependency);
  if (pc) fail(`dependsOn graph has a cycle: ${pc.join(' -> ')}`);
  for (let i = 0; i < owned.length; i++) for (let j = i + 1; j < owned.length; j++) {
    if (owned[i][0] !== owned[j][0] && overlaps(owned[i][1], owned[j][1])) fail(`write scopes overlap: ${owned[i][0]} '${owned[i][1]}' and ${owned[j][0]} '${owned[j][1]}'`);
  }
  const independentReviewers = [['design-reviewer', 'principal-architect'], ['architecture-critic', 'principal-architect']];
  for (const [r, author] of independentReviewers) if (agents[r] && agents[author]) {
    if (agents[r].writes.some((w) => agents[author].writes.some((x) => overlaps(w, x)))) fail(`${r} must not share write scope with ${author} (separation of duties)`);
  }

  // Agent files, both directions.
  const dir = path.join(root, AGENT_DIR);
  const files = existsSync(dir) ? readdirSync(dir) : [];
  for (const f of files) if (!f.endsWith('.agent.md')) fail(`${AGENT_DIR}/${f}: any .md file in this folder is loaded as an agent; rename or move it`);
  const fileNames = files.filter((f) => f.endsWith('.agent.md')).map((f) => f.replace(/\.agent\.md$/, ''));
  for (const n of names) if (!fileNames.includes(n)) fail(`policy lists '${n}' but ${AGENT_DIR}/${n}.agent.md is missing`);
  for (const n of fileNames) if (!agents[n]) fail(`${AGENT_DIR}/${n}.agent.md has no entry in ${POLICY}`);

  for (const n of fileNames.filter((x) => agents[x])) {
    const a = agents[n];
    const at = `${n}.agent.md`;
    const parsed = parseAgent(read(`${AGENT_DIR}/${n}.agent.md`));
    if (!parsed) { fail(`${at}: missing frontmatter`); continue; }
    const { keys, values } = parsed;
    for (const k of keys) {
      if (k in forbidden) fail(`${at}: frontmatter '${k}' is not used: ${forbidden[k]}`);
      else if (!allowedKeys.has(k)) fail(`${at}: frontmatter '${k}' is not on the supported list`);
    }
    if (new Set(keys).size !== keys.length) fail(`${at}: duplicate frontmatter keys`);
    if (unquote(values.name ?? '') !== n) fail(`${at}: name must equal the file name '${n}'`);
    if (unquote(values.description ?? '').length < 40) fail(`${at}: description is required (at least 40 characters) so the agent can be chosen correctly`);

    const tools = parseList(values.tools);
    if (!tools) fail(`${at}: tools must be an explicit inline list, e.g. ['read', 'search'] (omitting tools grants all tools)`);
    else if ([...tools].sort().join() !== [...a.tools, ...(a.mcp ?? [])].sort().join()) fail(`${at}: tools [${tools}] differ from policy tools plus MCP grants [${[...a.tools, ...(a.mcp ?? [])]}]`);

    const delegates = parseList(values.agents);
    if (a.delegatesTo.length) {
      if (!delegates) fail(`${at}: agents list is required and must equal the policy delegation list`);
      else if ([...delegates].sort().join() !== [...a.delegatesTo].sort().join()) fail(`${at}: agents [${delegates}] differ from policy [${a.delegatesTo}]`);
      else if (delegates.includes(n)) fail(`${at}: lists itself in agents`);
    } else if ('agents' in values) fail(`${at}: only the orchestrator may declare agents`);

    for (const [key, policyKey] of [['user-invocable', 'userInvocable'], ['disable-model-invocation', 'disableModelInvocation']]) {
      if (!(key in values)) fail(`${at}: ${key} must be set explicitly`);
      else if (!/^(true|false)$/.test(values[key])) fail(`${at}: ${key} must be true or false`);
      else if ((values[key] === 'true') !== Boolean(a[policyKey])) fail(`${at}: ${key} is ${values[key]} but policy says ${a[policyKey]}`);
    }

    if (parsed.hookEvents.join() !== 'preToolUse') fail(`${at}: hooks must define exactly preToolUse (found: ${parsed.hookEvents.join(', ') || 'none'})`);
    if (parsed.hookCommands.length !== 1) fail(`${at}: expected exactly one hook command, found ${parsed.hookCommands.length}`);
    for (const c of parsed.hookCommands) {
      const g = c.match(GUARD);
      if (!g) fail(`${at}: hook command must be 'node harness/hooks/agent-guard.cjs ${n}', found '${c}'`);
      else if (g[1] !== n) fail(`${at}: hook passes agent name '${g[1]}', expected '${n}' (a wrong name applies another agent's permissions)`);
    }
    if (parsed.hookTypes.length !== parsed.hookCommands.length || parsed.hookTypes.some((t) => t !== 'command')) fail(`${at}: every hook needs 'type: command'`);
    for (const t of parsed.hookTimeouts) if (!/^\d+$/.test(t) || Number(t) < 1 || Number(t) > 30) fail(`${at}: hook timeoutSec must be 1 to 30 (timeouts fail open)`);
    if (parsed.hookTimeouts.length !== parsed.hookCommands.length) fail(`${at}: hook timeoutSec must be set explicitly`);

    if (parsed.body.length > (policy.maxBodyChars ?? 30000)) fail(`${at}: body is ${parsed.body.length} characters; the limit is ${policy.maxBodyChars}`);
    for (const h of policy.requiredHeadings ?? []) {
      const sec = parsed.sections.get(h);
      if (sec === undefined) fail(`${at}: missing section '## ${h}'`);
      else if (sec.trim().length < 40) fail(`${at}: section '${h}' is too thin to be a real definition`);
    }
    const ctxSec = parsed.sections.get('Context') ?? '';
    const pl = ctxSec.match(/Profiles?:\s*(.+)/);
    const declared = pl ? [...pl[1].split(/\.(?:\s|$)/)[0].matchAll(/`([a-z][a-z-]*)`/g)].map((x) => x[1]) : [];
    if (!declared.length) fail(`${at}: Context must contain a 'Profiles:' line naming context profiles in backticks`);
    else if ([...declared].sort().join() !== [...a.profiles].sort().join()) fail(`${at}: Profiles [${declared}] differ from policy [${a.profiles}]`);
    const hand = parsed.sections.get('Handoffs') ?? '';
    if (n === 'orchestrator') { if (!/circular/i.test(hand)) fail(`${at}: Handoffs must state how circular delegation is prevented`); }
    else if (!/never delegate|never call other agents|never delegates/i.test(hand)) fail(`${at}: Handoffs must state that this agent never delegates`);
    if (!/\bevidence|\bevidenced|\bunverified\b|\bEV-/i.test(parsed.sections.get('Evidence') ?? '')) fail(`${at}: Evidence section must say what counts as evidence for completion claims`);
    refs(parsed.body, at, ctx, hardConstraints, sovereignty, fail);
  }

  for (const f of existsSync(path.join(root, INSTR_DIR)) ? readdirSync(path.join(root, INSTR_DIR)).filter((x) => x.endsWith('.instructions.md')) : []) {
    const text = read(`${INSTR_DIR}/${f}`);
    const p = parseAgent(text);
    const at = `${f}`;
    if (!p) { fail(`${at}: missing frontmatter`); continue; }
    const apply = unquote(p.values.applyTo ?? '');
    if (!apply) fail(`${at}: applyTo is required`);
    else if (apply.split(',').some((g) => ['**', '**/*', '*'].includes(g.trim()))) fail(`${at}: applyTo '${apply}' would load these rules for every file; narrow it`);
    if (!p.values.description) fail(`${at}: description is required`);
    if (text.length > 6000) fail(`${at}: instruction files should stay short (${text.length} characters)`);
    refs(p.body, at, ctx, hardConstraints, sovereignty, fail);
  }

  if (phase === 0) {
    for (const [n, a] of Object.entries(agents)) for (const g of a.writesPhase1) if (existsSync(path.join(root, prefixOf(g)))) fail(`phase 0: ${n} phase-1 path '${prefixOf(g)}' exists`);
  }
  return errors;
}

function refs(text, at, ctx, hardConstraints, sovereignty, fail) {
  if (ctx) {
    for (const id of new Set(text.match(/\b(?:BR|FR|SEC|DATA|AGT|NFR)-\d{3}\b/g) ?? [])) if (!ctx.reqs.has(id)) fail(`${at}: references unknown requirement ${id}`);
    for (const id of new Set(text.match(/\bD-\d{3}\b/g) ?? [])) if (!ctx.decisions.has(id)) fail(`${at}: references unknown decision ${id}`);
  }
  if (hardConstraints) for (const id of new Set(text.match(/\bHC-\d\d\b/g) ?? [])) if (!hardConstraints.has(id)) fail(`${at}: references unknown hard constraint ${id}`);
  if (sovereignty) for (const id of new Set(text.match(/\b[FH]-\d{1,2}\b/g) ?? [])) if (!new RegExp(`\\| ${id}\\b`).test(sovereignty)) fail(`${at}: references ${id}, which is not in the sovereignty matrix`);
}

export function listAgents(root) {
  const policy = JSON.parse(readFileSync(path.join(root, POLICY), 'utf8'));
  return Object.entries(policy.agents).map(([name, a]) => ({
    name, class: a.class, tools: a.tools.join(','), writes: a.writes.join(' ') || '-', phase1: a.writesPhase1.join(' ') || '-',
    commands: a.commands.length, web: a.web, delegatesTo: a.delegatesTo.length || '-', dependsOn: a.dependsOn.join(',') || '-',
  }));
}

export function checkVersions(root) {
  const policy = JSON.parse(readFileSync(path.join(root, POLICY), 'utf8'));
  const out = [];
  const probe = (cmd, key, label) => {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32', timeout: 20000 });
    const v = (r.stdout ?? '').match(/\d+\.\d+\.\d+/)?.[0];
    if (!v) out.push(`${label}: not detected (is '${cmd}' on PATH?)`);
    else if (v !== policy.testedWith[key]) out.push(`${label}: installed ${v}, tested with ${policy.testedWith[key]}. Re-check agent behaviour (see docs/agents/AGENT-ROSTER.md)`);
    else out.push(`${label}: ${v} matches the tested version`);
  };
  probe('code', 'vscode', 'VS Code');
  probe('copilot', 'copilotCli', 'Copilot CLI');
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root');
  const root = path.resolve(i > 0 ? process.argv[i + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  if (process.argv.includes('--list')) { console.table(listAgents(root)); process.exit(0); }
  const errors = validateAgents(root);
  const notes = process.argv.includes('--versions') ? checkVersions(root) : [];
  if (process.argv.includes('--json')) console.log(JSON.stringify({ root, ok: !errors.length, errors, versions: notes }, null, 2));
  else {
    for (const n of notes) console.log(`NOTE ${n}`);
    if (errors.length) { for (const e of errors) console.error(`FAIL [${e.check}] ${e.msg}`); console.error(`${errors.length} problem(s).`); }
    else console.log('validate-agents: OK');
  }
  process.exit(errors.length ? 1 : 0);
}
