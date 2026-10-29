import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, cpSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sessionHook, agentHook, outputHook, runHook, repo, LOG, engine, tmpDir } from './support/permission-fixtures.mjs';
import { spawnSync } from 'node:child_process';

// Regression tests for the gaps found by the capstone audit probes (docs/capstone/probes/). Every call is a simulated tool call evaluated by the real hook scripts.
const stopped = (r) => r.denied || r.ask;
const sh = (command) => ({ command });
const HOME = 'C:\\Users\\someone';

test('session: spelling tricks cannot hide a destructive Azure command (backtick, caret, empty quotes)', () => {
  for (const c of ['a`z group delete -n rg-x -y', 'a^z group delete -n rg-x', "a''z group delete -n rg-x", 'a`z   resource   delete --ids x', 'az` group delete -n rg-x']) {
    assert.ok(stopped(sessionHook('powershell', sh(c))), `stopped: ${c}`);
  }
});

test('session and named agents: decoding hidden commands is refused as shell indirection', () => {
  for (const c of ['echo YXogZ3JvdXAgZGVsZXRl | base64 -d | sh', 'base64 --decode payload.txt | bash', 'certutil -decode a.b64 a.ps1', 'Get-Content x | iex']) {
    assert.ok(stopped(sessionHook('powershell', sh(c))), `session: ${c}`);
  }
});

test('credential extraction through a command is refused in the session and for every shell-holding agent, and no approval can authorise it', () => {
  for (const c of ['gh auth token', 'gh auth status --show-token', 'gh auth status -t', 'git credential fill', 'cmdkey /list', 'docker login registry.example.invalid', 'npm token create']) {
    const s = sessionHook('powershell', sh(c)); assert.ok(stopped(s), `session: ${c}`);
    const a = agentHook('qa-engineer', 'powershell', sh(c)); assert.ok(a.denied, `qa-engineer: ${c}`);
  }
  assert.ok(engine.loadModel().perm.neverGrantable.includes('credential.extract'));
});

test('credential stores are secret paths for reads and writes by the view tool, by shell and for every agent (cloud CLIs, GitHub CLI, kube, docker, ssh, git config)', () => {
  const stores = [`${HOME}\\.azure\\msal_token_cache.json`, `${HOME}\\.azure\\accessTokens.json`, `${HOME}\\.azure\\azureProfile.json`, `${HOME}\\.config\\gh\\hosts.yml`, `${HOME}\\.kube\\config`,
    `${HOME}\\.docker\\config.json`, `${HOME}\\.aws\\credentials`, `${HOME}\\.ssh\\known_hosts`, `${HOME}\\.config\\gcloud\\credentials.db`, path.join(repo, '.git', 'config'), path.join(repo, '.git', 'hooks', 'pre-commit')];
  for (const p of stores) {
    assert.ok(stopped(sessionHook('view', { path: p })), `session view: ${p}`);
    for (const agent of ['qa-engineer', 'azure-platform', 'orchestrator', 'principal-architect']) assert.ok(agentHook(agent, 'view', { path: p }).denied, `${agent} view: ${p}`);
  }
  assert.ok(stopped(sessionHook('powershell', sh('Get-Content $env:USERPROFILE\\.azure\\msal_token_cache.json'))));
  assert.ok(stopped(sessionHook('powershell', sh('Get-Content $HOME\\.config\\gh\\hosts.yml'))));
  assert.ok(stopped(sessionHook('powershell', sh("[System.IO.File]::ReadAllText('C:\\Users\\x\\.azure\\accessTokens.json')"))));
  assert.ok(stopped(sessionHook('powershell', sh('Get-Content .azure\\msal_token_cache.json'))));
});

test('session: control-plane edits that previously passed without a prompt now need a human (settings, package scripts, memory, agents, workflows, devcontainer, git hooks)', () => {
  for (const rel of ['.vscode/settings.json', 'package.json', 'memory/decisions/DEC-0001.json', '.github/agents/orchestrator.agent.md', '.github/instructions/docs.instructions.md', '.github/CODEOWNERS', '.devcontainer/devcontainer.json', 'harness/lib/enforcement.cjs', 'harness/mcp/greenfuel-tools-server.mjs', '.gitignore', 'docs/approvals/AP-x.json']) {
    for (const tool of ['edit', 'create']) assert.ok(stopped(sessionHook(tool, { path: path.join(repo, rel), new_str: 'x', file_text: 'x' })), `${tool} ${rel}`);
  }
});

test('named agents cannot write the control plane, the evidence store, its logs or its manifest', () => {
  for (const agent of ['principal-architect', 'application-engineer', 'qa-engineer']) {
    for (const rel of ['.vscode/settings.json', 'package.json', 'memory/decisions/DEC-0001.json', '.github/agents/qa-engineer.agent.md', 'docs/evidence/records/EV-0001.json', 'docs/evidence/logs/EV-0001.log', 'docs/evidence/MANIFEST.json']) {
      assert.ok(agentHook(agent, 'edit', { path: path.join(repo, rel), new_str: 'x' }).denied, `${agent} edit ${rel}`);
    }
  }
});

