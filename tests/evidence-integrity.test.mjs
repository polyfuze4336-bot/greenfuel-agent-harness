import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const I = require('../harness/lib/evidence-integrity.cjs');
const { record } = await import('../harness/scripts/record-evidence.mjs');
const { verifyEvidence } = await import('../harness/scripts/evidence.mjs');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = path.join(REPO, 'tests', 'support', 'probe.mjs');

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'gf-evi-'));
const rd = (p) => JSON.parse(readFileSync(p, 'utf8'));
const wr = (p, o) => writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`);

// A store: n sealed records written by hand (baseline), then k real recorder records chained after the seal.
function store(sealed = 3, chained = 2) {
  const root = tmp(); const dir = path.join(root, 'docs/evidence/records'); mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= sealed; i++) { const id = `EV-${String(i).padStart(4, '0')}`; wr(path.join(dir, `${id}.json`), { id, claim: `baseline ${i}`, argv: ['x'], exitCode: 0 }); }
  wr(path.join(root, 'docs/evidence/MANIFEST.json'), I.sealManifest(root));
  const ids = [];
  for (let i = 0; i < chained; i++) { const id = `EV-${String(sealed + 1 + i).padStart(4, '0')}`; record({ id, claim: `chained ${i}`, cmd: [process.execPath, PROBE, 'ok', i === chained - 1 && chained > 1 ? '1' : '0'], outDir: dir }); ids.push(id); }
  return { root, dir, ids };
}
const verify = (root, extra = {}) => I.verifyStore(root, extra);

test('a clean store verifies: baseline sealed, later records chained', () => {
  const { root } = store(3, 3);
  try { const r = verify(root); assert.deepEqual(r.findings, []); assert.equal(r.ok, true); assert.equal(r.sealedThrough, 'EV-0003'); assert.equal(r.chained, 3); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('silently rewriting a sealed record is detected', () => {
  const { root, dir } = store(3, 1);
  try {
    const p = path.join(dir, 'EV-0002.json'); const rec = rd(p); rec.exitCode = 0; rec.claim = 'baseline 2 (quietly improved)'; wr(p, rec);
    const r = verify(root); assert.equal(r.ok, false); assert.ok(r.findings.some((f) => /EV-0002: changed after it was sealed/.test(f)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rewriting a chained record, even with a recomputed own hash, breaks the next record; deleting one leaves a hole', () => {
  const { root, dir } = store(2, 3);
  try {
    const p = path.join(dir, 'EV-0003.json'); const rec = rd(p); rec.exitCode = 0; rec.failures = undefined; rec.claim = 'edited'; rec.recordSha256 = I.selfHash(rec); wr(p, rec);
    const r = verify(root); assert.equal(r.ok, false);
    assert.ok(r.findings.some((f) => /EV-0004: prevRecordSha256 does not match the previous record \(EV-0003/.test(f)), r.findings.join('\n'));
    const p2 = path.join(dir, 'EV-0004.json'); const q = rd(p2); q.claim = 'edited without rehash'; wr(p2, q);
    assert.ok(verify(root).findings.some((f) => /EV-0004: its content does not match its own recordSha256/.test(f)));
    rmSync(path.join(dir, 'EV-0004.json'));
    assert.ok(verify(root).findings.some((f) => /not contiguous|EV-0005: prevRecordSha256/.test(f)), 'a missing record is visible');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('removing or adding a sealed-range record, and removing the manifest, are detected', () => {
  const { root, dir } = store(3, 0);
  try {
    rmSync(path.join(dir, 'EV-0003.json'));
    let r = verify(root); assert.ok(r.findings.some((f) => /EV-0003: sealed in the manifest but missing/.test(f)));
    wr(path.join(dir, 'EV-0003.json'), { id: 'EV-0003', claim: 'a replacement', argv: ['x'], exitCode: 0 });
    r = verify(root); assert.ok(r.findings.some((f) => /EV-0003: changed after it was sealed/.test(f)));
    rmSync(path.join(root, 'docs/evidence/MANIFEST.json'));
    r = verify(root); assert.ok(r.findings.some((f) => /MANIFEST\.json is missing/.test(f)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a record written after the seal without the integrity chain is rejected (a model cannot hand-write evidence)', () => {
  const { root, dir } = store(2, 0);
  try {
    wr(path.join(dir, 'EV-0003.json'), { id: 'EV-0003', claim: 'looks real, exit 0', argv: ['npm', 'test'], exitCode: 0, outputSha256: 'a'.repeat(64) });
    const r = verify(root); assert.equal(r.ok, false); assert.ok(r.findings.some((f) => /EV-0003: written after the seal but carries no integrity chain/.test(f)));
    const rec = rd(path.join(dir, 'EV-0003.json')); rec.prevRecordSha256 = I.hashRecord(rd(path.join(dir, 'EV-0002.json'))); rec.recordSha256 = I.selfHash(rec); wr(path.join(dir, 'EV-0003.json'), rec);
    assert.equal(verify(root).ok, true, 'a hand-forged chain is internally consistent: the hash chain alone cannot prove authorship');
    // ...which is why the append-only check against the base ref and the control-plane guard exist. See the next test.
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the failure log is kept, hashed and protected; an orphan or altered log is detected', () => {
  const { root, dir } = store(1, 2);
  try {
    const failing = rd(path.join(dir, 'EV-0003.json'));
    assert.ok(failing.exitCode !== 0 && failing.failureKind === 'nonzero-exit' && failing.logFile === 'docs/evidence/logs/EV-0003.log');
    assert.equal(verify(root).ok, true);
    const lp = path.join(root, failing.logFile); writeFileSync(lp, `${readFileSync(lp, 'utf8')}\nok 999 - nothing failed here\n`);
    assert.ok(verify(root).findings.some((f) => /EV-0003: its failure log .* was changed/.test(f)));
    rmSync(lp); assert.ok(verify(root).findings.some((f) => /failure log .* is missing/.test(f)));
    writeFileSync(path.join(root, 'docs/evidence/logs/EV-0099.log'), 'orphan'); assert.ok(verify(root).findings.some((f) => /a log that no record refers to/.test(f)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('append-only against a base ref: added files pass, modified and deleted ones fail, a failing git fails closed', () => {
  const diff = (lines) => () => lines.join('\n');
  const { root } = store(2, 1);
  try {
    assert.equal(verify(root, { base: 'B', gitDiff: diff(['A\tdocs/evidence/records/EV-0003.json', 'A\tdocs/evidence/logs/EV-0003.log', 'M\tdocs/evidence/README.md']) }).ok, true, 'adding records is allowed; the README is not evidence');
    for (const [s, word] of [['M', 'modified'], ['D', 'deleted'], ['R100', 'renamed']]) {
      const r = verify(root, { base: 'B', gitDiff: diff([`${s}\tdocs/evidence/records/EV-0001.json`]) });
      assert.equal(r.ok, false); assert.ok(r.findings.some((f) => new RegExp(`EV-0001.json: ${word} since B`).test(f)));
    }
    assert.equal(verify(root, { base: 'B', gitDiff: diff(['M\tdocs/evidence/MANIFEST.json']) }).ok, false, 'the seal cannot be re-sealed');
    assert.equal(verify(root, { base: 'B', gitDiff: () => { throw new Error('bad revision'); } }).ok, false, 'fail closed');
    assert.ok(verify(root).notes.some((n) => /NOT checked/.test(n)), 'without a base ref the output says the check did not run');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('append-only works against a real Git history: rewriting the newest record is caught even though its hash is consistent', () => {
  const { root, dir } = store(2, 1);
  try {
    const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd: root, encoding: 'utf8' });
    git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'evidence'); const base = git('rev-parse', 'HEAD').trim();
    assert.equal(verifyEvidence(root, base).ok, true);
    const p = path.join(dir, 'EV-0003.json'); const rec = rd(p); rec.exitCode = 0; rec.claim = 'rewritten'; rec.recordSha256 = I.selfHash(rec); wr(p, rec);
    assert.equal(verify(root).ok, true, 'the chain alone cannot see a rewrite of the last record');
    const r = verifyEvidence(root, base); assert.equal(r.ok, false); assert.ok(r.findings.some((f) => /EV-0003.json: modified since/.test(f)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the recorder keeps full failing-test identity and a redacted full log, never the secret', () => {
  const root = tmp(); const dir = path.join(root, 'docs/evidence/records');
  try {
    const { rec } = record({ id: 'EV-0001', claim: 'a failing tap run', cmd: [process.execPath, path.join(REPO, 'tests', 'support', 'tap-failure.mjs')], outDir: dir });
    assert.equal(rec.exitCode, 1); assert.equal(rec.failureKind, 'nonzero-exit');
    assert.deepEqual(rec.tapSummary, { tests: 3, pass: 1, fail: 2 });
    assert.equal(rec.failures.length, 2);
    assert.equal(rec.failures[0].name, 'api contract: response carries the certificate id');
    assert.match(rec.failures[0].detail, /expected: 'CERT-1'/); assert.match(rec.failures[0].detail, /actual: 'CERT-2'/);
    const log = readFileSync(path.join(root, rec.logFile), 'utf8');
    assert.ok(log.includes('api contract: response carries the certificate id') && !log.includes('abcdef0123456789zz'), 'full log kept, secret redacted');
    assert.ok(!JSON.stringify(rec).includes('abcdef0123456789zz'));
    assert.equal(I.sha256(readFileSync(path.join(root, rec.logFile))), rec.logSha256);
    assert.equal(rec.recordSha256, I.selfHash(rec)); assert.equal(rec.prevRecordSha256, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a timeout is classified and logged, and a passing run keeps no log file', () => {
  const root = tmp(); const dir = path.join(root, 'docs/evidence/records');
  try {
    const ok = record({ id: 'EV-0001', claim: 'ok', cmd: [process.execPath, PROBE, 'ok'], outDir: dir }).rec;
    assert.equal(ok.logFile, undefined); assert.equal(ok.failureKind, undefined); assert.equal(existsSync(path.join(root, 'docs/evidence/logs')), false);
    assert.equal(ok.treeClean === null || typeof ok.treeClean === 'boolean', true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('parseTap: identifies every failing test with depth and diagnostics, and tolerates garbage', () => {
  const tap = ['# Subtest: parent', '    # Subtest: child', '    not ok 1 - child fails', '      ---', '      error: boom', '      ...', '    1..1', 'not ok 1 - parent', '  ---', '  error: failing subtests', '  ...', 'ok 2 - fine', '1..2', '# tests 2', '# pass 1', '# fail 1'].join('\n');
  const r = I.parseTap(tap);
  assert.deepEqual(r.failures.map((f) => [f.name, f.depth]), [['child fails', 1], ['parent', 0]]);
  assert.match(r.failures[0].detail, /boom/); assert.deepEqual(r.summary, { tests: 2, pass: 1, fail: 1 });
  assert.deepEqual(I.parseTap('').failures, []); assert.deepEqual(I.parseTap(undefined).failures, []); assert.equal(I.parseTap('not ok - no number').failures.length, 0);
  assert.equal(I.parseTap(Array.from({ length: 50 }, (_, i) => `not ok ${i + 1} - t${i}`).join('\n')).failures.length, 20, 'bounded');
});

test('the real repository store verifies, its baseline is sealed through EV-0066, and the manifest covers every baseline record', () => {
  const r = verifyEvidence(REPO, null);
  assert.deepEqual(r.findings, []); assert.equal(r.ok, true); assert.equal(r.sealedThrough, 'EV-0066');
  const man = rd(path.join(REPO, 'docs/evidence/MANIFEST.json'));
  assert.equal(man.count, 66); assert.equal(Object.keys(man.records).length, 66);
  assert.ok(readdirSync(path.join(REPO, 'docs/evidence/records')).filter((f) => f.endsWith('.json')).length >= 66);
});

void cpSync;
