// Executable security tests for the CANDIDATE custody and audit contracts (synthetic data, test-only keys). They prove the candidate oracle, not any product.
// ST-02 sensor replay, ST-03 duplicate transfer, ST-04 clock manipulation, ST-05 forged event sequence. See docs/target-architecture/10-CONTROL-MATRIX.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTestKeyPair, keyIdOf, buildEvent, buildStream, createCustodyVerifier, verifyBundle } from '../harness/contracts/custody-chain-contract.mjs';
import { createAuditLog, verifyAuditLog, ZERO } from '../harness/contracts/audit-chain.mjs';

const NOW = new Date('2026-01-10T12:00:00Z');
const dev = generateTestKeyPair(); const rk = generateTestKeyPair(); const attacker = generateTestKeyPair(); const otherDev = generateTestKeyPair();
const BASE = { deliveryId: 'D1', deviceId: 'mfm-1' };
const SPECS = [
  { deviceTime: '2026-01-10T11:00:00Z', kind: 'transfer-start' },
  { deviceTime: '2026-01-10T11:10:00Z', kind: 'meter-reading', payload: { massKg: '1000.0' } },
  { deviceTime: '2026-01-10T11:20:00Z', kind: 'meter-reading', payload: { massKg: '2000.0' } },
  { deviceTime: '2026-01-10T11:30:00Z', kind: 'transfer-end' },
];
const trustOf = (extra = {}) => ({ deviceKeys: { 'mfm-1': { publicKeyPem: dev.publicKeyPem } }, receiptPublicKeyPem: rk.publicKeyPem, skewMs: 60000, ...extra });

function setup({ clock = { now: NOW }, devices } = {}) {
  const devs = devices ?? { 'mfm-1': { publicKeyPem: dev.publicKeyPem, jurisdiction: 'SG' } };
  const v = createCustodyVerifier({ cell: { jurisdiction: 'SG' }, devices: devs, receiptKey: rk, clock: () => clock.now, skewMs: 60000, maxAgeMs: 72 * 3600 * 1000 });
  assert.equal(v.openDelivery({ deliveryId: 'D1', bargeId: 'B1', vesselId: 'V1', plannedStart: '2026-01-10T11:00:00Z', deviceIds: ['mfm-1'] }).ok, true);
  return { v, clock };
}
const reasons = (r) => r.rejected.map((x) => x.reason);

test('baseline: an honest signed stream is accepted and independently verifies as complete', () => {
  const { v } = setup(); const r = v.accept(buildStream(BASE, dev, SPECS));
  assert.equal(r.accepted.length, 4); assert.deepEqual(r.rejected, []);
  const out = verifyBundle(v.exportBundle('D1'), trustOf());
  assert.deepEqual(out.problems, []); assert.equal(out.ok, true); assert.equal(out.complete, true);
});

test('ST-02 sensor replay: resending an accepted batch creates nothing new and is idempotent', () => {
  const { v } = setup(); const s = buildStream(BASE, dev, SPECS); v.accept(s);
  const again = v.accept(s);
  assert.equal(again.accepted.length, 0); assert.equal(again.duplicates.length, 4); assert.deepEqual(again.rejected, []);
  assert.equal(v.exportBundle('D1').events.length, 4);
});

test('ST-02 sensor replay: the same sequence number with different signed content is a conflicting replay and is rejected', () => {
  const { v } = setup(); const s = buildStream(BASE, dev, SPECS); v.accept(s);
  const forged = buildEvent({ ...BASE, seq: 2, prevHash: s[0].hash, deviceTime: '2026-01-10T11:10:00Z', kind: 'meter-reading', payload: { massKg: '9999.0' } }, dev);
  assert.deepEqual(reasons(v.accept([forged])), ['conflicting-replay']);
});

test('ST-02 sensor replay: an event replayed under another delivery, device or key identity does not verify', () => {
  const { v } = setup(); const s = buildStream(BASE, dev, SPECS); v.accept(s.slice(0, 1));
  assert.deepEqual(reasons(v.accept([{ ...s[1], deliveryId: 'D2' }])), ['unknown-delivery']);
  assert.deepEqual(reasons(v.accept([{ ...s[1], deviceId: 'mfm-9' }])), ['device-not-assigned']);
  assert.deepEqual(reasons(v.accept([{ ...s[1], keyId: keyIdOf(attacker.publicKeyPem) }])), ['unknown-key']);
});

