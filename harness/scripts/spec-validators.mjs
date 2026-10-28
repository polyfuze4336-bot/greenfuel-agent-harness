#!/usr/bin/env node
// Deterministic validators for specifications, contracts and test fixtures. Zero dependencies.
// Usage: node harness/scripts/spec-validators.mjs <name> [--path <file-or-folder>] [--require] [--json]
// Names: requirements, architecture, agent-permissions, sovereignty, evidence-lineage, emissions-methods,
//        certificate-integrity, deployment-readiness, tools   (a leading "validate-" is accepted)
//
// SCOPE, stated plainly: these check documents, candidate data contracts (schema ids end in "v0-candidate")
// and synthetic fixtures. No product application exists, so nothing here validates one. A result of EMPTY means
// "no specification was found, so nothing was checked"; it is never a pass. The candidate contracts are test
// oracles for ideas still under decision (for example D-013); they do not make those decisions.
import { readFileSync, existsSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContext, validateContext, rowsOf, hasContext } from './validate-context.mjs';
import { validateArchitecture } from './validate-architecture.mjs';
import { validateAgents } from './validate-agents.mjs';
import { validateTools } from './validate-tools.mjs';
import { azureBlockers } from './validate-azure.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');
const ALLOWED_ROOTS = ['docs/specs/', 'tests/fixtures/'];
const MAX_FILE_BYTES = 1_000_000;
const HEX64 = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
export const SCHEMAS = {
  placement: 'greenfuel.placement/v0-candidate',
  lineage: 'greenfuel.lineage/v0-candidate',
  method: 'greenfuel.emissions-method/v0-candidate',
  certificate: 'greenfuel.certificate/v0-candidate',
};
const DEFAULT_DIRS = {
  sovereignty: 'docs/specs/placement',
  'evidence-lineage': 'docs/specs/lineage',
  'emissions-methods': 'docs/specs/emissions-methods',
  'certificate-integrity': 'docs/specs/certificates',
};

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
export const canonical = (v) => JSON.stringify(sortKeys(v));
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const isoOk = (v) => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v));

const result = (name, checked, errors, notes = [], status) => ({
  name, checked, errors, notes, status: status ?? (errors.length ? 'FAIL' : checked === 0 ? 'EMPTY' : 'PASS'),
});

// A path argument must stay inside the repository and inside a folder meant for specifications or fixtures.
export function resolveSpecPath(root, p) {
  const abs = path.resolve(root, String(p));
  const rel = path.relative(root, abs).split(path.sep).join('/');
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`path must be inside the repository: ${p}`);
  if (!ALLOWED_ROOTS.some((r) => (rel + '/').startsWith(r))) throw new Error(`path must be under ${ALLOWED_ROOTS.join(' or ')}: ${rel}`);
  if (existsSync(abs)) {
    const real = path.relative(realpathSync.native(root), realpathSync.native(abs)).split(path.sep).join('/');
    if (real.startsWith('..') || path.isAbsolute(real) || !ALLOWED_ROOTS.some((r) => (real + '/').startsWith(r))) throw new Error(`path resolves outside the allowed folders: ${rel}`);
  }
  return abs;
}

function specFiles(root, name, pathArg, errors) {
  const target = pathArg ? resolveSpecPath(root, pathArg) : path.join(root, DEFAULT_DIRS[name]);
  if (!existsSync(target)) return { files: [], target };
  const files = statSync(target).isDirectory()
    ? readdirSync(target).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(target, f)) : [target];
  const out = [];
  for (const f of files) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    if (statSync(f).size > MAX_FILE_BYTES) { errors.push({ msg: `${rel}: file larger than ${MAX_FILE_BYTES} bytes` }); continue; }
    try { out.push({ rel, doc: JSON.parse(readFileSync(f, 'utf8')) }); } catch (e) { errors.push({ msg: `${rel}: invalid JSON (${e.message})` }); }
  }
  return { files: out, target };
}

// ---------- wrappers over the existing validators ----------
const wrap = (name, fn) => (root) => {
  const errors = fn(root).map((e) => ({ msg: `[${e.check ?? name}] ${e.msg}` }));
  return result(name, 1, errors, ['Checks documents and configuration in this repository; there is no application to check.']);
};

