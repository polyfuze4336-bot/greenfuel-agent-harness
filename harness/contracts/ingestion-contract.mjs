// CANDIDATE CONTRACT AND REFERENCE MODEL, NOT AN APPLICATION. It states, as executable checks, what the jurisdiction-local, tamper-evident
// evidence ingestion subsystem of DES-0002 must guarantee, so the design can be tested before any application exists (Phase 0, HC-11).
// It works on synthetic fixtures only. The schema id ends in v0-candidate: it is a test oracle for ideas under decision, not a decision.
//
// Trust model, stated plainly because an independent review found the first version got it wrong:
//   - The VERIFIER owns the cell identity (jurisdiction and zone), the registry of sources and devices, the permitted clock skew and the
//     receiving clock. A batch's own claims are compared with those, never with each other, and a batch carries no receivedAt or policy.
//   - A hash chain gives integrity and consistency, not authenticity: anyone who can reach the endpoint can compute valid hashes.
//     Authenticity needs signing, whose mechanism is open (D-013). Every accepted record is therefore marked 'unauthenticated' and an
//     evidence package must not treat it as trusted until signing exists. Registering a source narrows who may send; it does not
//     prove who did.
//   - Identifiers are external input. They match a strict pattern, live in Maps (never on plain objects), and are namespaced by source.
// What it checks: integrity (a hash chain over events), ordering (contiguous sequence, no gaps), idempotent redelivery after a broken
// link (NFR-005), conflicting replays (replacement), timestamps (ADR 0013, against the VERIFIER's clock), jurisdiction and zone against
// the verifier's identity, provenance (no model origin, a registered device, kind-specific payloads, HC-06), missing readings (never
// estimated), stored history (verifyStore detects deletion and modification of what was accepted) and size limits.
import { canonical, sha256 } from '../scripts/spec-validators.mjs';

export const INGESTION_SCHEMA = 'greenfuel.ingestion-batch/v0-candidate';
export const KINDS = ['transfer-start', 'meter-reading', 'blend', 'transfer-end'];
export const ORIGINS = ['device', 'operator', 'import'];
// Working values chosen by this design, not measurements. They bound the work a single unauthenticated batch can cause.
export const LIMITS = { maxEventsPerBatch: 500, maxPayloadChars: 1024, maxPayloadDepth: 3 };
const LOCAL_ZONES = ['Z1', 'Z2'];
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const UNIT = /^[A-Za-z][A-Za-z0-9/._-]{0,15}$/;
const NOTE = /^[A-Za-z0-9 ._:-]{0,64}$/;
const isoOk = (v) => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v));
const idOk = (v) => typeof v === 'string' && ID.test(v);
// Only a value that matches the identifier pattern is ever echoed into a message, so a hostile identifier cannot reach a report or a log.
const show = (v) => (idOk(v) ? v : '?');
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// A number from a batch is echoed only when it is a safe integer; anything else (a string, an array) becomes a question mark.
const num = (v) => (Number.isSafeInteger(v) ? v : '?');
// Iterative, so a payload nested very deeply cannot overflow the stack before the depth rule is applied.
function nestingOk(v, maxDepth) {
  const stack = [[v, 1]]; let nodes = 0;
  while (stack.length) {
    const [x, d] = stack.pop();
    if (d > maxDepth || ++nodes > 200) return false;
    if (x !== null && typeof x === 'object') for (const k of Object.keys(x)) stack.push([x[k], d + 1]);
  }
  return true;
}

export const eventHash = (e) => { const { eventSha256, ...rest } = e; return sha256(canonical(rest)); };
export const batchHash = (b) => { const { batchSha256, ...rest } = b; return sha256(canonical(rest)); };
// A commitment over what the cell recorded about an event: the event, when the verifier accepted it, in which batch, and its authenticity
// mark. It catches a casual edit of any of those. It is not tamper-proof: whoever can write the store can recompute it (needs an external anchor).
export const recordHash = (r) => sha256(canonical({ event: r.event, acceptedAt: r.acceptedAt, batchId: r.batchId, authenticity: r.authenticity }));

