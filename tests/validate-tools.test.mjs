import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTools, renderTables, grantedAgents, serverTools } from '../harness/scripts/validate-tools.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COPY = ['harness/tools', 'harness/policy', 'harness/mcp', '.vscode', '.mcp.json', '.github/hooks', '.gitignore', 'docs/harness'];
const roots = [];
process.on('exit', () => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

function sandbox() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gf-tools-'));
  roots.push(root);
  for (const rel of COPY) {
    const from = path.join(repo, rel);
    if (!existsSync(from)) continue;
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    cpSync(from, path.join(root, rel), { recursive: true });
  }
  return root;
}
const REG = 'harness/tools/tool-registry.json';
const POL = 'harness/policy/agent-policy.json';
const jedit = (rel, fn) => (root) => { const p = path.join(root, rel); const o = JSON.parse(readFileSync(p, 'utf8')); fn(o); writeFileSync(p, JSON.stringify(o, null, 2)); };
const tedit = (rel, fn) => (root) => { const p = path.join(root, rel); const b = readFileSync(p, 'utf8'); const a = fn(b); assert.notEqual(a, b, `edit of ${rel} changed nothing`); writeFileSync(p, a); };
const find = (o, id) => o.tools.find((t) => t.id === id);
function errorsAfter(...edits) { const root = sandbox(); for (const e of edits) e(root); return validateTools(root).map((x) => x.msg); }
const bad = (re, ...edits) => { const m = errorsAfter(...edits); assert.ok(m.some((x) => re.test(x)), `expected ${re}; got:\n${m.join('\n') || '(no errors)'}`); };

// Secret-shaped values are assembled at run time so this file never contains one.
const fakeToken = () => `gh${'p'}_${'A1b2C3d4E5'.repeat(4)}`;

test('the real tool layer validates cleanly', () => assert.deepEqual(validateTools(repo), []));

test('the registry covers every category and every tool alias, and nothing disabled is reachable', () => {
  const reg = JSON.parse(readFileSync(path.join(repo, REG), 'utf8'));
  const pol = JSON.parse(readFileSync(path.join(repo, POL), 'utf8'));
  assert.deepEqual([...new Set(reg.tools.map((t) => t.category))].sort(), [...reg.enums.category].sort());
  for (const t of reg.tools) {
    const who = grantedAgents(t, pol);
    assert.equal(t.status === 'enabled', who.length > 0, `${t.id}: status ${t.status} but granted to [${who}]`);
  }
  assert.ok(reg.tools.filter((t) => t.kind === 'mcp' && t.status === 'enabled').every((t) => t.mutation === 'none'));
});

// ---------- tools ----------
test('tools: duplicate ids, missing fields and unknown enum values are rejected', () => {
  bad(/duplicate id/, jedit(REG, (r) => { r.tools[1].id = r.tools[0].id; }));
  bad(/'purpose' is required/, jedit(REG, (r) => { delete r.tools[0].purpose; }));
  bad(/status 'live' is not one of/, jedit(REG, (r) => { r.tools[0].status = 'live'; }));
  bad(/privilege 'root' is not one of/, jedit(REG, (r) => { r.tools[0].privilege = 'root'; }));
  bad(/untrustedOutput must be true or false/, jedit(REG, (r) => { r.tools[0].untrustedOutput = 'no'; }));
  bad(/id must be lower-case/, jedit(REG, (r) => { r.tools[0].id = 'Bad_ID'; }));
});

test('tools: a mutating, remote or signed-in tool can never be enabled for an agent', () => {
  bad(/an enabled MCP tool must be read-only/, jedit(REG, (r) => { find(r, 'mem-task-state').mutation = 'local-scoped'; }));
  bad(/cannot be enabled for agents/, jedit(REG, (r) => { find(r, 'repo-gh-write').status = 'enabled'; }));
  bad(/privilege write-remote cannot be enabled/, jedit(REG, (r) => { find(r, 'mem-copilot-memory').status = 'enabled'; }));
  bad(/privilege mutate-azure cannot be enabled/, jedit(REG, (r) => { find(r, 'azure-mutation').status = 'enabled'; }));
  bad(/sign-in stay pending-approval/, jedit(REG, (r) => { find(r, 'azure-cli-read').status = 'enabled'; }));
  bad(/needs humanApproval always/, jedit(REG, (r) => { find(r, 'azure-mutation').humanApproval = 'never'; }));
});

