#!/usr/bin/env node
// Runs a command and records what actually happened (argv, exit code, output hash) as an evidence record.
// Usage: node harness/scripts/record-evidence.mjs --id EV-0001 --claim "What this proves" -- node --test
// The record states facts observed by this process. It does not judge whether the claim is satisfied.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { evaluate, loadPolicy } = require('../hooks/policy-guard.cjs');
const { scrub: scrubPaths } = require('../lib/local-paths.cjs');
const { parseTap, failureKind, hashRecord, selfHash } = require('../lib/evidence-integrity.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TAIL_BYTES = 2000;
// Default limit 300 seconds. A human may raise it with HARNESS_EVIDENCE_TIMEOUT_SECONDS for a long suite; the value is capped, and a bad value falls back to the default.
const TIMEOUT_MS = (() => { const n = Number(process.env.HARNESS_EVIDENCE_TIMEOUT_SECONDS); return Number.isInteger(n) && n >= 1 && n <= 1800 ? n * 1000 : 300_000; })();
const SECRET = /(bearer\s+[a-z0-9._-]{16,}|(?:key|token|secret|password|sig)=[^\s&"']{6,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/gi;

function parse(argv) {
  const split = argv.indexOf('--');
  if (split < 0) throw new Error('Missing "--" before the command to run.');
  const opts = {};
  for (let i = 0; i < split; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!['id', 'claim'].includes(key)) throw new Error(`Unknown option '${argv[i]}'. Records are always written to docs/evidence/records.`);
    opts[key] = argv[i + 1];
  }
  if (!/^EV-\d{4}$/.test(opts.id ?? '')) throw new Error('--id must look like EV-0001.');
  if (!opts.claim) throw new Error('--claim is required.');
  const cmd = argv.slice(split + 1);
  if (!cmd.length) throw new Error('No command given after "--".');
  return { id: opts.id, claim: opts.claim, cmd, outDir: path.join(root, 'docs', 'evidence', 'records') };
}

function gitHead() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

// npm is a .cmd shim on Windows and cannot be spawned directly (and a shell would widen injection risk), so run npm's own CLI script with node.
function resolveCommand(cmd) {
  if (cmd[0] !== 'npm') return [cmd[0], cmd.slice(1)];
  const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const cli = candidates.find((c) => c && /npm-cli\.js$/.test(c) && existsSync(c));
  if (cli) return [process.execPath, [cli, ...cmd.slice(1)]];
  return [cmd[0], cmd.slice(1)];
}

export function record({ id, claim, cmd, outDir }) {
  const policy = loadPolicy();
  const verdict = evaluate({ toolName: 'powershell', toolArgs: { command: cmd.join(' ') }, cwd: root }, policy);
  if (verdict) throw new Error(`Refusing to run: [${verdict.id}] ${verdict.reason}`);

  const outPath = path.join(outDir, `${id}.json`);
  if (existsSync(outPath)) throw new Error(`${id} already exists; evidence records are append-only.`);

  const redact = (s) => scrubPaths(String(s).replace(SECRET, '[REDACTED]'));
  const tree = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  const dirtyFiles = tree.status === 0 ? tree.stdout.split('\n').filter(Boolean).length : null;
  const headBefore = gitHead();
  const started = Date.now();
  const [file, fileArgs] = resolveCommand(cmd);
  const run = spawnSync(file, fileArgs, { cwd: root, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const treeAfter = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  const dirtyAfter = treeAfter.status === 0 ? treeAfter.stdout.split('\n').filter(Boolean).length : null;
  const headAfter = gitHead();
  const kind = failureKind(run);
  const tap = parseTap(output, redact);
  const rec = {
    id, claim,
    argv: cmd,
    exitCode: run.status,
    signal: run.signal ?? null,
    spawnError: run.error ? run.error.message : null,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    outputSha256: createHash('sha256').update(output).digest('hex'),
    outputBytes: Buffer.byteLength(output),
    outputTail: redact(output.slice(-TAIL_BYTES)),
    gitHead: headBefore,
    treeClean: dirtyFiles === null ? null : dirtyFiles === 0,
    dirtyFileCount: dirtyFiles,
    treeCleanAfter: dirtyAfter === null ? null : dirtyAfter === 0,
    dirtyFileCountAfter: dirtyAfter,
    headUnchanged: headAfter === headBefore,
    headAfter,
    environment: { node: process.version, platform: process.platform, release: os.release() },
  };
  // Failures keep their full identity. The tail alone lost the failing test's name (EV-0054), so a failure could never be diagnosed afterwards.
  if (tap.summary) rec.tapSummary = tap.summary;
  if (kind) rec.failureKind = kind;
  if (tap.failures.length) rec.failures = tap.failures;
  if (kind) {
    const logsDir = path.basename(outDir) === 'records' ? path.join(path.dirname(outDir), 'logs') : path.join(outDir, 'logs');
    mkdirSync(logsDir, { recursive: true });
    const body = redact(output);
    writeFileSync(path.join(logsDir, `${id}.log`), body, { flag: 'wx' });
    rec.logFile = `docs/evidence/logs/${id}.log`;
    rec.logSha256 = createHash('sha256').update(body).digest('hex');
  }
  const prevFile = existsSync(outDir) ? readdirSync(outDir).filter((f) => /^EV-\d{4}\.json$/.test(f) && f < `${id}.json`).sort().pop() : null;
  rec.prevRecordSha256 = prevFile ? hashRecord(JSON.parse(readFileSync(path.join(outDir, prevFile), 'utf8'))) : null;
  rec.recordSha256 = selfHash(rec);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(rec, null, 2) + '\n', { flag: 'wx' });
  return { rec, outPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { rec, outPath } = record(parse(process.argv.slice(2)));
    try {
      const engine = require('../hooks/permission-engine.cjs');
      engine.writeEvent(engine.loadModel(), 'evidence', { id: rec.id, exitCode: rec.exitCode, failureKind: rec.failureKind ?? null, failures: (rec.failures ?? []).length, recordSha256: rec.recordSha256, argv0: String(rec.argv[0]).slice(0, 80) });
    } catch { /* the event log is best effort; the record itself is the evidence */ }
    console.log(`${rec.id}: exit ${rec.exitCode}${rec.failures?.length ? ` (${rec.failures.length} failing test(s) recorded)` : ''} -> ${path.relative(root, outPath)}`);
    process.exit(rec.exitCode === 0 ? 0 : 1);
  } catch (err) {
    console.error(`record-evidence: ${err.message}`);
    process.exit(2);
  }
}
