// CANDIDATE CONTRACT AND REFERENCE MODEL, NOT AN APPLICATION (Phase 0, HC-11). Synthetic data and TEST-ONLY keys. It decides nothing about what a certificate is,
// who issues it, whether approval is required, or key custody (D-006, D-007, D-012, D-013, ADR 0018). Approval-required is a policy parameter, default true.
// Executable statement of lifecycle controls: DRAFT, EVIDENCE_PENDING, VALIDATED, APPROVED, ISSUED, SUPERSEDED, REVOKED, plus the filing path.
// Rules it enforces: only listed transitions; each guard checked by deterministic code; agents may draft but never validate, approve, issue, revoke or submit;
// approval binds to the exact content hash, is single-use, time-limited and cannot be given by the preparer; content is immutable once issued; every
// attempt, allowed or denied, enters a hash-chained audit log. Independent verification uses only a bundle and a trust set.
import crypto from 'node:crypto';
import { canonical, sha256 } from '../scripts/spec-validators.mjs';
import { createAuditLog, ZERO, safeRef } from './audit-chain.mjs';
import { keyIdOf } from './custody-chain-contract.mjs';

export const STATES = ['DRAFT', 'EVIDENCE_PENDING', 'VALIDATED', 'APPROVED', 'ISSUED', 'SUPERSEDED', 'REVOKED'];
export const TRANSITIONS = { DRAFT: ['EVIDENCE_PENDING'], EVIDENCE_PENDING: ['VALIDATED', 'DRAFT'], VALIDATED: ['APPROVED', 'ISSUED', 'DRAFT'], APPROVED: ['ISSUED', 'DRAFT'], ISSUED: ['SUPERSEDED', 'REVOKED'], SUPERSEDED: [], REVOKED: [] };
export const FILING_STATES = ['FILING_DRAFT', 'FILING_APPROVED', 'FILING_SUBMITTING', 'FILING_SUBMITTED', 'FILING_SEND_UNCERTAIN', 'FILING_REJECTED_BY_BODY'];
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const idOk = (v) => typeof v === 'string' && ID.test(v);
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => plain(o) && Object.prototype.hasOwnProperty.call(o, k);
const clone = (v) => JSON.parse(JSON.stringify(v));
const sign = (hash, k) => crypto.sign(null, Buffer.from(hash, 'hex'), k).toString('base64');
const verifySig = (hash, sig, pem) => { try { return crypto.verify(null, Buffer.from(hash, 'hex'), crypto.createPublicKey(pem), Buffer.from(String(sig), 'base64')); } catch { return false; } };
export const contentHashOf = (content) => sha256(canonical(content));
// An approval is a record signed by the approver's own key. A caller that builds an approval object cannot make it authentic.
export const approvalDigest = (a) => { const { sig, ...body } = a; return sha256(canonical(body)); };
export const signApproval = (approval, privateKey) => ({ ...approval, sig: sign(approvalDigest(approval), privateKey) });

