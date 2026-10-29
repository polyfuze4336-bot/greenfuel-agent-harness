// Permission engine: the decision point of the least-privilege model (harness/policy/permissions.json).
// It turns a tool call into operations (classify), then decides allow or deny from four dimensions:
//   1. agent identity and responsibility   (agentCeilings)
//   2. tool and operation                  (operations, classifiers, neverGrantable, tiers)
//   3. target environment and data class   (pathClasses, session scope, egress rule)
//   4. signed approvals for P2 to P4       (Ed25519 signatures checked against harness/policy/approvers.json)
// plus a hash-chained record of every denial. Zero dependencies (node:crypto only).
// Called by agent-guard.cjs (named agent), policy-guard.cjs (any session) and tool-output-guard.cjs (output filter).
// This is a guardrail, not a sandbox. Operating-system isolation and GitHub/Azure controls are separate layers;
// docs/security/ENFORCEMENT-STATUS.md says which are in place.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { matchMcp } = require('./mcp-names.cjs');
const approverRegistry = require('../approvals/registry.cjs');

const ROOT = path.join(__dirname, '..', '..');
const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const canonical = (v) => JSON.stringify(sortKeys(v));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const readJson = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

const PATH_KEYS = new Set(['path', 'filepath', 'file_path', 'file', 'filename', 'uri', 'paths', 'dir', 'directory', 'folder', 'cwd']);
const SHELL = /(powershell|pwsh|bash|terminal|shell|execute|^cmd$|^run(in)?command)/;
const RUNNING_SHELL = /^(read|list|stop|write)(powershell|bash|shell)$/;
const WRITE_TOOL = /(edit|create|write|patch|replace|insert|delete|remove|rename|move|save|append|mkdir|touch|overwrite)/;
const READ_TOOL = /^(view|read|readfile|listdir|ls|cat)$/;
const SEARCH_TOOL = /^(grep|glob|search|filesearch|grepsearch|semanticsearch|usages)$/;
const META_TOOL = /^(reportintent|readagent|listagents|skill|askuser|sql|toolsearchtool|taskcomplete|exitplanmode|lsp|problems|managetodolist)$/;
const DELEGATE_TOOL = /^(task|agent|runsubagent|customagent|subagent|writeagent)$/;
const WEB_TOOL = /(web|fetch|url|browser|http)/;

function loadModel(root = ROOT) {
  const perm = readJson(root, 'harness/policy/permissions.json');
  let approvers = [];
  try { approvers = readJson(root, 'harness/policy/approvers.json').approvers ?? []; } catch { approvers = []; }
  // Only well-formed entries with a verified proof of possession are trusted. A half-formed or self-asserted entry approves nothing.
  approvers = approverRegistry.trustedApprovers(approvers);
  return {
    root, perm, approvers,
    classifiers: perm.classifiers.map((c) => ({ ...c, re: new RegExp(c.pattern, 'i') })),
    pathClasses: perm.pathClasses.map((c) => ({ ...c, re: new RegExp(c.pattern, 'i') })),
    egress: new RegExp(perm.egressVerbs, 'i'),
    execExt: new Set(perm.executableExtensions),
  };
}

