import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engine, makeKey, syntheticModel, approval, realModel, registry, repo, tmpDir } from './support/permission-fixtures.mjs';

const k1 = makeKey(); const k2 = makeKey(); const k2only = makeKey(['P2']);
const model = syntheticModel([k1, k2, k2only]);
const verify = (rec, extra = {}) => engine.verifyApproval(rec, { model, ...extra });
const base = { tier: 'P2', ops: ['git.write'], agents: ['qa-engineer'], env: 'git-local', scope: { branches: ['agent/*'] }, signers: [k1] };

test('the committed approver registry is empty, so no agent can currently hold a P2+ approval', () => {
  assert.deepEqual(realModel.approvers, []);
  const rec = approval(base);
  assert.equal(engine.verifyApproval(rec, { model: realModel }).ok, false);
});

test('a correctly signed approval verifies', () => assert.equal(verify(approval(base)).ok, true));

test('an altered field invalidates the signature', () => {
  for (const edit of [(r) => { r.agents = ['qa-engineer', 'azure-platform']; }, (r) => { r.scope.branches = ['main']; }, (r) => { r.maxUses = 3; }, (r) => { r.expiresAt = new Date(Date.now() + 3600000).toISOString(); }, (r) => { r.operations = ['git.write', 'git.push.branch']; }]) {
    const rec = approval(base); edit(rec);
    assert.equal(verify(rec).ok, false);
  }
});

test('lifetime, use and shape limits are enforced per tier', () => {
  assert.equal(verify(approval({ ...base, minutes: 24 * 60 + 1 })).ok, false, 'lifetime above the limit');
  assert.equal(verify(approval({ ...base, uses: 6 })).ok, false, 'too many uses');
  assert.equal(verify(approval({ ...base, uses: 0 })).ok, false);
  assert.equal(verify(approval({ ...base, ops: ['git.*'] })).ok, false, 'wildcard operation');
  assert.equal(verify(approval({ ...base, agents: ['*'] })).ok, false, 'wildcard agent');
  assert.equal(verify(approval({ ...base, ops: ['no.such.op'] })).ok, false, 'unknown operation');
  assert.equal(verify(approval({ ...base, env: 'azure-prod' })).ok, false, 'production is never grantable');
  assert.equal(verify(approval({ ...base, ops: ['secret.read'] })).ok, false, 'never-grantable operation');
  const p0 = approval(base); p0.tier = 'P0';
  assert.equal(verify(p0).ok, false, 'P0 and P1 are standing ceilings, not approvals');
});

test('a lower-tier approval cannot authorise a higher-tier operation', () => {
  assert.equal(verify(approval({ tier: 'P2', ops: ['azure.nonprod.deploy'], agents: ['a'], env: 'azure-nonprod', scope: {}, signers: [k1] })).ok, false);
  assert.equal(verify(approval({ tier: 'P3', ops: ['azure.delete'], agents: ['a'], env: 'azure-nonprod', scope: {}, signers: [k1] })).ok, false);
});

test('a signer needs the tier capability, must be registered and must not be revoked', () => {
  assert.equal(verify(approval({ tier: 'P3', ops: ['azure.nonprod.deploy'], agents: ['a'], env: 'azure-nonprod', scope: {}, signers: [k2only] })).ok, false);
  assert.equal(verify(approval({ ...base, signers: [makeKey()] })).ok, false);
  const revoked = syntheticModel([k1]); revoked.approvers[0].revoked = true;
  assert.equal(engine.verifyApproval(approval(base), { model: revoked }).ok, false);
});

test('P4 needs two distinct approvers, and one key signing twice does not count twice', () => {
  const p4 = { tier: 'P4', ops: ['azure.delete'], agents: ['azure-platform'], env: 'azure-nonprod', scope: {} };
  assert.equal(verify(approval({ ...p4, signers: [k1] })).ok, false);
  assert.equal(verify(approval({ ...p4, signers: [k1, k1] })).ok, false);
  assert.equal(verify(approval({ ...p4, signers: [k1, k2] })).ok, true);
  assert.equal(verify(approval({ ...p4, minutes: 61, signers: [k1, k2] })).ok, false, 'P4 lifetime limit');
});

test('time: not valid before issue, not valid after expiry', () => {
  assert.equal(verify(approval(base), { now: new Date(Date.now() - 3600000) }).ok, false);
  assert.equal(verify(approval(base), { now: new Date(Date.now() + 3600000) }).ok, false);
});

test('break-glass records are P4 and need a reference', () => {
  const bg = { tier: 'P4', ops: ['azure.delete'], agents: ['azure-platform'], env: 'azure-nonprod', scope: {}, signers: [k1, k2], breakGlass: true };
  assert.equal(verify(approval({ ...bg, reference: 'INC-SIM-1' })).ok, true);
  const noRef = approval(bg); noRef.reference = '';
  assert.equal(verify(noRef).ok, false);
  assert.equal(verify(approval({ ...bg, tier: 'P3', ops: ['azure.nonprod.deploy'], signers: [k1], reference: 'x' })).ok, false);
});

test('the signature covers a canonical form, so key order does not matter and added fields do', () => {
  const rec = approval(base);
  const shuffled = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(rec).reverse())));
  assert.equal(verify(shuffled).ok, true);
  assert.equal(verify({ ...rec, extra: 'x' }).ok, false);
});

test('an approval is not usable by an agent it does not name, and is spent after maxUses', () => {
  const rec = approval(base);
  const logDir = tmpDir('gf-ledger-');
  const dec = (agent) => engine.decide({ agent, tool: 'powershell', args: { command: 'git commit -m sim' }, cwd: repo, phase: 0, model, registry, approvals: [rec], scope: {}, logDir, consume: true });
  assert.equal(dec('sre-engineer').decision, 'deny');
  assert.equal(dec('qa-engineer').decision, 'allow');
  assert.equal(dec('qa-engineer').decision, 'deny', 'maxUses is 1, so the second use is refused');
  assert.match(dec('qa-engineer').reasons.join(' '), /used up/);
});

test('the human workflow works end to end with encrypted keys: request, two signatures, verify', async () => {
  const { buildRequest } = await import('../harness/scripts/approval.mjs');
  const a = engine.generateApproverKey('correct horse battery'); const b = engine.generateApproverKey('another long passphrase');
  const m = syntheticModel([{ ...a, tiers: ['P4'] }, { ...b, tiers: ['P4'] }]);
  let rec = await buildRequest({ tier: 'P4', agent: 'azure-platform', op: 'azure.delete', env: 'azure-nonprod', rg: 'harmless-simulated-rg', minutes: 30, uses: 1, reason: 'harmless simulation' });
  assert.equal(engine.verifyApproval(rec, { model: m }).ok, false, 'a request is not an approval until it is signed');
  assert.throws(() => engine.signApproval(rec, a.privateKeyPem, a.keyId, 'wrong passphrase'));
  rec = engine.signApproval(rec, a.privateKeyPem, a.keyId, 'correct horse battery');
  assert.equal(engine.verifyApproval(rec, { model: m }).ok, false, 'one signature is not enough for P4');
  rec = engine.signApproval(rec, b.privateKeyPem, b.keyId, 'another long passphrase');
  assert.equal(engine.verifyApproval(rec, { model: m }).ok, true);
  assert.equal(a.privateKeyPem.includes('ENCRYPTED'), true, 'the private key is stored encrypted');
});
