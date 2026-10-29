// Executable tests for the CANDIDATE sovereignty placement checker. It evaluates a DECLARED manifest on synthetic fixtures: it proves the rules, not any real resource.
// Real validation needs a deployed cell and is described in docs/target-architecture/12-DATA-MOVEMENT-AND-RESIDENCY-VALIDATION.md (not run in Phase 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPlacement, ROLES } from '../harness/contracts/sovereignty-placement-contract.mjs';

const NOW = new Date('2026-05-01T00:00:00Z');
const good = () => ({
  cell: { jurisdiction: 'SG' },
  resources: [
    { id: 'ev-store', role: 'evidence-store', dataClasses: ['DC-01', 'DC-02', 'DC-05'], location: { jurisdiction: 'SG' }, replicatesTo: ['bk-1'], redundancy: 'zone', publicAccess: false, sharedKeyAccess: false, admin: { accessFrom: ['SG'] } },
    { id: 'bk-1', role: 'backup', dataClasses: ['DC-01', 'DC-02'], location: { jurisdiction: 'SG' }, redundancy: 'local', publicAccess: false, sharedKeyAccess: false, admin: { accessFrom: ['SG'] } },
    { id: 'logs', role: 'log-workspace', dataClasses: [], containsBoundContent: false, location: { jurisdiction: 'SG' } },
    { id: 'keys', role: 'key-store', dataClasses: ['DC-12'], location: { jurisdiction: 'SG' }, redundancy: 'local', publicAccess: false, sharedKeyAccess: false, admin: { accessFrom: ['SG'] } },
    { id: 'infer', role: 'inference', dataClasses: [], processesDataClasses: ['DC-01'], processingLocationVerified: true, location: { jurisdiction: 'SG' } },
    { id: 'shore-hub', role: 'compute', dataClasses: ['DC-05'], location: { jurisdiction: 'XX' } },
  ],
  flows: [{ id: 'fl-1', from: 'ev-store', to: 'shore-hub', dataClasses: ['DC-05'] }],
  approvedFlows: [],
});
const mutated = (fn) => { const m = good(); fn(m); return m; };
const rules = (m) => checkPlacement(m, { now: NOW }).findings.map((f) => f.rule);
const res = (m, id) => m.resources.find((r) => r.id === id);

test('a fully in-jurisdiction manifest with only a non-bound summary flow offshore passes', () => {
  const r = checkPlacement(good(), { now: NOW }); assert.deepEqual(r.findings, []); assert.equal(r.ok, true);
});

test('an incomplete or non-object manifest fails closed', () => {
  for (const m of [null, {}, { cell: { jurisdiction: 'SG' } }, { cell: {}, resources: [], flows: [], approvedFlows: [] }, 'x']) assert.deepEqual(rules(m), ['PL-00']);
});

test('PL-01 bound data in another jurisdiction is a violation', () => {
  assert.deepEqual(rules(mutated((m) => { res(m, 'ev-store').location.jurisdiction = 'XX'; })).includes('PL-01'), true);
});

test('PL-02 replicas and backups: a copy outside the jurisdiction, or to an undeclared target, is a violation', () => {
  assert.ok(rules(mutated((m) => { res(m, 'bk-1').location.jurisdiction = 'XX'; })).includes('PL-02'));
  assert.ok(rules(mutated((m) => { res(m, 'ev-store').replicatesTo = ['unknown-replica']; })).includes('PL-02'));
});

test('PL-08 geo-redundancy needs a declared paired-region jurisdiction and it must be inside the cell', () => {
  assert.ok(rules(mutated((m) => { res(m, 'ev-store').redundancy = 'geo'; })).includes('PL-08'), 'undeclared pair is a violation, not a pass');
  assert.ok(rules(mutated((m) => { Object.assign(res(m, 'ev-store'), { redundancy: 'geo', pairedRegionJurisdiction: 'XX' }); })).includes('PL-08'));
  assert.deepEqual(rules(mutated((m) => { Object.assign(res(m, 'ev-store'), { redundancy: 'geo', pairedRegionJurisdiction: 'SG' }); })), []);
});

test('PL-03 logs and diagnostics: bound content outside the jurisdiction, or an undeclared content statement, is a violation', () => {
  assert.ok(rules(mutated((m) => { Object.assign(res(m, 'logs'), { location: { jurisdiction: 'XX' }, containsBoundContent: true }); })).includes('PL-03'));
  assert.ok(rules(mutated((m) => { delete res(m, 'logs').containsBoundContent; })).includes('PL-03'));
  assert.deepEqual(rules(mutated((m) => { Object.assign(res(m, 'logs'), { location: { jurisdiction: 'XX' }, containsBoundContent: false }); })), [], 'a log stream declared free of bound content may sit offshore');
  assert.ok(rules(mutated((m) => { m.resources.push({ id: 'diag', role: 'diagnostic-sink', dataClasses: ['DC-01'], containsBoundContent: true, location: { jurisdiction: 'XX' } }); })).includes('PL-03'));
});