test('tools: grants must match status in both directions', () => {
  bad(/disabled tool must not be reachable/, jedit(REG, (r) => { find(r, 'eng-validate-tools').status = 'pending-approval'; }));
  bad(/enabled but granted to no agent/, jedit(POL, (p) => { for (const a of Object.values(p.agents)) a.mcp = (a.mcp ?? []).filter((g) => g !== 'greenfuel-tools/get_task_state'); }));
  bad(/no tool is registered for category 'observability'/, jedit(REG, (r) => { r.tools = r.tools.filter((t) => t.category !== 'observability'); }));
  bad(/tool alias 'todo' has no enabled registry entry/, jedit(REG, (r) => { r.tools = r.tools.filter((t) => t.id !== 'mem-session-todo'); }));
});

test('tools: MCP tools need limits within their server, a real server and a matching grant descriptor', () => {
  bad(/limits.timeoutMs must be set/, jedit(REG, (r) => { delete find(r, 'mem-task-state').limits; }));
  bad(/limits.maxOutputBytes must be set and not exceed/, jedit(REG, (r) => { find(r, 'mem-task-state').limits.maxOutputBytes = 999999; }));
  bad(/limits.timeoutMs must be set and not exceed/, jedit(REG, (r) => { find(r, 'mem-task-state').limits.timeoutMs = 600000; }));
  bad(/server 'nope' is not in servers/, jedit(REG, (r) => { find(r, 'mem-task-state').server = 'nope'; }));
  bad(/grant must name this server and tool/, jedit(REG, (r) => { find(r, 'mem-task-state').grant.tool = 'get_task_stat'; }));
  bad(/MCP tool name must be snake_case/, jedit(REG, (r) => { find(r, 'mem-task-state').name = 'Get-Task'; }));
});

test('tools: external content is always marked untrusted', () => {
  bad(/documentation tools return external content/, jedit(REG, (r) => { find(r, 'docs-web-fetch').untrustedOutput = false; }));
  bad(/output of an untrusted server must be marked untrustedOutput/, jedit(REG, (r) => { find(r, 'docs-microsoft-learn-search').untrustedOutput = false; }));
});

// ---------- servers ----------
test('servers: remote servers must be https, host-pinned, untrusted and carry no credentials', () => {
  bad(/must use https/, jedit(REG, (r) => { r.servers['microsoft-learn'].url = 'http://learn.microsoft.com/api/mcp'; }));
  bad(/must not carry credentials or a query string/, jedit(REG, (r) => { r.servers['microsoft-learn'].url = 'https://learn.microsoft.com/api/mcp?key=1'; }));
  bad(/must not carry credentials or a query string/, jedit(REG, (r) => { r.servers['microsoft-learn'].url = 'https://u:p@learn.microsoft.com/api/mcp'; }));
  bad(/is not in allowedHosts/, jedit(REG, (r) => { r.servers['microsoft-learn'].allowedHosts = ['example.com']; }));
  bad(/remote servers must be marked untrustedOutput/, jedit(REG, (r) => { r.servers['microsoft-learn'].untrustedOutput = false; }));
  bad(/pin.type must be remote-service/, jedit(REG, (r) => { r.servers['microsoft-learn'].pin.type = 'npm'; }));
  bad(/pin.notes must record/, jedit(REG, (r) => { r.servers['microsoft-learn'].pin.notes = []; }));
});

