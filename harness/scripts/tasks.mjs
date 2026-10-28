#!/usr/bin/env node
// Task-execution CLI. Every rule lives in harness/orchestration/engine.cjs; this file only parses arguments and prints.
//   plan:      check-plan --file plan.json [--json]            validate a plan without creating anything
//              init --file plan.json [--draft-source s --draft-attempts n]   validate and create (or find) the run
//   inspect:   list | status [--run id] [--json] | next [--run id] | verify --run id | trace --run id [--write] | report --run id [--write]
//   drive:     start --run id --task T --agent a [--prompt-file f] | submit --run id --task T [--result-file f --source s]
//              validate --run id --task T | fail --run id --task T [--class C] --message m | retry | block | unblock | cancel | reopen
//              release --run id --task T --reason r      (an attempt that never ran, e.g. the tool rejected a malformed call; refunds the attempt)
//              close --run id --reason r                 (a human concludes a run that is NEEDS_HUMAN or STOPPED; approves nothing)
//   people:    pause-approval --run id --task T --tier P2 --reason r | approval-request --run id --task T [--tier P2 --reason r --decision approve|reject --out f]
//              approve --run id --task T --file signed.json      (sign the request first with: node harness/scripts/approval.mjs sign --file f --key k)
//   recovery:  resume --run id | checkpoint --run id [--label l] | cancel --run id [--reason r]
// Exit codes: 0 done, 1 refused or invalid (a normal, logged outcome), 2 usage or engine error, 3 integrity failure.
// `--actor` names the caller in the event log. It is self-declared; only calls made by a hook carry a verified identity.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const engine = require('../orchestration/engine.cjs');
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i > 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (n) => argv.includes(`--${n}`);
const out = (o) => console.log(flag('json') ? JSON.stringify(o, null, 2) : typeof o === 'string' ? o : JSON.stringify(o, null, 2));

function pickRun(ctx) {
  const r = opt('run');
  if (r) return r;
  const open = engine.listRuns(ctx).filter((x) => ['ACTIVE', 'NEEDS_HUMAN'].includes(x.state));
  if (open.length === 1) return open[0].runId;
  throw new Error(open.length ? `several runs are open (${open.map((x) => x.runId).join(', ')}); pass --run` : 'no open run; pass --run');
}
const need = (n) => { const v = opt(n); if (!v) throw new Error(`--${n} is required`); return v; };