test('ordinary work is still allowed: reads, searches, safe commands and edits inside docs for the session', () => {
  assert.equal(stopped(sessionHook('powershell', sh('git status'))), false);
  assert.equal(stopped(sessionHook('powershell', sh('node --test tests/x.test.mjs'))), false);
  assert.equal(stopped(sessionHook('view', { path: path.join(repo, 'README.md') })), false);
  assert.equal(stopped(sessionHook('edit', { path: path.join(repo, 'docs/state/NOTES.md'), new_str: 'x' })), false);
  assert.equal(stopped(sessionHook('powershell', sh('gh auth status'))), false, 'status without the token flag is not extraction');
  assert.equal(stopped(sessionHook('powershell', sh('git commit -m "note: the `x` flag"'))), false, 'a backtick in prose is not a command');
});

test('fail closed: a corrupt policy, a missing policy or an unparseable event blocks the call with exit code 2', () => {
  const dir = tmpDir('gf-fc-');
  const copy = (script) => spawnSync(process.execPath, [path.join(repo, 'harness/hooks', script), 'qa-engineer'], { input: 'not json', encoding: 'utf8', cwd: repo, env: { ...process.env, HARNESS_LOG_DIR: dir } });
  for (const script of ['policy-guard.cjs', 'agent-guard.cjs']) assert.equal(copy(script).status, 2, `${script} blocks garbage`);
  // an event with no tool name is a malformed call, not an allowed one
  assert.ok(runHook('policy-guard.cjs', [], { toolArgs: {} }).denied);
  assert.ok(runHook('agent-guard.cjs', ['qa-engineer'], { toolArgs: {} }).denied);
  assert.ok(runHook('agent-guard.cjs', ['no-such-agent'], { toolName: 'view', toolArgs: { path: 'README.md' } }).denied, 'unknown agent identity is denied');
});

test('fail closed: when the output sanitiser itself cannot run (its pattern file is corrupt), the raw result is withheld', () => {
  const root = tmpDir('gf-og-root-');
  for (const d of ['hooks', 'policy', 'tools', 'lib', 'approvals']) cpSync(path.join(repo, 'harness', d), path.join(root, 'harness', d), { recursive: true });
  writeFileSync(path.join(root, 'harness/policy/secret-patterns.json'), '{ this is not json');
  const r = spawnSync(process.execPath, [path.join(root, 'harness/hooks/tool-output-guard.cjs')], { input: JSON.stringify({ sessionId: 's', toolName: 'view', toolArgs: {}, toolResult: { resultType: 'success', textResultForLlm: 'RAW CONTENT THAT MUST NOT PASS' } }), encoding: 'utf8', cwd: root, env: { ...process.env, HARNESS_LOG_DIR: tmpDir('gf-og-') } });
  const out = r.stdout.trim() ? JSON.parse(r.stdout) : {};
  assert.match(out.modifiedResult?.textResultForLlm ?? '', /withheld/);
  assert.ok(!r.stdout.includes('RAW CONTENT'));
});

test('every hook run leaves an enforcement heartbeat with names and versions only, and every decision is a chained event without arguments', () => {
  const dir = tmpDir('gf-hb-');
  const env = { HARNESS_LOG_DIR: dir };
  const secretish = 'ghp_' + 'Q1w2E3r4T5'.repeat(4);
  runHook('policy-guard.cjs', [], { toolName: 'powershell', toolArgs: sh(`echo ${secretish}`) }, env);
  runHook('agent-guard.cjs', ['qa-engineer'], { toolName: 'view', toolArgs: { path: path.join(repo, 'README.md') } }, env);
  runHook('policy-guard.cjs', [], { toolName: 'view', toolArgs: { path: `${HOME}\\.azure\\msal_token_cache.json` } }, env);
  const hb = JSON.parse(readFileSync(path.join(dir, 'enforcement-heartbeat.json'), 'utf8'));
  assert.equal(hb.schema, 'greenfuel.enforcement-heartbeat/v1');
  assert.ok(Date.now() - Date.parse(hb.ts) < 60000);
  assert.deepEqual(Object.keys(hb.fingerprint).sort(), ['envMarkers', 'host', 'inContainer', 'node', 'platform', 'termProgram', 'termProgramVersion']);
  const file = path.join(dir, 'audit-events.jsonl');
  assert.ok(existsSync(file));
  const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 3, 'allow, allow and deny are all recorded, not only denials');
  assert.deepEqual(lines.map((l) => l.decision), ['allow', 'allow', 'deny']);
  assert.deepEqual(engine.verifyAuditChain(file).problems, []);
  const raw = readFileSync(file, 'utf8');
  assert.ok(!raw.includes(secretish) && !raw.includes('msal_token_cache') && !raw.includes('echo '), 'no arguments, paths of secrets or secret values are stored');
  assert.ok(lines.every((l) => /^[0-9a-f]{64}$/.test(l.argsSha256)));
  // tampering with one record is found by the chain check
  const tampered = raw.replace('"decision":"allow"', '"decision":"deny"');
  const copy = path.join(dir, 'tampered.jsonl'); writeFileSync(copy, tampered);
  assert.ok(engine.verifyAuditChain(copy).problems.length > 0);
});

void LOG; void outputHook;
