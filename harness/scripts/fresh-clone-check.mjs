// Reproducible-setup check: clone the committed HEAD into a temporary folder (no install step, the package has no dependencies), run the
// repository validator there, and run any test files named on the command line. Only committed content is checked, never the working tree.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tests = process.argv.slice(2);
if (tests.some((t) => t.startsWith('-') || path.isAbsolute(t) || t.includes('..'))) { console.error('fresh-clone-check: test paths must be relative to the repository'); process.exit(2); }
const dir = mkdtempSync(path.join(tmpdir(), 'gf-fresh-'));
let code = 0;
try {
  execFileSync('git', ['clone', '-q', '--no-hardlinks', root, dir], { stdio: 'inherit' });
  console.log(`fresh clone at ${execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir }).toString().trim()}`);
  execFileSync(process.execPath, ['harness/scripts/validate-harness.mjs'], { cwd: dir, stdio: 'inherit' });
  if (tests.length) execFileSync(process.execPath, ['--test', ...tests], { cwd: dir, stdio: 'inherit' });
  console.log('fresh-clone-check: OK');
} catch (e) {
  console.error(`fresh-clone-check: FAILED (${e.message.split('\n')[0]})`); code = 1;
} finally { rmSync(dir, { recursive: true, force: true }); }
process.exit(code);