test('servers: npm packages need an exact version, an integrity hash, no auto-confirm and read-only mode', () => {
  const az = (fn) => jedit(REG, (r) => fn(r.servers['azure-mcp']));
  bad(/pinned to an exact version/, az((s) => { s.args[0] = '@azure/mcp@latest'; }));
  bad(/pinned to an exact version/, az((s) => { s.args[0] = '@azure/mcp@^3.0.0'; }));
  bad(/pinned to an exact version/, az((s) => { s.args[0] = '@azure/mcp'; }));
  bad(/pin.package and pin.version must match/, az((s) => { s.args[0] = '@azure/mcp@3.0.1'; }));
  bad(/needs the sha512 integrity/, az((s) => { delete s.pin.integrity; }));
  bad(/do not auto-confirm package installs/, az((s) => { s.args.unshift('-y'); }));
  bad(/do not auto-confirm package installs/, az((s) => { s.args.unshift('--yes'); }));
  bad(/must start in read-only mode/, az((s) => { s.args = s.args.filter((a) => a !== '--read-only'); }));
  bad(/pin.reviewedOn is required/, az((s) => { delete s.pin.reviewedOn; }));
});

test('servers: repository servers must be scripts under harness/mcp with zero dependencies; enabled servers are read-only', () => {
  const gt = (fn) => jedit(REG, (r) => fn(r.servers['greenfuel-tools']));
  bad(/must be a script under harness\/mcp\/ that exists/, gt((s) => { s.args = ['harness/scripts/validate-agents.mjs']; }));
  bad(/must be a script under harness\/mcp\/ that exists/, gt((s) => { s.args = ['harness/mcp/missing.mjs']; }));
  bad(/must declare zero dependencies/, gt((s) => { s.pin.dependencies = 3; }));
  bad(/command must be node/, gt((s) => { s.command = 'bash'; }));
  bad(/must be read-only/, gt((s) => { s.privilege = 'write-local'; }));
  bad(/timeoutMs must be 1000 to 60000/, gt((s) => { s.timeoutMs = 0; }));
  bad(/maxOutputBytes must be 1024 to 262144/, gt((s) => { s.maxOutputBytes = 10 ** 9; }));
});

test('servers: secret-looking environment variables must be references, never literals', () => {
  const env = (e) => (root) => { jedit(REG, (r) => { r.servers['azure-mcp'].env = e; })(root); jedit('harness/tools/mcp-candidates.json', (c) => { c.mcpServers['azure-mcp'].env = e; })(root); };
  bad(/looks like a secret and must be an \$\{ENV\} reference/, env({ API_TOKEN: 'literal-value' }));
  bad(/looks like a secret/, env({ CLIENT_SECRET: 'abc' }));
  assert.deepEqual(errorsAfter(env({ API_TOKEN: '${AZURE_TOKEN}', AZURE_MCP_COLLECT_TELEMETRY: 'false' })), []);
});

// ---------- configuration files ----------
test('config: pending servers must not be configured, and the two files must agree with the registry', () => {
  bad(/'azure-mcp' is pending approval and must not be configured/, jedit('.mcp.json', (c) => { c.mcpServers['azure-mcp'] = { command: 'npx', args: ['@azure/mcp@3.0.0'] }; }));
  bad(/'github-mcp-server' is pending approval and must not be configured/, jedit('.vscode/mcp.json', (c) => { c.servers['github-mcp-server'] = { type: 'http', url: 'https://api.githubcopilot.com/mcp/readonly' }; }));
  bad(/\.vscode\/mcp\.json: servers .* must be exactly the enabled registry servers/, jedit('.vscode/mcp.json', (c) => { delete c.servers['microsoft-learn']; }));
  bad(/\.mcp\.json: servers .* must be exactly/, jedit('.mcp.json', (c) => { delete c.mcpServers['greenfuel-tools']; }));
  bad(/command and args must equal the registry/, jedit('.mcp.json', (c) => { c.mcpServers['greenfuel-tools'].args = ['harness/scripts/design-gate.mjs']; }));
  bad(/command and args must equal the registry/, jedit('.vscode/mcp.json', (c) => { c.servers['greenfuel-tools'].command = 'bash'; }));
  bad(/must be type http with url/, jedit('.mcp.json', (c) => { c.mcpServers['microsoft-learn'].url = 'https://evil.example/mcp'; }));
  bad(/no headers/, jedit('.vscode/mcp.json', (c) => { c.servers['microsoft-learn'].headers = { Authorization: 'x' }; }));
});