// ---------- paths and data classes ----------
function toRel(raw, root, cwd) {
  let s = String(raw ?? '');
  if (/^file:/i.test(s)) { try { s = decodeURIComponent(s.replace(/^file:\/\/\/?/i, '')); } catch { return null; } }
  s = s.replace(/\\/g, '/');
  if (!s) return null;
  const abs = /^([A-Za-z]:)?\//.test(s) ? s : path.posix.join((cwd ? String(cwd).replace(/\\/g, '/') : root.replace(/\\/g, '/')), s);
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const normAbs = path.posix.normalize(abs);
  if (normAbs.toLowerCase() === base.toLowerCase()) return '';
  if (normAbs.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return normAbs.slice(base.length + 1);
  return normAbs;
}

function classifyPath(rel, model) {
  const info = { rel, classes: [], owner: null, jx: null };
  for (const c of model.pathClasses) {
    const m = c.re.exec(rel);
    if (!m) continue;
    info.classes.push(c.id);
    if (c.id === 'shipowner') info.owner = m.groups?.owner ?? null;
    if (c.id === 'jurisdiction') info.jx = m.groups?.jx ?? null;
  }
  return info;
}

// A target that is an ancestor of the isolated roots (the project root, tests, tests/fixtures) reads many owners at once.
function coversIsolated(rel) {
  if (rel === null) return false;
  const r = rel.replace(/\/+$/, '');
  return r === '' || r === '.' || ['tests/fixtures/shipowners', 'tests/fixtures/jurisdictions'].some((root) => root === r || root.startsWith(`${r}/`));
}

function pathTargets(tool, args, model, cwd) {
  const raw = [];
  const walk = (v, key = '') => {
    if (typeof v === 'string') { if (PATH_KEYS.has(key.toLowerCase())) raw.push(v); else if (key === 'pattern' && /[\\/]/.test(v)) raw.push(v); else if (/\*\*\* (Add|Update|Delete) File: /.test(v)) for (const m of v.matchAll(/\*\*\* (?:Add|Update|Delete) File: (.+)/g)) raw.push(m[1].trim()); }
    else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(args);
  return raw.map((r) => ({ raw: r, rel: toRel(r, model.root, cwd) })).filter((t) => t.rel !== null).map((t) => ({ ...t, ...classifyPath(t.rel, model), covers: coversIsolated(t.rel) }));
}

function shellTargets(command, model, cwd) {
  return String(command).split(/[\s"'`,;=()|<>&@]+/).filter((t) => t && /[\\/.]/.test(t)).map((r) => ({ raw: r, rel: toRel(r, model.root, cwd) })).filter((t) => t.rel !== null)
    .map((t) => ({ ...t, ...classifyPath(t.rel, model), covers: coversIsolated(t.rel) }));
}

// ---------- classification ----------
// Spellings a shell treats as the same command: PowerShell backtick escapes (a`z), cmd carets (a^z) and empty quote pairs (a''z).
// Every variant is classified, and an operation found in any of them counts, so a spelling trick cannot hide a command from the screen.
function shellVariants(command) {
  const c = String(command);
  const noTick = c.replace(/`/g, '');
  const noCaret = c.replace(/\^/g, '');
  const noEmpty = c.replace(/(['"])\1/g, '');
  return [...new Set([c, noTick, noCaret, noEmpty, noEmpty.replace(/`/g, '').replace(/\^/g, '')])];
}

function classifyShell(command, model, cwd) {
  const ops = []; const seen = new Set();
  shellVariants(command).forEach((variant, vi) => {
    const segments = variant.split(/&&|\|\||;|\||\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const seg of segments) {
      const hit = model.classifiers.find((c) => (c.kind === 'shell' || c.kind === 'any') && c.re.test(seg));
      const op = hit ? hit.op : 'unknown';
      if (op === 'unknown' && vi > 0) continue; // a variant only adds findings; it never adds "unknown"
      const key = `${op}\u0000${seg}`;
      if (!seen.has(key)) { seen.add(key); ops.push({ op, segment: seg }); }
    }
  });
  if (!ops.length) ops.push({ op: 'unknown', segment: '' });
  const targets = []; const seenT = new Set();
  for (const v of shellVariants(command)) for (const t of shellTargets(v, model, cwd)) if (!seenT.has(t.rel)) { seenT.add(t.rel); targets.push(t); }
  return { ops, targets, egress: model.egress.test(command), command: String(command) };
}

function classify(tool, args, model, cwd, registry) {
  const n = norm(tool);
  let a = args;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch { a = { command: a }; } }
  a = a ?? {};
  const anyHit = model.classifiers.find((c) => c.kind === 'any' && c.re.test(String(tool)));
  if (anyHit) return { ops: [{ op: anyHit.op }], targets: [], tool };
  if (registry) {
    const m = matchMcp(tool, registry);
    if (m.server) {
      const t = m.exact && registry.tools.find((x) => x.kind === 'mcp' && x.server === m.exact.server && x.name === m.exact.tool);
      if (!t) return { ops: [{ op: 'unknown' }], targets: [] };
      return { ops: [{ op: t.privilege === 'read-external' ? 'docs.read' : 'fs.read' }], targets: pathTargets(tool, a, model, cwd) };
    }
  }
  if (RUNNING_SHELL.test(n)) return { ops: [{ op: /^write/.test(n) ? 'unknown' : 'meta' }], targets: [] };
  if (SHELL.test(n)) return classifyShell(a.command ?? a.cmd ?? a.input ?? '', model, cwd);
  if (DELEGATE_TOOL.test(n)) return { ops: [{ op: 'agent.delegate' }], targets: [] };
  if (META_TOOL.test(n)) return { ops: [{ op: 'meta' }], targets: [] };
  if (SEARCH_TOOL.test(n)) { const t = pathTargets(tool, a, model, cwd); return { ops: [{ op: 'fs.search' }], targets: t, implicitRoot: !t.length }; }
  if (READ_TOOL.test(n)) return { ops: [{ op: 'fs.read' }], targets: pathTargets(tool, a, model, cwd) };
  if (WEB_TOOL.test(n)) return { ops: [{ op: 'docs.read' }], targets: [] };
  if (WRITE_TOOL.test(n)) return { ops: [{ op: 'fs.write' }], targets: pathTargets(tool, a, model, cwd) };
  return { ops: [{ op: 'unknown' }], targets: [] };
}

