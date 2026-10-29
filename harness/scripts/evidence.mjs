#!/usr/bin/env node
// Evidence store integrity.
//   node harness/scripts/evidence.mjs verify [--base <git-ref>]   check the manifest, the chain, the failure logs and (with --base) append-only
//   node harness/scripts/evidence.mjs seal                        one-time: write MANIFEST.json for the records that exist now; refuses to overwrite
// Verification fails closed. Without --base the append-only check is not run and the output says so.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const integrity = require('../lib/evidence-integrity.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function verifyEvidence(rootDir = root, base = null) {
  const gitDiff = (ref) => execFileSync('git', ['diff', '--name-status', ref, '--', 'docs/evidence'], { cwd: rootDir, encoding: 'utf8', windowsHide: true });
  return integrity.verifyStore(rootDir, { base, gitDiff });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const bi = rest.indexOf('--base');
  if (cmd === 'seal') {
    const mp = path.join(root, 'docs/evidence/MANIFEST.json');
    if (existsSync(mp)) { console.error('evidence seal: MANIFEST.json already exists; the baseline is sealed once and never rewritten'); process.exit(2); }
    const m = integrity.sealManifest(root);
    writeFileSync(mp, `${JSON.stringify(m, null, 2)}\n`, { flag: 'wx' });
    console.log(`evidence seal: sealed ${m.count} record(s) through ${m.sealedThrough}`);
  } else if (cmd === 'verify') {
    const r = verifyEvidence(root, bi >= 0 ? rest[bi + 1] : null);
    for (const f of r.findings) console.error(`FAIL ${f}`);
    for (const n of r.notes) console.log(`note: ${n}`);
    console.log(`evidence verify: ${r.ok ? 'OK' : 'FAILED'}. ${r.records} record(s); sealed through ${r.sealedThrough ?? 'nothing'}; ${r.chained} chained after the seal.`);
    process.exit(r.ok ? 0 : 1);
  } else { console.error('usage: evidence.mjs verify [--base <ref>] | seal'); process.exit(2); }
}
