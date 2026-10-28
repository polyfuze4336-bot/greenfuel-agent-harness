#!/usr/bin/env node
// Validates the least-privilege permission model as code. Zero dependencies.
// Usage: node harness/scripts/validate-permissions.mjs [--root <dir>] [--json] [--write]
//   --write  regenerates the matrix tables in docs/security/PERMISSION-MODEL.md
// It checks that permissions.json is coherent, that it agrees with agent-policy.json and the tool registry, that the
// approver registry holds only public keys, and that the Azure identity and GitHub protection specifications are safe.
// It reads files only (except --write). It cannot show that a hook ran; the negative tests do that.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { grantedAgents } from './validate-tools.mjs';

const START = '<!-- generated:start (node harness/scripts/validate-permissions.mjs --write) -->';
const END = '<!-- generated:end -->';
const DOC = 'docs/security/PERMISSION-MODEL.md';
const TIERS = ['P0', 'P1', 'P2', 'P3', 'P4'];
const REQUIRED_TESTS = ['unauthorized Azure deletion', 'another shipowner', 'simulated secret', 'deployment without approval', 'another agent'];
const j = (root, p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));
const has = (root, p) => existsSync(path.join(root, p));
const cell = (s) => String(s ?? '').replace(/\|/g, ' / ').replace(/\r?\n/g, ' ').trim();
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// The ceiling an agent should hold, derived from what agent-policy.json actually gives it.
export function derivedCeilings(a) {
  const c = { 'local-fs': a.tools.includes('edit') ? 1 : 0 };
  if (a.tools.includes('execute')) c['local-exec'] = 1;
  if (a.commands.some((x) => x.includes('git (status'))) c['git-local'] = 0;
  if (a.commands.some((x) => x.includes('gh (pr|run)'))) c['github-remote'] = 0;
  if (a.web || (a.mcp ?? []).some((m) => m.startsWith('microsoft-learn/'))) c['external-docs'] = 0;
  return c;
}

export function renderPermissionTables(root) {
  const m = j(root, 'harness/policy/permissions.json');
  const envs = Object.keys(m.environments);
  const L = [];
  L.push('### Tiers', '', '| Tier | Meaning | Approval needed |', '|---|---|---|');
  for (const t of TIERS) L.push(`| ${t} | ${cell(m.tiers[t].name)} | ${cell(m.tiers[t].approval)} |`);
  L.push('', '### Agent ceilings (standing permission, by environment)', '', `| Agent | ${envs.join(' | ')} |`, `|---|${envs.map(() => '---').join('|')}|`);
  for (const [a, c] of Object.entries(m.agentCeilings)) L.push(`| ${a} | ${envs.map((e) => (c[e] === undefined ? 'none' : `P${c[e]}`)).join(' | ')} |`);
  L.push('', 'No agent has any standing permission in an Azure environment. An operation above an agent\'s ceiling needs a signed approval for that agent, and a never-grantable operation cannot be approved at all.');
  L.push('', '### Operations', '', '| Operation | Tier | Environment | Approval route | Meaning |', '|---|---|---|---|---|');
  for (const [id, o] of Object.entries(m.operations)) L.push(`| ${id} | P${o.tier} | ${o.env} | ${m.neverGrantable.includes(id) ? 'never grantable to an agent' : o.tier < 2 ? 'ceiling' : o.tier === 4 ? 'separate P4 authorization' : `signed ${`P${o.tier}`} approval`} | ${cell(o.description)} |`);
  L.push('', '### Default policy and its enforcement', '', '| ID | Statement | Enforced by |', '|---|---|---|');
  for (const d of m.defaults) L.push(`| ${d.id} | ${cell(d.statement)} | ${cell(d.enforcement.join('; '))} |`);
  L.push('', '### Approval limits (proposed values)', '', '| Tier | Approvers needed | Longest lifetime (minutes) | Uses |', '|---|---|---|---|');
  for (const t of ['P2', 'P3', 'P4']) { const l = m.approvals.limits[t]; L.push(`| ${t} | ${l.minApprovers} | ${l.maxLifetimeMinutes} | ${l.maxUses} |`); }
  return L.join('\n');
}