// ---------- approvals ----------
function verifyApproval(rec, ctx) {
  const reasons = [];
  const { model } = ctx;
  const ap = model.perm.approvals;
  const now = ctx.now ?? new Date();
  const fail = (r) => { reasons.push(r); return { ok: false, reasons }; };
  if (!rec || rec.schema !== ap.schema) return fail('wrong or missing schema');
  const tierDef = model.perm.tiers[rec.tier];
  if (!tierDef || tierDef.rank < 2) return fail('approval tier must be P2, P3 or P4');
  const lim = ap.limits[rec.tier];
  if (!Array.isArray(rec.operations) || !rec.operations.length || rec.operations.some((o) => typeof o !== 'string' || o.includes('*') || !model.perm.operations[o])) return fail('operations must name known operations exactly, with no wildcard');
  if (rec.operations.some((o) => model.perm.neverGrantable.includes(o))) return fail('lists an operation that no approval can authorise');
  if (rec.operations.some((o) => model.perm.operations[o].tier > tierDef.rank)) return fail('a lower-tier approval cannot authorise a higher-tier operation');
  if (!Array.isArray(rec.agents) || !rec.agents.length || rec.agents.some((x) => typeof x !== 'string' || x.includes('*'))) return fail('agents must be named exactly, with no wildcard');
  if (!model.perm.environments[rec.environment] || rec.environment === 'azure-prod') return fail('environment is unknown or never grantable');
  const t0 = Date.parse(rec.issuedAt); const t1 = Date.parse(rec.expiresAt);
  if (Number.isNaN(t0) || Number.isNaN(t1)) return fail('issuedAt and expiresAt must be ISO times');
  if (now.getTime() < t0) return fail('not yet valid');
  if (now.getTime() > t1) return fail('expired');
  if ((t1 - t0) / 60000 > lim.maxLifetimeMinutes) return fail(`lifetime exceeds the ${rec.tier} limit`);
  if (!Number.isInteger(rec.maxUses) || rec.maxUses < 1 || rec.maxUses > lim.maxUses) return fail(`maxUses must be 1 to ${lim.maxUses}`);
  if (typeof rec.nonce !== 'string' || rec.nonce.length < 16 || typeof rec.id !== 'string' || !rec.id) return fail('id and a nonce of at least 16 characters are required');
  if (!rec.reason || !String(rec.reason).trim()) return fail('a reason is required');
  if (rec.breakGlass) {
    if (rec.tier !== 'P4') return fail('break-glass approvals are P4');
    if (!rec.reference || !String(rec.reference).trim()) return fail('break-glass needs an incident or change reference');
  }
  const payload = Buffer.from(canonical({ ...rec, signatures: undefined }));
  const good = new Set();
  for (const s of Array.isArray(rec.signatures) ? rec.signatures : []) {
    const key = model.approvers.find((k) => k.keyId === s.keyId);
    if (!key || key.revoked || !Array.isArray(key.tiers) || !key.tiers.includes(rec.tier)) continue;
    // Separation of approval classes: a repository key approves P2 only, a deployment key P3 and P4; an architecture or filing key approves no operation.
    if (!Array.isArray(key.classes) || !key.classes.includes(rec.tier === 'P2' ? 'repository' : 'deployment')) continue;
    try {
      if (crypto.verify(null, payload, crypto.createPublicKey(key.publicKeyPem), Buffer.from(String(s.sig), 'base64'))) good.add(s.keyId);
    } catch { /* an unreadable key or signature counts as invalid */ }
  }
  if (good.size < lim.minApprovers) return fail(`needs ${lim.minApprovers} valid signature(s) from distinct registered approvers with the ${rec.tier} capability; found ${good.size}`);
  return { ok: true, reasons, signers: [...good] };
}

