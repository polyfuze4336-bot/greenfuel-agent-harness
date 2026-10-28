'use strict';
// Independent evaluation framework for the greenfuel-agent-harness. Zero dependencies.
//
// It runs the executable tests of a catalogue, records evidence for each result, evaluates seven quality gates by rule, and renders a
// report. Properties, each covered by tests/evaluation-engine.test.mjs:
//   - A test is PASS only if it ran and showed its expected outcome. A test that did not run, was skipped, or cannot show it ran is
//     never a PASS. Pending (the system does not exist) and blocked (a precondition is not met) are separate, visible statuses.
//   - Every recorded status is re-derived from the recorded evidence by verifyRun, so a status edited to PASS without evidence is found.
//   - There is no score. A gate is decided by rules over individual results; a hard-constraint violation is reported on its own,
//     above any gate, and makes its gate a critical failure.
//   - The catalogue is data, not code: it names what to run and the runner only executes allow-listed commands without a shell.
// Limits (docs/evaluation/EVALUATION-FRAMEWORK.md): a PASS proves the named check ran and passed, not that it is the right check;
// production-contract tests exercise candidate contracts, not production agents; the committed run is a human-run record.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const perm = require('../hooks/permission-engine.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const { canonical, sha256 } = perm;
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const ID_RE = /^EVAL-(HRN|PRC|PRD)-([A-Z]{3})-(\d{3})$/;
const RUN_RE = /^EVRUN-[0-9a-f]{10}$/;
const SCOPE_PREFIX = { harness: 'HRN', 'production-contract': 'PRC', 'production-agent': 'PRD' };

class EvalError extends Error { constructor(code, message, detail) { super(message); this.code = code; this.detail = detail; } }

function makeContext(opts = {}) {
  const root = opts.root ?? ROOT;
  const policy = opts.policy ?? readJson(path.join(root, 'harness/policy/evaluation-policy.json'));
  return { root, policy, now: opts.now ?? (() => new Date()), runsDir: path.resolve(opts.runsDir ?? process.env.HARNESS_EVAL_RUNS_DIR ?? path.join(root, policy.runsDir)), run: opts.run ?? spawnSync };
}
const iso = (ctx) => ctx.now().toISOString();
const text = (s) => String(s ?? '').replace(/\r?\n/g, ' ').trim();

// ---------------------------------------------------------------- catalogue
function loadCatalogue(ctx) {
  const dir = path.join(ctx.root, ctx.policy.catalogueDir);
  const tests = []; const files = [];
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort() : []) {
    const doc = readJson(path.join(dir, f)); files.push({ file: f, doc });
    for (const t of doc.tests ?? []) tests.push({ ...t, _file: f });
  }
  return { files, tests, sha256: sha256(canonical(files.map((x) => x.doc))) };
}
function knownRequirementIds(root) {
  const ids = new Set();
  for (const f of ['REQUIREMENTS.md', 'NON-FUNCTIONAL-REQUIREMENTS.md']) {
    const p = path.join(root, 'docs/context', f);
    if (fs.existsSync(p)) for (const m of fs.readFileSync(p, 'utf8').matchAll(/^\|\s*((?:BR|FR|SEC|DATA|AGT|NFR)-\d{3})\s*\|/gm)) ids.add(m[1]);
  }
  return ids;
}
function commandProblems(ctx, argv) {
  if (!Array.isArray(argv) || !argv.length || argv.some((a) => typeof a !== 'string' || !a || a.length > 200)) return 'argv must be a list of short strings';
  const line = argv.join(' ');
  if (!ctx.policy.commandAllowList.some((p) => new RegExp(p).test(line))) return `'${line.slice(0, 90)}' is not on the command allow-list`;
  if (argv.slice(1).some((a) => /^[A-Za-z0-9_./-]+$/.test(a) && (a.split('/').includes('..') || a.startsWith('/')))) return 'a path argument must be relative with no ..';
  return null;
}
function argvOf(t) {
  const r = t.runner;
  if (!r) return null;
  if (r.type === 'eval-test') return ['node', '--test', '--test-reporter=tap', r.file];
  if (r.type === 'suite') return ['node', '--test', '--test-reporter=tap', ...r.files];
  if (r.type === 'command') return r.argv;
  return null;
}

