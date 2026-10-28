#!/usr/bin/env node
'use strict';
// Delegation guard: makes the orchestrator's native `task` delegation obey the task-execution framework.
//   node harness/hooks/delegation-guard.cjs pre    (preToolUse)  start the task attempt, or deny the delegation
//   node harness/hooks/delegation-guard.cjs post   (postToolUse) capture the delegate's reply and judge it against the acceptance tests
// It acts only on the `task` tool. A delegation whose prompt carries `TASK-REF: RUN-xxxxxxxxxx/Tn` is tracked: it must be the
// task's assigned agent, in order, within its attempt budget, synchronous, and (on a retry) with a changed prompt. Without a
// marker, delegation is untracked and allowed, unless a run is ACTIVE (ORCH-01), which stops the marker being skipped.
// The pre hook fails closed for `task` calls (a broken guard denies); the post hook never blocks the call. Both stay silent
// about content: the reply is stored under docs/state/runs, which agents cannot write, and is marked untrusted.
const fs = require('node:fs');
const engine = require('../orchestration/engine.cjs');
const perm = require('./permission-engine.cjs');

function readEvent() {
  try { const e = JSON.parse(fs.readFileSync(0, 'utf8')); if (e && typeof e === 'object') return e; } catch { /* fall through */ }
  return null;
}

function main() {
  const mode = process.argv[2];
  const event = readEvent();
  if (!event) { if (mode === 'pre') { process.stderr.write('delegation-guard: unparseable event; denying.\n'); process.exit(2); } process.stdout.write('{}'); return; }
  const tool = String(event.toolName ?? event.tool_name ?? '');
  if (tool !== 'task') { process.stdout.write('{}'); return; }
  let ctx;
  try { ctx = engine.makeContext(); } catch (e) {
    if (mode === 'pre') { process.stderr.write(`delegation-guard: ${e.message}; denying.\n`); process.exit(2); }
    process.stdout.write('{}'); return;
  }
  if (mode === 'pre') {
    let d;
    try { d = engine.delegationPre(ctx, event); } catch (e) { process.stderr.write(`delegation-guard: ${e.message}; denying.\n`); process.exit(2); }
    if (d.decision === 'deny') {
      try { perm.writeAudit(ctx.model, event, { mode: 'agent', operations: [], rules: [d.rule ?? 'ORCH'], reasons: [d.reason], targets: [] }, { agent: 'orchestrator' }); } catch { /* logging never changes the decision */ }
      process.stdout.write(JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: d.reason }));
      return;
    }
    process.stdout.write('{}');
    return;
  }
  if (mode === 'post') {
    try { const r = engine.delegationPost(ctx, event); process.stderr.write(`delegation-guard: ${JSON.stringify({ recorded: r.recorded, outcome: r.outcome, run: r.runId, task: r.taskId, error: r.error })}\n`); } catch (e) { process.stderr.write(`delegation-guard: post failed (${e.message})\n`); }
    process.stdout.write('{}');
    return;
  }
  process.stdout.write('{}');
}

module.exports = { main };
if (require.main === module) main();