test('ST-02 sensor replay: nothing is accepted after the transfer has ended', () => {
  const { v } = setup(); const s = buildStream(BASE, dev, SPECS); v.accept(s);
  const late = buildEvent({ ...BASE, seq: 5, prevHash: s[3].hash, deviceTime: '2026-01-10T11:40:00Z', kind: 'meter-reading', payload: { massKg: '3000.0' } }, dev);
  assert.deepEqual(reasons(v.accept([late])), ['after-end']);
});

test('ST-03 duplicate transfer: one physical transfer cannot become two deliveries', () => {
  const { v } = setup();
  assert.equal(v.openDelivery({ deliveryId: 'D1', bargeId: 'B9', vesselId: 'V9', plannedStart: '2026-01-10T09:00:00Z', deviceIds: ['mfm-1'] }).reason, 'duplicate-delivery');
  assert.equal(v.openDelivery({ deliveryId: 'D2', bargeId: 'B1', vesselId: 'V1', plannedStart: '2026-01-10T11:00:40Z', deviceIds: ['mfm-1'] }).reason, 'duplicate-transfer');
  assert.equal(v.openDelivery({ deliveryId: 'D3', bargeId: 'B1', vesselId: 'V1', plannedStart: '2026-01-10T15:00:00Z', deviceIds: ['mfm-1'] }).ok, true, 'a different time is a different transfer');
});

test('ST-03 duplicate transfer: a second transfer-start inside one delivery is rejected', () => {
  const { v } = setup(); const s = buildStream(BASE, dev, SPECS); v.accept(s.slice(0, 2));
  const second = buildEvent({ ...BASE, seq: 3, prevHash: s[1].hash, deviceTime: '2026-01-10T11:15:00Z', kind: 'transfer-start' }, dev);
  assert.deepEqual(reasons(v.accept([second])), ['duplicate-start']);
});

test('ST-04 clock manipulation: a future-dated device clock is rejected', () => {
  const { v } = setup(); const ev = buildStream(BASE, dev, [{ deviceTime: '2026-01-10T13:00:00Z', kind: 'transfer-start' }]);
  assert.deepEqual(reasons(v.accept(ev)), ['future-dated']);
});

test('ST-04 clock manipulation: events older than the allowed age and events whose time goes backwards are rejected', () => {
  const { v } = setup(); const old = buildStream(BASE, dev, [{ deviceTime: '2025-12-01T11:00:00Z', kind: 'transfer-start' }]);
  assert.deepEqual(reasons(v.accept(old)), ['too-old']);
  const s = buildStream(BASE, dev, [SPECS[0], SPECS[1], { deviceTime: '2026-01-10T11:05:00Z', kind: 'meter-reading', payload: { massKg: '1500.0' } }]);
  v.accept(s.slice(0, 2)); assert.deepEqual(reasons(v.accept([s[2]])), ['time-regression']);
});

test('ST-04 clock manipulation: the receipt time comes from the verifier clock, never from the device', () => {
  const clock = { now: NOW }; const { v } = setup({ clock }); const s = buildStream(BASE, dev, SPECS);
  v.accept(s.slice(0, 2)); clock.now = new Date('2026-01-10T12:30:00Z'); v.accept(s.slice(2));
  const b = v.exportBundle('D1');
  assert.equal(b.receipts[0].receivedAt, '2026-01-10T12:00:00.000Z'); assert.equal(b.receipts[3].receivedAt, '2026-01-10T12:30:00.000Z');
  assert.equal(verifyBundle(b, trustOf()).ok, true);
});

