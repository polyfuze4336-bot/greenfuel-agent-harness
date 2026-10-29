'use strict';
// Bounded Plan -> Execute -> Verify -> Critique -> Repair loop for the coding harness. Zero dependencies.
//
// The loop is a passive, deterministic state machine plus the enforcement around it. It does not call a model and it does not do
// the work: an actor (a specialist agent, or the person's own session) edits files in a workspace between `begin` and `end`, and
// the loop decides, from facts it observes itself, what happens next. The properties that matter:
//   - Only the loop runs the declared checks. There is no way to mark work successful: PASSED is reachable only from a
//     verification the loop ran on the current files (and an independent approval, when the task requires one).
//   - Every file the actor changed is observed (a before/after manifest of the whole workspace, with no excluded folders), screened
//     by the same guards that screen tool calls, scanned for credentials and customer markers, and checked against protected
//     paths, so a test or an expected result cannot be edited to make a check pass. The manifest is taken again after the checks
//     ran: a check that changes files stops the loop.
//   - Failures are classified. Some stop the loop at once (permission, hard constraint, sensitive data, missing context, unsafe
//     action, tampering), some escalate to a person, the rest are repairable within a budget. Failures are fingerprinted, a
//     second identical failure escalates, and a repair after a failed repair needs a written diagnosis with a different approach.
//   - Everything is kept: each check run (output tail, hash), before and after copies of changed files, diagnoses, critiques,
//     and a hash-chained event log. Nothing is rolled back automatically and nothing is overwritten.
// Limits (docs/loop/LOOP.md): the actions an actor reports (reads, commands) are self-reported; the observed file changes and the
// denial log are not. The loop screens, it does not sandbox: a check runs workspace code with the operator's rights, and code
// under test that deliberately subverts the test runner it is loaded into cannot be ruled out here. Independent review and a
// sandbox are the remaining controls for adversarial code.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const perm = require('../hooks/permission-engine.cjs');
const agentGuard = require('../hooks/agent-guard.cjs');
const { scrub: scrubPaths } = require('../lib/local-paths.cjs');
const policyGuard = require('../hooks/policy-guard.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const { canonical, sha256 } = perm;
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

class LoopError extends Error { constructor(code, message, detail) { super(message); this.code = code; this.detail = detail; } }
// A refusal is an expected "no". It changes nothing except, where noted, an event that records the refusal itself.
class Refusal extends LoopError {}

function makeContext(opts = {}) {
  const root = opts.root ?? ROOT;
  const policy = opts.policy ?? readJson(path.join(root, 'harness/policy/loop-policy.json'));
  const toolchainRoot = process.env[policy.toolchains.tsc.dirEnvironment];
  return {
    root, policy,
    agentPolicy: opts.agentPolicy ?? readJson(path.join(root, 'harness/policy/agent-policy.json')),
    model: opts.model ?? perm.loadModel(root),
    registry: opts.registry ?? readJson(path.join(root, 'harness/tools/tool-registry.json')),
    phase: opts.phase ?? readJson(path.join(root, 'harness/policy/command-policy.json')).phase ?? 0,
    now: opts.now ?? (() => new Date()),
    loopsDir: path.resolve(opts.loopsDir ?? process.env.HARNESS_LOOPS_DIR ?? path.join(root, policy.loopsDir)),
    logDir: opts.logDir ?? process.env.HARNESS_LOG_DIR ?? undefined,
    toolchainDir: path.resolve(opts.toolchainDir ?? toolchainRoot ?? path.join(root, policy.toolchains.tsc.defaultDir)),
    actor: opts.actor ?? 'operator',
  };
}
const iso = (ctx) => ctx.now().toISOString();
const globToRe = agentGuard.globToRe;
const ID_RE = /^LOOP-[0-9a-f]{10}$/;
const loopDir = (ctx, id) => { if (!ID_RE.test(id ?? '')) throw new LoopError('BAD_ID', `bad loop id '${id}'`); return path.join(ctx.loopsDir, id); };

// ---------------------------------------------------------------- storage: lock, atomic write, hash-chained events
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function withLock(dir, fn) {
  const lock = path.join(dir, '.lock'); const deadline = Date.now() + 10000;
  for (;;) {
    try { fs.mkdirSync(lock); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 20 * 60000) { fs.rmdirSync(lock); continue; } } catch { /* released meanwhile */ }
      if (Date.now() > deadline) throw new LoopError('LOCK', 'the loop is locked by another process (a verification may be running)');
      sleep(25);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(lock); } catch { /* gone */ } }
}
function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text);
  for (let i = 0; ; i += 1) { try { fs.renameSync(tmp, file); return; } catch (e) { if (i >= 4) { try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ } throw e; } sleep(40); } }
}
const writeJson = (file, obj) => { const body = `${JSON.stringify(obj, null, 2)}\n`; atomicWrite(file, body); return sha256(body); };
const eventsFile = (dir) => path.join(dir, 'events.jsonl');
function readEvents(dir) {
  if (!fs.existsSync(eventsFile(dir))) return [];
  return fs.readFileSync(eventsFile(dir), 'utf8').split('\n').filter(Boolean).map((l, i) => { try { return JSON.parse(l); } catch { throw new LoopError('EVENTS', `event ${i + 1} is not valid JSON`); } });
}
const eventHash = (e) => sha256(canonical({ ...e, hash: undefined }));

function loadLoop(ctx, id) {
  const dir = loopDir(ctx, id); const file = path.join(dir, 'loop.json');
  if (!fs.existsSync(file)) throw new LoopError('NOT_FOUND', `no loop ${id}`);
  const loop = readJson(file);
  const last = readEvents(dir).at(-1);
  if ((last?.seq ?? 0) !== loop.eventSeq || (last?.hash ?? null) !== loop.eventHead) throw new LoopError('INCONSISTENT', `loop ${id}: loop.json and the event log disagree (an interrupted write or an edit); inspect with verify-store before continuing`);
  return loop;
}
// Runs fn(loop, emit, dir) under the loop's lock. Events are appended as they are emitted and loop.json is saved at the end. A
// refusal that emitted an event (a rejected diagnosis) still saves, so the log and loop.json never disagree.
function mutate(ctx, id, fn) {
  const dir = loopDir(ctx, id);
  if (!fs.existsSync(path.join(dir, 'loop.json'))) throw new LoopError('NOT_FOUND', `no loop ${id}`);
  return withLock(dir, () => {
    const loop = loadLoop(ctx, id);
    const startSeq = loop.eventSeq;
    const emit = (action, data = {}) => {
      const e = { seq: loop.eventSeq + 1, ts: iso(ctx), actor: ctx.actor, action, ...data, prevHash: loop.eventHead };
      e.hash = eventHash(e);
      fs.appendFileSync(eventsFile(dir), `${JSON.stringify(e)}\n`);
      loop.eventSeq = e.seq; loop.eventHead = e.hash;
      return e;
    };
    const save = () => { loop.rev += 1; loop.updatedAt = iso(ctx); writeJson(path.join(dir, 'loop.json'), loop); };
    let result;
    try { result = fn(loop, emit, dir); } catch (e) { if (e instanceof Refusal && loop.eventSeq !== startSeq) save(); throw e; }
    save();
    return result;
  });
}