test('config: the native tool allow-filter and timeout must equal the registry', () => {
  bad(/tools must be exactly the enabled registry tools/, jedit('.mcp.json', (c) => { c.mcpServers['greenfuel-tools'].tools.pop(); }));
  bad(/tools must be exactly the enabled registry tools/, jedit('.mcp.json', (c) => { c.mcpServers['microsoft-learn'].tools.push('microsoft_docs_delete'); }));
  bad(/tools must be exactly the enabled registry tools/, jedit('.mcp.json', (c) => { delete c.mcpServers['microsoft-learn'].tools; }));
  bad(/timeout must be 20000/, jedit('.mcp.json', (c) => { c.mcpServers['greenfuel-tools'].timeout = 600000; }));
  bad(/only \$\{workspaceFolder\} is allowed/, jedit('.vscode/mcp.json', (c) => { c.servers['greenfuel-tools'].args = ['${userHome}/x.mjs']; }));
});

test('config: no secrets, no env files, no prompts, no third configuration file', () => {
  bad(/secret-shaped value/, jedit('.mcp.json', (c) => { c.mcpServers['greenfuel-tools'].env = { NOTE: fakeToken() }; }));
  bad(/must be an environment reference/, jedit('.mcp.json', (c) => { c.mcpServers['greenfuel-tools'].env = { GITHUB_TOKEN: 'literal' }; }));
  bad(/envFile and input prompts are not used/, jedit('.vscode/mcp.json', (c) => { c.servers['greenfuel-tools'].envFile = '${workspaceFolder}/.env'; }));
  bad(/envFile and input prompts are not used/, jedit('.vscode/mcp.json', (c) => { c.inputs = [{ id: 'k', type: 'promptString', password: true }]; }));
  bad(/\.github\/mcp\.json must not exist/, (root) => { writeFileSync(path.join(root, '.github', 'mcp.json'), '{}'); });
  bad(/top-level 'servers' object is required/, tedit('.vscode/mcp.json', (t) => t.replace('"servers"', '"mcpServers"')));
  bad(/invalid JSON/, tedit('.mcp.json', (t) => `${t}}`));
});

test('config: environment drift, loader variables and undeclared properties are rejected', () => {
  bad(/env must equal the reviewed registry env exactly/, jedit('.vscode/mcp.json', (c) => { c.servers['greenfuel-tools'].env = { FOO: 'bar' }; }));
  bad(/env must equal the reviewed registry env exactly/, jedit('.mcp.json', (c) => { c.mcpServers['greenfuel-tools'].env = { FOO: 'bar' }; }));
  bad(/env NODE_OPTIONS can change how a process loads/, jedit('.vscode/mcp.json', (c) => { c.servers['greenfuel-tools'].env = { NODE_OPTIONS: '--require=./attacker.cjs' }; }));
  for (const v of ['NODE_PATH', 'PATH', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'PYTHONPATH', 'HTTPS_PROXY', 'GIT_SSH_COMMAND', 'npm_config_registry', 'COMSPEC']) bad(new RegExp(`env ${v} can change how a process loads`), jedit('.mcp.json', (c) => { c.mcpServers['greenfuel-tools'].env = { [v]: 'x' }; }));
  bad(/undeclared property 'cwd'/, jedit('.vscode/mcp.json', (c) => { c.servers['greenfuel-tools'].cwd = '${workspaceFolder}/elsewhere'; }));
  bad(/undeclared property 'sandboxEnabled'/, jedit('.vscode/mcp.json', (c) => { c.servers['greenfuel-tools'].sandboxEnabled = false; }));
  bad(/undeclared property 'dev'/, jedit('.vscode/mcp.json', (c) => { c.servers['greenfuel-tools'].dev = { watch: '**/*' }; }));
  bad(/undeclared property 'headers'/, jedit('.mcp.json', (c) => { c.mcpServers['microsoft-learn'].headers = { 'X-Test': '1' }; }));
  bad(/undeclared property 'disabled'/, jedit('.mcp.json', (c) => { c.mcpServers['greenfuel-tools'].disabled = false; }));
  bad(/env NODE_OPTIONS can change how a process loads/, jedit(REG, (r) => { r.servers['azure-mcp'].env.NODE_OPTIONS = '--inspect'; }));
});

