'use strict';
// Task-execution engine for the greenfuel-agent-harness. Zero dependencies, CommonJS so that hooks, scripts and tests share it.
//
// What it is: a deterministic state machine plus a durable, hash-chained run store. It validates plans, enforces the task
// contract and permissions, records every transition, classifies errors, bounds retries, pauses for human approval, and
// resumes after a crash. What it is not: a scheduler or a service. Delegation itself is done by Copilot's native `task`
// tool; this module only decides whether a delegation may start, and records and judges what came back.
//
// Honest limits are in docs/orchestration/ORCHESTRATION.md. In short: the engine proves that recorded artifacts exist, match
// their hashes and pass the declared checks; it cannot prove that a model's content is true, and a caller's `actor` name
// is self-declared unless the call comes from a hook.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const perm = require('../hooks/permission-engine.cjs');
const { globToRe } = require('../hooks/agent-guard.cjs');
const policyGuard = require('../hooks/policy-guard.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const { canonical, sha256 } = perm;
const readJson = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const iso = (ctx) => ctx.now().toISOString();

class EngineError extends Error {
  constructor(code, message, detail) { super(message); this.code = code; this.detail = detail; }
}
// A refusal is an expected, logged "no" (an out-of-order start, a spent retry budget). It changes no task state.
class Refusal extends EngineError {}

// ---------------------------------------------------------------- context
function makeContext(opts = {}) {
  const root = opts.root ?? ROOT;
  const policy = opts.policy ?? readJson(root, 'harness/policy/orchestration-policy.json');
  return {
    root, policy,
    agents: opts.agentPolicy ?? readJson(root, 'harness/policy/agent-policy.json'),
    model: opts.model ?? perm.loadModel(root),
    now: opts.now ?? (() => new Date()),
    runsDir: path.resolve(opts.runsDir ?? process.env.HARNESS_RUNS_DIR ?? path.join(root, policy.runsDir)),
    phase: opts.phase ?? readJson(root, 'harness/policy/command-policy.json').phase ?? 0,
    headCommit: opts.headCommit,
  };
}

const knownCache = new Map();
function knownIds(ctx) {
  if (knownCache.has(ctx.root)) return knownCache.get(ctx.root);
  const out = { requirements: new Set(), constraints: new Set(), prefixes: new Set() };
  const scan = (rel, re, set) => {
    const f = path.join(ctx.root, rel);
    if (!fs.existsSync(f)) return;
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = re.exec(line); if (m) set.add(m[1]); }
  };
  scan('docs/context/REQUIREMENTS.md', /^\|\s*([A-Z]{2,5}-\d{3})\s*\|/, out.requirements);
  scan('docs/context/NON-FUNCTIONAL-REQUIREMENTS.md', /^\|\s*([A-Z]{2,5}-\d{3})\s*\|/, out.requirements);
  scan('docs/architecture/HARD-CONSTRAINTS.md', /^\|\s*(HC-\d+)\s*\|/, out.constraints);
  for (const id of out.requirements) out.prefixes.add(id.split('-')[0]);
  knownCache.set(ctx.root, out);
  return out;
}

// ---------------------------------------------------------------- plan validation
const PLAN_KEYS = new Set(['schema', 'title', 'request', 'objective', 'requirements', 'constraints', 'risks', 'tasks']);
const TASK_KEYS = new Set(['id', 'title', 'objective', 'requirements', 'agent', 'executor', 'inputContext', 'expectedArtifacts', 'permissions', 'dependsOn', 'acceptance', 'maxAttempts', 'status', 'evidence', 'recovery', 'review', 'approval']);
const FORBIDDEN_FOR_ARTIFACTS = ['secret', 'control-plane', 'audit', 'shipowner', 'jurisdiction', 'isolated-root'];
const FORBIDDEN_FOR_CONTEXT = ['secret', 'audit', 'shipowner', 'jurisdiction', 'isolated-root'];
const OP_TOOL = { 'fs.read': 'read', 'fs.search': 'search', 'fs.write': 'edit', 'exec.test': 'execute', 'git.read': 'execute', 'agent.delegate': 'agent' };

function cleanRel(p) {
  if (typeof p !== 'string' || !p || p.includes('\\') || path.isAbsolute(p) || /^[A-Za-z]:/.test(p) || p.split('/').includes('..')) return null;
  const n = path.posix.normalize(p);
  return n === '.' || n.startsWith('../') ? null : n;
}

// The permission questions for one task. Shared by plan validation and by every start, because permissions can change between the two.
function checkTaskPermissions(ctx, task) {
  const issues = [];
  const bad = (code, msg) => issues.push({ code, msg });
  const agent = ctx.agents.agents[task.agent];
  if (!agent) { bad('UNKNOWN_AGENT', `agent '${task.agent}' is not in agent-policy.json`); return { issues, needsApproval: false, maxTier: 0 }; }
  const p = task.permissions ?? {};
  const orchestrator = ctx.agents.agents.orchestrator;
  if (task.executor === 'orchestrator') {
    if (task.agent !== 'orchestrator') bad('EXECUTOR', 'executor "orchestrator" requires agent "orchestrator"');
  } else if (task.agent === 'orchestrator') bad('SELF_DELEGATION', 'the orchestrator cannot delegate to itself');
  else if (!(orchestrator.delegatesTo ?? []).includes(task.agent)) bad('NOT_DELEGABLE', `the orchestrator may not delegate to ${task.agent}`);
  const tools = Array.isArray(p.tools) ? p.tools : [];
  for (const t of tools) if (!agent.tools.includes(t)) bad('TOOL_NOT_GRANTED', `${task.agent} has no '${t}' tool`);
  const ops = Array.isArray(p.operations) ? p.operations : [];
  if (!ops.length) bad('OPERATIONS', 'permissions.operations must list at least one operation');
  let maxTier = 0; let needsApproval = false;
  for (const op of ops) {
    const def = ctx.model.perm.operations[op];
    if (!def) { bad('OP_UNKNOWN', `unknown operation '${op}'`); continue; }
    maxTier = Math.max(maxTier, def.tier);
    if (ctx.model.perm.neverGrantable.includes(op)) { bad('OP_NEVER_GRANTABLE', `${op} can never be given to an agent`); continue; }
    if (def.env === 'azure-prod') { bad('ENV_PROD', 'production scopes are never available to agents'); continue; }
    if (def.tier >= 3 && ctx.phase < 1) { bad('PHASE_GATE', `${op} is P${def.tier}; phase ${ctx.phase} permits no Azure or remote change`); continue; }
    const needTool = OP_TOOL[op];
    if (needTool && !agent.tools.includes(needTool)) bad('TOOL_NOT_GRANTED', `${op} needs the '${needTool}' tool, which ${task.agent} lacks`);
    if (def.tier >= 2) needsApproval = true;
    else {
      const ceiling = ctx.model.perm.agentCeilings[task.agent]?.[def.env];
      if (ceiling === undefined || ceiling < def.tier) bad('ABOVE_CEILING', `${op} needs P${def.tier} in ${def.env}, above ${task.agent}'s standing ceiling`);
    }
  }
  if (!/^P[0-4]$/.test(p.tier ?? '')) bad('TIER', 'permissions.tier must be P0 to P4');
  else if (Number(p.tier[1]) !== maxTier) bad('TIER_MISMATCH', `permissions.tier ${p.tier} must equal the highest operation tier P${maxTier}`);
  return { issues, needsApproval, maxTier };
}

function normalizePlan(plan) {
  const clone = JSON.parse(JSON.stringify(plan));
  clone.constraints ??= [];
  clone.tasks = (clone.tasks ?? []).map((t) => {
    const n = { ...t };
    n.executor ??= 'delegate'; n.dependsOn ??= []; n.inputContext ??= []; n.maxAttempts ??= 2;
    delete n.status; delete n.evidence;
    return n;
  });
  return clone;
}