// ---------------------------------------------------------------- redaction, normalisation, fingerprints
function redact(text) {
  let o = String(text);
  try { for (const p of readJson(path.join(ROOT, 'harness/policy/secret-patterns.json')).redaction) o = o.replace(new RegExp(p, 'gi'), '[REDACTED]'); } catch { /* keep going */ }
  return scrubPaths(o);
}
// Removes what changes between identical runs (times, line numbers, paths, hashes) so the same failure has the same fingerprint.
function normalise(text, ws, root) {
  let s = String(text).replace(/\u001b\[[0-9;]*m/g, '').replace(/\r/g, '');
  for (const p of [ws, root]) { if (p) { s = s.split(p).join('<dir>'); s = s.split(p.replace(/\\/g, '/')).join('<dir>'); } }
  return s.replace(/\b\d{4}-\d\d-\d\dT[\d:.]+Z?/g, '<ts>').replace(/duration_ms[:=]?\s*[\d.]+/g, 'duration_ms <n>').replace(/\(\d+(\.\d+)?\s?ms\)/g, '(<n>ms)').replace(/\b\d+(\.\d+)?\s?ms\b/g, '<n>ms')
    .replace(/:\d+:\d+/g, ':<l>:<c>').replace(/\(\d+,\d+\)/g, '(<l>,<c>)').replace(/\b[0-9a-f]{10,}\b/g, '<hex>').slice(-8000);
}

// ---------------------------------------------------------------- task contract
const SLUG = /^[a-z][a-z0-9-]{1,30}$/;
const REQ = /^(FR|BR|SEC|DATA|AGT|NFR)-\d{3}$/;
const HC = /^HC-\d{2}$/;
const safeRel = (p) => typeof p === 'string' && p.length > 0 && p.length <= 200 && /^[A-Za-z0-9_./-]+$/.test(p) && !p.startsWith('/') && !p.split('/').some((s) => s === '..' || s === '');
const safeGlob = (g) => typeof g === 'string' && g.length > 0 && g.length <= 120 && /^[A-Za-z0-9_./*-]+$/.test(g) && !g.split('/').includes('..') && !g.startsWith('/');
const TIGHTEN = ['maxRepairAttempts', 'maxIdenticalFailures', 'timeoutSeconds', 'wallBudgetSeconds', 'maxCheckRuns'];

const workspaceAbs = (ctx, rel) => path.resolve(ctx.root, rel);
function insideWorkDir(ctx, abs) {
  const r = path.relative(path.resolve(ctx.root, ctx.policy.workDir), abs);
  return r !== '' && !r.startsWith('..') && !path.isAbsolute(r);
}
function commandProblems(ctx, argv) {
  if (!Array.isArray(argv) || !argv.length || argv.some((a) => typeof a !== 'string' || !a || a.length > 200)) return 'argv must be a list of short strings';
  const line = argv.join(' ');
  if (!ctx.policy.commandAllowList.some((p) => new RegExp(p).test(line))) return `'${line.slice(0, 80)}' is not on the command allow-list`;
  if (argv.slice(1).some((a) => !a.startsWith('-') && /^[A-Za-z0-9_./-]+$/.test(a) && (a.split('/').includes('..') || a.startsWith('/')))) return 'a path argument must be relative with no ..';
  return null;
}

function validateTask(ctx, task, wsRel) {
  const errors = []; const bad = (m) => errors.push(m); const L = ctx.policy.limits;
  if (!task || typeof task !== 'object' || Array.isArray(task)) return ['the task must be an object'];
  if (task.schema !== 'greenfuel.loop-task/v1') bad('schema must be greenfuel.loop-task/v1');
  for (const k of ['title', 'objective']) if (typeof task[k] !== 'string' || !task[k].trim() || task[k].length > L.textMax) bad(`${k} is required (at most ${L.textMax} characters)`);
  if (!Array.isArray(task.acceptance) || !task.acceptance.length || task.acceptance.some((a) => typeof a !== 'string' || !a.trim() || a.length > L.textMax)) bad('acceptance criteria are required: a loop begins with a defined task and the criteria that make it done');
  if (task.agent !== 'session' && !ctx.agentPolicy.agents[task.agent]) bad(`agent must be 'session' or one of the agents in agent-policy.json`);
  if (!Array.isArray(task.requirements) || task.requirements.some((r) => !REQ.test(r))) bad('requirements must be a list of requirement ids');
  if (!Array.isArray(task.constraints) || task.constraints.some((r) => !HC.test(r))) bad('constraints must be a list of hard-constraint ids such as HC-01');
  if (!Array.isArray(task.checks) || !task.checks.length || task.checks.length > L.maxChecks) bad(`checks must list 1 to ${L.maxChecks} checks`);
  else {
    const ids = new Set();
    for (const c of task.checks) {
      if (!c || typeof c !== 'object' || !SLUG.test(c.id ?? '') || ids.has(c.id)) { bad(`each check needs a unique id like 'api-contract'`); continue; }
      ids.add(c.id);
      if (!ctx.policy.checkKinds[c.kind]) bad(`${c.id}: kind must be one of ${Object.keys(ctx.policy.checkKinds).join(', ')}`);
      const cp = commandProblems(ctx, c.argv); if (cp) bad(`${c.id}: ${cp}`);
      if (c.cwd !== undefined && !['workspace', 'repo'].includes(c.cwd)) bad(`${c.id}: cwd must be workspace or repo`);
      if (c.timeoutSec !== undefined && !(Number.isInteger(c.timeoutSec) && c.timeoutSec >= 1 && c.timeoutSec <= L.timeoutSeconds)) bad(`${c.id}: timeoutSec must be 1 to ${L.timeoutSeconds}`);
      if (c.hardConstraint !== undefined && (!HC.test(c.hardConstraint) || !(task.constraints ?? []).includes(c.hardConstraint))) bad(`${c.id}: hardConstraint must be one of the task's constraints`);
      if (c.covers !== undefined && (!Array.isArray(c.covers) || !c.covers.every(safeGlob))) bad(`${c.id}: covers must be a list of simple globs`);
    }
  }
  for (const k of ['protectedPaths', 'allowedWritePaths']) if (task[k] !== undefined && (!Array.isArray(task[k]) || !task[k].every(safeGlob))) bad(`${k} must be a list of simple globs`);
  if (!Array.isArray(task.protectedPaths) || !task.protectedPaths.length) bad('protectedPaths is required: name the tests, fixtures and expected results a repair may not change');
  if (task.review !== undefined) {
    if (typeof task.review !== 'object' || typeof task.review.required !== 'boolean') bad('review must be {required: boolean, reviewer?: agent}');
    else if (task.review.reviewer !== undefined && (!ctx.policy.reviewerAgents.includes(task.review.reviewer) || task.review.reviewer === task.agent)) bad(`review.reviewer must be one of ${ctx.policy.reviewerAgents.join(', ')} and not the task's own agent`);
  }
  if (task.scope !== undefined && (typeof task.scope !== 'object' || Object.entries(task.scope).some(([k, v]) => !['shipowner', 'jurisdiction'].includes(k) || (v !== null && !/^[a-z0-9][a-z0-9-]{0,40}$/.test(v))))) bad('scope may hold shipowner and jurisdiction slugs only');
  if (task.limits !== undefined) {
    if (typeof task.limits !== 'object') bad('limits must be an object');
    else for (const [k, v] of Object.entries(task.limits)) { if (!TIGHTEN.includes(k)) bad(`limits.${k} cannot be set by a task`); else if (!Number.isInteger(v) || v < 1 || v > L[k]) bad(`limits.${k} may only tighten the policy (1 to ${L[k]})`); }
  }
  if (task.contextRefs !== undefined && (!Array.isArray(task.contextRefs) || task.contextRefs.some((r) => typeof r !== 'string' || !r.startsWith('file:') || !safeRel(r.slice(5))))) bad('contextRefs must be file: references inside the repository');
  if (!wsRel || !insideWorkDir(ctx, workspaceAbs(ctx, wsRel))) bad(`the workspace must be a folder under ${ctx.policy.workDir}/`);
  return errors;
}

// ---------------------------------------------------------------- workspace snapshots
function snapshot(ctx, abs) {
  const files = new Map(); const L = ctx.policy.limits; let bytes = 0;
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (ctx.policy.snapshotExcludes.includes(f.name)) continue;
      const p = path.join(d, f.name); const rel = path.relative(abs, p).split(path.sep).join('/');
      if (f.isSymbolicLink()) { files.set(rel, { sha: 'symlink', size: 0, link: true }); continue; }
      if (f.isDirectory()) { walk(p); continue; }
      const buf = fs.readFileSync(p); bytes += buf.length;
      if (files.size >= L.maxWorkspaceFiles || bytes > L.maxWorkspaceBytes) throw new Refusal('WORKSPACE_TOO_LARGE', `the workspace is larger than the loop keeps (${L.maxWorkspaceFiles} files, ${L.maxWorkspaceBytes} bytes)`);
      files.set(rel, { sha: sha256(buf), size: buf.length, big: buf.length > L.maxFileBytes });
    }
  };
  if (fs.existsSync(abs)) walk(abs);
  return { files, sha: sha256(canonical([...files.entries()].map(([k, v]) => [k, v.sha]))) };
}
function copyFiles(abs, files, rels, target) {
  for (const rel of rels) { const v = files.get(rel); if (!v || v.link || v.big) continue; const to = path.join(target, ...rel.split('/')); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(abs, ...rel.split('/')), to); }
}
function diff(before, after) {
  const out = [];
  for (const [rel, v] of after.files) { const b = before.files.get(rel); if (!b) out.push({ path: rel, change: 'added', afterSha: v.sha, link: v.link }); else if (b.sha !== v.sha) out.push({ path: rel, change: 'modified', beforeSha: b.sha, afterSha: v.sha, link: v.link || b.link }); }
  for (const [rel, b] of before.files) if (!after.files.has(rel)) out.push({ path: rel, change: 'deleted', beforeSha: b.sha, link: b.link });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
const matches = (globs, rel) => globs.some((g) => globToRe(g).test(rel));

// ---------------------------------------------------------------- screening of actions
function screenAction(ctx, task, tool, args) {
  const event = { toolName: tool, toolArgs: args, cwd: ctx.root };
  const scope = { shipowner: task.scope?.shipowner ?? null, jurisdiction: task.scope?.jurisdiction ?? null };
  let denied = null;
  try {
    if (task.agent === 'session') {
      const d = perm.decide({ agent: null, tool, args, cwd: ctx.root, phase: ctx.phase, model: ctx.model, registry: ctx.registry, scope, logDir: ctx.logDir, audit: false });
      if (d.decision === 'deny') { denied = { reason: `${d.reasons[0]} [${d.rules.join(', ')}]`, rules: d.rules }; perm.writeAudit(ctx.model, event, d, { agent: null, logDir: ctx.logDir, now: ctx.now() }); }
    } else {
      const v = agentGuard.evaluate(event, task.agent, ctx.agentPolicy, ctx.phase, ctx.registry, { model: ctx.model, scope, logDir: ctx.logDir, audit: true });
      if (v) denied = { reason: v.reason, rules: v.rules ?? ['AGENT-GUARD'] };
    }
  } catch (e) { denied = { reason: `screening failed (${e.message}); denying`, rules: ['SCREEN-ERROR'] }; }
  let ops = [];
  try { ops = perm.classify(tool, args, ctx.model, ctx.root, ctx.registry).ops.map((o) => o.op); } catch { /* unclassifiable: the guard already decided */ }
  return { denied, ops };
}
function denialsSince(ctx, agent, sinceIso) {
  if (agent === 'session') return [];
  const dir = ctx.logDir ? path.resolve(ctx.logDir) : path.join(ctx.root, '.harness-logs');
  const file = path.join(dir, path.basename(ctx.model.perm.audit.file));
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && r.agent === agent && r.ts >= sinceIso);
}
function sensitiveIn(ctx, text) {
  let pats = [];
  try { const sp = readJson(path.join(ROOT, 'harness/policy/secret-patterns.json')); pats = [...sp.repository, ...sp.redaction].map((p) => new RegExp(p, 'i')); } catch { /* the markers still apply */ }
  return pats.some((re) => re.test(text)) || ctx.policy.sensitiveContent.some((m) => text.includes(m));
}

