#!/usr/bin/env node
// Azure readiness: validates the Azure documents, the infrastructure scaffold, the port assessment register and the deployment gate, and
// reports every recorded blocker to a deployment. Zero dependencies. It reads files and, with --bicep, runs the local Bicep compiler.
// It never signs in to Azure, never runs what-if, never deploys. NO-BLOCKERS-FOUND is not an approval: deployment is human-run (HC-11).
// Usage: node harness/scripts/validate-azure.mjs [--root <dir>] [--json] [--readiness] [--bicep]
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const j = (root, p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));
const has = (root, p) => existsSync(path.join(root, p));
const read = (root, p) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const PLACEHOLDER = 'REQUIRES-APPROVAL';
const ENVS = ['dev', 'test', 'prod'];
export const VALIDATIONS = ['replication', 'backups', 'diagnostics', 'supportAccess', 'disasterRecovery', 'aiInference', 'identityAndControlPlane', 'pipelines'];
const HOSTING = ['A', 'B', 'C', 'D', 'None'];
const ROLE_ALLOWED = new Set(['ba92f5b4-2d11-453d-a403-e96b0029c9fe', '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1', '4633458b-17de-408a-b874-0445c86b69e6', '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39', '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0']);
const ROLE_BROAD = { '8e3af657-a8ff-443c-a75c-2fe8c4bcb635': 'Owner', 'b24988ac-6180-42a0-ab88-20f7382dd24c': 'Contributor', '18d7d88d-d35e-4fb5-a5c3-7773c20a72d9': 'User Access Administrator' };
const DOCS = ['AZURE-REFERENCE-ARCHITECTURE', 'REGIONAL-AVAILABILITY', 'SOVEREIGNTY-DEPLOYMENT-MATRIX', 'DEPLOYMENT-STRATEGY', 'RESOURCE-INVENTORY', 'COST-AND-CAPACITY', 'OPERATIONS-AND-DR', 'AZURE-READINESS-ASSESSMENT'];
const DOC_TOPICS = {
  'AZURE-REFERENCE-ARCHITECTURE': ['Provisional', 'Candidate service evaluation', 'Well-Architected', 'Separation', 'Limits'],
  'REGIONAL-AVAILABILITY': ['Verification', 'Not verified', 'Limits'],
  'SOVEREIGNTY-DEPLOYMENT-MATRIX': ['Hosting options', 'Port', 'Validations', 'Limits'],
  'DEPLOYMENT-STRATEGY': ['Environments', 'Approval gates', 'Identities', 'Reuse', 'Rollback', 'Limits'],
  'RESOURCE-INVENTORY': ['Discovery', 'Reuse', 'Limits'],
  'COST-AND-CAPACITY': ['Cost drivers', 'Budget', 'Not estimated', 'Limits'],
  'OPERATIONS-AND-DR': ['Monitoring', 'Disaster recovery', 'Runbooks', 'Limits'],
  'AZURE-READINESS-ASSESSMENT': ['Capabilities', 'Blockers', 'Approvals needed', 'Limits'],
};

