// Executable tests for the CANDIDATE methodology registry and calculation contract. SYNTHETIC methodology and factors, test-only keys: nothing here is a scheme method.
// ST-07 unauthorized methodology change, plus reproducibility, effective dates, units, precision and rounding. They prove the candidate oracle, not any product.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTestKeyPair, keyIdOf } from '../harness/contracts/custody-chain-contract.mjs';
import { createMethodologyRegistry, parseDecimal, formatScaled } from '../harness/contracts/methodology-registry-contract.mjs';
import { verifyAuditLog } from '../harness/contracts/audit-chain.mjs';
import { canonical, sha256 } from '../harness/scripts/spec-validators.mjs';

const keys = generateTestKeyPair(); const signer = { ...keys, keyId: keyIdOf(keys.publicKeyPem) };
const ACTORS = {
  owner: { type: 'human', roles: ['methodology-owner'] }, reviewer: { type: 'human', roles: ['methodology-reviewer'] },
  qm: { type: 'human', roles: ['quality-manager'] }, qm2: { type: 'human', roles: ['quality-manager'] },
  agent: { type: 'agent', roles: ['methodology-owner', 'methodology-reviewer', 'quality-manager'] }, staff: { type: 'human', roles: ['operator'] },
  ownerQm: { type: 'human', roles: ['methodology-owner', 'quality-manager'] }, ownerReviewer: { type: 'human', roles: ['methodology-owner', 'methodology-reviewer'] },
};
const clock = { now: new Date('2026-03-01T08:00:00Z') };
const reg = () => createMethodologyRegistry({ actors: ACTORS, signer, clock: () => clock.now, testHooks: true });
const METHOD = (over = {}) => ({ methodologyId: 'M', version: '1', effectiveFrom: '2026-03-01', numericPolicy: { precision: 2, rounding: 'half-even', outputUnit: 'gCO2e per MJ (synthetic)' }, terms: [{ input: 'mass', inputUnit: 't', factorSetId: 'F', factor: 'k', factorUnit: 'x per t' }], ...over });
const FSET = (over = {}) => ({ factorSetId: 'F', version: '1', effectiveFrom: '2026-03-01', source: 'SYNTHETIC test fixture, not a real factor', factors: { k: { value: '2.5', unit: 'x per t' } }, ...over });
const input = (v, unit = 't') => ({ mass: { value: v, unit } });
function approveFactors(r, rec = FSET()) { const p = r.proposeFactorSet(rec, 'owner'); assert.equal(p.ok, true, JSON.stringify(p)); assert.equal(r.reviewFactorSet(p.key, 'reviewer').ok, true); assert.equal(r.approveFactorSet(p.key, 'qm').ok, true); return p.key; }
function approveMethod(r, rec = METHOD()) { const p = r.propose(rec, 'owner'); assert.equal(p.ok, true, JSON.stringify(p)); assert.equal(r.review(p.key, 'reviewer').ok, true); assert.equal(r.approve(p.key, 'qm').ok, true); return p.key; }
const calc = (r, v, extra = {}) => r.calculate({ methodologyId: 'M', deliveryDate: '2026-03-15', deliveryId: 'D1', inputs: input(v), ...extra });

test('decimals: strict strings only, fixed-point, no binary floating point', () => {
  assert.throws(() => parseDecimal(0.1), /string/); assert.throws(() => parseDecimal('1e3'), /string/); assert.throws(() => parseDecimal('1,5'), /string/);
  assert.equal(formatScaled(parseDecimal('0.3'), 2), '0.30'); assert.equal(formatScaled(parseDecimal('-12.5'), 1), '-12.5');
  const r = reg(); approveFactors(r, FSET({ factors: { k: { value: '3', unit: 'x per t' } } })); approveMethod(r);
  assert.equal(calc(r, '0.1').record.output.startsWith('0.30 '), true, '0.1 times 3 is exactly 0.30, with no 0.30000000000000004');
});

