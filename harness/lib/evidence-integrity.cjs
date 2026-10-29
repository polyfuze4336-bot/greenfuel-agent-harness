'use strict';
// Evidence integrity: hashing, TAP failure extraction, and verification of the evidence record store.
// Pure functions plus one verifier. The verifier reads files and (optionally) git; it never writes.
//
// What this gives, and what it does not:
//  - A baseline manifest seals every record that existed when integrity checking was introduced. Changing, deleting or adding to those fails.
//  - Records after the baseline are chained: each holds the hash of its own content and of the previous record. Editing a record in the
//    middle breaks the chain from that point on.
//  - Against a base Git ref, nothing under docs/evidence may be modified or deleted; only added. This is what catches a rewrite of the
//    NEWEST record, which a hash chain cannot detect on its own (whoever rewrites the last record can recompute its hash).
//  - None of this proves a record is TRUE. It shows a record was not changed after it was written. The recorder, not a model, must write it.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const canonical = (v) => JSON.stringify(sortKeys(v));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashRecord = (rec) => sha256(canonical(rec));
// The hash a record carries over itself: everything except the hash field.
const selfHash = (rec) => { const { recordSha256, ...rest } = rec; return sha256(canonical(rest)); };

const ID = /^EV-(\d{4})$/;
const MAX_FAILURES = 20; const MAX_DETAIL = 4000;

// Test failures from TAP output. Keeps the full name and the diagnostic block that follows "not ok", so a failure can be identified after the fact.
function parseTap(text, redact = (s) => s) {
  const lines = String(text ?? '').split(/\r?\n/);
  const failures = []; let tests = null; const summary = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)not ok (\d+) - (.*)$/.exec(lines[i]);
    if (m && failures.length < MAX_FAILURES) {
      const block = []; let j = i + 1;
      while (j < lines.length && block.length < 60 && !/^\s*(ok|not ok) \d+ /.test(lines[j]) && !/^\s*# Subtest/.test(lines[j])) { block.push(lines[j]); if (/^\s*\.\.\.\s*$/.test(lines[j])) break; j++; }
      failures.push({ number: Number(m[2]), depth: Math.floor(m[1].length / 4), name: redact(m[3].trim()).slice(0, 500), detail: redact(block.join('\n')).slice(0, MAX_DETAIL) });
    }
    const s = /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/.exec(lines[i]);
    if (s) summary[s[1]] = Number(s[2]);
  }
  if (summary.tests !== undefined) tests = summary;
  return { failures, summary: tests };
}

function failureKind(run) {
  if (run.error && /ETIMEDOUT/.test(String(run.error.code ?? run.error.message))) return 'timeout';
  if (run.error) return 'spawn-error';
  if (run.signal) return 'signal';
  if (run.status !== 0) return 'nonzero-exit';
  return null;
}

const listRecords = (root) => { const dir = path.join(root, 'docs/evidence/records'); return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => ID.test(f.replace(/\.json$/, '')) && f.endsWith('.json')).sort() : []; };
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function sealManifest(root, now = new Date()) {
  const records = {}; let last = null;
  for (const f of listRecords(root)) { const rec = readJson(path.join(root, 'docs/evidence/records', f)); records[rec.id] = hashRecord(rec); last = rec.id; }
  return { schema: 'greenfuel.evidence-manifest/v1', algorithm: 'sha256 over canonical JSON (keys sorted); line endings cannot change it', sealedAt: now.toISOString(), sealedThrough: last, count: Object.keys(records).length, records };
}