// ---------- sovereignty ----------
export function parseMatrix(root) {
  const read = (p) => readFileSync(path.join(root, p), 'utf8');
  const rows = rowsOf(read('docs/context/SOVEREIGNTY-MATRIX.md'));
  const header = rows.find((c) => c[0] === 'Data class');
  const zones = header ? header.slice(1) : [];
  const cells = new Map();
  for (const c of rows) {
    const id = c[0].match(/^(DC-\d\d) /)?.[1];
    if (!id) continue;
    zones.forEach((z, i) => {
      const raw = c[i + 1] ?? '';
      const kind = raw.startsWith('Cond') ? 'Cond' : raw.startsWith('TBD') ? 'TBD' : raw.startsWith('Yes') ? 'Yes' : raw === 'No' ? 'No' : raw === '–' ? 'NA' : 'Invalid';
      cells.set(`${id}|${z}`, { kind, raw, decision: raw.match(/D-\d{3}/)?.[0] ?? null });
    });
  }
  const flows = new Set(rows.map((c) => c[0]).filter((x) => /^F-\d\d$/.test(x)));
  const classes = new Map();
  for (const c of rowsOf(read('docs/context/DATA-CLASSIFICATION.md'))) if (/^DC-\d\d$/.test(c[0])) classes.set(c[0], { residency: c[4] });
  return { zones, cells, flows, classes };
}

function checkMatrix(m, ctx, errs) {
  const err = (msg) => errs.push({ msg: `SOVEREIGNTY-MATRIX: ${msg}` });
  if (m.zones.join() !== 'Z1,Z2,Z3,Z4,Z5,Z6,Z7') err(`expected zones Z1..Z7, found ${m.zones.join(',') || 'none'}`);
  const rowIds = new Set([...m.cells.keys()].map((k) => k.split('|')[0]));
  for (const id of m.classes.keys()) if (!rowIds.has(id)) err(`${id} is in DATA-CLASSIFICATION but has no placement row`);
  for (const id of rowIds) if (!m.classes.has(id)) err(`${id} has a placement row but is not in DATA-CLASSIFICATION`);
  for (const [key, cell] of m.cells) {
    const [dc, zone] = key.split('|');
    if (cell.kind === 'Invalid') err(`${dc} ${zone}: cell '${cell.raw}' is not Yes, No, Cond (D-nnn), TBD (D-nnn) or –`);
    if ((cell.kind === 'Cond' || cell.kind === 'TBD') && (!cell.decision || (ctx && !ctx.decisions.has(cell.decision)))) err(`${dc} ${zone}: ${cell.kind} must name a decision in the register (found '${cell.raw}')`);
    const residency = m.classes.get(dc)?.residency ?? '';
    if (/^Port-bound/.test(residency)) {
      if (zone === 'Z4' && cell.kind !== 'No') err(`${dc} is Port-bound, so Z4 (processing location not pinned) must be No, found '${cell.raw}'`);
      if (['Z3', 'Z6'].includes(zone) && cell.kind === 'Yes') err(`${dc} is Port-bound, so ${zone} must not be an unconditional Yes`);
      if (zone === 'Z7' && cell.kind === 'Yes') err(`${dc} is Port-bound, so Z7 must not be an unconditional Yes`);
    }
    if (residency === 'TBD' && ['Z3', 'Z4', 'Z6'].includes(zone) && cell.kind === 'Yes') err(`${dc} has undecided residency, so ${zone} must not be Yes`);
  }
}

