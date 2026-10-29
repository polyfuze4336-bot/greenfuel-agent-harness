// Executable evaluation checks for the PRODUCTION suite, ingestion contract scope (DES-0002). They run faulty or hostile SYNTHETIC batches
// through the candidate ingestion contract and its reference model. That tests the contract oracle, not any deployed system: nothing is
// deployed and no Azure call is made. A PASS means "the candidate contract handles this case"; it is not evidence about a production
// ingestion service, which does not exist, and it says nothing about authenticity (signing is undecided, D-013): every accepted record is
// marked unauthenticated. The hostile cases come from an independent review of the first version of the contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyBatch, ingest, verifyStore, incompleteDeliveries, openGaps, eventHash, batchHash } from '../../harness/contracts/ingestion-contract.mjs';
import { makeBatch, continuation, seal, clone, iso, newStore, RECEIVED } from '../../tests/support/ingestion-fixtures.mjs';

const rejects = (b, re, what, s = newStore()) => { const p = verifyBatch(b, s, RECEIVED); assert.ok(p.some((m) => re.test(m)), `${what}: ${p.join(' | ') || 'accepted'}`); assert.equal(ingest(s, b, RECEIVED).outcome, 'Rejected', `${what}: the reference model must refuse it too`); };

test('EVAL-PRC-DAT-007: an offline edge with delayed synchronisation loses nothing, duplicates nothing and reorders nothing; replacement, deletion and tamper are refused or detected; missing readings are reported', () => {
  const b1 = makeBatch({ kinds: ['transfer-start', 'meter-reading', 'meter-reading'] });
  const b2 = continuation(b1, { kinds: ['meter-reading', 'meter-reading'], batchId: 'B2' });
  const b3 = continuation(b2, { kinds: ['meter-reading', 'transfer-end'], batchId: 'B3', startSeconds: 200 });
  let s = ingest(newStore(), b1, RECEIVED).store;
  const held = ingest(s, b3, iso(3700));
  assert.equal(held.outcome, 'Held', 'a batch that arrives before its predecessor is held, not taken out of order'); assert.deepEqual(held.gap, { from: 4, to: 5 }); assert.equal(held.store.events.size, 3);
  assert.equal(openGaps(held.store)[0].firstSeenAt, iso(3700), 'the age of the gap is recorded so that it can be alerted on');
  s = ingest(held.store, b2, RECEIVED).store; s = ingest(s, b3, RECEIVED).store;
  assert.equal(s.events.size, 7, 'every event is stored exactly once'); assert.equal(s.heads.get('EDGE-SYN-1').lastSequence, 7); assert.deepEqual(openGaps(s), []); assert.deepEqual(verifyStore(s), []);
  const again = ingest(s, b2, RECEIVED); assert.equal(again.outcome, 'AlreadyIngested'); assert.equal(again.duplicates, 2); assert.equal(again.store, s, 'a redelivery changes nothing');
  const swapped = clone(b2); swapped.events[0].payload.value = 31337; seal(swapped);
  assert.deepEqual(verifyBatch(swapped, newStore(), RECEIVED), [], 'a fully re-hashed replacement is internally consistent');
  const refused = ingest(s, swapped, RECEIVED); assert.equal(refused.outcome, 'Rejected', 'only the comparison with what was accepted can catch it'); assert.match(refused.problems[0], /different content/); assert.equal(refused.store, s);
  rejects((() => { const b = makeBatch(); b.events[1].payload.value = 1; return b; })(), /eventSha256 does not match/, 'an altered payload');
  rejects((() => { const b = makeBatch(); b.events.splice(1, 1); b.batchSha256 = batchHash(b); return b; })(), /gap or a reorder|chain is broken/, 'a removed event');
  rejects((() => { const b = makeBatch(); b.events[1].payload.value = Infinity; return b; })(), /finite|does not match/, 'a non-finite value that would hash as null');
  const deleted = structuredClone(s); deleted.events.delete('EDGE-SYN-1/EDGE-SYN-1-3'); assert.ok(verifyStore(deleted).some((m) => /deleted/.test(m)), 'a deleted accepted record is detected from the store alone');
  const edited = structuredClone(s); edited.events.get('EDGE-SYN-1/EDGE-SYN-1-3').event.payload.value = 1; assert.ok(verifyStore(edited).some((m) => /changed/.test(m)), 'an edited accepted record is detected');
  const gapless = makeBatch({ kinds: ['transfer-start', 'transfer-end'], deliveryId: 'DEL-SYN-9' });
  assert.deepEqual(incompleteDeliveries(ingest(newStore(), gapless, RECEIVED).store), ['EDGE-SYN-1/DEL-SYN-9'], 'missing meter readings are reported, never estimated');
  assert.equal(ingest(newStore(), makeBatch(), RECEIVED).authenticity, 'unauthenticated', 'integrity is not authenticity: nothing is marked trusted');
});