export function createLifecycle({ actors, signer, validators, clock = () => new Date(), policy, approverKeys, testHooks = false }) {
  if (!actors || !signer || !validators || !policy || !plain(approverKeys) || !Number.isFinite(policy.approvalMaxAgeMs) || typeof policy.requiresApproval !== 'boolean') throw new Error('actors, signer, validators, approverKeys and a complete policy (requiresApproval, approvalMaxAgeMs) are required: there are no defaults');
  const audit = createAuditLog({ clock });
  const certs = new Map(); const usedApprovals = new Set(); const chain = []; const filings = new Map();
  const revoked = new Map(); const superseded = new Map();
  const actor = (id) => { const a = typeof id === 'string' && own(actors, id) ? actors[id] : null; return a ? { id, type: a.type, roles: a.roles ?? [] } : null; };
  const has = (a, role) => a && a.roles.includes(role);
  // Authenticity of an approval: a well-formed id, the approver's registered key, and a signature over the whole approval body.
  const authentic = (approval) => idOk(approval?.approvalId) && own(approverKeys, approval?.approverId) && typeof approval.sig === 'string' && verifySig(approvalDigest(approval), approval.sig, approverKeys[approval.approverId]);

  function deny(a, action, certificateId, from, reason, input = '') {
    audit.append({ actorId: a ? a.id : 'unknown', actorType: a ? a.type : 'unknown', action, subject: safeRef(certificateId), from, to: from, outcome: 'denied', reason, inputHash: sha256(canonical(input)) });
    return { ok: false, reason };
  }
  function done(a, action, c, from, to, input = '') {
    audit.append({ actorId: a.id, actorType: a.type, action, subject: c.certificateId, from, to, outcome: 'allowed', reason: 'ok', inputHash: sha256(canonical(input)) });
    c.state = to; return { ok: true, state: to };
  }
  const move = (c, to) => TRANSITIONS[c.state].includes(to);

  function create({ certificateId, content, supersedes = null }, actorId) {
    const a = actor(actorId);
    if (!a) return deny(null, 'create', certificateId, 'NONE', 'unknown-actor');
    if (!idOk(certificateId) || !plain(content)) return deny(a, 'create', certificateId, 'NONE', 'malformed', content);
    if (certs.has(certificateId)) return deny(a, 'create', certificateId, 'NONE', 'duplicate-certificate');
    if (!(a.type === 'human' || a.type === 'service' || (a.type === 'agent' && has(a, 'drafter')))) return deny(a, 'create', certificateId, 'NONE', 'actor-not-permitted');
    if (supersedes !== null) {
      const old = typeof supersedes === 'string' && certs.get(supersedes);
      if (!old || old.state !== 'ISSUED') return deny(a, 'create', certificateId, 'NONE', 'supersedes-target-not-issued');
      // Declared inside the content so the approval's content hash covers it, and limited to the same delivery.
      if (content.supersedes !== supersedes) return deny(a, 'create', certificateId, 'NONE', 'supersession-must-be-declared-in-the-content', content);
      if (old.content.deliveryId !== content.deliveryId) return deny(a, 'create', certificateId, 'NONE', 'supersedes-target-is-for-another-delivery', content);
    } else if (content.supersedes !== undefined) return deny(a, 'create', certificateId, 'NONE', 'content-declares-supersession-without-a-target', content);
    const c = { certificateId, state: 'DRAFT', content: clone(content), supersedes, preparedBy: a.id, authors: new Set([a.id]), approval: null, issued: null };
    certs.set(certificateId, c);
    audit.append({ actorId: a.id, actorType: a.type, action: 'create', subject: certificateId, from: 'NONE', to: 'DRAFT', outcome: 'allowed', reason: 'ok', inputHash: contentHashOf(content) });
    return { ok: true, state: 'DRAFT' };
  }

  function submit(certificateId, actorId) {
    const a = actor(actorId); const c = certs.get(certificateId);
    if (!a) return deny(null, 'submit', certificateId, '?', 'unknown-actor'); if (!c) return deny(a, 'submit', certificateId, 'NONE', 'unknown-certificate');
    if (!move(c, 'EVIDENCE_PENDING') || c.state !== 'DRAFT') return deny(a, 'submit', certificateId, c.state, 'illegal-transition');
    return done(a, 'submit', c, c.state, 'EVIDENCE_PENDING');
  }

  // The evidence gate, used at validation and again at issue: evidence can be invalidated (a key revoked, a record withdrawn) between the two.
  function evidenceProblem(ct) {
    const custody = validators.custody(ct.deliveryId);
    if (!custody?.ok || !custody.complete) return 'custody-not-verified-or-incomplete';
    if (custody.manifestHash !== ct.evidenceManifestHash) return 'evidence-manifest-does-not-match-custody';
    const calc = validators.calculation(ct.calculationRecordHash);
    if (!calc?.ok || calc.recordHash !== ct.calculationRecordHash || calc.deliveryId !== ct.deliveryId) return 'calculation-record-missing-or-mismatched';
    if (calc.methodologyRef !== ct.methodologyVersionRef) return 'methodology-version-mismatch';
    const feed = validators.feedstock(ct.deliveryId);
    if (!feed?.ok || feed.verificationStatus !== 'verified') return 'feedstock-evidence-missing-or-unverified';
    // The figures a certificate states must be the figures the deterministic services produced, not figures typed next to valid hashes.
    if (!plain(calc.figures) || !plain(custody.quantities)) return 'authoritative-figures-missing';
    if (canonical(ct.figures ?? null) !== canonical(calc.figures)) return 'certificate-figures-do-not-match-the-calculation';
    if (canonical(ct.quantities ?? null) !== canonical(custody.quantities)) return 'certificate-quantities-do-not-match-the-custody-record';
    return null;
  }

  // Validation is a deterministic service act. An agent, a human acting by hand, or a model cannot declare evidence validated.
  function validate(certificateId, actorId) {
    const a = actor(actorId); const c = certs.get(certificateId);
    if (!a) return deny(null, 'validate', certificateId, '?', 'unknown-actor'); if (!c) return deny(a, 'validate', certificateId, 'NONE', 'unknown-certificate');
    if (a.type !== 'service' || !has(a, 'validator')) return deny(a, 'validate', certificateId, c.state, 'only-the-validator-service-may-validate');
    if (c.state !== 'EVIDENCE_PENDING') return deny(a, 'validate', certificateId, c.state, 'illegal-transition');
    const ct = c.content; const problem = evidenceProblem(ct);
    if (problem) return deny(a, 'validate', certificateId, c.state, problem, ct.deliveryId);
    c.contentHash = contentHashOf(ct);
    return done(a, 'validate', c, c.state, 'VALIDATED', { delivery: ct.deliveryId });
  }

  function approve(certificateId, approval) {
    const c = typeof certificateId === 'string' ? certs.get(certificateId) : undefined; const a = actor(approval?.approverId);
    if (!c) return deny(a, 'approve', certificateId, 'NONE', 'unknown-certificate', approval);
    if (!a) return deny(null, 'approve', certificateId, c.state, 'unknown-actor', approval);
    if (a.type !== 'human' || !has(a, 'quality-manager')) return deny(a, 'approve', certificateId, c.state, 'approver-must-be-a-human-quality-manager', approval);
    if (!authentic(approval)) return deny(a, 'approve', certificateId, c.state, 'approval-is-not-authentic', approval);
    if (c.state !== 'VALIDATED') return deny(a, 'approve', certificateId, c.state, 'illegal-transition', approval);
    if (c.authors.has(a.id)) return deny(a, 'approve', certificateId, c.state, 'preparer-cannot-approve-own-work', approval);
    if (approval.meaning !== 'issue' || approval.certificateId !== certificateId || approval.decision !== 'approve') return deny(a, 'approve', certificateId, c.state, 'approval-is-not-an-issue-approval-for-this-certificate', approval);
    if (approval.contentHash !== c.contentHash || contentHashOf(c.content) !== c.contentHash) return deny(a, 'approve', certificateId, c.state, 'approval-does-not-bind-the-current-content', approval);
    const age = clock().getTime() - Date.parse(approval.decidedAt);
    if (!Number.isFinite(age) || age < 0 || age > policy.approvalMaxAgeMs) return deny(a, 'approve', certificateId, c.state, 'approval-expired-or-dated-in-the-future', approval);
    if (usedApprovals.has(approval.approvalId)) return deny(a, 'approve', certificateId, c.state, 'approval-already-used', approval);
    usedApprovals.add(approval.approvalId); c.approval = { ...approval };
    return done(a, 'approve', c, c.state, 'APPROVED', approval.approvalId);
  }

  function issue(certificateId, actorId) {
    const a = actor(actorId); const c = certs.get(certificateId);
    if (!a) return deny(null, 'issue', certificateId, '?', 'unknown-actor'); if (!c) return deny(a, 'issue', certificateId, 'NONE', 'unknown-certificate');
    if (a.type !== 'service' || !has(a, 'issuer')) return deny(a, 'issue', certificateId, c.state, 'only-the-issuer-service-may-issue');
    const needed = policy.requiresApproval ? 'APPROVED' : null;
    if (policy.requiresApproval ? c.state !== needed : !(c.state === 'VALIDATED' || c.state === 'APPROVED')) return deny(a, 'issue', certificateId, c.state, policy.requiresApproval ? 'approval-required-before-issue' : 'illegal-transition');
    if (contentHashOf(c.content) !== c.contentHash) return deny(a, 'issue', certificateId, c.state, 'content-changed-after-validation');
    if (policy.requiresApproval && c.approval?.contentHash !== c.contentHash) return deny(a, 'issue', certificateId, c.state, 'approval-does-not-bind-the-current-content');
    // Time of check is not time of use: evidence and approval freshness are checked again at the moment of issue.
    const problem = evidenceProblem(c.content); if (problem) return deny(a, 'issue', certificateId, c.state, `evidence-no-longer-valid: ${problem}`);
    if (policy.requiresApproval) { const age = clock().getTime() - Date.parse(c.approval.decidedAt); if (!Number.isFinite(age) || age > policy.approvalMaxAgeMs) return deny(a, 'issue', certificateId, c.state, 'approval-expired-before-issue'); }
    const old = c.supersedes ? certs.get(c.supersedes) : null;
    if (c.supersedes && (!old || old.state !== 'ISSUED' || old.content.deliveryId !== c.content.deliveryId)) return deny(a, 'issue', certificateId, c.state, 'supersedes-target-no-longer-issued-or-for-another-delivery');
    if ([...certs.values()].some((x) => x !== c && x.state === 'ISSUED' && x.content.deliveryId === c.content.deliveryId && x.certificateId !== c.supersedes)) return deny(a, 'issue', certificateId, c.state, 'delivery-already-has-a-live-certificate');
    const version = 1 + [...certs.values()].filter((x) => x.certificateId !== certificateId && x.issued && x.content.deliveryId === c.content.deliveryId).length;
    const payload = { schema: 'greenfuel.certificate/v0-candidate', certificateId, version, supersedes: c.supersedes, content: c.content, contentHash: c.contentHash, approvalId: c.approval?.approvalId ?? null, approverId: c.approval?.approverId ?? null, issuedAt: clock().toISOString(), chainPrevHash: chain.length ? chain[chain.length - 1].hash : ZERO, keyId: signer.keyId, alg: 'ed25519' };
    const hash = sha256(canonical(payload));
    c.issued = { payload, hash, sig: sign(hash, signer.privateKey) }; chain.push({ certificateId, hash });
    if (c.supersedes) { const old = certs.get(c.supersedes); if (old) { superseded.set(old.certificateId, certificateId); audit.append({ actorId: a.id, actorType: a.type, action: 'supersede', subject: old.certificateId, from: 'ISSUED', to: 'SUPERSEDED', outcome: 'allowed', reason: `by ${certificateId}`, inputHash: hash }); old.state = 'SUPERSEDED'; } }
    return done(a, 'issue', c, c.state, 'ISSUED', hash);
  }

  // Content may change only before approval; a change after validation discards validation and approval (back to DRAFT). Issued content is immutable.
  function edit(certificateId, content, actorId) {
    const a = actor(actorId); const c = certs.get(certificateId);
    if (!a) return deny(null, 'edit', certificateId, '?', 'unknown-actor'); if (!c) return deny(a, 'edit', certificateId, 'NONE', 'unknown-certificate');
    if (['ISSUED', 'SUPERSEDED', 'REVOKED'].includes(c.state)) return deny(a, 'edit', certificateId, c.state, 'immutable-after-issue: issue a new version that supersedes', content);
    if (!plain(content)) return deny(a, 'edit', certificateId, c.state, 'malformed', content);
    if (!(a.type === 'human' || a.type === 'service' || (a.type === 'agent' && has(a, 'drafter')))) return deny(a, 'edit', certificateId, c.state, 'actor-not-permitted');
    if (c.supersedes && content.supersedes !== c.supersedes) return deny(a, 'edit', certificateId, c.state, 'supersession-must-stay-declared-in-the-content', content);
    if (!c.supersedes && content.supersedes !== undefined) return deny(a, 'edit', certificateId, c.state, 'content-declares-supersession-without-a-target', content);
    const was = c.state; c.content = clone(content); c.authors.add(a.id); c.contentHash = null; c.approval = null;
    audit.append({ actorId: a.id, actorType: a.type, action: 'edit', subject: certificateId, from: was, to: 'DRAFT', outcome: 'allowed', reason: was === 'DRAFT' ? 'ok' : 'validation-and-approval-discarded', inputHash: contentHashOf(content) });
    c.state = 'DRAFT'; return { ok: true, state: 'DRAFT' };
  }

  function revoke(certificateId, { reason, approval }) {
    const c = certs.get(certificateId); const a = actor(approval?.approverId);
    if (!c) return deny(a, 'revoke', certificateId, 'NONE', 'unknown-certificate', approval);
    if (!a || a.type !== 'human' || !has(a, 'quality-manager')) return deny(a, 'revoke', certificateId, c.state, 'approver-must-be-a-human-quality-manager', approval);
    if (!authentic(approval)) return deny(a, 'revoke', certificateId, c.state, 'approval-is-not-authentic', approval);
    if (c.state !== 'ISSUED') return deny(a, 'revoke', certificateId, c.state, 'illegal-transition', approval);
    if (typeof reason !== 'string' || reason.length < 5 || reason.length > 500) return deny(a, 'revoke', certificateId, c.state, 'a-reason-is-required', approval);
    const bound = sha256(canonical({ certificateId, action: 'revoke', reason }));
    if (approval.meaning !== 'revoke' || approval.decision !== 'approve' || approval.certificateId !== certificateId || approval.contentHash !== bound) return deny(a, 'revoke', certificateId, c.state, 'approval-does-not-bind-this-revocation', approval);
    const age = clock().getTime() - Date.parse(approval.decidedAt);
    if (!Number.isFinite(age) || age < 0 || age > policy.approvalMaxAgeMs) return deny(a, 'revoke', certificateId, c.state, 'approval-expired-or-dated-in-the-future', approval);
    if (usedApprovals.has(approval.approvalId)) return deny(a, 'revoke', certificateId, c.state, 'approval-already-used', approval);
    usedApprovals.add(approval.approvalId); revoked.set(certificateId, { reason, approvalId: approval.approvalId, at: clock().toISOString() });
    return done(a, 'revoke', c, c.state, 'REVOKED', approval.approvalId);
  }

  // Signed snapshot of chain head, revocations and supersessions, with its issue time. Offline verifiers report validity AS OF this time only.
  function publishSnapshot() {
    const body = { schema: 'greenfuel.certificate-snapshot/v0-candidate', issuedAt: clock().toISOString(), chainHead: chain.length ? chain[chain.length - 1].hash : ZERO, revoked: [...revoked.keys()].sort(), superseded: [...superseded].sort(), keyId: signer.keyId };
    const hash = sha256(canonical(body)); return { ...body, hash, sig: sign(hash, signer.privateKey) };
  }
  function exportCertificate(certificateId) {
    const c = certs.get(certificateId); if (!c?.issued) return null;
    return JSON.parse(JSON.stringify({ schema: 'greenfuel.certificate-bundle/v0-candidate', payload: c.issued.payload, hash: c.issued.hash, sig: c.issued.sig, signerPublicKeyPem: signer.publicKeyPem, snapshot: publishSnapshot() }));
  }

  // ---- filing: draft, human approval of the exact content, controlled submission, body response stored as untrusted data
  function draftFiling({ filingId, certificateIds, content }, actorId) {
    const a = actor(actorId);
    if (!a) return deny(null, 'filing.draft', filingId, 'NONE', 'unknown-actor');
    if (!idOk(filingId) || !Array.isArray(certificateIds) || !plain(content)) return deny(a, 'filing.draft', filingId, 'NONE', 'malformed', content);
    if (!(a.type === 'human' || (a.type === 'agent' && has(a, 'drafter')) || a.type === 'service')) return deny(a, 'filing.draft', filingId, 'NONE', 'actor-not-permitted');
    if (filings.has(filingId)) return deny(a, 'filing.draft', filingId, 'NONE', 'duplicate-filing-resubmission-needs-a-new-draft-and-a-new-approval');
    for (const id of certificateIds) if (certs.get(id)?.state !== 'ISSUED') return deny(a, 'filing.draft', filingId, 'NONE', 'every-certificate-must-be-issued-and-not-revoked', id);
    filings.set(filingId, { filingId, certificateIds: [...certificateIds], content: clone(content), state: 'FILING_DRAFT', preparedBy: a.id, authors: new Set([a.id]), approval: null, submittedBytes: null, bodyResponse: null });
    audit.append({ actorId: a.id, actorType: a.type, action: 'filing.draft', subject: filingId, from: 'NONE', to: 'FILING_DRAFT', outcome: 'allowed', reason: 'ok', inputHash: contentHashOf(content) });
    return { ok: true, state: 'FILING_DRAFT' };
  }
  function approveFiling(filingId, approval) {
    const f = filings.get(filingId); const a = actor(approval?.approverId);
    if (!f) return deny(a, 'filing.approve', filingId, 'NONE', 'unknown-filing', approval);
    if (!a || a.type !== 'human' || !has(a, 'quality-manager')) return deny(a, 'filing.approve', filingId, f.state, 'approver-must-be-a-human-quality-manager', approval);
    if (!authentic(approval)) return deny(a, 'filing.approve', filingId, f.state, 'approval-is-not-authentic', approval);
    if (f.state !== 'FILING_DRAFT') return deny(a, 'filing.approve', filingId, f.state, 'illegal-transition', approval);
    if (f.authors.has(a.id)) return deny(a, 'filing.approve', filingId, f.state, 'preparer-cannot-approve-own-work', approval);
    if (approval.meaning !== 'file' || approval.decision !== 'approve' || approval.filingId !== filingId || approval.contentHash !== contentHashOf({ certificateIds: f.certificateIds, content: f.content })) return deny(a, 'filing.approve', filingId, f.state, 'approval-does-not-bind-the-current-content', approval);
    const age = clock().getTime() - Date.parse(approval.decidedAt);
    if (!Number.isFinite(age) || age < 0 || age > policy.approvalMaxAgeMs) return deny(a, 'filing.approve', filingId, f.state, 'approval-expired-or-dated-in-the-future', approval);
    if (usedApprovals.has(approval.approvalId)) return deny(a, 'filing.approve', filingId, f.state, 'approval-already-used', approval);
    usedApprovals.add(approval.approvalId); f.approval = { ...approval }; f.state = 'FILING_APPROVED';
    audit.append({ actorId: a.id, actorType: a.type, action: 'filing.approve', subject: filingId, from: 'FILING_DRAFT', to: 'FILING_APPROVED', outcome: 'allowed', reason: 'ok', inputHash: approval.approvalId });
    return { ok: true, state: 'FILING_APPROVED' };
  }
  function editFiling(filingId, content, actorId) {
    const a = actor(actorId); const f = filings.get(filingId);
    if (!f) return deny(a, 'filing.edit', filingId, 'NONE', 'unknown-filing');
    if (!a) return deny(null, 'filing.edit', filingId, f.state, 'unknown-actor');
    if (!(a.type === 'human' || a.type === 'service' || (a.type === 'agent' && has(a, 'drafter')))) return deny(a, 'filing.edit', filingId, f.state, 'actor-not-permitted');
    if (!plain(content)) return deny(a, 'filing.edit', filingId, f.state, 'malformed', content);
    if (['FILING_SUBMITTING', 'FILING_SUBMITTED', 'FILING_SEND_UNCERTAIN', 'FILING_REJECTED_BY_BODY'].includes(f.state)) return deny(a, 'filing.edit', filingId, f.state, 'submitted-content-is-immutable');
    const was = f.state; f.content = clone(content); f.authors.add(a.id); f.approval = null; f.state = 'FILING_DRAFT';
    audit.append({ actorId: a.id, actorType: a.type, action: 'filing.edit', subject: filingId, from: was, to: 'FILING_DRAFT', outcome: 'allowed', reason: was === 'FILING_APPROVED' ? 'approval-discarded' : 'ok', inputHash: contentHashOf(content) });
    return { ok: true, state: 'FILING_DRAFT' };
  }
  function submitFiling(filingId, actorId, body) {
    const a = actor(actorId); const f = filings.get(filingId);
    if (!f) return deny(a, 'filing.submit', filingId, 'NONE', 'unknown-filing');
    if (!a || a.type !== 'service' || !has(a, 'filing-submitter')) return deny(a, 'filing.submit', filingId, f.state, 'only-the-controlled-filing-service-may-submit');
    if (f.state !== 'FILING_APPROVED') return deny(a, 'filing.submit', filingId, f.state, 'approval-required-before-submission');
    const bytes = canonical({ certificateIds: f.certificateIds, content: f.content });
    if (f.approval?.contentHash !== sha256(bytes)) return deny(a, 'filing.submit', filingId, f.state, 'content-changed-after-approval');
    for (const id of f.certificateIds) if (certs.get(id)?.state !== 'ISSUED') return deny(a, 'filing.submit', filingId, f.state, 'a-certificate-is-no-longer-issued', id);
    // The state moves BEFORE the send so a re-entrant or repeated call cannot send twice. If the send fails the outcome is unknown, so a human must reconcile: no automatic retry.
    f.submittedBytes = bytes; f.state = 'FILING_SUBMITTING';
    try { body.send(bytes); } catch {
      f.state = 'FILING_SEND_UNCERTAIN';
      audit.append({ actorId: a.id, actorType: a.type, action: 'filing.submit', subject: filingId, from: 'FILING_SUBMITTING', to: 'FILING_SEND_UNCERTAIN', outcome: 'failed', reason: 'send-failed-outcome-unknown-human-reconciliation-required', inputHash: sha256(bytes) });
      return { ok: false, reason: 'send-failed-outcome-unknown', state: 'FILING_SEND_UNCERTAIN' };
    }
    f.state = 'FILING_SUBMITTED';
    audit.append({ actorId: a.id, actorType: a.type, action: 'filing.submit', subject: filingId, from: 'FILING_APPROVED', to: 'FILING_SUBMITTED', outcome: 'allowed', reason: 'ok', inputHash: sha256(bytes) });
    return { ok: true, state: 'FILING_SUBMITTED' };
  }
  // The body's answer is untrusted data. It is stored with the filing; it never changes a certificate or triggers an action.
  function recordBodyResponse(filingId, response) {
    const f = filings.get(filingId); if (!f || f.state !== 'FILING_SUBMITTED') return { ok: false, reason: 'no-submitted-filing' };
    f.bodyResponse = { untrusted: true, text: String(response?.text ?? '').slice(0, 2000), rejected: response?.rejected === true };
    if (f.bodyResponse.rejected) f.state = 'FILING_REJECTED_BY_BODY';
    audit.append({ actorId: 'body', actorType: 'external', action: 'filing.response', subject: filingId, from: 'FILING_SUBMITTED', to: f.state, outcome: 'allowed', reason: f.bodyResponse.rejected ? 'rejected' : 'acknowledged', inputHash: sha256(f.bodyResponse.text) });
    return { ok: true, state: f.state };
  }

  return { create, submit, validate, approve, issue, edit, revoke, publishSnapshot, exportCertificate, draftFiling, approveFiling, editFiling, submitFiling, recordBodyResponse,
    state: (id) => certs.get(id)?.state ?? null, filingState: (id) => filings.get(id)?.state ?? null, filing: (id) => (filings.has(id) ? { ...clone({ ...filings.get(id), authors: [...filings.get(id).authors] }) } : null), audit: () => audit.entries(), auditHead: () => audit.head(),
    // Test-only hook that simulates direct tampering with stored content, to prove detection; absent unless a test factory asks for it.
    ...(testHooks ? { _tamperStored: (id, mutate) => { const c = certs.get(id); mutate(c); } } : {}) };
}

