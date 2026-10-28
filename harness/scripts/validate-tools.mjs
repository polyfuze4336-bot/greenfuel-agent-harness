#!/usr/bin/env node
// Validates the tool layer: harness/tools/tool-registry.json, the MCP configuration files, the candidate list,
// the agent MCP grants in harness/policy/agent-policy.json, and the generated tables in docs/harness/TOOL-REGISTRY.md.
// Usage: node harness/scripts/validate-tools.mjs [--root <dir>] [--json] [--write]
//   --write  regenerates the table region of docs/harness/TOOL-REGISTRY.md from the registry and policy
// Zero dependencies. It reads files only (except --write), starts no server and contacts no network.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY = 'harness/tools/tool-registry.json';
const POLICY = 'harness/policy/agent-policy.json';
const CANDIDATES = 'harness/tools/mcp-candidates.json';
const SECRETS = 'harness/policy/secret-patterns.json';
const DOC = 'docs/harness/TOOL-REGISTRY.md';
const START = '<!-- generated:start (node harness/scripts/validate-tools.mjs --write) -->';
const END = '<!-- generated:end -->';
const ID_RE = /^[a-z][a-z0-9-]*$/;
const MCP_TOOL_RE = /^[a-z][a-z0-9_]*$/;
const HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/;
const PIN_RE = /^(@?[a-z0-9][\w./-]*)@(\d+\.\d+\.\d+)$/;
const REQUIRED = ['id', 'category', 'kind', 'name', 'purpose', 'inputs', 'outputs', 'privilege', 'mutation', 'status', 'owner', 'publisher', 'egress', 'humanApproval', 'grant', 'notes'];
const NOT_ENABLED = ['phase-gated', 'pending-approval', 'human-only', 'not-available', 'rejected'];
const SECRET_NAME = /(key|token|secret|password|passwd|credential|connectionstring|sas)/i;
const ENV_REF = /^\$\{[A-Za-z_][A-Za-z0-9_]*(:-[^}]*)?\}$|^\$\{env:[A-Za-z_][A-Za-z0-9_]*\}$/;
// Variables that change how a process loads code, resolves commands or reaches the network. Never set by configuration.
const LOADER_VARS = /^(NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|NODE_TLS_REJECT_UNAUTHORIZED|PATH|PATHEXT|COMSPEC|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_[A-Z_]+|PYTHONPATH|PYTHONSTARTUP|PYTHONHOME|BASH_ENV|ENV|GIT_[A-Z_]+|SSL_CERT_[A-Z_]+|CURL_CA_BUNDLE|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|npm_config_[a-z_]+|NPM_CONFIG_[A-Z_]+)$/i;
// The only properties a configuration entry may carry: each one is reviewed through the registry.
const CONFIG_KEYS = { '.vscode/mcp.json': ['type', 'command', 'args', 'url', 'env'], '.mcp.json': ['type', 'command', 'args', 'url', 'env', 'tools', 'timeout'], candidates: ['type', 'command', 'args', 'url', 'env'] };