function validatePlan(rawPlan, ctx) {
  const errors = []; const warnings = [];
  const E = (task, code, msg) => errors.push({ task, code, msg });
  const W = (task, code, msg) => warnings.push({ task, code, msg });
  const lim = ctx.policy.limits;
  let plan = rawPlan;
  if (typeof plan === 'string') {
    if (Buffer.byteLength(plan) > lim.maxPlanBytes) { E('PLAN', 'SIZE', `plan is larger than ${lim.maxPlanBytes} bytes`); return { ok: false, errors, warnings }; }
    try { plan = JSON.parse(plan); } catch (e) { E('PLAN', 'JSON', `plan is not valid JSON (${e.message})`); return { ok: false, errors, warnings }; }
  }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) { E('PLAN', 'SCHEMA', 'plan must be an object'); return { ok: false, errors, warnings }; }
  if (Buffer.byteLength(JSON.stringify(plan)) > lim.maxPlanBytes) E('PLAN', 'SIZE', `plan is larger than ${lim.maxPlanBytes} bytes`);
  for (const k of Object.keys(plan)) if (!PLAN_KEYS.has(k)) E('PLAN', 'SCHEMA', `unknown plan property '${k}'`);
  if (plan.schema !== 'greenfuel.task-plan/v1') E('PLAN', 'SCHEMA', 'schema must be greenfuel.task-plan/v1');
  for (const k of ['title', 'request', 'objective']) if (typeof plan[k] !== 'string' || !plan[k].trim()) E('PLAN', 'SCHEMA', `${k} is required`);
  const known = knownIds(ctx);
  const isReqList = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string');
  if (!isReqList(plan.requirements)) E('PLAN', 'REQ_MISSING', 'requirements must list the affected requirement IDs');
  else for (const r of plan.requirements) if (!known.requirements.has(r)) E('PLAN', 'REQ_UNKNOWN', `requirement ${r} is not in the baseline`);
  for (const c of plan.constraints ?? []) if (!known.constraints.has(c)) E('PLAN', 'CONSTRAINT_UNKNOWN', `constraint ${c} is not in HARD-CONSTRAINTS`);
  if (!Array.isArray(plan.risks) || !plan.risks.length) E('PLAN', 'RISK', 'at least one risk with a mitigation is required');
  else {
    const ids = new Set();
    for (const r of plan.risks) {
      if (!r || typeof r.id !== 'string' || typeof r.text !== 'string' || !r.text.trim() || typeof r.mitigation !== 'string' || !r.mitigation.trim()) E('PLAN', 'RISK', 'each risk needs id, text and mitigation');
      else if (ids.has(r.id)) E('PLAN', 'RISK', `duplicate risk id ${r.id}`);
      else ids.add(r.id);
    }
  }
  if (!Array.isArray(plan.tasks) || !plan.tasks.length) { E('PLAN', 'SCHEMA', 'tasks must be a non-empty array'); return { ok: false, errors, warnings }; }
  if (plan.tasks.length > lim.maxTasks) E('PLAN', 'TOO_MANY', `a plan may have at most ${lim.maxTasks} tasks`);

  const byId = new Map();
  for (const t of plan.tasks) {
    if (!t || typeof t !== 'object') { E('PLAN', 'SCHEMA', 'each task must be an object'); continue; }
    if (typeof t.id !== 'string' || !new RegExp(ctx.policy.taskIdPattern).test(t.id)) { E(String(t.id), 'TASK_ID', `task id must match ${ctx.policy.taskIdPattern}`); continue; }
    if (byId.has(t.id)) { E(t.id, 'DUP_ID', 'duplicate task id'); continue; }
    byId.set(t.id, t);
  }

  const needsApproval = [];
  for (const [id, t] of byId) {
    for (const k of Object.keys(t)) if (!TASK_KEYS.has(k)) E(id, 'SCHEMA', `unknown task property '${k}'`);
    for (const k of ['title', 'objective', 'agent']) if (typeof t[k] !== 'string' || !t[k].trim()) E(id, 'SCHEMA', `${k} is required`);
    if (t.status !== undefined && t.status !== 'PENDING') E(id, 'STATUS', 'a plan may not set status; every task starts PENDING');
    if (t.evidence !== undefined && !(Array.isArray(t.evidence) && t.evidence.length === 0)) E(id, 'STATUS', 'a plan may not carry evidence');
    if (t.executor !== undefined && !['delegate', 'orchestrator'].includes(t.executor)) E(id, 'EXECUTOR', 'executor must be delegate or orchestrator');
    const task = { ...t, executor: t.executor ?? 'delegate' };
    if (!isReqList(t.requirements)) E(id, 'REQ_MISSING', 'task requirements are required');
    else for (const r of t.requirements) if (!(plan.requirements ?? []).includes(r)) E(id, 'REQ_NOT_IN_PLAN', `${r} is not in the plan's requirement list`);
    if (typeof t.recovery !== 'string' || t.recovery.trim().length < ctx.policy.recoveryMinChars) E(id, 'RECOVERY', `a rollback or recovery plan of at least ${ctx.policy.recoveryMinChars} characters is required`);
    const ma = t.maxAttempts ?? 2;
    if (!Number.isInteger(ma) || ma < 1 || ma > lim.maxAttemptsCap) E(id, 'ATTEMPTS', `maxAttempts must be an integer from 1 to ${lim.maxAttemptsCap}`);

    const { issues, needsApproval: na } = checkTaskPermissions(ctx, task);
    for (const i of issues) E(id, i.code, i.msg);
    const agent = ctx.agents.agents[t.agent];
    if (t.approval !== undefined && (typeof t.approval !== 'object' || t.approval === null || t.approval.required !== true || !/^P[2-4]$/.test(t.approval.tier ?? '') || typeof t.approval.reason !== 'string' || !t.approval.reason.trim())) E(id, 'APPROVAL', 'approval must be {required:true, tier:P2|P3|P4, reason}');
    if (na || t.approval?.required === true) needsApproval.push(id);

    const ctxFiles = t.inputContext ?? [];
    if (!Array.isArray(ctxFiles) || ctxFiles.length > lim.maxContextFilesPerTask) E(id, 'CONTEXT', `inputContext must be a list of at most ${lim.maxContextFilesPerTask} files`);
    else for (const f of ctxFiles) {
      const rel = cleanRel(f);
      if (!rel) { E(id, 'CONTEXT_PATH', `context path '${f}' must be a repository-relative path`); continue; }
      const info = perm.classifyPath(rel, ctx.model);
      if (info.classes.some((c) => FORBIDDEN_FOR_CONTEXT.includes(c))) E(id, 'CONTEXT_FORBIDDEN', `context '${rel}' is a secret, audit or isolated path`);
      else if (!fs.existsSync(path.join(ctx.root, rel)) || !fs.statSync(path.join(ctx.root, rel)).isFile()) E(id, 'CONTEXT_MISSING', `context file '${rel}' does not exist`);
    }

    const arts = Array.isArray(t.expectedArtifacts) ? t.expectedArtifacts : [];
    if (!arts.length) E(id, 'ARTIFACTS', 'at least one expected artifact is required');
    if (arts.length > lim.maxArtifactsPerTask) E(id, 'ARTIFACTS', `at most ${lim.maxArtifactsPerTask} artifacts`);
    const targets = new Set(); let hasFile = false;
    for (const a of arts) {
      if (a?.kind === 'result') { targets.add('@result'); continue; }
      if (a?.kind !== 'file') { E(id, 'ARTIFACTS', "artifact kind must be 'file' or 'result'"); continue; }
      hasFile = true;
      const rel = cleanRel(a.path);
      if (!rel || rel !== a.path) { E(id, 'ARTIFACT_PATH', `artifact path '${a.path}' must be a normalised repository-relative path`); continue; }
      targets.add(rel);
      const ext = (rel.split('/').pop().split('.').pop() ?? '').toLowerCase();
      if (ctx.model.execExt.has(ext)) E(id, 'ARTIFACT_EXEC', `'${rel}' is an executable or script type; a task may not produce code in phase ${ctx.phase}`);
      const info = perm.classifyPath(rel, ctx.model);
      if (info.classes.some((c) => FORBIDDEN_FOR_ARTIFACTS.includes(c))) E(id, 'ARTIFACT_CLASS', `'${rel}' is in a protected path class (${info.classes.join(', ')})`);
      if (agent) {
        const globs = [...agent.writes, ...(ctx.phase >= 1 ? agent.writesPhase1 : [])];
        if (!globs.some((g) => globToRe(g).test(rel))) E(id, 'ARTIFACT_SCOPE', `${t.agent} may not write '${rel}' (write scope: ${globs.join(', ') || 'none'})`);
        if (!agent.tools.includes('edit')) E(id, 'PLANNER_FILE_ARTIFACT', `${t.agent} has no edit tool; its output must be a 'result' artifact captured from its reply`);
      }
    }
    if (task.executor === 'orchestrator' && hasFile) E(id, 'ARTIFACTS', 'an orchestrator-executed task may only produce a result artifact');
    if (hasFile && !(t.permissions?.operations ?? []).includes('fs.write')) E(id, 'OPERATIONS', 'a task that writes a file must list the fs.write operation');

    const acc = Array.isArray(t.acceptance) ? t.acceptance : [];
    if (!acc.length) E(id, 'ACCEPTANCE_MISSING', 'at least one acceptance test is required');
    const accIds = new Set(); const covered = new Set();
    for (const c of acc) {
      if (!c || typeof c.id !== 'string' || !c.id) { E(id, 'ACCEPTANCE', 'each acceptance test needs an id'); continue; }
      if (accIds.has(c.id)) E(id, 'ACCEPTANCE', `duplicate acceptance id ${c.id}`);
      accIds.add(c.id);
      if (!ctx.policy.acceptanceTypes.includes(c.type)) { E(id, 'ACCEPTANCE_TYPE', `${c.id}: unknown type '${c.type}'`); continue; }
      if (c.type === 'command') {
        const line = Array.isArray(c.argv) ? c.argv.join(' ') : '';
        if (!Array.isArray(c.argv) || !c.argv.length || c.argv.some((x) => typeof x !== 'string' || /[\s"'`$&|;<>()^%]/.test(x))) E(id, 'COMMAND_NOT_ALLOWED', `${c.id}: argv must be plain words`);
        else if (!ctx.policy.commandAllowList.some((p) => new RegExp(p).test(line))) E(id, 'COMMAND_NOT_ALLOWED', `${c.id}: '${line}' is not on the command allow-list`);
        continue;
      }
      if (typeof c.target !== 'string' || !targets.has(c.target)) { E(id, 'ACCEPTANCE_TARGET', `${c.id}: target must be one of this task's artifacts (${[...targets].join(', ') || 'none'})`); continue; }
      covered.add(c.target);
      if (['file-contains', 'file-not-contains'].includes(c.type)) { try { new RegExp(c.pattern); } catch { E(id, 'ACCEPTANCE', `${c.id}: pattern is not a valid regular expression`); } }
      if (c.type === 'min-words' && !(Number.isInteger(c.min) && c.min > 0)) E(id, 'ACCEPTANCE', `${c.id}: min must be a positive integer`);
      if (c.type === 'headings' && !(Array.isArray(c.headings) && c.headings.length && c.headings.every((h) => typeof h === 'string' && h.trim()))) E(id, 'ACCEPTANCE', `${c.id}: headings must be a list of heading texts`);
      if (c.type === 'cites-requirements' && !(Number.isInteger(c.min) && c.min >= 1)) E(id, 'ACCEPTANCE', `${c.id}: min must be at least 1`);
      if (c.type === 'verdict' && c.allowed !== undefined && !(Array.isArray(c.allowed) && c.allowed.every((v) => ctx.policy.verdicts.includes(v)))) E(id, 'ACCEPTANCE', `${c.id}: allowed must be a subset of ${ctx.policy.verdicts.join(', ')}`);
    }
    for (const tg of targets) if (!covered.has(tg)) E(id, 'ARTIFACT_UNCHECKED', `artifact ${tg} has no acceptance test`);

    const deps = t.dependsOn ?? [];
    if (!Array.isArray(deps)) E(id, 'DEPENDENCY', 'dependsOn must be a list');
    else for (const d of deps) { if (d === id) E(id, 'CYCLE', 'a task cannot depend on itself'); else if (!byId.has(d)) E(id, 'UNKNOWN_DEP', `depends on unknown task ${d}`); }
  }

  for (const [id, t] of byId) {
    const agent = ctx.agents.agents[t.agent];
    const r = t.review;
    if (r !== undefined) {
      if (typeof r !== 'object' || r === null) { E(id, 'REVIEW', 'review must be an object'); continue; }
      if (r.required === true) {
        const rt = byId.get(r.by);
        if (!rt) E(id, 'REVIEW_MISSING', `review.by must name an existing task (${r.by})`);
        else {
          if (rt.agent === t.agent) E(id, 'REVIEW_SELF', 'the reviewer must be a different agent from the author');
          if (!ctx.policy.reviewerAgents.includes(rt.agent)) E(id, 'REVIEW_AGENT', `${rt.agent} is not an allowed reviewer (${ctx.policy.reviewerAgents.join(', ')})`);
          if (!(rt.dependsOn ?? []).includes(id)) E(id, 'REVIEW_DEP', `review task ${r.by} must depend on ${id}`);
          if (!(rt.acceptance ?? []).some((c) => c.type === 'verdict')) E(id, 'REVIEW_VERDICT', `review task ${r.by} needs a verdict acceptance test`);
        }
      } else if (typeof r.waiver !== 'string' || r.waiver.trim().length < ctx.policy.review.waiverMinChars) E(id, 'REVIEW', `review must be required, or carry a waiver reason of at least ${ctx.policy.review.waiverMinChars} characters`);
    } else if (agent && ctx.policy.review.requiredWhenAgentClass.includes(agent.class) && t.executor !== 'orchestrator') {
      E(id, 'REVIEW_MISSING', `${t.agent} is class ${agent.class}: its output needs an independent review task, or a waiver with a reason`);
    }
  }

  const order = []; const levels = []; let criticalPath = [];
  if (!errors.some((e) => ['UNKNOWN_DEP', 'DUP_ID', 'TASK_ID'].includes(e.code))) {
    const indeg = new Map([...byId.keys()].map((k) => [k, (byId.get(k).dependsOn ?? []).filter((d) => d !== k).length]));
    const depth = new Map(); const via = new Map();
    let frontier = [...byId.keys()].filter((k) => indeg.get(k) === 0).sort();
    while (frontier.length) {
      levels.push(frontier);
      const next = [];
      for (const k of frontier) {
        order.push(k);
        const deps = byId.get(k).dependsOn ?? [];
        depth.set(k, 1 + Math.max(0, ...deps.map((d) => depth.get(d) ?? 0)));
        via.set(k, [...deps].sort((a, b) => ((depth.get(b) ?? 0) - (depth.get(a) ?? 0)) || a.localeCompare(b))[0] ?? null);
        for (const [j, tj] of byId) if ((tj.dependsOn ?? []).includes(k) && j !== k) { indeg.set(j, indeg.get(j) - 1); if (indeg.get(j) === 0) next.push(j); }
      }
      frontier = [...new Set(next)].sort();
    }
    if (order.length !== byId.size) E('PLAN', 'CYCLE', `dependency cycle among: ${[...byId.keys()].filter((k) => !order.includes(k)).join(', ')}`);
    else if (!errors.some((e) => e.code === 'CYCLE')) {
      const end = [...depth.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0]?.[0];
      for (let k = end, guard = 0; k && guard <= byId.size; k = via.get(k), guard += 1) criticalPath.unshift(k);
    }
  }
  if (errors.some((e) => e.code === 'CYCLE')) criticalPath = [];
  if (needsApproval.length) W('PLAN', 'APPROVAL', `tasks that will pause for a signed human approval: ${needsApproval.join(', ')}`);

  const ok = errors.length === 0;
  const normal = ok ? normalizePlan(plan) : null;
  return { ok, errors, warnings, plan: normal, planHash: normal ? sha256(canonical(normal)) : null, order, levels, criticalPath, needsApproval, summary: { tasks: byId.size, levels: levels.length, criticalPath } };
}

// ---------------------------------------------------------------- store
const runIdFor = (planHash) => `RUN-${planHash.slice(0, 10)}`;
const runDir = (ctx, runId) => {
  if (!/^RUN-[0-9a-f]{10}$/.test(runId)) throw new EngineError('RUN_ID', `bad run id '${runId}'`);
  return path.join(ctx.runsDir, runId);
};
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const fileSha = (f) => sha256(fs.readFileSync(f));
// A recorded hash matches a file if the bytes match under either line-ending convention. Git rewrites line endings between
// Windows and Linux checkouts, and a content check must not fail on that, while any other change still does.
function sameSha(f, recorded) {
  const buf = fs.readFileSync(f);
  const s = buf.toString('latin1'); const lf = s.replace(/\r\n/g, '\n');
  return [buf, Buffer.from(lf, 'latin1'), Buffer.from(lf.replace(/\n/g, '\r\n'), 'latin1')].some((b) => sha256(b) === recorded);
}

function withLock(dir, fn) {
  const lock = path.join(dir, '.lock');
  const deadline = Date.now() + 10000;
  for (;;) {
    try { fs.mkdirSync(lock); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 60000) { fs.rmdirSync(lock); continue; } } catch { /* released meanwhile */ }
      if (Date.now() > deadline) throw new EngineError('LOCK', 'the run is locked by another process');
      sleep(25);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(lock); } catch { /* already gone */ } }
}

