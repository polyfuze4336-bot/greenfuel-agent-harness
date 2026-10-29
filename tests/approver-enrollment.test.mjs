import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const registry = require('../harness/approvals/registry.cjs');
const gates = require('../harness/approvals/approval-gates.cjs');
const engine = require('../harness/hooks/permission-engine.cjs');
const { buildEnrollment, registerEntry, revokeEntry, humanOnly, requestToEntry } = await import('../harness/scripts/approval.mjs');
const { validateApprovals } = await import('../harness/scripts/validate-approvals.mjs');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASS = 'a-test-passphrase-123';
const T0 = new Date(Date.now() - 3 * 3600000);
const dirs = [];
process.on('exit', () => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

// An approver for tests: a real enrollment flow with a throwaway key.
const approver = (holder, classes, tiers = []) => {
  const e = buildEnrollment({ holder, classes, tiers, passphrase: PASS, now: T0 });
  const { entry } = registerEntry({ request: e.request, approvers: [], typedFingerprint: e.request.fingerprint, now: new Date(T0.getTime() + 60000) });
  return { ...e, entry };
};
const sign = (rec, a) => engine.signApproval(rec, a.privateKeyPem, a.keyId, PASS);

function fakeRepo({ approvers = [], phase = 0, adrs = {}, reviews = {}, approvals = {} } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gf-gates-')); dirs.push(root);
  const w = (rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text); };
  w('harness/policy/approvers.json', JSON.stringify({ version: 1, approvers }));
  w('harness/policy/command-policy.json', JSON.stringify({ phase }));
  for (const [f, t] of Object.entries(adrs)) w(`docs/adr/${f}`, t);
  for (const [f, t] of Object.entries(reviews)) w(`docs/architecture/reviews/${f}`, t);
  for (const [f, rec] of Object.entries(approvals)) w(`docs/approvals/${f}`, JSON.stringify(rec));
  return root;
}
const ADR = (status, body = 'The decision.') => `# ADR 0016: Example\n\n- **Status:** ${status}\n\n${body}\n`;
const decisionFor = (root, type, id, signers) => { let rec = gates.buildDecisionRequest({ type, id, reason: 'reviewed the document', root, now: T0 }); for (const s of signers) rec = sign(rec, s); return rec; };

test('enrollment: a request proves possession of the key, registers nothing, and becomes a valid entry only after the exact fingerprint is typed back', () => {
  const e = buildEnrollment({ holder: 'Test Owner', classes: ['architecture'], passphrase: PASS, now: T0 });
  assert.equal(e.request.schema, registry.ENROLLMENT_SCHEMA);
  assert.match(e.request.requestId, /^ENR-[0-9a-f]{12}$/);
  assert.equal(e.request.fingerprint, registry.fingerprint(e.request.publicKeyPem));
  assert.ok(!JSON.stringify(e.request).includes('PRIVATE KEY'), 'the request holds the public key only');
  assert.throws(() => registerEntry({ request: e.request, approvers: [], typedFingerprint: e.request.fingerprint.replace(/.$/, (c) => (c === '0' ? '1' : '0')) }), /not the fingerprint/);
  assert.throws(() => registerEntry({ request: e.request, approvers: [], typedFingerprint: '' }), /not the fingerprint/);
  const ok = registerEntry({ request: e.request, approvers: [], typedFingerprint: registry.fingerprintGroups(e.request.publicKeyPem), now: new Date(T0.getTime() + 1000) });
  assert.deepEqual(registry.entryProblems(ok.entry), []);
  assert.equal(registry.trustedApprovers(ok.approvers).length, 1);
});

test('registry forgery: every self-asserted, half-formed or privilege-mixing entry is rejected and the engine ignores it', () => {
  const a = approver('Owner One', ['architecture']);
  const good = a.entry;
  const mutations = {
    'key id does not match the key': (k) => ({ ...k, keyId: '0123456789abcdef' }),
    'no enrollment evidence (the legacy keygen shape)': (k) => { const { enrollment, ...r } = k; return r; },
    'proof of possession from another key': (k) => ({ ...k, enrollment: { ...k.enrollment, proof: approver('Other', ['architecture']).entry.enrollment.proof } }),
    'privileges widened after enrollment': (k) => ({ ...k, classes: ['architecture', 'repository'], tiers: ['P2'] }),
    'holder changed after enrollment': (k) => ({ ...k, holder: 'Someone Else' }),
    'fingerprint edited': (k) => ({ ...k, enrollment: { ...k.enrollment, fingerprint: 'f'.repeat(64) } }),
    'confirmed before it was requested': (k) => ({ ...k, enrollment: { ...k.enrollment, confirmedAt: '2020-01-01T00:00:00.000Z' } }),
    'private key material': (k) => ({ ...k, note: `-----BEGIN ${'PRIVATE'} KEY-----` }),
    'no holder': (k) => ({ ...k, holder: '' }),
    'unknown class': (k) => ({ ...k, classes: ['everything'] }),
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    assert.ok(registry.entryProblems(mutate(good)).length > 0, `rejected: ${name}`);
    assert.equal(registry.trustedApprovers([mutate(good)]).length, 0, `ignored by the engine: ${name}`);
  }
  assert.equal(registry.trustedApprovers([good]).length, 1, 'the untouched entry is trusted');
});