function logDir(model, override) { return override ?? process.env[model.perm.audit.directoryOverride] ?? path.join(model.root, '.harness-logs'); }

function usedCount(model, id, dir) {
  try { return fs.readFileSync(path.join(dir, 'approvals-used.jsonl'), 'utf8').split('\n').filter(Boolean).filter((l) => { try { return JSON.parse(l).id === id; } catch { return false; } }).length; } catch { return 0; }
}
function consume(model, id, agent, op, dir) {
  try { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, 'approvals-used.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), id, agent, op })}\n`); } catch { /* ledger is best effort */ }
}

function loadApprovals(model) {
  const dir = path.join(model.root, model.perm.approvals.recordsDir);
  let out = [];
  try { out = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } }).filter(Boolean); } catch { out = []; }
  return out;
}

function headCommit(model) {
  try { return require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: model.root, encoding: 'utf8', timeout: 3000, windowsHide: true }).trim(); } catch { return null; }
}

// Find an approval that authorises this operation for this agent in this target.
function findApproval(model, ctx, op, command, targets) {
  const def = model.perm.operations[op];
  const dir = logDir(model, ctx.logDir);
  const reasons = [];
  for (const rec of ctx.approvals ?? loadApprovals(model)) {
    if (!rec || !Array.isArray(rec.operations) || !rec.operations.includes(op)) continue;
    const v = verifyApproval(rec, ctx);
    if (!v.ok) { reasons.push(`${rec.id ?? '?'}: ${v.reasons.join('; ')}`); continue; }
    if (!rec.agents.includes(ctx.agent ?? 'session')) { reasons.push(`${rec.id}: issued for ${rec.agents.join(', ')}, not for ${ctx.agent ?? 'session'}`); continue; }
    if (rec.environment !== def.env) { reasons.push(`${rec.id}: environment ${rec.environment} is not ${def.env}`); continue; }
    if (usedCount(model, rec.id, dir) >= rec.maxUses) { reasons.push(`${rec.id}: used up`); continue; }
    const scope = rec.scope ?? {};
    if (def.env === 'azure-nonprod') {
      const rgs = Array.isArray(scope.resourceGroups) ? scope.resourceGroups : [];
      const asked = [...String(command ?? '').matchAll(/(?:--resource-group|-g)\s+([\w.()-]+)/gi)].map((m) => m[1]);
      if (!rgs.length || rgs.some((g) => g.includes('*'))) { reasons.push(`${rec.id}: scope.resourceGroups must list exact resource groups`); continue; }
      if (!asked.length || asked.some((g) => !rgs.includes(g))) { reasons.push(`${rec.id}: the command does not name a resource group inside the approved scope`); continue; }
    }
    if (op === 'azure.nonprod.deploy') {
      const head = ctx.headCommit ?? headCommit(model);
      if (!scope.headCommit || scope.headCommit !== head) { reasons.push(`${rec.id}: not bound to the current commit; the reviewed change must be the one deployed`); continue; }
    }
    if (def.env === 'github-remote' || def.env === 'git-local') {
      const branches = Array.isArray(scope.branches) ? scope.branches : [];
      if (!branches.length) { reasons.push(`${rec.id}: scope.branches is required`); continue; }
    }
    return { rec, reasons };
  }
  return { rec: null, reasons };
}

