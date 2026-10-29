// Synthetic builders for the ingestion contract tests. Every value is invented for a test: no real delivery, vessel, port or measurement.
import { eventHash, batchHash, makeStore, INGESTION_SCHEMA } from '../../harness/contracts/ingestion-contract.mjs';

const T0 = Date.parse('2030-01-01T00:00:00Z');
export const iso = (sec) => new Date(T0 + sec * 1000).toISOString().replace('.000Z', 'Z');
export const RECEIVED = iso(3600); // the verifier's clock for most tests
export const SKEW = 120;
export const MAX_AGE = 100000000; // a synthetic test value, far larger than any fixture age

// The verifier's own configuration: it, not the batch, decides the jurisdiction, the sources, the devices, the skew and the permitted age.
export function newStore({ jurisdictionCode = 'JUR-SYN', maxSkewSeconds = SKEW, maxEventAgeSeconds = MAX_AGE, sources } = {}) {
  return makeStore({
    cell: { jurisdictionCode, zone: 'Z2' }, maxSkewSeconds, maxEventAgeSeconds,
    sources: sources ?? [
      { sourceId: 'EDGE-SYN-1', jurisdictionCode, clockSource: 'CLOCK-SYN-1', deviceIds: ['DEV-SYN-1', 'DEV-SYN-2'] },
      { sourceId: 'EDGE-SYN-2', jurisdictionCode, clockSource: 'CLOCK-SYN-2', deviceIds: ['DEV-SYN-9'] },
    ],
  });
}

// Recomputes every event hash along the chain and the batch hash, so a test starts from a consistent batch and then breaks one thing.
export function seal(b) {
  let prev = b.events[0].prevEventSha256 ?? null;
  for (const e of b.events) { e.prevEventSha256 = e.sequence === 1 ? null : prev; e.eventSha256 = eventHash(e); prev = e.eventSha256; }
  b.batchSha256 = batchHash(b);
  return b;
}

export function makeBatch({ batchId = 'BATCH-SYN-1', sourceId = 'EDGE-SYN-1', clockSource, deviceId = 'DEV-SYN-1', firstSequence = 1, prev = null, kinds = ['transfer-start', 'meter-reading', 'meter-reading', 'transfer-end'], deliveryId = 'DEL-SYN-1', startSeconds = 0, jurisdictionCode = 'JUR-SYN' } = {}) {
  const payloadOf = (kind, i) => (kind === 'meter-reading' ? { unit: 'kg', value: 1000 + i } : kind === 'blend' ? { product: 'PRODUCT-SYN-1', enteredBy: 'OPERATOR-SYN-1', approvedBy: 'OPERATOR-SYN-2' } : { note: 'synthetic' });
  const events = kinds.map((kind, i) => ({
    eventId: `${sourceId}-${firstSequence + i}`, sourceId, deviceId, deliveryId, sequence: firstSequence + i, kind, origin: 'device', trustedTime: iso(startSeconds + i * 10),
    payload: payloadOf(kind, i), prevEventSha256: i === 0 ? prev : null, eventSha256: '',
  }));
  return seal({
    schema: INGESTION_SCHEMA, synthetic: true, batchId,
    source: { sourceId, jurisdictionCode, zone: 'Z1', clockSource: clockSource ?? (sourceId === 'EDGE-SYN-2' ? 'CLOCK-SYN-2' : 'CLOCK-SYN-1') },
    routing: { destinationJurisdictionCode: jurisdictionCode, destinationZone: 'Z2' }, events, batchSha256: '',
  });
}

// A consecutive batch from the same source: it starts where the first ended.
export function continuation(first, opts = {}) {
  const last = first.events.at(-1);
  return makeBatch({ batchId: 'BATCH-SYN-2', firstSequence: last.sequence + 1, prev: last.eventSha256, startSeconds: 100, kinds: ['meter-reading', 'meter-reading'], deliveryId: last.deliveryId, ...opts });
}
export const clone = (o) => JSON.parse(JSON.stringify(o));
