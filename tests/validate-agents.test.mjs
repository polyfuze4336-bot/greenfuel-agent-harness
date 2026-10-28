import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAgents, parseAgent } from '../harness/scripts/validate-agents.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POL = 'harness/policy/agent-policy.json';
const agent = (n) => `.github/agents/${n}.agent.md`;

function mutated(changes, after) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gf-agents-'));
  cpSync(repo, dir, { recursive: true, filter: (s) => !/[\\/](\.git|node_modules|\.harness-work|\.harness-toolchain|escape-link)([\\/]|$)/.test(s) });
  try {
    for (const [file, fn] of Object.entries(changes)) {
      const p = path.join(dir, file);
      const before = readFileSync(p, 'utf8');
      const next = fn(before);
      assert.notEqual(next, before, `mutation of ${file} changed nothing`);
      writeFileSync(p, next);
    }
    if (after) after(dir);
    return validateAgents(dir).map((e) => e.msg);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const has = (msgs, re) => assert.ok(msgs.some((m) => re.test(m)), `expected a message matching ${re}; got:\n${msgs.join('\n') || '(none)'}`);
const policyEdit = (fn) => (t) => { const p = JSON.parse(t); fn(p); return JSON.stringify(p, null, 2); };

test('the real agents and policy validate cleanly', () => assert.deepEqual(validateAgents(repo), []));

test('parser reads inline lists, hook blocks and sections', () => {
  const p = parseAgent('---\nname: x\ntools: [\'read\']\nhooks:\n  preToolUse:\n    - type: command\n      command: node a b\n      timeoutSec: 5\n---\n## Mission\nhello world\n');
  assert.deepEqual(p.keys, ['name', 'tools', 'hooks']);
  assert.deepEqual(p.hookEvents, ['preToolUse']);
  assert.deepEqual(p.hookCommands, ['node a b']);
  assert.equal(p.sections.get('Mission').trim(), 'hello world');
});

test('a planner given the edit tool is rejected', () => {
  const m = mutated({ [agent('security-reviewer')]: (t) => t.replace("tools: ['read', 'search',", "tools: ['read', 'search', 'edit',") });
  has(m, /security-reviewer\.agent\.md: tools .* differ from policy/);
});

test('policy that gives a planner execute is rejected', () => {
  const m = mutated({ [POL]: policyEdit((p) => { p.agents['architecture-critic'].tools.push('execute'); p.agents['architecture-critic'].commands = ['^npm test$']; }) });
  has(m, /architecture-critic: tool 'execute' is not allowed for class planner/);
  has(m, /planners must not edit, execute or use the web/);
});

test('omitting tools (implicit all tools) is rejected', () => {
  has(mutated({ [agent('sre-engineer')]: (t) => t.replace(/^tools:.*\r?\n/m, '') }), /tools must be an explicit inline list/);
});

test('unrecognised tool alias is rejected', () => {
  has(mutated({ [POL]: policyEdit((p) => { p.agents['sre-engineer'].tools.push('superuser'); }) }), /unknown tool alias 'superuser'/);
});

test('specialist given delegation is rejected on both sides', () => {
  const m = mutated({
    [agent('data-engineer')]: (t) => t.replace("tools: ['read', 'search', 'edit',", "tools: ['read', 'search', 'edit', 'agent',").replace('user-invocable: true', "agents: ['qa-engineer']\nuser-invocable: true"),
  });
  has(m, /only the orchestrator may declare agents/);
  has(m, /data-engineer\.agent\.md: tools/);
});

test('orchestrator agents list must equal the policy list', () => {
  has(mutated({ [agent('orchestrator')]: (t) => t.replace("'architecture-critic', ", '') }), /orchestrator\.agent\.md: agents .* differ from policy/);
});

test('delegation cycles and self-delegation are rejected', () => {
  const m = mutated({ [POL]: policyEdit((p) => { p.agents['qa-engineer'].delegatesTo = ['orchestrator']; p.agents.orchestrator.delegatesTo.push('orchestrator'); }) });
  has(m, /must not delegate to the orchestrator/);
  has(m, /delegates to itself/);
  has(m, /delegation graph has a cycle/);
});

test('dependsOn cycles are rejected', () => {
  has(mutated({ [POL]: policyEdit((p) => { p.agents['maritime-domain'].dependsOn = ['principal-architect']; }) }), /dependsOn graph has a cycle/);
});

test('orchestrator must not be invocable by other agents', () => {
  has(mutated({ [agent('orchestrator')]: (t) => t.replace('disable-model-invocation: true', 'disable-model-invocation: false') }), /disable-model-invocation is false but policy says true/);
});

test('wrong agent name in the hook is rejected', () => {
  has(mutated({ [agent('security-reviewer')]: (t) => t.replace('agent-guard.cjs security-reviewer', 'agent-guard.cjs orchestrator') }), /expected 'security-reviewer'/);
});

test('missing hook, extra hook command and long timeout are rejected', () => {
  has(mutated({ [agent('qa-engineer')]: (t) => t.replace(/hooks:[\s\S]*?timeoutSec: 10\r?\n/, '') }), /hooks must define exactly preToolUse/);
  has(mutated({ [agent('qa-engineer')]: (t) => t.replace('timeoutSec: 10', 'timeoutSec: 300') }), /timeoutSec must be 1 to 30/);
});

test('unsupported and forbidden frontmatter keys are rejected', () => {
  has(mutated({ [agent('qa-engineer')]: (t) => t.replace('user-invocable: true', 'user-invocable: true\nhandoffs: x') }), /'handoffs' is not used/);
  has(mutated({ [agent('qa-engineer')]: (t) => t.replace('user-invocable: true', 'user-invocable: true\nmodel: gpt-x') }), /'model' is not used/);
  has(mutated({ [agent('qa-engineer')]: (t) => t.replace('user-invocable: true', 'user-invocable: true\nsparkle: yes') }), /'sparkle' is not on the supported list/);
});

test('name must match the file; missing required section is rejected', () => {
  has(mutated({ [agent('qa-engineer')]: (t) => t.replace('name: qa-engineer', 'name: qa') }), /name must equal the file name/);
  has(mutated({ [agent('qa-engineer')]: (t) => t.replace('## Escalation', '## Notes') }), /missing section '## Escalation'/);
});

test('profiles must match policy and exist in the manifest', () => {
  has(mutated({ [agent('qa-engineer')]: (t) => t.replace('Profiles: `assurance-review`', 'Profiles: `baseline-maintenance`') }), /Profiles .* differ from policy/);
  has(mutated({ [POL]: policyEdit((p) => { p.agents['qa-engineer'].profiles = ['no-such-profile']; }) }), /profile 'no-such-profile' does not exist/);
});

test('unknown requirement, decision and hard-constraint ids are rejected', () => {
  const m = mutated({ [agent('data-engineer')]: (t) => t.replace('(HC-05, HC-06)', '(HC-05, HC-99, SEC-999, D-998)') });
  has(m, /unknown hard constraint HC-99/);
  has(m, /unknown requirement SEC-999/);
  has(m, /unknown decision D-998/);
});

test('a file in .github/agents without the agent suffix is rejected', () => {
  has(mutated({ [agent('qa-engineer')]: (t) => t + '\n' }, (dir) => writeFileSync(path.join(dir, '.github/agents/NOTES.md'), '# notes')), /any \.md file in this folder is loaded as an agent/);
});

test('policy and files must match in both directions', () => {
  has(mutated({ [agent('qa-engineer')]: (t) => t + '\n' }, (dir) => renameSync(path.join(dir, agent('sre-engineer')), path.join(dir, agent('sre-engineer-copy')))), /sre-engineer\.agent\.md is missing/);
  has(mutated({ [POL]: policyEdit((p) => { delete p.agents['sre-engineer']; }) }), /sre-engineer\.agent\.md has no entry/);
});

test('write scopes: control plane, overlap and separation of duties', () => {
  has(mutated({ [POL]: policyEdit((p) => { p.agents['azure-platform'].writes.push('.github/agents/**'); }) }), /touches the control plane/);
  has(mutated({ [POL]: policyEdit((p) => { p.agents['azure-platform'].writes.push('docs/design/data/**'); }) }), /write scopes overlap/);
  has(mutated({ [POL]: policyEdit((p) => { p.agents['design-reviewer'].writes.push('docs/adr/**'); }) }), /separation of duties/);
  has(mutated({ [POL]: policyEdit((p) => { p.agents['azure-platform'].writes.push('docs/**'); }) }), /write scopes overlap/);
});

test('an edit tool without a scope, and a scope without the tool, are rejected', () => {
  has(mutated({ [POL]: policyEdit((p) => { p.agents['data-engineer'].writes = []; }) }), /'edit' tool and a phase-0 write scope must go together/);
});

test('command allow-lists that permit dangerous commands are rejected', () => {
  has(mutated({ [POL]: policyEdit((p) => { p.agents['qa-engineer'].commands.push('^npm .*$'); }) }), /permits a dangerous command/);
  has(mutated({ [POL]: policyEdit((p) => { p.agents['qa-engineer'].commands.push('npm test'); }) }), /must be anchored/);
  has(mutated({ [POL]: policyEdit((p) => { p.agents['qa-engineer'].commands = ['^git .*$']; }) }), /permits a dangerous command/);
});

test('phase 0: an existing phase-1 product folder is rejected, while the marked infrastructure scaffold is the one allowed exception (ADR 0014)', () => {
  has(mutated({ [agent('qa-engineer')]: (t) => t + '\n' }, (dir) => { rmSync(path.join(dir, 'infra'), { recursive: true, force: true }); cpSync(path.join(dir, 'docs'), path.join(dir, 'infra'), { recursive: true }); }), /phase-1 path 'infra\/' exists/);
  assert.deepEqual(mutated({ [agent('qa-engineer')]: (t) => t + '\n' }, () => {}).filter((m) => /phase-1 path/.test(m)), [], 'the committed scaffold is accepted');
  has(mutated({ [agent('qa-engineer')]: (t) => t + '\n' }, (dir) => { writeFileSync(path.join(dir, 'infra/main.bicep'), 'targetScope = \'resourceGroup\'\n'); }), /phase-1 path 'infra\/' exists/);
});

test('missing hook type and open-ended command patterns are rejected', () => {
  has(mutated({ [agent('qa-engineer')]: (t) => t.replace(/ {4}- type: command\r?\n {6}command:/, '    - command:') }), /every hook needs 'type: command'/);
  has(mutated({ [POL]: policyEdit((p) => { p.agents['qa-engineer'].commands.push('^node harness/scripts/foo\\.mjs( .*)?$'); }) }), /open-ended '\.\*'/);
});

test('instruction files: applyTo must exist and be narrow', () => {
  has(mutated({ '.github/instructions/data.instructions.md': (t) => t.replace(/applyTo: .*/, 'applyTo: "**"') }), /would load these rules for every file/);
  has(mutated({ '.github/instructions/data.instructions.md': (t) => t.replace(/applyTo: .*\r?\n/, '') }), /applyTo is required/);
});
