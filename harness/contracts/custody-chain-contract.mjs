// CANDIDATE CONTRACT AND REFERENCE MODEL, NOT AN APPLICATION (Phase 0, HC-11). Synthetic data and TEST-ONLY keys. It decides nothing about key custody,
// trusted time or the tamper-evidence mechanism (D-013, D-021, ADR 0018); it states, as executable checks, properties that any such mechanism must give.
//
// Signed chain of custody for one delivery. Every event is bound to its delivery, device and key inside the signed hash; events from one device form a hash
// chain with contiguous sequence numbers; the verifier (not the sender) assigns the receipt time and signs a receipt per accepted event.
// What it adds to the ingestion candidate (ingestion-contract.mjs): AUTHENTICITY (a signature the sender must hold a key for) and a receipt that fixes when the
// verifier saw each event. A hash chain alone proves consistency, not authenticity; anyone can recompute valid hashes. Here a forged event needs the device key.
// Independent verification: verifyBundle() is a pure function of an exported bundle and a TRUST set supplied by the caller. It uses nothing from the verifier.
import crypto from 'node:crypto';
import { canonical, sha256 } from '../scripts/spec-validators.mjs';
import { ZERO } from './audit-chain.mjs';

export const CUSTODY_SCHEMA = 'greenfuel.custody-event/v0-candidate';
export const RECEIPT_SCHEMA = 'greenfuel.custody-receipt/v0-candidate';
export const KINDS = ['transfer-start', 'meter-reading', 'blend', 'evidence-bind', 'transfer-end'];
const ALG = 'ed25519';
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
const MAX_PAYLOAD = 2048;
const idOk = (v) => typeof v === 'string' && ID.test(v);
const isoOk = (v) => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v));
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function generateTestKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { privateKey, publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) };
}
export const keyIdOf = (publicKeyPem) => sha256(publicKeyPem).slice(0, 16);

// The signed content: everything that identifies the event, including the key id and algorithm, so metadata cannot be swapped without breaking the hash.
export const eventBody = (e) => ({ schema: e.schema, deliveryId: e.deliveryId, deviceId: e.deviceId, keyId: e.keyId, alg: e.alg, seq: e.seq, deviceTime: e.deviceTime, kind: e.kind, payload: e.payload, prevHash: e.prevHash });
export const eventHash = (e) => sha256(canonical(eventBody(e)));
const sign = (hash, privateKey) => crypto.sign(null, Buffer.from(hash, 'hex'), privateKey).toString('base64');
const verifySig = (hash, sig, pem) => { try { return crypto.verify(null, Buffer.from(hash, 'hex'), crypto.createPublicKey(pem), Buffer.from(String(sig), 'base64')); } catch { return false; } };

export function buildEvent({ deliveryId, deviceId, seq, deviceTime, kind, payload = {}, prevHash }, key) {
  const e = { schema: CUSTODY_SCHEMA, deliveryId, deviceId, keyId: keyIdOf(key.publicKeyPem), alg: ALG, seq, deviceTime, kind, payload, prevHash };
  const hash = eventHash(e);
  return { ...e, hash, sig: sign(hash, key.privateKey) };
}
// A device's honest event stream: chains each event to the previous one.
export function buildStream(base, key, specs) {
  const out = []; let prev = ZERO;
  specs.forEach((s, i) => { const e = buildEvent({ ...base, seq: i + 1, prevHash: prev, ...s }, key); out.push(e); prev = e.hash; });
  return out;
}

function shapeProblem(e) {
  if (!plain(e)) return 'not an object';
  if (e.schema !== CUSTODY_SCHEMA) return 'wrong schema';
  if (!idOk(e.deliveryId) || !idOk(e.deviceId) || !idOk(e.keyId)) return 'bad identifier';
  if (e.alg !== ALG) return 'unsupported algorithm';
  if (!Number.isSafeInteger(e.seq) || e.seq < 1) return 'bad sequence';
  if (!isoOk(e.deviceTime)) return 'bad time';
  if (!KINDS.includes(e.kind)) return 'unknown kind';
  if (!plain(e.payload) || JSON.stringify(e.payload).length > MAX_PAYLOAD) return 'bad payload';
  if (!HEX64.test(e.prevHash ?? '') || !HEX64.test(e.hash ?? '') || typeof e.sig !== 'string') return 'bad hash or signature field';
  return null;
}