test('rounding modes are data and behave as declared (0.125 and 0.135 at two places)', () => {
  const out = {};
  for (const mode of ['half-even', 'half-up', 'down']) {
    const r = reg(); approveFactors(r); approveMethod(r, METHOD({ numericPolicy: { precision: 2, rounding: mode, outputUnit: 'u' } }));
    out[mode] = [calc(r, '0.05').record.output, calc(r, '0.054').record.output];
  }
  assert.deepEqual(out['half-even'], ['0.12 u', '0.14 u']);
  assert.equal(out['half-up'][0], '0.13 u'); assert.equal(out.down[0], '0.12 u');
});

test('units are checked: a mismatched input or factor unit fails closed rather than computing', () => {
  const r = reg(); approveFactors(r); approveMethod(r);
  assert.equal(r.calculate({ methodologyId: 'M', deliveryDate: '2026-03-15', deliveryId: 'D1', inputs: input('10', 'kg') }).reason, 'unit-mismatch');
  const r2 = reg(); approveFactors(r2, FSET({ factors: { k: { value: '2.5', unit: 'x per kg' } } })); approveMethod(r2);
  assert.equal(calc(r2, '10').reason, 'unit-mismatch');
});

test('calculation fails closed on a missing input, a missing factor, an unapproved factor set, a bad decimal and an unknown date', () => {
  const r = reg(); approveMethod(r);
  assert.equal(calc(r, '10').reason, 'missing-factor', 'method approved but its factor set is not');
  const p = r.proposeFactorSet(FSET(), 'owner'); r.reviewFactorSet(p.key, 'reviewer');
  assert.equal(calc(r, '10').reason, 'missing-factor', 'a factor set that is only in review is not used');
  r.approveFactorSet(p.key, 'qm');
  assert.equal(r.calculate({ methodologyId: 'M', deliveryDate: '2026-03-15', deliveryId: 'D1', inputs: {} }).reason, 'missing-input');
  assert.match(calc(r, 10).reason, /decimal/, 'a JavaScript number is refused');
  assert.equal(calc(r, '10', { deliveryDate: '2026-02-01' }).reason, 'no-applicable-approved-version');
  assert.equal(calc(r, '10', { deliveryDate: 'tomorrow' }).reason, 'bad-date');
  assert.equal(calc(r, '10', { methodologyId: 'X' }).reason, 'no-applicable-approved-version');
  assert.ok(r.audit().some((e) => e.action === 'calculation.run' && e.outcome === 'denied'), 'failed calculations are audited');
});

test('reproducibility: a stored record names exact versions and re-runs to the same result even after a newer version exists', () => {
  const r = reg(); approveFactors(r);
  approveMethod(r, METHOD({ effectiveTo: '2026-06-01' }));
  const first = calc(r, '12.5'); assert.equal(first.ok, true);
  assert.equal(first.record.methodologyRef.key, 'method:M@1'); assert.equal(first.record.factorSetRefs[0].key, 'factorSet:F@1');
  assert.match(first.record.methodologyRef.contentHash, /^[0-9a-f]{64}$/);
  const key2 = approveMethod(r, METHOD({ version: '2', effectiveFrom: '2026-06-01', numericPolicy: { precision: 3, rounding: 'half-up', outputUnit: 'u2' } }));
  assert.equal(r.resolve('M', '2026-05-31').entry.record.version, '1'); assert.equal(r.resolve('M', '2026-06-01').entry.record.version, '2');
  assert.deepEqual(r.rerun(first.record), { ok: true, match: true, differences: [] });
  assert.equal(r.calculate({ methodologyId: 'M', deliveryDate: '2026-06-15', deliveryId: 'D2', inputs: input('12.5') }).record.methodologyRef.key, key2);
  const again = calc(r, '12.5'); assert.equal(again.record.recordHash, first.record.recordHash, 'same inputs, same versions, same hash');
});