// ---------------------------------------------------------------- infrastructure policy (exported so tests and evaluation can use fixtures)
// Problems in one Bicep file. `file` is the repository-relative path, used to decide which module rules apply.
export function iacProblems(text, file, secretPatterns = []) {
  const p = []; const bad = (m) => p.push(`${file}: ${m}`);
  const t = text.replace(/\r\n/g, '\n'); const code = t.replace(/^\s*\/\/.*$/gm, '');
  const rules = [
    [/publicNetworkAccess\w*\s*:\s*'Enabled'/i, "public network access is enabled"],
    [/allowSharedKeyAccess\s*:\s*true/i, 'shared key access is enabled'],
    [/disableLocalAuth\s*:\s*false/i, 'local (key or SAS) authentication is enabled'],
    [/allowBlobPublicAccess\s*:\s*true/i, 'anonymous blob access is enabled'],
    [/Standard_(RA)?G(Z)?RS/, 'a geo-redundant storage SKU copies data to another region (HC-01)'],
    [/geoRedundantBackup\s*:\s*'Enabled'/i, 'geo-redundant backup copies data to another region (HC-01)'],
    [/\b(listKeys|listConnectionStrings|listCredentials|listAccountSas|listServiceSas|listAdminCreds)\s*\(/i, 'a key or connection string is read in the template'],
    [/\b(primaryKey|secondaryKey|primaryConnectionString|secondaryConnectionString)\b/i, 'a key or connection string is referenced'],
    [/administratorLoginPassword|adminPassword|passwordAuth\s*:\s*'Enabled'/i, 'password authentication or an administrator password is configured'],
    [/\b(password|secret|apikey|api_key|accountkey)\s*:\s*'[^']{6,}'/i, 'a literal credential value'],
    [/@secure\(\)\s*\n\s*param\s+\w+\s+\w+\s*=\s*'[^']+'/, 'a secure parameter has a default value'],
    [/\b(az|azd)\s+(login|deployment|group\s+create)|azure\/login/i, 'a deployment or sign-in command is embedded'],
  ];
  for (const [re, msg] of rules) if (re.test(code)) bad(msg);
  for (const s of secretPatterns) { try { if (new RegExp(s).test(code)) bad('a credential-shaped string'); } catch { /* skip an unusable pattern */ } }
  for (const m of code.matchAll(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi)) {
    const g = m[1].toLowerCase();
    if (ROLE_BROAD[g]) bad(`the broad role ${ROLE_BROAD[g]} is granted; least privilege forbids it`);
  }
  if (/Microsoft\.Authorization\/roleAssignments/.test(code) && !/identity-rbac\.bicep$/.test(file)) bad('role assignments belong in the identity-rbac module only');
  for (const m of code.matchAll(/^var\s+\w+\s*=\s*'([0-9a-f-]{36})'/gim)) if (!ROLE_ALLOWED.has(m[1].toLowerCase()) && /identity-rbac/.test(file) && /roleDefinitionId|Role|role/i.test(text)) {
    // a policy definition id is allowed in guardrails; in identity-rbac every id is a role and must be on the pinned list
    bad(`role definition ${m[1]} is not on the pinned least-privilege list`);
  }
  if (/^param\s+\w+\s+\w+\s*=/m.test(code)) bad('a parameter has a default value: an unresolved decision must be a required parameter with no default');
  if (/(^|\/)main\.bicep$/.test(file)) {
    if (!/@allowed\(\s*\[\s*true\s*\]\s*\)\s*\n\s*param\s+deploymentApproved\s+bool/.test(code)) bad('deploymentApproved must accept only true, so a deployment cannot be reached by accident');
    for (const need of ['location', 'jurisdictionCode', 'approvalReference']) if (!new RegExp(`^param\\s+${need}\\s+string\\s*$`, 'm').test(code) && !new RegExp(`^param\\s+${need}\\s+string\\s*\\n`, 'm').test(code)) bad(`param ${need} must exist and be required`);
  }
  const need = (re, msg) => { if (!re.test(code)) bad(msg); };
  if (/evidence-storage\.bicep$/.test(file)) { need(/allowSharedKeyAccess\s*:\s*false/, 'evidence storage must disable shared keys'); need(/publicNetworkAccess\s*:\s*'Disabled'/, 'evidence storage must disable public network access'); need(/immutableStorageWithVersioning/, 'evidence storage must enable immutable storage with versioning'); need(/'Standard_LRS'\s*\n\s*'Standard_ZRS'/, 'evidence storage SKUs must be limited to LRS and ZRS'); need(/CanNotDelete/, 'evidence storage must carry a CanNotDelete lock'); }
  if (/key-vault\.bicep$/.test(file)) { need(/enablePurgeProtection\s*:\s*true/, 'key vault must enable purge protection'); need(/enableRbacAuthorization\s*:\s*true/, 'key vault must use Azure RBAC'); need(/publicNetworkAccess\s*:\s*'Disabled'/, 'key vault must disable public network access'); need(/CanNotDelete/, 'key vault must carry a CanNotDelete lock'); }
  if (/messaging\.bicep$/.test(file)) { need(/disableLocalAuth\s*:\s*true/, 'the message namespace must disable local authentication'); need(/publicNetworkAccess\s*:\s*'Disabled'/, 'the message namespace must disable public network access'); need(/requiresDuplicateDetection\s*:\s*true/, 'the ingestion queue must detect duplicates (NFR-005)'); }
  if (/postgres\.bicep$/.test(file)) { need(/passwordAuth\s*:\s*'Disabled'/, 'the database must disable password authentication'); need(/geoRedundantBackup\s*:\s*'Disabled'/, 'the database must disable geo-redundant backup'); need(/publicNetworkAccess\s*:\s*'Disabled'/, 'the database must disable public network access'); need(/CanNotDelete/, 'the database must carry a CanNotDelete lock'); }
  if (/container-apps-environment\.bicep$/.test(file)) { need(/internal\s*:\s*true/, 'the runtime environment must be internal only'); need(/destination\s*:\s*'azure-monitor'/, 'runtime logs must go to Azure Monitor, not through a workspace key'); }
  if (/monitoring\.bicep$/.test(file)) { need(/disableLocalAuth\s*:\s*true/, 'the workspace must disable local authentication'); need(/DisableLocalAuth\s*:\s*true/, 'Application Insights must disable local authentication'); need(/publicNetworkAccessForQuery\s*:\s*'Disabled'/, 'query access must not be public'); }
  return p;
}

// Problems in one port assessment register. A region is never evidence of residency.
export function portProblems(doc, file = 'docs/azure/data/port-assessments.json') {
  const p = []; const bad = (m) => p.push(`${file}: ${m}`);
  if (doc.schema !== 'greenfuel.port-assessments/v1') bad('schema must be greenfuel.port-assessments/v1');
  if (!Array.isArray(doc.ports)) { bad('ports must be a list (it is empty until D-003 names the ports)'); return p; }
  if (doc.defaultHostingUntilEstablished !== 'C') bad('defaultHostingUntilEstablished must be C: until residency is established the evidence store is jurisdiction-local with a controlled shore integration');
  const seen = new Set();
  for (const port of doc.ports) {
    const at = `port ${port.id ?? '?'}`;
    if (!/^PORT-[A-Z0-9-]{2,12}$/.test(port.id ?? '')) { bad(`${at}: id must look like PORT-XXX`); continue; }
    if (seen.has(port.id)) bad(`${at}: duplicate`); seen.add(port.id);
    if (!['Undetermined', 'NotEstablished', 'Established'].includes(port.residencyStatus)) bad(`${at}: residencyStatus must be Undetermined, NotEstablished or Established`);
    if (!HOSTING.includes(port.hostingOption)) bad(`${at}: hostingOption must be one of ${HOSTING.join(', ')}`);
    if (port.hostingOption === 'A' && port.residencyStatus !== 'Established') bad(`${at}: hosting A (in-country Azure region) needs residency Established`);
    if (port.residencyStatus === 'Undetermined' && !['C', 'None'].includes(port.hostingOption)) bad(`${at}: an undetermined port is C (jurisdiction-local evidence store) or None, never a cloud region`);
    const v = port.validations ?? {};
    for (const k of VALIDATIONS) if (!v[k]) bad(`${at}: validation '${k}' is missing`);
    if (port.residencyStatus === 'Established') {
      if (!/^D-009\b/.test(port.legalBasis?.decision ?? '') || !port.legalBasis?.reference) bad(`${at}: Established needs a legal basis (D-009 and a reference)`);
      if (!Array.isArray(port.basis) || !port.basis.length || port.basis.every((b) => /^region$/i.test(b))) bad(`${at}: a region is not a residency control; the basis cannot be the region alone`);
      for (const k of VALIDATIONS) {
        const x = v[k];
        if (!x || x.status !== 'Verified' || !Array.isArray(x.evidence) || !x.evidence.length || !x.verifiedBy || /agent|model|assistant/i.test(x.verifiedBy)) bad(`${at}: validation '${k}' must be Verified with evidence and a named human verifier`);
      }
      if (!port.verifiedBy || /agent|model|assistant/i.test(port.verifiedBy)) bad(`${at}: Established needs a named human verifier`);
    }
    for (const k of VALIDATIONS) if (v[k] && !['Unverified', 'Verified', 'Failed'].includes(v[k].status)) bad(`${at}: validation '${k}' status must be Unverified, Verified or Failed`);
  }
  return p;
}

// ---------------------------------------------------------------- the documents, the scaffold and the register
const walk = (dir, out = []) => { if (!existsSync(dir)) return out; for (const e of readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f, out); else out.push(f); } return out; };