test('candidates: env must equal the registry, no loader variables, no undeclared properties', () => {
  const CAND = 'harness/tools/mcp-candidates.json';
  bad(/env must equal the registry env exactly/, jedit(CAND, (c) => { c.mcpServers['azure-mcp'].env.EXTRA = 'x'; }));
  bad(/env NODE_OPTIONS can change how a process loads/, jedit(CAND, (c) => { c.mcpServers['azure-mcp'].env.NODE_OPTIONS = '--require x'; }));
  bad(/undeclared property 'cwd'/, jedit(CAND, (c) => { c.mcpServers['azure-mcp'].cwd = '/tmp'; }));
});

test('servers whose names collide after normalisation are rejected', () => {
  bad(/collide after normalisation/, jedit(REG, (r) => { r.servers.greenfueltools = JSON.parse(JSON.stringify(r.servers['microsoft-learn'])); r.servers.greenfueltools.status = 'pending-approval'; }));
  bad(/collide after normalisation/, jedit(REG, (r) => { r.servers['github_mcp_server'] = JSON.parse(JSON.stringify(r.servers['microsoft-learn'])); r.servers['github_mcp_server'].status = 'pending-approval'; }));
});

test('candidates: exactly the pending servers, matching the registry, never carrying credentials', () => {
  const CAND = 'harness/tools/mcp-candidates.json';
  bad(/must list exactly the pending servers/, jedit(CAND, (c) => { delete c.mcpServers['azure-mcp']; }));
  bad(/must match the registry command and args/, jedit(CAND, (c) => { c.mcpServers['azure-mcp'].args[0] = '@azure/mcp@4.0.0-beta.3'; }));
  bad(/must match the registry command and args/, jedit(CAND, (c) => { c.mcpServers['azure-mcp'].args = c.mcpServers['azure-mcp'].args.filter((a) => a !== '--read-only'); }));
  bad(/must match the registry url/, jedit(CAND, (c) => { c.mcpServers['github-mcp-server'].url = 'https://api.githubcopilot.com/mcp/'; }));
  bad(/no authorization header/, jedit(CAND, (c) => { c.mcpServers['github-mcp-server'].headers = { Authorization: 'Bearer x' }; }));
  bad(/secret-shaped value/, jedit(CAND, (c) => { c.mcpServers['github-mcp-server'].note = fakeToken(); }));
  bad(/missing harness\/tools\/mcp-candidates\.json/, (root) => rmSync(path.join(root, CAND)));
});

// ---------- agent grants ----------
test('agent grants: exact server/tool names, enabled tools only, privilege by class, external only with web access', () => {
  const grant = (agent, g) => jedit(POL, (p) => { p.agents[agent].mcp.push(g); });
  bad(/must be server\/tool with no wildcard/, grant('architecture-critic', 'greenfuel-tools/*'));
  bad(/is not in the tool registry/, grant('architecture-critic', 'greenfuel-tools/delete_all'));
  bad(/class planner may not use read-external/, grant('architecture-critic', 'microsoft-learn/microsoft_docs_search'));
  bad(/external MCP tools need the same approval as web access/, grant('data-engineer', 'microsoft-learn/microsoft_docs_search'));
  bad(/is duplicated/, grant('architecture-critic', 'greenfuel-tools/trace_requirement'));
  bad(/refers to a tool that is/, jedit(REG, (r) => { find(r, 'mem-task-state').status = 'phase-gated'; }));
  bad(/web access/, jedit(POL, (p) => { p.agents['azure-platform'].web = false; }));
});

test('agent grants: web hosts in the registry and policy must agree and be plain hosts', () => {
  bad(/webHosts in the registry and in agent-policy.json differ/, jedit(POL, (p) => { p.webHosts.push('example.com'); }));
  bad(/must be a plain host name/, (root) => { jedit(REG, (r) => { r.webHosts.push('*.microsoft.com'); })(root); jedit(POL, (p) => { p.webHosts.push('*.microsoft.com'); })(root); });
  bad(/must be a plain host name/, (root) => { jedit(REG, (r) => { r.webHosts.push('10.0.0.1'); })(root); jedit(POL, (p) => { p.webHosts.push('10.0.0.1'); })(root); });
});