test('PL-04 cross-jurisdiction movement of bound data needs an approved flow that names the class, source, destination, legal basis, approver and an unexpired date', () => {
  const flow = { id: 'fl-2', from: 'ev-store', to: 'shore-hub', dataClasses: ['DC-01'], approvedFlowId: 'AF-1' };
  const AF = { id: 'AF-1', dataClass: 'DC-01', fromJurisdiction: 'SG', toJurisdiction: 'XX', fromResource: 'ev-store', toResource: 'shore-hub', legalBasisRef: 'LEGAL-REF-PLACEHOLDER', approverId: 'owner', expiry: '2026-12-31' };
  const withFlow = (af, f = flow) => mutated((m) => { m.flows.push(f); if (af) m.approvedFlows.push(af); });
  assert.ok(rules(withFlow(null)).includes('PL-04'), 'no approval');
  assert.deepEqual(rules(withFlow(AF)), [], 'a complete, unexpired approval');
  assert.ok(rules(withFlow({ ...AF, expiry: '2026-04-30' })).includes('PL-04'), 'expired');
  assert.ok(rules(withFlow({ ...AF, dataClass: 'DC-02' })).includes('PL-04'), 'different data class');
  assert.ok(rules(withFlow({ ...AF, fromJurisdiction: 'MY' })).includes('PL-04'), 'different source');
  assert.ok(rules(withFlow({ ...AF, toJurisdiction: 'YY' })).includes('PL-04'), 'an approval for one destination does not authorise another');
  assert.ok(rules(withFlow({ ...AF, toResource: 'other-hub' })).includes('PL-04'), 'an approval is bound to the exact resource pair');
  assert.ok(rules(withFlow({ ...AF, toJurisdiction: undefined })).includes('PL-04'), 'a destination-agnostic approval is not accepted');
  assert.ok(rules(withFlow({ ...AF, legalBasisRef: '' })).includes('PL-04'), 'no legal basis');
  assert.ok(rules(withFlow({ ...AF, approverId: undefined })).includes('PL-04'), 'no approver');
  assert.ok(rules(withFlow({ ...AF, expiry: 'whenever' })).includes('PL-04'), 'unparseable expiry');
  assert.ok(rules(withFlow({ ...AF, id: undefined }, { ...flow, approvedFlowId: undefined })).includes('PL-04'), 'two undefined identifiers must not match each other');
  assert.ok(rules(mutated((m) => { m.flows.push({ ...flow, dataClasses: ['DC-01', 'DC-02'] }); m.approvedFlows.push(AF); })).includes('PL-04'), 'one class approved, another not');
});

test('PL-10 flows: an unlabelled flow, an empty class list and a laundered label are violations', () => {
  const fl = { id: 'fl-3', from: 'ev-store', to: 'shore-hub' };
  assert.ok(rules(mutated((m) => { m.flows.push(fl); })).includes('PL-10'), 'missing class list');
  assert.ok(rules(mutated((m) => { m.flows.push({ ...fl, dataClasses: [] }); })).includes('PL-10'), 'empty class list');
  assert.ok(rules(mutated((m) => { res(m, 'ev-store').dataClasses = ['DC-01']; m.flows.push({ ...fl, dataClasses: ['DC-05'] }); })).includes('PL-10'), 'a source that does not hold the labelled class');
});

test('PL-00 a manifest cannot hide a violating resource behind a duplicate identifier or by being empty', () => {
  assert.ok(rules(mutated((m) => { m.resources.unshift({ ...res(m, 'ev-store'), location: { jurisdiction: 'XX' } }); })).includes('PL-00'), 'duplicate id');
  assert.deepEqual(rules({ cell: { jurisdiction: 'SG' }, resources: [], flows: [], approvedFlows: [] }), ['PL-00'], 'an empty manifest is not a pass');
});

test('PL-05 PL-06 PL-08 safe values must be declared: omitted or non-boolean values are violations', () => {
  assert.ok(rules(mutated((m) => { delete res(m, 'ev-store').publicAccess; })).includes('PL-05'));
  assert.ok(rules(mutated((m) => { res(m, 'ev-store').publicAccess = 'true'; })).includes('PL-05'));
  assert.ok(rules(mutated((m) => { delete res(m, 'ev-store').sharedKeyAccess; })).includes('PL-05'));
  assert.ok(rules(mutated((m) => { res(m, 'ev-store').redundancy = 'GRS'; })).includes('PL-08'));
  assert.ok(rules(mutated((m) => { res(m, 'ev-store').redundancy = 'Geo'; })).includes('PL-08'));
  assert.ok(rules(mutated((m) => { delete res(m, 'ev-store').redundancy; })).includes('PL-08'));
  assert.ok(rules(mutated((m) => { delete res(m, 'ev-store').admin; })).includes('PL-06'));
  assert.ok(rules(mutated((m) => { res(m, 'logs').containsBoundContent = 'no'; })).includes('PL-03'));
  assert.ok(rules(mutated((m) => { res(m, 'bk-1').dataClasses = []; })).includes('PL-10'), 'a backup that declares nothing');
  assert.ok(rules(mutated((m) => { res(m, 'infer').processesDataClasses = ['DC-99']; })).includes('PL-10'));
});