test('registry rules: architecture and deployment never share a key, a filing key holds nothing else, duplicates are refused, and shared holders are flagged', () => {
  assert.throws(() => approver('Owner', ['architecture', 'deployment'], ['P3']), /separation of duties/);
  assert.throws(() => approver('Owner', ['filing', 'architecture']), /filing key may hold no other class/);
  assert.throws(() => approver('Owner', ['deployment'], ['P2']), /not covered by its classes/);
  assert.throws(() => approver('Owner', ['deployment'], []), /needs at least one of/);
  const a = approver('Owner One', ['architecture']); const d = approver('Owner One', ['deployment'], ['P3', 'P4']);
  const both = registry.registryProblems([a.entry, d.entry]);
  assert.deepEqual(both.errors, []);
  assert.ok(both.warnings.some((w) => /both architecture and deployment/.test(w)), 'one person with both keys is a visible warning');
  assert.ok(registry.registryProblems([a.entry, a.entry]).errors.some((e) => /duplicate|twice/.test(e)));
  const revoked = revokeEntry({ approvers: [a.entry], keyId: a.keyId, reason: 'laptop lost', now: T0 });
  assert.equal(revoked[0].revoked, true);
  assert.throws(() => revokeEntry({ approvers: [a.entry], keyId: a.keyId, reason: '' }), /reason/);
});

test('approval classes are separate: a key approves only its own class, and architecture or filing keys approve no operation', () => {
  const arch = approver('Arch', ['architecture']); const repo = approver('Repo', ['repository'], ['P2']); const dep = approver('Dep', ['deployment'], ['P3', 'P4']); const dep2 = approver('Dep Two', ['deployment'], ['P3', 'P4']); const fil = approver('Fil', ['filing']);
  const model = { ...engine.loadModel(), approvers: [arch, repo, dep, dep2, fil].map((a) => a.entry) };
  const rec = (tier, signers) => { let r = { schema: 'greenfuel.approval/v1', id: 'AP-x1', tier, operations: tier === 'P2' ? ['git.push.branch'] : ['azure.nonprod.deploy'], agents: ['azure-platform'], environment: tier === 'P2' ? 'github-remote' : 'azure-nonprod', scope: {}, reason: 'sim', breakGlass: false, issuedAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 20 * 60000).toISOString(), maxUses: 1, nonce: 'n'.repeat(32), signatures: [] }; for (const s of signers) r = sign(r, s); return r; };
  const ok = (r) => engine.verifyApproval(r, { model }).ok;
  assert.equal(ok(rec('P2', [repo])), true, 'a repository key approves P2');
  assert.equal(ok(rec('P2', [dep])), false, 'a deployment key does not approve P2 (its tiers are P3 and P4)');
  assert.equal(ok(rec('P3', [dep])), true, 'a deployment key approves P3');
  assert.equal(ok(rec('P3', [repo])), false, 'a repository key does not approve P3');
  for (const wrong of [arch, fil]) { assert.equal(ok(rec('P2', [wrong])), false); assert.equal(ok(rec('P3', [wrong])), false); assert.equal(ok(rec('P4', [wrong, dep])), false, 'it does not count towards P4'); }
  assert.equal(ok(rec('P4', [dep, dep2])), true, 'P4 needs two distinct deployment keys');
  assert.equal(ok(rec('P4', [dep, arch])), false, 'an architecture key cannot be the second P4 approver');
});