function atomicWrite(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text);
  for (let i = 0; ; i += 1) {
    try { fs.renameSync(tmp, file); return; } catch (e) { if (i >= 4) { try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ } throw e; } sleep(40); }
  }
}

// Version 2 covers the whole run except the log pointers; version 1 (legacy runs) covered only part of it and is verified as before, then upgraded on the next change.
const stateHashV1 = (run) => sha256(canonical({ runId: run.runId, planHash: run.planHash, state: run.state, rev: run.rev, attention: run.attention, tasks: run.tasks, approvalsUsed: run.approvalsUsed }));
const stateHashV2 = (run) => sha256(canonical({ ...run, eventHead: undefined, eventSeq: undefined, lastCommit: undefined, updatedAt: undefined }));
const stateHash = (run) => (run.hashVersion === 2 ? stateHashV2(run) : stateHashV1(run));
const evHash = (ev) => sha256(canonical({ ...ev, hash: undefined }));

function readEvents(dir) {
  const f = path.join(dir, 'events.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l, i) => { try { return JSON.parse(l); } catch { throw new EngineError('INTEGRITY', `events.jsonl line ${i + 1} is not valid JSON`, [`events.jsonl line ${i + 1} is not valid JSON`]); } });
}
function chainProblems(events) {
  const problems = []; let prev = null;
  events.forEach((e, i) => {
    if (e.seq !== i + 1) problems.push(`event ${i + 1}: sequence is ${e.seq}`);
    if (e.prevHash !== prev) problems.push(`event ${e.seq}: chain broken (previous hash does not match)`);
    if (e.hash !== evHash(e)) problems.push(`event ${e.seq}: content altered (hash does not match)`);
    prev = e.hash;
  });
  return problems;
}

function loadRun(ctx, runId, { readOnly = false } = {}) {
  const dir = runDir(ctx, runId);
  const file = path.join(dir, 'run.json');
  if (!fs.existsSync(file)) throw new EngineError('NO_RUN', `no run ${runId}`);
  const run = JSON.parse(fs.readFileSync(file, 'utf8'));
  let events = readEvents(dir);
  // A crash between writing run.json and appending its events leaves the log behind. The commit is repeated, never lost.
  // A read-only caller (the MCP status tool) checks the repaired chain in memory and writes nothing.
  const missing = (run.lastCommit?.events ?? []).filter((e) => e.seq > (events.at(-1)?.seq ?? 0));
  if (missing.length) {
    if (missing[0].seq !== (events.at(-1)?.seq ?? 0) + 1 || missing[0].prevHash !== (events.at(-1)?.hash ?? null)) throw new EngineError('INTEGRITY', 'run.json and the event log disagree; refusing to continue', ['run.json and the event log disagree']);
    if (readOnly) events = [...events, ...missing];
    else { fs.appendFileSync(path.join(dir, 'events.jsonl'), missing.map((e) => `${JSON.stringify(e)}\n`).join('')); events = readEvents(dir); }
  }
  const problems = chainProblems(events);
  if (events.length && events.at(-1).hash !== run.eventHead) problems.push('run.json does not point at the end of the event log (log truncated or run.json replaced)');
  if (run.lastCommit?.events?.at(-1) && run.lastCommit.events.at(-1).stateHash !== stateHash(run)) problems.push('run.json was changed outside the engine (state hash does not match the last event)');
  if (problems.length) throw new EngineError('INTEGRITY', `run ${runId} failed its integrity check: ${problems.join('; ')}`, problems);
  return run;
}

const checkpointCount = (dir) => { const d = path.join(dir, 'checkpoints'); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /^CP-\d+\.json$/.test(f)).length : 0; };
function writeCheckpoint(ctx, run, dir, label) {
  const n = checkpointCount(dir);
  fs.mkdirSync(path.join(dir, 'checkpoints'), { recursive: true });
  const cp = { schema: 'greenfuel.checkpoint/v1', n, ts: iso(ctx), label, runId: run.runId, rev: run.rev, eventSeq: run.eventSeq, eventHead: run.eventHead, stateHash: stateHash(run), runState: run.state, tasks: Object.fromEntries(Object.entries(run.tasks).map(([k, t]) => [k, { status: t.status, attempts: t.attempts }])) };
  atomicWrite(path.join(dir, 'checkpoints', `CP-${n}.json`), `${JSON.stringify(cp, null, 2)}\n`);
  return cp;
}