test('ST-04 clock manipulation: an attacker who edits a receipt time, or re-signs receipts with their own key, is detected', () => {
  const { v } = setup(); v.accept(buildStream(BASE, dev, SPECS));
  const b = v.exportBundle('D1'); b.receipts[1].receivedAt = '2026-01-10T11:11:00.000Z';
  assert.ok(verifyBundle(b, trustOf()).problems.some((p) => /receipt .*altered/.test(p)));
  const forgedTrust = trustOf({ receiptPublicKeyPem: attacker.publicKeyPem });
  assert.ok(verifyBundle(v.exportBundle('D1'), forgedTrust).problems.some((p) => /not signed by the trusted receipt key/.test(p)));
});

test('ST-04 clock manipulation: an event accepted under a lenient skew is flagged by an independent verifier with a strict skew', () => {
  const lenient = createCustodyVerifier({ cell: { jurisdiction: 'SG' }, devices: { 'mfm-1': { publicKeyPem: dev.publicKeyPem, jurisdiction: 'SG' } }, receiptKey: rk, clock: () => NOW, skewMs: 2 * 3600 * 1000, maxAgeMs: 72 * 3600 * 1000 });
  lenient.openDelivery({ deliveryId: 'D1', bargeId: 'B1', vesselId: 'V1', plannedStart: '2026-01-10T11:00:00Z', deviceIds: ['mfm-1'] });
  const r = lenient.accept(buildStream(BASE, dev, [{ deviceTime: '2026-01-10T13:00:00Z', kind: 'transfer-start' }])); assert.equal(r.accepted.length, 1);
  const out = verifyBundle(lenient.exportBundle('D1'), trustOf({ skewMs: 60000 }));
  assert.ok(out.problems.some((p) => /forward-dated/.test(p)));
});

test('ST-04 clock manipulation: a key revoked before receipt is refused, and the verifier distrusts later receipts', () => {
  const { v } = setup({ devices: { 'mfm-1': { publicKeyPem: dev.publicKeyPem, jurisdiction: 'SG', revokedAt: '2026-01-10T11:59:00Z' } } });
  assert.deepEqual(reasons(v.accept(buildStream(BASE, dev, SPECS.slice(0, 1)))), ['key-revoked']);
  const ok = setup(); ok.v.accept(buildStream(BASE, dev, SPECS));
  const out = verifyBundle(ok.v.exportBundle('D1'), trustOf({ deviceKeys: { 'mfm-1': { publicKeyPem: dev.publicKeyPem, revokedAt: '2026-01-10T11:30:00Z' } } }));
  assert.ok(out.problems.some((p) => /received after the device key was revoked/.test(p)));
});

test('ST-05 forged sequence: an attacker who recomputes valid hashes but lacks the device key is rejected', () => {
  const { v } = setup(); v.accept(buildStream(BASE, dev, SPECS.slice(0, 1)));
  const head = v.exportBundle('D1').events[0];
  const fake = buildEvent({ ...BASE, seq: 2, prevHash: head.hash, deviceTime: '2026-01-10T11:10:00Z', kind: 'meter-reading', payload: { massKg: '5000.0' } }, attacker);
  assert.deepEqual(reasons(v.accept([fake])), ['unknown-key']);
  const claimsDeviceKeyId = { ...fake, keyId: keyIdOf(dev.publicKeyPem) };
  assert.deepEqual(reasons(v.accept([claimsDeviceKeyId])), ['hash-mismatch'], 'changing the key id changes the signed content');
});

test('ST-05 forged sequence: a re-hashed event that still carries the attacker signature fails the signature check', () => {
  const { v } = setup(); v.accept(buildStream(BASE, dev, SPECS.slice(0, 1)));
  const head = v.exportBundle('D1').events[0];
  const mine = buildEvent({ ...BASE, seq: 2, prevHash: head.hash, deviceTime: '2026-01-10T11:10:00Z', kind: 'meter-reading', payload: { massKg: '5000.0' } }, attacker);
  const spoof = buildEvent({ ...BASE, seq: 2, prevHash: head.hash, deviceTime: '2026-01-10T11:10:00Z', kind: 'meter-reading', payload: { massKg: '5000.0' } }, dev);
  assert.deepEqual(reasons(v.accept([{ ...spoof, sig: mine.sig }])), ['bad-signature']);
});