// ---------- decision ----------
function decide(ctx) {
  const model = ctx.model ?? loadModel();
  const perm = model.perm;
  const mode = ctx.agent ? 'agent' : 'session';
  const cls = classify(ctx.tool, ctx.args, model, ctx.cwd, ctx.registry);
  const rules = [];
  const reasons = [];
  const deny = (rule, reason) => { rules.push(rule); reasons.push(reason); };
  const ceilings = ctx.agent ? perm.agentCeilings[ctx.agent] : null;
  const unscopedEnforced = new Set(perm.unscopedSession.enforced);
  const applies = (op) => mode === 'agent' || unscopedEnforced.has(op);
  const scope = ctx.scope ?? { shipowner: process.env[perm.scopeEnvironment.shipowner] ?? null, jurisdiction: process.env[perm.scopeEnvironment.jurisdiction] ?? null };
  const ops = cls.ops.map((o) => o.op);
  const isWrite = ops.includes('fs.write');
  const targets = cls.targets ?? [];

  if (mode === 'agent' && !ceilings) deny('DEF-02', `unknown agent identity '${ctx.agent}'`);
  const resolved = [];

  // Data classification: secrets, shipowner and jurisdiction isolation, egress.
  const owners = new Set(); const jxs = new Set();
  for (const t of targets) {
    if (t.classes.includes('secret')) deny('DEF-05', `${isWrite ? 'writing' : 'reading'} a secret or credential path is never permitted (${t.rel})`);
    if (t.classes.includes('shipowner')) {
      owners.add(t.owner);
      if (!scope.shipowner || scope.shipowner !== t.owner) deny('DEF-04', `data of shipowner '${t.owner}' is outside this session's shipowner scope (${scope.shipowner ?? 'none set'})`);
    }
    if (t.classes.includes('jurisdiction')) {
      jxs.add(t.jx);
      if (!scope.jurisdiction || scope.jurisdiction !== t.jx) deny('DEF-03', `data of jurisdiction '${t.jx}' is outside this session's jurisdiction scope (${scope.jurisdiction ?? 'none set'})`);
    }
    if (t.classes.includes('control-plane') && isWrite && mode === 'agent') deny('CTL-01', `control-plane path ${t.rel} may be changed only by a human`);
    if (t.classes.includes('audit') && isWrite && mode === 'agent') deny('CTL-01', 'audit logs may not be written by an agent');
  }
  if (owners.size > 1) deny('DEF-04', 'one operation touches more than one shipowner');
  if (jxs.size > 1) deny('DEF-03', 'one operation touches more than one jurisdiction');
  if (cls.egress && targets.some((t) => t.classes.some((c) => ['shipowner', 'jurisdiction', 'secret'].includes(c)) || t.covers)) deny('DEF-03', 'a command that can send data off the machine refers to isolated, jurisdiction-bound or secret data');
  // A path built at run time cannot be seen in the command text, so a session scoped to isolated data may not send anything off the machine.
  if (cls.egress && (scope.shipowner || scope.jurisdiction)) deny(scope.shipowner ? 'DEF-04' : 'DEF-03', 'this session is scoped to isolated data, so a command that can send data off the machine is refused whatever it names');
  if (mode === 'agent' && isWrite) {
    const agentScopeOk = ctx.codeScopeOk ?? (() => false);
    for (const t of targets) {
      const ext = (t.rel.split('/').pop().split('.').pop() ?? '').toLowerCase();
      if (!model.execExt.has(ext) || agentScopeOk(t.rel)) continue;
      const found = findApproval(model, { ...ctx, model }, 'fs.write.executable', '', targets);
      if (!found.rec) deny('EXEC-01', `writing an executable or script file (${t.rel}) is outside this agent's code scope; it would let a later step run arbitrary code. Only a P4 approval can authorise it${found.reasons.length ? `: ${found.reasons.join(' | ')}` : ''}`);
      else { ctx.usedApprovals = [...(ctx.usedApprovals ?? []), found.rec.id]; if (ctx.consume) consume(model, found.rec.id, ctx.agent, 'fs.write.executable', logDir(model, ctx.logDir)); }
    }
  }

  // Operation tier, ceiling, never-grantable and approvals.
  for (const o of cls.ops) {
    const def = perm.operations[o.op];
    if (o.op === 'unknown') { if (mode === 'agent') deny('DEF-02', `unknown operation: ${(o.segment || String(ctx.tool)).slice(0, 80)}`); continue; }
    if (!def) continue;
    resolved.push({ op: o.op, tier: def.tier, env: def.env });
    if (!applies(o.op)) continue;
    if (perm.neverGrantable.includes(o.op)) {
      if (o.op !== 'secret.read' && o.op !== 'secret.write') deny(defaultFor(o.op), `${o.op} cannot be authorised by any approval`);
      continue;
    }
    if (def.env === 'azure-prod') { deny('DEF-06', 'production Azure scopes are never available to agents'); continue; }
    const ceiling = ceilings ? ceilings[def.env] : undefined;
    if (mode === 'agent' && ceiling !== undefined && def.tier <= ceiling) continue;
    if (mode === 'session' && def.tier < 2) continue;
    if (def.tier < 2) { deny('DEF-01', `${o.op} needs ${def.env} access, which ${ctx.agent} does not hold (read-only unless justified)`); continue; }
    if ((ctx.phase ?? 0) < 1 && def.tier >= 3) { deny(defaultFor(o.op), `${o.op}: phase 0 permits no Azure change, with or without an approval`); continue; }
    const found = findApproval(model, { ...ctx, model }, o.op, cls.command, targets);
    if (!found.rec) { deny(defaultFor(o.op), `${o.op} (${def.tier === 4 ? 'P4' : `P${def.tier}`}) needs a signed approval${found.reasons.length ? `: ${found.reasons.join(' | ')}` : ''}`); continue; }
    if (found.rec.tier !== `P${def.tier}` && def.tier === 4) { deny('DEF-06', 'P4 operations need a separate P4 authorization'); continue; }
    if (ctx.consume) consume(model, found.rec.id, ctx.agent ?? 'session', o.op, logDir(model, ctx.logDir));
    ctx.usedApprovals = [...(ctx.usedApprovals ?? []), found.rec.id];
  }

  const decision = rules.length ? 'deny' : 'allow';
  return { decision, mode, operations: resolved, tier: resolved.reduce((m, r) => Math.max(m, r.tier), 0), environment: resolved.map((r) => r.env)[0] ?? null, rules: [...new Set(rules)], reasons, scope, targets: targets.map((t) => ({ rel: t.rel, classes: t.classes })), approvals: ctx.usedApprovals ?? [] };
}

