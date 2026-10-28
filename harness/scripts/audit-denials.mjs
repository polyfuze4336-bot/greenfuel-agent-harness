#!/usr/bin/env node
// Reads the denied-action audit log. Read-only; it never changes the log.
//   node harness/scripts/audit-denials.mjs verify [--file <path>]    checks the hash chain; exit 1 on any problem
//   node harness/scripts/audit-denials.mjs summary [--file <path>]   counts denials by rule, agent and operation
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const engine = require('../hooks/permission-engine.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const i = argv.indexOf('--file');
const file = i > 0 ? path.resolve(argv[i + 1]) : path.join(process.env.HARNESS_LOG_DIR ?? path.join(root, '.harness-logs'), 'denied-actions.jsonl');

if (!existsSync(file)) { console.log(`audit-denials: no log at ${file} (no denial has been recorded)`); process.exit(0); }
if (argv[0] === 'verify') {
  const r = engine.verifyAuditChain(file);
  if (r.problems.length) { for (const p of r.problems) console.error(`FAIL ${p}`); process.exit(1); }
  console.log(`audit-denials: chain intact, ${r.records} record(s)`);
} else if (argv[0] === 'summary') {
  const by = (k) => (acc, r) => { for (const v of [].concat(r[k] ?? 'none')) acc[v] = (acc[v] ?? 0) + 1; return acc; };
  const recs = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  console.log(JSON.stringify({ records: recs.length, byRule: recs.reduce(by('rules'), {}), byAgent: recs.reduce(by('agent'), {}), byOperation: recs.reduce(by('operations'), {}) }, null, 2));
} else { console.error('usage: audit-denials.mjs verify|summary [--file path]'); process.exit(4); }