// ---------------------------------------------------------------- state changes
function setState(ctx, loop, emit, to, reason) {
  if (!(ctx.policy.transitions[loop.state] ?? []).includes(to)) throw new LoopError('BAD_TRANSITION', `${loop.state} cannot move to ${to}`);
  const from = loop.state; loop.state = to;
  emit('state', { from, to, reason: String(reason).slice(0, 300) });
}
const REQUIRES = {
  HARD_CONSTRAINT_VIOLATION: 'An architecture decision is needed. Resolve the open decision or constraint conflict; the loop will not repair it, and it must not be worked around.',
  PERMISSION_VIOLATION: 'A person reviews the denied action and the changes kept in the attempt folder, and decides whether the task, the agent scope or the plan is wrong.',
  ACCESS_VIOLATION: 'A person reviews the isolation failure before any further work.',
  SENSITIVE_DATA: 'A person removes the sensitive content from the workspace and from any copy kept in this loop, and reviews how it got there.',
  MISSING_CONTEXT: 'A person restores the missing tool, file or context and starts a new loop.',
  UNSAFE_ACTION: 'A person reviews the action that may never occur inside a loop.',
  TEST_TAMPERING: 'A person reviews the change to a protected file. The loop did not accept it.',
  UNTRACKED_CHANGE: 'A person reviews files that changed outside an attempt.',
  POLICY_VIOLATION: 'A person decides whether this policy failure is repairable and under what authority.',
  NON_IDEMPOTENT_FAILURE: 'A person inspects what the non-idempotent operation changed before anything is retried.',
  REPEATED_FAILURE: 'A person reads the diagnosis and the preserved failures and decides on a different approach.',
  BUDGET_EXHAUSTED: 'A person decides whether to continue with a new loop and a new budget.',
  REVIEW_BLOCK: 'A person reads the reviewer findings and decides.',
};
function finish(ctx, loop, emit, to, cls, detail) {
  const open = loop.attempts.find((a) => a.status === 'OPEN');
  setState(ctx, loop, emit, to, `${cls}: ${String(detail).slice(0, 200)}`);
  loop.outcome = { state: to, class: cls, detail: String(detail).slice(0, 500), requires: REQUIRES[cls] ?? 'A person decides.' };
  emit('outcome', { state: to, class: cls });
  if (open) open.status = to;
}
const stop = (ctx, loop, emit, cls, detail) => finish(ctx, loop, emit, 'STOPPED', cls, detail);
const escalate = (ctx, loop, emit, cls, detail) => finish(ctx, loop, emit, 'ESCALATED', cls, detail);

