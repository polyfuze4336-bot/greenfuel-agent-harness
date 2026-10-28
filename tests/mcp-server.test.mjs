import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, resetForTests, TOOLS, cleanText, capOutput, callTool, MAX_OUTPUT_BYTES } from '../harness/mcp/greenfuel-tools-server.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(repo, 'harness', 'mcp', 'greenfuel-tools-server.mjs');
const init = () => handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
const call = (name, args, id = 9) => handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const text = (r) => r.result.content[0].text;

test('initialize negotiates a supported protocol and declares only tools', () => {
  resetForTests();
  const r = init();
  assert.equal(r.result.protocolVersion, '2025-06-18');
  assert.deepEqual(Object.keys(r.result.capabilities), ['tools']);
  assert.equal(r.result.serverInfo.name, 'greenfuel-tools');
  resetForTests();
  assert.equal(handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } }).result.protocolVersion, '2025-06-18');
});

test('tools cannot be listed or called before initialize', () => {
  resetForTests();
  assert.equal(handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }).error.code, -32002);
  assert.equal(call('get_task_state', {}).error.code, -32002);
});

test('discovery: every tool is declared read-only, closed-world and has a closed input schema', () => {
  resetForTests(); init();
  const { tools } = handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' }).result;
  assert.equal(tools.length, 13);
  assert.equal(new Set(tools.map((t) => t.name)).size, 13);
  for (const t of tools) {
    assert.equal(t.annotations.readOnlyHint, true, t.name);
    assert.equal(t.annotations.destructiveHint, false, t.name);
    assert.equal(t.annotations.openWorldHint, false, t.name);
    assert.equal(t.inputSchema.additionalProperties, false, t.name);
    assert.ok(t.description.length > 20, t.name);
    assert.equal('util' in t, false, 'internal field leaked');
  }
});