export function validatePermissions(root) {
  const errors = [];
  try { check(root, errors); } catch (e) { errors.push({ check: 'permissions', msg: `the policy is malformed and could not be fully evaluated (${e.message})` }); }
  return errors;
}

function check(root, errors) {
  const fail = (msg) => errors.push({ check: 'permissions', msg });
  for (const f of ['harness/policy/permissions.json', 'harness/policy/approvers.json', 'harness/policy/agent-policy.json', 'harness/tools/tool-registry.json', 'harness/policy/azure-identities.json', 'harness/policy/github-protection.json']) if (!has(root, f)) { fail(`missing ${f}`); return errors; }
  let m; let ap; let reg; let az; let gh; let approvers;
  try { m = j(root, 'harness/policy/permissions.json'); ap = j(root, 'harness/policy/agent-policy.json'); reg = j(root, 'harness/tools/tool-registry.json'); az = j(root, 'harness/policy/azure-identities.json'); gh = j(root, 'harness/policy/github-protection.json'); approvers = j(root, 'harness/policy/approvers.json'); } catch (e) { fail(`invalid JSON (${e.message})`); return errors; }

  // tiers
  if (JSON.stringify(Object.keys(m.tiers)) !== JSON.stringify(TIERS)) fail('tiers must be exactly P0, P1, P2, P3, P4 in order');
  TIERS.forEach((t, i) => { if (m.tiers[t]?.rank !== i) fail(`tier ${t} must have rank ${i}`); if (!m.tiers[t]?.name || !m.tiers[t]?.approval) fail(`tier ${t} needs a name and an approval rule`); });
  for (const t of ['P2', 'P3', 'P4']) if (!m.workflows?.[t]) fail(`tier ${t} needs a workflow`);

  // environments and operations
  const envs = Object.keys(m.environments);
  for (const e of ['local-fs', 'local-exec', 'git-local', 'github-remote', 'external-docs', 'azure-nonprod', 'azure-prod']) if (!envs.includes(e)) fail(`missing environment ${e}`);
  for (const [id, o] of Object.entries(m.operations)) {
    if (!Number.isInteger(o.tier) || o.tier < 0 || o.tier > 4) fail(`operation ${id}: tier must be 0 to 4`);
    if (!envs.includes(o.env)) fail(`operation ${id}: unknown environment ${o.env}`);
    if (!o.description) fail(`operation ${id}: description is required`);
    if (o.env === 'azure-prod' && !m.neverGrantable.includes(id)) fail(`operation ${id}: production operations must be never grantable`);
  }
  for (const id of m.neverGrantable) if (!m.operations[id]) fail(`neverGrantable names unknown operation ${id}`);
  for (const id of ['secret.read', 'secret.write', 'azure.secret.read', 'data.cross-shipowner', 'data.cross-jurisdiction', 'regulatory.file', 'commercial.settle', 'git.protected.modify', 'control-plane.write', 'azure.prod.any']) if (!m.neverGrantable.includes(id)) fail(`${id} must stay never grantable`);
  for (const [id, o] of Object.entries(m.operations)) if (o.tier === 4 && !m.neverGrantable.includes(id) && !['azure.delete', 'azure.rbac.write', 'azure.policy.write', 'fs.write.executable'].includes(id)) fail(`P4 operation ${id} is grantable but is not in the reviewed list; decide whether it should be never grantable`);
  for (const e of m.unscopedSession.enforced) if (!m.operations[e]) fail(`unscopedSession.enforced names unknown operation ${e}`);

  // classifiers and path classes
  for (const c of m.classifiers) {
    if (!m.operations[c.op]) fail(`classifier for unknown operation ${c.op}`);
    if (!['shell', 'any'].includes(c.kind)) fail(`classifier ${c.op}: kind must be shell or any`);
    try { new RegExp(c.pattern, 'i'); } catch { fail(`classifier ${c.op}: invalid pattern`); }
  }
  for (const c of m.pathClasses) { try { new RegExp(c.pattern, 'i'); } catch { fail(`path class ${c.id}: invalid pattern`); } }
  for (const [id, g] of [['shipowner', 'owner'], ['jurisdiction', 'jx']]) if (!m.pathClasses.find((c) => c.id === id)?.pattern.includes(`(?<${g}>`)) fail(`path class ${id} must capture (?<${g}>...)`);
  try { new RegExp(m.egressVerbs, 'i'); } catch { fail('egressVerbs is not a valid pattern'); }
  for (const v of Object.values(m.scopeEnvironment)) if (!/^HARNESS_SCOPE_[A-Z]+$/.test(v)) fail(`scope variable ${v} must look like HARNESS_SCOPE_NAME`);

  // agents: identity, derivation and ceilings
  const agents = ap.agents;
  for (const a of Object.keys(agents)) if (!m.agentCeilings[a]) fail(`agent ${a} has no entry in agentCeilings (deny unknown)`);
  for (const a of Object.keys(m.agentCeilings)) if (!agents[a]) fail(`agentCeilings names unknown agent ${a}`);
  for (const [name, c] of Object.entries(m.agentCeilings)) {
    if (!agents[name]) continue;
    for (const [e, t] of Object.entries(c)) {
      if (!envs.includes(e)) fail(`agent ${name}: unknown environment ${e}`);
      if (e.startsWith('azure')) fail(`agent ${name}: no agent may hold a standing ceiling in ${e}`);
      if (!Number.isInteger(t) || t < 0 || t > 1) fail(`agent ${name}: a standing ceiling may be P0 or P1 only (found ${t}); higher tiers need an approval`);
    }
    const want = derivedCeilings(agents[name]);
    if (JSON.stringify(Object.entries(want).sort()) !== JSON.stringify(Object.entries(c).sort())) fail(`agent ${name}: ceilings ${JSON.stringify(c)} differ from what agent-policy.json grants ${JSON.stringify(want)}`);
  }

  // tool registry: every enabled tool must fit inside every granted agent's ceiling
  const need = { 'read-local': ['local-fs', 0], 'read-external': ['external-docs', 0], 'write-local': ['local-fs', 1], execute: ['local-exec', 1] };
  for (const t of reg.tools.filter((x) => x.status === 'enabled')) {
    const n = t.privilege === 'read-external' && t.grant?.type === 'command' && /^gh\b/.test(t.grant.match) ? ['github-remote', 0] : need[t.privilege];
    if (!n) { fail(`enabled tool ${t.id}: privilege ${t.privilege} has no permission mapping and must not be enabled`); continue; }
    for (const a of grantedAgents(t, ap)) {
      const have = m.agentCeilings[a]?.[n[0]];
      if (have === undefined || have < n[1]) fail(`tool ${t.id} is granted to ${a}, whose ${n[0]} ceiling is ${have === undefined ? 'none' : `P${have}`} (needs P${n[1]})`);
    }
  }

  // approvals
  const lim = m.approvals.limits;
  for (const t of ['P2', 'P3', 'P4']) for (const k of ['minApprovers', 'maxLifetimeMinutes', 'maxUses']) if (!Number.isInteger(lim[t]?.[k]) || lim[t][k] < 1) fail(`approval limit ${t}.${k} must be a positive integer`);
  if (lim.P4?.minApprovers < 2) fail('P4 needs at least two distinct approvers');
  if (!(lim.P4?.maxLifetimeMinutes < lim.P3?.maxLifetimeMinutes && lim.P3?.maxLifetimeMinutes < lim.P2?.maxLifetimeMinutes)) fail('approval lifetimes must shorten as the tier rises');
  if (m.approvals.algorithm !== 'Ed25519') fail('approval algorithm must be Ed25519');
  const ids = new Set();
  for (const k of approvers.approvers ?? []) {
    if (!/^[0-9a-f]{16}$/.test(k.keyId ?? '')) fail(`approver key id ${k.keyId} must be 16 hex characters`);
    if (ids.has(k.keyId)) fail(`duplicate approver key ${k.keyId}`);
    ids.add(k.keyId);
    if (!/^-----BEGIN PUBLIC KEY-----/.test(k.publicKeyPem ?? '')) fail(`approver ${k.keyId}: publicKeyPem must be a PUBLIC key`);
    if (!Array.isArray(k.tiers) || !k.tiers.length || k.tiers.some((t) => !['P2', 'P3', 'P4'].includes(t))) fail(`approver ${k.keyId}: tiers must be a subset of P2, P3, P4`);
  }
  const raw = readFileSync(path.join(root, 'harness/policy/approvers.json'), 'utf8');
  if (/PRIVATE KEY/.test(raw)) fail('approvers.json contains private key material; remove it and treat the key as compromised');
  const dir = path.join(root, m.approvals.recordsDir);
  for (const f of existsSync(dir) ? readdirSync(dir).filter((x) => x.endsWith('.json')) : []) {
    const text = readFileSync(path.join(dir, f), 'utf8');
    if (/PRIVATE KEY/.test(text)) fail(`${m.approvals.recordsDir}/${f}: contains private key material`);
    try { const r = JSON.parse(text); if (r.schema !== m.approvals.schema) fail(`${f}: wrong schema`); } catch { fail(`${f}: invalid JSON`); }
  }

  // defaults, workflows, break-glass, audit
  for (let i = 1; i <= 9; i++) { const id = `DEF-0${i}`; const d = m.defaults.find((x) => x.id === id); if (!d) fail(`missing default ${id}`); else if (!d.enforcement?.length) fail(`${id}: needs at least one enforcement mechanism`); }
  for (const t of ['P2', 'P3', 'P4']) { const w = m.workflows?.[t]; if (w && (!Array.isArray(w.steps) || w.steps.length < 3 || !w.enforcedBy?.length || !w.humanSteps?.length)) fail(`workflow ${t}: needs at least 3 steps, enforcedBy and humanSteps`); }
  const bg = m.breakGlass;
  if (!bg?.requires?.length || !bg?.afterwards?.length || !bg?.enforcedBy?.length || !bg?.humanSteps?.length) fail('breakGlass needs requires, afterwards, enforcedBy and humanSteps');
  if (m.audit?.file && !m.audit.file.startsWith('.harness-logs/')) fail('the audit file must be under .harness-logs/ (Git-ignored)');
  if (!m.audit?.chained) fail('the audit log must be hash chained');

  // Azure identity specification
  if (!/NOT CREATED/.test(az.status)) fail('azure-identities.json must state SPECIFIED, NOT CREATED');
  const forbiddenRoles = new Set(az.forbidden?.roles ?? []);
  for (const id of az.identities) {
    for (const r of id.builtInRoles ?? []) if (forbiddenRoles.has(r)) fail(`identity ${id.id}: built-in role ${r} is forbidden`);
    for (const s of id.assignableScopes ?? []) {
      if (!/^\/subscriptions\/<[A-Z_]+>\/resourceGroups\/<[A-Z_]+>$/.test(s)) fail(`identity ${id.id}: scope '${s}' must be a placeholder resource group, never a subscription, management group or root`);
      if (GUID.test(s)) fail(`identity ${id.id}: scope contains a real-looking subscription id; none exists`);
    }
    const cr = id.customRole;
    if (cr) {
      for (const n of ['*/delete', 'Microsoft.Authorization/*/write', 'Microsoft.Authorization/*/delete']) if (!(cr.NotActions ?? []).includes(n)) fail(`custom role ${cr.Name}: NotActions must exclude ${n}`);
      if ((cr.DataActions ?? []).length) fail(`custom role ${cr.Name}: DataActions must be empty`);
      if (!(cr.NotDataActions ?? []).some((x) => /secrets\/getSecret/.test(x))) fail(`custom role ${cr.Name}: NotDataActions must exclude secret reads`);
      if ((cr.Actions ?? []).some((x) => x === '*' || x === '*/write')) fail(`custom role ${cr.Name}: Actions must not be a wildcard`);
      for (const s of cr.AssignableScopes ?? []) if (!/^\/subscriptions\/<[A-Z_]+>\/resourceGroups\/<[A-Z_]+>$/.test(s)) fail(`custom role ${cr.Name}: AssignableScopes must be a placeholder resource group`);
    }
    if (id.tier === 'P4' && (id.standing || (id.assignableScopes ?? []).length)) fail('P4 must have no standing identity and no scope');
    if (id.tier === 'P3' && id.standing) fail('the P3 identity must not be standing');
    if (/secret|password|key/i.test(id.credential ?? '') && !/no stored secret|none for agents/i.test(id.credential)) fail(`identity ${id.id}: credential text must say no stored secret`);
  }
  if (!(az.guardrails ?? []).some((g) => /CanNotDelete/.test(g.mechanism))) fail('azure-identities.json must specify a CanNotDelete lock');

  // GitHub protection specification
  const main = gh.branches?.main ?? {};
  for (const [k, want] of Object.entries({ requirePullRequest: true, enforceAdmins: true, allowForcePushes: false, allowDeletions: false, requireCodeOwnerReview: true, restrictPushes: true })) if (main[k] !== want) fail(`github-protection: main.${k} must be ${want}`);
  if (!(main.requiredApprovingReviews >= 1)) fail('github-protection: at least one approving review is required');
  if (!(main.requiredStatusChecks ?? []).includes('validate')) fail('github-protection: the validate check must be required');
  if (!/403|unavailable|Upgrade/i.test(gh.status)) fail('github-protection: the status must record whether protection can be applied on the current plan');
  if (!has(root, '.github/CODEOWNERS')) fail('missing .github/CODEOWNERS');
  else { const co = readFileSync(path.join(root, '.github/CODEOWNERS'), 'utf8'); for (const p of ['.github/', 'harness/', 'docs/approvals/']) if (!co.includes(`/${p}`)) fail(`CODEOWNERS must cover /${p}`); }

  // negative tests and documents
  const tests = 'tests/permission-negative.test.mjs';
  if (!has(root, tests)) fail(`missing ${tests}`);
  else { const t = readFileSync(path.join(root, tests), 'utf8'); for (const r of REQUIRED_TESTS) if (!t.includes(r)) fail(`${tests} must contain a test named for: ${r}`); }
  for (const d of ['PERMISSION-MODEL', 'APPROVAL-WORKFLOWS', 'BREAK-GLASS', 'SECRETS-HANDLING', 'ENFORCEMENT-STATUS', 'DENIED-ACTION-AUDIT', 'NEGATIVE-TESTS']) if (!has(root, `docs/security/${d}.md`)) fail(`missing docs/security/${d}.md`);
  if (has(root, 'docs/security/ENFORCEMENT-STATUS.md')) { const t = readFileSync(path.join(root, 'docs/security/ENFORCEMENT-STATUS.md'), 'utf8'); for (const d of m.defaults) if (!t.includes(d.id)) fail(`ENFORCEMENT-STATUS.md must cover ${d.id}`); }
  if (has(root, DOC)) {
    const text = readFileSync(path.join(root, DOC), 'utf8').replace(/\r\n/g, '\n');
    const a = text.indexOf(START); const b = text.indexOf(END);
    if (a < 0 || b < a) fail(`${DOC}: generated table markers are missing`);
    else if (text.slice(a + START.length, b).trim() !== renderPermissionTables(root).trim()) fail(`${DOC}: the generated tables are out of date; run node harness/scripts/validate-permissions.mjs --write`);
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root');
  const root = path.resolve(i > 0 ? process.argv[i + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  if (process.argv.includes('--write')) {
    const file = path.join(root, DOC);
    const text = readFileSync(file, 'utf8');
    const crlf = text.includes('\r\n');
    const t = text.replace(/\r\n/g, '\n');
    const a = t.indexOf(START); const b = t.indexOf(END);
    if (a < 0 || b < a) { console.error(`validate-permissions: markers missing in ${DOC}`); process.exit(2); }
    const out = `${t.slice(0, a + START.length)}\n\n${renderPermissionTables(root)}\n\n${t.slice(b)}`;
    writeFileSync(file, crlf ? out.replace(/\n/g, '\r\n') : out);
    console.log(`validate-permissions: regenerated tables in ${DOC}`);
    process.exit(0);
  }
  const errors = validatePermissions(root);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ root, ok: !errors.length, errors }, null, 2));
  else if (errors.length) { for (const e of errors) console.error(`FAIL [${e.check}] ${e.msg}`); console.error(`${errors.length} problem(s).`); }
  else console.log('validate-permissions: OK');
  process.exit(errors.length ? 1 : 0);
}
