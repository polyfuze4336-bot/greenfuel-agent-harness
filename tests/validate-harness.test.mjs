import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, frontmatter } from '../harness/scripts/validate-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sandbox(mutate) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gf-harness-'));
  cpSync(repo, dir, { recursive: true, filter: (s) => !/[\\/](\.git|node_modules|escape-link)([\\/]|$)/.test(s) });
  try { return mutate(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const checks = (errors) => errors.map((e) => e.check);

test('real repository validates cleanly', () => {
  assert.deepEqual(validate(repo), []);
});

test('frontmatter parser reads simple keys and rejects missing block', () => {
  assert.equal(frontmatter('---\nname: a\ndescription: b c\n---\nbody').description, 'b c');
  assert.equal(frontmatter('no block'), null);
});

test('phase 0 rejects application code', () => sandbox((dir) => {
  mkdirSync(path.join(dir, 'src'));
  assert.ok(checks(validate(dir)).includes('phase-gate'));
}));

test('phase 0 rejects IaC files anywhere', () => sandbox((dir) => {
  writeFileSync(path.join(dir, 'docs', 'x.bicep'), 'param a string');
  assert.ok(checks(validate(dir)).includes('phase-gate'));
}));

test('agent without explicit tools is rejected', () => sandbox((dir) => {
  writeFileSync(path.join(dir, '.github', 'agents', 'bad.agent.md'), '---\nname: bad\ndescription: x\n---\nbody');
  assert.ok(checks(validate(dir)).includes('agents'));
}));

test('broken markdown link is rejected', () => sandbox((dir) => {
  writeFileSync(path.join(dir, 'docs', 'broken.md'), '[x](./nope.md)');
  assert.ok(checks(validate(dir)).includes('links'));
}));

test('links inside captured delegate replies are not checked, but links in other run files are', () => sandbox((dir) => {
  const run = path.join(dir, 'docs', 'state', 'runs', 'RUN-0123456789');
  mkdirSync(path.join(run, 'results'), { recursive: true });
  writeFileSync(path.join(run, 'results', 'T1-a1.md'), '[model wrote this](./nope.md)');
  assert.equal(checks(validate(dir)).includes('links'), false);
  writeFileSync(path.join(run, 'NOTES.md'), '[x](./nope.md)');
  assert.ok(checks(validate(dir)).includes('links'));
}));

test('secret-like content is rejected', () => sandbox((dir) => {
  writeFileSync(path.join(dir, 'docs', 'leak.md'), 'token ghp_' + 'a'.repeat(36));
  assert.ok(checks(validate(dir)).includes('secrets'));
}));

test('unpinned workflow action is rejected', () => sandbox((dir) => {
  writeFileSync(path.join(dir, '.github', 'workflows', 'bad.yml'), 'permissions:\n  contents: read\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n');
  assert.ok(checks(validate(dir)).includes('workflows'));
}));

test('runtime dependencies are rejected', () => sandbox((dir) => {
  const p = path.join(dir, 'package.json');
  const pkg = JSON.parse(readFileSync(p, 'utf8'));
  writeFileSync(p, JSON.stringify({ ...pkg, dependencies: { left: '1.0.0' } }));
  assert.ok(checks(validate(dir)).includes('dependencies'));
}));

test('missing pillar in architecture doc is rejected', () => sandbox((dir) => {
  const p = path.join(dir, 'docs', 'harness', 'HARNESS-ARCHITECTURE.md');
  writeFileSync(p, readFileSync(p, 'utf8').replaceAll('Memory & Resumability', 'Memory'));
  assert.ok(checks(validate(dir)).includes('pillars'));
}));

test('missing hook script is rejected', () => sandbox((dir) => {
  rmSync(path.join(dir, 'harness', 'hooks', 'policy-guard.cjs'));
  assert.ok(checks(validate(dir)).includes('hooks'));
}));
