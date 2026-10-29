// CANDIDATE CONTRACT AND REFERENCE MODEL, NOT AN APPLICATION (Phase 0, HC-11). SYNTHETIC methodology, SYNTHETIC factors, TEST-ONLY keys.
// The formula is a toy linear model chosen to exercise controls. It is NOT any certification scheme's method and implies nothing about the validity of any scheme,
// regulation or factor (HC-10, D-001, D-002, D-022). It states, as executable checks, what a methodology registry and calculation service must guarantee:
// versioned methods and factor sets, effective dates, units/precision/rounding as data, review before use, immutability after approval, reproducible results.
// Arithmetic is fixed-point on BigInt with an explicit rounding mode: no binary floating point touches a value.
import crypto from 'node:crypto';
import { canonical, sha256 } from '../scripts/spec-validators.mjs';
import { createAuditLog, safeRef } from './audit-chain.mjs';

export const CODE_BUILD_ID = 'candidate-build-1';
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DEC = /^-?\d{1,18}(\.\d{1,12})?$/;
const idOk = (v) => typeof v === 'string' && ID.test(v);
const dateOk = (v) => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v) && !Number.isNaN(Date.parse(v));
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sign = (hash, k) => crypto.sign(null, Buffer.from(hash, 'hex'), k).toString('base64');
const verifySig = (hash, sig, pem) => { try { return crypto.verify(null, Buffer.from(hash, 'hex'), crypto.createPublicKey(pem), Buffer.from(String(sig), 'base64')); } catch { return false; } };
const SCALE = 12n;
const TEN = 10n ** SCALE;

// Strict decimal strings only: a JavaScript number is refused so no input arrives already rounded by binary floating point.
export function parseDecimal(s) {
  if (typeof s !== 'string' || !DEC.test(s)) throw new Error('a decimal must be a string such as "12.50"');
  const neg = s.startsWith('-'); const [i, f = ''] = s.replace('-', '').split('.');
  const v = BigInt(i) * TEN + BigInt(f.padEnd(Number(SCALE), '0'));
  return neg ? -v : v;
}
function roundScaled(v, digits, mode) {
  // v is at scale 12; round to `digits` decimal places.
  const drop = 10n ** (SCALE - BigInt(digits)); const q = v / drop; const r = v % drop; const abs = (x) => (x < 0n ? -x : x);
  const half = drop / 2n; let out = q; const neg = v < 0n;
  if (r !== 0n) {
    if (mode === 'down') out = q;
    else if (abs(r) > half) out = neg ? q - 1n : q + 1n;
    else if (abs(r) === half) { if (mode === 'half-up') out = neg ? q - 1n : q + 1n; else if (mode === 'half-even') out = q % 2n === 0n ? q : (neg ? q - 1n : q + 1n); }
  }
  return out * drop;
}
export function formatScaled(v, digits) {
  const neg = v < 0n; const a = neg ? -v : v; const s = a.toString().padStart(Number(SCALE) + 1, '0');
  const i = s.slice(0, -Number(SCALE)); const f = s.slice(-Number(SCALE)).slice(0, digits);
  return `${neg ? '-' : ''}${i}${digits ? `.${f}` : ''}`;
}