test('decision gates: an ADR that says Accepted needs a signed architecture approval bound to its exact text; a model-written approval does not count', () => {
  const arch = approver('Arch', ['architecture']); const stranger = approver('Stranger', ['architecture']);
  const approvers = [arch.entry];
  const adrs = { '0016-example.md': ADR('Accepted (2026-11-01, by the owner)') };
  // no approval at all
  assert.ok(gates.gateProblems(fakeRepo({ approvers, adrs })).errors.some((e) => /says Accepted but no valid signed approval/.test(e)));
  // text pretending to be an approval: unsigned, signed with garbage, signed by an unregistered key, wrong subject hash
  const root0 = fakeRepo({ approvers, adrs: { '0016-example.md': ADR('Proposed') } });
  const unsigned = gates.buildDecisionRequest({ type: 'adr', id: '0016', reason: 'x', root: root0, now: T0 });
  const garbage = { ...unsigned, signatures: [{ keyId: arch.keyId, sig: Buffer.from('not a signature').toString('base64') }] };
  const unregistered = sign(unsigned, stranger);
  const wrongHash = sign({ ...unsigned, subject: { ...unsigned.subject, sha256: 'a'.repeat(64) } }, arch);
  const selfClaimed = { ...unsigned, signatures: [{ keyId: arch.keyId, sig: 'x' }], approvedBy: 'the owner', approved: true };
  for (const [name, rec] of Object.entries({ unsigned, garbage, unregistered, wrongHash, selfClaimed })) {
    const root = fakeRepo({ approvers, adrs, approvals: { 'AP-forged.json': rec } });
    const r = gates.gateProblems(root);
    assert.ok(r.errors.some((e) => /says Accepted but no valid signed approval/.test(e)), `${name} does not accept the ADR`);
  }
  // a real signature by a registered architecture key over the text that is in the repository
  const root1 = fakeRepo({ approvers, adrs: { '0016-example.md': ADR('Proposed') } });
  const good = decisionFor(root1, 'adr', '0016', [arch]);
  const accepted = fakeRepo({ approvers, adrs, approvals: { [`${good.id}.json`]: good } });
  assert.deepEqual(gates.gateProblems(accepted).errors, [], 'the signed approval accepts the ADR; changing only the status line does not void it');
  assert.equal(gates.gateProblems(accepted).stats.adrSigned, 1);
  // editing the substance after approval voids it
  const edited = fakeRepo({ approvers, adrs: { '0016-example.md': ADR('Accepted (2026-11-01)', 'A DIFFERENT decision.') }, approvals: { [`${good.id}.json`]: good } });
  assert.ok(gates.gateProblems(edited).errors.some((e) => /says Accepted/.test(e)));
  assert.ok(gates.gateProblems(edited).warnings.some((w) => /void/.test(w)));
  // a revoked key no longer approves
  const revoked = fakeRepo({ approvers: [{ ...arch.entry, revoked: true }], adrs, approvals: { [`${good.id}.json`]: good } });
  assert.ok(gates.gateProblems(revoked).errors.some((e) => /says Accepted/.test(e)));
});

test('decision gates: the right class signs the right decision; a deployment key cannot accept an ADR, and the phase needs two separate keys', () => {
  const arch = approver('Arch', ['architecture']); const dep = approver('Dep', ['deployment'], ['P3', 'P4']); const arch2 = approver('Arch Two', ['architecture']);
  const approvers = [arch.entry, dep.entry, arch2.entry];
  const adrs = { '0016-example.md': ADR('Accepted') };
  const proposed = fakeRepo({ approvers, adrs: { '0016-example.md': ADR('Proposed') } });
  const byDeployment = decisionFor(proposed, 'adr', '0016', [dep]);
  assert.ok(gates.gateProblems(fakeRepo({ approvers, adrs, approvals: { 'a.json': byDeployment } })).errors.length > 0, 'a deployment key cannot accept an architecture decision');
  // phase raise
  const policy = fakeRepo({ approvers });
  const onlyArch = decisionFor(policy, 'phase', 'phase-1', [arch]);
  assert.ok(gates.gateProblems(fakeRepo({ approvers, phase: 1, approvals: { 'p.json': onlyArch } })).errors.some((e) => /phase is 1/.test(e)), 'an architecture key alone cannot raise the phase');
  const twoArch = decisionFor(policy, 'phase', 'phase-1', [arch, arch2]);
  assert.ok(gates.gateProblems(fakeRepo({ approvers, phase: 1, approvals: { 'p.json': twoArch } })).errors.some((e) => /phase is 1/.test(e)), 'two architecture keys are not an architecture key plus a deployment key');
  const both = decisionFor(policy, 'phase', 'phase-1', [arch, dep]);
  assert.deepEqual(gates.gateProblems(fakeRepo({ approvers, phase: 1, approvals: { 'p.json': both } })).errors, [], 'architecture and deployment keys together raise phase 1');
  assert.ok(gates.gateProblems(fakeRepo({ approvers, phase: 2, approvals: { 'p.json': both } })).errors.length > 0, 'an approval for phase 1 does not raise phase 2');
  assert.ok(gates.gateProblems(fakeRepo({ approvers, phase: 1 })).errors.length > 0, 'phase 1 with no approval is refused');
});