export function validateAzure(root) {
  const errors = []; const fail = (msg) => errors.push({ check: 'azure', msg });
  try { check(root, fail); } catch (e) { fail(`the Azure configuration is malformed and could not be fully evaluated (${e.message})`); }
  return errors;
}

function check(root, fail) {
  for (const n of DOCS) if (!has(root, `docs/azure/${n}.md`)) fail(`missing docs/azure/${n}.md`);
  for (const f of ['infra/main.bicep', 'infra/README.md', 'docs/azure/data/port-assessments.json', 'docs/azure/data/deployment-gates.json']) if (!has(root, f)) fail(`missing ${f}`);
  for (const [n, topics] of Object.entries(DOC_TOPICS)) {
    if (!has(root, `docs/azure/${n}.md`)) continue;
    const text = read(root, `docs/azure/${n}.md`);
    for (const t of topics) if (!new RegExp(`^#{1,3} .*${t}`, 'mi').test(text)) fail(`docs/azure/${n}.md: needs a heading about '${t}'`);
    if (!/\b(no|not|nothing)\b[^.]{0,80}\b(verified|run|deployed|created|estimated|looked up|checked|exercised)\b/i.test(text)) fail(`docs/azure/${n}.md: must state plainly what was not verified, run or created`);
  }
  // no claim of compliance or a figure with a unit in the Azure documents (HC-10, HC-12): the architecture validator's lint, reused by name
  const secrets = (() => { try { return j(root, 'harness/policy/secret-patterns.json').repository; } catch { return []; } })();

  // infrastructure
  const iac = walk(path.join(root, 'infra')).filter((f) => f.endsWith('.bicep')).map((f) => path.relative(root, f).split(path.sep).join('/'));
  if (!iac.length) fail('infra/ has no Bicep file');
  for (const f of iac) for (const m of iacProblems(read(root, f), f, secrets)) fail(m);
  const modulesNamed = iac.filter((f) => f.startsWith('infra/modules/')).map((f) => path.basename(f));
  if (has(root, 'infra/main.bicep')) {
    const main = read(root, 'infra/main.bicep');
    for (const m of modulesNamed) if (!main.includes(`modules/${m}`)) fail(`infra/main.bicep does not use infra/modules/${m}`);
    if (!/SCAFFOLD, NOT DEPLOYABLE/.test(main)) fail('infra/main.bicep must be marked SCAFFOLD, NOT DEPLOYABLE until a design is approved and the phase is raised');
    const mainParams = [...main.matchAll(/^param\s+(\w+)\s+\w+/gm)].map((m) => m[1]).sort();
    for (const env of ENVS) {
      const f = `infra/params/${env}.parameters.json`;
      if (!has(root, f)) { fail(`missing ${f}: dev, test and prod are separate environments`); continue; }
      const pj = j(root, f).parameters ?? {};
      if (JSON.stringify(Object.keys(pj).sort()) !== JSON.stringify(mainParams)) fail(`${f}: parameters must be exactly main.bicep's parameters (${mainParams.filter((k) => !(k in pj)).join(', ') || 'none missing'}; extra: ${Object.keys(pj).filter((k) => !mainParams.includes(k)).join(', ') || 'none'})`);
      for (const [k, v] of Object.entries(pj)) {
        if (k === 'environment') { if (v.value !== env) fail(`${f}: environment must be ${env}`); continue; }
        if (v.value !== PLACEHOLDER) fail(`${f}: ${k} must be ${PLACEHOLDER}: a committed file never carries a deployable value, a subscription, a region or a secret`);
      }
    }
  }
  if (has(root, 'azure.yaml') || has(root, '.azure')) fail('azd configuration exists (azure.yaml or .azure): deployment configuration is not permitted in Phase 0');
  const wfDir = path.join(root, '.github/workflows');
  for (const f of walk(wfDir)) {
    const t = readFileSync(f, 'utf8');
    if (/azure\/login|az\s+(login|deployment|group|bicep\s+deploy)|azd\s+(up|deploy|provision)|secrets\.AZURE|id-token:\s*write|what-if/i.test(t)) fail(`${path.relative(root, f).split(path.sep).join('/')}: a workflow signs in to Azure or deploys; no workflow may in Phase 0 (HC-11)`);
  }
  for (const f of walk(path.join(root, 'infra/discovery'))) {
    if (!f.endsWith('.kql')) { fail(`infra/discovery/${path.basename(f)}: only .kql files belong here`); continue; }
    const t = readFileSync(f, 'utf8');
    if (!/READ ONLY/.test(t)) fail(`${path.basename(f)}: a discovery query must say READ ONLY`);
    if (/^\s*\./m.test(t) || /\b(set-or-append|set-or-replace|\.ingest|\.drop|\.alter|\.create)\b/i.test(t)) fail(`${path.basename(f)}: a control command is not read only`);
  }

  // port register and deployment gate definition
  if (has(root, 'docs/azure/data/port-assessments.json')) for (const m of portProblems(j(root, 'docs/azure/data/port-assessments.json'))) fail(m);
  if (has(root, 'docs/azure/data/deployment-gates.json')) {
    const g = j(root, 'docs/azure/data/deployment-gates.json');
    const ids = (g.gates ?? []).map((x) => x.id);
    if (JSON.stringify(ids) !== JSON.stringify(Array.from({ length: 12 }, (_, i) => `DG-${String(i + 1).padStart(2, '0')}`))) fail('deployment-gates.json must define DG-01 to DG-12 in order');
    for (const x of g.gates ?? []) { if (!x.title || !x.evidence || !x.approver) fail(`deployment-gates.json: ${x.id} needs a title, the evidence it needs and an approver role`); if ('status' in x) fail(`deployment-gates.json: ${x.id} carries a status; status is computed, never declared`); }
  }
  const phase = (() => { try { return j(root, 'harness/policy/command-policy.json').phase; } catch { return null; } })();
  // the records and the register are control plane: an agent cannot write them, so it cannot clear a gate
  try {
    const cp = j(root, 'harness/policy/permissions.json').pathClasses.find((c) => c.id === 'control-plane');
    for (const f of ['docs/azure/data/port-assessments.json', 'docs/azure/data/whatif-record.json', 'docs/azure/data/cost-estimate.json']) if (!cp || !new RegExp(cp.pattern).test(f)) fail(`permissions.json: ${f} must be a control-plane path so no agent can write it`);
  } catch { fail('permissions.json could not be read to confirm that the Azure records are control plane'); }
  if (phase !== 0 && phase !== null && !has(root, 'docs/azure/data/phase-raised.json')) fail('the phase is raised but no record of the human decision exists');
}