test('EVAL-PRC-DAT-008: the ingestion contract rejects a manipulated timestamp against the VERIFIER\'s clock and skew, so a sender cannot move either', () => {
  rejects((() => { const b = makeBatch(); b.events[2].trustedTime = iso(-5000); return seal(b); })(), /goes backwards/, 'a reading timed before its predecessor');
  rejects((() => { const b = makeBatch(); b.events[3].trustedTime = iso(4102444800); return seal(b); })(), /later than the verifier's clock plus the permitted skew/, 'a reading timed in the far future');
  rejects((() => { const b = makeBatch(); b.events[3].trustedTime = iso(3600 + 121); return seal(b); })(), /later than the verifier's clock plus the permitted skew/, 'a reading just beyond the verifier skew');
  assert.deepEqual(verifyBatch((() => { const b = makeBatch(); b.events[3].trustedTime = iso(3600 + 100); return seal(b); })(), newStore(), RECEIVED), [], 'a reading inside the skew is accepted: the rejection is specific');
  rejects((() => { const b = makeBatch(); b.receivedAt = iso(4102444800); b.events[3].trustedTime = iso(4102444800); return seal(b); })(), /unknown batch field|later than the verifier's clock/, 'a sender that supplies its own receiving time');
  rejects((() => { const b = makeBatch(); b.policy = { maxSkewSeconds: 4000000000 }; b.events[3].trustedTime = iso(4102444800); return seal(b); })(), /unknown batch field|later than the verifier's clock/, 'a sender that supplies its own skew');
  const s = ingest(newStore(), makeBatch(), RECEIVED).store;
  const early = ingest(s, continuation(makeBatch(), { startSeconds: -500 }), RECEIVED); assert.equal(early.outcome, 'Rejected', 'time may not go backwards across batches either'); assert.match(early.problems[0], /timed before the last accepted event/);
  assert.ok(verifyBatch(makeBatch(), newStore(), undefined).some((m) => /verifier must supply its own receiving time/.test(m)), 'without the verifier\'s clock nothing is accepted');
  const forged = ingest(newStore(), makeBatch({ startSeconds: 4102444800 }), RECEIVED); assert.equal(forged.outcome, 'Rejected');
  assert.equal(ingest(forged.store, makeBatch(), RECEIVED).outcome, 'Accepted', 'a refused future-dated batch cannot lock the source out');
});

test('EVAL-PRC-SOV-004: the ingestion contract compares every jurisdiction and zone claim with the verifier\'s own identity and refuses a batch that leaves it, an unregistered source or device, and a model as the origin', () => {
  rejects((() => { const b = makeBatch(); b.routing.destinationJurisdictionCode = 'JUR-OTHER'; return seal(b); })(), /destination is not this cell/, 'a destination in another jurisdiction');
  rejects((() => { const b = makeBatch(); b.source.jurisdictionCode = 'JUR-OTHER'; return seal(b); })(), /other than this cell/, 'a source claiming another jurisdiction');
  rejects((() => { const b = makeBatch(); b.source.jurisdictionCode = 'JUR-OTHER'; b.routing.destinationJurisdictionCode = 'JUR-OTHER'; return seal(b); })(), /other than this cell/, 'a batch that is self-consistent in the wrong jurisdiction');
  for (const zone of ['Z3', 'Z4', 'Z5', 'Z6', 'Z7']) { rejects((() => { const b = makeBatch(); b.routing.destinationZone = zone; return seal(b); })(), /destination zone must be this cell/, `destination zone ${zone}`); rejects((() => { const b = makeBatch(); b.source.zone = zone; return seal(b); })(), /source must be inside the jurisdiction/, `source zone ${zone}`); }
  rejects((() => { const b = makeBatch(); b.source.sourceId = 'EDGE-UNKNOWN'; b.events.forEach((e) => { e.sourceId = 'EDGE-UNKNOWN'; }); return seal(b); })(), /source is not registered/, 'an unregistered source');
  rejects((() => { const b = makeBatch(); b.events[1].deviceId = 'DEV-NOT-REGISTERED'; return seal(b); })(), /device is not registered/, 'an unregistered device');
  rejects((() => { const b = makeBatch(); b.events[1].origin = 'model'; return seal(b); })(), /a model cannot be the origin/, 'a model origin');
  rejects((() => { const b = makeBatch(); b.events[1].eventId = '__proto__'; return seal(b); })(), /identifier pattern/, 'a prototype-polluting identifier');
  assert.throws(() => newStore({ sources: [{ sourceId: 'EDGE-X', jurisdictionCode: 'JUR-OTHER', clockSource: 'C', deviceIds: ['D'] }] }), /another jurisdiction/, 'the verifier cannot register a source from another jurisdiction');
  const moved = ingest(ingest(newStore(), makeBatch(), RECEIVED).store, continuation(makeBatch(), { jurisdictionCode: 'JUR-OTHER' }), RECEIVED);
  assert.equal(moved.outcome, 'Rejected', 'a known source cannot change jurisdiction');
  assert.deepEqual(verifyBatch(makeBatch(), newStore(), RECEIVED), [], 'the in-jurisdiction batch is accepted: the rejections are specific');
  const eventOnly = makeBatch(); assert.equal(eventHash(eventOnly.events[0]), eventOnly.events[0].eventSha256);
});