test('decision gates: a design review that says Approved needs a signed approval; the grandfathered ADRs stay valid and are counted, and a new ADR is never grandfathered', () => {
  const arch = approver('Arch', ['architecture']);
  const review = '# RV-0009: Review\n\n- **Review ID:** RV-0009\n- **Status:** Approved\n- **Decider:** Jane Doe (owner)\n';
  assert.ok(gates.gateProblems(fakeRepo({ approvers: [arch.entry], reviews: { 'RV-0009-x.md': review } })).errors.some((e) => /says Approved/.test(e)));
  const pending = fakeRepo({ approvers: [arch.entry], reviews: { 'RV-0009-x.md': review.replace('Approved', 'Blocked').replace('Jane Doe (owner)', 'pending') } });
  const rec = decisionFor(pending, 'review', 'RV-0009', [arch]);
  assert.deepEqual(gates.gateProblems(fakeRepo({ approvers: [arch.entry], reviews: { 'RV-0009-x.md': review }, approvals: { 'r.json': rec } })).errors, []);
  const grand = gates.gateProblems(fakeRepo({ adrs: { '0003-old.md': ADR('Accepted (2026-10-28, by chat instruction)'), '0016-new.md': ADR('Proposed') } }));
  assert.deepEqual(grand.errors, []); assert.equal(grand.stats.adrGrandfathered, 1);
  assert.ok(gates.gateProblems(fakeRepo({ adrs: { '0017-new.md': ADR('Accepted') } })).errors.length > 0, 'ADR 0017 is not in the grandfathered list');
  assert.equal(gates.GRANDFATHERED_ADRS.size, 15);
});

test('the real repository: no approver is enrolled, the phase gate is closed, every Accepted ADR is grandfathered or signed, and the validator passes', () => {
  assert.deepEqual(validateApprovals(REPO), []);
  const r = gates.gateProblems(REPO);
  assert.equal(r.stats.trustedApprovers, 0, 'no approver was invented or self-registered');
  assert.equal(r.stats.phase, 0, 'the phase gate is closed');
  assert.equal(JSON.parse(readFileSync(path.join(REPO, 'harness/policy/approvers.json'), 'utf8')).approvers.length, 0);
  assert.equal(r.stats.reviewApproved, 0);
});

test('human-only commands refuse a pipe, a container, CI and an agent session, and make no file when refused', () => {
  const tty = { stdin: true, stdout: true };
  assert.doesNotThrow(() => humanOnly({}, tty));
  assert.throws(() => humanOnly({}, { stdin: false, stdout: true }), /interactive terminal/);
  assert.throws(() => humanOnly({}, { stdin: true, stdout: false }), /interactive terminal/);
  for (const env of [{ CI: 'true' }, { GITHUB_ACTIONS: 'true' }, { REMOTE_CONTAINERS: 'true' }, { CODESPACES: 'true' }, { HARNESS_AGENT_SESSION: '1' }]) assert.throws(() => humanOnly(env, tty), /refused/);
  const before = existsSync(path.join(REPO, 'docs/approvals/enrollment'));
  for (const args of [['enroll', '--out', path.join(os.tmpdir(), 'gf-never'), '--holder', 'Someone', '--classes', 'architecture'], ['register', '--request', 'x.json'], ['revoke', '--key', 'k', '--reason', 'r'], ['sign', '--file', 'x.json', '--key', 'k.pem']]) {
    const r = spawnSync(process.execPath, [path.join(REPO, 'harness/scripts/approval.mjs'), ...args], { input: 'yes\nyes\n', encoding: 'utf8', cwd: REPO });
    assert.equal(r.status, 2, args[0]); assert.match(r.stderr, /refused: this command needs an interactive terminal/);
  }
  assert.equal(existsSync(path.join(REPO, 'docs/approvals/enrollment')), before, 'nothing was created');
  assert.equal(JSON.parse(readFileSync(path.join(REPO, 'harness/policy/approvers.json'), 'utf8')).approvers.length, 0);
});

test('a request converts to the registry entry the owner would commit, and that entry is what the validator checks', () => {
  const e = buildEnrollment({ holder: 'Owner Two', classes: ['repository'], tiers: ['P2'], passphrase: PASS, now: T0 });
  const entry = requestToEntry(e.request, new Date(T0.getTime() + 5000));
  assert.deepEqual(registry.entryProblems(entry), []);
  const root = fakeRepo({ approvers: [entry] });
  assert.deepEqual(gates.gateProblems(root).errors, []);
  assert.ok(gates.gateProblems(fakeRepo({ approvers: [{ ...entry, holder: 'Edited' }] })).errors.length > 0);
});
