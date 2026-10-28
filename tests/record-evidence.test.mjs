import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { record } from '../harness/scripts/record-evidence.mjs';

const require = createRequire(import.meta.url);
const { evaluate, loadPolicy } = require('../harness/hooks/policy-guard.cjs');

function tmp(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gf-evidence-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('records exit code, hash and tail of a passing command', () => tmp((outDir) => {
  const { rec, outPath } = record({ id: 'EV-0001', claim: 'prints ok', cmd: [process.execPath, '-e', 'console.log("ok")'], outDir });
  assert.equal(rec.exitCode, 0);
  assert.equal(rec.outputTail.trim(), 'ok');
  assert.match(rec.outputSha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.parse(readFileSync(outPath, 'utf8')).claim, 'prints ok');
}));

test('records a failing command as failure, not as success', () => tmp((outDir) => {
  const { rec } = record({ id: 'EV-0002', claim: 'exits 3', cmd: [process.execPath, '-e', 'process.exit(3)'], outDir });
  assert.equal(rec.exitCode, 3);
}));

test('redacts secret-shaped output', () => tmp((outDir) => {
  const { rec } = record({ id: 'EV-0003', claim: 'redaction', cmd: [process.execPath, '-e', 'console.log("token=abcdef123456")'], outDir });
  assert.ok(!rec.outputTail.includes('abcdef123456'));
  assert.ok(rec.outputTail.includes('[REDACTED]'));
}));

test('refuses to overwrite an existing record', () => tmp((outDir) => {
  const args = { id: 'EV-0004', claim: 'x', cmd: [process.execPath, '-e', '0'], outDir };
  record(args);
  assert.throws(() => record(args), /already exists/);
}));

test('refuses commands the policy denies, and writes nothing', () => tmp((outDir) => {
  assert.throws(() => record({ id: 'EV-0005', claim: 'x', cmd: ['azd', 'up'], outDir }), /Refusing to run/);
  assert.equal(existsSync(path.join(outDir, 'EV-0005.json')), false);
}));

test('policy allows the recorder invocation itself', () => {
  const cmd = 'node harness/scripts/record-evidence.mjs --id EV-0001 --claim "Harness tests pass" -- node --test';
  assert.equal(evaluate({ toolName: 'powershell', toolArgs: { command: cmd }, cwd: 'C:/repo' }, loadPolicy()), null);
});