function checkPlacement(doc, rel, m, ctx, errs) {
  const err = (msg) => errs.push({ msg: `${rel}: ${msg}` });
  if (doc.schema !== SCHEMAS.placement) err(`schema must be '${SCHEMAS.placement}'`);
  for (const k of ['id', 'port', 'jurisdiction']) if (!nonEmpty(doc[k])) err(`${k} is required`);
  if (!Array.isArray(doc.placements) || !doc.placements.length) { err('placements must be a non-empty array'); return; }
  doc.placements.forEach((p, i) => {
    const at = `placements[${i}] (${p.component ?? '?'})`;
    if (!nonEmpty(p.component)) err(`${at}: component is required`);
    if (!m.classes.has(p.dataClass)) { err(`${at}: unknown data class '${p.dataClass}'`); return; }
    if (!m.zones.includes(p.zone)) { err(`${at}: unknown zone '${p.zone}'`); return; }
    if (p.residencyBasis === 'region' || p.residencyBasis === 'azure-region') err(`${at}: a cloud region is not a residency control (SEC-001, D-009); name the control and its evidence`);
    const cell = m.cells.get(`${p.dataClass}|${p.zone}`);
    if (cell.kind === 'No') err(`${at}: ${p.dataClass} in ${p.zone} is prohibited by the matrix`);
    else if (cell.kind === 'NA') err(`${at}: ${p.dataClass} in ${p.zone} is not applicable per the matrix`);
    else if (cell.kind === 'Cond' || cell.kind === 'TBD') {
      const adr = String(p.approvedBy ?? '').match(/^ADR-(\d{4})$/)?.[1];
      const decided = ctx?.decisions.get(cell.decision)?.status.startsWith('Decided');
      if (!adr || ctx?.adrStatus.get(adr) !== 'Accepted') err(`${at}: ${cell.kind} placement needs approvedBy naming an Accepted ADR (matrix: ${cell.raw})`);
      if (!decided) err(`${at}: decision ${cell.decision} is still open, so the placement is not permitted`);
    }
    if (['Z3', 'Z4', 'Z5', 'Z6', 'Z7'].includes(p.zone) && !m.flows.has(p.flowId)) err(`${at}: a placement outside the jurisdiction must cite a flow id from the inventory (F-nn)`);
  });
}

function sovereignty(root, pathArg) {
  const errors = [];
  if (!existsSync(path.join(root, 'docs/context/SOVEREIGNTY-MATRIX.md'))) return result('sovereignty', 0, [{ msg: 'docs/context/SOVEREIGNTY-MATRIX.md is missing' }]);
  const ctx = hasContext(root) ? loadContext(root) : null;
  const m = parseMatrix(root);
  checkMatrix(m, ctx, errors);
  const { files } = specFiles(root, 'sovereignty', pathArg, errors);
  for (const f of files) checkPlacement(f.doc, f.rel, m, ctx, errors);
  const notes = ['Matrix consistency is always checked. Placement declarations are optional specifications.'];
  if (!files.length) notes.push('No placement declarations found; only the matrix itself was checked.');
  notes.push('A region name is never accepted as residency evidence.');
  return result('sovereignty', 1 + files.length, errors, notes);
}

// ---------- evidence lineage ----------
const LAYERS = { raw: 0, 'reference-data': 0, calculation: 1, 'evidence-package': 2, certificate: 3 };
const INPUT_KINDS = {
  calculation: ['raw', 'reference-data', 'calculation'],
  'evidence-package': ['raw', 'reference-data', 'calculation', 'evidence-package'],
  certificate: ['evidence-package', 'calculation'],
};
const ORIGINS = { raw: ['sensor', 'document'], 'reference-data': ['document'], calculation: ['deterministic-calc'], 'evidence-package': ['deterministic-calc'], certificate: ['human'] };