export function createMethodologyRegistry({ actors, signer, clock = () => new Date(), testHooks = false }) {
  if (!actors || !signer) throw new Error('actors and signer are required');
  const audit = createAuditLog({ clock });
  const methods = new Map(); const factorSets = new Map();
  const actor = (id) => { const a = actors[id]; return a ? { id, type: a.type, roles: a.roles ?? [] } : null; };
  const has = (a, r) => a && a.roles.includes(r);
  const log = (a, action, subject, from, to, outcome, reason, input) => audit.append({ actorId: a ? a.id : 'unknown', actorType: a ? a.type : 'unknown', action, subject: safeRef(subject), from, to, outcome, reason, inputHash: sha256(canonical(input ?? '')) });
  const deny = (a, action, subject, from, reason, input) => { log(a, action, subject, from, from, 'denied', reason, input); return { ok: false, reason }; };
  const keyOf = (kind, id, version) => `${kind}:${id}@${version}`;
  const today = () => clock().toISOString().slice(0, 10);

  function propose(kind, rec, actorId) {
    const a = actor(actorId); const store = kind === 'method' ? methods : factorSets; const idField = kind === 'method' ? 'methodologyId' : 'factorSetId';
    if (!a) return deny(null, `${kind}.propose`, rec?.[idField], 'NONE', 'unknown-actor');
    if (a.type !== 'human' || !has(a, 'methodology-owner')) return deny(a, `${kind}.propose`, rec?.[idField], 'NONE', 'only-a-human-methodology-owner-may-propose');
    if (!plain(rec) || !idOk(rec[idField]) || !idOk(rec.version) || !dateOk(rec.effectiveFrom) || (rec.effectiveTo !== undefined && !dateOk(rec.effectiveTo))) return deny(a, `${kind}.propose`, rec?.[idField], 'NONE', 'malformed', rec);
    if (kind === 'factorSet' && !(typeof rec.source === 'string' && rec.source.length >= 5)) return deny(a, 'factorSet.propose', rec.factorSetId, 'NONE', 'a-factor-set-needs-a-cited-source', rec);
    if (kind === 'method') {
      const np = rec.numericPolicy; if (!plain(np) || !Number.isInteger(np.precision) || np.precision < 0 || np.precision > 9 || !['half-even', 'half-up', 'down'].includes(np.rounding) || typeof np.outputUnit !== 'string') return deny(a, 'method.propose', rec.methodologyId, 'NONE', 'units-precision-and-rounding-are-required', rec);
      if (!Array.isArray(rec.terms) || !rec.terms.length) return deny(a, 'method.propose', rec.methodologyId, 'NONE', 'malformed', rec);
    }
    const k = keyOf(kind, rec[idField], rec.version); if (store.has(k)) return deny(a, `${kind}.propose`, k, 'NONE', 'version-exists-use-a-new-version');
    store.set(k, { kind, record: JSON.parse(JSON.stringify(rec)), status: 'DRAFT', proposedBy: a.id, authors: new Set([a.id]), reviewedBy: null, approvedBy: null, approvedAt: null, signature: null, contentHash: null });
    log(a, `${kind}.propose`, k, 'NONE', 'DRAFT', 'allowed', 'ok', rec); return { ok: true, key: k };
  }
  const get = (kind, k) => (kind === 'method' ? methods : factorSets).get(k);

  function review(kind, k, actorId) {
    const a = actor(actorId); const e = get(kind, k);
    if (!e) return deny(a, `${kind}.review`, k, 'NONE', 'unknown-version'); if (!a) return deny(null, `${kind}.review`, k, e.status, 'unknown-actor');
    if (a.type !== 'human' || !has(a, 'methodology-reviewer')) return deny(a, `${kind}.review`, k, e.status, 'only-a-human-reviewer-may-review');
    if (e.status !== 'DRAFT') return deny(a, `${kind}.review`, k, e.status, 'illegal-transition');
    if (e.authors.has(a.id)) return deny(a, `${kind}.review`, k, e.status, 'proposer-cannot-review-own-change');
    // The reviewer approved THIS content: the hash is taken at review and must still match at approval, so later mutation cannot ride on a completed review.
    e.reviewedBy = a.id; e.reviewedHash = sha256(canonical(e.record)); e.status = 'IN_REVIEW'; log(a, `${kind}.review`, k, 'DRAFT', 'IN_REVIEW', 'allowed', 'ok'); return { ok: true };
  }
  function approve(kind, k, actorId) {
    const a = actor(actorId); const e = get(kind, k);
    if (!e) return deny(a, `${kind}.approve`, k, 'NONE', 'unknown-version'); if (!a) return deny(null, `${kind}.approve`, k, e.status, 'unknown-actor');
    if (a.type !== 'human' || !has(a, 'quality-manager')) return deny(a, `${kind}.approve`, k, e.status, 'only-a-human-quality-manager-may-approve');
    if (e.status !== 'IN_REVIEW') return deny(a, `${kind}.approve`, k, e.status, 'review-required-before-approval');
    if (e.authors.has(a.id) || a.id === e.reviewedBy) return deny(a, `${kind}.approve`, k, e.status, 'approver-must-differ-from-proposer-and-reviewer');
    if (e.reviewedHash !== sha256(canonical(e.record))) return deny(a, `${kind}.approve`, k, e.status, 'content-changed-since-review');
    const idField = kind === 'method' ? 'methodologyId' : 'factorSetId';
    if (e.record.effectiveFrom < today()) return deny(a, `${kind}.approve`, k, e.status, 'retroactive-effective-date-not-permitted: a new version applies from its approval date or later');
    const store = kind === 'method' ? methods : factorSets;
    for (const o of store.values()) if (o !== e && o.status === 'APPROVED' && o.record[idField] === e.record[idField]) {
      const aF = e.record.effectiveFrom; const aT = e.record.effectiveTo ?? '9999-12-31'; const bF = o.record.effectiveFrom; const bT = o.record.effectiveTo ?? '9999-12-31';
      if (aF < bT && bF < aT) return deny(a, `${kind}.approve`, k, e.status, 'effective-period-overlaps-an-approved-version');
    }
    e.contentHash = sha256(canonical(e.record)); e.approvedBy = a.id; e.approvedAt = clock().toISOString(); e.status = 'APPROVED';
    const sh = sha256(canonical({ k, contentHash: e.contentHash, approvedBy: e.approvedBy, approvedAt: e.approvedAt })); e.signature = sign(sh, signer.privateKey); e.signedHash = sh; e.signedKey = k;
    log(a, `${kind}.approve`, k, 'IN_REVIEW', 'APPROVED', 'allowed', 'ok', e.contentHash); return { ok: true };
  }
  function edit(kind, k, patch, actorId) {
    const a = actor(actorId); const e = get(kind, k);
    if (!e) return deny(a, `${kind}.edit`, k, 'NONE', 'unknown-version');
    if (e.status === 'APPROVED' || e.status === 'RETIRED') return deny(a, `${kind}.edit`, k, e.status, 'approved-versions-are-immutable-propose-a-new-version', patch);
    if (!a || a.type !== 'human' || !has(a, 'methodology-owner')) return deny(a, `${kind}.edit`, k, e.status, 'only-a-human-methodology-owner-may-edit');
    if (!plain(patch) || Object.keys(patch).some((f) => ['methodologyId', 'factorSetId', 'version'].includes(f))) return deny(a, `${kind}.edit`, k, e.status, 'identity-fields-cannot-be-edited', patch);
    const next = { ...e.record, ...patch };
    if (!dateOk(next.effectiveFrom) || (next.effectiveTo !== undefined && !dateOk(next.effectiveTo))) return deny(a, `${kind}.edit`, k, e.status, 'malformed', patch);
    if (kind === 'method') { const np = next.numericPolicy; if (!plain(np) || !Number.isInteger(np.precision) || np.precision < 0 || np.precision > 9 || !['half-even', 'half-up', 'down'].includes(np.rounding) || typeof np.outputUnit !== 'string' || !Array.isArray(next.terms) || !next.terms.length) return deny(a, 'method.edit', k, e.status, 'units-precision-and-rounding-are-required', patch); }
    if (kind === 'factorSet' && !(typeof next.source === 'string' && next.source.length >= 5)) return deny(a, 'factorSet.edit', k, e.status, 'a-factor-set-needs-a-cited-source', patch);
    const was = e.status; e.record = JSON.parse(JSON.stringify(next)); e.authors.add(a.id); e.status = 'DRAFT'; e.reviewedBy = null; e.reviewedHash = null; log(a, `${kind}.edit`, k, was, 'DRAFT', 'allowed', was === 'DRAFT' ? 'ok' : 'review-discarded', patch); return { ok: true };
  }
  function retire(k, actorId) {
    const a = actor(actorId); const e = methods.get(k);
    if (!e || !a || a.type !== 'human' || !has(a, 'quality-manager') || e.status !== 'APPROVED') return deny(a, 'method.retire', k, e?.status ?? 'NONE', 'only-a-quality-manager-may-retire-an-approved-version');
    e.status = 'RETIRED'; log(a, 'method.retire', k, 'APPROVED', 'RETIRED', 'allowed', 'ok'); return { ok: true };
  }

  // Version resolution is a rule over dates, not a choice: exactly one approved version must apply to the delivery date.
  function resolve(methodologyId, deliveryDate) {
    if (!dateOk(deliveryDate)) return { ok: false, reason: 'bad-date' };
    const hits = [...methods.values()].filter((m) => (m.status === 'APPROVED') && m.record.methodologyId === methodologyId && m.record.effectiveFrom <= deliveryDate && deliveryDate < (m.record.effectiveTo ?? '9999-12-31'));
    if (hits.length === 0) return { ok: false, reason: 'no-applicable-approved-version' };
    if (hits.length > 1) return { ok: false, reason: 'ambiguous-applicable-versions' };
    return { ok: true, entry: hits[0] };
  }
  function approvedFactorSet(id, deliveryDate) {
    const hits = [...factorSets.values()].filter((f) => f.status === 'APPROVED' && f.record.factorSetId === id && f.record.effectiveFrom <= deliveryDate && deliveryDate < (f.record.effectiveTo ?? '9999-12-31'));
    return hits.length === 1 ? hits[0] : null;
  }
  function integrityOf(e) {
    // Recompute what was signed from the stored fields; a signature over a stored string that nothing ties to the record would be decorative.
    if (e.contentHash !== sha256(canonical(e.record)) || !e.signedHash || !e.approvedBy || !e.approvedAt) return false;
    const expected = sha256(canonical({ k: e.signedKey, contentHash: e.contentHash, approvedBy: e.approvedBy, approvedAt: e.approvedAt }));
    return e.signedHash === expected && verifySig(e.signedHash, e.signature, signer.publicKeyPem);
  }

  function compute(m, fsets, inputs) {
    const np = m.record.numericPolicy; let total = 0n;
    for (const t of m.record.terms) {
      const inp = inputs[t.input];
      if (!inp) throw new Error('missing-input');
      if (inp.unit !== t.inputUnit) throw new Error('unit-mismatch');
      const fs = fsets.get(t.factorSetId); const f = fs?.record.factors?.[t.factor];
      if (!f) throw new Error('missing-factor');
      if (f.unit !== t.factorUnit) throw new Error('unit-mismatch');
      total += (parseDecimal(inp.value) * parseDecimal(f.value)) / TEN;
    }
    return formatScaled(roundScaled(total, np.precision, np.rounding), np.precision) + ` ${np.outputUnit}`;
  }
  function calculate({ methodologyId, deliveryDate, deliveryId, inputs }) {
    try {
      const r = resolve(methodologyId, deliveryDate); if (!r.ok) throw new Error(r.reason);
      if (!integrityOf(r.entry)) throw new Error('methodology-record-integrity-failure');
      const fsets = new Map();
      for (const t of r.entry.record.terms) { const fs = approvedFactorSet(t.factorSetId, deliveryDate); if (!fs) throw new Error('missing-factor'); if (!integrityOf(fs)) throw new Error('factor-set-integrity-failure'); fsets.set(t.factorSetId, fs); }
      const output = compute(r.entry, fsets, inputs);
      const rec = { deliveryId, inputs: JSON.parse(JSON.stringify(inputs)), deliveryDate, methodologyRef: { key: keyOf('method', methodologyId, r.entry.record.version), contentHash: r.entry.contentHash }, factorSetRefs: [...fsets].map(([id, f]) => ({ key: keyOf('factorSet', id, f.record.version), contentHash: f.contentHash })), numericPolicy: r.entry.record.numericPolicy, codeBuildId: CODE_BUILD_ID, output };
      rec.inputsHash = sha256(canonical(inputs)); rec.recordHash = sha256(canonical(rec)); rec.signature = sign(rec.recordHash, signer.privateKey);
      log(null, 'calculation.run', rec.methodologyRef.key, 'NONE', 'DONE', 'allowed', 'ok', rec.recordHash); return { ok: true, record: rec };
    } catch (e) { log(null, 'calculation.run', methodologyId, 'NONE', 'NONE', 'denied', String(e.message).slice(0, 80), inputs); return { ok: false, reason: String(e.message) }; }
  }
  // Which version applied on a date, counting versions that were later retired: a historical record must stay reproducible after retirement.
  const appliedOn = (store, idField, id, date) => [...store.values()].filter((x) => (x.status === 'APPROVED' || x.status === 'RETIRED') && x.record[idField] === id && x.record.effectiveFrom <= date && date < (x.record.effectiveTo ?? '9999-12-31'));
  // Re-run from the stored record using the EXACT versions it names, not the current ones. Matches, or explains the difference.
  function rerun(record) {
    try {
      const { recordHash, signature, ...rest } = record; const differences = [];
      if (!verifySig(recordHash, signature, signer.publicKeyPem)) differences.push('the record is not signed by the calculation service');
      if (sha256(canonical(rest)) !== recordHash) differences.push('the stored record was altered');
      const m = methods.get(record.methodologyRef.key); if (!m || !['APPROVED', 'RETIRED'].includes(m.status)) return { ok: false, reason: 'methodology-version-missing' };
      if (!integrityOf(m) || m.contentHash !== record.methodologyRef.contentHash) return { ok: true, match: false, differences: [...differences, 'the methodology version no longer matches the record'] };
      const applied = appliedOn(methods, 'methodologyId', m.record.methodologyId, record.deliveryDate);
      if (applied.length !== 1 || applied[0] !== m) differences.push('the named methodology version was not the one that applied on the delivery date');
      if (sha256(canonical(record.numericPolicy)) !== sha256(canonical(m.record.numericPolicy))) differences.push('the recorded numeric policy differs from the methodology version');
      const fsets = new Map();
      for (const ref of record.factorSetRefs) {
        const fs = factorSets.get(ref.key); if (!fs || !integrityOf(fs) || fs.contentHash !== ref.contentHash) return { ok: true, match: false, differences: [...differences, `factor set ${ref.key} is missing or changed`] };
        const ap = appliedOn(factorSets, 'factorSetId', fs.record.factorSetId, record.deliveryDate); if (ap.length !== 1 || ap[0] !== fs) differences.push(`factor set ${ref.key} was not the one that applied on the delivery date`);
        fsets.set(fs.record.factorSetId, fs);
      }
      const output = compute(m, fsets, record.inputs);
      if (output !== record.output) differences.push(`output ${output} differs from the recorded ${record.output}`);
      if (record.codeBuildId !== CODE_BUILD_ID) differences.push('the calculation build differs from the recorded build');
      return { ok: true, match: differences.length === 0, differences };
    } catch (e) { return { ok: false, reason: String(e.message) }; }
  }
  return { propose: (rec, actorId) => propose('method', rec, actorId), proposeFactorSet: (rec, actorId) => propose('factorSet', rec, actorId),
    review: (k, a) => review('method', k, a), reviewFactorSet: (k, a) => review('factorSet', k, a), approve: (k, a) => approve('method', k, a), approveFactorSet: (k, a) => approve('factorSet', k, a),
    edit: (k, p, a) => edit('method', k, p, a), editFactorSet: (k, p, a) => edit('factorSet', k, p, a), retire,
    // The public resolve returns a copy of the fields a caller needs, never the live entry.
    resolve: (id, date) => { const r = resolve(id, date); return r.ok ? { ok: true, entry: { status: r.entry.status, contentHash: r.entry.contentHash, record: JSON.parse(JSON.stringify(r.entry.record)) } } : r; },
    calculate, rerun,
    audit: () => audit.entries(), auditHead: () => audit.head(), keyOf,
    // Test-only hook that simulates direct tampering with stored content; absent unless a test factory asks for it.
    ...(testHooks ? { _tamperStored: (kind, k, mutate) => mutate(get(kind, k)) } : {}) };
}