const unknownKeys = (o, allowed) => Object.keys(o).filter((k) => !allowed.includes(k));

// Recursively checks a payload: plain objects with safe keys, finite numbers (JSON.stringify turns Infinity and NaN into null, so a changed
// value would hash as if unchanged), no negative zero (it serialises as 0), strings of bounded length, a bounded depth.
function payloadProblems(v, depth, bad, at) {
  if (depth > LIMITS.maxPayloadDepth) return bad(`${at}: payload nests deeper than allowed`);
  if (typeof v === 'number') { if (!Number.isFinite(v) || Object.is(v, -0)) bad(`${at}: a payload number must be finite and not negative zero`); return; }
  if (typeof v === 'string') { if (v.length > 128) bad(`${at}: a payload string is too long`); return; }
  if (typeof v === 'boolean') return;
  if (Array.isArray(v) || v === null || typeof v !== 'object') return bad(`${at}: a payload holds only objects, strings, numbers and booleans`);
  for (const k of Object.keys(v)) { if (!KEY.test(k)) bad(`${at}: a payload key is not allowed`); else payloadProblems(v[k], depth + 1, bad, at); }
}
function kindProblems(e, bad, at) {
  const p = e.payload;
  const only = (keys) => { const extra = Object.keys(p).filter((k) => !keys.includes(k)); if (extra.length) bad(`${at}: ${e.kind} payload has fields it may not have`); };
  if (e.kind === 'meter-reading') { only(['unit', 'value']); if (typeof p.value !== 'number') bad(`${at}: a meter reading needs a numeric value`); if (typeof p.unit !== 'string' || !UNIT.test(p.unit)) bad(`${at}: a meter reading needs a unit`); }
  else if (e.kind === 'blend') { only(['product', 'enteredBy', 'approvedBy']); for (const k of ['product', 'enteredBy', 'approvedBy']) if (!idOk(p[k])) bad(`${at}: a blend entry needs ${k} (FR-002: source and who entered and approved it)`); }
  else if (e.kind === 'transfer-start' || e.kind === 'transfer-end') { only(['note']); if (p.note !== undefined && !(typeof p.note === 'string' && NOTE.test(p.note))) bad(`${at}: note is not allowed`); }
}

// The verifier's own configuration. Throws on a bad one: it is configuration, not input.
export function makeStore({ cell, maxSkewSeconds, maxEventAgeSeconds, sources }) {
  if (!plain(cell) || !idOk(cell.jurisdictionCode) || cell.zone !== 'Z2') throw new TypeError('cell needs a jurisdictionCode and zone Z2');
  if (!Number.isInteger(maxSkewSeconds) || maxSkewSeconds <= 0) throw new TypeError('maxSkewSeconds is required and has no default: it comes from the equipment clock specification (ADR 0013)');
  if (!Number.isInteger(maxEventAgeSeconds) || maxEventAgeSeconds <= 0) throw new TypeError('maxEventAgeSeconds is required and has no default: it follows the maximum disconnection (D-020), so an offline edge may deliver late but an event cannot be backdated without limit');
  if (!Array.isArray(sources) || !sources.length) throw new TypeError('at least one registered source is required');
  const registry = new Map();
  for (const s of sources) {
    if (!idOk(s.sourceId) || !idOk(s.jurisdictionCode) || !idOk(s.clockSource) || !Array.isArray(s.deviceIds) || !s.deviceIds.length || !s.deviceIds.every(idOk)) throw new TypeError('a registered source needs sourceId, jurisdictionCode, clockSource and deviceIds');
    if (s.jurisdictionCode !== cell.jurisdictionCode) throw new TypeError('a source registered to another jurisdiction cannot feed this cell (HC-01)');
    registry.set(s.sourceId, { jurisdictionCode: s.jurisdictionCode, clockSource: s.clockSource, deviceIds: [...s.deviceIds] });
  }
  return { cell: { ...cell }, maxSkewSeconds, maxEventAgeSeconds, registry, heads: new Map(), events: new Map(), batches: [], deliveries: new Map(), gaps: new Map() };
}