test('the server source has no write, network or shell capability beyond fixed git log', () => {
  const src = execFileSync(process.execPath, ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(SERVER)}, 'utf8'))`], { encoding: 'utf8' });
  for (const banned of [/writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync|renameSync|copyFileSync/, /\bfetch\(|node:http|node:https|node:net|node:dgram|XMLHttpRequest/, /\bexec\(|execSync|spawn\(|spawnSync|fork\(/, /\beval\(|new Function/]) assert.doesNotMatch(src, banned, String(banned));
  assert.equal((src.match(/execFileSync\(/g) ?? []).length, 1);
  assert.match(src, /execFileSync\('git', \['log', '--oneline', '-n', String\(limit\)\]/);
});

test('a successful safe invocation returns data and no error', () => {
  resetForTests(); init();
  const r = call('trace_requirement', { id: 'FR-009' });
  assert.equal(r.result.isError, false);
  const out = JSON.parse(text(r));
  assert.equal(out.found, true);
  assert.equal(out.id, 'FR-009');
  assert.match(out.requirement, /methodology version/i);
});

test('an unknown requirement is reported as not found, not invented', () => {
  resetForTests(); init();
  assert.deepEqual(JSON.parse(text(call('trace_requirement', { id: 'FR-999' }))), { id: 'FR-999', found: false });
});

test('argument validation: unknown properties, bad ids, bad limits and traversal paths are rejected', () => {
  resetForTests(); init();
  const bad = [
    ['trace_requirement', { id: 'not-an-id' }], ['trace_requirement', {}], ['trace_requirement', { id: 'FR-009', extra: 1 }],
    ['get_task_state', { anything: 1 }], ['get_implementation_history', { limit: 0 }], ['get_implementation_history', { limit: 51 }],
    ['get_implementation_history', { limit: '5' }], ['get_implementation_history', { limit: 1.5 }],
    ['validate_sovereignty', { path: '../../etc/passwd' }], ['validate_sovereignty', { path: 'docs/specs/../../harness' }],
    ['validate_sovereignty', { path: '/etc/passwd' }], ['validate_sovereignty', { path: 'C:\\Windows\\win.ini' }],
    ['validate_sovereignty', { path: 'harness/policy/agent-policy.json' }], ['validate_sovereignty', { path: 'docs/specs/x;rm -rf' }],
    ['validate_sovereignty', { path: 5 }], ['validate_requirements', { path: 'docs/specs' }],
  ];
  for (const [name, args] of bad) {
    const r = call(name, args);
    assert.equal(r.result?.isError, true, `${name} ${JSON.stringify(args)} should be an error`);
  }
  assert.equal(call('trace_requirement', 'FR-009').result.isError, true);
  assert.equal(call('trace_requirement', ['FR-009']).result.isError, true);
});

test('an unknown tool and an unknown method are protocol errors', () => {
  resetForTests(); init();
  assert.equal(call('delete_everything', {}).error.code, -32602);
  assert.equal(handle({ jsonrpc: '2.0', id: 5, method: 'resources/list' }).error.code, -32601);
  assert.equal(handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: {} }).error.code, -32602);
});

test('malformed messages: batch, missing version, notification without answer', () => {
  resetForTests(); init();
  assert.equal(handle([{ jsonrpc: '2.0', id: 1, method: 'ping' }]).error.code, -32600);
  assert.equal(handle({ id: 1, method: 'ping' }).error.code, -32600);
  assert.equal(handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.deepEqual(handle({ jsonrpc: '2.0', id: 7, method: 'ping' }).result, {});
});

test('output is cleaned of invisible characters and capped', () => {
  assert.equal(cleanText('a\u200Bb\u202Ec\u0000d\u{E0041}e'), 'abcde');
  assert.equal(cleanText('keep\nnewlines\tand tabs'), 'keep\nnewlines\tand tabs');
  const big = 'x'.repeat(MAX_OUTPUT_BYTES * 2);
  const { text: capped, truncated } = capOutput(big);
  assert.equal(truncated, true);
  assert.ok(Buffer.byteLength(capped) <= MAX_OUTPUT_BYTES);
  assert.match(capped, /truncated by greenfuel-tools/);
  const multi = capOutput('é'.repeat(MAX_OUTPUT_BYTES));
  assert.ok(Buffer.byteLength(multi.text) <= MAX_OUTPUT_BYTES);
});

test('every tool runs and returns well-formed JSON text within the cap', () => {
  resetForTests(); init();
  for (const t of TOOLS) {
    const r = call(t.name, t.name === 'trace_requirement' ? { id: 'SEC-001' } : {});
    assert.equal(r.result.isError, false, `${t.name}: ${r.result?.content?.[0]?.text}`);
    assert.ok(Buffer.byteLength(text(r)) <= MAX_OUTPUT_BYTES, t.name);
    JSON.parse(text(r).replace(/\n\[output truncated.*$/s, ''));
  }
});

test('deployment readiness reports blockers and never claims readiness today', () => {
  const r = callTool('validate_deployment_readiness', {});
  assert.equal(r.status, 'NOT-READY');
  assert.ok(r.errors.some((e) => /Phase 0/.test(e.msg)));
  assert.ok(r.notes.some((n) => /not an approval|authorises/.test(n)));
});

test('empty specifications are reported as EMPTY, never PASS', () => {
  for (const n of ['validate_evidence_lineage', 'validate_emissions_methods', 'validate_certificate_integrity']) {
    const r = callTool(n, {});
    assert.equal(r.status, 'EMPTY', n);
    assert.equal(r.checked, 0, n);
  }
});

test('process level: stdout carries protocol messages only; stderr carries metadata without arguments', async () => {
  const child = spawn(process.execPath, [SERVER], { cwd: os_tmp(), stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const lines = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'trace_requirement', arguments: { id: 'FR-009' } } },
  ].map((m) => JSON.stringify(m));
  child.stdin.write(`${lines.join('\n')}\nthis is not json\n`);
  child.stdin.write(`${'x'.repeat(70000)}\n`);
  child.stdin.end();
  await new Promise((resolve) => child.on('close', resolve));
  const msgs = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(msgs.map((m) => m.id ?? null), [1, 2, 3, null, null]);
  assert.equal(msgs[3].error.code, -32700);
  assert.equal(msgs[4].error.code, -32600);
  assert.ok(msgs.every((m) => m.jsonrpc === '2.0'));
  const meta = JSON.parse(err.trim().split('\n')[0]);
  assert.equal(meta.tool, 'trace_requirement');
  assert.doesNotMatch(err, /FR-009/);
});

function os_tmp() { return process.env.TEMP ?? process.env.TMPDIR ?? '/tmp'; }
