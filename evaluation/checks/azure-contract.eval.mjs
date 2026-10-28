// Executable evaluation checks for the PRODUCTION suite, Azure contract scope. They run faulty SYNTHETIC register entries and Bicep fixtures
// through the Azure validator's contracts: the port assessment register and the infrastructure policy. That tests the contract oracles, not
// any deployed system: nothing is deployed and no Azure call is made. A PASS means "the contract rejects this fixture and accepts the
// committed scaffold"; a FAIL means a hole a faulty template or a residency claim would pass through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iacProblems, portProblems, VALIDATIONS } from '../../harness/scripts/validate-azure.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('EVAL-PRC-SOV-003: the port assessment register never lets a port be Established by region alone, without a legal basis or evidence, or by an agent', () => {
  const ev = () => Object.fromEntries(VALIDATIONS.map((k) => [k, { status: 'Verified', evidence: ['EV-0001'], verifiedBy: 'A. Person' }]));
  const good = { id: 'PORT-TST', residencyStatus: 'Established', hostingOption: 'A', legalBasis: { decision: 'D-009', reference: 'synthetic opinion' }, basis: ['opinion', 'replication check'], validations: ev(), verifiedBy: 'A. Person' };
  const reg = (p) => ({ schema: 'greenfuel.port-assessments/v1', defaultHostingUntilEstablished: 'C', ports: [p] });
  assert.deepEqual(portProblems(reg(good)), [], 'a fully evidenced port is accepted: the rejections below are specific');
  const cases = [
    ['a region as the only basis', { ...good, basis: ['region'] }, /a region is not a residency control/],
    ['no legal basis', { ...good, legalBasis: undefined }, /needs a legal basis/],
    ['a validation with no evidence', { ...good, validations: { ...ev(), replication: { status: 'Verified', evidence: [], verifiedBy: 'A. Person' } } }, /validation 'replication' must be Verified with evidence/],
    ['an agent as verifier', { ...good, validations: { ...ev(), aiInference: { status: 'Verified', evidence: ['EV-1'], verifiedBy: 'model' } } }, /validation 'aiInference' must be Verified/],
    ['a cloud region for an undetermined port', { ...good, residencyStatus: 'Undetermined', hostingOption: 'A' }, /hosting A|never a cloud region/],
    ['a missing validation', { ...good, validations: Object.fromEntries(Object.entries(ev()).filter(([k]) => k !== 'supportAccess')) }, /validation 'supportAccess' is missing/],
  ];
  for (const [what, port, re] of cases) assert.ok(portProblems(reg(port)).some((m) => re.test(m)), `${what}: ${portProblems(reg(port)).join(' | ')}`);
  assert.ok(portProblems({ ...reg(good), defaultHostingUntilEstablished: 'A' }).some((m) => /must be C/.test(m)));
});

test('EVAL-PRC-SEC-003: the infrastructure policy rejects public access, shared keys, geo-redundant copies, key reads, broad roles and default decisions, and accepts the committed modules', () => {
  const dir = path.join(ROOT, 'infra');
  const files = [path.join(dir, 'main.bicep'), ...fs.readdirSync(path.join(dir, 'modules')).map((f) => path.join(dir, 'modules', f))];
  for (const f of files) assert.deepEqual(iacProblems(fs.readFileSync(f, 'utf8'), path.relative(ROOT, f).split(path.sep).join('/')), [], `the committed ${path.basename(f)} passes`);
  const clean = "param location string\nresource a 'Microsoft.Storage/storageAccounts@2023-05-01' = {\n  name: 'x'\n  properties: {\n    publicNetworkAccess: 'Disabled'\n  }\n}\n";
  const bad = [
    ["publicNetworkAccess: 'Enabled'", /public network access/], ['allowSharedKeyAccess: true', /shared key/], ["name: 'Standard_GZRS'", /geo-redundant storage/],
    ['x: listKeys(a.id, "1")', /key or connection string/], ["roleDefinitionId: '8e3af657-a8ff-443c-a75c-2fe8c4bcb635'", /broad role Owner/],
    ["roleDefinitionId: 'b24988ac-6180-42a0-ab88-20f7382dd24c'", /broad role Contributor/], ["param region string = 'somewhere'", /default value/],
  ];
  for (const [text, re] of bad) assert.ok(iacProblems(`${clean}\n${text}\n`, 'infra/modules/other.bicep').some((m) => re.test(m)), text);
});