// Verifies the store. `gitDiff(base)` must return `git diff --name-status <base> -- docs/evidence` output; absent means the append-only check is not run (and says so).
function verifyStore(root, { base = null, gitDiff = null } = {}) {
  const findings = []; const notes = []; const add = (m) => findings.push(m);
  const dir = path.join(root, 'docs/evidence/records');
  const files = listRecords(root); const recs = []; const byId = new Map();
  for (const f of files) {
    let rec;
    try { rec = readJson(path.join(dir, f)); } catch (e) { add(`${f}: not valid JSON (${e.message})`); continue; }
    if (rec.id !== f.replace(/\.json$/, '')) add(`${f}: the id inside the record (${rec.id}) does not match the file name`);
    recs.push(rec); byId.set(rec.id, rec);
  }
  // Contiguity: a deleted record leaves a hole.
  const nums = recs.map((r) => Number(ID.exec(r.id)?.[1])).filter(Number.isFinite).sort((a, b) => a - b);
  nums.forEach((n, i) => { if (n !== i + 1) { if (!findings.some((x) => x.startsWith('record numbering'))) add(`record numbering is not contiguous from EV-0001 (found EV-${String(n).padStart(4, '0')} where EV-${String(i + 1).padStart(4, '0')} was expected): a record is missing or was renumbered`); } });
  // Baseline manifest.
  const mp = path.join(root, 'docs/evidence/MANIFEST.json'); let sealedNum = 0;
  if (!fs.existsSync(mp)) add('docs/evidence/MANIFEST.json is missing: the baseline records are not sealed');
  else {
    let man; try { man = readJson(mp); } catch (e) { add(`MANIFEST.json is not valid JSON (${e.message})`); }
    if (man) {
      sealedNum = Number(ID.exec(man.sealedThrough ?? '')?.[1] ?? 0);
      for (const [id, h] of Object.entries(man.records ?? {})) {
        const rec = byId.get(id);
        if (!rec) add(`${id}: sealed in the manifest but missing from the store`);
        else if (hashRecord(rec) !== h) add(`${id}: changed after it was sealed (hash differs from MANIFEST.json)`);
      }
      for (const r of recs) if (Number(ID.exec(r.id)[1]) <= sealedNum && !(r.id in (man.records ?? {}))) add(`${r.id}: numbered inside the sealed range but not in the manifest`);
      if (Object.keys(man.records ?? {}).length !== man.count) add('MANIFEST.json count does not match its record list');
    }
  }
  // Chain after the baseline.
  const after = recs.filter((r) => Number(ID.exec(r.id)[1]) > sealedNum).sort((a, b) => a.id.localeCompare(b.id));
  let prev = sealedNum ? byId.get(`EV-${String(sealedNum).padStart(4, '0')}`) : null;
  for (const r of after) {
    if (!r.recordSha256 || !r.prevRecordSha256) { add(`${r.id}: written after the seal but carries no integrity chain (recordSha256/prevRecordSha256)`); prev = r; continue; }
    if (selfHash(r) !== r.recordSha256) add(`${r.id}: its content does not match its own recordSha256 (edited after it was written)`);
    if (prev && hashRecord(prev) !== r.prevRecordSha256) add(`${r.id}: prevRecordSha256 does not match the previous record (${prev.id} was edited, removed or reordered)`);
    prev = r;
  }
  // Failure logs.
  const logDir = path.join(root, 'docs/evidence/logs'); const logged = new Set();
  for (const r of recs) {
    if (!r.logFile) continue;
    logged.add(path.basename(r.logFile));
    const lp = path.join(root, r.logFile);
    if (!fs.existsSync(lp)) { add(`${r.id}: its failure log ${r.logFile} is missing`); continue; }
    if (sha256(fs.readFileSync(lp)) !== r.logSha256) add(`${r.id}: its failure log ${r.logFile} was changed after the record was written`);
  }
  if (fs.existsSync(logDir)) for (const f of fs.readdirSync(logDir)) if (f.endsWith('.log') && !logged.has(f)) add(`docs/evidence/logs/${f}: a log that no record refers to`);
  // Append-only against a base ref.
  if (base && gitDiff) {
    let out; try { out = gitDiff(base); } catch (e) { add(`the comparison with ${base} could not be run (${e.message}); append-only cannot be shown`); out = ''; }
    for (const line of String(out).split(/\r?\n/).filter(Boolean)) {
      const [status, ...rest] = line.split('\t'); const file = rest.join('\t');
      if (!/^docs\/evidence\/(records\/|logs\/|MANIFEST\.json)/.test(file)) continue;
      if (!status.startsWith('A')) add(`${file}: ${status.startsWith('D') ? 'deleted' : status.startsWith('R') ? 'renamed' : 'modified'} since ${base}; evidence is append-only`);
    }
  } else notes.push('append-only against a Git base ref was NOT checked (no base given)');
  return { ok: findings.length === 0, findings, notes, records: recs.length, sealedThrough: sealedNum ? `EV-${String(sealedNum).padStart(4, '0')}` : null, chained: after.length };
}

module.exports = { canonical, sha256, hashRecord, selfHash, parseTap, failureKind, listRecords, sealManifest, verifyStore };