function checkLineage(doc, rel, errs) {
  const err = (msg) => errs.push({ msg: `${rel}: ${msg}` });
  if (doc.schema !== SCHEMAS.lineage) err(`schema must be '${SCHEMAS.lineage}'`);
  if (!Array.isArray(doc.records) || !doc.records.length) { err('records must be a non-empty array'); return; }
  const byId = new Map();
  for (const r of doc.records) {
    if (!nonEmpty(r.id)) { err('every record needs an id'); continue; }
    if (byId.has(r.id)) err(`${r.id}: duplicate id`);
    byId.set(r.id, r);
  }
  const seq = new Map();
  for (const r of doc.records) {
    const at = r.id ?? '?';
    if (!(r.kind in LAYERS)) { err(`${at}: unknown kind '${r.kind}'`); continue; }
    if (r.origin === 'model') err(`${at}: a model cannot be the origin of a record (HC-06)`);
    else if (!ORIGINS[r.kind].includes(r.origin)) err(`${at}: origin '${r.origin}' is not permitted for ${r.kind} (allowed: ${ORIGINS[r.kind].join(', ')})`);
    if (r.kind === 'raw') {
      if (!nonEmpty(r.source)) err(`${at}: raw records need a source (DATA-002)`);
      if (!isoOk(r.trustedTime)) err(`${at}: raw records need an ISO UTC trustedTime (DATA-002)`);
      if (!Number.isInteger(r.sequence)) err(`${at}: raw records need an integer sequence (DATA-002)`);
      else {
        const last = seq.get(r.source) ?? 0;
        if (r.sequence <= last) err(`${at}: sequence ${r.sequence} is not greater than the previous ${last} for source ${r.source}; raw data is append-only`);
        seq.set(r.source, Math.max(last, r.sequence));
      }
      if (!HEX64.test(r.contentSha256 ?? '')) err(`${at}: contentSha256 must be 64 hex characters`);
      else if (typeof r.content === 'string' && sha256(r.content) !== r.contentSha256) err(`${at}: contentSha256 does not match the content`);
      if (r.inputs?.length) err(`${at}: raw records have no inputs`);
      continue;
    }
    if (!Array.isArray(r.inputs) || !r.inputs.length) { err(`${at}: ${r.kind} needs inputs (lineage must reach raw data)`); continue; }
    for (const i of r.inputs) {
      const src = byId.get(i);
      if (!src) { err(`${at}: input '${i}' does not exist`); continue; }
      if (i === r.id) err(`${at}: a record cannot use itself as input`);
      if (INPUT_KINDS[r.kind] && !INPUT_KINDS[r.kind].includes(src.kind)) err(`${at}: a ${r.kind} cannot take a ${src.kind} as input (${i})`);
    }
    if (r.kind === 'calculation') {
      for (const k of ['methodologyVersion', 'factorSetVersion', 'build']) if (!nonEmpty(r[k])) err(`${at}: calculation must record ${k} (FR-009)`);
      if (r.result !== undefined) {
        if (!HEX64.test(r.resultSha256 ?? '')) err(`${at}: resultSha256 must be 64 hex characters`);
        else if (sha256(canonical(r.result)) !== r.resultSha256) err(`${at}: resultSha256 does not match the result`);
      }
    }
    if (r.kind === 'certificate') {
      const a = r.approval;
      if (!a || a.role !== 'quality-manager' || a.approverType !== 'human' || !nonEmpty(a.approvedBy) || !isoOk(a.approvedAt)) err(`${at}: a certificate needs a human quality-manager approval with approvedBy and approvedAt (HC-04)`);
    }
  }
  const state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === 2 || !byId.has(id)) return;
    if (state.get(id) === 1) { err(`cycle in lineage: ${[...trail.slice(trail.indexOf(id)), id].join(' -> ')}`); return; }
    state.set(id, 1);
    for (const i of byId.get(id).inputs ?? []) visit(i, [...trail, id]);
    state.set(id, 2);
  };
  for (const id of byId.keys()) visit(id, []);
  const reaches = new Map();
  const rawOf = (id, seen = new Set()) => {
    if (reaches.has(id)) return reaches.get(id);
    if (seen.has(id)) return false;
    seen.add(id);
    const r = byId.get(id);
    const ok = !r ? false : r.kind === 'raw' || (r.inputs ?? []).some((i) => rawOf(i, seen));
    reaches.set(id, ok);
    return ok;
  };
  for (const r of doc.records) if (r.id && r.kind in LAYERS && r.kind !== 'raw' && r.kind !== 'reference-data' && !rawOf(r.id)) err(`${r.id}: does not trace back to any raw record`);
}

function lineage(root, pathArg) {
  const errors = [];
  const { files } = specFiles(root, 'evidence-lineage', pathArg, errors);
  for (const f of files) checkLineage(f.doc, f.rel, errors);
  return result('evidence-lineage', files.length, errors, files.length ? ['Candidate contract v0; checks lineage bundles, not stored production evidence.'] : ['No lineage bundles found; nothing was checked.']);
}

