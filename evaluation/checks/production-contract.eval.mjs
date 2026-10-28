// Executable evaluation checks for the PRODUCTION suite, contract scope. They run hostile or faulty SYNTHETIC fixtures through the
// candidate specification validators (lineage, certificate chain, methodology, placement). That tests the contract oracles that a
// future production design must satisfy. It does NOT test any production agent: none exists. A PASS here means "the candidate
// contract rejects this fixture"; a FAIL means the candidate contract has a gap a hostile input would pass through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runUtility, recordHash } from '../../harness/scripts/spec-validators.mjs';

const require = createRequire(import.meta.url);
const { sha256, canonical } = require('../../harness/hooks/permission-engine.cjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures', rel), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

// Runs a validator over one document in a throwaway repository root. Returns { status, messages }.
function validate(name, docs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-contract-'));
  try {
    fs.mkdirSync(path.join(root, 'tests/fixtures/eval'), { recursive: true });
    for (const [file, doc] of Object.entries(docs)) fs.writeFileSync(path.join(root, 'tests/fixtures/eval', file), JSON.stringify(doc, null, 2));
    const r = runUtility(name, root, 'tests/fixtures/eval');
    return { status: r.status, messages: r.errors.map((e) => e.msg) };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
const rejects = (r, re, what) => { assert.equal(r.status, 'FAIL', `${what}: the contract accepted it (${r.status})`); assert.ok(r.messages.some((m) => re.test(m)), `${what}: rejected for another reason: ${r.messages.join(' | ').slice(0, 200)}`); };
const accepts = (name, doc) => { const r = validate(name, { 'valid.json': doc }); assert.equal(r.status, 'PASS', `the unmodified fixture must pass: ${r.messages.join(' | ')}`); };

test('EVAL-PRC-DAT-001: a delivery whose mass-flow-meter readings are missing cannot reach a calculation, an evidence package or a certificate', () => {
  const base = fixture('lineage/valid-lineage.json'); accepts('evidence-lineage', base);
  const missingInput = clone(base); missingInput.records.find((r) => r.id === 'C1').inputs = ['R1', 'R9'];
  rejects(validate('evidence-lineage', { 'a.json': missingInput }), /input 'R9' does not exist/, 'a calculation names a reading that does not exist');
  const readingsRemoved = clone(base); readingsRemoved.records = readingsRemoved.records.filter((r) => r.id !== 'R2');
  rejects(validate('evidence-lineage', { 'b.json': readingsRemoved }), /input 'R2' does not exist/, 'a reading was removed but is still used');
  const noRaw = clone(base); for (const r of noRaw.records.filter((x) => x.kind === 'calculation')) r.inputs = [];
  rejects(validate('evidence-lineage', { 'c.json': noRaw }), /needs inputs \(lineage must reach raw data\)/, 'a calculation with no inputs');
});

test('EVAL-PRC-DAT-002: a duplicated or replayed delivery event is rejected, so raw data stays append-only', () => {
  const base = fixture('lineage/valid-lineage.json');
  const dupId = clone(base); dupId.records.push(clone(base.records[0]));
  rejects(validate('evidence-lineage', { 'a.json': dupId }), /R1: duplicate id/, 'the same event twice');
  const replay = clone(base); const r2 = replay.records.find((r) => r.id === 'R2'); r2.sequence = 1;
  rejects(validate('evidence-lineage', { 'b.json': replay }), /sequence 1 is not greater than the previous 1/, 'an event replayed with an old sequence');
});

test('EVAL-PRC-DAT-003: an altered, re-hashed or replaced certificate is detected by the hash chain', () => {
  const base = fixture('certificates/valid-chain.json'); accepts('certificate-integrity', base);
  const altered = clone(base); altered.certificates[1].payload = { ...(altered.certificates[1].payload ?? {}), tampered: true };
  rejects(validate('certificate-integrity', { 'a.json': altered }), /payloadSha256 does not match the payload/, 'payload altered after issue');
  const rehashed = clone(base); rehashed.certificates[1].payload = { ...(rehashed.certificates[1].payload ?? {}), tampered: true }; rehashed.certificates[1].payloadSha256 = sha256(canonical(rehashed.certificates[1].payload));
  rejects(validate('certificate-integrity', { 'b.json': rehashed }), /recordSha256 does not match the record/, 'payload altered and its own hash recomputed');
  const replaced = clone(base); const c0 = replaced.certificates[0]; c0.payload = { replaced: true }; c0.payloadSha256 = sha256(canonical(c0.payload)); c0.recordSha256 = recordHash(c0);
  rejects(validate('certificate-integrity', { 'c.json': replaced }), /previousSha256 does not link to the previous certificate/, 'a first certificate replaced by a fully re-hashed one');
});

test('EVAL-PRC-DAT-004: an invented, unsourced, unverified or silently changed emissions factor is rejected', () => {
  const base = fixture('emissions-methods/valid-method.json'); accepts('emissions-methods', base);
  const noSource = clone(base); delete noSource.factors[0].source;
  rejects(validate('emissions-methods', { 'a.json': noSource }), /a value needs a cited source; values are never invented/, 'a factor with no source');
  const changed = clone(base); changed.factors[0].value = 2;
  rejects(validate('emissions-methods', { 'b.json': changed }), /definitionSha256 does not match the definition/, 'a factor changed without a new version');
  const model = clone(base); model.usesModel = true;
  rejects(validate('emissions-methods', { 'c.json': model }), /usesModel must be false/, 'a model on the calculation path');
  const real = clone(base); real.synthetic = false; real.status = 'Candidate';
  rejects(validate('emissions-methods', { 'd.json': real }), /needs verifiedBy|needs a sourceCitation/, 'a non-synthetic record without a named human verifier');
  const verified = clone(base); verified.status = 'Verified';
  rejects(validate('emissions-methods', { 'e.json': verified }), /Verified needs verification/, 'Verified without evidence');
});

test('EVAL-PRC-DAT-005: a calculation that uses an outdated emissions factor set is rejected when its validity ended before the delivery', () => {
  const lineage = fixture('lineage/valid-lineage.json'); const method = fixture('emissions-methods/valid-method.json');
  // the factor set ended in 2029; the delivery readings are timed 2030. A contract that models validity must reject this pair.
  const old = clone(method); old.referenceData = { ...old.referenceData, validUntil: '2029-12-31T00:00:00Z' };
  old.definitionSha256 = sha256(canonical((({ definitionSha256, ...rest }) => rest)(old)));
  const l = validate('evidence-lineage', { 'valid.json': lineage }); const m = validate('emissions-methods', { 'valid.json': old });
  const caught = [...l.messages, ...m.messages].some((x) => /expired|outdated|superseded|validUntil|effective|no longer valid/i.test(x)) || l.status === 'FAIL' || m.status === 'FAIL';
  assert.ok(caught, 'the candidate contracts accept a calculation that uses a factor set whose validity ended before the delivery: they have no effective-period rule (FR-012, DATA-005)');
});

test('EVAL-PRC-DAT-006: a sensor reading with a manipulated timestamp (earlier than its predecessor, or in the far future) is rejected', () => {
  const base = fixture('lineage/valid-lineage.json');
  const backwards = clone(base); backwards.records.find((r) => r.id === 'R2').trustedTime = '2029-12-31T23:00:00Z';
  const future = clone(base); future.records.find((r) => r.id === 'R2').trustedTime = '2099-01-01T00:00:00Z';
  const a = validate('evidence-lineage', { 'a.json': backwards }); const b = validate('evidence-lineage', { 'b.json': future });
  assert.ok(a.status === 'FAIL' && a.messages.some((m) => /time|timestamp/i.test(m)), 'the candidate lineage contract accepts a reading timed before the reading that precedes it in sequence: it checks that trustedTime is a valid ISO time but not that time is ordered or plausible (NFR-017, DATA-002)');
  assert.ok(b.status === 'FAIL' && b.messages.some((m) => /time|timestamp/i.test(m)), 'the candidate lineage contract accepts a reading timed in the far future');
});

test('EVAL-PRC-SEC-001: a certificate cannot be issued or filed without a human quality-manager approval, and an agent cannot be the approver', () => {
  const chain = fixture('certificates/valid-chain.json'); const lineage = fixture('lineage/valid-lineage.json');
  const issued = clone(chain).certificates.findIndex((c) => ['Issued', 'Filed'].includes(c.status)); assert.ok(issued >= 0, 'the fixture has an issued certificate');
  for (const [name, mutate, re] of [
    ['no approval', (a) => { delete a.approval; }, /needs a human quality-manager approval/],
    ['an agent approver', (a) => { a.approval = { ...a.approval, approverType: 'agent', approvedBy: 'certification-agent' }; }, /needs a human quality-manager approval/],
    ['a wrong role', (a) => { a.approval = { ...a.approval, role: 'commercial-reviewer' }; }, /needs a human quality-manager approval/],
  ]) {
    const d = clone(chain); mutate(d.certificates[issued]); d.certificates[issued].recordSha256 = recordHash(d.certificates[issued]);
    rejects(validate('certificate-integrity', { 'a.json': d }), re, `chain: ${name}`);
  }
  const l = clone(lineage); delete l.records.find((r) => r.kind === 'certificate').approval;
  rejects(validate('evidence-lineage', { 'b.json': l }), /a certificate needs a human quality-manager approval/, 'lineage: certificate without approval');
});

test('EVAL-PRC-SEC-002: a certificate that is not locally hosted, or whose methodology version cannot be traced, is rejected', () => {
  const chain = fixture('certificates/valid-chain.json');
  const remote = clone(chain); remote.certificates[0].hosting = { ...remote.certificates[0].hosting, zone: 'Z5' }; remote.certificates[0].recordSha256 = recordHash(remote.certificates[0]);
  rejects(validate('certificate-integrity', { 'a.json': remote }), /certificates must be locally hosted/, 'hosted outside the local zones');
  const noMethod = clone(chain); delete noMethod.certificates[0].methodology.definitionSha256; noMethod.certificates[0].recordSha256 = recordHash(noMethod.certificates[0]);
  rejects(validate('certificate-integrity', { 'b.json': noMethod }), /methodology needs ref and definitionSha256/, 'no exact methodology version');
});

test('EVAL-PRC-SOV-001: a placement that names a cloud region as its residency basis is rejected: a region is not a residency control', () => {
  const r = runUtility('sovereignty', ROOT, 'tests/fixtures/loop/sovereignty/placement');
  assert.equal(r.status, 'FAIL');
  assert.ok(r.errors.some((e) => /a cloud region is not a residency control/.test(e.msg)), r.errors.map((e) => e.msg).join(' | '));
  assert.equal(runUtility('sovereignty', ROOT, 'tests/fixtures/sovereignty').status, 'PASS', 'the valid placement passes: the rejection is specific');
});

test('EVAL-PRC-SOV-002: a measurement, calculation or document that claims a model as its origin is rejected, so AI cannot invent evidence', () => {
  const base = fixture('lineage/valid-lineage.json');
  for (const id of ['R1', 'C1', 'K1']) {
    const d = clone(base); d.records.find((r) => r.id === id).origin = 'model';
    rejects(validate('evidence-lineage', { 'a.json': d }), new RegExp(`${id}: a model cannot be the origin of a record`), `${id} with a model origin`);
  }
});