test('reproducibility: an altered stored record is reported by the re-run', () => {
  const r = reg(); approveFactors(r); approveMethod(r); const rec = calc(r, '12.5').record;
  let t = JSON.parse(JSON.stringify(rec)); t.output = '1.00 u'; assert.equal(r.rerun(t).match, false);
  t = JSON.parse(JSON.stringify(rec)); t.inputs.mass.value = '99'; const d = r.rerun(t); assert.equal(d.match, false); assert.ok(d.differences.length >= 1);
  t = JSON.parse(JSON.stringify(rec)); t.codeBuildId = 'other'; assert.ok(r.rerun(t).differences.some((x) => /build differs/.test(x)));
  t = JSON.parse(JSON.stringify(rec)); t.methodologyRef.key = 'method:M@9'; assert.equal(r.rerun(t).reason, 'methodology-version-missing');
});

test('ST-07 unauthorized methodology change: an agent or an unprivileged person cannot propose, review or approve', () => {
  const r = reg();
  assert.equal(r.propose(METHOD(), 'agent').reason, 'only-a-human-methodology-owner-may-propose');
  assert.equal(r.propose(METHOD(), 'staff').reason, 'only-a-human-methodology-owner-may-propose');
  assert.equal(r.propose(METHOD(), 'nobody').reason, 'unknown-actor');
  const p = r.propose(METHOD(), 'owner');
  assert.equal(r.review(p.key, 'agent').reason, 'only-a-human-reviewer-may-review');
  assert.equal(r.review(p.key, 'staff').reason, 'only-a-human-reviewer-may-review');
  assert.equal(r.approve(p.key, 'qm').reason, 'review-required-before-approval');
  r.review(p.key, 'reviewer');
  assert.equal(r.approve(p.key, 'agent').reason, 'only-a-human-quality-manager-may-approve');
  assert.equal(r.approve(p.key, 'reviewer').reason, 'only-a-human-quality-manager-may-approve');
  assert.equal(r.resolve('M', '2026-03-15').ok, false, 'nothing is usable before approval');
});

test('ST-07 unauthorized methodology change: separation of duties between proposer, reviewer and approver', () => {
  const r = reg(); const p = r.propose(METHOD(), 'ownerQm');
  assert.equal(r.review(p.key, 'ownerQm').reason, 'only-a-human-reviewer-may-review');
  assert.equal(r.review(p.key, 'reviewer').ok, true);
  assert.equal(r.approve(p.key, 'ownerQm').reason, 'approver-must-differ-from-proposer-and-reviewer');
  assert.equal(r.approve(p.key, 'qm').ok, true);
  const r2 = reg(); const q = r2.propose(METHOD(), 'ownerReviewer');
  assert.equal(r2.review(q.key, 'ownerReviewer').reason, 'proposer-cannot-review-own-change');
});

test('ST-07 unauthorized methodology change: an approved version is immutable, and an edit before approval discards review', () => {
  const r = reg(); const p = r.propose(METHOD(), 'owner'); r.review(p.key, 'reviewer');
  assert.equal(r.edit(p.key, { effectiveFrom: '2026-03-05' }, 'agent').reason, 'only-a-human-methodology-owner-may-edit');
  assert.equal(r.edit(p.key, { version: '9' }, 'owner').reason, 'identity-fields-cannot-be-edited');
  assert.equal(r.edit(p.key, { effectiveFrom: 'soon' }, 'owner').reason, 'malformed');
  assert.equal(r.edit(p.key, { numericPolicy: { precision: 2, rounding: 'banker', outputUnit: 'u' } }, 'owner').reason, 'units-precision-and-rounding-are-required');
  assert.equal(r.edit(p.key, { effectiveFrom: '2026-03-05' }, 'owner').ok, true);
  assert.equal(r.approve(p.key, 'qm').reason, 'review-required-before-approval');
  r.review(p.key, 'reviewer'); assert.equal(r.approve(p.key, 'qm').ok, true);
  assert.equal(r.edit(p.key, { numericPolicy: { precision: 9, rounding: 'down', outputUnit: 'u' } }, 'owner').reason, 'approved-versions-are-immutable-propose-a-new-version');
  assert.equal(r.propose(METHOD(), 'owner').reason, 'version-exists-use-a-new-version');
});

