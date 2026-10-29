import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpDir, runHook, repo } from './support/permission-fixtures.mjs';

const require = createRequire(import.meta.url);
const enforcement = require('../harness/lib/enforcement.cjs');
const { handle, resetForTests, attest } = await import('../harness/mcp/greenfuel-tools-server.mjs');

const withEnv = (vars, fn) => {
  const prev = {}; for (const [k, v] of Object.entries(vars)) { prev[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const init = () => handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
const call = (name, args = {}) => handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } });
const beat = (dir, ts) => { mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, 'enforcement-heartbeat.json'), `${JSON.stringify({ schema: enforcement.SCHEMA, ts: ts.toISOString(), hook: 'policy-guard', agent: null, session: 's', phase: 0, fingerprint: {} })}\n`); };

test('attestation: no heartbeat, a stale heartbeat, a future heartbeat and a malformed heartbeat all refuse the tool call', () => {
  const dir = tmpDir('gf-att-');
  withEnv({ HARNESS_LOG_DIR: dir, HARNESS_ENFORCEMENT_ATTESTATION: undefined }, () => {
    resetForTests(); init();
    const refused = (label) => { const r = call('get_accepted_decisions'); assert.equal(r.result.isError, true, label); assert.match(r.result.content[0].text, /FAIL-CLOSED.*enforcement is not attested/s, label); };
    refused('no heartbeat at all');
    beat(dir, new Date(Date.now() - 10 * 60000)); refused('stale heartbeat');
    beat(dir, new Date(Date.now() + 10 * 60000)); refused('heartbeat dated in the future');
    writeFileSync(path.join(dir, 'enforcement-heartbeat.json'), '{ nope'); refused('malformed heartbeat');
    writeFileSync(path.join(dir, 'enforcement-heartbeat.json'), JSON.stringify({ schema: 'something-else', ts: new Date().toISOString() })); refused('wrong schema');
  });
});

test('attestation: a fresh heartbeat lets the read-only tool run, and discovery is never gated', () => {
  const dir = tmpDir('gf-att-');
  withEnv({ HARNESS_LOG_DIR: dir, HARNESS_ENFORCEMENT_ATTESTATION: undefined }, () => {
    resetForTests(); init();
    assert.ok(handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }).result.tools.length > 5, 'tools/list works without a heartbeat');
    beat(dir, new Date());
    const r = call('get_accepted_decisions');
    assert.equal(r.result.isError, false);
    assert.equal(attest().ok, true);
  });
});

test('attestation: switching it off is a launch-environment decision that is visible in attest(), and anything but exactly "off" keeps it required', () => {
  const dir = tmpDir('gf-att-');
  withEnv({ HARNESS_LOG_DIR: dir, HARNESS_ENFORCEMENT_ATTESTATION: 'off' }, () => assert.deepEqual(attest(), { ok: true, mode: 'off' }));
  for (const v of ['0', 'false', 'OFFF', '', 'no']) withEnv({ HARNESS_LOG_DIR: dir, HARNESS_ENFORCEMENT_ATTESTATION: v }, () => assert.equal(attest().ok, false, `value '${v}' does not switch it off`));
});

test('a real hook run produces a heartbeat that the server accepts, end to end over stdio', async () => {
  const dir = tmpDir('gf-att-');
  runHook('policy-guard.cjs', [], { toolName: 'view', toolArgs: { path: path.join(repo, 'README.md') } }, { HARNESS_LOG_DIR: dir });
  const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'harness', 'mcp', 'greenfuel-tools-server.mjs');
  const talk = (env, calls) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { cwd: repo, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', () => resolve(out.trim().split('\n').map((l) => JSON.parse(l))));
    for (const c of calls) child.stdin.write(`${JSON.stringify(c)}\n`);
    child.stdin.end();
  });
  const msgs = [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_accepted_decisions', arguments: {} } }];
  const good = await talk({ HARNESS_LOG_DIR: dir, HARNESS_ENFORCEMENT_ATTESTATION: '' }, msgs);
  assert.equal(good.find((m) => m.id === 2).result.isError, false);
  const emptyDir = tmpDir('gf-att-empty-');
  const bad = await talk({ HARNESS_LOG_DIR: emptyDir, HARNESS_ENFORCEMENT_ATTESTATION: '' }, msgs);
  assert.equal(bad.find((m) => m.id === 2).result.isError, true);
  assert.match(bad.find((m) => m.id === 2).result.content[0].text, /not attested/);
});

test('the heartbeat helper never throws and never stores arguments', () => {
  const dir = tmpDir('gf-att-');
  withEnv({ HARNESS_LOG_DIR: dir }, () => {
    assert.equal(enforcement.writeHeartbeat({ hook: 'x', sessionId: 'a'.repeat(500), phase: 0 }), true);
    const r = enforcement.readHeartbeat();
    assert.equal(r.ok, true);
    assert.ok(r.hb.session.length <= 64);
    assert.deepEqual(Object.keys(r.hb).sort(), ['agent', 'fingerprint', 'hook', 'phase', 'schema', 'session', 'ts']);
  });
  const asFile = path.join(dir, 'a-file'); writeFileSync(asFile, 'x');
  withEnv({ HARNESS_LOG_DIR: path.join(asFile, 'cannot-be-a-folder') }, () => assert.equal(enforcement.writeHeartbeat({ hook: 'x' }), false));
});