// ---------------------------------------------------------------- init
function init(ctx, { task, workspace, createdBy = 'operator' }) {
  const wsRel = String(workspace ?? '').split(path.sep).join('/').replace(/^\.\//, '');
  const errors = validateTask(ctx, task, wsRel);
  if (errors.length) throw new Refusal('TASK_INVALID', `the task contract is not valid: ${errors.slice(0, 6).join('; ')}`, errors);
  const abs = workspaceAbs(ctx, wsRel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Refusal('NO_WORKSPACE', `workspace ${wsRel} does not exist`);
  const snap = snapshot(ctx, abs);
  if ([...snap.files.values()].some((f) => f.link)) throw new Refusal('SYMLINK', 'the workspace contains a symbolic link');
  const contextRefs = [];
  for (const r of task.contextRefs ?? []) {
    const p = path.join(ctx.root, r.slice(5));
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) throw new Refusal('MISSING_CONTEXT', `context file ${r} is missing`);
    contextRefs.push({ ref: r, sha256: sha256(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')) });
  }
  const limits = { ...Object.fromEntries(TIGHTEN.map((k) => [k, ctx.policy.limits[k]])), ...(task.limits ?? {}) };
  const id = `LOOP-${crypto.randomBytes(5).toString('hex')}`;
  const dir = loopDir(ctx, id);
  fs.mkdirSync(dir, { recursive: true });
  const loop = { schema: 'greenfuel.loop/v1', loopId: id, rev: 0, state: 'PLAN', createdAt: iso(ctx), updatedAt: iso(ctx), createdBy, task, taskSha256: sha256(canonical(task)), workspaceRel: wsRel, limits, contextRefs, attempts: [], failureHistory: [], diagnoses: [], critiques: [], checkRuns: 0, wallMs: 0, workspaceSha: snap.sha, verifiedSha: null, lastFailure: null, feedback: [], outcome: null, eventSeq: 0, eventHead: null };
  const e = { seq: 1, ts: iso(ctx), actor: ctx.actor, action: 'plan', taskSha256: loop.taskSha256, agent: task.agent, checks: task.checks.map((c) => c.id), acceptance: task.acceptance.length, workspaceSha: snap.sha, limits, prevHash: null };
  e.hash = eventHash(e); fs.writeFileSync(eventsFile(dir), `${JSON.stringify(e)}\n`);
  loop.eventSeq = 1; loop.eventHead = e.hash;
  writeJson(path.join(dir, 'loop.json'), loop);
  return { loopId: id, state: 'PLAN', next: nextStep(ctx, loop) };
}

// ---------------------------------------------------------------- attempts
const repairsUsed = (loop) => loop.attempts.filter((a) => a.type === 'repair').length;
function begin(ctx, id) {
  return mutate(ctx, id, (loop, emit, dir) => {
    if (loop.attempts.some((a) => a.status === 'OPEN')) throw new Refusal('ATTEMPT_OPEN', 'an attempt is already open; end it first');
    let type;
    if (loop.state === 'PLAN') type = 'execute';
    else if (loop.state === 'REPAIR') type = 'repair';
    else throw new Refusal('NOT_READY', `${loop.state} is not a state in which an attempt can begin${loop.state === 'DIAGNOSE' ? ': record a diagnosis first (a repair after a failed repair needs a different approach)' : ''}`);
    if (type === 'repair' && repairsUsed(loop) >= loop.limits.maxRepairAttempts) throw new Refusal('BUDGET', 'the repair budget is used up');
    const aid = type === 'execute' ? 'E0' : `R${repairsUsed(loop) + 1}`;
    const abs = workspaceAbs(ctx, loop.workspaceRel); const snap = snapshot(ctx, abs);
    if (snap.sha !== loop.workspaceSha) { stop(ctx, loop, emit, 'UNTRACKED_CHANGE', 'the files changed outside an attempt, so they were never screened'); return { state: loop.state, outcome: loop.outcome }; }
    const adir = path.join(dir, 'attempts', aid);
    copyFiles(abs, snap.files, [...snap.files.keys()], path.join(adir, 'before'));
    writeJson(path.join(adir, 'before.json'), Object.fromEntries(snap.files));
    const a = { id: aid, type, status: 'OPEN', startedAt: iso(ctx), leaseExpiresAt: new Date(ctx.now().getTime() + ctx.policy.limits.leaseMinutes * 60000).toISOString(), beforeSha: snap.sha, feedback: loop.feedback.slice(-10) };
    loop.attempts.push(a);
    if (loop.state === 'PLAN') setState(ctx, loop, emit, 'EXECUTE', 'first attempt opened');
    emit('attempt-begin', { attempt: aid, type, workspaceSha: snap.sha });
    return { attempt: aid, type, feedback: a.feedback, workspace: loop.workspaceRel, leaseExpiresAt: a.leaseExpiresAt };
  });
}

function endAttempt(ctx, loop, emit, dir, { summary, actions, reason = 'ended' }) {
  const a = loop.attempts.find((x) => x.status === 'OPEN');
  const abs = workspaceAbs(ctx, loop.workspaceRel); const L = ctx.policy.limits;
  const task = loop.task; const violations = [];
  const sinceDenials = denialsSince(ctx, task.agent, a.startedAt);
  const adir = path.join(dir, 'attempts', a.id);
  const before = { files: new Map(Object.entries(readJson(path.join(adir, 'before.json')))), sha: a.beforeSha };
  const after = snapshot(ctx, abs);
  const changes = diff(before, after);
  copyFiles(abs, after.files, changes.filter((c) => c.change !== 'deleted').map((c) => c.path), path.join(adir, 'after'));
  writeJson(path.join(adir, 'after.json'), Object.fromEntries(after.files));
  const shown = changes.slice(0, L.maxChangedFiles);
  if (changes.length > L.maxChangedFiles) violations.push({ class: 'PERMISSION_VIOLATION', detail: `${changes.length} files changed, more than the ${L.maxChangedFiles} a repair may touch` });
  for (const c of shown) {
    if (c.link) violations.push({ class: 'PERMISSION_VIOLATION', detail: `${c.path}: a symbolic link was created or changed` });
    if (matches(task.protectedPaths, c.path)) { violations.push({ class: 'TEST_TAMPERING', detail: `${c.path} is protected (${c.change}); a repair may not change a test, a fixture or an expected result` }); continue; }
    if (task.allowedWritePaths && !matches(task.allowedWritePaths, c.path)) violations.push({ class: 'PERMISSION_VIOLATION', detail: `${c.path} is outside the paths this task may change` });
    const repoRel = `${loop.workspaceRel}/${c.path}`;
    const info = perm.classifyPath(repoRel, ctx.model);
    if (info.classes.some((k) => ctx.policy.protectedClasses.includes(k))) violations.push({ class: 'PERMISSION_VIOLATION', detail: `${repoRel} is a ${info.classes.join('/')} path` });
    const s = screenAction(ctx, task, 'edit', { path: repoRel });
    if (s.denied) violations.push({ class: 'PERMISSION_VIOLATION', detail: `change to ${c.path} denied: ${s.denied.reason}` });
    if (c.change !== 'deleted') {
      // Every changed file is scanned whatever its size or encoding; the workspace is small by rule, so reading it whole is bounded.
      let text = ''; try { text = fs.readFileSync(path.join(abs, ...c.path.split('/'))).toString('latin1'); } catch { /* unreadable */ }
      if (sensitiveIn(ctx, text)) violations.push({ class: 'SENSITIVE_DATA', detail: `${c.path} contains a credential shape or a customer data marker` });
    }
  }
  const reported = [];
  for (const act of (actions ?? []).slice(0, L.maxActions)) {
    if (!act || typeof act.tool !== 'string' || typeof (act.args ?? {}) !== 'object') { violations.push({ class: 'UNSAFE_ACTION', detail: 'a reported action is malformed' }); continue; }
    const s = screenAction(ctx, task, act.tool, act.args ?? {});
    const forbidden = s.ops.filter((o) => ctx.policy.forbiddenOps.includes(o));
    if (s.denied) violations.push({ class: 'PERMISSION_VIOLATION', detail: `${act.tool} denied: ${s.denied.reason}` });
    if (forbidden.length) violations.push({ class: 'UNSAFE_ACTION', detail: `${act.tool} performs ${forbidden.join(', ')}, which may never happen inside a loop` });
    if (s.ops.some((o) => ctx.policy.noAutoRetryOps.includes(o))) a.nonIdempotent = true;
    reported.push({ tool: act.tool, ops: s.ops, denied: Boolean(s.denied) });
  }
  if ((actions ?? []).length > L.maxActions) violations.push({ class: 'UNSAFE_ACTION', detail: `more than ${L.maxActions} actions reported` });
  for (const r of sinceDenials) violations.push({ class: 'PERMISSION_VIOLATION', detail: `the guards denied ${task.agent} during this attempt: ${r.reason ?? (r.rules ?? []).join(',')}` });
  const record = { attempt: a.id, type: a.type, reason, startedAt: a.startedAt, endedAt: iso(ctx), beforeSha: a.beforeSha, afterSha: after.sha, changes: shown, reportedActions: reported, nonIdempotent: Boolean(a.nonIdempotent), noChange: changes.length === 0, summary: String(summary ?? '').slice(0, L.textMax), violations };
  const sha = writeJson(path.join(adir, 'changes.json'), record);
  Object.assign(a, { endedAt: record.endedAt, afterSha: after.sha, changed: shown.map((c) => c.path), changesSha256: sha, noChange: record.noChange, summary: record.summary });
  loop.workspaceSha = after.sha;
  emit('attempt-end', { attempt: a.id, reason, changed: shown.length, noChange: record.noChange, nonIdempotent: Boolean(a.nonIdempotent), violations: violations.length, changesSha256: sha, afterSha: after.sha });
  if (violations.length) {
    a.violations = violations.map((v) => ({ class: v.class, detail: v.detail.slice(0, 200) }));
    const worst = ctx.policy.severityOrder.find((c) => violations.some((v) => v.class === c));
    stop(ctx, loop, emit, worst, violations.filter((v) => v.class === worst).map((v) => v.detail).join(' | '));
    return { state: loop.state, outcome: loop.outcome };
  }
  a.status = 'ENDED';
  if (loop.state === 'EXECUTE' || loop.state === 'REPAIR') setState(ctx, loop, emit, 'VERIFY', `${a.id} ended`);
  return { attempt: a.id, changed: shown.map((c) => c.path), noChange: record.noChange, state: loop.state };
}
function end(ctx, id, o = {}) {
  return mutate(ctx, id, (loop, emit, dir) => {
    if (!loop.attempts.some((a) => a.status === 'OPEN')) throw new Refusal('NO_ATTEMPT', 'no attempt is open');
    return endAttempt(ctx, loop, emit, dir, o);
  });
}

// ---------------------------------------------------------------- checks
function resolveToolchain(ctx) {
  const t = ctx.policy.toolchains.tsc; const dir = ctx.toolchainDir;
  const entry = path.join(dir, ...t.entry.split('/'));
  if (!fs.existsSync(entry)) return { error: `the pinned ${t.package} ${t.version} toolchain is not installed at ${dir}` };
  try {
    const pkg = readJson(path.join(dir, 'node_modules', t.package, 'package.json'));
    if (pkg.version !== t.version) return { error: `${t.package} ${pkg.version} is installed, ${t.version} is pinned` };
    const lock = readJson(path.join(dir, 'package-lock.json')).packages?.[`node_modules/${t.package}`];
    if (lock?.integrity !== t.lockIntegrity) return { error: 'the toolchain lock integrity differs from the pin' };
    if (sha256(fs.readFileSync(entry)) !== t.entrySha256) return { error: 'the toolchain entry file differs from the pinned hash' };
  } catch (e) { return { error: `the toolchain could not be verified (${e.message})` }; }
  return { entry };
}
function runCheck(ctx, loop, check, label, dir) {
  const abs = workspaceAbs(ctx, loop.workspaceRel);
  const cp = commandProblems(ctx, check.argv);
  const base = { id: check.id, kind: check.kind, label, argv: check.argv };
  if (cp) return { ...base, ok: false, class: 'PERMISSION_VIOLATION', detail: cp };
  const line = check.argv.join(' ');
  const verdict = policyGuard.evaluate({ toolName: 'powershell', toolArgs: { command: line }, cwd: ctx.root }, policyGuard.loadPolicy());
  if (verdict) return { ...base, ok: false, class: 'PERMISSION_VIOLATION', detail: `the repository command guard refused it: [${verdict.id}] ${verdict.reason}` };
  let args = check.argv.slice(1);
  if (check.argv[0] === 'tsc') { const t = resolveToolchain(ctx); if (t.error) return { ...base, ok: false, class: 'MISSING_CONTEXT', detail: t.error }; args = [t.entry, ...args]; }
  const remaining = Math.max(1, loop.limits.wallBudgetSeconds * 1000 - loop.wallMs);
  const timeoutMs = Math.min((check.timeoutSec ?? loop.limits.timeoutSeconds) * 1000, remaining);
  // Node and the toolchain must load only what the check names: no preload or option injection through the environment.
  const env = { ...process.env }; for (const k of ['NODE_TEST_CONTEXT', 'NODE_OPTIONS', 'NODE_PATH', 'NODE_REPL_EXTERNAL_MODULE']) delete env[k];
  const started = Date.now();
  const res = spawnSync(process.execPath, args, { cwd: check.cwd === 'repo' ? ctx.root : abs, env, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: ctx.policy.limits.outputMaxBytes });
  const durationMs = Date.now() - started;
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const rec = { schema: ctx.policy.evidence.schema, label, argv: check.argv, cwd: check.cwd ?? 'workspace', exitCode: res.status, signal: res.signal ?? null, spawnError: res.error?.message ?? null, startedAt: new Date(started).toISOString(), durationMs, outputSha256: sha256(out), outputBytes: Buffer.byteLength(out), outputTail: redact(out.slice(-ctx.policy.evidence.outputTailBytes)), workspaceSha: loop.workspaceSha };
  const recSha = writeJson(path.join(dir, 'checks', `${label}.json`), rec);
  atomicWrite(path.join(dir, 'checks', `${label}.out.txt`), redact(out.slice(-ctx.policy.limits.outputKeptBytes)));
  const r2 = { ...base, durationMs, exitCode: res.status, evidenceSha256: recSha, outputSha256: rec.outputSha256 };
  if (res.error?.code === 'ENOENT') return { ...r2, ok: false, class: 'MISSING_CONTEXT', detail: `the command could not start: ${res.error.message}` };
  if (res.error?.code === 'ETIMEDOUT') return { ...r2, ok: false, class: 'TIMEOUT', detail: `exceeded ${Math.round(timeoutMs / 1000)} s`, fingerprint: sha256(`${check.id}|TIMEOUT`) };
  if (res.status === 0 && !res.error) return { ...r2, ok: true };
  let cls = ctx.policy.checkKinds[check.kind];
  const pat = ctx.policy.outputPatterns.find((p) => new RegExp(p.pattern).test(out));
  if (pat) cls = pat.class; else if (check.hardConstraint) cls = 'HARD_CONSTRAINT_VIOLATION';
  return { ...r2, ok: false, class: cls, detail: `exit ${res.status}${res.error ? ` (${res.error.message})` : ''}`, fingerprint: sha256(`${check.id}|${cls}|${normalise(out, abs, ctx.root)}`) };
}
// Checks that cover the changed files (or all, for the first attempt) run first, cheapest kind first; the rest run only if those pass.
function selectChecks(ctx, task, changed) {
  const order = (c) => ctx.policy.kindOrder.indexOf(c.kind);
  const sorted = [...task.checks].sort((a, b) => order(a) - order(b));
  if (!changed) return { first: sorted, rest: [] };
  const hit = (c) => !c.covers || changed.some((p) => matches(c.covers, p));
  return { first: sorted.filter(hit), rest: sorted.filter((c) => !hit(c)) };
}
const budgetLeft = (loop) => loop.checkRuns < loop.limits.maxCheckRuns && loop.wallMs < loop.limits.wallBudgetSeconds * 1000;
const brief = (rs) => rs.map((r) => ({ id: r.id, ok: r.ok, class: r.class ?? null, detail: r.detail ?? null, label: r.label }));

function verify(ctx, id) {
  return mutate(ctx, id, (loop, emit, dir) => {
    if (loop.state !== 'VERIFY') throw new Refusal('NOT_VERIFYING', `the loop is ${loop.state}, not VERIFY`);
    const snap = snapshot(ctx, workspaceAbs(ctx, loop.workspaceRel));
    if (snap.sha !== loop.workspaceSha) { stop(ctx, loop, emit, 'UNTRACKED_CHANGE', 'the files changed after the attempt ended and before verification'); return { state: loop.state, outcome: loop.outcome }; }
    for (const r of loop.contextRefs) {
      const p = path.join(ctx.root, r.ref.slice(5));
      if (!fs.existsSync(p) || sha256(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')) !== r.sha256) { stop(ctx, loop, emit, 'MISSING_CONTEXT', `${r.ref} is missing or changed since the task was planned`); return { state: loop.state, outcome: loop.outcome }; }
    }
    const last = loop.attempts.at(-1); const attemptId = last?.id;
    const sel = selectChecks(ctx, loop.task, last?.type === 'repair' ? last.changed : null);
    const results = []; const failures = [];
    emit('verify-start', { attempt: attemptId, selected: sel.first.map((c) => c.id), deferred: sel.rest.map((c) => c.id) });
    let exhausted = false;
    const run = (c) => {
      if (!budgetLeft(loop)) { exhausted = true; return false; }
      const label = `${attemptId}-v${loop.checkRuns + 1}-${c.id}`;
      const r = runCheck(ctx, loop, c, label, dir);
      loop.checkRuns += 1; loop.wallMs += r.durationMs ?? 0;
      results.push(r);
      emit('check', { id: c.id, label, ok: r.ok, class: r.class ?? null, exitCode: r.exitCode ?? null, durationMs: r.durationMs ?? 0, evidenceSha256: r.evidenceSha256 ?? null, outputSha256: r.outputSha256 ?? null });
      if (!r.ok) failures.push(r);
      return r.ok;
    };
    for (const c of sel.first) if (!run(c)) break;
    if (!failures.length && !exhausted) for (const c of sel.rest) if (!run(c)) break;
    // A check that runs workspace code can change the workspace. Whatever the outcome, the files must be what was screened.
    const post = snapshot(ctx, workspaceAbs(ctx, loop.workspaceRel));
    if (post.sha !== loop.workspaceSha) {
      emit('check-changed-files', { changed: diff({ files: new Map(Object.entries(readJson(path.join(dir, 'attempts', attemptId, 'after.json')))) }, post).slice(0, 20).map((c) => c.path) });
      stop(ctx, loop, emit, 'UNTRACKED_CHANGE', 'a check changed files in the workspace while it ran, so its result describes files that no longer exist');
      return { state: loop.state, outcome: loop.outcome, results: brief(results) };
    }
    if (failures.length) return afterFailure(ctx, loop, emit, failures.map((f) => ({ checkId: f.id, class: f.class, fingerprint: f.fingerprint ?? sha256(`${f.id}|${f.class}`), label: f.label, detail: f.detail })), attemptId, results);
    if (exhausted) { escalate(ctx, loop, emit, 'BUDGET_EXHAUSTED', 'the check-run or wall-clock budget ran out before every check ran'); return { state: loop.state, outcome: loop.outcome, results: brief(results) }; }
    loop.verifiedSha = loop.workspaceSha;
    emit('verified', { allPassed: true, checks: results.map((r) => r.id), workspaceSha: loop.workspaceSha, attempt: attemptId });
    if (loop.task.review?.required) { setState(ctx, loop, emit, 'CRITIQUE', 'all checks passed; an independent review is required'); return { state: 'CRITIQUE', results: brief(results) }; }
    setState(ctx, loop, emit, 'PASSED', 'every declared check passed on the current files');
    loop.outcome = { state: 'PASSED', class: null, detail: 'all declared checks passed', requires: null };
    emit('outcome', { state: 'PASSED', class: null });
    return { state: 'PASSED', results: brief(results) };
  });
}

// Decides what happens after a failed verification or a reviewer's rework request.
function afterFailure(ctx, loop, emit, failures, attemptId, results = []) {
  const P = ctx.policy;
  const worst = P.severityOrder.concat(['REVIEW_REWORK']).find((c) => failures.some((f) => f.class === c)) ?? failures[0].class;
  const fp = sha256(canonical(failures.map((f) => f.fingerprint).sort()));
  loop.failureHistory.push({ seq: loop.failureHistory.length + 1, attempt: attemptId, classes: [...new Set(failures.map((f) => f.class))], fingerprint: fp, labels: failures.map((f) => f.label).filter(Boolean), checks: failures.map((f) => f.checkId) });
  loop.lastFailure = { fingerprint: fp, labels: failures.map((f) => f.label).filter(Boolean), classes: [...new Set(failures.map((f) => f.class))] };
  loop.feedback = failures.map((f) => ({ check: f.checkId, class: f.class, detail: String(f.detail ?? '').slice(0, 300), evidence: f.label ? `checks/${f.label}.out.txt` : null }));
  emit('failure', { attempt: attemptId, classes: loop.lastFailure.classes, fingerprint: fp, checks: failures.map((f) => f.checkId) });
  const act = P.failureClasses[worst].action;
  const out = () => ({ state: loop.state, outcome: loop.outcome ?? null, results: brief(results) });
  if (act === 'stop') { stop(ctx, loop, emit, worst, failures.filter((f) => f.class === worst).map((f) => `${f.checkId}: ${f.detail}`).join(' | ')); return out(); }
  if (act === 'escalate') { escalate(ctx, loop, emit, worst, failures.map((f) => `${f.checkId}: ${f.detail}`).join(' | ')); return out(); }
  const identical = loop.failureHistory.filter((h) => h.fingerprint === fp).length;
  const lastAttempt = loop.attempts.find((a) => a.id === attemptId);
  if (lastAttempt?.nonIdempotent) { escalate(ctx, loop, emit, 'NON_IDEMPOTENT_FAILURE', `${attemptId} performed a non-idempotent operation and then failed; it is not retried automatically`); return out(); }
  if (identical >= loop.limits.maxIdenticalFailures) { escalate(ctx, loop, emit, 'REPEATED_FAILURE', `the same failure happened ${identical} times (the maximum is ${loop.limits.maxIdenticalFailures}); a blind retry would not help`); return out(); }
  if (repairsUsed(loop) >= loop.limits.maxRepairAttempts) { escalate(ctx, loop, emit, 'BUDGET_EXHAUSTED', `${repairsUsed(loop)} repair attempts were used and the work still fails`); return out(); }
  if (!budgetLeft(loop)) { escalate(ctx, loop, emit, 'BUDGET_EXHAUSTED', 'the check-run or wall-clock budget is used up'); return out(); }
  if (repairsUsed(loop) >= 1) { setState(ctx, loop, emit, 'DIAGNOSE', 'a repair has already failed: diagnose before repairing again'); return out(); }
  setState(ctx, loop, emit, 'REPAIR', 'first failure: repair with the recorded feedback');
  return out();
}

// ---------------------------------------------------------------- diagnosis and critique
const stripWords = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
function diagnose(ctx, id, d) {
  return mutate(ctx, id, (loop, emit, dir) => {
    if (loop.state !== 'DIAGNOSE') throw new Refusal('NOT_DIAGNOSING', `the loop is ${loop.state}; a diagnosis is only taken after a failed repair`);
    const L = ctx.policy.limits;
    const refuse = (m) => { emit('diagnosis-rejected', { reason: m.slice(0, 200) }); throw new Refusal('DIAGNOSIS_REJECTED', m); };
    if (!d || typeof d !== 'object') refuse('a diagnosis is an object');
    for (const k of ['hypothesis', 'differentApproach']) if (typeof d[k] !== 'string' || d[k].trim().length < 20 || d[k].length > L.textMax) refuse(`${k} must be 20 to ${L.textMax} characters`);
    const labels = new Set(loop.lastFailure?.labels ?? []);
    if (!Array.isArray(d.evidence) || !d.evidence.length || d.evidence.some((e) => typeof e !== 'string' || !/^[A-Za-z0-9_-]+$/.test(e))) refuse('evidence must name the check runs that were read (for example R1-v3-api-contract)');
    if (!d.evidence.some((e) => labels.has(e))) refuse(`the diagnosis must cite at least one run of the latest failure (${[...labels].join(', ') || 'none'})`);
    if (d.evidence.some((e) => !fs.existsSync(path.join(dir, 'checks', `${e}.json`)))) refuse('the evidence cites a check run that does not exist in this loop');
    const text = `${d.hypothesis} ${d.differentApproach} ${d.nextAction ?? ''}`;
    const bypass = ctx.policy.bypassPhrases.find((p) => new RegExp(p, 'i').test(text));
    if (bypass) refuse(`the diagnosis proposes weakening a test, an expected result or a control (matched '${bypass}'); that is not a repair`);
    const approach = sha256(stripWords(d.differentApproach));
    if (loop.diagnoses.some((x) => x.approachSha256 === approach) || loop.attempts.some((a) => a.summary && sha256(stripWords(a.summary)) === approach)) refuse('this is the same approach as one already tried; a retry without a different approach is blind');
    const rec = { n: loop.diagnoses.length + 1, at: iso(ctx), afterFailure: loop.lastFailure.fingerprint, hypothesis: d.hypothesis, evidence: d.evidence, differentApproach: d.differentApproach, nextAction: d.nextAction ?? null, approachSha256: approach };
    loop.diagnoses.push(rec);
    writeJson(path.join(dir, 'diagnoses', `D${rec.n}.json`), rec);
    emit('diagnosis', { n: rec.n, evidence: rec.evidence, approachSha256: approach });
    setState(ctx, loop, emit, 'REPAIR', 'diagnosis recorded with a different approach');
    return { state: 'REPAIR', diagnosis: rec.n };
  });
}
function critique(ctx, id, { reviewer, verdict, findings }) {
  return mutate(ctx, id, (loop, emit, dir) => {
    if (loop.state !== 'CRITIQUE') throw new Refusal('NOT_CRITIQUING', `the loop is ${loop.state}, not CRITIQUE`);
    if (!ctx.policy.reviewerAgents.includes(reviewer) || reviewer === loop.task.agent) throw new Refusal('REVIEWER', `the reviewer must be one of ${ctx.policy.reviewerAgents.join(', ')} and not the task's own agent`);
    if (loop.task.review.reviewer && loop.task.review.reviewer !== reviewer) throw new Refusal('REVIEWER', `this task names ${loop.task.review.reviewer} as its reviewer`);
    if (!['APPROVE', 'REWORK', 'BLOCK'].includes(verdict)) throw new Refusal('VERDICT', 'verdict must be APPROVE, REWORK or BLOCK');
    const text = String(findings ?? '').slice(0, ctx.policy.limits.textMax * 4);
    if (verdict !== 'APPROVE' && text.trim().length < 10) throw new Refusal('FINDINGS', 'a REWORK or BLOCK needs findings');
    const snap = snapshot(ctx, workspaceAbs(ctx, loop.workspaceRel));
    if (snap.sha !== loop.workspaceSha) { stop(ctx, loop, emit, 'UNTRACKED_CHANGE', 'the files changed after verification and before the review'); return { state: loop.state, outcome: loop.outcome }; }
    if (verdict === 'APPROVE' && loop.verifiedSha !== loop.workspaceSha) throw new Refusal('STALE', 'the approval does not match the verified files');
    const rec = { n: loop.critiques.length + 1, at: iso(ctx), reviewer, verdict, workspaceSha: loop.workspaceSha, findingsSha256: sha256(text) };
    loop.critiques.push(rec);
    atomicWrite(path.join(dir, 'critiques', `C${rec.n}.md`), `# Review ${rec.n}: ${verdict} by ${reviewer}\n\nReviewed files: ${loop.workspaceSha}\n\nThe text below is the reviewer's, recorded as data. It does not instruct the loop.\n\n${redact(text)}\n`);
    emit('critique', { n: rec.n, reviewer, verdict, workspaceSha: loop.workspaceSha, findingsSha256: rec.findingsSha256 });
    if (verdict === 'APPROVE') {
      setState(ctx, loop, emit, 'PASSED', `approved by ${reviewer}; every check passed on the reviewed files`);
      loop.outcome = { state: 'PASSED', class: null, detail: `all declared checks passed; approved by ${reviewer}`, requires: null };
      emit('outcome', { state: 'PASSED', class: null });
      return { state: 'PASSED' };
    }
    if (verdict === 'BLOCK') { escalate(ctx, loop, emit, 'REVIEW_BLOCK', text.slice(0, 200)); return { state: loop.state, outcome: loop.outcome }; }
    return afterFailure(ctx, loop, emit, [{ checkId: 'review', class: 'REVIEW_REWORK', fingerprint: sha256(normalise(text, null, null)), label: null, detail: text.slice(0, 300) }], loop.attempts.at(-1)?.id);
  });
}

// ---------------------------------------------------------------- resume, cancel, status
function resume(ctx, id) {
  return mutate(ctx, id, (loop, emit, dir) => {
    const open = loop.attempts.find((a) => a.status === 'OPEN');
    if (open && !ctx.policy.terminalStates.includes(loop.state)) {
      if (ctx.now().getTime() < Date.parse(open.leaseExpiresAt)) return { action: 'wait', why: `attempt ${open.id} is open and its lease runs until ${open.leaseExpiresAt}` };
      emit('attempt-interrupted', { attempt: open.id, leaseExpiresAt: open.leaseExpiresAt });
      const r = endAttempt(ctx, loop, emit, dir, { summary: 'interrupted: closed by resume', actions: [], reason: 'interrupted' });
      return { interrupted: open.id, ...r, next: nextStep(ctx, loop) };
    }
    return { next: nextStep(ctx, loop) };
  });
}
function cancel(ctx, id, reason) {
  return mutate(ctx, id, (loop, emit) => {
    if (ctx.policy.terminalStates.includes(loop.state)) throw new Refusal('TERMINAL', `the loop is already ${loop.state}`);
    finish(ctx, loop, emit, 'CANCELLED', 'CANCELLED', String(reason ?? 'cancelled by a person'));
    loop.outcome.class = null; loop.outcome.requires = null;
    return { state: 'CANCELLED' };
  });
}
function nextStep(ctx, loop) {
  const s = loop.state; const used = repairsUsed(loop);
  const open = loop.attempts.find((a) => a.status === 'OPEN');
  if (s === 'PASSED') return { action: 'none', why: 'every declared check passed on the current files' };
  if (loop.outcome) return { action: s === 'CANCELLED' ? 'none' : 'human', why: loop.outcome.requires ?? 'a person decides', class: loop.outcome.class };
  if (s === 'PLAN') return { action: 'begin', why: 'open the first attempt, do the work, then end it' };
  if (open) return { action: 'end', why: `attempt ${open.id} is open: finish the changes, then end it` };
  if (s === 'VERIFY') return { action: 'verify', why: 'the loop runs the declared checks (never the actor)' };
  if (s === 'CRITIQUE') return { action: 'critique', why: `an independent reviewer (${loop.task.review?.reviewer ?? ctx.policy.reviewerAgents.join(' or ')}) must review the verified files` };
  if (s === 'DIAGNOSE') return { action: 'diagnose', why: 'a repair already failed: cite the failing check runs and give a different approach', feedback: loop.feedback };
  if (s === 'REPAIR') return { action: 'begin', why: `repair attempt ${used + 1} of ${loop.limits.maxRepairAttempts}`, feedback: loop.feedback };
  return { action: 'none', why: s };
}
function statusView(ctx, id) {
  const loop = readJson(path.join(loopDir(ctx, id), 'loop.json'));
  const v = verifyLoop(ctx, id);
  return {
    loopId: id, state: loop.state, title: loop.task.title, agent: loop.task.agent, outcome: loop.outcome, next: nextStep(ctx, loop),
    budget: { repairAttempts: `${repairsUsed(loop)}/${loop.limits.maxRepairAttempts}`, identicalFailuresMax: loop.limits.maxIdenticalFailures, checkRuns: `${loop.checkRuns}/${loop.limits.maxCheckRuns}`, wallSeconds: `${Math.round(loop.wallMs / 1000)}/${loop.limits.wallBudgetSeconds}` },
    attempts: loop.attempts.map((a) => ({ id: a.id, type: a.type, status: a.status, changed: a.changed ?? [], noChange: a.noChange ?? null, nonIdempotent: Boolean(a.nonIdempotent), violations: a.violations ?? [] })),
    failures: loop.failureHistory.map((h) => ({ seq: h.seq, attempt: h.attempt, classes: h.classes, fingerprint: h.fingerprint.slice(0, 12), checks: h.checks })),
    diagnoses: loop.diagnoses.length, critiques: loop.critiques.map((c) => ({ n: c.n, reviewer: c.reviewer, verdict: c.verdict })), integrity: { ok: v.ok, problems: v.problems.slice(0, 5) },
  };
}

// ---------------------------------------------------------------- integrity
function verifyLoop(ctx, id) {
  const problems = []; const dir = loopDir(ctx, id);
  let loop; try { loop = readJson(path.join(dir, 'loop.json')); } catch (e) { return { ok: false, problems: [`loop.json: ${e.message}`] }; }
  let events; try { events = readEvents(dir); } catch (e) { return { ok: false, problems: [e.message] }; }
  let prev = null;
  events.forEach((e, i) => { if (e.seq !== i + 1) problems.push(`event ${i + 1}: sequence is ${e.seq}`); if (e.prevHash !== prev) problems.push(`event ${e.seq}: chain broken`); if (e.hash !== eventHash(e)) problems.push(`event ${e.seq}: content altered`); prev = e.hash; });
  if ((events.at(-1)?.seq ?? 0) !== loop.eventSeq || (events.at(-1)?.hash ?? null) !== loop.eventHead) problems.push('loop.json does not match the end of the event log (edited, or rolled back)');
  const stateEvents = events.filter((e) => e.action === 'state');
  const replayed = stateEvents.at(-1)?.to ?? 'PLAN';
  if (replayed !== loop.state) problems.push(`loop.json says ${loop.state} but the event log ends in ${replayed}`);
  let cur = 'PLAN';
  for (const e of stateEvents) { if (e.from !== cur || !(ctx.policy.transitions[e.from] ?? []).includes(e.to)) problems.push(`event ${e.seq}: ${e.from} to ${e.to} is not a legal transition`); cur = e.to; }
  if (loop.state === 'PASSED') {
    const ver = events.filter((e) => e.action === 'verified').at(-1);
    if (!ver || ver.workspaceSha !== loop.workspaceSha) problems.push('PASSED without a verification of the final files by the loop');
    if (loop.task.review?.required) { const c = events.filter((e) => e.action === 'critique').at(-1); if (!c || c.verdict !== 'APPROVE' || c.workspaceSha !== loop.workspaceSha || !ctx.policy.reviewerAgents.includes(c.reviewer) || c.reviewer === loop.task.agent) problems.push('PASSED without an independent approval of the final files'); }
  }
  for (const e of events.filter((x) => x.action === 'check')) { const f = path.join(dir, 'checks', `${e.label}.json`); if (!fs.existsSync(f)) problems.push(`check ${e.label}: evidence file missing`); else if (sha256(fs.readFileSync(f, 'utf8')) !== e.evidenceSha256) problems.push(`check ${e.label}: evidence file altered`); }
  for (const e of events.filter((x) => x.action === 'attempt-end')) { const f = path.join(dir, 'attempts', e.attempt, 'changes.json'); if (!fs.existsSync(f)) problems.push(`attempt ${e.attempt}: changes record missing`); else if (sha256(fs.readFileSync(f, 'utf8')) !== e.changesSha256) problems.push(`attempt ${e.attempt}: changes record altered`); }
  if (sha256(canonical(loop.task)) !== loop.taskSha256) problems.push('the task contract was changed after the plan');
  if (loop.diagnoses.length !== events.filter((e) => e.action === 'diagnosis').length) problems.push('diagnoses in loop.json do not match the event log');
  return { ok: problems.length === 0, problems, events: events.length };
}
const listLoops = (ctx) => (fs.existsSync(ctx.loopsDir) ? fs.readdirSync(ctx.loopsDir).filter((d) => ID_RE.test(d) && fs.existsSync(path.join(ctx.loopsDir, d, 'loop.json'))).sort() : []);

function renderReport(ctx, id) {
  const dir = loopDir(ctx, id); const loop = readJson(path.join(dir, 'loop.json')); const events = readEvents(dir);
  const cell = (s) => String(s).replace(/\|/g, '/').replace(/\r?\n/g, ' ').slice(0, 160);
  const L = [`# Loop trace: ${id}`, '', 'Generated from `events.jsonl` by `loop.mjs report`. Do not edit by hand; the event log is the source.', '',
    `- Task: ${loop.task.title}`, `- Agent: ${loop.task.agent}`, `- Final state: **${loop.state}**${loop.outcome?.class ? ` (${loop.outcome.class})` : ''}`, `- Repair attempts: ${repairsUsed(loop)}/${loop.limits.maxRepairAttempts}; check runs ${loop.checkRuns}; events ${events.length}`, '',
    '## Acceptance criteria', '', ...loop.task.acceptance.map((a) => `- ${a}`), '', '## Timeline', '', '| # | Action | Detail |', '|---|---|---|'];
  for (const e of events) {
    const d = e.action === 'state' ? `${e.from} to ${e.to}: ${e.reason}` : e.action === 'check' ? `${e.id} ${e.ok ? 'passed' : `FAILED (${e.class})`}, exit ${e.exitCode}, ${e.label}` : e.action === 'attempt-end' ? `${e.attempt} changed ${e.changed} file(s)${e.violations ? `, ${e.violations} violation(s)` : ''}` : e.action === 'failure' ? `${e.classes.join(', ')} on ${e.checks.join(', ')}, fingerprint ${e.fingerprint.slice(0, 12)}` : e.action === 'critique' ? `${e.reviewer}: ${e.verdict}` : e.action === 'diagnosis' ? `diagnosis ${e.n}` : e.action === 'outcome' ? `${e.state}${e.class ? ` (${e.class})` : ''}` : e.action === 'attempt-begin' ? `${e.attempt} (${e.type})` : '';
    L.push(`| ${e.seq} | ${e.action} | ${cell(d)} |`);
  }
  if (loop.outcome) L.push('', '## Outcome', '', loop.outcome.detail, '', loop.outcome.requires ? `**Needs a person:** ${loop.outcome.requires}` : 'No human action is outstanding.');
  const fails = events.filter((e) => e.action === 'check' && !e.ok);
  if (fails.length) { L.push('', '## Preserved failures', ''); for (const f of fails) { let tail = ''; try { tail = readJson(path.join(dir, 'checks', `${f.label}.json`)).outputTail; } catch { /* missing */ } L.push(`### ${f.label}`, '', '```', redact(tail).trim().slice(-800), '```', ''); } }
  L.push('', '## Integrity', '', verifyLoop(ctx, id).ok ? 'The event chain and the recorded evidence verify.' : 'The loop FAILED its integrity check.');
  return L.join('\n');
}

module.exports = { ROOT, LoopError, Refusal, makeContext, validateTask, commandProblems, init, begin, end, verify, diagnose, critique, resume, cancel, statusView, verifyLoop, listLoops, renderReport, loadLoop, normalise, selectChecks, nextStep, repairsUsed, resolveToolchain, snapshot, readEvents };