// Problems that make one batch unacceptable. `store` supplies the verifier's identity and registry; `receivedAt` is the verifier's clock.
export function verifyBatch(b, store, receivedAt) {
  const p = []; const bad = (m) => p.push(m);
  if (!plain(b)) return ['batch must be an object'];
  if (!store?.cell || !store.registry) return ['the verifier has no identity: a batch cannot be checked against nothing'];
  if (!isoOk(receivedAt)) return ['the verifier must supply its own receiving time'];
  for (const k of unknownKeys(b, ['schema', 'synthetic', 'batchId', 'source', 'routing', 'events', 'batchSha256'])) bad(`unknown batch field ${show(k)}`);
  if (b.schema !== INGESTION_SCHEMA) bad(`schema must be ${INGESTION_SCHEMA}`);
  if (b.synthetic !== true) bad('synthetic must be true: this contract is exercised on synthetic fixtures only');
  if (!idOk(b.batchId)) bad('batchId is required and must match the identifier pattern');
  const src = b.source; const route = b.routing;
  if (!plain(src) || !plain(route)) { bad('source and routing are required'); return p; }
  for (const k of unknownKeys(src, ['sourceId', 'jurisdictionCode', 'zone', 'clockSource'])) bad(`unknown source field ${show(k)}`);
  for (const k of unknownKeys(route, ['destinationJurisdictionCode', 'destinationZone'])) bad(`unknown routing field ${show(k)}`);
  if (!idOk(src.sourceId) || !idOk(src.clockSource)) bad('source needs a sourceId and a clockSource that match the identifier pattern');
  const reg = idOk(src.sourceId) ? store.registry.get(src.sourceId) : undefined;
  if (!reg) bad('the source is not registered with this cell');
  // jurisdiction: every claim is compared with what the verifier knows, never with the other claims
  if (src.jurisdictionCode !== store.cell.jurisdictionCode) bad('the source claims a jurisdiction other than this cell: data never crosses a border by ingestion (HC-01)');
  if (route.destinationJurisdictionCode !== store.cell.jurisdictionCode) bad('the destination is not this cell\'s jurisdiction (HC-01)');
  if (!LOCAL_ZONES.includes(src.zone)) bad('the source must be inside the jurisdiction (Z1 or Z2)');
  if (route.destinationZone !== store.cell.zone) bad('the destination zone must be this cell\'s zone: a region is not a residency control (HC-01)');
  if (reg && src.clockSource !== reg.clockSource) bad('the clock source is not the one registered for this source (ADR 0013)');
  const ev = b.events;
  if (!Array.isArray(ev) || !ev.length) { bad('events must be a non-empty list'); return p; }
  if (ev.length > LIMITS.maxEventsPerBatch) { bad('the batch has more events than the verifier accepts'); return p; }
  const ids = new Set(); let prev = null; let hashable = true; const recv = Date.parse(receivedAt);
  ev.forEach((e, i) => {
    const at = `event ${show(e?.eventId)}#${i}`;
    if (!plain(e)) { bad(`${at}: must be an object`); return; }
    for (const k of unknownKeys(e, ['eventId', 'sourceId', 'deviceId', 'deliveryId', 'sequence', 'kind', 'origin', 'trustedTime', 'payload', 'prevEventSha256', 'eventSha256'])) bad(`${at}: unknown event field ${show(k)}`);
    if (!idOk(e.eventId)) bad(`${at}: eventId is required and must match the identifier pattern`);
    else if (ids.has(e.eventId)) bad(`${at}: duplicate eventId inside the batch`);
    ids.add(e.eventId);
    if (e.sourceId !== src.sourceId) bad(`${at}: the event is not bound to the batch's source`);
    if (!idOk(e.deviceId)) bad(`${at}: deviceId is required (FR-001)`);
    else if (reg && !reg.deviceIds.includes(e.deviceId)) bad(`${at}: the device is not registered for this source`);
    if (!idOk(e.deliveryId)) bad(`${at}: deliveryId is required and must match the identifier pattern`);
    if (!Number.isInteger(e.sequence) || e.sequence < 1) bad(`${at}: sequence must be a positive integer`);
    else if (prev && e.sequence !== prev.sequence + 1) bad(`${at}: sequence ${num(e.sequence)} follows ${num(prev.sequence)}: a gap or a reorder inside a batch`);
    if (!KINDS.includes(e.kind)) bad(`${at}: kind must be one of ${KINDS.join(', ')}`);
    if (e.origin === 'model') bad(`${at}: a model cannot be the origin of a record (HC-06)`);
    else if (!ORIGINS.includes(e.origin)) bad(`${at}: origin must be one of ${ORIGINS.join(', ')}`);
    if (!isoOk(e.trustedTime)) bad(`${at}: trustedTime must be an ISO time`);
    else {
      if (prev && isoOk(prev.trustedTime) && Date.parse(e.trustedTime) < Date.parse(prev.trustedTime)) bad(`${at}: trustedTime goes backwards within the source (ADR 0013)`);
      if (Date.parse(e.trustedTime) > recv + store.maxSkewSeconds * 1000) bad(`${at}: trustedTime is later than the verifier's clock plus the permitted skew (ADR 0013)`);
      if (Date.parse(e.trustedTime) < recv - store.maxEventAgeSeconds * 1000) bad(`${at}: trustedTime is older than the verifier accepts: an event cannot be backdated without limit`);
    }
    let payloadOk = false;
    if (plain(e.payload)) {
      if (!nestingOk(e.payload, LIMITS.maxPayloadDepth)) bad(`${at}: payload nests deeper or wider than allowed`);
      else if (JSON.stringify(e.payload).length > LIMITS.maxPayloadChars) bad(`${at}: payload is too large`);
      else { payloadOk = true; payloadProblems(e.payload, 1, bad, at); kindProblems(e, bad, at); }
    } else bad(`${at}: payload must be an object`);
    // hashing recurses, so it is done only for a payload that already passed the nesting and size rules
    if (!payloadOk) hashable = false;
    else if (!HEX64.test(e.eventSha256 ?? '') || eventHash(e) !== e.eventSha256) bad(`${at}: eventSha256 does not match the event`);
    if (e.sequence === 1) { if (e.prevEventSha256 !== null) bad(`${at}: sequence 1 must have prevEventSha256 null`); }
    else if (i === 0) { if (!HEX64.test(e.prevEventSha256 ?? '')) bad(`${at}: a later sequence needs the hash of the event before it`); }
    else if (e.prevEventSha256 !== prev.eventSha256) bad(`${at}: prevEventSha256 does not link to the previous event: the chain is broken`);
    prev = e;
  });
  if (hashable && (!HEX64.test(b.batchSha256 ?? '') || batchHash(b) !== b.batchSha256)) bad('batchSha256 does not match the batch');
  return p;
}

