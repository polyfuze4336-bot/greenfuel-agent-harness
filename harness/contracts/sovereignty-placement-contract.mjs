// CANDIDATE CONTRACT AND REFERENCE MODEL, NOT AN APPLICATION (Phase 0, HC-11). It checks a DECLARED placement manifest on synthetic fixtures. It proves nothing about any real
// resource: a manifest is a claim, and the real validation (resource queries, policy and network evidence in an approved subscription) cannot run until a cell exists
// (see infra/discovery and docs/target-architecture/12-DATA-MOVEMENT-AND-RESIDENCY-VALIDATION.md). Fail closed: anything unknown OR UNDECLARED is a violation, not a pass.
// It states, as executable checks, the placement rules of HC-01 and SEC-001 to SEC-004: stores, replicas, backups, logs, diagnostics, keys, inference and administration
// must be in the cell's jurisdiction; any cross-jurisdiction flow needs an approved-flow entry bound to that exact flow (class, source, destination, legal basis, approver, expiry).
// It does NOT decide what "within the jurisdiction" means (D-009) or which flows are lawful (D-011): those are inputs.
const BOUND = new Set(['DC-01', 'DC-02', 'DC-03', 'DC-04', 'DC-06', 'DC-07', 'DC-08', 'DC-09', 'DC-10', 'DC-11', 'DC-12', 'DC-13', 'DC-16']);
const ALL_CLASSES = new Set([...BOUND, 'DC-05', 'DC-14', 'DC-15', 'DC-17', 'DC-18']);
export const ROLES = ['evidence-store', 'ledger', 'backup', 'replica', 'log-workspace', 'diagnostic-sink', 'key-store', 'inference', 'queue', 'edge-buffer', 'compute', 'telemetry-export'];
const MUST_DECLARE = ['backup', 'replica', 'evidence-store', 'ledger', 'key-store', 'queue', 'edge-buffer'];
const LOG_ROLES = ['log-workspace', 'diagnostic-sink', 'telemetry-export'];
const REDUNDANCY = ['local', 'zone', 'geo'];
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const str = (v) => typeof v === 'string' && v.length > 0;

