'use strict';
// Approval gates for decisions made in repository text: accepting an ADR, approving a design review, raising the phase.
// A line of text that says "Accepted", "Approved" or "phase: 1" is never enough. Each of these states needs a decision approval: a record in
// docs/approvals/ that (a) is signed by registered keys of the right approval class, (b) is bound to the SHA-256 of the exact document it
// approves (with its status line normalised, so accepting the document does not void the approval but editing it does), and (c) is checked
// against the registry as it stands in the repository the validator runs on. Text written by a model, a typo or a forged record fails (b) or (a).
//
// Limits, stated plainly: this makes approval unforgeable by TEXT. It does not make it unforgeable by someone who can change the registry
// and the approval record together. That is closed by the control-plane guard (verified commits by an enrolled owner, run in CI) and by keeping
// agents out of the repository's remote credentials (the isolated dev container). See docs/security/APPROVER-ENROLLMENT.md.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const registry = require('./registry.cjs');

const DECISION_SCHEMA = 'greenfuel.decision-approval/v1';
// What each kind of decision needs. Phase raise needs an architecture key AND a deployment key: two separate, deliberate acts.
const RULES = {
  adr: { decision: 'accept', classes: ['architecture'] },
  review: { decision: 'approve', classes: ['architecture'] },
  phase: { decision: 'raise', classes: ['architecture', 'deployment'] },
};
// ADRs accepted before signed approvals existed (by the owner's instruction in chat, 2026-10-28 to 2026-10-29). Fixed list: a new ADR is never added to it.
const GRANDFATHERED_ADRS = new Set(Array.from({ length: 15 }, (_, i) => String(i + 1).padStart(4, '0')));
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;

const lf = (t) => String(t).replace(/\r\n/g, '\n');
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (root, rel) => fs.existsSync(path.join(root, rel));
const only = (root, dir, prefix) => { try { const m = fs.readdirSync(path.join(root, dir)).filter((f) => f.startsWith(prefix) && f.endsWith('.md')); return m.length === 1 ? `${dir}/${m[0]}` : null; } catch { return null; } };

// The text an approval is bound to: the document with its status (and, for a review, decider) lines neutralised.
function normalisedSubject(type, id, root) {
  if (type === 'phase') return /^phase-[1-9]$/.test(id) ? { ok: true, sha256: registry.sha256(`phase:${id}`), file: 'harness/policy/command-policy.json' } : { ok: false, error: 'phase subject id must look like phase-1' };
  if (type === 'adr') {
    if (!/^\d{4}$/.test(id)) return { ok: false, error: 'adr subject id must be four digits' };
    const file = only(root, 'docs/adr', `${id}-`); if (!file) return { ok: false, error: `no single ADR file for ${id}` };
    return { ok: true, file, sha256: registry.sha256(lf(read(root, file)).replace(/^- \*\*Status:\*\*.*$/m, '- **Status:** Proposed')) };
  }
  if (type === 'review') {
    if (!/^RV-\d{4}$/.test(id)) return { ok: false, error: 'review subject id must look like RV-0001' };
    const file = only(root, 'docs/architecture/reviews', `${id}-`); if (!file) return { ok: false, error: `no single review file for ${id}` };
    return { ok: true, file, sha256: registry.sha256(lf(read(root, file)).replace(/^- \*\*Status:\*\*.*$/m, '- **Status:** Pending').replace(/^- \*\*Decider:\*\*.*$/m, '- **Decider:** pending')) };
  }
  return { ok: false, error: `unknown subject type '${type}'` };
}

// An unsigned request, ready for the approver to read and sign with approval.mjs.
function buildDecisionRequest({ type, id, reason, root, now = new Date() }) {
  const rule = RULES[type]; if (!rule) throw new Error(`type must be one of ${Object.keys(RULES).join(', ')}`);
  const s = normalisedSubject(type, id, root); if (!s.ok) throw new Error(s.error);
  if (!reason || !String(reason).trim()) throw new Error('a reason is required');
  return { schema: DECISION_SCHEMA, id: `AP-${crypto.randomBytes(6).toString('hex')}`, class: 'architecture', subject: { type, id, sha256: s.sha256 }, decision: rule.decision, requiredClasses: rule.classes, reason: String(reason), issuedAt: now.toISOString(), nonce: crypto.randomBytes(16).toString('hex'), signatures: [] };
}