// ---------- emissions methods ----------
function checkMethod(doc, rel, ctx, seen, errs) {
  const err = (msg) => errs.push({ msg: `${rel}: ${msg}` });
  if (doc.schema !== SCHEMAS.method) err(`schema must be '${SCHEMAS.method}'`);
  if (!nonEmpty(doc.id)) err('id is required');
  if (!SEMVER.test(doc.version ?? '')) err('version must be major.minor.patch');
  const key = `${doc.id}@${doc.version}`;
  if (seen.has(key)) err(`${key} is defined more than once; a version is immutable`);
  seen.add(key);
  if (!['Draft', 'Candidate', 'Verified'].includes(doc.status)) err('status must be Draft, Candidate or Verified');
  if (doc.deterministic !== true) err('deterministic must be true (HC-05)');
  if (doc.usesModel !== false) err('usesModel must be false: no model on a calculation path (HC-05)');
  for (const [list, label] of [[doc.inputs, 'inputs'], [doc.outputs, 'outputs']]) {
    if (!Array.isArray(list) || !list.length) err(`${label} must be a non-empty array`);
    else list.forEach((x) => { if (!nonEmpty(x.name) || !nonEmpty(x.unit)) err(`${label}: every entry needs a name and a unit (DATA-007)`); });
  }
  if (!nonEmpty(doc.referenceData?.factorSetId) || !SEMVER.test(doc.referenceData?.version ?? '')) err('referenceData needs factorSetId and a semantic version (DATA-005)');
  const scheme = doc.schemeCandidate;
  let schemeStatus = null;
  if (scheme !== undefined && scheme !== null) {
    const row = ctx ? rowsOf(readFileSync(path.join(ctx.root, 'docs/context/CERTIFICATION-SCHEMES.md'), 'utf8')).find((c) => c[0] === scheme) : null;
    if (ctx && !row) err(`schemeCandidate '${scheme}' is not in CERTIFICATION-SCHEMES`);
    schemeStatus = row ? row[row.length - 1] : null;
  }
  const real = doc.synthetic !== true;
  for (const f of doc.factors ?? []) {
    if (typeof f.value === 'number' || typeof f.value === 'string') {
      if (!nonEmpty(f.unit)) err(`factor ${f.name}: a value needs a unit`);
      if (!nonEmpty(f.source)) err(`factor ${f.name}: a value needs a cited source; values are never invented (HC-06)`);
      if ((real || doc.status === 'Verified') && !nonEmpty(f.verifiedBy)) err(`factor ${f.name}: needs verifiedBy (a named human)${real ? ' because this is not a synthetic fixture' : ''}`);
    }
  }
  if (doc.status === 'Verified') {
    const v = doc.verification;
    if (!v || !nonEmpty(v.verifiedBy) || !isoOk(v.verifiedAt) || !nonEmpty(v.evidence)) err('Verified needs verification with verifiedBy, verifiedAt and evidence');
    if (!nonEmpty(doc.sourceCitation)) err('Verified needs a sourceCitation');
    if (scheme && schemeStatus && !/^Verified/.test(schemeStatus)) err(`a method cannot be Verified while its scheme ${scheme} is '${schemeStatus}'; that claim still needs verification`);
  }
  if (real && !nonEmpty(doc.sourceCitation)) err('a non-synthetic method needs a sourceCitation');
  if (!HEX64.test(doc.definitionSha256 ?? '')) err('definitionSha256 must be 64 hex characters');
  else {
    const { definitionSha256, ...rest } = doc;
    if (sha256(canonical(rest)) !== definitionSha256) err('definitionSha256 does not match the definition; the record changed without a new version');
  }
}

function methods(root, pathArg) {
  const errors = [];
  const ctx = hasContext(root) ? { ...loadContext(root), root } : null;
  const { files } = specFiles(root, 'emissions-methods', pathArg, errors);
  const seen = new Set();
  for (const f of files) checkMethod(f.doc, f.rel, ctx, seen, errors);
  return result('emissions-methods', files.length, errors, files.length
    ? ['Candidate contract v0. It checks reproducibility and provenance rules, not the correctness of any methodology.']
    : ['No methodology records found; nothing was checked. No factor values exist in this repository and none may be invented.']);
}

// ---------- certificate integrity ----------
export const recordHash = (rec) => { const { recordSha256, ...rest } = rec; return sha256(canonical(rest)); };

