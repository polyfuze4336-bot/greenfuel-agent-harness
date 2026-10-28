// validate-azure: the committed Azure scaffold, documents, port register and gate pass, and each way of weakening them is rejected on a sandbox copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { repo } from './support/permission-fixtures.mjs';
import { validateAzure, azureBlockers, azureReadiness, iacProblems, portProblems, VALIDATIONS } from '../harness/scripts/validate-azure.mjs';

const FILES = ['infra', 'docs/azure', 'harness/policy', 'docs/context/DECISION-REGISTER.md', 'docs/architecture/reviews', '.github/workflows', 'docs/approvals'];
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-va-'));
  for (const f of FILES) { if (!existsSync(path.join(repo, f))) continue; mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); cpSync(path.join(repo, f), path.join(root, f), { recursive: true }); }
  return root;
}
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const editJson = (root, rel, fn) => { const f = path.join(root, rel); const j = JSON.parse(readFileSync(f, 'utf8')); fn(j); writeFileSync(f, JSON.stringify(j, null, 2)); };
const editText = (root, rel, fn) => { const f = path.join(root, rel); writeFileSync(f, fn(readFileSync(f, 'utf8'))); };
const errorsOf = (root) => validateAzure(root).map((e) => e.msg);
const REG = 'docs/azure/data/port-assessments.json';
const verified = () => Object.fromEntries(VALIDATIONS.map((k) => [k, { status: 'Verified', evidence: ['docs/evidence/records/EV-0001.json'], verifiedBy: 'A. Person' }]));
const goodPort = () => ({ id: 'PORT-TST', jurisdiction: 'synthetic', residencyStatus: 'Established', hostingOption: 'A', legalBasis: { decision: 'D-009', reference: 'synthetic counsel opinion' }, basis: ['counsel opinion', 'in-jurisdiction replication check'], validations: verified(), verifiedBy: 'A. Person' });

test('the committed Azure scaffold, documents, port register and gate definition pass', () => assert.deepEqual(errorsOf(repo), []));