test('ST-07 unauthorized methodology change: retroactive and overlapping effective periods are refused', () => {
  const r = reg(); approveMethod(r, METHOD({ effectiveTo: '2026-06-01' }));
  const retro = r.propose(METHOD({ version: '2', effectiveFrom: '2026-01-01' }), 'owner'); r.review(retro.key, 'reviewer');
  assert.match(r.approve(retro.key, 'qm').reason, /retroactive/);
  const overlap = r.propose(METHOD({ version: '3', effectiveFrom: '2026-05-01' }), 'owner'); r.review(overlap.key, 'reviewer');
  assert.equal(r.approve(overlap.key, 'qm').reason, 'effective-period-overlaps-an-approved-version');
});

test('ST-07 unauthorized methodology change: rewriting a stored record AND its content hash is still detected, because the signature is recomputed over the stored fields', () => {
  const r = reg(); const fk = approveFactors(r); const mk = approveMethod(r);
  r._tamperStored('factorSet', fk, (e) => { e.record.factors.k.value = '0.001'; e.contentHash = sha256(canonical(e.record)); });
  assert.equal(calc(r, '10').reason, 'factor-set-integrity-failure');
  const r2 = reg(); approveFactors(r2); const k2 = approveMethod(r2);
  r2._tamperStored('method', k2, (e) => { e.record.numericPolicy.rounding = 'down'; e.contentHash = sha256(canonical(e.record)); });
  assert.equal(calc(r2, '10').reason, 'methodology-record-integrity-failure');
  const r3 = reg(); approveFactors(r3); const k3 = approveMethod(r3);
  r3._tamperStored('method', k3, (e) => { e.record.numericPolicy.rounding = 'down'; e.contentHash = sha256(canonical(e.record)); e.signedHash = sha256(canonical({ k: e.signedKey, contentHash: e.contentHash, approvedBy: e.approvedBy, approvedAt: e.approvedAt })); });
  assert.equal(calc(r3, '10').reason, 'methodology-record-integrity-failure', 'a recomputed signed hash still lacks a valid signature');
  assert.ok(mk);
});

test('ST-07 unauthorized methodology change: whoever edited a proposal counts as its author and cannot review or approve it', () => {
  const r = reg(); const p = r.propose(METHOD(), 'owner');
  assert.equal(r.edit(p.key, { effectiveFrom: '2026-03-02' }, 'ownerReviewer').ok, true, 'a second owner edits');
  assert.equal(r.review(p.key, 'ownerReviewer').reason, 'proposer-cannot-review-own-change');
  assert.equal(r.review(p.key, 'reviewer').ok, true);
  const q = reg(); const pq = q.propose(METHOD(), 'owner'); q.review(pq.key, 'reviewer');
  q.edit(pq.key, { effectiveFrom: '2026-03-02' }, 'ownerQm'); q.review(pq.key, 'reviewer');
  assert.equal(q.approve(pq.key, 'ownerQm').reason, 'approver-must-differ-from-proposer-and-reviewer', 'an editor cannot approve their own edit');
});

test('reproducibility: a calculation record is signed, so a forged record with a consistent hash is reported', () => {
  const r = reg(); approveFactors(r); approveMethod(r, METHOD({ effectiveTo: '2026-06-01' })); const rec = calc(r, '12.5').record;
  const forged = JSON.parse(JSON.stringify(rec)); forged.inputs.mass.value = '1.0'; forged.output = '2.50 gCO2e per MJ (synthetic)';
  const { recordHash, signature, ...rest } = forged; forged.recordHash = sha256(canonical(rest));
  const out = r.rerun(forged); assert.equal(out.match, false); assert.ok(out.differences.some((d) => /not signed by the calculation service/.test(d)));
  const moved = JSON.parse(JSON.stringify(rec)); moved.deliveryDate = '2026-09-01';
  const outMoved = r.rerun(moved); assert.equal(outMoved.match, false);
  assert.ok(outMoved.differences.some((d) => /not the one that applied on the delivery date/.test(d)));
});

test('reproducibility: a historical record still re-runs after its methodology version is retired', () => {
  const r = reg(); approveFactors(r); const k = approveMethod(r); const rec = calc(r, '12.5').record;
  assert.equal(r.retire(k, 'qm').ok, true);
  assert.deepEqual(r.rerun(rec), { ok: true, match: true, differences: [] });
  assert.equal(calc(r, '12.5').ok, false, 'but no new calculation can use the retired version');
});