// Returns a list of problems; an empty list means the catalogue is well formed. Never reads results.
function validateCatalogue(ctx) {
  const P = ctx.policy; const errors = []; const bad = (m) => errors.push(m);
  const cat = loadCatalogue(ctx);
  if (!cat.files.length) return ['no catalogue files'];
  const reqIds = knownRequirementIds(ctx.root);
  const gateIds = P.gates.map((g) => g.id); const domainIds = P.domains.map((d) => d.id);
  const seen = new Set();
  const FORBIDDEN = ['status', 'result', 'results', 'passed', 'actual', 'actualOutcome', 'evidence'];
  for (const { file, doc } of cat.files) {
    if (doc.schema !== 'greenfuel.eval-catalogue/v1') bad(`${file}: schema must be greenfuel.eval-catalogue/v1`);
    if (!['harness', 'production'].includes(doc.suite)) bad(`${file}: suite must be harness or production`);
  }
  for (const t of cat.tests) {
    const at = t.id ?? '?';
    const m = ID_RE.exec(t.id ?? '');
    if (!m) { bad(`${at}: id must look like EVAL-HRN-SEC-001`); continue; }
    if (seen.has(t.id)) bad(`${at}: duplicate id`); seen.add(t.id);
    for (const k of Object.keys(t)) if (FORBIDDEN.includes(k)) bad(`${at}: the catalogue must not carry results (found '${k}'); results come only from runs`);
    const suite = cat.files.find((f) => f.file === t._file).doc.suite;
    if (!P.scopes[t.scope]) bad(`${at}: scope must be one of ${Object.keys(P.scopes).join(', ')}`);
    else {
      if (SCOPE_PREFIX[t.scope] !== m[1]) bad(`${at}: a ${t.scope} test must use the ${SCOPE_PREFIX[t.scope]} prefix`);
      if ((t.scope === 'harness') !== (suite === 'harness')) bad(`${at}: harness tests live in the harness suite and production tests in the production suite, never mixed`);
    }
    if (!domainIds.includes(m[2]) || t.domain !== m[2]) bad(`${at}: domain must match the id and be one of ${domainIds.join(', ')}`);
    if (!P.severities.includes(t.severity)) bad(`${at}: severity must be ${P.severities.join(', ')}`);
    for (const k of ['title', 'scenario', 'expected', 'remediation']) if (typeof t[k] !== 'string' || t[k].trim().length < 15 || t[k].length > 400) bad(`${at}: ${k} is required (15 to 400 characters)`);
    if (!Array.isArray(t.requirements) || !t.requirements.length) bad(`${at}: requirements is required (requirement ids, HC ids, or 'N/A (reason)')`);
    else for (const r of t.requirements) if (!(reqIds.has(r) || P.hardConstraints.includes(r) || /^N\/A \(.{8,}\)$/.test(r))) bad(`${at}: unknown requirement '${r}'`);
    for (const h of t.hardConstraints ?? []) if (!P.hardConstraints.includes(h)) bad(`${at}: unknown hard constraint ${h}`);
    if (t.gate !== null && t.gate !== undefined && !gateIds.includes(t.gate)) bad(`${at}: gate must be null or one of ${gateIds.join(', ')}`);
    for (const g of t.requires ?? []) if (!gateIds.includes(g) || !t.gate || gateIds.indexOf(g) >= gateIds.indexOf(t.gate)) bad(`${at}: requires must name gates that come before the test's own gate`);
    if (t.redTeam !== undefined && !P.redTeam.some((r) => r.id === t.redTeam)) bad(`${at}: unknown red-team scenario ${t.redTeam}`);
    if (!['executable', 'pending'].includes(t.mode)) { bad(`${at}: mode must be executable or pending`); continue; }
    if (t.scope === 'production-agent' && t.mode !== 'pending') bad(`${at}: production-agent tests must be pending: no business agent exists and none may be built before the phase is raised`);
    if (t.mode === 'pending') {
      if (t.runner) bad(`${at}: a pending test has no runner`);
      if (typeof t.pendingReason !== 'string' || t.pendingReason.trim().length < 25) bad(`${at}: a pending test needs a pendingReason (25 characters or more) saying what does not exist yet`);
      if (t.entry) bad(`${at}: an entry test must be executable`);
      continue;
    }
    const r = t.runner;
    if (!r || !P.runners[r.type]) { bad(`${at}: runner.type must be one of ${Object.keys(P.runners).join(', ')}`); continue; }
    const files = r.type === 'eval-test' ? [r.file] : r.type === 'suite' ? r.files : [];
    if ((r.type === 'eval-test' && typeof r.file !== 'string') || (r.type === 'suite' && (!Array.isArray(r.files) || !r.files.length))) bad(`${at}: runner needs its file or files`);
    for (const f of files ?? []) {
      if (!fs.existsSync(path.join(ctx.root, f))) bad(`${at}: runner file ${f} does not exist`);
      else if (r.type === 'eval-test' && !new RegExp(`['"\`]${t.id}\\b`).test(fs.readFileSync(path.join(ctx.root, f), 'utf8'))) bad(`${at}: ${f} has no test named with ${t.id}`);
    }
    if (r.type === 'suite' && !(Number.isInteger(r.minPass) && r.minPass >= 1)) bad(`${at}: a suite needs minPass of at least 1, so a run that executes nothing cannot pass`);
    if (r.type === 'command') { if (!r.expect || !(Number.isInteger(r.expect.exit) || Array.isArray(r.expect.exit))) bad(`${at}: a command needs expect.exit`); if (r.expect?.match) { try { new RegExp(r.expect.match); } catch { bad(`${at}: expect.match is not a valid pattern`); } } }
    const cp = commandProblems(ctx, argvOf(t)); if (cp) bad(`${at}: ${cp}`);
  }
  // coverage: the framework must evaluate what it claims to
  for (const d of domainIds) if (!cat.tests.some((t) => t.domain === d)) bad(`domain ${d} has no test`);
  for (const g of gateIds) if (!cat.tests.some((t) => t.gate === g)) bad(`gate ${g} has no test, so it could never pass or fail honestly`);
  for (const h of P.hardConstraints) if (!cat.tests.some((t) => (t.hardConstraints ?? []).includes(h))) bad(`hard constraint ${h} has no test`);
  for (const rt of P.redTeam) {
    if (!cat.tests.some((t) => t.redTeam === rt.id && t.scope !== 'harness')) bad(`red-team scenario ${rt.id} has no production-suite test (executable contract check or pending agent test)`);
    if (rt.harnessAnalogue && !cat.tests.some((t) => t.redTeam === rt.id && t.scope === 'harness')) bad(`red-team scenario ${rt.id} has a harness analogue and no harness test`);
  }
  const entry = cat.tests.filter((t) => t.entry);
  if (!entry.length) bad('entry criteria need at least one entry test');
  for (const t of entry) if (t.scope !== 'harness' || !['critical', 'high'].includes(t.severity)) bad(`${t.id}: an entry test must be a critical or high harness test`);
  return errors;
}