export function createCustodyVerifier({ cell, devices, receiptKey, clock = () => new Date(), skewMs, maxAgeMs }) {
  if (!cell?.jurisdiction || !receiptKey || !devices || !Number.isFinite(skewMs) || !Number.isFinite(maxAgeMs)) throw new Error('cell, devices, receiptKey, skewMs and maxAgeMs are all required: there are no defaults');
  const deliveries = new Map(); const naturalKeys = new Map();
  const receiptKeyId = keyIdOf(receiptKey.publicKeyPem);

  function openDelivery({ deliveryId, bargeId, vesselId, plannedStart, deviceIds }) {
    if (![deliveryId, bargeId, vesselId].every(idOk) || !isoOk(plannedStart) || !Array.isArray(deviceIds) || !deviceIds.every(idOk)) return { ok: false, reason: 'malformed' };
    if (deliveries.has(deliveryId)) return { ok: false, reason: 'duplicate-delivery' };
    // One physical transfer must not become two deliveries: the natural key is barge, vessel and the planned start minute.
    const nk = sha256(canonical([bargeId, vesselId, plannedStart.slice(0, 16)]));
    if (naturalKeys.has(nk)) return { ok: false, reason: 'duplicate-transfer' };
    naturalKeys.set(nk, deliveryId);
    deliveries.set(deliveryId, { deviceIds: new Set(deviceIds), ended: false, started: false, events: [], receipts: [], heads: new Map(), bySeq: new Map() });
    return { ok: true };
  }

  function accept(batch) {
    const result = { accepted: [], duplicates: [], rejected: [] };
    for (const e of Array.isArray(batch) ? batch : []) {
      const reject = (reason) => result.rejected.push({ seq: Number.isSafeInteger(e?.seq) ? e.seq : null, reason });
      const shape = shapeProblem(e); if (shape) { reject('malformed'); continue; }
      const d = deliveries.get(e.deliveryId);
      if (!d) { reject('unknown-delivery'); continue; }
      if (!d.deviceIds.has(e.deviceId)) { reject('device-not-assigned'); continue; }
      const dev = Object.prototype.hasOwnProperty.call(devices, e.deviceId) ? devices[e.deviceId] : null; const now = clock();
      if (!dev || e.keyId !== keyIdOf(dev.publicKeyPem)) { reject('unknown-key'); continue; }
      if (dev.revokedAt && Date.parse(dev.revokedAt) <= now.getTime()) { reject('key-revoked'); continue; }
      if ((dev.validFrom && Date.parse(dev.validFrom) > now.getTime()) || (dev.validTo && Date.parse(dev.validTo) < now.getTime())) { reject('key-not-valid'); continue; }
      if (dev.jurisdiction !== cell.jurisdiction) { reject('jurisdiction-mismatch'); continue; }
      if (eventHash(e) !== e.hash) { reject('hash-mismatch'); continue; }
      if (!verifySig(e.hash, e.sig, dev.publicKeyPem)) { reject('bad-signature'); continue; }
      const head = d.heads.get(e.deviceId) ?? { seq: 0, hash: ZERO, deviceTime: null };
      const key = `${e.deviceId}#${e.seq}`;
      if (d.bySeq.has(key)) { if (d.bySeq.get(key) === e.hash) result.duplicates.push({ seq: e.seq }); else reject('conflicting-replay'); continue; }
      // A retry of an already-accepted event stays idempotent after the end; only genuinely new events are refused.
      if (d.ended) { reject('after-end'); continue; }
      if (e.seq !== head.seq + 1) { reject('gap'); continue; }
      if (e.prevHash !== head.hash) { reject('chain-break'); continue; }
      const t = Date.parse(e.deviceTime);
      if (head.deviceTime !== null && t < head.deviceTime) { reject('time-regression'); continue; }
      if (t > now.getTime() + skewMs) { reject('future-dated'); continue; }
      if (now.getTime() - t > maxAgeMs) { reject('too-old'); continue; }
      if (e.kind === 'transfer-start' && d.started) { reject('duplicate-start'); continue; }
      if (e.kind !== 'transfer-start' && !d.started) { reject('before-start'); continue; }
      const rb = { schema: RECEIPT_SCHEMA, deliveryId: e.deliveryId, deviceId: e.deviceId, seq: e.seq, eventHash: e.hash, receivedAt: now.toISOString(), cellJurisdiction: cell.jurisdiction, receiptKeyId };
      const rh = sha256(canonical(rb));
      // Stored as copies: a caller that keeps a reference to the batch cannot alter what the verifier holds.
      d.events.push(JSON.parse(JSON.stringify(e))); d.receipts.push({ ...rb, hash: rh, sig: sign(rh, receiptKey.privateKey) });
      d.heads.set(e.deviceId, { seq: e.seq, hash: e.hash, deviceTime: t }); d.bySeq.set(key, e.hash);
      if (e.kind === 'transfer-start') d.started = true;
      if (e.kind === 'transfer-end') d.ended = true;
      result.accepted.push({ seq: e.seq });
    }
    return result;
  }

  function exportBundle(deliveryId) {
    const d = deliveries.get(deliveryId); if (!d) return null;
    return JSON.parse(JSON.stringify({ schema: 'greenfuel.custody-bundle/v0-candidate', cell, deliveryId, events: d.events, receipts: d.receipts, receiptPublicKeyPem: receiptKey.publicKeyPem, deviceKeys: Object.fromEntries([...d.deviceIds].map((id) => [id, devices[id]?.publicKeyPem])) }));
  }
  return { openDelivery, accept, exportBundle };
}

