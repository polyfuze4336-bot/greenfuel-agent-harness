import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repo, tmpDir } from './support/permission-fixtures.mjs';
import { validatePermissions } from '../harness/scripts/validate-permissions.mjs';

const FILES = ['harness/policy', 'harness/tools/tool-registry.json', '.github/CODEOWNERS', 'docs/security', 'tests/permission-negative.test.mjs'];
function sandbox() {
  const root = tmpDir('gf-vp-');
  for (const f of FILES) { mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); cpSync(path.join(repo, f), path.join(root, f), { recursive: true }); }
  return root;
}
const edit = (root, rel, fn) => { const f = path.join(root, rel); const j = JSON.parse(readFileSync(f, 'utf8')); fn(j); writeFileSync(f, JSON.stringify(j, null, 2)); };
const errorsOf = (root) => validatePermissions(root).map((e) => e.msg);

test('the committed policy passes', () => assert.deepEqual(errorsOf(repo), []));

const PERM = 'harness/policy/permissions.json';
const AZ = 'harness/policy/azure-identities.json';
const GH = 'harness/policy/github-protection.json';
const mutations = [
  ['an agent given an Azure ceiling', PERM, (j) => { j.agentCeilings.qa_x = undefined; j.agentCeilings['qa-engineer']['azure-nonprod'] = 3; }, /ceilings/],
  ['an agent ceiling raised above what its definition grants', PERM, (j) => { j.agentCeilings['maritime-domain']['local-exec'] = 1; }, /ceilings/],
  ['an agent removed from the ceilings', PERM, (j) => { delete j.agentCeilings['qa-engineer']; }, /qa-engineer/],
  ['a tier removed', PERM, (j) => { delete j.tiers.P4; }, /tiers/],
  ['P4 allowed with a single approver', PERM, (j) => { j.approvals.limits.P4.minApprovers = 1; }, /P4 needs at least two/],
  ['a longer lifetime for P4 than P3', PERM, (j) => { j.approvals.limits.P4.maxLifetimeMinutes = 9999; }, /lifetimes/],
  ['a never-grantable operation dropped', PERM, (j) => { j.neverGrantable = j.neverGrantable.filter((x) => x !== 'regulatory.file'); }, /regulatory\.file|neverGrantable/],
  ['the audit chain switched off', PERM, (j) => { j.audit.chained = false; }, /hash chained/],
  ['the audit log moved out of the ignored folder', PERM, (j) => { j.audit.file = 'docs/denied.jsonl'; }, /\.harness-logs/],
  ['an Azure identity with a forbidden built-in role', AZ, (j) => { const f = j.forbidden.roles[0]; j.identities[0].builtInRoles = [f]; }, /forbidden/],
  ['an Azure identity scoped to a subscription', AZ, (j) => { j.identities[0].assignableScopes = ['/subscriptions/<SUBSCRIPTION>']; }, /placeholder resource group/],
  ['an Azure identity scoped to a real-looking subscription', AZ, (j) => { j.identities[0].assignableScopes = ['/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/<RG>']; }, /scope/],
  ['a custom role that can delete', AZ, (j) => { const r = j.identities.find((i) => i.customRole).customRole; r.NotActions = r.NotActions.filter((x) => x !== '*/delete'); }, /NotActions/],
  ['a custom role with a wildcard action', AZ, (j) => { j.identities.find((i) => i.customRole).customRole.Actions.push('*'); }, /wildcard/],
  ['a standing P4 identity', AZ, (j) => { const p4 = j.identities.find((i) => i.tier === 'P4'); p4.standing = true; }, /P4/],
  ['the Azure specification claiming to be created', AZ, (j) => { j.status = 'CREATED'; }, /NOT CREATED/],
  ['branch protection allowing force pushes', GH, (j) => { j.branches.main.allowForcePushes = true; }, /allowForcePushes/],
  ['branch protection not requiring the validate check', GH, (j) => { j.branches.main.requiredStatusChecks = []; }, /validate/],
  ['an approver entry holding a private key', 'harness/policy/approvers.json', (j) => { j.approvers = [{ keyId: '0123456789abcdef', role: 'x', tiers: ['P2'], publicKeyPem: `-----BEGIN ${'PRIVATE'} KEY-----\nabc\n-----END ${'PRIVATE'} KEY-----` }]; }, /PUBLIC/],
];

for (const [name, file, fn, expect] of mutations) {
  test(`validate-permissions rejects ${name}`, () => {
    const root = sandbox();
    edit(root, file, fn);
    const errs = errorsOf(root);
    assert.ok(errs.length > 0, 'the weakened policy must not validate');
    assert.ok(errs.some((e) => expect.test(e)), `expected ${expect}, got ${errs.join(' | ')}`);
  });
}

test('validate-permissions rejects a missing negative test, a missing document and stale generated tables', () => {
  const a = sandbox();
  writeFileSync(path.join(a, 'tests/permission-negative.test.mjs'), "import test from 'node:test';\ntest('x', () => {});\n");
  assert.ok(errorsOf(a).some((e) => /unauthorized Azure deletion/.test(e)));
  const c = sandbox();
  writeFileSync(path.join(c, 'docs/security/PERMISSION-MODEL.md'), readFileSync(path.join(c, 'docs/security/PERMISSION-MODEL.md'), 'utf8').replace('No agent has any standing permission', 'Every agent has standing permission'));
  assert.ok(errorsOf(c).some((e) => /out of date/.test(e)));
  const d = sandbox();
  writeFileSync(path.join(d, 'docs/security/ENFORCEMENT-STATUS.md'), '# empty\n');
  assert.ok(errorsOf(d).some((e) => /ENFORCEMENT-STATUS\.md must cover DEF-01/.test(e)));
});

test('validate-permissions reports a missing document instead of passing', () => {
  const r = sandbox();
  rmSync(path.join(r, 'docs/security/BREAK-GLASS.md'));
  assert.ok(errorsOf(r).some((e) => /missing docs\/security\/BREAK-GLASS\.md/.test(e)));
});