function main() {
  const ctx = engine.makeContext({ runsDir: process.env.HARNESS_RUNS_DIR });
  const actor = opt('actor', 'operator');
  switch (cmd) {
    case 'check-plan': {
      const v = engine.validatePlan(readFileSync(need('file'), 'utf8'), ctx);
      if (flag('json')) out({ ok: v.ok, errors: v.errors, warnings: v.warnings, order: v.order, levels: v.levels, criticalPath: v.criticalPath, needsApproval: v.needsApproval, planHash: v.planHash });
      else {
        for (const e of v.errors) console.log(`ERROR  ${e.task}/${e.code}: ${e.msg}`);
        for (const w of v.warnings) console.log(`WARN   ${w.task}/${w.code}: ${w.msg}`);
        console.log(v.ok ? `plan OK: ${v.summary.tasks} tasks in ${v.summary.levels} level(s); critical path ${v.criticalPath.join(' > ')}; hash ${v.planHash.slice(0, 16)}` : `plan INVALID: ${v.errors.length} problem(s)`);
      }
      return v.ok ? 0 : 1;
    }
    case 'init': {
      const r = engine.initRun(ctx, readFileSync(need('file'), 'utf8'), { actor, detail: { draftSource: opt('draft-source'), draftAttempts: opt('draft-attempts') ? Number(opt('draft-attempts')) : undefined } });
      out(r); return 0;
    }
    case 'list': out(engine.listRuns(ctx)); return 0;
    case 'status': {
      const run = engine.loadRun(ctx, pickRun(ctx));
      const s = engine.summarize(run);
      if (flag('json')) { out(s); return 0; }
      console.log(`${s.runId} ${s.state} rev ${s.rev}: ${s.title}`);
      for (const t of s.tasks) console.log(`  ${t.id.padEnd(4)} ${t.status.padEnd(17)} ${t.agent.padEnd(20)} attempts ${t.attempts}/${t.maxAttempts}${t.verdict ? ` verdict ${t.verdict}` : ''}${t.lastError ? ` last error ${t.lastError.class}` : ''}`);
      for (const a of s.attention) console.log(`  ! ${a}`);
      return 0;
    }
    case 'next': { const run = engine.loadRun(ctx, pickRun(ctx)); out(engine.nextActions(ctx, run)); return 0; }
    case 'verify': { const v = engine.verifyRun(ctx, need('run')); out(v); return v.ok ? 0 : 3; }
    case 'trace': case 'report': {
      const id = need('run');
      const text = cmd === 'trace' ? engine.renderTrace(ctx, id) : engine.renderReport(ctx, id);
      if (flag('write')) { const f = path.join(engine.runDir(ctx, id), cmd === 'trace' ? 'TRACE.md' : 'REPORT.md'); writeFileSync(f, text); console.log(`wrote ${path.relative(process.cwd(), f)}`); } else console.log(text);
      return 0;
    }
    case 'start': {
      const pf = opt('prompt-file');
      const r = engine.start(ctx, need('run'), need('task'), { agent: need('agent'), promptSha256: pf ? crypto.createHash('sha256').update(readFileSync(pf, 'utf8')).digest('hex') : opt('prompt-sha'), mode: opt('mode', 'sync'), actor });
      out(r); return 0;
    }
    case 'submit': {
      const rf = opt('result-file');
      const r = engine.submit(ctx, need('run'), need('task'), { resultText: rf ? readFileSync(rf, 'utf8') : undefined, source: opt('source', `cli: ${actor}`), actor });
      out({ outcome: r.outcome, idempotent: r.idempotent, state: r.state, checks: r.results?.map((c) => `${c.ok ? 'pass' : c.skipped ? 'pending' : 'FAIL'} ${c.id}: ${c.detail}`) });
      return r.outcome === 'failed' ? 1 : 0;
    }
    case 'validate': {
      const r = engine.validateTask(ctx, need('run'), need('task'), { actor });
      out({ outcome: r.outcome, state: r.state, checks: r.results?.map((c) => `${c.ok ? 'pass' : c.skipped ? 'pending' : 'FAIL'} ${c.id}: ${c.detail}`) });
      return r.outcome === 'failed' ? 1 : 0;
    }
    case 'fail': { out(engine.fail(ctx, need('run'), need('task'), { errorClass: opt('class'), message: need('message'), actor })); return 0; }
    case 'retry': { out(engine.retry(ctx, need('run'), need('task'), { reason: opt('reason'), actor })); return 0; }
    case 'block': { out(engine.block(ctx, need('run'), need('task'), { reason: need('reason'), actor })); return 0; }
    case 'unblock': { out(engine.unblock(ctx, need('run'), need('task'), { reason: need('reason'), actor })); return 0; }
    case 'cancel': { out(opt('task') ? engine.cancelTask(ctx, need('run'), opt('task'), { reason: opt('reason'), actor }) : engine.cancelRun(ctx, need('run'), { reason: opt('reason'), actor })); return 0; }
    case 'reopen': { out(engine.reopen(ctx, need('run'), need('task'), { reason: need('reason'), actor })); return 0; }
    case 'pause-approval': { out(engine.pauseForApproval(ctx, need('run'), need('task'), { tier: need('tier'), reason: need('reason'), actor })); return 0; }
    case 'release': { out(engine.release(ctx, need('run'), need('task'), { reason: need('reason'), actor })); return 0; }
    case 'close': { out(engine.closeRun(ctx, need('run'), { reason: need('reason'), actor })); return 0; }
    case 'approval-request': {
      const rec = engine.requestApproval(ctx, need('run'), need('task'), { tier: opt('tier'), reason: opt('reason', ''), decision: opt('decision', 'approve') });
      if (opt('out')) { writeFileSync(opt('out'), `${JSON.stringify(rec, null, 2)}\n`, { flag: 'wx' }); console.log(`request ${rec.id} written to ${opt('out')}; read it, then sign it with approval.mjs sign`); } else out(rec);
      return 0;
    }
    case 'approve': { out(engine.applyApproval(ctx, need('run'), need('task'), JSON.parse(readFileSync(need('file'), 'utf8')), { actor })); return 0; }
    case 'resume': { out(engine.resume(ctx, need('run'), { actor })); return 0; }
    case 'checkpoint': { out(engine.checkpoint(ctx, need('run'), { label: opt('label'), actor })); return 0; }
    default:
      console.error('usage: tasks.mjs <check-plan|init|list|status|next|verify|trace|report|start|submit|validate|fail|retry|block|unblock|cancel|reopen|release|close|pause-approval|approval-request|approve|resume|checkpoint> [options] (see the header of this file)');
      return 2;
  }
}

try { process.exitCode = main(); } catch (e) {
  const code = e.code === 'INTEGRITY' ? 3 : e instanceof engine.Refusal ? 1 : 2;
  console.error(`tasks: ${e.code ? `[${e.code}] ` : ''}${e.message}`);
  if (e.code === 'PLAN_INVALID' && Array.isArray(e.detail)) for (const d of e.detail.slice(0, 15)) console.error(`  ${d.task}/${d.code}: ${d.msg}`);
  process.exitCode = code;
}
