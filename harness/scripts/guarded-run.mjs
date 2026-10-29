#!/usr/bin/env node
// Runs the test suite or a validator and proves the control plane and the tests were not changed by the run.
//   node harness/scripts/guarded-run.mjs -- node --test
//   node harness/scripts/guarded-run.mjs -- npm test
//   node harness/scripts/guarded-run.mjs -- node harness/scripts/validate-harness.mjs
// Only those command shapes are accepted: this is a check wrapper, not a general command runner. Exit codes: the command's own code;
// 4 when protected files changed during the run (even if the command passed); 2 for refused commands.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { guard } = require('../lib/integrity.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function acceptable(cmd) {
  if (!Array.isArray(cmd) || !cmd.length) return false;
  if (cmd[0] === 'npm') return cmd.length === 2 && cmd[1] === 'test';
  if (cmd[0] === 'node') {
    if (cmd[1] === '--test') return cmd.slice(2).every((a) => /^(tests\/[A-Za-z0-9._-]+\.test\.mjs|--test-reporter=tap|--test-concurrency=\d+)$/.test(a));
    return cmd.length === 2 && /^harness\/scripts\/validate-[a-z-]+\.mjs$/.test(cmd[1]);
  }
  return false;
}

export function guardedRun(cmd, { rootDir = root, protectedPaths, logDir = path.join(rootDir, '.harness-logs'), now = new Date() } = {}) {
  if (!acceptable(cmd)) throw new Error('refused: only "node --test [tests/<file>.test.mjs ...]", "npm test" and "node harness/scripts/validate-*.mjs" can be guarded');
  const run = () => {
    const [file, args] = cmd[0] === 'npm' ? [process.execPath, [process.env.npm_execpath?.endsWith('npm-cli.js') ? process.env.npm_execpath : path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), 'test']] : [process.execPath, cmd.slice(1)];
    return spawnSync(file, args, { cwd: rootDir, stdio: 'inherit', env: process.env });
  };
  const g = guard(rootDir, run, { protectedPaths });
  const report = { schema: 'greenfuel.integrity-report/v1', at: now.toISOString(), command: cmd, status: g.status, filesWatched: g.filesWatched, changed: g.changed, added: g.added, removed: g.removed, modified: g.modified, thrown: g.thrown };
  try { mkdirSync(logDir, { recursive: true }); writeFileSync(path.join(logDir, 'last-integrity-report.json'), `${JSON.stringify(report, null, 2)}\n`); } catch { /* best effort: the exit code and the console carry the verdict */ }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const i = a.indexOf('--');
  const cmd = i >= 0 ? a.slice(i + 1) : [];
  try {
    const r = guardedRun(cmd);
    if (r.changed) {
      for (const [k, label] of [['modified', 'MODIFIED'], ['added', 'ADDED'], ['removed', 'REMOVED']]) for (const f of r[k]) console.error(`INTEGRITY ${label} during the run: ${f}`);
      console.error(`guarded-run: ${r.modified.length + r.added.length + r.removed.length} protected file(s) changed while the command ran. The result cannot be trusted.`);
      process.exit(4);
    }
    console.log(`guarded-run: ${r.filesWatched} protected file(s) unchanged by the run; command exit ${r.status}`);
    process.exit(r.status ?? 1);
  } catch (e) { console.error(`guarded-run: ${e.message}`); process.exit(2); }
}