// Independent verification. `trust` = { deviceKeys: { deviceId: { publicKeyPem, validFrom?, validTo?, revokedAt? } }, receiptPublicKeyPem, skewMs }.
// The keys inside the bundle are IGNORED for trust: a forger can put any key in a bundle.
export function verifyBundle(bundle, trust) {
  const problems = []; const add = (m) => problems.push(m);
  if (!plain(bundle) || !Array.isArray(bundle.events) || !Array.isArray(bundle.receipts)) return { ok: false, problems: ['not a custody bundle'], complete: false };
  if (!trust?.receiptPublicKeyPem || !plain(trust.deviceKeys) || !Number.isFinite(trust.skewMs)) return { ok: false, problems: ['trust set is incomplete: device keys, receipt key and skew are required'], complete: false };
  const byDevice = new Map();
  for (const e of bundle.events) {
    if (shapeProblem(e)) { add(`event ${String(e?.seq)}: malformed`); continue; }
    if (e.deliveryId !== bundle.deliveryId) add(`event ${e.deviceId}#${e.seq}: belongs to a different delivery`);
    byDevice.set(e.deviceId, [...(byDevice.get(e.deviceId) ?? []), e]);
  }
  const rcpt = new Map();
  for (const r of bundle.receipts) {
    const { hash, sig, ...rb } = r;
    if (sha256(canonical(rb)) !== hash) add(`receipt ${r.deviceId}#${r.seq}: altered`);
    else if (!verifySig(hash, sig, trust.receiptPublicKeyPem)) add(`receipt ${r.deviceId}#${r.seq}: not signed by the trusted receipt key`);
    const k = `${r.deviceId}#${r.seq}`; if (rcpt.has(k)) add(`receipt ${k}: duplicated`); rcpt.set(k, r);
  }
  let started = false; let ended = false; const kinds = new Set();
  for (const [deviceId, evs] of byDevice) {
    const tk = Object.prototype.hasOwnProperty.call(trust.deviceKeys, deviceId) ? trust.deviceKeys[deviceId] : null;
    if (!tk) { add(`device ${deviceId}: not in the trust set`); continue; }
    let prev = ZERO; let prevT = null;
    evs.forEach((e, i) => {
      const at = `${deviceId}#${e.seq}`;
      if (e.seq !== i + 1) add(`${at}: sequence is not contiguous from 1 (an event is missing, inserted or reordered)`);
      if (e.prevHash !== prev) add(`${at}: does not continue the previous event (chain broken)`);
      if (eventHash(e) !== e.hash) add(`${at}: altered (content does not match its hash)`);
      if (e.keyId !== keyIdOf(tk.publicKeyPem)) add(`${at}: signed under a key that is not the trusted key for this device`);
      else if (!verifySig(e.hash, e.sig, tk.publicKeyPem)) add(`${at}: signature does not verify (forged or altered)`);
      const r = rcpt.get(at);
      if (!r) add(`${at}: no receipt (the verifier never accepted it, or the receipt was removed)`);
      else {
        if (r.eventHash !== e.hash) add(`${at}: the receipt is for different content`);
        const rt = Date.parse(r.receivedAt);
        if (tk.validFrom && Date.parse(tk.validFrom) > rt) add(`${at}: received before the device key was valid`);
        if (tk.revokedAt && Date.parse(tk.revokedAt) <= rt) add(`${at}: received after the device key was revoked`);
        if (r.cellJurisdiction !== bundle.cell?.jurisdiction) add(`${at}: the receipt names a different cell jurisdiction than the bundle`);
        if (tk.validTo && Date.parse(tk.validTo) < rt) add(`${at}: received after the device key expired`);
        if (Date.parse(e.deviceTime) > rt + trust.skewMs) add(`${at}: device time is later than the receipt allows (forward-dated)`);
      }
      if (prevT !== null && Date.parse(e.deviceTime) < prevT) add(`${at}: device time goes backwards`);
      prevT = Date.parse(e.deviceTime); prev = e.hash; kinds.add(e.kind);
      if (e.kind === 'transfer-start') { if (started) add(`${at}: a second transfer-start`); started = true; }
      if (e.kind === 'transfer-end') ended = true;
    });
  }
  const keys = new Set([...byDevice].flatMap(([d, evs]) => evs.map((e) => `${d}#${e.seq}`)));
  for (const k of rcpt.keys()) if (!keys.has(k)) add(`receipt ${k}: the event it covers is missing (deleted from the bundle)`);
  const complete = started && ended && kinds.has('meter-reading');
  return { ok: problems.length === 0, problems, complete, started, ended, events: bundle.events.length };
}