function defaultFor(op) {
  return ({ 'azure.delete': 'DEF-06', 'azure.rbac.write': 'DEF-06', 'azure.policy.write': 'DEF-06', 'azure.secret.read': 'DEF-05', 'azure.prod.any': 'DEF-06', 'credential.extract': 'DEF-05', 'azure.nonprod.deploy': 'DEF-08', 'azure.nonprod.write': 'DEF-08', 'regulatory.file': 'DEF-09', 'commercial.settle': 'DEF-09', 'git.protected.modify': 'DEF-07', 'git.write': 'DEF-07', 'git.push.branch': 'DEF-07', 'pr.write': 'DEF-07', 'data.cross-shipowner': 'DEF-04', 'data.cross-jurisdiction': 'DEF-03', 'control-plane.write': 'CTL-01', 'fs.write.executable': 'EXEC-01', 'shell.indirection': 'DEF-02' })[op] ?? 'DEF-01';
}

// ---------- output filter: isolated and secret data in search results ----------
function filterIsolated(text, scope, model) {
  const lines = String(text).split('\n');
  const keep = [];
  let removed = 0;
  for (const line of lines) {
    const probe = line.replace(/\\/g, '/');
    // Search results start with the file path. Secret paths are tested on that leading token only, so a prose line that merely ends in ".pem" is kept.
    const lead = probe.match(/^(?:[A-Za-z]:)?[^:\n]*/)[0];
    let drop = false;
    for (const c of model.pathClasses) {
      if (!['secret', 'shipowner', 'jurisdiction'].includes(c.id)) continue;
      const m = c.re.exec(c.id === 'secret' ? lead : probe);
      if (!m) continue;
      if (c.id === 'secret') drop = true;
      if (c.id === 'shipowner' && (!scope.shipowner || m.groups?.owner !== scope.shipowner)) drop = true;
      if (c.id === 'jurisdiction' && (!scope.jurisdiction || m.groups?.jx !== scope.jurisdiction)) drop = true;
    }
    if (drop) removed += 1; else keep.push(line);
  }
  return { text: keep.join('\n'), removed };
}

