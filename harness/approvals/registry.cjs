'use strict';
// Approver registry rules. Standalone on purpose (no import of the permission engine) so the engine can use it to decide which registry
// entries it trusts at all. An entry that fails these checks is ignored by the engine, so a malformed or half-forged entry approves nothing.
//
// What this proves: an entry is well formed, its key id matches its public key, its holder proved possession of the matching private key, and
// the classes it holds respect separation of duties.
// What this cannot prove: that the holder is a particular human. Nothing inside a repository can. That proof comes from OUTSIDE the
// repository: the commit that adds or changes the registry must be GitHub-verified and made by an enrolled repository owner
// (harness/scripts/ci-control-plane-guard.mjs) and the owner must have compared the fingerprint out of band (docs/security/APPROVER-ENROLLMENT.md).
const crypto = require('node:crypto');

const CLASSES = ['architecture', 'repository', 'deployment', 'filing'];
const TIERS_BY_CLASS = { repository: ['P2'], deployment: ['P3', 'P4'], architecture: [], filing: [] };
const ENROLLMENT_SCHEMA = 'greenfuel.enrollment-request/v1';
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, sortKeys(v[k])])) : v);
const canonical = (v) => JSON.stringify(sortKeys(v));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// The 64-character fingerprint a human compares out of band, grouped for reading aloud.
const fingerprint = (publicKeyPem) => sha256(publicKeyPem);
const fingerprintGroups = (publicKeyPem) => fingerprint(publicKeyPem).match(/.{8}/g).join(' ');
const keyIdOf = (publicKeyPem) => fingerprint(publicKeyPem).slice(0, 16);

// The statement the new key signs to prove it holds the private key. Binding holder, classes and tiers stops the request being replayed with other privileges.
function enrollmentStatement(e) {
  return { schema: ENROLLMENT_SCHEMA, keyId: e.keyId, fingerprint: e.fingerprint, holder: e.holder, classes: [...e.classes].sort(), tiers: [...(e.tiers ?? [])].sort(), requestedAt: e.requestedAt };
}
function signEnrollment(e, privateKey) { return crypto.sign(null, Buffer.from(canonical(enrollmentStatement(e))), privateKey).toString('base64'); }

// Returns the list of problems for one registry entry (empty = well formed).
function entryProblems(k) {
  const p = [];
  const at = `approver ${String(k?.keyId ?? '?').slice(0, 16)}`;
  if (!k || typeof k !== 'object') return ['entry is not an object'];
  if (/PRIVATE KEY/.test(JSON.stringify(k))) return [`${at}: contains private key material`];
  let pub = null;
  try { pub = crypto.createPublicKey(k.publicKeyPem); if (pub.asymmetricKeyType !== 'ed25519') p.push(`${at}: the key must be Ed25519`); } catch { p.push(`${at}: publicKeyPem is not a readable public key`); }
  if (typeof k.publicKeyPem === 'string' && k.keyId !== keyIdOf(k.publicKeyPem)) p.push(`${at}: keyId does not match the public key`);
  if (typeof k.holder !== 'string' || k.holder.trim().length < 3) p.push(`${at}: holder must name the person`);
  if (!Array.isArray(k.classes) || !k.classes.length || k.classes.some((c) => !CLASSES.includes(c)) || new Set(k.classes).size !== k.classes.length) p.push(`${at}: classes must be a non-empty subset of ${CLASSES.join(', ')}`);
  else {
    if (k.classes.includes('filing') && k.classes.length > 1) p.push(`${at}: a certification-filing key may hold no other class`);
    if (k.classes.includes('architecture') && k.classes.includes('deployment')) p.push(`${at}: architecture and deployment approval need different keys (separation of duties)`);
    const allowed = new Set(k.classes.flatMap((c) => TIERS_BY_CLASS[c]));
    const tiers = Array.isArray(k.tiers) ? k.tiers : [];
    if (tiers.some((t) => !allowed.has(t))) p.push(`${at}: tiers ${tiers.join(',')} are not covered by its classes`);
    for (const need of ['repository', 'deployment']) if (k.classes.includes(need) && !TIERS_BY_CLASS[need].some((t) => tiers.includes(t))) p.push(`${at}: class ${need} needs at least one of ${TIERS_BY_CLASS[need].join(', ')}`);
  }
  const e = k.enrollment;
  if (!e || typeof e !== 'object') { p.push(`${at}: enrollment evidence is missing`); return p; }
  if (typeof e.requestId !== 'string' || !/^ENR-[0-9a-f]{12}$/.test(e.requestId)) p.push(`${at}: enrollment.requestId must look like ENR-<12 hex>`);
  if (!ISO.test(e.requestedAt ?? '') || !ISO.test(e.confirmedAt ?? '')) p.push(`${at}: enrollment times must be ISO UTC`);
  else if (Date.parse(e.confirmedAt) < Date.parse(e.requestedAt)) p.push(`${at}: enrollment was confirmed before it was requested`);
  if (typeof k.publicKeyPem === 'string' && e.fingerprint !== fingerprint(k.publicKeyPem)) p.push(`${at}: enrollment.fingerprint does not match the public key`);
  if (pub && typeof e.proof === 'string') {
    let good = false;
    try { good = crypto.verify(null, Buffer.from(canonical(enrollmentStatement({ keyId: k.keyId, fingerprint: e.fingerprint, holder: k.holder, classes: k.classes ?? [], tiers: k.tiers ?? [], requestedAt: e.requestedAt }))), pub, Buffer.from(e.proof, 'base64')); } catch { good = false; }
    if (!good) p.push(`${at}: the proof of possession does not verify: the holder did not sign this exact enrollment with this key`);
  } else p.push(`${at}: enrollment.proof is missing`);
  return p;
}

// Whole registry: per-entry problems plus rules between entries.
function registryProblems(approvers) {
  const errors = []; const warnings = []; const seen = new Set(); const pems = new Set();
  for (const k of Array.isArray(approvers) ? approvers : []) {
    errors.push(...entryProblems(k));
    if (seen.has(k?.keyId)) errors.push(`duplicate approver key ${k?.keyId}`); seen.add(k?.keyId);
    if (pems.has(k?.publicKeyPem)) errors.push(`approver ${k?.keyId}: the same public key is registered twice`); pems.add(k?.publicKeyPem);
  }
  const byHolder = new Map();
  for (const k of Array.isArray(approvers) ? approvers : []) { if (k?.revoked || !Array.isArray(k?.classes)) continue; const h = String(k.holder ?? '').trim().toLowerCase(); byHolder.set(h, [...(byHolder.get(h) ?? []), ...k.classes]); }
  for (const [h, cs] of byHolder) if (cs.includes('architecture') && cs.includes('deployment')) warnings.push(`holder '${h}' holds both architecture and deployment keys: separation of duties is by key only until a second person is enrolled`);
  return { errors, warnings };
}

// The entries the permission engine is allowed to trust: well formed ones only.
function trustedApprovers(approvers) { return (Array.isArray(approvers) ? approvers : []).filter((k) => entryProblems(k).length === 0); }

module.exports = { CLASSES, TIERS_BY_CLASS, ENROLLMENT_SCHEMA, canonical, sha256, fingerprint, fingerprintGroups, keyIdOf, enrollmentStatement, signEnrollment, entryProblems, registryProblems, trustedApprovers };