const MILESTONES = new Set(['run-state', 'escalate', 'stop', 'run-created', 'resume', 'checkpoint']);
function commit(ctx, run, dir, evs) {
  run.rev += 1; run.updatedAt = iso(ctx);
  const sh = stateHash(run);
  let prev = run.eventHead; let seq = run.eventSeq;
  const out = evs.map((e) => {
    seq += 1;
    const ev = { seq, ts: iso(ctx), runId: run.runId, rev: run.rev, ...e, stateHash: sh, prevHash: prev };
    ev.hash = evHash(ev); prev = ev.hash;
    return ev;
  });
  run.eventHead = prev; run.eventSeq = seq; run.lastCommit = { events: out };
  atomicWrite(path.join(dir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
  fs.appendFileSync(path.join(dir, 'events.jsonl'), out.map((e) => `${JSON.stringify(e)}\n`).join(''));
  if (out.some((e) => e.to === 'COMPLETED' || MILESTONES.has(e.action))) writeCheckpoint(ctx, run, dir, out.find((e) => MILESTONES.has(e.action))?.action ?? 'task-completed');
  return out;
}

// ---------------------------------------------------------------- state helpers
const planTask = (run, id) => run.plan.tasks.find((t) => t.id === id);
const isDone = (t) => t.status === 'COMPLETED';
const deadEnd = (t) => t.status === 'CANCELLED' || (t.status === 'FAILED' && t.terminal);

function move(ctx, run, id, to, emit, reason, extra = {}) {
  const t = run.tasks[id]; const from = t.status;
  if (from === to) return;
  if (!ctx.policy.transitions[from]?.includes(to)) throw new EngineError('ILLEGAL_TRANSITION', `${id}: ${from} to ${to} is not allowed`);
  t.status = to; t.updatedAt = iso(ctx);
  emit({ taskId: id, action: extra.action ?? 'transition', from, to, reason, detail: extra.detail, evidence: extra.evidence });
}

function refresh(ctx, run, emit) {
  for (const id of run.topoOrder) {
    const t = run.tasks[id];
    if (t.status !== 'PENDING') continue;
    const deps = planTask(run, id).dependsOn;
    const dead = deps.find((d) => deadEnd(run.tasks[d]));
    if (dead) { t.blockedReason = `dependency ${dead} is ${run.tasks[dead].status}`; move(ctx, run, id, 'BLOCKED', emit, t.blockedReason, { action: 'block' }); continue; }
    if (!deps.every((d) => isDone(run.tasks[d]))) continue;
    if (t.approval.required && !t.approval.applied) move(ctx, run, id, 'AWAITING_APPROVAL', emit, `needs a signed ${t.approval.tier} human approval`, { action: 'await-approval' });
    else move(ctx, run, id, 'READY', emit, 'dependencies complete', { action: 'ready' });
  }
}

function reviewFindings(ctx, run) {
  const out = [];
  // The blocking verdicts come from the trusted policy, never from state stored in the run.
  for (const pt of run.plan.tasks) if (pt.review?.required && run.tasks[pt.review.by]?.status === 'COMPLETED') {
    const v = run.tasks[pt.review.by].verdict;
    if (v && ctx.policy.blockingVerdicts.includes(v)) out.push({ task: pt.id, reviewer: pt.review.by, verdict: v });
  }
  return out;
}

function settleRun(ctx, run, emit) {
  const all = Object.values(run.tasks);
  const attention = [];
  for (const [id, t] of Object.entries(run.tasks)) {
    if (t.status === 'FAILED' && t.terminal) attention.push(`${id} FAILED (${t.lastError?.class}) and is escalated: ${String(t.lastError?.message ?? '').slice(0, 140)}`);
    if (t.status === 'BLOCKED') attention.push(`${id} BLOCKED: ${t.blockedReason}`);
    if (t.status === 'AWAITING_APPROVAL') attention.push(`${id} waits for a signed ${t.approval.tier} approval`);
    if (t.drift?.length && t.status !== 'COMPLETED') attention.push(`${id} artifact drift: ${t.drift.join('; ')}`);
  }
  const findings = reviewFindings(ctx, run);
  for (const f of findings) attention.push(`${f.reviewer} gave ${f.verdict} on ${f.task}: a human decision or a reopen is needed`);
  run.attention = attention;
  if (['STOPPED', 'CANCELLED', 'CLOSED'].includes(run.state)) return;
  const open = all.filter((t) => !(isDone(t) || deadEnd(t)));
  let next = 'ACTIVE';
  if (!open.length) next = all.every(isDone) && !findings.length ? 'COMPLETED' : 'NEEDS_HUMAN';
  else if (open.every((t) => t.status === 'BLOCKED')) next = 'NEEDS_HUMAN';
  if (run.state !== next) { const from = run.state; run.state = next; emit({ action: 'run-state', from, to: next, reason: attention[0] ?? 'all tasks reached a final state' }); }
}

// Every state-changing call goes through here: lock, load and verify, change in memory, refresh, commit once.
function mutate(ctx, runId, fn) {
  const dir = runDir(ctx, runId);
  if (!fs.existsSync(path.join(dir, 'run.json'))) throw new EngineError('NO_RUN', `no run ${runId}`);
  return withLock(dir, () => {
    const run = loadRun(ctx, runId);
    const snapshot = JSON.stringify(run);
    const evs = []; const emit = (e) => evs.push({ actor: ctx.actor ?? 'operator', ...e });
    // A run written before the whole-state hash existed is verified under its old hash, then upgraded by this change.
    if (run.hashVersion !== 2) { run.hashVersion = 2; emit({ action: 'integrity-upgrade', reason: 'the state hash now covers the plan, order, limits and every task field, not only part of the state' }); }
    try {
      const result = fn(run, emit, dir) ?? {};
      refresh(ctx, run, emit);
      settleRun(ctx, run, emit);
      if (evs.length) commit(ctx, run, dir, evs);
      return { ...result, state: run.state, rev: run.rev };
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      commit(ctx, JSON.parse(snapshot), dir, [{ actor: ctx.actor ?? 'operator', taskId: e.detail?.taskId, action: 'refused', reason: `${e.code}: ${e.message}`, detail: { code: e.code } }]);
      throw e;
    }
  });
}

// ---------------------------------------------------------------- init
function initRun(ctx0, plan, opts = {}) {
  const ctx = { ...ctx0, actor: opts.actor ?? 'operator' };
  const v = validatePlan(plan, ctx);
  if (!v.ok) throw new EngineError('PLAN_INVALID', `the plan has ${v.errors.length} problem(s): ${v.errors.slice(0, 5).map((e) => `${e.task}/${e.code}`).join(', ')}`, v.errors);
  const runId = runIdFor(v.planHash);
  const dir = runDir(ctx, runId);
  fs.mkdirSync(ctx.runsDir, { recursive: true });
  try { fs.mkdirSync(dir); } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    for (let i = 0; i < 40 && !fs.existsSync(path.join(dir, 'run.json')); i += 1) sleep(25);
    const run = loadRun(ctx, runId);
    return { runId, existed: true, state: run.state, planHash: run.planHash };
  }
  return withLock(dir, () => {
    const tasks = {};
    for (const t of v.plan.tasks) {
      const chk = checkTaskPermissions(ctx, t);
      const required = chk.needsApproval || t.approval?.required === true;
      const tier = t.approval?.tier ?? (chk.maxTier >= 2 ? `P${chk.maxTier}` : null);
      tasks[t.id] = { status: 'PENDING', attempts: 0, reopens: 0, retryAfter: null, lease: null, attemptLog: [], artifacts: [], evidence: [], acceptance: null, verdict: null, blockedReason: null, lastError: null, classCounts: {}, feedback: [], terminal: false, drift: [], approval: { required, tier, reason: t.approval?.reason ?? (chk.needsApproval ? 'operations at P2 or above' : null), applied: null }, updatedAt: iso(ctx) };
    }
    const run = { schema: 'greenfuel.run/v1', hashVersion: 2, runId, planHash: v.planHash, plan: v.plan, topoOrder: v.order, policyBlocking: ctx.policy.blockingVerdicts, state: 'ACTIVE', rev: 0, createdAt: iso(ctx), updatedAt: iso(ctx), attention: [], approvalsUsed: [], tasks, eventHead: null, eventSeq: 0, lastCommit: null, limits: { leaseMinutes: ctx.policy.limits.leaseMinutes } };
    const evs = [{ actor: ctx.actor, action: 'run-created', reason: v.plan.title, detail: { planHash: v.planHash, tasks: v.order.length, criticalPath: v.criticalPath, needsApproval: v.needsApproval, ...(opts.detail ?? {}) } }];
    for (const id of v.order) evs.push({ actor: ctx.actor, taskId: id, action: 'task-created', to: 'PENDING', reason: planTask(run, id).title });
    const collect = (e) => evs.push({ actor: ctx.actor, ...e });
    refresh(ctx, run, collect); settleRun(ctx, run, collect);
    commit(ctx, run, dir, evs);
    return { runId, existed: false, state: run.state, planHash: run.planHash, order: v.order, criticalPath: v.criticalPath };
  });
}

// ---------------------------------------------------------------- errors
function classifyError(message, ctx, explicit) {
  if (explicit) { if (!ctx.policy.errorClasses[explicit]) throw new EngineError('ERROR_CLASS', `unknown error class '${explicit}'`); return explicit; }
  for (const c of ctx.policy.classifierPatterns) if (new RegExp(c.pattern, 'i').test(String(message ?? ''))) return c.class;
  return 'UNKNOWN';
}

function applyFailure(ctx, run, id, emit, { errorClass, message }) {
  const t = run.tasks[id]; const pt = planTask(run, id);
  const def = ctx.policy.errorClasses[errorClass];
  t.classCounts[errorClass] = (t.classCounts[errorClass] ?? 0) + 1;
  t.lastError = { class: errorClass, message: String(message ?? '').slice(0, 600), attempt: t.attempts, at: iso(ctx) };
  const last = t.attemptLog.at(-1);
  if (last && !last.endedAt) { last.endedAt = iso(ctx); last.outcome = 'failed'; last.errorClass = errorClass; }
  t.lease = null;
  if (def.action === 'block') { t.blockedReason = String(message).slice(0, 300); move(ctx, run, id, 'BLOCKED', emit, t.blockedReason, { action: 'block', detail: { errorClass } }); return 'block'; }
  const retryable = def.retryable && t.attempts < pt.maxAttempts && (def.maxRetries === undefined || t.classCounts[errorClass] <= def.maxRetries);
  move(ctx, run, id, 'FAILED', emit, String(message).slice(0, 400), { action: 'fail', detail: { errorClass, attempt: t.attempts, retryable } });
  if (retryable) {
    const back = def.backoffSeconds?.[Math.min(t.attempts - 1, def.backoffSeconds.length - 1)] ?? 0;
    t.retryAfter = back ? new Date(ctx.now().getTime() + back * 1000).toISOString() : null;
    t.terminal = false;
    return 'retry';
  }
  t.terminal = true; t.retryAfter = null;
  const why = !def.retryable ? `error class ${errorClass} is not retryable (${def.action})` : `retry budget spent (${t.attempts} of ${pt.maxAttempts} attempts, class ${errorClass})`;
  const action = def.action === 'stop' ? 'stop' : 'escalate';
  emit({ taskId: id, action, reason: why, detail: { errorClass } });
  if (action === 'stop') { const from = run.state; run.state = 'STOPPED'; emit({ action: 'run-state', from, to: 'STOPPED', reason: `${id}: ${errorClass}` }); }
  return action;
}

// ---------------------------------------------------------------- operations
function start(ctx0, runId, taskId, o = {}) {
  const ctx = { ...ctx0, actor: o.actor ?? 'operator' };
  return mutate(ctx, runId, (run, emit) => {
    const refuse = (code, msg) => { throw new Refusal(code, msg, { taskId }); };
    const t = run.tasks[taskId];
    if (!t) refuse('NO_TASK', `no task ${taskId}`);
    const pt = planTask(run, taskId);
    if (t.status === 'RUNNING' && o.promptSha256 && t.lease?.promptSha256 === o.promptSha256) return { idempotent: true, attempt: t.attempts, lease: t.lease };
    if (run.state !== 'ACTIVE') refuse('RUN_NOT_ACTIVE', `run is ${run.state}`);
    if (t.status !== 'READY') refuse('NOT_READY', `${taskId} is ${t.status}, not READY${t.status === 'AWAITING_APPROVAL' ? ' (waiting for a signed approval)' : ''}`);
    const expected = pt.executor === 'orchestrator' ? 'orchestrator' : pt.agent;
    if (o.agent !== expected) refuse('WRONG_AGENT', `${taskId} is assigned to ${pt.agent}${pt.executor === 'orchestrator' ? ' (executed by the orchestrator itself)' : ''}, not ${o.agent}`);
    if (pt.executor === 'delegate' && (o.mode ?? 'sync') !== 'sync') refuse('BACKGROUND_DENIED', 'a tracked task must be delegated synchronously so its result can be captured');
    if (t.attempts >= pt.maxAttempts) refuse('ATTEMPTS_EXHAUSTED', `${taskId} has used ${t.attempts} of ${pt.maxAttempts} attempts`);
    if (t.retryAfter && ctx.now() < new Date(t.retryAfter)) refuse('BACKOFF', `${taskId} may not restart before ${t.retryAfter}`);
    const prev = t.attemptLog.at(-1);
    if (prev && !prev.superseded && o.promptSha256 && prev.promptSha256 === o.promptSha256) refuse('UNCHANGED_PROMPT', 'a retry must use a changed prompt that carries the failed checks; this prompt is identical to the previous attempt');
    const chk = checkTaskPermissions(ctx, pt);
    if (chk.issues.length) refuse('PERMISSION', chk.issues.map((i) => `${i.code}: ${i.msg}`).join('; '));
    t.attempts += 1;
    const startedAt = iso(ctx);
    t.lease = { attempt: t.attempts, startedAt, expiresAt: new Date(ctx.now().getTime() + run.limits.leaseMinutes * 60000).toISOString(), promptSha256: o.promptSha256 ?? null, agent: o.agent };
    t.attemptLog.push({ attempt: t.attempts, startedAt, promptSha256: o.promptSha256 ?? null, agent: o.agent, endedAt: null, outcome: null });
    t.retryAfter = null;
    move(ctx, run, taskId, 'RUNNING', emit, `attempt ${t.attempts} of ${pt.maxAttempts} by ${o.agent}`, { action: 'start', detail: { attempt: t.attempts, promptSha256: o.promptSha256 ?? null } });
    return { attempt: t.attempts, lease: t.lease };
  });
}

let redactCache = null;
function redact(ctx, text) {
  redactCache ??= new Map();
  if (!redactCache.has(ctx.root)) { try { redactCache.set(ctx.root, readJson(ctx.root, 'harness/policy/secret-patterns.json').redaction); } catch { redactCache.set(ctx.root, []); } }
  let out = String(text); let n = 0;
  for (const p of redactCache.get(ctx.root)) out = out.replace(new RegExp(p, 'gi'), () => { n += 1; return '[REDACTED]'; });
  return { text: out, redactions: n };
}
const stripHeader = (s) => s.replace(/^<!-- captured result[^\n]*-->\r?\n\r?\n?/, '');

function readTarget(ctx, run, dir, id, target) {
  const t = run.tasks[id];
  if (target === '@result') {
    const a = [...t.artifacts].reverse().find((x) => x.kind === 'result' && x.attempt === t.attempts);
    if (!a) return { ok: false, reason: 'no captured result for this attempt' };
    try { return { ok: true, text: stripHeader(fs.readFileSync(path.join(dir, a.path), 'utf8')) }; } catch { return { ok: false, reason: 'captured result file is missing' }; }
  }
  const f = path.join(ctx.root, target);
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) return { ok: false, reason: `${target} does not exist` };
  return { ok: true, text: fs.readFileSync(f, 'utf8') };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function evaluateChecks(ctx, run, dir, id, { commands = false } = {}) {
  const pt = planTask(run, id); const t = run.tasks[id];
  const known = knownIds(ctx);
  const results = [];
  let secrets = [];
  try { secrets = readJson(ctx.root, 'harness/policy/secret-patterns.json').repository.map((p) => new RegExp(p)); } catch { /* no list: the no-secret check then passes vacuously, which validate-orchestration reports */ }
  // An artifact must have been written after this attempt began, so a stale file cannot satisfy a new attempt.
  const startedAt = Date.parse(t.lease?.startedAt ?? t.attemptLog.at(-1)?.startedAt ?? 0);
  for (const a of t.artifacts.filter((x) => x.kind === 'file' && x.attempt === t.attempts)) {
    const fresh = a.mtimeMs >= startedAt - 2000;
    results.push({ id: `fresh:${a.path}`, type: 'artifact-fresh', ok: fresh, detail: fresh ? 'written during this attempt' : 'the file is older than the attempt, so this attempt did not produce it' });
  }
  for (const c of pt.acceptance) {
    const r = { id: c.id, type: c.type, ok: false, detail: '' };
    if (c.type === 'command') { r.skipped = !commands; r.detail = commands ? 'pending' : 'command checks run with `tasks.mjs validate`'; results.push(r); continue; }
    const tgt = readTarget(ctx, run, dir, id, c.target);
    if (!tgt.ok) { r.detail = tgt.reason; results.push(r); continue; }
    const text = tgt.text;
    switch (c.type) {
      case 'file-exists': r.ok = text.trim().length > 0; r.detail = r.ok ? `${Buffer.byteLength(text)} bytes` : 'empty'; break;
      case 'file-contains': r.ok = new RegExp(c.pattern, c.flags ?? 'im').test(text); r.detail = r.ok ? 'found' : `no match for /${c.pattern}/`; break;
      case 'file-not-contains': r.ok = !new RegExp(c.pattern, c.flags ?? 'im').test(text); r.detail = r.ok ? 'absent' : `forbidden text /${c.pattern}/ present`; break;
      case 'headings': { const miss = c.headings.filter((h) => !new RegExp(`^#{1,6}\\s*(\\d+[.)]?\\s*)?${esc(h)}\\b`, 'im').test(text)); r.ok = !miss.length; r.detail = r.ok ? 'all present' : `missing headings: ${miss.join(', ')}`; break; }
      case 'min-words': { const n = (text.match(/\S+/g) ?? []).length; r.ok = n >= c.min; r.detail = `${n} words (minimum ${c.min})`; break; }
      case 'json-valid': try { JSON.parse(text); r.ok = true; r.detail = 'valid JSON'; } catch (e) { r.detail = `invalid JSON: ${e.message}`; } break;
      case 'verdict': {
        // Every verdict line must agree. Taking the first would let a quoted earlier "Verdict: ACCEPT" mask a final REWORK.
        const found = [...text.matchAll(/^[*_\s>#-]*verdict\b[*_\s]*[:-][*_\s]*(ACCEPT-WITH-CONDITIONS|ACCEPT|REWORK|REJECT)\b/gim)].map((m) => m[1].toUpperCase());
        const distinct = [...new Set(found)];
        const allowed = c.allowed ?? ctx.policy.verdicts;
        if (!distinct.length) r.detail = `no 'Verdict: <${ctx.policy.verdicts.join('|')}>' line`;
        else if (distinct.length > 1) r.detail = `conflicting verdict lines (${distinct.join(', ')}): a review must state one verdict`;
        else if (!allowed.includes(distinct[0])) r.detail = `verdict ${distinct[0]} is not one of ${allowed.join(', ')}`;
        else { r.ok = true; r.detail = `verdict ${distinct[0]}`; t.verdict = distinct[0]; }
        break;
      }
      case 'cites-requirements': {
        const ids = [...new Set(text.match(/\b[A-Z]{2,5}-\d{3}\b/g) ?? [])].filter((x) => known.prefixes.has(x.split('-')[0]));
        const unknown = ids.filter((x) => !known.requirements.has(x));
        const mine = ids.filter((x) => pt.requirements.includes(x));
        r.ok = !unknown.length && mine.length >= c.min;
        r.detail = unknown.length ? `cites requirement IDs that do not exist: ${unknown.join(', ')}` : `cites ${mine.length} of this task's requirements (minimum ${c.min})`;
        break;
      }
      case 'no-secret': {
        const hit = secrets.find((re) => re.test(text));
        const redacted = c.target === '@result' ? ([...t.artifacts].reverse().find((x) => x.kind === 'result' && x.attempt === t.attempts)?.redactions ?? 0) : 0;
        r.ok = !hit && !redacted;
        r.detail = hit ? 'secret-shaped text found' : redacted ? `${redacted} secret-shaped string(s) had to be redacted from the reply` : 'none found';
        break;
      }
      default: r.detail = 'unsupported';
    }
    results.push(r);
  }
  return results;
}

function fileFacts(ctx, rel) {
  const f = path.join(ctx.root, rel);
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) return null;
  const buf = fs.readFileSync(f);
  return { sha256: sha256(buf), bytes: buf.length, mtimeMs: fs.statSync(f).mtimeMs };
}

function conclude(ctx, run, id, emit, results, actor) {
  const t = run.tasks[id];
  const failed = results.filter((r) => !r.ok && !r.skipped);
  const pending = results.filter((r) => r.skipped);
  t.acceptance = { attempt: t.attempts, at: iso(ctx), results, ok: !failed.length && !pending.length };
  if (failed.length) {
    t.feedback = failed.map((r) => `${r.id} (${r.type}): ${r.detail}`);
    applyFailure(ctx, run, id, emit, { errorClass: 'ACCEPTANCE_FAILED', message: `acceptance tests failed: ${t.feedback.join(' | ')}` });
    return 'failed';
  }
  if (pending.length) { emit({ taskId: id, action: 'validate-pending', reason: `${pending.length} command check(s) still to run`, detail: { checks: pending.map((p) => p.id) } }); return 'pending'; }
  t.feedback = []; t.drift = [];
  const last = t.attemptLog.at(-1);
  if (last && !last.endedAt) { last.endedAt = iso(ctx); last.outcome = 'completed'; }
  t.lease = null;
  t.evidence = [
    ...t.artifacts.filter((a) => a.attempt === t.attempts).map((a) => ({ type: a.kind === 'result' ? 'captured-result' : 'artifact', ref: a.path, sha256: a.sha256 })),
    { type: 'acceptance', ref: `${id}#attempt${t.attempts}`, sha256: sha256(canonical(results)) },
    ...results.filter((r) => r.evidenceRef).map((r) => ({ type: 'command', ref: r.evidenceRef, sha256: r.evidenceSha256 })),
  ];
  move(ctx, run, id, 'COMPLETED', emit, `all ${results.length} acceptance checks passed`, { action: 'accept', detail: { attempt: t.attempts, verdict: t.verdict, by: actor }, evidence: t.evidence });
  return 'completed';
}

function submit(ctx0, runId, taskId, o = {}) {
  const ctx = { ...ctx0, actor: o.actor ?? 'operator' };
  return mutate(ctx, runId, (run, emit, dir) => {
    const refuse = (code, msg) => { throw new Refusal(code, msg, { taskId }); };
    const t = run.tasks[taskId]; if (!t) refuse('NO_TASK', `no task ${taskId}`);
    const pt = planTask(run, taskId);
    const lim = ctx.policy.limits;
    let red = null;
    if (o.resultText !== undefined) {
      let body = String(o.resultText); let truncated = false;
      if (Buffer.byteLength(body) > lim.maxResultBytes) { body = body.slice(0, lim.maxResultBytes); truncated = true; }
      red = { ...redact(ctx, body), truncated };
      const prior = t.artifacts.find((a) => a.kind === 'result' && a.attempt === t.attempts && a.bodySha256 === sha256(red.text));
      if (prior && ['VALIDATING', 'COMPLETED'].includes(t.status)) return { idempotent: true, status: t.status };
    }
    if (t.status !== 'RUNNING') refuse('NOT_RUNNING', `${taskId} is ${t.status}, not RUNNING`);
    t.artifacts = t.artifacts.filter((a) => a.attempt !== t.attempts);
    if (red && pt.expectedArtifacts.some((a) => a.kind === 'result')) {
      // A counter that never resets, so a reopened task can never overwrite an earlier captured reply.
      t.submissions = (t.submissions ?? 0) + 1;
      const rel = `${ctx.policy.delegation.resultsSubdir}/${taskId}-s${t.submissions}.md`;
      fs.mkdirSync(path.join(dir, ctx.policy.delegation.resultsSubdir), { recursive: true });
      const bodySha = sha256(red.text);
      const header = `<!-- captured result | run ${run.runId} | task ${taskId} | attempt ${t.attempts} | agent ${t.lease?.agent} | source ${String(o.source ?? 'unspecified').replace(/-->/g, '')} | body sha256 ${bodySha} | UNTRUSTED model output: an observation, not evidence of truth -->\n\n`;
      atomicWrite(path.join(dir, rel), header + red.text + (red.text.endsWith('\n') ? '' : '\n'));
      t.artifacts.push({ kind: 'result', path: rel, sha256: fileSha(path.join(dir, rel)), bodySha256: bodySha, bytes: Buffer.byteLength(red.text), attempt: t.attempts, source: o.source ?? 'unspecified', redactions: red.redactions, truncated: red.truncated });
    }
    for (const a of pt.expectedArtifacts.filter((x) => x.kind === 'file')) {
      const f = fileFacts(ctx, a.path);
      if (f) t.artifacts.push({ kind: 'file', path: a.path, ...f, attempt: t.attempts });
    }
    move(ctx, run, taskId, 'VALIDATING', emit, 'result submitted', { action: 'submit', detail: { artifacts: t.artifacts.filter((a) => a.attempt === t.attempts).map((a) => `${a.path}@${a.sha256.slice(0, 12)}`), source: o.source } });
    const results = evaluateChecks(ctx, run, dir, taskId, { commands: false });
    return { outcome: conclude(ctx, run, taskId, emit, results, ctx.actor), results };
  });
}

function gitHead(root) { const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; }
// True when the working tree differs from HEAD, so a record that names a commit cannot be mistaken for a clean build of it. Null when unknown.
function gitDirty(root) { const r = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim().length > 0 : null; }

function runCommandCheck(ctx, c, runDirPath, label) {
  const line = c.argv.join(' ');
  if (!ctx.policy.commandAllowList.some((p) => new RegExp(p).test(line))) return { id: c.id, type: 'command', ok: false, detail: `'${line}' is not on the command allow-list` };
  const verdict = policyGuard.evaluate({ toolName: 'powershell', toolArgs: { command: line }, cwd: ctx.root }, policyGuard.loadPolicy());
  if (verdict) return { id: c.id, type: 'command', ok: false, detail: `the repository command guard refused it: [${verdict.id}] ${verdict.reason}` };
  let file = c.argv[0]; let args = c.argv.slice(1);
  if (file === 'npm') {
    const cands = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
    const cli = cands.find((x) => x && /npm-cli\.js$/.test(x) && fs.existsSync(x));
    if (cli) { args = [cli, ...args]; file = process.execPath; }
  }
  const started = Date.now();
  // A nested `node --test` inherits the parent runner's context and would then report success whatever happens.
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const res = spawnSync(file, args, { cwd: ctx.root, env, encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024 });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const rec = { schema: 'greenfuel.command-evidence/v1', label, argv: c.argv, exitCode: res.status, signal: res.signal ?? null, spawnError: res.error?.message ?? null, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, outputSha256: sha256(out), outputBytes: Buffer.byteLength(out), outputTail: redact(ctx, out.slice(-1500)).text, commit: ctx.headCommit ?? gitHead(ctx.root), workingTreeDirty: ctx.headCommit ? null : gitDirty(ctx.root) };
  fs.mkdirSync(path.join(runDirPath, 'evidence'), { recursive: true });
  const rel = `evidence/${label}.json`;
  const body = `${JSON.stringify(rec, null, 2)}\n`;
  atomicWrite(path.join(runDirPath, rel), body);
  return { id: c.id, type: 'command', ok: res.status === 0 && !res.error, detail: `exit ${res.status}${res.error ? ` (${res.error.message})` : ''}`, evidenceRef: rel, evidenceSha256: sha256(body) };
}

// Command checks are slow, so they run outside the lock. The verdict is recorded only if the task is still in the same attempt.
function validateTask(ctx0, runId, taskId, o = {}) {
  const ctx = { ...ctx0, actor: o.actor ?? 'operator' };
  const dir = runDir(ctx, runId);
  const snap = withLock(dir, () => { const r = loadRun(ctx, runId); const t = r.tasks[taskId]; return t ? JSON.parse(JSON.stringify({ pt: planTask(r, taskId), attempt: t.attempts, status: t.status })) : null; });
  if (!snap) throw new EngineError('NO_TASK', `no task ${taskId}`);
  if (snap.status !== 'VALIDATING') throw new Refusal('NOT_VALIDATING', `${taskId} is ${snap.status}, not VALIDATING`, { taskId });
  const cmd = new Map();
  for (const c of snap.pt.acceptance.filter((x) => x.type === 'command')) cmd.set(c.id, runCommandCheck(ctx, c, dir, `${taskId}-${c.id}-a${snap.attempt}`));
  return mutate(ctx, runId, (run, emit) => {
    const t = run.tasks[taskId];
    if (t.status !== 'VALIDATING' || t.attempts !== snap.attempt) throw new Refusal('STALE_VALIDATION', 'the task changed while its commands ran; validate again', { taskId });
    // Drift revalidation: refresh the recorded facts of changed files. A changed captured result is tampering, never a normal change.
    for (const a of t.artifacts.filter((x) => x.attempt === t.attempts)) {
      if (a.kind === 'file') { const f = fileFacts(ctx, a.path); if (f) Object.assign(a, f); }
      else if (!fs.existsSync(path.join(dir, a.path)) || !sameSha(path.join(dir, a.path), a.sha256)) {
        applyFailure(ctx, run, taskId, emit, { errorClass: 'INTERNAL', message: `captured result ${a.path} was altered or removed after it was recorded` });
        return { outcome: 'failed', results: [] };
      }
    }
    const results = evaluateChecks(ctx, run, dir, taskId, { commands: true }).map((r) => (r.type === 'command' ? cmd.get(r.id) : r));
    return { outcome: conclude(ctx, run, taskId, emit, results, ctx.actor), results };
  });
}

function fail(ctx0, runId, taskId, o = {}) {
  const ctx = { ...ctx0, actor: o.actor ?? 'operator' };
  return mutate(ctx, runId, (run, emit) => {
    const t = run.tasks[taskId];
    if (!t) throw new Refusal('NO_TASK', `no task ${taskId}`, { taskId });
    if (!['RUNNING', 'VALIDATING'].includes(t.status)) throw new Refusal('NOT_ACTIVE', `${taskId} is ${t.status}; only a RUNNING or VALIDATING task can fail`, { taskId });
    const errorClass = classifyError(o.message, ctx, o.errorClass);
    return { errorClass, action: applyFailure(ctx, run, taskId, emit, { errorClass, message: o.message }) };
  });
}

function retry(ctx0, runId, taskId, o = {}) {
  const ctx = { ...ctx0, actor: o.actor ?? 'operator' };
  return mutate(ctx, runId, (run, emit) => {
    const t = run.tasks[taskId]; const refuse = (c, m) => { throw new Refusal(c, m, { taskId }); };
    if (!t) refuse('NO_TASK', `no task ${taskId}`);
    if (t.status !== 'FAILED') refuse('NOT_FAILED', `${taskId} is ${t.status}, not FAILED`);
    if (t.terminal) refuse('NOT_RETRYABLE', `${taskId} failed with ${t.lastError?.class} and is escalated; it needs a human decision, not a retry`);
    if (run.state !== 'ACTIVE') refuse('RUN_NOT_ACTIVE', `run is ${run.state}`);
    if (t.attempts >= planTask(run, taskId).maxAttempts) refuse('ATTEMPTS_EXHAUSTED', `${taskId} has no attempts left`);
    move(ctx, run, taskId, 'READY', emit, o.reason ?? 'retry after a retryable failure', { action: 'retry', detail: { errorClass: t.lastError?.class } });
  });
}

function block(ctx0, runId, taskId, o = {}) {
  const ctx = { ...ctx0, actor: o.actor ?? 'operator' };
  return mutate(ctx, runId, (run, emit) => {
    const t = run.tasks[taskId]; if (!t) throw new Refusal('NO_TASK', `no task ${taskId}`, { taskId });
    if (!o.reason) throw new Refusal('REASON', 'a reason is required', { taskId });
    t.lease = null; t.blockedReason = o.reason;
    move(ctx, run, taskId, 'BLOCKED', emit, o.reason, { action: 'block' });
  });
}
function unblock(ctx0, runId, taskId, o = {}) {
  const ctx = { ...ctx0, actor: o.actor ?? 'operator' };
  return mutate(ctx, runId, (run, emit) => {
    const t = run.tasks[taskId]; if (!t) throw new Refusal('NO_TASK', `no task ${taskId}`, { taskId });
    if (t.status !== 'BLOCKED') throw new Refusal('NOT_BLOCKED', `${taskId} is ${t.status}`, { taskId });
    if (!o.reason) throw new Refusal('REASON', 'a reason (what changed) is required', { taskId });
    t.blockedReason = null;
    move(ctx, run, taskId, 'PENDING', emit, o.reason, { action: 'unblock' });
  });
}
function cancelTask(ctx0, runId, taskId, o = {}) {
  const ctx = { ...ctx0, actor: o.actor ?? 'operator' };
  return mutate(ctx, runId, (run, emit) => {
    const t = run.tasks[taskId]; if (!t) throw new Refusal('NO_TASK', `no task ${taskId}`, { taskId });
    if (t.status === 'COMPLETED' || t.status === 'CANCELLED') throw new Refusal('TERMINAL', `${taskId} is ${t.status}`, { taskId });
    t.lease = null;
    move(ctx, run, taskId, 'CANCELLED', emit, o.reason ?? 'cancelled', { action: 'cancel' });
  });
}
function cancelRun(ctx0, runId, o = {}) {
  const ctx = { ...ctx0, actor: o.actor ?? 'operator' };
  return mutate(ctx, runId, (run, emit) => {
    for (const [id, t] of Object.entries(run.tasks)) if (!['COMPLETED', 'CANCELLED'].includes(t.status)) { t.lease = null; move(ctx, run, id, 'CANCELLED', emit, o.reason ?? 'run cancelled', { action: 'cancel' }); }
    const from = run.state; run.state = 'CANCELLED';
    emit({ action: 'run-state', from, to: 'CANCELLED', reason: o.reason ?? 'run cancelled' });
  });
}

// Releases an attempt that never ran. The hook starts an attempt before the tool executes, so a call the tool then rejects
// leaves a RUNNING attempt with nobody working on it. Only a human releases it; the attempt is refunded and the reason logged.
function release(ctx0, runId, taskId, o = {}) {
  const ctx = { ...ctx0, actor: o.actor ?? 'operator' };
  return mutate(ctx, runId, (run, emit) => {
    const t = run.tasks[taskId]; if (!t) throw new Refusal('NO_TASK', `no task ${taskId}`, { taskId });
    if (t.status !== 'RUNNING') throw new Refusal('NOT_RUNNING', `${taskId} is ${t.status}; only a RUNNING attempt can be released`, { taskId });
    if (!o.reason || String(o.reason).trim().length < 15) throw new Refusal('REASON', 'a reason of at least 15 characters is required: say why no delegate ran', { taskId });
    const lost = t.attemptLog.pop();
    t.released = [...(t.released ?? []), { attempt: t.attempts, at: iso(ctx), reason: String(o.reason).slice(0, 300), promptSha256: lost?.promptSha256 ?? null }];
    t.attempts -= 1; t.lease = null;
    move(ctx, run, taskId, 'READY', emit, o.reason, { action: 'release', detail: { attemptRefunded: true, attempts: t.attempts } });
  });
}

// A human concludes a run that needs a decision (NEEDS_HUMAN) or is frozen (STOPPED). The decision and reason are logged.
// Closing approves nothing: it only ends the run, so ad hoc delegation is no longer gated by it.
function closeRun(ctx0, runId, o = {}) {
  const ctx = { ...ctx0, actor: o.actor ?? 'operator' };
  return mutate(ctx, runId, (run, emit) => {
    if (!['NEEDS_HUMAN', 'STOPPED'].includes(run.state)) throw new Refusal('NOT_CLOSABLE', `run is ${run.state}; only a run waiting for a human or stopped can be closed (finish or cancel others)`);
    if (!o.reason || String(o.reason).trim().length < 15) throw new Refusal('REASON', 'a reason of at least 15 characters is required: record the decision taken');
    const from = run.state; run.state = 'CLOSED';
    emit({ action: 'run-state', from, to: 'CLOSED', reason: String(o.reason).slice(0, 400), detail: { closedBy: ctx.actor } });
  });
}

function pauseForApproval(ctx0, runId, taskId, o = {}) {
  const ctx = { ...ctx0, actor: o.actor ?? 'operator' };
  return mutate(ctx, runId, (run, emit) => {
    const t = run.tasks[taskId]; if (!t) throw new Refusal('NO_TASK', `no task ${taskId}`, { taskId });
    if (t.status !== 'RUNNING') throw new Refusal('NOT_RUNNING', `${taskId} is ${t.status}`, { taskId });
    if (!/^P[2-4]$/.test(o.tier ?? '') || !o.reason) throw new Refusal('APPROVAL', 'a tier (P2 to P4) and a reason are required', { taskId });
    t.attempts -= 1; t.attemptLog.pop(); t.lease = null;
    t.approval = { required: true, tier: o.tier, reason: o.reason, applied: null };
    move(ctx, run, taskId, 'AWAITING_APPROVAL', emit, o.reason, { action: 'await-approval', detail: { tier: o.tier, attemptRefunded: true } });
  });
}

function requestApproval(ctx, runId, taskId, o = {}) {
  const run = loadRun(ctx, runId); const t = run.tasks[taskId];
  if (!t) throw new EngineError('NO_TASK', `no task ${taskId}`);
  const tier = o.tier ?? t.approval.tier;
  const lim = ctx.model.perm.approvals.limits[tier];
  if (!lim) throw new EngineError('APPROVAL', 'tier must be P2, P3 or P4');
  const now = ctx.now(); const minutes = Math.min(o.minutes ?? lim.maxLifetimeMinutes, lim.maxLifetimeMinutes);
  return { schema: ctx.policy.approval.schema, id: `TA-${crypto.randomBytes(6).toString('hex')}`, runId, taskId, planHash: run.planHash, tier, decision: o.decision ?? 'approve', reason: o.reason ?? '', issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + minutes * 60000).toISOString(), nonce: crypto.randomBytes(16).toString('hex'), signatures: [] };
}

function verifyTaskApproval(ctx, run, taskId, rec) {
  const no = (m) => ({ ok: false, reason: m });
  const t = run.tasks[taskId];
  if (!rec || rec.schema !== ctx.policy.approval.schema) return no('wrong or missing schema');
  if (rec.runId !== run.runId || rec.taskId !== taskId) return no('the approval names a different run or task');
  if (rec.planHash !== run.planHash) return no('the approval is bound to a different plan');
  if (!['approve', 'reject'].includes(rec.decision)) return no('decision must be approve or reject');
  if (!/^P[2-4]$/.test(rec.tier ?? '')) return no('tier must be P2, P3 or P4');
  if (t.approval.tier && Number(rec.tier[1]) < Number(t.approval.tier[1])) return no(`the task needs ${t.approval.tier} or higher`);
  const lim = ctx.model.perm.approvals.limits[rec.tier];
  const t0 = Date.parse(rec.issuedAt); const t1 = Date.parse(rec.expiresAt); const now = ctx.now().getTime();
  if (Number.isNaN(t0) || Number.isNaN(t1)) return no('issuedAt and expiresAt must be ISO times');
  if (now < t0) return no('not yet valid');
  if (now > t1) return no('expired');
  if ((t1 - t0) / 60000 > lim.maxLifetimeMinutes) return no(`lifetime exceeds the ${rec.tier} limit`);
  if (typeof rec.nonce !== 'string' || rec.nonce.length < 16 || typeof rec.id !== 'string' || !rec.id) return no('id and a nonce of at least 16 characters are required');
  if (run.approvalsUsed.includes(rec.id)) return no('this approval was already used');
  const payload = Buffer.from(canonical({ ...rec, signatures: undefined }));
  const good = new Set();
  for (const s of Array.isArray(rec.signatures) ? rec.signatures : []) {
    const key = ctx.model.approvers.find((k) => k.keyId === s.keyId);
    if (!key || key.revoked || !key.tiers?.includes(rec.tier)) continue;
    try { if (crypto.verify(null, payload, crypto.createPublicKey(key.publicKeyPem), Buffer.from(String(s.sig), 'base64'))) good.add(s.keyId); } catch { /* an invalid signature counts as absent */ }
  }
  if (good.size < lim.minApprovers) return no(`needs ${lim.minApprovers} valid signature(s) from distinct registered approvers with the ${rec.tier} capability; found ${good.size}`);
  return { ok: true, signers: [...good] };
}

function applyApproval(ctx0, runId, taskId, rec, o = {}) {
  const ctx = { ...ctx0, actor: o.actor ?? 'operator' };
  return mutate(ctx, runId, (run, emit, dir) => {
    const t = run.tasks[taskId]; if (!t) throw new Refusal('NO_TASK', `no task ${taskId}`, { taskId });
    if (t.status !== 'AWAITING_APPROVAL') throw new Refusal('NOT_AWAITING', `${taskId} is ${t.status}, not AWAITING_APPROVAL`, { taskId });
    const v = verifyTaskApproval(ctx, run, taskId, rec);
    if (!v.ok) throw new Refusal('APPROVAL_INVALID', v.reason, { taskId });
    run.approvalsUsed.push(rec.id);
    fs.mkdirSync(path.join(dir, 'approvals'), { recursive: true });
    atomicWrite(path.join(dir, 'approvals', `${rec.id}.json`), `${JSON.stringify(rec, null, 2)}\n`);
    if (rec.decision === 'reject') { t.lease = null; move(ctx, run, taskId, 'CANCELLED', emit, `rejected by ${v.signers.join(', ')}: ${rec.reason}`, { action: 'reject', detail: { approval: rec.id } }); return { decision: 'reject', signers: v.signers }; }
    t.approval.applied = { id: rec.id, tier: rec.tier, signers: v.signers, at: iso(ctx) };
    move(ctx, run, taskId, 'READY', emit, `approved by ${v.signers.length} registered approver(s)`, { action: 'approve', detail: { approval: rec.id, tier: rec.tier } });
    return { decision: 'approve', signers: v.signers };
  });
}

function reopen(ctx0, runId, taskId, o = {}) {
  const ctx = { ...ctx0, actor: o.actor ?? 'operator' };
  return mutate(ctx, runId, (run, emit) => {
    const refuse = (c, m) => { throw new Refusal(c, m, { taskId }); };
    const t = run.tasks[taskId]; if (!t) refuse('NO_TASK', `no task ${taskId}`);
    const pt = planTask(run, taskId);
    if (['STOPPED', 'CANCELLED'].includes(run.state)) refuse('RUN_NOT_ACTIVE', `run is ${run.state}`);
    if (t.status !== 'COMPLETED') refuse('NOT_COMPLETED', `${taskId} is ${t.status}`);
    if (!o.reason) refuse('REASON', 'a reason (for example the blocking review verdict) is required');
    if (t.reopens >= ctx.policy.limits.maxReopensPerTask) refuse('REOPEN_LIMIT', `${taskId} was already reopened ${t.reopens} time(s); the limit is ${ctx.policy.limits.maxReopensPerTask}`);
    if (t.attempts >= pt.maxAttempts) refuse('ATTEMPTS_EXHAUSTED', `${taskId} has no attempts left`);
    const down = new Set(); const walk = (id) => { for (const p of run.plan.tasks) if (p.dependsOn.includes(id) && !down.has(p.id)) { down.add(p.id); walk(p.id); } };
    walk(taskId);
    for (const d of down) if (['RUNNING', 'VALIDATING'].includes(run.tasks[d].status)) refuse('DEPENDENT_ACTIVE', `dependent ${d} is ${run.tasks[d].status}; wait for it`);
    t.reopens += 1; t.verdict = null;
    move(ctx, run, taskId, 'READY', emit, o.reason, { action: 'reopen', detail: { reopens: t.reopens } });
    for (const d of down) {
      const dt = run.tasks[d];
      if (['CANCELLED', 'PENDING'].includes(dt.status)) continue;
      // Keep what the invalidated generation produced, so history can still be reconstructed and its files stay verifiable.
      dt.archive = [...(dt.archive ?? []), { reason: `invalidated by the reopen of ${taskId}`, at: iso(ctx), attempts: dt.attempts, verdict: dt.verdict, artifacts: dt.artifacts, evidence: dt.evidence, acceptance: dt.acceptance }];
      dt.artifacts = []; dt.evidence = [];
      dt.attempts = 0; dt.attemptLog = dt.attemptLog.map((a) => ({ ...a, superseded: true })); dt.verdict = null; dt.acceptance = null; dt.feedback = []; dt.terminal = false; dt.lastError = null; dt.classCounts = {}; dt.retryAfter = null; dt.lease = null; dt.approval.applied = null;
      move(ctx, run, d, 'PENDING', emit, `invalidated by the reopen of ${taskId}`, { action: 'invalidate' });
    }
  });
}

function resume(ctx0, runId, o = {}) {
  const ctx = { ...ctx0, actor: o.actor ?? 'operator' };
  return mutate(ctx, runId, (run, emit, dir) => {
    const now = ctx.now();
    const swept = []; const drifted = [];
    for (const [id, t] of Object.entries(run.tasks)) {
      if (t.status === 'RUNNING' && t.lease && new Date(t.lease.expiresAt) <= now) {
        emit({ taskId: id, action: 'lease-expired', reason: `attempt ${t.lease.attempt} started ${t.lease.startedAt} did not report before ${t.lease.expiresAt}` });
        applyFailure(ctx, run, id, emit, { errorClass: 'INTERRUPTED', message: 'lease expired: the attempt did not report (crash, closed session or stalled delegate)' });
        swept.push(id);
      }
    }
    for (const [id, t] of Object.entries(run.tasks)) {
      if (t.status !== 'COMPLETED') continue;
      const bad = [];
      for (const a of t.artifacts.filter((x) => x.attempt === t.attempts)) {
        const full = a.kind === 'result' ? path.join(dir, a.path) : path.join(ctx.root, a.path);
        const present = fs.existsSync(full);
        if (!present || !sameSha(full, a.sha256)) bad.push(`${a.path}: ${present ? 'changed since it was accepted' : 'missing'}`);
      }
      if (bad.length) { t.drift = bad; drifted.push(id); move(ctx, run, id, 'VALIDATING', emit, `artifact drift: ${bad.join('; ')}`, { action: 'drift', detail: { files: bad } }); }
    }
    emit({ action: 'resume', reason: `resumed at revision ${run.rev}`, detail: { leasesExpired: swept.join(',') || 'none', drift: drifted.join(',') || 'none' } });
    return { leasesExpired: swept, drift: drifted };
  });
}

function checkpoint(ctx0, runId, o = {}) {
  const ctx = { ...ctx0, actor: o.actor ?? 'operator' };
  mutate(ctx, runId, (run, emit) => { emit({ action: 'checkpoint', reason: o.label ?? 'manual checkpoint' }); });
  const dir = runDir(ctx, runId);
  const n = checkpointCount(dir) - 1;
  const cp = JSON.parse(fs.readFileSync(path.join(dir, 'checkpoints', `CP-${n}.json`), 'utf8'));
  return { n, rev: cp.rev, eventHead: cp.eventHead };
}

// ---------------------------------------------------------------- views
function summarize(run) {
  return {
    runId: run.runId, state: run.state, rev: run.rev, planHash: run.planHash, title: run.plan.title, attention: run.attention,
    tasks: run.plan.tasks.map((p) => { const t = run.tasks[p.id]; return { id: p.id, title: p.title, agent: p.agent, executor: p.executor, status: t.status, attempts: t.attempts, maxAttempts: p.maxAttempts, dependsOn: p.dependsOn, verdict: t.verdict, retryAfter: t.retryAfter, blockedReason: t.blockedReason, lastError: t.lastError, terminal: t.terminal, feedback: t.feedback, approval: t.approval.required ? { tier: t.approval.tier, applied: Boolean(t.approval.applied) } : null, artifacts: t.artifacts.filter((a) => a.attempt === t.attempts).map((a) => a.path) }; }),
  };
}

function nextActions(ctx, run) {
  const s = summarize(run);
  const by = (st) => s.tasks.filter((t) => t.status === st);
  const rank = (t) => run.topoOrder.indexOf(t.id);
  const ready = by('READY').sort((a, b) => rank(a) - rank(b));
  const expired = by('RUNNING').filter((t) => run.tasks[t.id].lease && new Date(run.tasks[t.id].lease.expiresAt) <= ctx.now());
  const retryable = by('FAILED').filter((t) => !t.terminal);
  const escalated = by('FAILED').filter((t) => t.terminal);
  const validating = by('VALIDATING');
  let rec;
  if (run.state === 'STOPPED') rec = { action: 'stop', why: 'the run is frozen for human review', tasks: escalated.map((t) => t.id) };
  else if (run.state === 'COMPLETED') rec = { action: 'complete', why: 'every task is COMPLETED with its acceptance tests passed and no blocking review verdict', tasks: [] };
  else if (run.state === 'CANCELLED') rec = { action: 'stop', why: 'the run was cancelled', tasks: [] };
  else if (run.state === 'CLOSED') rec = { action: 'stop', why: 'a human closed the run', tasks: [] };
  else if (expired.length) rec = { action: 'resume', why: 'an attempt exceeded its lease without reporting', tasks: expired.map((t) => t.id) };
  else if (validating.length) rec = { action: 'validate', why: 'a result is waiting for its command checks (tasks.mjs validate)', tasks: validating.map((t) => t.id) };
  else if (ready.length) rec = { action: 'delegate', why: 'these tasks have every dependency complete; delegate them in this order', tasks: ready.map((t) => t.id) };
  else if (retryable.length) rec = { action: 'retry', why: 'a retryable failure with attempts left; the retry prompt must change and carry the feedback', tasks: retryable.map((t) => t.id) };
  else if (by('AWAITING_APPROVAL').length) rec = { action: 'wait-for-approval', why: 'a human must sign the approval; nothing else can proceed', tasks: by('AWAITING_APPROVAL').map((t) => t.id) };
  else if (by('RUNNING').length) rec = { action: 'wait', why: 'an attempt is running within its lease. If no delegate is actually working (for example the tool rejected the call), a human can run tasks.mjs release', tasks: by('RUNNING').map((t) => t.id) };
  else rec = { action: 'escalate', why: run.attention[0] ?? 'no task can proceed', tasks: [...escalated, ...by('BLOCKED')].map((t) => t.id) };
  return { runId: run.runId, state: run.state, recommendation: rec, ready: ready.map((t) => ({ id: t.id, agent: t.agent, executor: t.executor, attempt: t.attempts + 1, of: t.maxAttempts, marker: `${ctx.policy.delegation.marker} ${run.runId}/${t.id}`, feedback: t.feedback, retryAfter: t.retryAfter })), retryable: retryable.map((t) => ({ id: t.id, errorClass: t.lastError?.class, retryAfter: t.retryAfter, feedback: t.feedback })), escalated: escalated.map((t) => ({ id: t.id, errorClass: t.lastError?.class, message: t.lastError?.message })), attention: run.attention };
}

function listRuns(ctx) {
  if (!fs.existsSync(ctx.runsDir)) return [];
  return fs.readdirSync(ctx.runsDir).filter((d) => /^RUN-[0-9a-f]{10}$/.test(d) && fs.existsSync(path.join(ctx.runsDir, d, 'run.json'))).sort().map((d) => { const r = JSON.parse(fs.readFileSync(path.join(ctx.runsDir, d, 'run.json'), 'utf8')); return { runId: d, state: r.state, title: r.plan.title, createdAt: r.createdAt }; });
}

function verifyRun(ctx, runId) {
  const dir = runDir(ctx, runId);
  const problems = [];
  let run;
  try { run = loadRun(ctx, runId); } catch (e) { return { ok: false, problems: e.detail ?? [e.message] }; }
  if (sha256(canonical(run.plan)) !== run.planHash) problems.push('the embedded plan does not match planHash');
  const events = readEvents(dir);
  const cpDir = path.join(dir, 'checkpoints');
  if (fs.existsSync(cpDir)) for (const f of fs.readdirSync(cpDir).filter((x) => /^CP-\d+\.json$/.test(x)).sort()) {
    const cp = JSON.parse(fs.readFileSync(path.join(cpDir, f), 'utf8'));
    const ev = events.find((e) => e.seq === cp.eventSeq);
    if (cp.eventSeq && (!ev || ev.hash !== cp.eventHead)) problems.push(`${f}: its event head is not in the log (history was rewritten)`);
    if (cp.rev > run.rev) problems.push(`${f}: the run is older than this checkpoint (rolled back)`);
  }
  for (const [id, t] of Object.entries(run.tasks)) {
    if (t.status === 'COMPLETED') {
      // Accepted file artifacts and command evidence must still match what was recorded when the task was accepted.
      for (const a of t.artifacts.filter((x) => x.kind === 'file' && x.attempt === t.attempts)) {
        const f = path.join(ctx.root, a.path);
        if (!fs.existsSync(f)) problems.push(`${id}: accepted file ${a.path} is missing`);
        else if (!sameSha(f, a.sha256)) problems.push(`${id}: accepted file ${a.path} no longer matches the hash recorded when it was accepted`);
      }
      for (const e of t.evidence.filter((x) => x.type === 'command')) {
        const f = path.join(dir, e.ref);
        if (!fs.existsSync(f)) problems.push(`${id}: command evidence ${e.ref} is missing`);
        else if (!sameSha(f, e.sha256)) problems.push(`${id}: command evidence ${e.ref} was altered`);
      }
    }
    for (const a of t.artifacts.filter((x) => x.kind === 'result' && x.attempt === t.attempts && t.status === 'COMPLETED')) {
      const f = path.join(dir, a.path);
      if (!fs.existsSync(f)) problems.push(`${id}: captured result ${a.path} is missing`);
      else if (!sameSha(f, a.sha256)) problems.push(`${id}: captured result ${a.path} was altered`);
    }
    // Earlier generations of a reopened task are history: their captured replies must still be there, unchanged.
    for (const g of t.archive ?? []) for (const a of g.artifacts.filter((x) => x.kind === 'result')) {
      const f = path.join(dir, a.path);
      if (!fs.existsSync(f)) problems.push(`${id}: archived result ${a.path} is missing`);
      else if (!sameSha(f, a.sha256)) problems.push(`${id}: archived result ${a.path} was altered`);
    }
  }
  return { ok: problems.length === 0, problems, events: events.length, checkpoints: checkpointCount(dir), rev: run.rev };
}

const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\r?\n/g, ' ').trim();
function renderTrace(ctx, runId) {
  const run = loadRun(ctx, runId); const dir = runDir(ctx, runId);
  const events = readEvents(dir); const v = verifyRun(ctx, runId);
  const L = [`# Execution trace: ${run.runId}`, '', 'Generated from `events.jsonl` by `tasks.mjs trace`. Do not edit by hand; the event log is the source.', '',
    `- Plan: ${cell(run.plan.title)} (plan hash \`${run.planHash.slice(0, 16)}\`)`, `- Run state: **${run.state}** at revision ${run.rev}`, `- Events: ${events.length}; hash chain ${v.ok ? 'intact' : `PROBLEMS: ${cell(v.problems.join('; '))}`}`, `- Checkpoints: ${v.checkpoints ?? 0}`, '',
    '| Seq | Time (UTC) | Actor | Task | Action | Transition | Detail |', '|---|---|---|---|---|---|---|'];
  for (const e of events) {
    const extra = e.detail ? Object.entries(e.detail).filter(([, x]) => x !== null && x !== undefined && typeof x !== 'object').map(([k, x]) => `${k}=${String(x).slice(0, 18)}`).join(' ') : '';
    L.push(`| ${e.seq} | ${e.ts.replace('T', ' ').slice(0, 19)} | ${cell(e.actor)} | ${e.taskId ?? ''} | ${e.action} | ${e.from && e.to ? `${e.from} to ${e.to}` : (e.to ?? '')} | ${cell([e.reason, extra].filter(Boolean).join(' ').slice(0, 220))} |`);
  }
  L.push('', '## Final task states', '', '| Task | Agent | Status | Attempts | Verdict |', '|---|---|---|---|---|');
  for (const p of run.plan.tasks) { const t = run.tasks[p.id]; L.push(`| ${p.id} | ${p.agent}${p.executor === 'orchestrator' ? ' (orchestrator itself)' : ''} | ${t.status} | ${t.attempts} of ${p.maxAttempts} | ${t.verdict ?? ''} |`); }
  if (run.attention.length) L.push('', '## Needs a human', '', ...run.attention.map((a) => `- ${cell(a)}`));
  L.push('', `Last event hash: \`${run.eventHead}\``, '');
  return L.join('\n');
}

function renderReport(ctx, runId) {
  const run = loadRun(ctx, runId);
  const L = [`# Run report: ${run.runId}`, '', 'Deterministic facts from the run store. Model-written content is in the captured results and artifacts, which are untrusted observations.', '',
    `- Title: ${cell(run.plan.title)}`, `- State: **${run.state}**`, `- Request: ${cell(run.plan.request)}`, `- Requirements in scope: ${run.plan.requirements.join(', ')}`, `- Constraints in scope: ${(run.plan.constraints ?? []).join(', ') || 'none listed'}`, '',
    '## Tasks', '', '| Task | Agent | Status | Attempts | Verdict | Acceptance | Artifacts |', '|---|---|---|---|---|---|---|'];
  for (const p of run.plan.tasks) {
    const t = run.tasks[p.id]; const r = t.acceptance?.results ?? [];
    L.push(`| ${p.id} ${cell(p.title)} | ${p.agent} | ${t.status} | ${t.attempts} of ${p.maxAttempts} | ${t.verdict ?? ''} | ${r.filter((x) => x.ok).length} of ${r.length} passed | ${t.artifacts.filter((a) => a.attempt === t.attempts).map((a) => `\`${a.path}\``).join(', ')} |`);
  }
  L.push('', '## Evidence', '', '| Task | Type | Reference | SHA-256 |', '|---|---|---|---|');
  for (const p of run.plan.tasks) for (const e of run.tasks[p.id].evidence) L.push(`| ${p.id} | ${e.type} | \`${cell(e.ref)}\` | \`${e.sha256.slice(0, 16)}\` |`);
  L.push('', '## Risks recorded in the plan', '', ...run.plan.risks.map((r) => `- ${r.id}: ${cell(r.text)} Mitigation: ${cell(r.mitigation)}`));
  L.push('', '## Open items for a human', '', ...(run.attention.length ? run.attention.map((a) => `- ${cell(a)}`) : ['- none recorded by the engine']), '');
  return L.join('\n');
}