export function checkPlacement(manifest, { now = new Date() } = {}) {
  const findings = []; const add = (rule, subject, msg) => findings.push({ rule, subject, msg });
  const m = manifest;
  if (!m || typeof m !== 'object' || !str(m.cell?.jurisdiction) || !Array.isArray(m.resources) || m.resources.length === 0 || !Array.isArray(m.flows) || !Array.isArray(m.approvedFlows)) return { ok: false, findings: [{ rule: 'PL-00', subject: 'manifest', msg: 'the manifest is incomplete: a cell jurisdiction, at least one resource, flows and approvedFlows are required' }] };
  const J = m.cell.jurisdiction; const byId = new Map(); const seen = new Set();
  for (const r of m.resources) {
    if (!r || typeof r !== 'object' || !ID.test(r.id ?? '')) { add('PL-00', String(r?.id), 'resource has no valid identifier'); continue; }
    if (seen.has(r.id)) { add('PL-00', r.id, 'duplicate resource identifier: a later entry must not hide an earlier one'); continue; }
    seen.add(r.id); byId.set(r.id, r);
  }
  for (const r of byId.values()) {
    if (!ROLES.includes(r.role)) { add('PL-09', r.id, `unknown role '${r.role}': an unknown resource is treated as a violation`); continue; }
    if (!Array.isArray(r.dataClasses)) add('PL-10', r.id, 'the data classes held are not declared: an undeclared resource is treated as a violation, not as holding nothing');
    if (MUST_DECLARE.includes(r.role) && Array.isArray(r.dataClasses) && r.dataClasses.length === 0) add('PL-10', r.id, `a ${r.role} must declare what it holds`);
    for (const c of r.dataClasses ?? []) if (!ALL_CLASSES.has(c)) add('PL-10', r.id, `unknown data class '${c}'`);
    const bound = (r.dataClasses ?? []).some((c) => BOUND.has(c));
    if (!str(r.location?.jurisdiction)) { add('PL-09', r.id, 'no declared jurisdiction'); continue; }
    if (bound && r.location.jurisdiction !== J) add('PL-01', r.id, `holds jurisdiction-bound data but is located in ${r.location.jurisdiction}, not ${J}`);
    if (bound) {
      // Safe values must be declared, not merely absent: an omitted property is not evidence of safety.
      if (r.publicAccess !== false) add('PL-05', r.id, r.publicAccess === true ? 'a store holding bound data allows public access' : 'public access is not declared as false');
      if (r.sharedKeyAccess !== false) add('PL-05', r.id, r.sharedKeyAccess === true ? 'a store holding bound data allows shared-key access' : 'shared-key access is not declared as false');
      if (!REDUNDANCY.includes(r.redundancy)) add('PL-08', r.id, `redundancy is not declared as one of ${REDUNDANCY.join(', ')} (got '${r.redundancy}')`);
      if (!Array.isArray(r.admin?.accessFrom) || r.admin.accessFrom.length === 0) add('PL-06', r.id, 'administrative access paths are not declared');
    }
    if (r.redundancy !== undefined && !REDUNDANCY.includes(r.redundancy) && !bound) add('PL-08', r.id, `unknown redundancy value '${r.redundancy}'`);
    if (r.role === 'inference') {
      if (!Array.isArray(r.processesDataClasses)) add('PL-10', r.id, 'the data classes sent to the inference endpoint are not declared');
      for (const c of r.processesDataClasses ?? []) if (!ALL_CLASSES.has(c)) add('PL-10', r.id, `unknown data class '${c}' in processesDataClasses`);
      const sends = (r.processesDataClasses ?? []).some((c) => BOUND.has(c));
      if (sends && r.location.jurisdiction !== J) add('PL-07', r.id, 'inference over bound data runs outside the jurisdiction (SEC-003)');
      if (sends && r.processingLocationVerified !== true) add('PL-07', r.id, 'bound data is sent to an inference endpoint whose processing location is not verified (D-028)');
    }
    for (const from of r.admin?.accessFrom ?? []) if (from !== J && !(r.admin?.breakGlassApproved === true && r.admin?.breakGlassIn === J)) add('PL-06', r.id, `administrative access from ${from} without an approved break-glass inside ${J} (SEC-002)`);
    for (const t of r.replicatesTo ?? []) {
      const tgt = byId.get(t);
      if (!tgt) { add('PL-02', r.id, `replicates to '${t}', which is not in the manifest (unknown target)`); continue; }
      if (tgt.location?.jurisdiction !== J && bound) add('PL-02', r.id, `replicates or backs up bound data to ${tgt.id} in ${tgt.location?.jurisdiction ?? 'an undeclared jurisdiction'}`);
    }
    if (r.redundancy === 'geo') {
      if (!str(r.pairedRegionJurisdiction)) add('PL-08', r.id, 'geo-redundancy is declared without the jurisdiction of the paired region: treated as a violation');
      else if (r.pairedRegionJurisdiction !== J && bound) add('PL-08', r.id, `geo-redundant copy goes to ${r.pairedRegionJurisdiction}`);
    }
    if (LOG_ROLES.includes(r.role)) {
      if (typeof r.containsBoundContent !== 'boolean') add('PL-03', r.id, 'whether this log or diagnostic stream contains bound content is not declared as a boolean');
      else if (r.location.jurisdiction !== J && (bound || r.containsBoundContent)) add('PL-03', r.id, 'logs or diagnostics that contain bound data are located outside the jurisdiction (SEC-014)');
    }
  }
  const approvedFor = (f, c, fj, tj) => m.approvedFlows.some((a) => str(f.approvedFlowId) && a.id === f.approvedFlowId && a.dataClass === c && a.fromJurisdiction === fj && a.toJurisdiction === tj
    && a.fromResource === f.from && a.toResource === f.to && str(a.legalBasisRef) && str(a.approverId) && Date.parse(a.expiry) > now.getTime());
  for (const f of m.flows) {
    const from = byId.get(f?.from); const to = byId.get(f?.to);
    const fj = from?.location?.jurisdiction; const tj = to?.location?.jurisdiction; const label = f?.id ?? '?';
    if (!from || !to || !fj || !tj) { add('PL-09', label, 'a flow names a resource that is not declared with a jurisdiction'); continue; }
    const classes = f.dataClasses;
    if (!Array.isArray(classes) || classes.length === 0) { add('PL-10', label, 'a flow must declare the data classes it carries: an unlabelled flow is not assumed empty'); continue; }
    if (classes.some((c) => !ALL_CLASSES.has(c))) { add('PL-10', label, 'unknown data class in a flow'); continue; }
    // The label cannot be used to launder: what a flow carries must be something its source is declared to hold.
    const held = new Set([...(from.dataClasses ?? []), ...(from.processesDataClasses ?? [])]);
    const unheld = classes.filter((c) => !held.has(c));
    if (unheld.length) add('PL-10', label, `labels classes ${unheld.join(', ')} that the source ${from.id} is not declared to hold`);
    if (fj === tj) continue;
    for (const c of classes) {
      if (BOUND.has(c) && !approvedFor(f, c, fj, tj)) add('PL-04', label, `moves ${c} from ${fj} to ${tj} (${f.from} to ${f.to}) without an approved-flow entry bound to this class, source, destination and flow, with a legal basis, an approver and an unexpired date (SEC-004)`);
      else if (!BOUND.has(c) && f.requiresApproval === true && !approvedFor(f, c, fj, tj)) add('PL-04', label, `a flow of ${c} marked as requiring approval crosses ${fj} to ${tj} without one`);
    }
  }
  return { ok: findings.length === 0, findings };
}
