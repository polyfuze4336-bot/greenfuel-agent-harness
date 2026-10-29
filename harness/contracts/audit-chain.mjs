// CANDIDATE CONTRACT AND REFERENCE MODEL, NOT AN APPLICATION (Phase 0, HC-11). Synthetic data and test-only keys.
// A hash-chained, append-only audit log used by the other candidate contracts. Denials and refusals are recorded as events, never dropped.
// It detects edits, removals and reordering of records; it does not authenticate who wrote the log (the chain head must be anchored elsewhere, D-013).
import { canonical, sha256 } from '../scripts/spec-validators.mjs';

export const ZERO = '0'.repeat(64);
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,63}$/;
// A caller-chosen value goes into the log only if it already looks like an identifier; anything else is recorded as a short hash.
export const safeRef = (v) => (typeof v === 'string' && SAFE_REF.test(v) ? v : `h:${sha256(canonical(v ?? '')).slice(0, 16)}`);

export function createAuditLog({ clock = () => new Date() } = {}) {
  const entries = [];
  return {
    // Hostile values are recorded only as hashes: `detail` must be small, already-safe metadata. Chain fields cannot be overridden by `fields`.
    append(fields) {
      const prev = entries.length ? entries[entries.length - 1].hash : ZERO;
      const body = { ...fields, seq: entries.length + 1, ts: clock().toISOString(), prevHash: prev };
      const rec = { ...body, hash: sha256(canonical(body)) };
      entries.push(Object.freeze(rec));
      return rec;
    },
    entries: () => entries.slice(),
    head: () => (entries.length ? entries[entries.length - 1].hash : ZERO),
  };
}

// Verifies a log exported from the contract. `expectedHead` (from an anchor held elsewhere) detects truncation of the tail.
export function verifyAuditLog(entries, expectedHead = null) {
  const problems = []; let prev = ZERO;
  entries.forEach((e, i) => {
    const { hash, ...body } = e;
    if (e.seq !== i + 1) problems.push(`entry ${i + 1}: sequence is ${e.seq}`);
    if (e.prevHash !== prev) problems.push(`entry ${i + 1}: chain broken (a record was removed, inserted or reordered)`);
    if (sha256(canonical(body)) !== hash) problems.push(`entry ${i + 1}: content does not match its hash (altered)`);
    prev = hash;
  });
  if (expectedHead && prev !== expectedHead) problems.push('the chain head does not match the anchored head (records were removed from the end or the log was replaced)');
  return { ok: problems.length === 0, problems, head: prev };
}