test('ST-05 forged sequence: gaps, chain breaks, reordering and events before the start are rejected', () => {
  const s = buildStream(BASE, dev, SPECS);
  let c = setup(); c.v.accept(s.slice(0, 1)); assert.deepEqual(reasons(c.v.accept([s[2]])), ['gap']);
  c = setup(); assert.deepEqual(reasons(c.v.accept([s[1]])), ['gap']);
  c = setup(); c.v.accept(s.slice(0, 1));
  const wrongPrev = buildEvent({ ...BASE, seq: 2, prevHash: '1'.repeat(64), deviceTime: '2026-01-10T11:10:00Z', kind: 'meter-reading' }, dev);
  assert.deepEqual(reasons(c.v.accept([wrongPrev])), ['chain-break']);
  c = setup(); const first = buildEvent({ ...BASE, seq: 1, prevHash: ZERO, deviceTime: '2026-01-10T11:10:00Z', kind: 'meter-reading' }, dev);
  assert.deepEqual(reasons(c.v.accept([first])), ['before-start']);
  c = setup(); const r = c.v.accept([s[1], s[0], s[1]]); assert.deepEqual(reasons(r), ['gap']); assert.equal(r.accepted.length, 2, 'a late-arriving predecessor lets the successor through on resend');
});

test('ST-05 forged sequence: a device from another jurisdiction, or not assigned to the delivery, is refused', () => {
  const foreign = setup({ devices: { 'mfm-1': { publicKeyPem: dev.publicKeyPem, jurisdiction: 'MY' } } });
  assert.deepEqual(reasons(foreign.v.accept(buildStream(BASE, dev, SPECS.slice(0, 1)))), ['jurisdiction-mismatch']);
  const { v } = setup({ devices: { 'mfm-1': { publicKeyPem: dev.publicKeyPem, jurisdiction: 'SG' }, 'mfm-2': { publicKeyPem: otherDev.publicKeyPem, jurisdiction: 'SG' } } });
  assert.deepEqual(reasons(v.accept(buildStream({ deliveryId: 'D1', deviceId: 'mfm-2' }, otherDev, SPECS.slice(0, 1)))), ['device-not-assigned']);
});

test('ST-05 forged sequence: a malformed or oversized event is rejected without throwing', () => {
  const { v } = setup(); const s = buildStream(BASE, dev, SPECS);
  const bad = [null, 'x', {}, { ...s[0], payload: { x: 'a'.repeat(5000) } }, { ...s[0], kind: 'rm-rf' }, { ...s[0], deviceTime: 'yesterday' }];
  const r = v.accept(bad); assert.equal(r.rejected.length, bad.length); assert.ok(r.rejected.every((x) => x.reason === 'malformed'));
});

test('ST-05 forged sequence: independent verification detects a deleted, altered, inserted or substituted-key bundle', () => {
  const { v } = setup(); v.accept(buildStream(BASE, dev, SPECS));
  const fresh = () => v.exportBundle('D1');
  let b = fresh(); b.events.splice(2, 1); assert.ok(verifyBundle(b, trustOf()).problems.length > 0, 'deleted event');
  b = fresh(); b.events[1].payload.massKg = '1.0'; assert.ok(verifyBundle(b, trustOf()).problems.some((p) => /altered/.test(p)), 'altered payload');
  b = fresh(); b.receipts.splice(1, 1); assert.ok(verifyBundle(b, trustOf()).problems.some((p) => /no receipt/.test(p)), 'removed receipt');
  b = fresh(); b.events = b.events.slice(0, 3); assert.equal(verifyBundle(b, trustOf()).complete, false, 'a truncated bundle is not complete');
  const rebuilt = buildStream(BASE, attacker, SPECS); b = fresh(); b.events = rebuilt; b.deviceKeys['mfm-1'] = attacker.publicKeyPem;
  const out = verifyBundle(b, trustOf()); assert.equal(out.ok, false, 'a bundle cannot vouch for its own key'); assert.ok(out.problems.some((p) => /not the trusted key/.test(p)));
  assert.equal(verifyBundle(fresh(), { receiptPublicKeyPem: rk.publicKeyPem }).ok, false, 'an incomplete trust set fails closed');
  assert.equal(verifyBundle({ events: 'x' }, trustOf()).ok, false);
});

