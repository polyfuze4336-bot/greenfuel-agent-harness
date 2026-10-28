// Builders for SYNTHETIC test fixtures of the candidate data contracts (schema ids end in "v0-candidate").
// Nothing here is real delivery, factor or certificate data. Names and values are placeholders that exist only to
// exercise the validators. Run `node tests/support/builders.mjs --write` to refresh tests/fixtures/*.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, sha256, recordHash, SCHEMAS } from '../../harness/scripts/spec-validators.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const clone = (v) => JSON.parse(JSON.stringify(v));

export function placement() {
  return {
    schema: SCHEMAS.placement,
    id: 'PL-SYNTHETIC-001',
    port: 'SYNTHETIC-PORT-A',
    jurisdiction: 'SYNTHETIC-JURISDICTION-A',
    placements: [
      { component: 'edge-buffer', dataClass: 'DC-01', zone: 'Z1', residencyBasis: 'physical-location-in-port' },
      { component: 'shore-evidence-store', dataClass: 'DC-02', zone: 'Z2', residencyBasis: 'hosting-model-per-D-010' },
      { component: 'certificate-store', dataClass: 'DC-08', zone: 'Z2', residencyBasis: 'hosting-model-per-D-010' },
      { component: 'customer-portal-view', dataClass: 'DC-11', zone: 'Z5', flowId: 'F-14', residencyBasis: 'customer-own-data-export-policy' },
    ],
  };
}

export function lineage() {
  const calcResult = { value: 1, unit: 'synthetic-unit' };
  return {
    schema: SCHEMAS.lineage,
    id: 'LN-SYNTHETIC-001',
    records: [
      { id: 'R1', kind: 'raw', origin: 'sensor', source: 'SYNTHETIC-METER-1', sequence: 1, trustedTime: '2030-01-01T00:00:00Z', content: 'synthetic reading 1', contentSha256: sha256('synthetic reading 1') },
      { id: 'R2', kind: 'raw', origin: 'sensor', source: 'SYNTHETIC-METER-1', sequence: 2, trustedTime: '2030-01-01T00:01:00Z', content: 'synthetic reading 2', contentSha256: sha256('synthetic reading 2') },
      { id: 'C1', kind: 'calculation', origin: 'deterministic-calc', inputs: ['R1', 'R2'], methodologyVersion: 'SM-001@0.1.0', factorSetVersion: 'SF-001@0.1.0', build: 'synthetic-build-1', result: calcResult, resultSha256: sha256(canonical(calcResult)) },
      { id: 'E1', kind: 'evidence-package', origin: 'deterministic-calc', inputs: ['R1', 'R2', 'C1'] },
      { id: 'K1', kind: 'certificate', origin: 'human', inputs: ['E1'], approval: { role: 'quality-manager', approverType: 'human', approvedBy: 'SYNTHETIC-APPROVER', approvedAt: '2030-01-02T00:00:00Z' } },
    ],
  };
}

export function method() {
  const doc = {
    schema: SCHEMAS.method,
    id: 'SM-001',
    version: '0.1.0',
    status: 'Draft',
    synthetic: true,
    schemeCandidate: 'V-01',
    deterministic: true,
    usesModel: false,
    inputs: [{ name: 'synthetic-input', unit: 'synthetic-unit' }],
    outputs: [{ name: 'synthetic-output', unit: 'synthetic-unit' }],
    referenceData: { factorSetId: 'SF-001', version: '0.1.0' },
    factors: [{ name: 'synthetic-factor', value: 1, unit: 'synthetic-unit', source: 'SYNTHETIC-FIXTURE: not a real factor' }],
  };
  return { ...doc, definitionSha256: sha256(canonical(doc)) };
}

export function certificates() {
  const m = method();
  const base = (i, prev, status) => ({
    id: `CERT-SYNTHETIC-00${i}`, sequence: i, status,
    payload: { delivery: `SYNTHETIC-DELIVERY-${i}`, quantity: 'synthetic' },
    jurisdiction: 'SYNTHETIC-JURISDICTION-A', hosting: { zone: 'Z2' },
    methodology: { ref: 'SM-001@0.1.0', definitionSha256: m.definitionSha256 },
    previousSha256: prev,
    approval: { role: 'quality-manager', approverType: 'human', approvedBy: 'SYNTHETIC-APPROVER', approvedAt: '2030-01-02T00:00:00Z' },
  });
  const seal = (c) => { const withPayload = { ...c, payloadSha256: sha256(canonical(c.payload)) }; return { ...withPayload, recordSha256: recordHash(withPayload) }; };
  const c1 = seal(base(1, null, 'Issued'));
  const c2 = seal(base(2, c1.recordSha256, 'Filed'));
  return { schema: SCHEMAS.certificate, certificates: [c1, c2] };
}

// Re-seal a certificate chain after a test edits it, so only the intended defect remains.
export function resealChain(doc) {
  const d = clone(doc);
  let prev = null;
  d.certificates = d.certificates.map((c, i) => {
    const n = { ...c, previousSha256: i === 0 ? null : prev, payloadSha256: sha256(canonical(c.payload)) };
    n.recordSha256 = recordHash(n);
    prev = n.recordSha256;
    return n;
  });
  return d;
}

export const FIXTURES = {
  'tests/fixtures/sovereignty/valid-placement.json': placement,
  'tests/fixtures/lineage/valid-lineage.json': lineage,
  'tests/fixtures/emissions-methods/valid-method.json': method,
  'tests/fixtures/certificates/valid-chain.json': certificates,
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--write')) {
  for (const [rel, build] of Object.entries(FIXTURES)) {
    writeFileSync(path.join(ROOT, rel), `${JSON.stringify(build(), null, 2)}\n`);
    console.log(`wrote ${rel}`);
  }
}