const key = (sourceId, id) => `${sourceId}/${id}`;
const newDelivery = () => ({ started: false, readings: 0, ended: false, afterEnd: 0, anomalies: 0 });
// One lifecycle rule, used both when events are accepted and when the stored state is re-derived. Nothing is refused here: an event that
// breaks the lifecycle (no start, a second start, an event after the end) is KEPT as evidence and flagged for a person, because refusing it
// would discard evidence and stall the source.
function applyEvent(d, e) {
  if (d.ended) { d.afterEnd += 1; return; }
  if (e.kind === 'transfer-start') { if (d.started) d.anomalies += 1; d.started = true; return; }
  if (!d.started) d.anomalies += 1;
  if (e.kind === 'meter-reading') d.readings += 1;
  if (e.kind === 'transfer-end') d.ended = true;
}
const reject = (store, problems, extra = {}) => ({ outcome: 'Rejected', store, accepted: 0, duplicates: 0, problems, authenticity: null, ...extra });

// Reference model of the ingestion decision. Pure: it returns a new store and never changes the one it is given, and it copies the store
// only when it accepts or holds. `receivedAt` is the VERIFIER's clock, recorded as acceptedAt for each event.
// Outcomes: Accepted, AlreadyIngested (every event is a known repeat), Held (an earlier event is missing: the gap is recorded with the time it
// was first seen and nothing from the batch is taken, so the edge keeps it), Rejected (inconsistent: nothing is taken, evidence is preserved).
export function ingest(store, batch, receivedAt) {
  const problems = verifyBatch(batch, store, receivedAt);
  if (problems.length) return reject(store, problems);
  const sid = batch.source.sourceId; const head = store.heads.get(sid) ?? { lastSequence: 0, lastEventSha256: null, lastTrustedTime: null };
  let duplicates = 0; const fresh = [];
  for (const e of batch.events) {
    const known = store.events.get(key(sid, e.eventId));
    if (known === undefined) { fresh.push(e); continue; }
    if (known.event.eventSha256 !== e.eventSha256) return reject(store, [`event ${show(e.eventId)} replays an accepted event with different content: possible replacement or tamper`], { duplicates });
    duplicates += 1;
  }
  if (!fresh.length) return { outcome: 'AlreadyIngested', store, accepted: 0, duplicates, problems: [], authenticity: 'unauthenticated' };
  const first = fresh[0];
  if (first.sequence > head.lastSequence + 1) {
    const gap = { from: head.lastSequence + 1, to: first.sequence - 1 };
    const next = structuredClone(store); if (!next.gaps.has(sid)) next.gaps.set(sid, { ...gap, firstSeenAt: receivedAt });
    return { outcome: 'Held', store: next, accepted: 0, duplicates, gap, problems: [], authenticity: null };
  }
  if (first.sequence <= head.lastSequence) return reject(store, [`event ${show(first.eventId)} has sequence ${first.sequence} that is already used by another event`], { duplicates });
  if (first.prevEventSha256 !== head.lastEventSha256) return reject(store, [`event ${show(first.eventId)} does not link to the last accepted event of ${sid}: the chain is broken`], { duplicates });
  if (head.lastTrustedTime && Date.parse(first.trustedTime) < Date.parse(head.lastTrustedTime)) return reject(store, [`event ${show(first.eventId)} is timed before the last accepted event of ${sid} (ADR 0013)`], { duplicates });
  const next = structuredClone(store); const h = { ...head };
  for (const e of fresh) {
    const dk = key(sid, e.deliveryId); const d = next.deliveries.get(dk) ?? newDelivery();
    applyEvent(d, e);
    next.deliveries.set(dk, d);
    const rec = { event: structuredClone(e), acceptedAt: receivedAt, batchId: batch.batchId, authenticity: 'unauthenticated' };
    next.events.set(key(sid, e.eventId), { ...rec, recordSha256: recordHash(rec) });
    h.lastSequence = e.sequence; h.lastEventSha256 = e.eventSha256; h.lastTrustedTime = e.trustedTime;
  }
  next.heads.set(sid, h); next.gaps.delete(sid);
  next.batches.push({ batchId: batch.batchId, sourceId: sid, batchSha256: batch.batchSha256, headEventId: fresh.at(-1).eventId, headEventSha256: h.lastEventSha256, acceptedAt: receivedAt });
  return { outcome: 'Accepted', store: next, accepted: fresh.length, duplicates, problems: [], authenticity: 'unauthenticated' };
}