// ---------------------------------------------------------------- readiness: every recorded blocker, computed from files
// A record file clears its gate only when it is a well-formed record by a named human, bound to a commit, with evidence. An empty file,
// or one written by an agent, clears nothing. (A person who can write the file can still forge it: review and the control-plane path rule
// are the control.)
const RECORDS = {
  'capability-verification': { gate: 'DG-03', extra: (d, bad) => { if (!Array.isArray(d.checks) || !d.checks.length) bad('checks must list the live checks (service, SKU, region, result)'); } },
  'whatif-record': { gate: 'DG-06', extra: (d, bad) => { if (!ENVS.includes(d.environment)) bad('environment must be dev, test or prod'); if (!Number.isInteger(d.deleteCount) || d.deleteCount !== 0) bad('deleteCount must be 0: a what-if with a delete blocks the run'); } },
  'cost-estimate': { gate: 'DG-07', extra: (d, bad) => { if (!Array.isArray(d.inputs) || !d.inputs.length || d.inputs.some((i) => !i.source)) bad('every input needs a source'); if (!Array.isArray(d.priceSources) || !d.priceSources.length) bad('priceSources must cite the official price source and its date'); if (!d.budget) bad('a budget must be recorded'); } },
  'runbook-exercise': { gate: 'DG-09', extra: (d, bad) => { if (!Array.isArray(d.runbooks) || !d.runbooks.length) bad('runbooks must list what was exercised'); if (d.environment === 'prod') bad('an exercise is in non-production'); } },
  'smoke-test-record': { gate: 'DG-10', extra: (d, bad) => { if (!['dev', 'test'].includes(d.environment)) bad('environment must be dev or test'); if (d.result !== 'PASS') bad('result must be PASS and come from a run'); } },
};
export function recordProblems(kind, doc) {
  const p = []; const bad = (m) => p.push(`${kind}: ${m}`); const spec = RECORDS[kind];
  if (!spec) return [`${kind}: unknown record kind`];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [`${kind}: must be an object`];
  if (doc.schema !== 'greenfuel.azure-record/v1') bad('schema must be greenfuel.azure-record/v1');
  if (doc.kind !== kind) bad(`kind must be ${kind}`);
  if (!/^[0-9a-f]{40}$/.test(doc.gitHead ?? '')) bad('gitHead must be the 40-character commit the record is bound to');
  if (!doc.recordedBy || /agent|model|assistant|copilot/i.test(doc.recordedBy)) bad('recordedBy must name a human');
  if (Number.isNaN(Date.parse(doc.recordedAt ?? ''))) bad('recordedAt must be a date');
  if (!Array.isArray(doc.evidence) || !doc.evidence.length || doc.evidence.some((e) => typeof e !== 'string' || !e)) bad('evidence must list at least one evidence record');
  spec.extra(doc, bad);
  return p;
}
export function azureBlockers(root) {
  const out = []; const b = (id, msg) => out.push({ gate: id, msg });
  const record = (kind, missing) => {
    const f = `docs/azure/data/${kind}.json`;
    if (!has(root, f)) return b(RECORDS[kind].gate, missing);
    let doc; try { doc = j(root, f); } catch { return b(RECORDS[kind].gate, `${f} is not valid JSON, so it clears nothing`); }
    for (const m of recordProblems(kind, doc)) b(RECORDS[kind].gate, `${f} exists but clears nothing: ${m}`);
  };
  const phase = (() => { try { return j(root, 'harness/policy/command-policy.json').phase ?? 0; } catch { return 0; } })();
  if (phase < 1) b('DG-12', 'Phase 0: infrastructure, application and Azure changes are not permitted; raising the phase is a human decision recorded in an ADR');
  const dir = path.join(root, 'docs/architecture/reviews');
  const approved = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md') && /^- \*\*Status:\*\*\s*Approved\b/mi.test(readFileSync(path.join(dir, f), 'utf8'))) : [];
  if (!approved.length) b('DG-01', 'No design review has status Approved, so no Azure design is approved');
  const reg = has(root, 'docs/azure/data/port-assessments.json') ? j(root, 'docs/azure/data/port-assessments.json') : { ports: [] };
  if (!reg.ports.length) b('DG-02', 'No port is named (D-003), so no residency assessment exists and no hosting option can be chosen');
  for (const port of reg.ports) {
    if (port.residencyStatus !== 'Established') b('DG-02', `${port.id}: residency is ${port.residencyStatus}; hosting stays ${reg.defaultHostingUntilEstablished ?? 'C'} (jurisdiction-local evidence store) until established with evidence`);
    for (const k of VALIDATIONS) if (port.validations?.[k]?.status !== 'Verified') b('DG-02', `${port.id}: ${k} is not verified`);
  }
  const register = has(root, 'docs/context/DECISION-REGISTER.md') ? read(root, 'docs/context/DECISION-REGISTER.md') : '';
  const open = (id) => new RegExp(`^\\| ${id} \\|.*\\| Open \\|\\s*$`, 'm').test(register);
  for (const [id, what, gate] of [['D-037', 'the Azure tenant, subscription and landing zone', 'DG-11'], ['D-003', 'the ports and jurisdictions', 'DG-02'], ['D-009', 'the residency interpretation per port', 'DG-02'], ['D-010', 'the hosting model per port', 'DG-02'], ['D-013', 'tamper evidence and key custody', 'DG-04'], ['D-028', 'where AI inference runs', 'DG-02'], ['D-031', 'availability, recovery and latency targets', 'DG-09'], ['D-033', 'the operating model and support access', 'DG-09'], ['D-018', 'the edge platform', 'DG-02']]) if (open(id)) b(gate, `${id} is open: ${what}`);
  let approvers = 0; try { approvers = j(root, 'harness/policy/approvers.json').approvers.length; } catch { /* leave 0 */ }
  if (!approvers) b('DG-04', 'No approver is registered (T13), so no signed approval can exist for a billable or Azure change');
  record('capability-verification', 'No live verification of region and service availability exists: it needs read-only Azure access that has not been approved (T11, D-037)');
  const identities = (() => { try { return j(root, 'harness/policy/azure-identities.json'); } catch { return null; } })();
  if (!identities || identities.status !== 'applied') b('DG-04', 'The scoped deployment identities, custom role, locks and policy have not been created (T17); nothing exists in Azure');
  for (const env of ENVS) {
    const f = `infra/params/${env}.parameters.json`;
    if (has(root, f) && Object.values(j(root, f).parameters).some((x) => x.value === PLACEHOLDER)) b('DG-05', `${f} still has unresolved ${PLACEHOLDER} values`);
  }
  record('whatif-record', 'No what-if result is recorded for any environment, so no infrastructure change has been reviewed');
  record('cost-estimate', 'No sourced cost estimate and no agreed budget exist; any figure now would be invented (HC-12)');
  const approvalsDir = path.join(root, 'docs/approvals');
  const signed = existsSync(approvalsDir) ? readdirSync(approvalsDir).filter((f) => /\.json$/.test(f)) : [];
  if (!signed.length) b('DG-08', 'No signed approval record exists for creating resources or for any billable change');
  record('runbook-exercise', 'No runbook, rollback or recovery procedure has been exercised in a non-production environment');
  record('smoke-test-record', 'No post-deployment smoke or integration test has run: nothing is deployed');
  return out;
}