// ---------- denial audit record (hash chained) ----------
function writeAudit(model, event, decision, extra = {}) {
  const dir = logDir(model, extra.logDir);
  const file = path.join(dir, path.basename(model.perm.audit.file));
  const redact = (s) => { let o = String(s); try { for (const p of readJson(model.root, 'harness/policy/secret-patterns.json').redaction) o = o.replace(new RegExp(p, 'gi'), '[REDACTED]'); } catch { /* keep going */ } return o; };
  const args = typeof event.toolArgs === 'string' ? event.toolArgs : JSON.stringify(event.toolArgs ?? event.tool_input ?? {});
  const secretTarget = decision.targets?.some((t) => t.classes.includes('secret'));
  const lock = `${file}.lock`;
  let locked = false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 40 && !locked; i++) { try { fs.mkdirSync(lock); locked = true; } catch { const end = Date.now() + 25; while (Date.now() < end) { /* wait */ } } }
    let prev = null; let seq = 1;
    try {
      const last = fs.readFileSync(file, 'utf8').trimEnd().split('\n').pop();
      if (last) { const l = JSON.parse(last); prev = l.hash; seq = (l.seq ?? 0) + 1; }
    } catch { /* first record */ }
    const rec = {
      schema: model.perm.audit.schema, seq, ts: (extra.now ?? new Date()).toISOString(), session: event.sessionId ?? null, agent: extra.agent ?? null, mode: decision.mode,
      tool: String(event.toolName ?? event.tool_name ?? ''), operations: decision.operations?.map((o) => o.op) ?? [], tier: decision.tier ?? null, environment: decision.environment ?? null,
      decision: 'deny', rules: decision.rules ?? [], reason: redact(String(decision.reasons?.[0] ?? extra.reason ?? '')).slice(0, 300),
      paths: (decision.targets ?? []).slice(0, 5).map((t) => redact(t.rel)), scope: decision.scope ?? null, argsSha256: sha256(args), argsPreview: secretTarget ? '[withheld: secret path]' : redact(args).slice(0, 160),
      approvals: decision.approvals ?? [], unchained: locked ? undefined : true, prevHash: locked ? prev : null,
    };
    rec.hash = sha256(canonical({ ...rec, hash: undefined }));
    fs.appendFileSync(file, `${JSON.stringify(rec)}\n`);
    return rec;
  } catch { return null; } finally { if (locked) { try { fs.rmdirSync(lock); } catch { /* ignore */ } } }
}