// Independent check of what was ACCEPTED, from the stored records alone: every source's chain is contiguous from sequence 1, every stored
// event hashes to itself and links to its predecessor, time does not go backwards, the head matches, and every batch commitment still points
// at a stored event. A deleted or edited historical record is found here, which the ingestion path cannot show.
export function verifyStore(store) {
  const p = []; const bySource = new Map();
  // A source is anything that has events, a head or a batch commitment, so removing one of them cannot hide the others. Each map key must
  // agree with the record it holds, and a record is only read after its shape is checked, so a malformed store is reported and never crashes.
  const sources = new Set([...store.heads.keys(), ...store.batches.map((b) => b.sourceId)]);
  for (const [k, r] of store.events) {
    if (!plain(r) || !plain(r.event) || typeof r.event.sourceId !== 'string' || key(r.event.sourceId, r.event.eventId) !== k) { p.push('a stored record is malformed or is filed under a key that does not match it'); continue; }
    const sid = r.event.sourceId; sources.add(sid); if (!bySource.has(sid)) bySource.set(sid, []); bySource.get(sid).push(r);
  }
  for (const sid of sources) {
    const head = store.heads.get(sid); const recs = (bySource.get(sid) ?? []).sort((a, b) => num(a.event.sequence) - num(b.event.sequence));
    if (!head) { p.push(`${show(sid)}: events or batch commitments exist but no head is recorded for the source: the head was removed`); continue; }
    let prev = null;
    for (let i = 0; i < head.lastSequence; i += 1) {
      const r = recs[i];
      if (!r || r.event.sequence !== i + 1) { p.push(`${show(sid)}: the record for sequence ${i + 1} is missing: a stored event was deleted`); break; }
      if (eventHash(r.event) !== r.event.eventSha256) p.push(`${show(sid)}: stored event ${show(r.event.eventId)} no longer matches its hash: it was changed`);
      if (recordHash(r) !== r.recordSha256) p.push(`${show(sid)}: stored record of ${show(r.event.eventId)} no longer matches its commitment: its acceptance time, batch or authenticity mark was changed`);
      if ((r.event.prevEventSha256 ?? null) !== (prev?.eventSha256 ?? null)) p.push(`${show(sid)}: stored event ${show(r.event.eventId)} does not link to its predecessor`);
      if (prev && Date.parse(r.event.trustedTime) < Date.parse(prev.trustedTime)) p.push(`${show(sid)}: stored event ${show(r.event.eventId)} is timed before its predecessor`);
      prev = r.event;
    }
    if (recs.length !== head.lastSequence) p.push(`${show(sid)}: ${recs.length} stored events for a head at sequence ${num(head.lastSequence)}: extra or missing records`);
    if (prev && prev.eventSha256 !== head.lastEventSha256) p.push(`${show(sid)}: the stored chain does not end at the recorded head`);
  }
  for (const b of store.batches) {
    const r = store.events.get(key(b.sourceId, b.headEventId));
    if (!r || r.event?.eventSha256 !== b.headEventSha256) p.push(`batch ${show(b.batchId)}: the event it committed to is missing or changed`);
  }
  // delivery state is derived data: it is recomputed from the stored events and must match, so editing it cannot hide a missing reading
  const derived = new Map();
  for (const [sid, recs] of bySource) for (const r of [...recs].sort((a, b) => num(a.event.sequence) - num(b.event.sequence))) {
    const dk = key(sid, r.event.deliveryId); const d = derived.get(dk) ?? newDelivery(); applyEvent(d, r.event); derived.set(dk, d);
  }
  if (canonical([...derived].sort()) !== canonical([...store.deliveries].sort())) p.push('the delivery state does not match the stored events: it was edited, so a missing reading may be hidden');
  return p;
}

// A delivery that ended with no meter reading is incomplete evidence. It is reported, never estimated or filled with a default (HC-06).
export const incompleteDeliveries = (store) => [...store.deliveries].filter(([, d]) => d.ended && d.readings === 0).map(([k]) => k).sort();
// Deliveries whose lifecycle was irregular: an event with no start, a second start, or an event after the end. The events are kept as evidence
// and the delivery is flagged for a person to review.
export const anomalousDeliveries = (store) => [...store.deliveries].filter(([, d]) => d.afterEnd > 0 || d.anomalies > 0).map(([k]) => k).sort();
// A gap open since the time shown: the cell can alert on its age. Nothing in the model sets a threshold.
export const openGaps = (store) => [...store.gaps].map(([sourceId, g]) => ({ sourceId, ...g })).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