// ---------------------------------------------------------------- delegation hooks (called by harness/hooks/delegation-guard.cjs)
function parseMarker(prompt, ctx) {
  const m = new RegExp(ctx.policy.delegation.markerPattern).exec(String(prompt ?? ''));
  return m ? { runId: m[1], taskId: m[2] } : null;
}
const argsOf = (event) => { let a = event.toolArgs ?? event.tool_input ?? {}; if (typeof a === 'string') { try { a = JSON.parse(a); } catch { a = {}; } } return a; };

function delegationPre(ctx0, event) {
  const ctx = { ...ctx0, actor: 'hook:delegation-guard' };
  if (String(event.toolName ?? event.tool_name) !== 'task') return { decision: 'allow', tracked: false };
  const args = argsOf(event);
  const marker = parseMarker(args.prompt, ctx);
  if (!marker) {
    if (ctx.policy.delegation.denyUntrackedWhileRunActive) {
      // An open run is one that has not been concluded: still active, waiting for a human, or frozen. Only a human closes it.
      const open = listRuns(ctx).filter((r) => ['ACTIVE', 'NEEDS_HUMAN', 'STOPPED'].includes(r.state));
      if (open.length) return { decision: 'deny', rule: 'ORCH-01', reason: `[ORCH-01] run ${open[0].runId} is ${open[0].state}, so a delegation must name its task with '${ctx.policy.delegation.marker} ${open[0].runId}/<task id>' in the prompt. A human can finish, cancel or close the run (tasks.mjs close) to allow ad hoc delegation.` };
    }
    return { decision: 'allow', tracked: false };
  }
  try {
    // The tool rejects a call missing name, agent_type or prompt after this hook has run. Starting an attempt for such a call
    // would spend the task's attempt budget on work that cannot happen, so refuse it here, before anything is started.
    const bad = ['name', 'agent_type', 'prompt'].filter((k) => !(typeof (k === 'agent_type' ? (args.agent_type ?? args.agentType) : args[k]) === 'string' && String(k === 'agent_type' ? (args.agent_type ?? args.agentType) : args[k]).trim()));
    if (bad.length) return { decision: 'deny', rule: 'ORCH-ARGS', reason: `[ORCH ARGS] the delegation is malformed: ${bad.join(', ')} ${bad.length > 1 ? 'are' : 'is'} missing. No attempt was started; fix the call and delegate again.`, ...marker };
    const r = start(ctx, marker.runId, marker.taskId, { agent: args.agent_type ?? args.agentType, promptSha256: sha256(String(args.prompt)), mode: args.mode ?? 'sync', actor: ctx.actor });
    return { decision: 'allow', tracked: true, ...marker, attempt: r.attempt, idempotent: Boolean(r.idempotent) };
  } catch (e) {
    return { decision: 'deny', rule: `ORCH-${e.code ?? 'ERR'}`, reason: `[ORCH ${e.code ?? 'ERROR'}] ${e.message}`, ...marker };
  }
}