// ---------------------------------------------------------------- running
const SCRUB = ['NODE_TEST_CONTEXT', 'NODE_OPTIONS', 'NODE_PATH', 'NODE_REPL_EXTERNAL_MODULE'];
function redact(root, s) {
  let o = String(s);
  try { for (const p of readJson(path.join(root, 'harness/policy/secret-patterns.json')).redaction) o = o.replace(new RegExp(p, 'gi'), '[REDACTED]'); } catch { /* keep going */ }
  return o;
}
function parseTap(out) {
  const lines = String(out).replace(/\r/g, '').split('\n'); const top = [];
  lines.forEach((l, i) => {
    const m = /^(not ok|ok) (\d+) - (.*?)(?: # (SKIP|TODO)\b(.*))?$/.exec(l);
    if (m) top.push({ ok: m[1] === 'ok', name: m[3], directive: m[4] ?? null, index: i });
  });
  // the reporter prints its summary last, so the last summary line wins: a test cannot print an earlier one to inflate the counts
  const num = (k) => { const all = [...String(out).matchAll(new RegExp(`^# ${k} (\\d+)`, 'gm'))]; return all.length ? Number(all.at(-1)[1]) : null; };
  return { top, tests: num('tests'), pass: num('pass'), fail: num('fail'), skipped: num('skipped'), todo: num('todo'), cancelled: num('cancelled'), lines };
}
function failureDetail(parsed, entry, max) {
  const from = entry.index + 1; const out = [];
  for (let i = from; i < Math.min(parsed.lines.length, from + 40); i += 1) {
    const l = parsed.lines[i];
    if (/^(not ok|ok) \d+ - /.test(l)) break;
    const m = /^\s+(error|message):\s*(.*)$/.exec(l);
    if (m) { out.push(m[2].replace(/^[|>-]+$/, '')); }
    else if (out.length && /^\s{4,}\S/.test(l) && !/^\s+(code|name|expected|actual|operator|stack|location|failureType|duration_ms|type|\.\.\.|---)/.test(l)) out.push(l.trim());
    if (out.join(' ').length > max) break;
  }
  return text(out.join(' ')).slice(0, max);
}

function runProcess(ctx, argv) {
  const env = { ...process.env, CI: 'true' }; for (const k of SCRUB) delete env[k];
  const started = Date.now();
  const res = ctx.run(process.execPath, argv.slice(1), { cwd: ctx.root, env, encoding: 'utf8', timeout: ctx.policy.limits.timeoutSeconds * 1000, killSignal: 'SIGKILL', maxBuffer: ctx.policy.limits.outputMaxBytes });
  return { res, out: `${res.stdout ?? ''}${res.stderr ?? ''}`, durationMs: Date.now() - started, startedAt: new Date(started).toISOString() };
}

// What a status is, given the recorded evidence. The runner and verifyRun both use this, so a status that is not derivable
// from its evidence is detected.
function deriveStatus(t, ev) {
  if (!ev || typeof ev !== 'object') return { status: 'FAIL', actual: 'no evidence' };
  if (ev.ran === false) {
    if (t.mode === 'pending') return { status: 'PENDING', actual: `Not run: ${t.pendingReason}` };
    if (ev.blockedReason) return { status: 'BLOCKED', actual: `Not run: ${ev.blockedReason}` };
    return { status: 'FAIL', actual: 'not run and not blocked or pending' };
  }
  if (t.mode === 'pending') return { status: 'FAIL', actual: 'a pending test cannot have run' };
  const r = t.runner; const max = 300;
  if (ev.spawnError) return { status: 'FAIL', actual: `could not run: ${ev.spawnError}`.slice(0, max) };
  if (ev.signal) return { status: 'FAIL', actual: `killed by ${ev.signal} (time limit)` };
  if (r.type === 'eval-test') {
    const e = ev.parsed?.entry;
    if (!e) return { status: 'FAIL', actual: `the test did not run: no TAP result named ${t.id} (file exit ${ev.exitCode})` };
    if ((ev.parsed.matches ?? 0) !== 1) return { status: 'FAIL', actual: `${ev.parsed.matches} results named ${t.id} in the output: a result must appear exactly once` };
    const s = ev.parsed.summary ?? {};
    if (!Number.isInteger(s.tests) || s.tests !== s.rootCount) return { status: 'FAIL', actual: `the output has ${s.rootCount} top-level results but the reporter summary counts ${s.tests}: some output was not produced by the test reporter` };
    if (e.ok && ev.exitCode !== 0 && !(s.fail > 0)) return { status: 'FAIL', actual: `the result says ok but the file exited ${ev.exitCode} with no failed test reported` };
    if (e.directive) return { status: 'BLOCKED', actual: `skipped by the test file (${e.directive}); a skipped test is not a pass` };
    return e.ok ? { status: 'PASS', actual: `ran and passed: ${e.name.replace(`${t.id}:`, '').trim()}`.slice(0, max) } : { status: 'FAIL', actual: (ev.parsed.detail || `failed: ${e.name}`).slice(0, max) };
  }
  if (r.type === 'suite') {
    const p = ev.parsed ?? {}; const maxSkipped = r.maxSkipped ?? 0;
    const sum = (p.pass ?? 0) + (p.fail ?? 0) + (p.skipped ?? 0) + (p.todo ?? 0) + (p.cancelled ?? 0);
    if (!Number.isInteger(p.tests) || sum !== p.tests) return { status: 'FAIL', actual: `the reporter summary is inconsistent (${p.tests} tests, ${sum} counted)` };
    if (ev.exitCode !== 0 || (p.fail ?? 1) > 0 || p.cancelled) return { status: 'FAIL', actual: `exit ${ev.exitCode}; ${p.fail ?? '?'} failed of ${p.tests ?? '?'}${ev.firstFailure ? `; first: ${ev.firstFailure}` : ''}`.slice(0, max) };
    if ((p.pass ?? 0) < r.minPass) return { status: 'FAIL', actual: `only ${p.pass ?? 0} tests passed; at least ${r.minPass} must run, so this is not accepted as a pass` };
    if ((p.skipped ?? 0) + (p.todo ?? 0) > maxSkipped) return { status: 'BLOCKED', actual: `${p.pass} passed but ${(p.skipped ?? 0) + (p.todo ?? 0)} were skipped (${ev.skipNote ?? 'see the output'}); a skipped test did not run` };
    return { status: 'PASS', actual: `ran and passed: ${p.pass} tests, 0 failed, ${p.skipped ?? 0} skipped` };
  }
  const exits = [].concat(r.expect.exit);
  if (!exits.includes(ev.exitCode)) return { status: 'FAIL', actual: `exit ${ev.exitCode}, expected ${exits.join(' or ')}`.slice(0, max) };
  if (r.expect.match && !ev.matched) return { status: 'FAIL', actual: `exit ${ev.exitCode} as expected but the output did not contain /${r.expect.match}/` };
  return { status: 'PASS', actual: `ran and passed: exit ${ev.exitCode}${r.expect.match ? `, output contained /${r.expect.match}/` : ''}`.slice(0, max) };
}

function executeTest(ctx, t, cache) {
  const argv = argvOf(t); const r = t.runner;
  const cp = commandProblems(ctx, argv);
  if (cp) return { ran: false, blockedReason: `the runner refused the command: ${cp}` };
  const key = argv.join(' ');
  let proc = (r.type === 'command') ? null : cache.get(key);
  if (!proc) { proc = runProcess(ctx, argv); if (r.type !== 'command') cache.set(key, proc); }
  const { res, out } = proc;
  const ev = { ran: true, argv, exitCode: res.status, signal: res.signal ?? null, spawnError: res.error?.message ?? null, startedAt: proc.startedAt, durationMs: proc.durationMs, outputSha256: sha256(out), outputBytes: Buffer.byteLength(out), outputTail: redact(ctx.root, out.slice(-ctx.policy.limits.outputTailBytes)) };
  if (r.type === 'command') ev.matched = r.expect.match ? new RegExp(r.expect.match).test(out) : null;
  else {
    const p = parseTap(out);
    if (r.type === 'eval-test') {
      const named = p.top.filter((e) => e.name === t.id || e.name.startsWith(`${t.id}:`) || e.name.startsWith(`${t.id} `));
      const entry = named.find((e) => !e.ok) ?? named[0];
      ev.parsed = { matches: named.length, summary: { tests: p.tests, fail: p.fail, rootCount: p.top.length }, entry: entry ? { ok: entry.ok, name: entry.name, directive: entry.directive } : null, detail: entry && !entry.ok ? failureDetail(p, entry, ctx.policy.limits.actualMax) : '' };
    } else {
      ev.parsed = { tests: p.tests, pass: p.pass, fail: p.fail, skipped: p.skipped, todo: p.todo, cancelled: p.cancelled };
      const f = p.top.find((e) => !e.ok); if (f) ev.firstFailure = f.name.slice(0, 120);
      const s = p.top.find((e) => e.directive); if (s) ev.skipNote = s.name.slice(0, 120);
    }
  }
  return ev;
}

// ---------------------------------------------------------------- gates and hard constraints
function evaluateGates(policy, tests, results) {
  const status = (id) => results.get(id)?.status ?? 'MISSING';
  const entryTests = tests.filter((t) => t.entry);
  const entryFailed = entryTests.filter((t) => status(t.id) !== 'PASS').map((t) => t.id);
  // a failing critical or hard-constraint test blocks every gate even when it belongs to none, so it cannot be hidden by gate assignment
  const globalFailed = tests.filter((t) => !t.gate && status(t.id) === 'FAIL' && (t.severity === 'critical' || (t.hardConstraints ?? []).length > 0)).map((t) => t.id);
  const out = [];
  for (const g of policy.gates) {
    const mine = tests.filter((t) => t.gate === g.id);
    const failing = mine.filter((t) => status(t.id) === 'FAIL');
    const notPass = mine.filter((t) => status(t.id) !== 'PASS');
    const critical = failing.some((t) => t.severity === 'critical' || (t.hardConstraints ?? []).length > 0);
    const blockedBy = g.dependsOn.filter((d) => out.find((x) => x.id === d)?.status !== 'PASS');
    let st; let reason;
    if (failing.length) { st = 'FAIL'; reason = `${failing.length} failing test(s): ${failing.map((t) => t.id).join(', ')}${critical ? ' (critical)' : ''}`; }
    else if (entryFailed.length) { st = 'BLOCKED'; reason = `entry criteria not met: ${entryFailed.join(', ')} is not PASS, so the controls that protect the evaluation cannot be trusted`; }
    else if (globalFailed.length) { st = 'BLOCKED'; reason = `a critical or hard-constraint test outside any gate failed: ${globalFailed.join(', ')}`; }
    else if (blockedBy.length) { st = 'BLOCKED'; reason = `${blockedBy.join(', ')} is not PASS`; }
    else if (!mine.length) { st = 'INCOMPLETE'; reason = 'the gate has no tests'; }
    else if (notPass.length) { st = 'INCOMPLETE'; reason = `${notPass.length} of ${mine.length} required tests are not PASS (${[...new Set(notPass.map((t) => status(t.id)))].join(', ')})`; }
    else { st = 'PASS'; reason = `all ${mine.length} required tests are PASS`; }
    out.push({ id: g.id, title: g.title, status: st, critical, reason, tests: mine.length, pass: mine.length - notPass.length, failing: failing.map((t) => t.id), blockedBy, progression: st === 'PASS' ? 'allowed' : 'blocked' });
  }
  return out;
}
function hardConstraintMatrix(policy, tests, results) {
  return policy.hardConstraints.map((hc) => {
    const ts = tests.filter((t) => (t.hardConstraints ?? []).includes(hc));
    const st = (t) => results.get(t.id)?.status ?? 'MISSING';
    const failing = ts.filter((t) => st(t) === 'FAIL').map((t) => t.id);
    const passed = ts.filter((t) => st(t) === 'PASS').length;
    const verdict = failing.length ? 'VIOLATED' : !ts.length ? 'NO TEST' : passed === ts.length ? 'NO TEST FAILED' : passed ? 'PARTIAL' : 'UNVERIFIED';
    return { id: hc, verdict, failing, tests: ts.map((t) => ({ id: t.id, status: st(t) })) };
  });
}
const counts = (results) => { const c = { PASS: 0, FAIL: 0, BLOCKED: 0, PENDING: 0 }; for (const r of results.values()) c[r.status] += 1; return c; };

// ---------------------------------------------------------------- a run
function runEvaluation(ctx, opts = {}) {
  const problems = validateCatalogue(ctx);
  if (problems.length) throw new EvalError('CATALOGUE', `the catalogue is not valid: ${problems.slice(0, 5).join('; ')}`, problems);
  const cat = loadCatalogue(ctx); const P = ctx.policy;
  const select = (t) => (!opts.ids || opts.ids.includes(t.id)) && (!opts.suite || (opts.suite === 'harness') === (t.scope === 'harness')) && (!opts.domain || t.domain === opts.domain);
  const chosen = cat.tests.filter(select);
  if (!chosen.length) throw new EvalError('SELECTION', 'no test matches the selection');
  const partial = chosen.length !== cat.tests.length;
  const runId = `EVRUN-${crypto.randomBytes(5).toString('hex')}`;
  const dir = path.join(ctx.runsDir, runId); fs.mkdirSync(path.join(dir, 'results'), { recursive: true });
  const evidence = new Map(); const results = new Map(); const cache = new Map();
  const finishTest = (t, ev) => {
    const d = deriveStatus(t, ev);
    const body = `${JSON.stringify({ schema: 'greenfuel.eval-evidence/v1', testId: t.id, ...ev, status: d.status, actual: d.actual }, null, 2)}\n`;
    fs.writeFileSync(path.join(dir, 'results', `${t.id}.json`), body);
    evidence.set(t.id, ev);
    results.set(t.id, { id: t.id, status: d.status, actual: d.actual, evidenceRef: `results/${t.id}.json`, evidenceSha256: sha256(body) });
  };
  const runnable = (t) => t.mode === 'executable' && !(t.requires ?? []).length;
  for (const t of chosen) { if (t.mode === 'pending') finishTest(t, { ran: false }); else if (runnable(t)) finishTest(t, executeTest(ctx, t, cache)); }
  // tests with a required gate run only when that gate PASSed on the results so far; a partial run cannot show it, so they are blocked
  let gates = [];
  for (const g of P.gates) {
    for (const t of chosen.filter((x) => x.gate === g.id && x.mode === 'executable' && (x.requires ?? []).length)) {
      const unmet = (x) => (partial ? 'not evaluated in a partial run' : gates.find((y) => y.id === x)?.status ?? 'unknown');
      const notPass = t.requires.filter((x) => (partial ? true : gates.find((y) => y.id === x)?.status !== 'PASS'));
      if (notPass.length) finishTest(t, { ran: false, blockedReason: `required gate ${notPass.map((x) => `${x} is ${unmet(x)}`).join(', ')}; this test must not run before it passes` });
      else finishTest(t, executeTest(ctx, t, cache));
    }
    gates = evaluateGates({ ...P, gates: P.gates.slice(0, P.gates.indexOf(g) + 1) }, cat.tests.filter((t) => partial ? chosen.includes(t) : true), results);
  }
  const all = cat.tests.filter((t) => !partial || chosen.includes(t));
  const run = {
    schema: 'greenfuel.eval-run/v1', runId, startedAt: iso(ctx), partial, selection: JSON.parse(JSON.stringify(opts)), gitHead: gitOut(ctx.root, ['rev-parse', 'HEAD']), workingTreeDirty: Boolean(gitOut(ctx.root, ['status', '--porcelain', '--', '.', ':(exclude)docs/evaluation/runs'])),
    node: process.version, platform: process.platform, catalogueSha256: cat.sha256, policySha256: sha256(canonical(P)),
    tests: [...results.values()].sort((a, b) => a.id.localeCompare(b.id)),
    gates: partial ? [] : evaluateGates(P, all, results), hardConstraints: hardConstraintMatrix(P, cat.tests, results), counts: counts(results),
  };
  run.integritySha256 = integrityOf(run);
  fs.writeFileSync(path.join(dir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
  return { runId, dir, run };
}
// The integrity hash covers the results and the run's metadata, so a changed start time, commit, selection or count is detected.
// It is a checksum, not a signature: someone who can rewrite the whole run directory consistently can recompute it (see the limits).
const integrityOf = (run) => sha256(canonical({ runId: run.runId, startedAt: run.startedAt, partial: run.partial, selection: run.selection, gitHead: run.gitHead, workingTreeDirty: run.workingTreeDirty, catalogueSha256: run.catalogueSha256, policySha256: run.policySha256, counts: run.counts, tests: run.tests, gates: run.gates, hardConstraints: run.hardConstraints }));
function gitOut(root, args) { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; }

// Re-derives every status from its evidence and recomputes the gates, so an edited status or gate is found.
function verifyRun(ctx, runId) {
  const problems = []; const dir = path.join(ctx.runsDir, runId);
  if (!RUN_RE.test(runId) || !fs.existsSync(path.join(dir, 'run.json'))) return { ok: false, problems: [`no run ${runId}`] };
  const run = readJson(path.join(dir, 'run.json')); const cat = loadCatalogue(ctx);
  const byId = new Map(cat.tests.map((t) => [t.id, t])); const results = new Map();
  for (const r of run.tests) {
    const t = byId.get(r.id); const f = path.join(dir, r.evidenceRef);
    if (r.evidenceRef !== `results/${r.id}.json`) { problems.push(`${r.id}: evidenceRef must be exactly results/${r.id}.json`); continue; }
    if (!t) { problems.push(`${r.id}: not in the catalogue`); continue; }
    if (!fs.existsSync(f)) { problems.push(`${r.id}: evidence file missing`); continue; }
    const body = fs.readFileSync(f, 'utf8');
    if (sha256(body) !== r.evidenceSha256) { problems.push(`${r.id}: evidence file altered`); continue; }
    const ev = JSON.parse(body); const d = deriveStatus(t, ev);
    if (d.status !== r.status || ev.status !== r.status) problems.push(`${r.id}: recorded ${r.status} but the evidence derives ${d.status}`);
    if (r.status === 'PASS' && ev.ran !== true) problems.push(`${r.id}: PASS without evidence that it ran`);
    results.set(r.id, { id: r.id, status: d.status });
  }
  const all = cat.tests.filter((t) => !run.partial || results.has(t.id));
  if (!run.partial) {
    for (const t of cat.tests) if (!results.has(t.id)) problems.push(`${t.id}: no result in a full run`);
    const gates = evaluateGates(ctx.policy, all, results);
    if (canonical(gates) !== canonical(run.gates)) problems.push('the recorded gates differ from the gates derived from the results');
  }
  if (canonical(hardConstraintMatrix(ctx.policy, cat.tests, results)) !== canonical(run.hardConstraints)) problems.push('the recorded hard-constraint matrix differs from the one derived from the results');
  const counted = { PASS: 0, FAIL: 0, BLOCKED: 0, PENDING: 0 }; for (const r of results.values()) counted[r.status] += 1;
  if (canonical(counted) !== canonical(run.counts)) problems.push('the recorded counts differ from the counts derived from the results');
  if (integrityOf(run) !== run.integritySha256) problems.push('run.json integrity hash does not match');
  if (run.catalogueSha256 !== cat.sha256) problems.push('note: the catalogue changed since this run (the run is still internally consistent)');
  return { ok: problems.filter((p) => !p.startsWith('note:')).length === 0, problems, runId, tests: run.tests.length };
}
const listRuns = (ctx) => (fs.existsSync(ctx.runsDir) ? fs.readdirSync(ctx.runsDir).filter((d) => RUN_RE.test(d)).sort() : []);

function latestFullRun(ctx) {
  let best = null;
  for (const id of listRuns(ctx)) { const run = readJson(path.join(ctx.runsDir, id, 'run.json')); if (!run.partial && (!best || run.startedAt > best.run.startedAt)) best = { id, run }; }
  return best;
}
// Differences between a fresh run and the committed one. A difference is allowed only when the policy lists that test with the exact
// status the fresh run may report and a reason; anything else, including a different gate or hard-constraint verdict, is a difference.
function compareRuns(policy, fresh, committed) {
  const allowed = new Map((policy.ciRerun?.allowedDifferences ?? []).map((a) => [a.id, a]));
  const diffs = []; const old = new Map(committed.tests.map((t) => [t.id, t.status])); const now = new Map(fresh.tests.map((t) => [t.id, t.status]));
  for (const id of new Set([...old.keys(), ...now.keys()])) {
    if (old.get(id) === now.get(id)) continue;
    const a = allowed.get(id);
    if (a && now.get(id) === a.status) continue;
    diffs.push(`${id}: committed ${old.get(id) ?? 'absent'}, re-run ${now.get(id) ?? 'absent'}`);
  }
  const g = (r) => JSON.stringify(r.gates.map((x) => [x.id, x.status])); if (g(fresh) !== g(committed)) diffs.push(`gates differ: committed ${g(committed)}, re-run ${g(fresh)}`);
  const h = (r) => JSON.stringify(r.hardConstraints.map((x) => [x.id, x.verdict])); if (h(fresh) !== h(committed)) diffs.push('hard-constraint verdicts differ from the committed run');
  return diffs;
}
// Re-runs the whole evaluation into a temporary folder and compares it with the latest committed full run. Nothing is committed.
function rerun(ctx) {
  const committed = latestFullRun(ctx);
  if (!committed) throw new EvalError('NO_COMMITTED_RUN', 'there is no committed full run to compare with');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-rerun-'));
  try {
    const nctx = { ...ctx, runsDir: tmp };
    const r = runEvaluation(nctx); const v = verifyRun(nctx, r.runId);
    const differences = [...v.problems.filter((p) => !p.startsWith('note:')), ...compareRuns(ctx.policy, r.run, committed.run)];
    return { ok: differences.length === 0, committedRun: committed.id, counts: r.run.counts, gates: r.run.gates.map((x) => `${x.id} ${x.status}`), differences, allowed: (ctx.policy.ciRerun?.allowedDifferences ?? []).map((a) => a.id) };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------- report
function renderReport(ctx, runId) {
  if (!RUN_RE.test(runId)) throw new EvalError('RUN', `'${text(runId).slice(0, 40)}' is not a run id`);
  const verified = verifyRun(ctx, runId);
  if (!verified.ok) throw new EvalError('UNVERIFIED', `run ${runId} does not verify, so no report is rendered: ${verified.problems.slice(0, 3).join('; ')}`);
  const dir = path.join(ctx.runsDir, runId); const run = readJson(path.join(dir, 'run.json')); const cat = loadCatalogue(ctx);
  const byId = new Map(cat.tests.map((t) => [t.id, t])); const res = new Map(run.tests.map((r) => [r.id, r]));
  const cell = (s) => text(s).replace(/\|/g, '/');
  const L = [`<!-- generated: node harness/scripts/evaluate.mjs report --run ${runId} --write -->`, '# Evaluation report', '',
    `Generated from run \`${runId}\` (commit \`${(run.gitHead ?? 'unknown').slice(0, 7)}\`${run.workingTreeDirty ? ', working tree was not clean' : ''}, ${run.startedAt}). Do not edit: \`validate-evaluation\` regenerates this file from the run and fails on any difference. Evidence for every row is the file named in its Evidence column, hashed in \`run.json\`.`, '',
    `**Result counts (information only, nothing is decided by them):** PASS ${run.counts.PASS}, FAIL ${run.counts.FAIL}, BLOCKED ${run.counts.BLOCKED}, PENDING ${run.counts.PENDING}. A PENDING or BLOCKED test is **not** a pass. There is no score.`, ''];
  const viol = run.hardConstraints.filter((h) => h.verdict === 'VIOLATED');
  L.push('## Hard constraints', '', viol.length ? `**${viol.length} hard constraint(s) have a failing test: ${viol.map((v) => v.id).join(', ')}. This stands whatever the gates say.**` : 'No hard-constraint test failed in this run. That is not a claim that any constraint is satisfied: see the verdicts.', '', '| Constraint | Verdict | Tests |', '|---|---|---|');
  for (const h of run.hardConstraints) L.push(`| ${h.id} | ${h.verdict} | ${h.tests.map((t) => `${t.id} ${t.status}`).join('; ') || 'none'} |`);
  L.push('', '`NO TEST FAILED` means every test that guards the constraint passed; `PARTIAL` and `UNVERIFIED` mean some or all of them are pending, blocked or absent.', '');
  if (run.partial) L.push('## Gates', '', 'This was a partial run, so the gates were not evaluated.', '');
  else { L.push('## Quality gates', '', ...ctx.policy.gateRules.map((r) => `- ${r}`), '', '| Gate | Status | Progression | Why |', '|---|---|---|---|'); for (const g of run.gates) L.push(`| ${g.id} ${cell(g.title)} | **${g.status}**${g.critical ? ' (critical)' : ''} | ${g.progression} | ${cell(g.reason)} |`); L.push(''); }
  const section = (title, intro, filter) => {
    const rows = run.tests.filter((r) => filter(byId.get(r.id)));
    L.push(`## ${title}`, '', intro, '', '| Test ID | Requirement ID | Scenario | Expected outcome | Actual outcome | Evidence | Severity | Status | Remediation |', '|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) { const t = byId.get(r.id); L.push(`| ${t.id} | ${cell(t.requirements.join(', '))} | ${cell(t.scenario)} | ${cell(t.expected)} | ${cell(r.actual)} | \`${r.evidenceRef}\` (${r.evidenceSha256.slice(0, 10)}) | ${t.severity} | **${r.status}** | ${cell(t.remediation)} |`); }
    L.push('');
  };
  section('Coding-harness suite', ctx.policy.scopes.harness, (t) => t.scope === 'harness');
  section('Production suite: candidate contracts', ctx.policy.scopes['production-contract'], (t) => t.scope === 'production-contract');
  section('Production suite: future production agents and platform', ctx.policy.scopes['production-agent'], (t) => t.scope === 'production-agent');
  L.push('## Red-team scenarios', '', '| Scenario | Harness suite | Contract checks | Production agents |', '|---|---|---|---|');
  for (const rt of ctx.policy.redTeam) { const col = (scope) => run.tests.filter((r) => byId.get(r.id).redTeam === rt.id && byId.get(r.id).scope === scope).map((r) => `${r.id} ${r.status}`).join('; ') || 'n/a'; L.push(`| ${rt.id} ${cell(rt.title)} | ${col('harness')} | ${col('production-contract')} | ${col('production-agent')} |`); }
  L.push('', '## Domains', '', '| Domain | PASS | FAIL | BLOCKED | PENDING |', '|---|---|---|---|---|');
  for (const d of ctx.policy.domains) { const c = { PASS: 0, FAIL: 0, BLOCKED: 0, PENDING: 0 }; for (const r of run.tests) if (byId.get(r.id).domain === d.id) c[r.status] += 1; L.push(`| ${d.id} ${d.title} | ${c.PASS} | ${c.FAIL} | ${c.BLOCKED} | ${c.PENDING} |`); }
  return `${L.join('\n')}\n`;
}

module.exports = { ROOT, EvalError, makeContext, loadCatalogue, validateCatalogue, parseTap, deriveStatus, evaluateGates, hardConstraintMatrix, runEvaluation, verifyRun, listRuns, latestFullRun, compareRuns, rerun, renderReport, knownRequirementIds, commandProblems, argvOf };