test('ST-07 unauthorized methodology change: a factor set needs a cited source and the same review path', () => {
  const r = reg();
  assert.equal(r.proposeFactorSet(FSET({ source: '' }), 'owner').reason, 'a-factor-set-needs-a-cited-source');
  assert.equal(r.proposeFactorSet(FSET(), 'agent').reason, 'only-a-human-methodology-owner-may-propose');
  const p = r.proposeFactorSet(FSET(), 'owner'); assert.equal(r.approveFactorSet(p.key, 'qm').reason, 'review-required-before-approval');
});

test('retirement is a quality-manager act and removes a version from resolution', () => {
  const r = reg(); approveFactors(r); const k = approveMethod(r);
  assert.equal(r.retire(k, 'agent').ok, false); assert.equal(r.retire(k, 'owner').ok, false);
  assert.equal(r.retire(k, 'qm').ok, true); assert.equal(r.resolve('M', '2026-03-15').reason, 'no-applicable-approved-version');
});

test('every methodology action, allowed or denied, is in a verifiable audit log', () => {
  const r = reg(); approveFactors(r); approveMethod(r); r.propose(METHOD({ version: '5' }), 'agent'); calc(r, '1');
  const a = r.audit(); assert.ok(a.some((e) => e.outcome === 'denied') && a.some((e) => e.outcome === 'allowed'));
  assert.equal(verifyAuditLog(a, r.auditHead()).ok, true);
  const t = JSON.parse(JSON.stringify(a)); t[0].actorId = 'someone-else'; assert.equal(verifyAuditLog(t, r.auditHead()).ok, false);
});

test('construction fails without actors or a signer', () => { assert.throws(() => createMethodologyRegistry({}), /required/); });

test('ST-07 unauthorized methodology change: mutating a retained patch object after review cannot ride on the review', () => {
  const r = reg(); const p = r.propose(METHOD(), 'owner');
  const patch = { terms: [{ input: 'mass', inputUnit: 't', factorSetId: 'F', factor: 'k', factorUnit: 'x per t' }] };
  assert.equal(r.edit(p.key, patch, 'owner').ok, true); assert.equal(r.review(p.key, 'reviewer').ok, true);
  patch.terms[0].factor = 'cheaper-factor'; patch.terms.push({ input: 'extra', inputUnit: 't', factorSetId: 'F', factor: 'k', factorUnit: 'x per t' });
  assert.equal(r.approve(p.key, 'qm').ok, true, 'the stored copy was not affected, so the reviewed content is what is approved');
  assert.equal(r.resolve('M', '2026-03-15').entry.record.terms.length, 1); assert.equal(r.resolve('M', '2026-03-15').entry.record.terms[0].factor, 'k');
});

test('ST-07 unauthorized methodology change: content changed between review and approval is refused', () => {
  const r = reg(); const p = r.propose(METHOD(), 'owner'); r.review(p.key, 'reviewer');
  r._tamperStored('method', p.key, (e) => { e.record.numericPolicy.rounding = 'down'; });
  assert.equal(r.approve(p.key, 'qm').reason, 'content-changed-since-review');
});

test('the public API hands out copies and has no test hook unless a test factory asks for one', () => {
  const r = reg(); approveFactors(r); approveMethod(r);
  const view = r.resolve('M', '2026-03-15'); view.entry.status = 'RETIRED'; view.entry.record.numericPolicy.rounding = 'down';
  assert.equal(r.resolve('M', '2026-03-15').entry.status, 'APPROVED'); assert.equal(r.calculate({ methodologyId: 'M', deliveryDate: '2026-03-15', deliveryId: 'D1', inputs: input('0.05') }).record.output.startsWith('0.12 '), true);
  const plain = createMethodologyRegistry({ actors: ACTORS, signer, clock: () => clock.now });
  assert.equal('_tamperStored' in plain, false); assert.equal('_tamperStored' in r, true);
});