function delegationPost(ctx0, event) {
  const ctx = { ...ctx0, actor: 'hook:delegation-guard' };
  if (String(event.toolName ?? event.tool_name) !== 'task') return { recorded: false };
  const args = argsOf(event);
  const marker = parseMarker(args.prompt, ctx);
  if (!marker) return { recorded: false };
  const res = event.toolResult ?? event.tool_result ?? {};
  const text = String(res.textResultForLlm ?? res.text ?? '');
  try {
    const run = loadRun(ctx, marker.runId); const t = run.tasks[marker.taskId];
    if (!t || t.status !== 'RUNNING' || t.lease?.promptSha256 !== sha256(String(args.prompt))) return { recorded: false, reason: 'no matching RUNNING attempt' };
    if (res.resultType && res.resultType !== 'success') {
      const r = fail(ctx, marker.runId, marker.taskId, { message: text || `delegate returned ${res.resultType}`, actor: ctx.actor });
      return { recorded: true, outcome: 'failed', ...marker, errorClass: r.errorClass };
    }
    const r = submit(ctx, marker.runId, marker.taskId, { resultText: text, actor: ctx.actor, source: `hook: ${args.agent_type ?? args.agentType} reply` });
    return { recorded: true, outcome: r.outcome, ...marker };
  } catch (e) { return { recorded: false, error: `${e.code ?? 'ERROR'}: ${e.message}` }; }
}