const j = (root, p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const cell = (s) => String(s ?? '').replace(/\|/g, ' / ').replace(/\r?\n/g, ' ').trim();

export function grantedAgents(tool, policy) {
  const g = tool.grant ?? { type: 'none' };
  const agents = Object.entries(policy.agents);
  if (g.type === 'alias') return agents.filter(([, a]) => a.tools.includes(g.value)).map(([n]) => n);
  if (g.type === 'command') return agents.filter(([, a]) => a.commands.some((c) => c.includes(g.match))).map(([n]) => n);
  if (g.type === 'mcp') return agents.filter(([, a]) => (a.mcp ?? []).includes(`${g.server}/${g.tool}`)).map(([n]) => n);
  return [];
}

export function serverTools(registry, server) {
  return registry.tools.filter((t) => t.kind === 'mcp' && t.server === server && t.status === 'enabled' && t.grant?.type === 'mcp').map((t) => t.grant.tool);
}

export function renderTables(root) {
  const reg = j(root, REGISTRY);
  const pol = j(root, POLICY);
  const granted = (t) => grantedAgents(t, pol).join(', ') || 'none';
  const lines = [];
  const ro = reg.tools.filter((t) => t.status === 'enabled' && t.mutation === 'none');
  const rw = reg.tools.filter((t) => t.status === 'enabled' && t.mutation !== 'none');
  const off = reg.tools.filter((t) => t.status !== 'enabled');
  lines.push('### Servers', '', '| Server | Kind | Status | Privilege | Pin | Egress | Authentication |', '|---|---|---|---|---|---|---|');
  for (const [n, s] of Object.entries(reg.servers)) {
    const pin = s.pin.type === 'npm' ? `${s.pin.package}@${s.pin.version}` : s.pin.type;
    lines.push(`| ${cell(n)} | ${cell(s.kind)} | ${cell(s.status)} | ${cell(s.privilege)} | ${cell(pin)} | ${cell(s.egress)} | ${cell(s.auth)} |`);
  }
  lines.push('', `### Enabled read-only tools (${ro.length})`, '', '| ID | Category | Kind | Name | Privilege | Egress | Output untrusted | Granted to |', '|---|---|---|---|---|---|---|---|');
  for (const t of ro) lines.push(`| ${t.id} | ${t.category} | ${t.kind} | ${cell(t.name)} | ${t.privilege} | ${cell(t.egress)} | ${t.untrustedOutput ? 'yes' : 'no'} | ${granted(t)} |`);
  lines.push('', `### Enabled tools that can change local state, bounded by agent scope or an allow-list (${rw.length})`, '', '| ID | Category | Name | Mutation | Bounded by | Granted to |', '|---|---|---|---|---|---|');
  for (const t of rw) lines.push(`| ${t.id} | ${t.category} | ${cell(t.name)} | ${t.mutation} | ${cell(t.notes)} | ${granted(t)} |`);
  lines.push('', `### Not enabled (${off.length})`, '', '| ID | Category | Status | Mutation | Why not enabled |', '|---|---|---|---|---|');
  for (const t of off) lines.push(`| ${t.id} | ${t.category} | ${t.status} | ${t.mutation} | ${cell(t.notes)} |`);
  return lines.join('\n');
}

export function validateTools(root) {
  const errors = [];
  const fail = (msg) => errors.push({ check: 'tools', msg });
  const has = (p) => existsSync(path.join(root, p));
  if (!has(REGISTRY)) { fail(`missing ${REGISTRY}`); return errors; }
  if (!has(POLICY)) { fail(`missing ${POLICY}`); return errors; }
  let reg; let pol;
  try { reg = j(root, REGISTRY); } catch (e) { fail(`${REGISTRY}: invalid JSON (${e.message})`); return errors; }
  try { pol = j(root, POLICY); } catch (e) { fail(`${POLICY}: invalid JSON (${e.message})`); return errors; }
  const enums = reg.enums ?? {};
  const secretRes = has(SECRETS) ? j(root, SECRETS).repository.map((p) => new RegExp(p)) : [];
  const agents = Object.entries(pol.agents ?? {});

  // ---- servers ----
  const servers = reg.servers ?? {};
  for (const [name, s] of Object.entries(servers)) {
    const at = `server ${name}`;
    if (!ID_RE.test(name)) fail(`${at}: name must be lower-case letters, digits and hyphens`);
    if (!['local-stdio', 'remote-http'].includes(s.kind)) fail(`${at}: kind must be local-stdio or remote-http`);
    if (!['enabled', 'pending-approval', 'rejected'].includes(s.status)) fail(`${at}: status must be enabled, pending-approval or rejected`);
    for (const k of ['publisher', 'owner', 'privilege', 'egress', 'auth', 'timeoutMs', 'maxOutputBytes', 'pin']) if (s[k] === undefined) fail(`${at}: '${k}' is required`);
    if (!enums.privilege?.includes(s.privilege)) fail(`${at}: unknown privilege '${s.privilege}'`);
    if (s.status === 'enabled' && !['read-local', 'read-external'].includes(s.privilege)) fail(`${at}: an enabled server must be read-only (read-local or read-external), found ${s.privilege}`);
    if (!Number.isInteger(s.timeoutMs) || s.timeoutMs < 1000 || s.timeoutMs > 60000) fail(`${at}: timeoutMs must be 1000 to 60000`);
    if (!Number.isInteger(s.maxOutputBytes) || s.maxOutputBytes < 1024 || s.maxOutputBytes > 262144) fail(`${at}: maxOutputBytes must be 1024 to 262144`);
    if (s.kind === 'remote-http') {
      let u = null;
      try { u = new URL(s.url); } catch { fail(`${at}: url is not valid`); }
      if (u && u.protocol !== 'https:') fail(`${at}: remote servers must use https`);
      if (u && (u.username || u.password || u.search)) fail(`${at}: the url must not carry credentials or a query string`);
      if (u && !(s.allowedHosts ?? []).includes(u.hostname)) fail(`${at}: host ${u.hostname} is not in allowedHosts`);
      if (s.untrustedOutput !== true) fail(`${at}: remote servers must be marked untrustedOutput`);
      if (s.pin?.type !== 'remote-service') fail(`${at}: a remote server's pin.type must be remote-service (it cannot be version-pinned) and must list mitigations`);
      if (!Array.isArray(s.pin?.notes) || !s.pin.notes.length) fail(`${at}: pin.notes must record the review and mitigations`);
    } else {
      if (!nonEmpty(s.command)) fail(`${at}: command is required`);
      if (!Array.isArray(s.args)) fail(`${at}: args must be an array`);
      if (s.command === 'npx' || s.pin?.type === 'npm') {
        const pkg = (s.args ?? []).find((a) => !a.startsWith('-'));
        const m = String(pkg).match(PIN_RE);
        if (!m) fail(`${at}: the npm package must be pinned to an exact version like pkg@1.2.3 (found '${pkg}'); no latest, ranges or tags`);
        else if (s.pin?.package !== m[1] || s.pin?.version !== m[2]) fail(`${at}: pin.package and pin.version must match the args (${m[1]}@${m[2]})`);
        if (!/^sha512-[A-Za-z0-9+/=]{80,}$/.test(s.pin?.integrity ?? '')) fail(`${at}: an npm pin needs the sha512 integrity of the reviewed tarball`);
        if (!nonEmpty(s.pin?.reviewedOn)) fail(`${at}: pin.reviewedOn is required`);
        if ((s.args ?? []).some((a) => a === '-y' || a === '--yes')) fail(`${at}: do not auto-confirm package installs (-y/--yes); a human installs the reviewed version`);
        if (!(s.args ?? []).includes('--read-only') && s.privilege === 'auth-read') fail(`${at}: an Azure server must start in read-only mode (--read-only)`);
      } else if (s.command === 'node') {
        const script = s.args?.[0];
        if (!/^harness\/mcp\/[\w.-]+\.mjs$/.test(String(script)) || !has(script)) fail(`${at}: a local node server must be a script under harness/mcp/ that exists (found '${script}')`);
        if ((s.pin?.dependencies ?? 1) !== 0) fail(`${at}: a repository server must declare zero dependencies`);
      } else fail(`${at}: command must be node (repository script) or npx (pinned package)`);
    }
    for (const [k, v] of Object.entries(s.env ?? {})) {
      if (LOADER_VARS.test(k)) fail(`${at}: env ${k} can change how a process loads or connects and is not allowed`);
      if (typeof v !== 'string') fail(`${at}: env ${k} must be a string`);
      else if (SECRET_NAME.test(k) && !ENV_REF.test(v)) fail(`${at}: env ${k} looks like a secret and must be an \${ENV} reference, never a literal value`);
    }
  }

  // Hooks match tool names by server name; two names that normalise alike could be mistaken for each other.
  const seenNames = new Map();
  for (const name of new Set([...Object.keys(servers), ...(reg.builtInServers ?? [])])) {
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seenNames.has(key)) fail(`server names '${seenNames.get(key)}' and '${name}' collide after normalisation; tool names could be confused`);
    seenNames.set(key, name);
  }

  // ---- tools ----
  const tools = reg.tools ?? [];
  const ids = new Set();
  const cats = new Set();
  for (const t of tools) {
    const at = `tool ${t.id ?? '?'}`;
    for (const k of REQUIRED) if (t[k] === undefined || t[k] === '') fail(`${at}: '${k}' is required`);
    if (!ID_RE.test(t.id ?? '')) fail(`${at}: id must be lower-case letters, digits and hyphens`);
    if (ids.has(t.id)) fail(`${at}: duplicate id`);
    ids.add(t.id);
    cats.add(t.category);
    for (const k of ['category', 'kind', 'privilege', 'mutation', 'status', 'humanApproval']) if (!enums[k]?.includes(t[k])) fail(`${at}: ${k} '${t[k]}' is not one of ${(enums[k] ?? []).join(', ')}`);
    if (typeof t.untrustedOutput !== 'boolean') fail(`${at}: untrustedOutput must be true or false`);
    const enabled = t.status === 'enabled';
    if (['remote', 'unbounded'].includes(t.mutation) && enabled) fail(`${at}: a tool with ${t.mutation} mutation cannot be enabled for agents`);
    if (['write-remote', 'mutate-azure'].includes(t.privilege) && enabled) fail(`${at}: privilege ${t.privilege} cannot be enabled for agents`);
    if (['write-remote', 'mutate-azure'].includes(t.privilege) && t.humanApproval !== 'always') fail(`${at}: ${t.privilege} needs humanApproval always`);
    if (t.privilege === 'auth-read' && enabled) fail(`${at}: tools that need Azure or GitHub sign-in stay pending-approval until the owner approves authentication`);
    if (t.kind === 'mcp') {
      if (!servers[t.server]) fail(`${at}: server '${t.server}' is not in servers`);
      if (enabled) {
        if (t.mutation !== 'none' || !['read-local', 'read-external'].includes(t.privilege)) fail(`${at}: an enabled MCP tool must be read-only`);
        if (!MCP_TOOL_RE.test(t.name)) fail(`${at}: MCP tool name must be snake_case`);
        if (servers[t.server]?.status !== 'enabled') fail(`${at}: enabled tool on a server that is not enabled`);
        if (t.grant?.type !== 'mcp' || t.grant.server !== t.server || t.grant.tool !== t.name) fail(`${at}: grant must name this server and tool`);
        const l = t.limits ?? {};
        if (!Number.isInteger(l.timeoutMs) || l.timeoutMs > (servers[t.server]?.timeoutMs ?? 0)) fail(`${at}: limits.timeoutMs must be set and not exceed the server timeout`);
        if (!Number.isInteger(l.maxOutputBytes) || l.maxOutputBytes > (servers[t.server]?.maxOutputBytes ?? 0)) fail(`${at}: limits.maxOutputBytes must be set and not exceed the server limit`);
      }
      if (servers[t.server]?.untrustedOutput && t.untrustedOutput !== true) fail(`${at}: output of an untrusted server must be marked untrustedOutput`);
    }
    if (t.category === 'documentation' && t.kind !== 'not-available' && t.untrustedOutput !== true) fail(`${at}: documentation tools return external content and must be marked untrustedOutput`);
    const who = grantedAgents(t, pol);
    if (enabled && !who.length) fail(`${at}: enabled but granted to no agent; either grant it or change its status`);
    if (!enabled && who.length) fail(`${at}: status ${t.status} but granted to ${who.join(', ')}; a disabled tool must not be reachable`);
    if (!enabled && !NOT_ENABLED.includes(t.status)) fail(`${at}: unknown status ${t.status}`);
    if (t.grant?.type === 'command') {
      try { new RegExp(t.grant.match); } catch { /* substring, not a regex; nothing to check */ }
    }
  }
  for (const c of enums.category ?? []) if (!cats.has(c)) fail(`no tool is registered for category '${c}'`);
  for (const a of pol.toolAliases ?? []) if (!tools.some((t) => t.status === 'enabled' && t.grant?.type === 'alias' && t.grant.value === a)) fail(`tool alias '${a}' has no enabled registry entry`);

  // ---- agent MCP grants ----
  for (const [name, a] of agents) {
    const cls = pol.classes?.[a.class];
    const seen = new Set();
    for (const g of a.mcp ?? []) {
      const at = `agent ${name}: mcp grant '${g}'`;
      const m = g.match(/^([a-z][a-z0-9-]*)\/([a-z][a-z0-9_]*)$/);
      if (!m) { fail(`${at} must be server/tool with no wildcard`); continue; }
      if (seen.has(g)) fail(`${at} is duplicated`);
      seen.add(g);
      const t = tools.find((x) => x.kind === 'mcp' && x.server === m[1] && x.name === m[2]);
      if (!t) { fail(`${at} is not in the tool registry`); continue; }
      if (t.status !== 'enabled') fail(`${at} refers to a tool that is ${t.status}`);
      if (!cls?.mcpPrivileges?.includes(t.privilege)) fail(`${at}: class ${a.class} may not use ${t.privilege} MCP tools`);
      if (t.privilege === 'read-external' && !a.web) fail(`${at}: external MCP tools need the same approval as web access (web: true)`);
    }
  }
  if (!same(reg.webHosts ?? [], pol.webHosts ?? [])) fail('webHosts in the registry and in agent-policy.json differ');
  for (const h of reg.webHosts ?? []) if (!HOST_RE.test(h) || h.includes('*')) fail(`webHosts: '${h}' must be a plain host name`);

  // ---- configuration files ----
  const enabledServers = Object.entries(servers).filter(([, s]) => s.status === 'enabled');
  const pending = Object.entries(servers).filter(([, s]) => s.status !== 'enabled').map(([n]) => n);
  const readCfg = (p, key) => {
    if (!has(p)) return null;
    let doc;
    try { doc = j(root, p); } catch (e) { fail(`${p}: invalid JSON (${e.message})`); return null; }
    const text = readFileSync(path.join(root, p), 'utf8');
    for (const re of secretRes) if (re.test(text)) fail(`${p}: contains a secret-shaped value`);
    if (/"(envFile|inputs)"\s*:/.test(text)) fail(`${p}: envFile and input prompts are not used; secrets are never stored or prompted for in repository configuration`);
    const map = doc[key];
    if (!map || typeof map !== 'object') { fail(`${p}: top-level '${key}' object is required`); return null; }
    return map;
  };
  const vs = readCfg('.vscode/mcp.json', 'servers');
  const portable = readCfg('.mcp.json', 'mcpServers');
  if (has('.github/mcp.json')) fail('.github/mcp.json must not exist; use .vscode/mcp.json and .mcp.json only, so the configuration cannot drift across a third file');
  for (const [file, map] of [['.vscode/mcp.json', vs], ['.mcp.json', portable]]) {
    if (!map) { if (map === null && !has(file)) fail(`${file} is required`); continue; }
    if (!same(Object.keys(map), enabledServers.map(([n]) => n))) fail(`${file}: servers [${Object.keys(map)}] must be exactly the enabled registry servers [${enabledServers.map(([n]) => n)}]`);
    for (const p of pending) if (p in map) fail(`${file}: '${p}' is pending approval and must not be configured`);
    for (const [n, c] of Object.entries(map)) {
      const s = servers[n];
      if (!s) continue;
      const at = `${file}: ${n}`;
      const norm = (v) => String(v).replace('${workspaceFolder}/', '');
      if (s.kind === 'remote-http') {
        if (c.type !== 'http' || c.url !== s.url) fail(`${at}: must be type http with url ${s.url}`);
        if (c.headers) fail(`${at}: no headers; this server needs no authentication`);
      } else {
        if (c.type !== undefined && c.type !== 'stdio') fail(`${at}: type must be stdio`);
        if (c.command !== s.command || !same((c.args ?? []).map(norm), s.args)) fail(`${at}: command and args must equal the registry (${s.command} ${s.args.join(' ')})`);
        if (file === '.vscode/mcp.json' && (c.args ?? []).some((a) => /^\$\{(?!workspaceFolder\})/.test(a))) fail(`${at}: only \${workspaceFolder} is allowed in args`);
      }
      const wantEnv = JSON.stringify(Object.entries(s.env ?? {}).sort());
      if (JSON.stringify(Object.entries(c.env ?? {}).sort()) !== wantEnv) fail(`${at}: env must equal the reviewed registry env exactly (an extra variable such as NODE_OPTIONS can change what runs)`);
      for (const k of Object.keys(c.env ?? {})) if (LOADER_VARS.test(k)) fail(`${at}: env ${k} can change how a process loads or connects and is not allowed`);
      for (const k of Object.keys(c)) if (!CONFIG_KEYS[file].includes(k)) fail(`${at}: undeclared property '${k}'; every property must be one the registry reviews`);
      for (const [k, v] of Object.entries(c.env ?? {})) if (SECRET_NAME.test(k) && !ENV_REF.test(String(v))) fail(`${at}: env ${k} must be an environment reference`);
      if (file === '.mcp.json') {
        if (!same(c.tools ?? [], serverTools(reg, n))) fail(`${at}: tools must be exactly the enabled registry tools [${serverTools(reg, n)}] (native allow-filter)`);
        if (c.timeout !== s.timeoutMs) fail(`${at}: timeout must be ${s.timeoutMs} ms (the registry value)`);
      }
    }
  }

  // ---- candidates (never loaded by any client) ----
  if (pending.length) {
    if (!has(CANDIDATES)) fail(`missing ${CANDIDATES} for pending servers [${pending}]`);
    else {
      let cand = null;
      try { cand = j(root, CANDIDATES); } catch (e) { fail(`${CANDIDATES}: invalid JSON (${e.message})`); }
      const map = cand?.mcpServers;
      if (!map) fail(`${CANDIDATES}: top-level 'mcpServers' is required`);
      else {
        if (!same(Object.keys(map), pending)) fail(`${CANDIDATES}: must list exactly the pending servers [${pending}]`);
        const text = readFileSync(path.join(root, CANDIDATES), 'utf8');
        for (const re of secretRes) if (re.test(text)) fail(`${CANDIDATES}: contains a secret-shaped value`);
        for (const [n, c] of Object.entries(map)) {
          const s = servers[n];
          if (!s) continue;
          if (s.kind === 'local-stdio' && (c.command !== s.command || !same(c.args ?? [], s.args))) fail(`${CANDIDATES}: ${n} must match the registry command and args`);
          if (s.kind === 'remote-http' && c.url !== s.url) fail(`${CANDIDATES}: ${n} must match the registry url`);
          if (JSON.stringify(c).match(/"authorization"/i)) fail(`${CANDIDATES}: ${n}: no authorization header in a file; the host supplies credentials`);
          if (JSON.stringify(Object.entries(c.env ?? {}).sort()) !== JSON.stringify(Object.entries(s.env ?? {}).sort())) fail(`${CANDIDATES}: ${n}: env must equal the registry env exactly`);
          for (const k of Object.keys(c.env ?? {})) if (LOADER_VARS.test(k)) fail(`${CANDIDATES}: ${n}: env ${k} can change how a process loads or connects and is not allowed`);
          for (const k of Object.keys(c)) if (!CONFIG_KEYS['candidates'].includes(k)) fail(`${CANDIDATES}: ${n}: undeclared property '${k}'`);
        }
      }
    }
  }

  // ---- hook, ignore file, documents ----
  const hook = has('.github/hooks/tool-output.json') ? j(root, '.github/hooks/tool-output.json') : null;
  const entry = hook?.hooks?.postToolUse?.[0];
  if (!entry || !/tool-output-guard\.cjs/.test(entry.command ?? '')) fail('.github/hooks/tool-output.json must register harness/hooks/tool-output-guard.cjs as a postToolUse hook');
  else if (!(entry.timeoutSec >= 1 && entry.timeoutSec <= (reg.defaults?.hookTimeoutSec ?? 10))) fail(`tool-output hook timeoutSec must be 1 to ${reg.defaults?.hookTimeoutSec ?? 10}`);
  if (!has('.gitignore') || !/^\.harness-logs\/?\r?$/m.test(readFileSync(path.join(root, '.gitignore'), 'utf8'))) fail('.gitignore must ignore .harness-logs/ so audit logs never reach Git');
  for (const p of ['docs/harness/TOOL-REGISTRY.md', 'docs/harness/MCP-SECURITY.md', 'docs/harness/TOOL-COMPATIBILITY.md']) if (!has(p)) fail(`missing ${p}`);
  if (has(DOC)) {
    const text = readFileSync(path.join(root, DOC), 'utf8').replace(/\r\n/g, '\n');
    const a = text.indexOf(START);
    const b = text.indexOf(END);
    if (a < 0 || b < a) fail(`${DOC}: generated table markers are missing`);
    else if (text.slice(a + START.length, b).trim() !== renderTables(root).trim()) fail(`${DOC}: the generated tables are out of date; run node harness/scripts/validate-tools.mjs --write`);
  }
  return errors;
}

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root');
  const root = path.resolve(i > 0 ? process.argv[i + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  if (process.argv.includes('--write')) {
    const file = path.join(root, DOC);
    const text = readFileSync(file, 'utf8');
    const crlf = text.includes('\r\n');
    const t = text.replace(/\r\n/g, '\n');
    const a = t.indexOf(START);
    const b = t.indexOf(END);
    if (a < 0 || b < a) { console.error(`validate-tools: markers missing in ${DOC}`); process.exit(2); }
    const out = `${t.slice(0, a + START.length)}\n\n${renderTables(root)}\n\n${t.slice(b)}`;
    writeFileSync(file, crlf ? out.replace(/\n/g, '\r\n') : out);
    console.log(`validate-tools: regenerated tables in ${DOC}`);
    process.exit(0);
  }
  const errors = validateTools(root);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ root, ok: !errors.length, errors }, null, 2));
  else if (errors.length) { for (const e of errors) console.error(`FAIL [${e.check}] ${e.msg}`); console.error(`${errors.length} problem(s).`); }
  else console.log('validate-tools: OK');
  process.exit(errors.length ? 1 : 0);
}
