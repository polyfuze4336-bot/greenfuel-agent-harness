import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { matchMcp, forms, norm } = require('../harness/hooks/mcp-names.cjs');
const { evaluate, loadPolicy } = require('../harness/hooks/policy-guard.cjs');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(readFileSync(path.join(repo, 'harness/tools/tool-registry.json'), 'utf8'));
const policy = loadPolicy();
const verdict = (toolName, toolArgs = {}) => evaluate({ toolName, toolArgs, cwd: repo }, policy);

test('forms: a small explicit set of spellings, lower case', () => {
  const f = forms('greenfuel-tools', 'trace_requirement');
  for (const ok of ['greenfuel-tools-trace_requirement', 'greenfuel_tools_trace_requirement', 'greenfuel-tools/trace_requirement', 'mcp_greenfuel_tools_trace_requirement']) assert.ok(f.includes(ok), ok);
  for (const no of ['greenfueltools-trace_requirement', 'greenfuel-tools-trace-requirement', 'greenfuel-tools trace_requirement']) assert.ok(!f.includes(no), no);
  assert.ok(f.every((x) => x === x.toLowerCase()));
});

test('matchMcp: exact registered tools resolve; lookalikes and unlisted tools resolve to a server but never to a tool', () => {
  assert.deepEqual(matchMcp('greenfuel-tools-trace_requirement', registry), { server: 'greenfuel-tools', exact: { server: 'greenfuel-tools', tool: 'trace_requirement' }, builtIn: false });
  assert.equal(matchMcp('MICROSOFT-LEARN-microsoft_docs_fetch', registry).exact?.tool, 'microsoft_docs_fetch');
  const look = matchMcp('greenfueltools-trace_requirement', registry);
  assert.equal(look.server, 'greenfuel-tools');
  assert.equal(look.exact, null);
  assert.equal(matchMcp('greenfuel-tools-delete_all', registry).exact, null);
  assert.equal(matchMcp('github-mcp-server-get_file_contents', registry).builtIn, true);
  assert.equal(matchMcp('view', registry).server, null);
  assert.equal(matchMcp('web_fetch', registry).server, null);
  assert.equal(norm('Greenfuel-Tools_x'), 'greenfueltoolsx');
});

test('registered server names do not collide after normalisation', () => {
  const names = [...new Set([...Object.keys(registry.servers), ...registry.builtInServers])];
  assert.equal(new Set(names.map(norm)).size, names.length);
});

test('repository-wide guard: an unlisted tool of an enabled server is refused in any session', () => {
  assert.equal(verdict('greenfuel-tools-trace_requirement', { id: 'FR-009' }), null);
  assert.equal(verdict('microsoft-learn-microsoft_docs_search', { query: 'x' }), null);
  for (const bad of ['microsoft-learn-microsoft_docs_delete', 'greenfuel-tools-delete_everything', 'greenfueltools-trace_requirement', 'microsoft-learn-microsoft_docs_search2']) {
    const v = verdict(bad);
    assert.equal(v?.id, 'MCP-UNLISTED', bad);
    assert.equal(v.decision, 'deny');
  }
});

test('repository-wide guard: built-in and pending servers are not blocked by this rule, so normal use of them is unaffected', () => {
  assert.equal(verdict('github-mcp-server-get_file_contents', { owner: 'a', repo: 'b', path: 'README.md' }), null);
  assert.equal(verdict('Azure-MCP-group_list', {}), null);
  assert.equal(verdict('view', { path: 'README.md' }), null);
});