export function azureReadiness(root) {
  const blockers = azureBlockers(root); const gates = (has(root, 'docs/azure/data/deployment-gates.json') ? j(root, 'docs/azure/data/deployment-gates.json').gates : []);
  const rows = gates.map((g) => { const mine = blockers.filter((x) => x.gate === g.id); return { id: g.id, title: g.title, status: mine.length ? 'NOT-READY' : 'NO-BLOCKERS-FOUND', blockers: mine.map((x) => x.msg) }; });
  return { status: blockers.length ? 'NOT-READY' : 'NO-BLOCKERS-FOUND', blockers, rows };
}

function bicepBuild(root) {
  const problems = []; const v = spawnSync('bicep', ['--version'], { encoding: 'utf8' });
  if (v.error || v.status !== 0) return { available: false, problems: ['the Bicep CLI is not available; nothing was compiled'] };
  for (const f of walk(path.join(root, 'infra')).filter((x) => x.endsWith('.bicep'))) {
    const r = spawnSync('bicep', ['build', f, '--stdout'], { encoding: 'utf8', maxBuffer: 33554432 });
    const diag = `${r.stderr ?? ''}`.split('\n').filter((l) => /\b(Warning|Error)\b/.test(l));
    if (r.status !== 0) problems.push(`${path.relative(root, f)}: bicep build failed: ${diag.slice(0, 2).join(' ')}`);
    else if (diag.length) problems.push(`${path.relative(root, f)}: ${diag.length} diagnostic(s): ${diag[0].slice(0, 160)}`);
  }
  return { available: true, version: v.stdout.trim(), problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const ri = args.indexOf('--root');
  const root = ri >= 0 ? path.resolve(args[ri + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const errors = validateAzure(root);
  let bicep = null; if (args.includes('--bicep')) { bicep = bicepBuild(root); for (const p of bicep.problems) errors.push({ check: 'bicep', msg: p }); }
  const readiness = args.includes('--readiness') ? azureReadiness(root) : null;
  if (args.includes('--json')) console.log(JSON.stringify({ ok: !errors.length, errors, bicep, readiness }, null, 2));
  else {
    if (errors.length) for (const e of errors) console.error(`validate-azure: ${e.msg}`); else console.log(`validate-azure: OK${bicep?.available ? ` (bicep ${bicep.version}: every file compiled with no diagnostics)` : ''}`);
    if (readiness) { console.log(`deployment readiness: ${readiness.status}`); for (const r of readiness.rows) console.log(`  ${r.id} ${r.status} ${r.title}${r.blockers.length ? `\n      - ${r.blockers.join('\n      - ')}` : ''}`); console.log('  note: NO-BLOCKERS-FOUND is not an approval. Deployment is a human-run action (HC-11).'); }
  }
  process.exit(errors.length ? 1 : readiness?.status === 'NOT-READY' ? 2 : 0);
}