function checkCertificates(doc, rel, errs) {
  const err = (msg) => errs.push({ msg: `${rel}: ${msg}` });
  if (doc.schema !== SCHEMAS.certificate) err(`schema must be '${SCHEMAS.certificate}'`);
  if (!Array.isArray(doc.certificates) || !doc.certificates.length) { err('certificates must be a non-empty array'); return; }
  let prev = null;
  const ids = new Set();
  doc.certificates.forEach((c, i) => {
    const at = `${c.id ?? `certificates[${i}]`}`;
    if (!nonEmpty(c.id)) err(`certificates[${i}]: id is required`);
    if (ids.has(c.id)) err(`${at}: duplicate id`);
    ids.add(c.id);
    if (c.sequence !== i + 1) err(`${at}: sequence must be ${i + 1}`);
    if (!HEX64.test(c.payloadSha256 ?? '') || sha256(canonical(c.payload ?? null)) !== c.payloadSha256) err(`${at}: payloadSha256 does not match the payload (tampered or altered)`);
    if (!HEX64.test(c.recordSha256 ?? '') || recordHash(c) !== c.recordSha256) err(`${at}: recordSha256 does not match the record (tampered or altered)`);
    if (i === 0 ? c.previousSha256 !== null : c.previousSha256 !== prev?.recordSha256) err(`${at}: previousSha256 does not link to the previous certificate; the chain is broken`);
    if (!['Z1', 'Z2'].includes(c.hosting?.zone)) err(`${at}: certificates must be locally hosted, so hosting.zone must be Z1 or Z2`);
    if (!nonEmpty(c.jurisdiction)) err(`${at}: jurisdiction is required`);
    if (!nonEmpty(c.methodology?.ref) || !HEX64.test(c.methodology?.definitionSha256 ?? '')) err(`${at}: methodology needs ref and definitionSha256 so the exact version is traceable (FR-009)`);
    if (!['Draft', 'Issued', 'Filed', 'Superseded'].includes(c.status)) err(`${at}: status must be Draft, Issued, Filed or Superseded`);
    if (['Issued', 'Filed'].includes(c.status)) {
      const a = c.approval;
      if (!a || a.role !== 'quality-manager' || a.approverType !== 'human' || !nonEmpty(a.approvedBy) || !isoOk(a.approvedAt)) err(`${at}: ${c.status} needs a human quality-manager approval (HC-04)`);
    }
    prev = c;
  });
}

function certificates(root, pathArg) {
  const errors = [];
  const { files } = specFiles(root, 'certificate-integrity', pathArg, errors);
  for (const f of files) checkCertificates(f.doc, f.rel, errors);
  return result('certificate-integrity', files.length, errors, files.length
    ? ['Candidate hash-chain contract used as a test oracle. Decision D-013 (tamper-evidence mechanism) is still open and is not decided here. Verification is local and offline.']
    : ['No certificate records found; nothing was checked.']);
}

// ---------- deployment readiness (preconditions recorded in the specifications) ----------
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