// Independent verification of a certificate bundle. Pure: uses only the bundle and `trust` = { signerKeys: { keyId: { publicKeyPem, validFrom?, validTo? } }, now, snapshotMaxAgeMs }.
export function verifyCertificateBundle(bundle, trust) {
  const problems = []; const add = (m) => problems.push(m);
  if (!plain(bundle) || !plain(bundle.payload) || !trust?.signerKeys || !Number.isFinite(trust.snapshotMaxAgeMs) || !(trust.now instanceof Date)) return { ok: false, status: 'invalid', problems: ['not a certificate bundle, or the trust set is incomplete (signer keys, now and snapshot freshness are required)'] };
  const p = bundle.payload;
  if (p.alg !== 'ed25519') add('unsupported algorithm');
  const tk = own(trust.signerKeys, p.keyId) ? trust.signerKeys[p.keyId] : null;
  if (!tk) add('the signing key is not in the trust set');
  if (sha256(canonical(p)) !== bundle.hash) add('the certificate was altered (content does not match its hash)');
  if (contentHashOf(p.content) !== p.contentHash) add('the certificate content does not match its recorded content hash');
  if (tk) {
    if (keyIdOf(tk.publicKeyPem) !== p.keyId) add('the trusted key does not match the key identifier');
    if (!verifySig(bundle.hash, bundle.sig, tk.publicKeyPem)) add('the signature does not verify under the trusted key');
    if (tk.validFrom && Date.parse(p.issuedAt) < Date.parse(tk.validFrom)) add('issued before the signing key was valid');
    if (tk.validTo && Date.parse(p.issuedAt) > Date.parse(tk.validTo)) add('issued after the signing key expired');
  }
  const s = bundle.snapshot;
  let snapshotOk = false;
  if (!plain(s)) add('no snapshot: revocation status cannot be established');
  else {
    const { hash, sig, ...sb } = s; const stk = own(trust.signerKeys, s.keyId) ? trust.signerKeys[s.keyId] : null;
    if (!stk || keyIdOf(stk.publicKeyPem) !== s.keyId || sha256(canonical(sb)) !== hash || !verifySig(hash, sig, stk.publicKeyPem)) add('the snapshot is altered or not signed by a trusted key');
    else if ((stk.validFrom && Date.parse(s.issuedAt) < Date.parse(stk.validFrom)) || (stk.validTo && Date.parse(s.issuedAt) > Date.parse(stk.validTo))) add('the snapshot was issued outside the validity of its signing key');
    else if (!Array.isArray(s.revoked) || !Array.isArray(s.superseded) || !(Date.parse(s.issuedAt) >= Date.parse(p.issuedAt))) add('the snapshot is malformed or older than the certificate it describes');
    else snapshotOk = true;
  }
  if (problems.length) return { ok: false, status: 'invalid', problems };
  const age = trust.now.getTime() - Date.parse(s.issuedAt);
  const asOf = s.issuedAt;
  if (s.revoked.includes(p.certificateId)) return { ok: true, status: 'revoked', validAsOf: asOf, problems };
  const sup = s.superseded.find(([id]) => id === p.certificateId);
  if (sup) return { ok: true, status: 'superseded', supersededBy: sup[1], validAsOf: asOf, problems };
  if (!snapshotOk) return { ok: false, status: 'invalid', problems };
  if (!(age <= trust.snapshotMaxAgeMs)) return { ok: true, status: 'stale-snapshot', validAsOf: asOf, problems: ['the snapshot is older than the allowed freshness: validity is only as of its issue time, and later revocations are unknown'] };
  return { ok: true, status: 'valid-as-of', validAsOf: asOf, problems };
}