// ---------- decision and outcome events (hash chained, metadata only) ----------
// Denials alone cannot answer "what did the agents do". This chain records every hook decision (allow, ask, deny), every approval
// outcome and every tool result summary. It holds names, classes and hashes: never arguments, contents, tool output or secrets.
const EVENT_KINDS = new Set(['decision', 'outcome', 'approval', 'approval-admin', 'attestation']);
function writeEvent(model, kind, fields = {}, extra = {}) {
  if (!EVENT_KINDS.has(kind)) return null;
  const dir = logDir(model, extra.logDir);
  const file = path.join(dir, path.basename(model.perm.audit.eventsFile ?? 'audit-events.jsonl'));
  const lock = `${file}.lock`;
  let locked = false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 40 && !locked; i++) { try { fs.mkdirSync(lock); locked = true; } catch { const end = Date.now() + 25; while (Date.now() < end) { /* wait */ } } }
    let prev = null; let seq = 1;
    try {
      const last = fs.readFileSync(file, 'utf8').trimEnd().split('\n').pop();
      if (last) { const l = JSON.parse(last); prev = l.hash; seq = (l.seq ?? 0) + 1; }
    } catch { /* first record */ }
    const safe = {};
    for (const [k, v] of Object.entries(fields)) {
      if (['argsPreview', 'args', 'toolArgs', 'output', 'content', 'text'].includes(k)) continue;
      safe[k] = typeof v === 'string' ? v.slice(0, 300) : v;
    }
    const rec = { schema: 'greenfuel.audit-event/v1', seq, ts: (extra.now ?? new Date()).toISOString(), kind, ...safe, unchained: locked ? undefined : true, prevHash: locked ? prev : null };
    rec.hash = sha256(canonical({ ...rec, hash: undefined }));
    fs.appendFileSync(file, `${JSON.stringify(rec)}\n`);
    return rec;
  } catch { return null; } finally { if (locked) { try { fs.rmdirSync(lock); } catch { /* ignore */ } } }
}

// One decision event from a hook: what was asked, what was decided and under which rules. The arguments are represented by a hash only.
function decisionEvent(model, event, verdict, extra = {}) {
  const args = typeof event.toolArgs === 'string' ? event.toolArgs : JSON.stringify(event.toolArgs ?? event.tool_input ?? {});
  const cls = extra.decision ?? null;
  return writeEvent(model, 'decision', {
    session: event.sessionId ? String(event.sessionId).slice(0, 64) : null, agent: extra.agent ?? null, hook: extra.hook ?? null, tool: String(event.toolName ?? event.tool_name ?? ''),
    decision: verdict?.decision ?? 'allow', rule: verdict?.id ?? null, operations: cls?.operations?.map((o) => o.op) ?? [], tier: cls?.tier ?? null,
    pathClasses: [...new Set((cls?.targets ?? []).flatMap((t) => t.classes ?? []))], approvals: cls?.approvals ?? [], argsSha256: sha256(args),
  }, extra);
}

function verifyAuditChain(file) {
  const problems = [];
  let prev = null; let n = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    n += 1;
    let r;
    try { r = JSON.parse(line); } catch { problems.push(`line ${n}: not JSON`); continue; }
    if (sha256(canonical({ ...r, hash: undefined })) !== r.hash) problems.push(`line ${n}: content hash mismatch (record altered)`);
    if (!r.unchained && r.prevHash !== prev) problems.push(`line ${n}: chain broken (a record was removed, reordered or inserted)`);
    prev = r.hash;
  }
  return { records: n, problems };
}

// ---------- approval keys and signing (used by approval.mjs and the tests) ----------
function generateApproverKey(passphrase) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = passphrase ? privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase }) : privateKey.export({ type: 'pkcs8', format: 'pem' });
  return { publicKeyPem, privateKeyPem, keyId: sha256(publicKeyPem).slice(0, 16) };
}
function signApproval(rec, privateKeyPem, keyId, passphrase) {
  const key = crypto.createPrivateKey({ key: privateKeyPem, format: 'pem', passphrase });
  const payload = Buffer.from(canonical({ ...rec, signatures: undefined }));
  const sig = crypto.sign(null, payload, key).toString('base64');
  return { ...rec, signatures: [...(rec.signatures ?? []), { keyId, sig }] };
}

module.exports = { loadModel, classify, classifyPath, decide, verifyApproval, filterIsolated, writeAudit, writeEvent, decisionEvent, shellVariants, verifyAuditChain, generateApproverKey, signApproval, canonical, sha256, toRel, loadApprovals, findApproval };