function readiness(root) {
  const blockers = [];
  const b = (msg) => blockers.push({ msg });
  let phase = 0;
  try { phase = JSON.parse(readFileSync(path.join(root, 'harness/policy/command-policy.json'), 'utf8')).phase ?? 0; } catch { b('harness/policy/command-policy.json is missing or invalid'); }
  if (phase < 1) b('Phase 0: application code, infrastructure and Azure changes are not permitted; raising the phase is a human decision recorded in an ADR');
  const hasIac = existsSync(path.join(root, 'infra')) || walk(root).some((f) => /\.(bicep|bicepparam|tf)$/.test(f));
  if (!hasIac) b('No infrastructure specification exists');
  else if (existsSync(path.join(root, 'infra/main.bicep')) && /SCAFFOLD, NOT DEPLOYABLE/.test(readFileSync(path.join(root, 'infra/main.bicep'), 'utf8'))) b('The only infrastructure is a non-deployable scaffold (ADR 0014): it has no approved design, no real parameter values and no what-if');
  const dir = path.join(root, 'docs/architecture/reviews');
  const reviews = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
  const approved = reviews.filter((f) => /^- \*\*Status:\*\*\s*Approved\b/mi.test(readFileSync(path.join(dir, f), 'utf8')));
  if (!approved.length) b(`No design review has status Approved (${reviews.length} review record(s) exist)`);
  const archErrors = validateArchitecture(root);
  if (archErrors.length) b(`The architecture records have ${archErrors.length} problem(s), so no declared approval can be relied on`);
  if (hasContext(root)) {
    const ctx = loadContext(root);
    const open = [...ctx.decisions.values()].filter((d) => d.by === 'M1' && d.status === 'Open').map((d) => d.id);
    if (open.length) b(`${open.length} milestone-1 decisions are still open: ${open.join(', ')}`);
  }
  try {
    const todo = readFileSync(path.join(root, 'docs/state/TODO.md'), 'utf8');
    if (/^\| T3 \|.*Deferred/m.test(todo)) b('No human decider is named (TODO T3), so nothing can be approved');
  } catch { /* no TODO file: nothing to report */ }
  const toolErrors = validateTools(root);
  if (toolErrors.length) b(`The tool configuration has ${toolErrors.length} problem(s)`);
  for (const x of azureBlockers(root)) b(`[${x.gate}] ${x.msg}`);
  const status = blockers.length ? 'NOT-READY' : 'NO-BLOCKERS-FOUND';
  return result('deployment-readiness', 1, blockers, [
    'Checks the preconditions recorded in the specifications. It tests no application and cannot show that anything is ready.',
    'Deployment is a human-run action (HC-11). No result here authorises it, and NO-BLOCKERS-FOUND is not an approval.',
  ], status);
}

export const UTILITIES = {
  requirements: { run: wrap('requirements', validateContext), validates: 'requirements baseline: IDs, classes, traceability, decision register, context manifest' },
  architecture: { run: wrap('architecture', validateArchitecture), validates: 'ADRs, designs, review records, gate consistency, risk register, defence questions' },
  'agent-permissions': { run: wrap('agent-permissions', validateAgents), validates: 'agent files against agent-policy.json: tools, scopes, delegation, hooks, MCP tool grants' },
  sovereignty: { run: (root, p) => sovereignty(root, p), validates: 'sovereignty matrix consistency; optional placement declarations (candidate contract)' },
  'evidence-lineage': { run: (root, p) => lineage(root, p), validates: 'lineage bundles (candidate contract): raw to calculation to evidence to certificate' },
  'emissions-methods': { run: (root, p) => methods(root, p), validates: 'methodology records (candidate contract): versioning, provenance, no invented factors' },
  'certificate-integrity': { run: (root, p) => certificates(root, p), validates: 'certificate hash chains (candidate contract, D-013 undecided): tamper evidence, local hosting, human approval' },
  'deployment-readiness': { run: (root) => readiness(root), validates: 'recorded preconditions for a deployment; never authorises one' },
  tools: { run: wrap('tools', validateTools), validates: 'tool registry, MCP configuration, pins, limits, agent tool grants' },
};

export function runUtility(name, root = REPO, pathArg = null) {
  const key = String(name).replace(/^validate-/, '');
  const u = Object.hasOwn(UTILITIES, key) ? UTILITIES[key] : null;
  if (!u) throw new Error(`unknown utility '${name}'. Known: ${Object.keys(UTILITIES).join(', ')}`);
  return u.run(root, pathArg);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const name = args.find((a) => !a.startsWith('--'));
  const pi = args.indexOf('--path');
  try {
    if (!name) throw new Error(`usage: spec-validators.mjs <name> [--path p] [--require] [--json]. Names: ${Object.keys(UTILITIES).join(', ')}`);
    const r = runUtility(name, REPO, pi > 0 ? args[pi + 1] : null);
    if (args.includes('--json')) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(`${r.name}: ${r.status} (${r.checked} item(s) checked)`);
      for (const e of r.errors) console.log(`  - ${e.msg}`);
      for (const n of r.notes) console.log(`  note: ${n}`);
    }
    if (r.status === 'FAIL') process.exit(1);
    if (r.status === 'NOT-READY') process.exit(2);
    if (r.status === 'EMPTY' && args.includes('--require')) process.exit(1);
    process.exit(0);
  } catch (e) { console.error(`spec-validators: ${e.message}`); process.exit(4); }
}