function verifyDecisionApproval(rec, { root, approvers, now = new Date() }) {
  const reasons = []; const fail = (r) => { reasons.push(r); return { ok: false, reasons, signers: [] }; };
  if (!rec || rec.schema !== DECISION_SCHEMA) return fail('wrong or missing schema');
  const rule = RULES[rec.subject?.type];
  if (!rule) return fail('unknown subject type');
  if (rec.decision !== rule.decision) return fail(`a ${rec.subject.type} approval must carry the decision '${rule.decision}'`);
  if (typeof rec.id !== 'string' || !/^AP-[0-9a-f]{12}$/.test(rec.id)) return fail('id must look like AP-<12 hex>');
  if (typeof rec.nonce !== 'string' || rec.nonce.length < 16) return fail('a nonce of at least 16 characters is required');
  if (!rec.reason || !String(rec.reason).trim()) return fail('a reason is required');
  if (!ISO.test(rec.issuedAt ?? '') || Date.parse(rec.issuedAt) > now.getTime() + 60000) return fail('issuedAt must be an ISO time that is not in the future');
  if (JSON.stringify([...(rec.requiredClasses ?? [])].sort()) !== JSON.stringify([...rule.classes].sort())) return fail(`requiredClasses must be exactly ${rule.classes.join(', ')}`);
  const s = normalisedSubject(rec.subject.type, rec.subject.id, root);
  if (!s.ok) return fail(s.error);
  if (s.sha256 !== rec.subject.sha256) return fail('the approved text is not the text in the repository: the document changed after it was approved, so the approval is void');
  const payload = Buffer.from(registry.canonical({ ...rec, signatures: undefined }));
  const byClass = new Map(); const signers = new Set();
  for (const sig of Array.isArray(rec.signatures) ? rec.signatures : []) {
    const key = (approvers ?? []).find((k) => k.keyId === sig.keyId);
    if (!key || key.revoked || signers.has(key.keyId)) continue;
    let good = false;
    try { good = crypto.verify(null, payload, crypto.createPublicKey(key.publicKeyPem), Buffer.from(String(sig.sig), 'base64')); } catch { good = false; }
    if (!good) continue;
    const useful = rule.classes.find((c) => key.classes?.includes(c) && !byClass.has(c));
    if (!useful) continue; // a key whose class is not needed, or a class already satisfied by another key, adds nothing
    byClass.set(useful, key.keyId); signers.add(key.keyId);
  }
  for (const c of rule.classes) if (!byClass.has(c)) return fail(`needs a valid signature from a registered ${c} key${rule.classes.length > 1 ? ' (separate keys for each class)' : ''}`);
  return { ok: true, reasons, signers: [...signers] };
}

function loadApprovalRecords(root) {
  const dir = path.join(root, 'docs/approvals'); const out = [];
  try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) { try { out.push({ file: `docs/approvals/${f}`, rec: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }); } catch { out.push({ file: `docs/approvals/${f}`, rec: null }); } } } catch { /* no folder */ }
  return out;
}

// Every gate in the repository. Returns { errors, warnings, stats }.
function gateProblems(root) {
  const errors = []; const warnings = [];
  let approvers = [];
  try { approvers = JSON.parse(read(root, 'harness/policy/approvers.json')).approvers ?? []; } catch { errors.push('harness/policy/approvers.json is missing or unreadable'); }
  const reg = registry.registryProblems(approvers);
  errors.push(...reg.errors); warnings.push(...reg.warnings);
  const trusted = registry.trustedApprovers(approvers);
  const records = loadApprovalRecords(root).filter((r) => r.rec?.schema === DECISION_SCHEMA);
  const valid = new Map(); // "type:id" -> record ids that verify
  for (const { file, rec } of records) {
    const v = verifyDecisionApproval(rec, { root, approvers: trusted });
    if (v.ok) valid.set(`${rec.subject.type}:${rec.subject.id}`, [...(valid.get(`${rec.subject.type}:${rec.subject.id}`) ?? []), rec.id]);
    else warnings.push(`${file}: not a valid approval (${v.reasons[0]}); it satisfies nothing`);
  }
  const stats = { adrAccepted: 0, adrGrandfathered: 0, adrSigned: 0, reviewApproved: 0, reviewSigned: 0, validApprovals: [...valid.values()].flat().length, trustedApprovers: trusted.length };
  // ADRs
  let adrFiles = []; try { adrFiles = fs.readdirSync(path.join(root, 'docs/adr')).filter((f) => /^\d{4}-.*\.md$/.test(f) && !f.startsWith('0000-')); } catch { /* none */ }
  for (const f of adrFiles) {
    const id = f.slice(0, 4); const status = /^- \*\*Status:\*\*\s*(.*)$/m.exec(lf(read(root, `docs/adr/${f}`)))?.[1] ?? '';
    if (!/^Accepted\b/i.test(status)) continue;
    stats.adrAccepted += 1;
    if (GRANDFATHERED_ADRS.has(id)) { stats.adrGrandfathered += 1; continue; }
    if (valid.has(`adr:${id}`)) stats.adrSigned += 1;
    else errors.push(`docs/adr/${f}: says Accepted but no valid signed approval exists for it. Text alone cannot accept an ADR: sign an architecture approval (approval.mjs decision --type adr --id ${id}) with a registered key`);
  }
  // Design reviews
  let rvFiles = []; try { rvFiles = fs.readdirSync(path.join(root, 'docs/architecture/reviews')).filter((f) => /^RV-\d{4}-.*\.md$/.test(f)); } catch { /* none */ }
  for (const f of rvFiles) {
    const id = f.slice(0, 7); const status = /^- \*\*Status:\*\*\s*(.*)$/m.exec(lf(read(root, `docs/architecture/reviews/${f}`)))?.[1] ?? '';
    if (!/^Approved\b/i.test(status)) continue;
    stats.reviewApproved += 1;
    if (valid.has(`review:${id}`)) stats.reviewSigned += 1;
    else errors.push(`docs/architecture/reviews/${f}: says Approved but no valid signed approval exists for it. A model or a typo cannot approve a design`);
  }
  // Phase
  let phase = 0; try { phase = JSON.parse(read(root, 'harness/policy/command-policy.json')).phase ?? 0; } catch { errors.push('harness/policy/command-policy.json is missing or unreadable'); }
  if (phase !== 0 && !(Number.isInteger(phase) && phase > 0 && valid.has(`phase:phase-${phase}`))) errors.push(`command-policy.json phase is ${phase} but no valid signed phase approval (architecture and deployment keys) exists. The phase gate stays closed until it does`);
  stats.phase = phase;
  return { errors, warnings, stats };
}

module.exports = { DECISION_SCHEMA, RULES, GRANDFATHERED_ADRS, normalisedSubject, buildDecisionRequest, verifyDecisionApproval, loadApprovalRecords, gateProblems };
