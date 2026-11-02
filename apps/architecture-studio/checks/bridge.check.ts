import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { requireHarness } from '../src/lib/harness-bridge.ts';
import { GitRepositoryAdapter } from '../src/lib/repo/git.ts';

const root = GitRepositoryAdapter.findRoot(process.cwd());

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('the harness bridge (B4)', () => {
  it('loads the harness approval rules and canonical JSON from the repository', () => {
    const reg = requireHarness<{ canonical(v: unknown): string; sha256(s: string): string }>(root, 'approvals', 'registry.cjs');
    assert.equal(reg.canonical({ b: 1, a: 2 }), reg.canonical({ a: 2, b: 1 }), 'canonical JSON is order-independent');
    assert.match(reg.sha256('x'), /^[0-9a-f]{64}$/);
    const gates = requireHarness<{ GRANDFATHERED_ADRS: Set<string> }>(root, 'approvals', 'approval-gates.cjs');
    assert.ok(gates.GRANDFATHERED_ADRS instanceof Set);
  });

  it('refuses a path that leaves harness/', () => {
    assert.throws(() => requireHarness(root, '..', 'package.json'), /stay inside harness/);
    assert.throws(() => requireHarness(root, path.resolve(root, 'package.json')), /stay inside harness/);
    assert.throws(() => requireHarness(root), /stay inside harness/);
  });

  it('is the only file under src/ that loads code with createRequire', () => {
    const users = walk(path.resolve(import.meta.dirname, '..', 'src'))
      .filter((f) => /\bcreateRequire\b/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(path.resolve(import.meta.dirname, '..'), f).split(path.sep).join('/'));
    assert.deepEqual(users, ['src/lib/harness-bridge.ts']);
  });
});
