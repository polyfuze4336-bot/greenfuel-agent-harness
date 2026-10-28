#!/usr/bin/env node
// Exit codes: 0 ok, 1 a verification or catalogue problem, 2 usage or refusal, 3 a completed run that blocks progression
// (a failing test, a violated hard constraint, or a gate that is not PASS). The run is still recorded.
//
//   evaluate.mjs validate                                         check the catalogue
//   evaluate.mjs run [--suite harness|production] [--domain SEC] [--ids EVAL-...,EVAL-...]   run executable tests, record evidence
//   evaluate.mjs verify --run EVRUN-x                             re-derive every status and gate from the recorded evidence
//   evaluate.mjs report --run EVRUN-x [--write]                   render the report (--write: docs/evaluation/EVALUATION-REPORT.md)
//   evaluate.mjs gates --run EVRUN-x                              print the gate table      evaluate.mjs list
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ev = require('../eval/eval.cjs');

const argv = process.argv.slice(2); const flags = {}; const pos = [];
for (let i = 0; i < argv.length; i += 1) { const a = argv[i]; if (a.startsWith('--')) { const n = argv[i + 1]; if (n === undefined || n.startsWith('--')) flags[a.slice(2)] = true; else { flags[a.slice(2)] = n; i += 1; } } else pos.push(a); }
const out = (o) => console.log(JSON.stringify(o, null, 2));
const usage = (m) => { out({ ok: false, error: 'USAGE', message: m }); process.exit(2); };
const ctx = ev.makeContext();

try {
  switch (pos[0]) {
    case 'validate': { const p = ev.validateCatalogue(ctx); out({ ok: !p.length, problems: p }); process.exit(p.length ? 1 : 0); break; }
    case 'run': {
      const r = ev.runEvaluation(ctx, { suite: typeof flags.suite === 'string' ? flags.suite : undefined, domain: typeof flags.domain === 'string' ? flags.domain : undefined, ids: typeof flags.ids === 'string' ? flags.ids.split(',') : undefined });
      const blocked = r.run.tests.some((t) => t.status === 'FAIL') || r.run.hardConstraints.some((h) => h.verdict === 'VIOLATED') || (!r.run.partial && r.run.gates.some((g) => g.status !== 'PASS'));
      out({ ok: true, runId: r.runId, partial: r.run.partial, counts: r.run.counts, gates: r.run.gates.map((g) => `${g.id} ${g.status}`), hardConstraintsViolated: r.run.hardConstraints.filter((h) => h.verdict === 'VIOLATED').map((h) => h.id), progression: r.run.partial ? 'not evaluated (partial run)' : blocked ? 'blocked' : 'allowed', tests: r.run.tests.map((t) => `${t.id} ${t.status}`) });
      process.exit(blocked ? 3 : 0);
      break;
    }
    case 'verify': { if (typeof flags.run !== 'string') usage('--run is required'); const v = ev.verifyRun(ctx, flags.run); out(v); process.exit(v.ok ? 0 : 1); break; }
    case 'report': {
      if (typeof flags.run !== 'string') usage('--run is required');
      const md = ev.renderReport(ctx, flags.run);
      if (flags.write) { const f = path.join(ctx.root, 'docs/evaluation/EVALUATION-REPORT.md'); fs.writeFileSync(f, md); out({ ok: true, wrote: path.relative(process.cwd(), f) }); } else process.stdout.write(md);
      break;
    }
    case 'gates': { if (typeof flags.run !== 'string' || !/^EVRUN-[0-9a-f]{10}$/.test(flags.run)) usage('--run EVRUN-<10 hex> is required'); const v = ev.verifyRun(ctx, flags.run); if (!v.ok) { out({ ok: false, error: 'UNVERIFIED', problems: v.problems }); process.exit(1); } const run = JSON.parse(fs.readFileSync(path.join(ctx.runsDir, flags.run, 'run.json'), 'utf8')); out({ gates: run.gates, hardConstraints: run.hardConstraints.filter((h) => h.verdict !== 'NO TEST FAILED') }); break; }
    case 'list': out({ ok: true, runs: ev.listRuns(ctx) }); break;
    default: usage('commands: validate run verify report gates list');
  }
} catch (e) {
  if (e instanceof ev.EvalError) { out({ ok: false, error: e.code, message: e.message }); process.exit(2); }
  out({ ok: false, error: 'ERROR', message: e.message }); process.exit(2);
}