test('PL-05 public or shared-key access to a store holding bound data is a violation', () => {
  assert.ok(rules(mutated((m) => { res(m, 'ev-store').publicAccess = true; })).includes('PL-05'));
  assert.ok(rules(mutated((m) => { res(m, 'ev-store').sharedKeyAccess = true; })).includes('PL-05'));
});

test('PL-06 administration from another jurisdiction needs a break-glass approved inside the cell', () => {
  assert.ok(rules(mutated((m) => { res(m, 'ev-store').admin = { accessFrom: ['SG', 'XX'] }; })).includes('PL-06'));
  assert.deepEqual(rules(mutated((m) => { res(m, 'ev-store').admin = { accessFrom: ['SG', 'XX'], breakGlassApproved: true, breakGlassIn: 'SG' }; })), []);
  assert.ok(rules(mutated((m) => { res(m, 'ev-store').admin = { accessFrom: ['XX'], breakGlassApproved: true, breakGlassIn: 'XX' }; })).includes('PL-06'));
});

test('PL-07 inference over bound data must be inside the jurisdiction with a verified processing location (D-028)', () => {
  assert.ok(rules(mutated((m) => { res(m, 'infer').location.jurisdiction = 'XX'; })).includes('PL-07'));
  assert.ok(rules(mutated((m) => { delete res(m, 'infer').processingLocationVerified; })).includes('PL-07'));
  assert.ok(rules(mutated((m) => { res(m, 'infer').processingLocationVerified = false; })).includes('PL-07'));
});

test('PL-09 and PL-10: unknown roles, undeclared locations, flows to undeclared resources and unknown data classes fail closed', () => {
  assert.ok(rules(mutated((m) => { res(m, 'keys').role = 'mystery-box'; })).includes('PL-09'));
  assert.ok(rules(mutated((m) => { delete res(m, 'keys').location; })).includes('PL-09'));
  assert.ok(rules(mutated((m) => { m.flows.push({ id: 'fl-9', from: 'ev-store', to: 'ghost', dataClasses: ['DC-05'] }); })).includes('PL-09'));
  assert.ok(rules(mutated((m) => { res(m, 'keys').dataClasses.push('DC-99'); })).includes('PL-10'));
  assert.ok(rules(mutated((m) => { m.flows.push({ id: 'fl-8', from: 'ev-store', to: 'shore-hub', dataClasses: ['DC-99'] }); })).includes('PL-10'));
  assert.ok(rules(mutated((m) => { m.resources.push({ id: '../bad id', role: 'compute', location: { jurisdiction: 'SG' } }); })).includes('PL-00'));
  assert.ok(rules(mutated((m) => { delete res(m, 'shore-hub').dataClasses; })).includes('PL-10'), 'an undeclared store is not treated as holding nothing');
  assert.ok(rules(mutated((m) => { delete res(m, 'infer').processesDataClasses; })).includes('PL-10'));
  assert.ok(ROLES.includes('inference') && ROLES.includes('diagnostic-sink'));
});

test('PL-04 a non-bound flow marked as requiring approval needs one, and the author of the manifest cannot be mistaken for the approver', () => {
  const flow = { id: 'fl-5', from: 'ev-store', to: 'shore-hub', dataClasses: ['DC-05'], approvedFlowId: 'AF-5', requiresApproval: true };
  assert.ok(rules(mutated((m) => { m.flows.push(flow); })).includes('PL-04'));
  assert.deepEqual(rules(mutated((m) => { m.flows.push(flow); m.approvedFlows.push({ id: 'AF-5', dataClass: 'DC-05', fromJurisdiction: 'SG', toJurisdiction: 'XX', fromResource: 'ev-store', toResource: 'shore-hub', legalBasisRef: 'REF', approverId: 'owner', expiry: '2026-12-31' }); })), []);
});

test('PL-10 queue, edge-buffer and key-store roles must declare what they hold', () => {
  for (const role of ['queue', 'edge-buffer', 'key-store']) assert.ok(rules(mutated((m) => { m.resources.push({ id: `x-${role}`, role, dataClasses: [], location: { jurisdiction: 'SG' }, redundancy: 'local', publicAccess: false, sharedKeyAccess: false, admin: { accessFrom: ['SG'] } }); })).includes('PL-10'), role);
});

test('a declared manifest is a claim, not evidence: the checker states that the real check needs a deployed cell', () => {
  const r = checkPlacement(good(), { now: NOW }); assert.equal(r.ok, true);
  assert.ok(!('verified' in r), 'a pass never says a resource is verified');
});