// Read-only views for the MCP server: nothing here writes, spawns a process or uses the network.
function checkPlanView(planText, ctx) {
  const v = validatePlan(planText, ctx);
  return { ok: v.ok, errorCount: v.errors.length, errors: v.errors.slice(0, 40), warnings: v.warnings.slice(0, 20), order: v.order ?? [], levels: v.levels ?? [], criticalPath: v.criticalPath ?? [], needsApproval: v.needsApproval ?? [], planHash: v.planHash ?? null, note: v.ok ? 'The plan is valid. Nothing was created: a human runs `node harness/scripts/tasks.mjs init` to create the run.' : 'Fix every error and check again. Do not present an invalid plan as ready.' };
}
function runStatusView(ctx, runId) {
  if (!runId) { const runs = listRuns(ctx); return { runs, hint: runs.length ? 'Pass runId for the status of one run.' : 'No run exists yet.' }; }
  const run = loadRun(ctx, runId, { readOnly: true });
  const dir = runDir(ctx, runId);
  const recent = readEvents(dir).slice(-8).map((e) => ({ seq: e.seq, ts: e.ts, actor: e.actor, task: e.taskId, action: e.action, from: e.from, to: e.to, reason: String(e.reason ?? '').slice(0, 200) }));
  return { ...summarize(run), next: nextActions(ctx, run), recentEvents: recent, integrity: verifyRunReadOnly(ctx, runId) };
}
function verifyRunReadOnly(ctx, runId) {
  try { loadRun(ctx, runId, { readOnly: true }); return { ok: true }; } catch (e) { return { ok: false, problems: e.detail ?? [e.message] }; }
}

module.exports = {
  ROOT, EngineError, Refusal, makeContext, knownIds, validatePlan, normalizePlan, checkTaskPermissions, initRun, loadRun, verifyRun, listRuns, runDir, runIdFor,
  start, submit, validateTask, fail, retry, block, unblock, cancelTask, cancelRun, pauseForApproval, release, closeRun, requestApproval, verifyTaskApproval, applyApproval, reopen, resume, checkpoint,
  summarize, nextActions, classifyError, renderTrace, renderReport, delegationPre, delegationPost, parseMarker, sha256, canonical, readEvents, chainProblems, checkPlanView, runStatusView,
};
