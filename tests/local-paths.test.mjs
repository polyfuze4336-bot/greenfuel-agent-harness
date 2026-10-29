import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { scrub, distinctiveUser } = require('../harness/lib/local-paths.cjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fwd = ROOT.replace(/\\/g, '/');

test('repository path in every form it appears in stack traces and test locations becomes <repo>', () => {
  for (const form of [ROOT, fwd, `file:///${encodeURI(fwd)}`, ROOT.toUpperCase(), ROOT.replace(/\\/g, '\\\\')]) {
    const out = scrub(`at TestContext.<anonymous> (${form}/tests/x.test.mjs:9:3)`);
    assert.ok(out.includes('<repo>'), `replaced: ${form}`);
    assert.ok(!out.toLowerCase().includes(fwd.toLowerCase()) && !out.toLowerCase().includes(ROOT.toLowerCase()), 'no repository path remains');
  }
});

test('home folder and account name are removed, and ordinary text is left alone', () => {
  const home = os.homedir();
  const out = scrub(`temp ${home}\\AppData\\Local\\Temp\\x and ${home.replace(/\\/g, '/')}/y`);
  assert.ok(!out.toLowerCase().includes(home.toLowerCase()) && !out.toLowerCase().includes(home.replace(/\\/g, '/').toLowerCase()));
  const user = distinctiveUser();
  if (user) assert.ok(!scrub(`owner ${user}`).toLowerCase().includes(user.toLowerCase()));
  assert.equal(scrub('ok 12 - nothing personal here'), 'ok 12 - nothing personal here');
  assert.equal(scrub('the test runner and root user'), 'the test runner and root user', 'generic words are not treated as a name');
});

test('a path of another checkout is removed when its root is supplied', () => {
  const other = path.join(os.tmpdir(), 'gf-other-checkout');
  assert.ok(!scrub(`at ${other}\\a.mjs`, [other]).includes('gf-other-checkout'));
});