// ---------- hook, ignore file and documents ----------
test('hook, log ignore and generated documents are enforced', () => {
  bad(/must register harness\/hooks\/tool-output-guard\.cjs/, (root) => rmSync(path.join(root, '.github/hooks/tool-output.json')));
  bad(/must register harness\/hooks\/tool-output-guard\.cjs/, tedit('.github/hooks/tool-output.json', (t) => t.replace('tool-output-guard.cjs', 'other.cjs')));
  bad(/timeoutSec must be 1 to 10/, tedit('.github/hooks/tool-output.json', (t) => t.replace('"timeoutSec": 10', '"timeoutSec": 60')));
  bad(/\.gitignore must ignore \.harness-logs/, tedit('.gitignore', (t) => t.replace('.harness-logs/', '')));
  bad(/missing docs\/harness\/MCP-SECURITY\.md/, (root) => rmSync(path.join(root, 'docs/harness/MCP-SECURITY.md')));
  bad(/generated tables are out of date/, tedit('docs/harness/TOOL-REGISTRY.md', (t) => t.replace('repo-git-read', 'repo-git-reed')));
  bad(/generated table markers are missing/, tedit('docs/harness/TOOL-REGISTRY.md', (t) => t.replace('<!-- generated:end -->', '')));
});

test('generated tables: complete, free of pipes inside cells, and idempotent under --write', () => {
  const reg = JSON.parse(readFileSync(path.join(repo, REG), 'utf8'));
  const md = renderTables(repo);
  for (const t of reg.tools) assert.ok(md.includes(`| ${t.id} |`), `${t.id} missing from the generated tables`);
  for (const s of Object.keys(reg.servers)) assert.ok(md.includes(`| ${s} |`), s);
  for (const row of md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('|---'))) {
    const cols = row.split(' | ').length;
    assert.ok(cols >= 5, `row has too few cells: ${row}`);
  }
  const header = md.split('\n').filter((l) => /^\| ID \|/.test(l));
  assert.equal(header.length, 3);
  const root = sandbox();
  const cli = () => spawnSync(process.execPath, [path.join(repo, 'harness/scripts/validate-tools.mjs'), '--root', root, '--write'], { encoding: 'utf8' });
  const before = readFileSync(path.join(root, 'docs/harness/TOOL-REGISTRY.md'), 'utf8');
  assert.equal(cli().status, 0);
  assert.equal(readFileSync(path.join(root, 'docs/harness/TOOL-REGISTRY.md'), 'utf8'), before, 'regenerating the committed tables changes nothing');
  jedit(REG, (r) => { find(r, 'repo-code-search').egress = 'changed egress text'; })(root);
  assert.ok(validateTools(root).some((e) => /out of date/.test(e.msg)));
  assert.equal(cli().status, 0);
  assert.deepEqual(validateTools(root), []);
});

test('helpers: grants resolve by alias, command substring and MCP name; server tool lists derive from enabled tools', () => {
  const pol = JSON.parse(readFileSync(path.join(repo, POL), 'utf8'));
  const reg = JSON.parse(readFileSync(path.join(repo, REG), 'utf8'));
  assert.deepEqual(grantedAgents({ grant: { type: 'alias', value: 'web' } }, pol), ['azure-platform']);
  assert.deepEqual(grantedAgents({ grant: { type: 'alias', value: 'execute' } }, pol).sort(), ['design-reviewer', 'qa-engineer']);
  assert.deepEqual(grantedAgents({ grant: { type: 'command', match: 'gh (pr|run)' } }, pol), ['qa-engineer']);
  assert.deepEqual(grantedAgents({ grant: { type: 'mcp', server: 'microsoft-learn', tool: 'microsoft_docs_fetch' } }, pol), ['azure-platform']);
  assert.deepEqual(grantedAgents({ grant: { type: 'none' } }, pol), []);
  assert.deepEqual(grantedAgents({}, pol), []);
  assert.equal(serverTools(reg, 'microsoft-learn').length, 3);
  assert.equal(serverTools(reg, 'greenfuel-tools').length, 13);
  assert.equal(serverTools(reg, 'azure-mcp').length, 0);
});
