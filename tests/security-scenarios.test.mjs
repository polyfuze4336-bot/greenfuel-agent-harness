// Coverage guard for the ten required hardening scenarios: each must have executable tests, in the named files, and each test title must carry its ST id.
// This guards against a scenario silently losing its tests. It does not prove the tests are sufficient; see docs/target-architecture/13-SECURITY-REVIEW.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
export const SCENARIOS = {
  'ST-01': { name: 'certificate tampering', file: 'certificate-lifecycle-contract.test.mjs', min: 4 },
  'ST-02': { name: 'sensor replay', file: 'custody-chain-contract.test.mjs', min: 3 },
  'ST-03': { name: 'duplicate transfer', file: 'custody-chain-contract.test.mjs', min: 2 },
  'ST-04': { name: 'clock manipulation', file: 'custody-chain-contract.test.mjs', min: 4 },
  'ST-05': { name: 'forged event sequence', key: 'forged sequence', file: 'custody-chain-contract.test.mjs', min: 5 },
  'ST-06': { name: 'cross-shipowner access', file: 'tenant-boundary-contract.test.mjs', min: 6 },
  'ST-07': { name: 'unauthorized methodology change', file: 'methodology-registry-contract.test.mjs', min: 4 },
  'ST-08': { name: 'missing feedstock evidence', file: 'certificate-lifecycle-contract.test.mjs', min: 2 },
  'ST-09': { name: 'malicious document prompt injection', key: 'prompt injection', file: 'tenant-boundary-contract.test.mjs', min: 4 },
  'ST-10': { name: 'unauthorized filing submission', file: 'certificate-lifecycle-contract.test.mjs', min: 5 },
};

for (const [id, s] of Object.entries(SCENARIOS)) {
  test(`${id} ${s.name}: has at least ${s.min} executable tests in ${s.file}`, () => {
    const text = fs.readFileSync(path.join(dir, s.file), 'utf8');
    assert.ok(!/\btest\.(skip|todo|only)\b|\{\s*(skip|todo|only)\s*:/.test(text), `${s.file} must not skip, todo or isolate tests`);
    // Split into test blocks so a title with an empty or assertion-free body does not count.
    const blocks = text.split(/^test\(/m).slice(1).map((b) => ({ title: (b.match(/^\s*(['"`])(.*?)\1\s*,/) ?? [])[2] ?? '', body: b }));
    const mine = blocks.filter((b) => b.title.startsWith(`${id} `));
    assert.ok(mine.length >= s.min, `${id} has ${mine.length} tests, expected at least ${s.min}`);
    assert.ok(mine.every((b) => b.title.toLowerCase().startsWith(`${id.toLowerCase()} ${s.key ?? s.name}`)), `${id} titles must start with the scenario name`);
    const empty = mine.filter((b) => !/assert\.\w+\(/.test(b.body)).map((b) => b.title);
    assert.deepEqual(empty, [], `${id}: scenario tests without any assertion`);
  });
}