const mutations = [
  ['public network access enabled', (r) => editText(r, 'infra/modules/key-vault.bicep', (t) => t.replace("publicNetworkAccess: 'Disabled'", "publicNetworkAccess: 'Enabled'")), /public network access is enabled/],
  ['shared key access enabled', (r) => editText(r, 'infra/modules/evidence-storage.bicep', (t) => t.replace('allowSharedKeyAccess: false', 'allowSharedKeyAccess: true')), /shared key access is enabled/],
  ['a geo-redundant storage SKU', (r) => editText(r, 'infra/modules/evidence-storage.bicep', (t) => t.replace("'Standard_ZRS'", "'Standard_ZRS'\n  'Standard_GRS'")), /geo-redundant storage SKU/],
  ['geo-redundant database backup', (r) => editText(r, 'infra/modules/postgres.bicep', (t) => t.replace("geoRedundantBackup: 'Disabled'", "geoRedundantBackup: 'Enabled'")), /geo-redundant backup copies data/],
  ['password authentication on the database', (r) => editText(r, 'infra/modules/postgres.bicep', (t) => t.replace("passwordAuth: 'Disabled'", "passwordAuth: 'Enabled'")), /password authentication/],
  ['local authentication on the message namespace', (r) => editText(r, 'infra/modules/messaging.bicep', (t) => t.replace('disableLocalAuth: true', 'disableLocalAuth: false')), /local \(key or SAS\) authentication is enabled/],
  ['a key read in a template', (r) => editText(r, 'infra/modules/messaging.bicep', (t) => `${t}\noutput k string = listKeys(namespace.id, '2024-01-01').primaryKey\n`), /a key or connection string is read/],
  ['a literal credential', (r) => editText(r, 'infra/modules/monitoring.bicep', (t) => `${t}\nvar x = { password: 'Sup3rS3cretValue' }\n`), /literal credential value/],
  ['an Owner role grant', (r) => editText(r, 'infra/modules/identity-rbac.bicep', (t) => t.replace("'4633458b-17de-408a-b874-0445c86b69e6'", "'8e3af657-a8ff-443c-a75c-2fe8c4bcb635'")), /broad role Owner/],
  ['a Contributor role grant', (r) => editText(r, 'infra/modules/identity-rbac.bicep', (t) => t.replace("'ba92f5b4-2d11-453d-a403-e96b0029c9fe'", "'b24988ac-6180-42a0-ab88-20f7382dd24c'")), /broad role Contributor/],
  ['an unpinned role', (r) => editText(r, 'infra/modules/identity-rbac.bicep', (t) => t.replace("'4633458b-17de-408a-b874-0445c86b69e6'", "'11111111-2222-3333-4444-555555555555'")), /not on the pinned least-privilege list/],
  ['a role assignment outside the identity module', (r) => editText(r, 'infra/modules/key-vault.bicep', (t) => `${t}\nresource ra 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: 'x' }\n`), /role assignments belong in the identity-rbac module/],
  ['a default value on a decision parameter', (r) => editText(r, 'infra/main.bicep', (t) => t.replace('param location string', "param location string = 'somewhere'")), /parameter has a default value/],
  ['deploymentApproved no longer restricted', (r) => editText(r, 'infra/main.bicep', (t) => t.replace(/@allowed\(\[\s*true\s*\]\)\s*\n/, '')), /deploymentApproved must accept only true/],
  ['the scaffold marker removed', (r) => editText(r, 'infra/main.bicep', (t) => t.replace('SCAFFOLD, NOT DEPLOYABLE', 'ready')), /marked SCAFFOLD, NOT DEPLOYABLE/],
  ['purge protection off', (r) => editText(r, 'infra/modules/key-vault.bicep', (t) => t.replace('enablePurgeProtection: true', 'enablePurgeProtection: false')), /purge protection/],
  ['the evidence store lock removed', (r) => editText(r, 'infra/modules/evidence-storage.bicep', (t) => t.replace(/CanNotDelete/g, 'ReadOnly')), /CanNotDelete lock/],
  ['immutability removed from the evidence store', (r) => editText(r, 'infra/modules/evidence-storage.bicep', (t) => t.replace('immutableStorageWithVersioning', 'noImmutability')), /immutable storage with versioning/],
  ['duplicate detection removed', (r) => editText(r, 'infra/modules/messaging.bicep', (t) => t.replace('requiresDuplicateDetection: true', 'requiresDuplicateDetection: false')), /must detect duplicates/],
  ['a public runtime environment', (r) => editText(r, 'infra/modules/container-apps-environment.bicep', (t) => t.replace('internal: true', 'internal: false')), /internal only/],
  ['runtime logs through a workspace key', (r) => editText(r, 'infra/modules/container-apps-environment.bicep', (t) => t.replace("'azure-monitor'", "'log-analytics'")), /Azure Monitor/],
  ['a module that main.bicep does not use', (r) => writeFileSync(path.join(r, 'infra/modules/extra.bicep'), '// extra\nparam a string\n'), /does not use infra\/modules\/extra\.bicep/],
  ['a sign-in command inside a template', (r) => editText(r, 'infra/modules/guardrails.bicep', (t) => `${t}\n// az login\nvar c = 'az deployment group create'\n`), /deployment or sign-in command/],
  ['a parameter file with a real value', (r) => editJson(r, 'infra/params/prod.parameters.json', (j) => { j.parameters.location.value = 'asia-somewhere'; }), /location must be REQUIRES-APPROVAL/],
  ['a secret in a parameter file', (r) => editJson(r, 'infra/params/dev.parameters.json', (j) => { j.parameters.approvalReference.value = ['Account', 'Key=abcdefghijklmnopqrstuvwxyz0123456789'].join(''); }), /approvalReference must be REQUIRES-APPROVAL/],
  ['an environment file for the wrong environment', (r) => editJson(r, 'infra/params/test.parameters.json', (j) => { j.parameters.environment.value = 'prod'; }), /environment must be test/],
  ['a missing environment file', (r) => fs.rmSync(path.join(r, 'infra/params/prod.parameters.json')), /missing infra\/params\/prod\.parameters\.json/],
  ['a parameter that main.bicep does not take', (r) => editJson(r, 'infra/params/dev.parameters.json', (j) => { j.parameters.extraThing = { value: 'REQUIRES-APPROVAL' }; }), /parameters must be exactly main\.bicep's parameters/],
  ['a workflow that signs in to Azure', (r) => writeFileSync(path.join(r, '.github/workflows/deploy.yml'), 'jobs:\n  d:\n    steps:\n      - uses: azure/login@v2\n'), /a workflow signs in to Azure or deploys/],
  ['a workflow with an OIDC token', (r) => writeFileSync(path.join(r, '.github/workflows/deploy.yml'), 'permissions:\n  id-token: write\n'), /a workflow signs in to Azure or deploys/],
  ['a workflow that runs a preview', (r) => writeFileSync(path.join(r, '.github/workflows/deploy.yml'), 'steps:\n  - run: az deployment group what-if\n'), /a workflow signs in to Azure or deploys/],
  ['an azd configuration', (r) => writeFileSync(path.join(r, 'azure.yaml'), 'name: x\n'), /azd configuration exists/],
  ['a discovery query that writes', (r) => writeFileSync(path.join(r, 'infra/discovery/05-bad.kql'), '// READ ONLY\n.set-or-append T <| resources\n'), /a control command is not read only/],
  ['a discovery query without the read-only statement', (r) => writeFileSync(path.join(r, 'infra/discovery/05-bad.kql'), 'resources | take 1\n'), /must say READ ONLY/],
  ['a document missing', (r) => fs.rmSync(path.join(r, 'docs/azure/COST-AND-CAPACITY.md')), /missing docs\/azure\/COST-AND-CAPACITY\.md/],
  ['a document heading removed', (r) => editText(r, 'docs/azure/SOVEREIGNTY-DEPLOYMENT-MATRIX.md', (t) => t.replace(/^## Validations$/m, '## Checks')), /needs a heading about 'Validations'/],
  ['a document that never says what was not verified', (r) => editText(r, 'docs/azure/REGIONAL-AVAILABILITY.md', (t) => t.replace(/\b(no|not|nothing)\b/gi, 'a')), /must state plainly what was not verified/],
  ['a deployment gate that declares its own status', (r) => editJson(r, 'docs/azure/data/deployment-gates.json', (j) => { j.gates[0].status = 'NO-BLOCKERS-FOUND'; }), /carries a status; status is computed/],
  ['a deployment gate removed', (r) => editJson(r, 'docs/azure/data/deployment-gates.json', (j) => { j.gates.pop(); }), /must define DG-01 to DG-12/],
  ['a port established by region alone', (r) => editJson(r, REG, (j) => { const p = goodPort(); p.basis = ['region']; j.ports.push(p); }), /a region is not a residency control/],
  ['a port established without a legal basis', (r) => editJson(r, REG, (j) => { const p = goodPort(); delete p.legalBasis; j.ports.push(p); }), /needs a legal basis/],
  ['a port established with one validation unverified', (r) => editJson(r, REG, (j) => { const p = goodPort(); p.validations.backups.status = 'Unverified'; j.ports.push(p); }), /validation 'backups' must be Verified/],
  ['a port verified by an agent', (r) => editJson(r, REG, (j) => { const p = goodPort(); p.validations.diagnostics.verifiedBy = 'the azure-platform agent'; j.ports.push(p); }), /validation 'diagnostics' must be Verified with evidence and a named human/],
  ['an undetermined port hosted in a cloud region', (r) => editJson(r, REG, (j) => { const p = goodPort(); p.residencyStatus = 'Undetermined'; p.hostingOption = 'A'; j.ports.push(p); }), /hosting A \(in-country Azure region\) needs residency Established|never a cloud region/],
  ['a port with a validation missing', (r) => editJson(r, REG, (j) => { const p = goodPort(); p.residencyStatus = 'NotEstablished'; p.hostingOption = 'C'; delete p.validations.pipelines; j.ports.push(p); }), /validation 'pipelines' is missing/],
  ['the default hosting changed to a region', (r) => editJson(r, REG, (j) => { j.defaultHostingUntilEstablished = 'A'; }), /defaultHostingUntilEstablished must be C/],
];
for (const [what, mutate, re] of mutations) {
  test(`validate-azure rejects ${what}`, () => {
    const r = sandbox();
    try { mutate(r); const errs = errorsOf(r); assert.ok(errs.some((e) => re.test(e)), `not rejected for the right reason: ${errs.join(' | ').slice(0, 400) || 'no error reported'}`); } finally { rm(r); }
  });
}

test('a fully evidenced port with a legal basis and a non-region basis is accepted by the register contract', () => {
  assert.deepEqual(portProblems({ schema: 'greenfuel.port-assessments/v1', defaultHostingUntilEstablished: 'C', ports: [goodPort()] }), []);
  assert.deepEqual(portProblems({ schema: 'greenfuel.port-assessments/v1', defaultHostingUntilEstablished: 'C', ports: [{ ...goodPort(), residencyStatus: 'Undetermined', hostingOption: 'C', validations: Object.fromEntries(VALIDATIONS.map((k) => [k, { status: 'Unverified', evidence: [], verifiedBy: '' }])) }] }), []);
});

test('iacProblems accepts a clean module and rejects each insecure fixture', () => {
  const clean = "param location string\nresource a 'Microsoft.Storage/storageAccounts@2023-05-01' = {\n  name: 'x'\n  location: location\n  properties: {\n    publicNetworkAccess: 'Disabled'\n  }\n}\n";
  assert.deepEqual(iacProblems(clean, 'infra/modules/other.bicep'), []);
  for (const [bad, re] of [["publicNetworkAccess: 'Enabled'", /public network access/], ['allowSharedKeyAccess: true', /shared key/], ["geoRedundantBackup: 'Enabled'", /geo-redundant backup/], ["name: 'Standard_RAGRS'", /geo-redundant storage/], ['x: listKeys(a.id, "1")', /key or connection string is read/], ['disableLocalAuth: false', /local \(key or SAS\)/]]) {
    assert.ok(iacProblems(`${clean}\n${bad}\n`, 'infra/modules/other.bicep').some((m) => re.test(m)), bad);
  }
});

test('readiness: every gate has at least one recorded blocker today, and the result is never an approval', () => {
  const x = azureReadiness(repo);
  assert.equal(x.status, 'NOT-READY'); assert.equal(x.rows.length, 12);
  for (const row of x.rows) assert.equal(row.status, 'NOT-READY', `${row.id} must have a recorded blocker`);
  assert.ok(x.blockers.every((b) => /^DG-\d\d$/.test(b.gate)));
});

test('readiness: a verified port removes only its own blockers, and the other gates stay blocked', () => {
  const r = sandbox();
  try {
    const before = azureBlockers(r).filter((b) => b.gate === 'DG-02').length;
    editJson(r, REG, (j) => { j.ports.push(goodPort()); });
    const after = azureBlockers(r);
    assert.ok(!after.some((b) => /No port is named/.test(b.msg)), 'a port is now named');
    assert.ok(after.filter((b) => b.gate === 'DG-02').length < before, 'the port-naming blocker is gone');
    assert.ok(after.some((b) => b.gate === 'DG-01') && after.some((b) => b.gate === 'DG-12'), 'a verified port does not unblock design, phase or approval gates');
    editJson(r, REG, (j) => { j.ports[0].residencyStatus = 'NotEstablished'; j.ports[0].hostingOption = 'C'; j.ports[0].validations.replication.status = 'Unverified'; });
    assert.ok(azureBlockers(r).some((b) => /PORT-TST: residency is NotEstablished/.test(b.msg) && b.gate === 'DG-02'));
    assert.ok(azureBlockers(r).some((b) => /PORT-TST: replication is not verified/.test(b.msg)));
  } finally { rm(r); }
});

test('readiness: raising the phase, an approver, a what-if record and approvals each clear only their own blocker', () => {
  const r = sandbox();
  try {
    editJson(r, 'harness/policy/command-policy.json', (j) => { j.phase = 1; });
    assert.ok(!azureBlockers(r).some((b) => b.gate === 'DG-12'));
    editJson(r, 'harness/policy/approvers.json', (j) => { j.approvers.push({ id: 'x' }); });
    assert.ok(!azureBlockers(r).some((b) => /No approver is registered/.test(b.msg)));
    writeFileSync(path.join(r, 'docs/azure/data/whatif-record.json'), '{}');
    assert.ok(!azureBlockers(r).some((b) => b.gate === 'DG-06'));
    for (const g of ['DG-01', 'DG-02', 'DG-03', 'DG-05', 'DG-07', 'DG-08', 'DG-09', 'DG-10', 'DG-11']) assert.ok(azureBlockers(r).some((b) => b.gate === g), `${g} stays blocked`);
  } finally { rm(r); }
});