test('ST-05 forged sequence: a bundle with an unknown device and one with an event of a different delivery are reported', () => {
  const { v } = setup(); v.accept(buildStream(BASE, dev, SPECS));
  assert.ok(verifyBundle(v.exportBundle('D1'), trustOf({ deviceKeys: {} })).problems.some((p) => /not in the trust set/.test(p)));
  const b = v.exportBundle('D1'); b.deliveryId = 'D7';
  assert.ok(verifyBundle(b, trustOf()).problems.some((p) => /different delivery/.test(p)));
});

test('verifier construction fails closed when a parameter is missing', () => {
  assert.throws(() => createCustodyVerifier({ cell: { jurisdiction: 'SG' }, devices: {}, receiptKey: rk }), /no defaults/);
});

test('ST-05 forged sequence: the verifier keeps copies, so a caller that mutates a batch after acceptance cannot corrupt the delivery', () => {
  const { v } = setup(); const s = buildStream(BASE, dev, SPECS); v.accept(s);
  s[1].payload.massKg = '1.0'; s[2].hash = 'f'.repeat(64);
  assert.equal(verifyBundle(v.exportBundle('D1'), trustOf()).ok, true);
});

test('ST-05 forged sequence: prototype-named devices and keys are treated as unknown, not as errors', () => {
  const { v } = setup();
  const e = buildStream({ deliveryId: 'D1', deviceId: 'constructor' }, dev, SPECS.slice(0, 1));
  assert.deepEqual(reasons(v.accept(e)), ['device-not-assigned']);
  const b = v.exportBundle('D1'); b.events = buildStream({ deliveryId: 'D1', deviceId: 'constructor' }, dev, SPECS.slice(0, 1));
  assert.doesNotThrow(() => verifyBundle(b, trustOf())); assert.ok(verifyBundle(b, trustOf()).problems.some((p) => /not in the trust set/.test(p)));
});

test('ST-04 clock manipulation: the independent verifier also enforces key validFrom and the cell named in each receipt', () => {
  const { v } = setup(); v.accept(buildStream(BASE, dev, SPECS));
  const early = verifyBundle(v.exportBundle('D1'), trustOf({ deviceKeys: { 'mfm-1': { publicKeyPem: dev.publicKeyPem, validFrom: '2026-02-01T00:00:00Z' } } }));
  assert.ok(early.problems.some((p) => /before the device key was valid/.test(p)));
  const b = v.exportBundle('D1'); b.cell = { jurisdiction: 'MY' };
  assert.ok(verifyBundle(b, trustOf()).problems.some((p) => /different cell jurisdiction/.test(p)));
});

test('audit chain: edits, removals, reordering, insertion and tail truncation are detected', () => {
  const log = createAuditLog({ clock: () => NOW });
  for (let i = 0; i < 5; i++) log.append({ actorId: 'a', action: `act-${i}`, outcome: i % 2 ? 'denied' : 'allowed' });
  const head = log.head(); const copy = () => JSON.parse(JSON.stringify(log.entries()));
  assert.equal(verifyAuditLog(copy(), head).ok, true);
  let e = copy(); e[2].outcome = 'tampered'; assert.ok(verifyAuditLog(e, head).problems.some((p) => /altered/.test(p)));
  e = copy(); e.splice(1, 1); assert.equal(verifyAuditLog(e, head).ok, false);
  e = copy(); [e[1], e[2]] = [e[2], e[1]]; assert.equal(verifyAuditLog(e, head).ok, false);
  e = copy().slice(0, 4); assert.equal(verifyAuditLog(e).ok, true, 'without an anchor a truncated tail is undetectable');
  assert.ok(verifyAuditLog(e, head).problems.some((p) => /anchored head/.test(p)), 'with an anchored head it is detected');
  e = copy(); e.splice(2, 0, { ...e[1] }); assert.equal(verifyAuditLog(e, head).ok, false);
});

test('audit chain: recorded entries are frozen', () => {
  const log = createAuditLog({ clock: () => NOW }); const r = log.append({ actorId: 'a', action: 'x', outcome: 'allowed' });
  assert.throws(() => { 'use strict'; r.outcome = 'denied'; }, TypeError);
});
