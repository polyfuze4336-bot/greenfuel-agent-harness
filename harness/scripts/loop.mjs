#!/usr/bin/env node
// Human-run command line for the bounded repair loop. Agents have no shell and cannot run this (it is not on any agent's command
// allow-list) and the loop store is a control-plane path, so only a person (or CI) starts, ends and verifies a loop. Exit codes:
// 0 ok, 1 the loop is not in a passing state or a check failed, 2 usage or refusal, 3 stopped or escalated to a person.
//
//   loop.mjs init --task task.json --workspace .harness-work/name     create a loop (PLAN)
//   loop.mjs begin --loop LOOP-x                                      open the first or the next repair attempt
//   loop.mjs end --loop LOOP-x [--summary "..."] [--actions actions.json]   close the attempt; changes are observed and screened
//   loop.mjs verify --loop LOOP-x                                     the loop runs the declared checks
//   loop.mjs diagnose --loop LOOP-x --file diagnosis.json             required after a failed repair
//   loop.mjs critique --loop LOOP-x --reviewer architecture-critic --verdict APPROVE|REWORK|BLOCK [--findings "..."]
//   loop.mjs resume --loop LOOP-x      loop.mjs status --loop LOOP-x      loop.mjs list
//   loop.mjs cancel --loop LOOP-x --reason "..."      loop.mjs verify-store --loop LOOP-x      loop.mjs report --loop LOOP-x [--write]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const loop = require('../loop/loop.cjs');

const argv = process.argv.slice(2);
const flags = {}; const pos = [];
for (let i = 0; i < argv.length; i += 1) { const a = argv[i]; if (a.startsWith('--')) { const n = argv[i + 1]; if (n === undefined || n.startsWith('--')) flags[a.slice(2)] = true; else { flags[a.slice(2)] = n; i += 1; } } else pos.push(a); }
const out = (o) => console.log(JSON.stringify(o, null, 2));
const usage = (m) => { out({ ok: false, error: 'USAGE', message: m }); process.exit(2); };
const readFile = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return usage(`cannot read ${f}: ${e.message}`); } };
const id = flags.loop;
const ctx = loop.makeContext({ actor: typeof flags.actor === 'string' ? flags.actor : 'operator' });
const exitFor = (r) => (r?.state === 'PASSED' ? 0 : ['STOPPED', 'ESCALATED'].includes(r?.state) ? 3 : 1);

try {
  switch (pos[0]) {
    case 'init': {
      if (typeof flags.task !== 'string' || typeof flags.workspace !== 'string') usage('--task and --workspace are required');
      const r = loop.init(ctx, { task: readFile(flags.task), workspace: flags.workspace, createdBy: ctx.actor }); out({ ok: true, ...r }); break;
    }
    case 'begin': out({ ok: true, ...loop.begin(ctx, id) }); break;
    case 'end': { const r = loop.end(ctx, id, { summary: typeof flags.summary === 'string' ? flags.summary : '', actions: typeof flags.actions === 'string' ? readFile(flags.actions) : [] }); out({ ok: !r.outcome, ...r }); process.exit(r.outcome ? 3 : 0); break; }
    case 'verify': { const r = loop.verify(ctx, id); out({ ok: r.state === 'PASSED', ...r }); process.exit(exitFor(r)); break; }
    case 'diagnose': out({ ok: true, ...loop.diagnose(ctx, id, readFile(flags.file)) }); break;
    case 'critique': { const r = loop.critique(ctx, id, { reviewer: flags.reviewer, verdict: flags.verdict, findings: typeof flags.findings === 'string' ? flags.findings : '' }); out({ ok: r.state === 'PASSED', ...r }); process.exit(exitFor(r)); break; }
    case 'resume': out({ ok: true, ...loop.resume(ctx, id) }); break;
    case 'cancel': out({ ok: true, ...loop.cancel(ctx, id, flags.reason) }); break;
    case 'status': out({ ok: true, ...loop.statusView(ctx, id) }); break;
    case 'list': out({ ok: true, loops: loop.listLoops(ctx).map((l) => { const s = loop.statusView(ctx, l); return { loopId: l, state: s.state, title: s.title, outcome: s.outcome?.class ?? null, integrity: s.integrity.ok }; }) }); break;
    case 'verify-store': { const v = loop.verifyLoop(ctx, id); out(v); process.exit(v.ok ? 0 : 1); break; }
    case 'report': {
      const md = loop.renderReport(ctx, id);
      if (flags.write) { const f = path.join(ctx.loopsDir, id, 'LOOP-TRACE.md'); fs.writeFileSync(f, `${md}\n`); out({ ok: true, wrote: path.relative(process.cwd(), f) }); } else console.log(md);
      break;
    }
    default: usage('commands: init begin end verify diagnose critique resume cancel status list verify-store report');
  }
} catch (e) {
  if (e instanceof loop.LoopError) { out({ ok: false, error: e.code, message: e.message }); process.exit(2); }
  out({ ok: false, error: 'ERROR', message: e.message }); process.exit(2);
}
