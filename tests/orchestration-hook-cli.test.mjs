import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { engine, repo, setup, examplePlan, GOOD_T1, GOOD_T2, tmp, hook, cli, TEMPLATE } from './support/orchestration-fixtures.mjs';

const MARK = (h, id) => `TASK-REF: ${h.runId}/${id}`;
const ev = (h, tool, args, extra = {}) => ({ toolName: tool, toolArgs: args, ...extra });
const task = (h, id, agent, text = '', mode = 'sync') => ev(h, 'task', { name: `n-${id}`, agent_type: agent, description: 'd', prompt: `${MARK(h, id)}. ${text}`, mode });

test('pre: a tracked delegation to the assigned agent starts the attempt; the matching post captures and judges the reply', () => {
  const h = setup();
  const d = engine.delegationPre(h.ctx, task(h, 'T1', 'maritime-domain', 'assess it'));
  assert.equal(d.decision, 'allow'); assert.equal(d.tracked, true); assert.equal(d.attempt, 1);
  assert.equal(h.status('T1'), 'RUNNING');
  const post = engine.delegationPost(h.ctx, { ...task(h, 'T1', 'maritime-domain', 'assess it'), toolResult: { resultType: 'success', textResultForLlm: GOOD_T1 } });
  assert.deepEqual([post.recorded, post.outcome], [true, 'completed']);
  assert.equal(h.status('T1'), 'COMPLETED'); assert.equal(h.status('T2'), 'READY');
  const e = engine.readEvents(engine.runDir(h.ctx, h.runId));
  assert.ok(e.filter((x) => x.actor === 'hook:delegation-guard').length >= 3, 'the hook is the recorded actor, not a self-declared name');
});

test('pre denies: wrong agent, out of order, background, unknown task or run, and a repeated prompt on a retry', () => {
  const h = setup();
  const deny = (e, re) => { const d = engine.delegationPre(h.ctx, e); assert.equal(d.decision, 'deny', JSON.stringify(d)); assert.match(d.reason, re); return d; };
  deny(task(h, 'T1', 'security-reviewer'), /WRONG_AGENT/);
  deny(task(h, 'T2', 'architecture-critic'), /NOT_READY/);
  deny(task(h, 'T1', 'maritime-domain', '', 'background'), /BACKGROUND_DENIED/);
  deny(task(h, 'T9', 'maritime-domain'), /NO_TASK/);
  deny({ toolName: 'task', toolArgs: { name: 'n', agent_type: 'maritime-domain', prompt: 'TASK-REF: RUN-0000000000/T1', mode: 'sync' } }, /NO_RUN/);
  assert.equal(h.status('T1'), 'READY', 'denials leave the task as it was');
  engine.delegationPre(h.ctx, task(h, 'T1', 'maritime-domain', 'first'));
  engine.delegationPost(h.ctx, { ...task(h, 'T1', 'maritime-domain', 'first'), toolResult: { resultType: 'success', textResultForLlm: 'too short' } });
  assert.equal(h.status('T1'), 'FAILED');
  engine.retry(h.ctx, h.runId, 'T1');
  deny(task(h, 'T1', 'maritime-domain', 'first'), /UNCHANGED_PROMPT/);
  assert.equal(engine.delegationPre(h.ctx, task(h, 'T1', 'maritime-domain', 'second, with the failed checks')).decision, 'allow');
});

test('pre: while a run is active, an untracked delegation is denied (ORCH-01); with no active run it is allowed; other tools are ignored', () => {
  const empty = engine.makeContext({ runsDir: tmp('gf-empty-') });
  assert.equal(engine.delegationPre(empty, ev(null, 'task', { agent_type: 'qa-engineer', prompt: 'no marker', mode: 'sync' })).decision, 'allow');
  const h = setup();
  const d = engine.delegationPre(h.ctx, ev(h, 'task', { agent_type: 'maritime-domain', prompt: 'sneak in without a marker', mode: 'sync' }));
  assert.equal(d.decision, 'deny'); assert.equal(d.rule, 'ORCH-01'); assert.match(d.reason, new RegExp(h.runId));
  assert.equal(engine.delegationPre(h.ctx, ev(h, 'view', { path: 'README.md' })).decision, 'allow');
  engine.cancelRun(h.ctx, h.runId, { reason: 'done' });
  assert.equal(engine.delegationPre(h.ctx, ev(h, 'task', { agent_type: 'maritime-domain', prompt: 'ad hoc', mode: 'sync' })).decision, 'allow', 'a finished run no longer gates ad hoc delegation');
});

test('post: a failed delegation is classified and recorded, a stray post is ignored, and a repeated post changes nothing', () => {
  const h = setup();
  engine.delegationPre(h.ctx, task(h, 'T1', 'maritime-domain', 'x'));
  const r = engine.delegationPost(h.ctx, { ...task(h, 'T1', 'maritime-domain', 'x'), toolResult: { resultType: 'failure', textResultForLlm: 'Denied by preToolUse hook: [AGENT-GUARD maritime-domain] no' } });
  assert.deepEqual([r.recorded, r.outcome, r.errorClass], [true, 'failed', 'PERMISSION_DENIED']);
  assert.equal(h.st('T1').terminal, true);
  assert.equal(engine.delegationPost(h.ctx, { ...task(h, 'T1', 'maritime-domain', 'x'), toolResult: { resultType: 'success', textResultForLlm: GOOD_T1 } }).recorded, false, 'no matching running attempt');
  assert.equal(engine.delegationPost(h.ctx, { toolName: 'view', toolArgs: {}, toolResult: {} }).recorded, false);
  assert.equal(engine.delegationPost(h.ctx, { toolName: 'task', toolArgs: { prompt: 'no marker' }, toolResult: { resultType: 'success', textResultForLlm: 'x' } }).recorded, false);
});

test('post: a reply that fails its acceptance tests fails the attempt with feedback the orchestrator can read', () => {
  const h = setup();
  engine.delegationPre(h.ctx, task(h, 'T1', 'maritime-domain', 'x'));
  const r = engine.delegationPost(h.ctx, { ...task(h, 'T1', 'maritime-domain', 'x'), toolResult: { resultType: 'success', textResultForLlm: 'A short reply with no citations.' } });
  assert.equal(r.outcome, 'failed');
  const next = engine.nextActions(h.ctx, h.load());
  assert.equal(next.recommendation.action, 'retry');
  assert.ok(next.retryable[0].feedback.length >= 3);
});

test('the hook process: denies with the standard decision JSON, fails closed on bad input, and never touches non-task tools', () => {
  const runs = tmp('gf-hookruns-'); const logs = tmp('gf-hooklogs-');
  const env = { HARNESS_RUNS_DIR: runs, HARNESS_LOG_DIR: logs };
  const ctx = engine.makeContext({ runsDir: runs });
  const { runId } = engine.initRun(ctx, examplePlan());
  const mk = (id, agent) => ({ toolName: 'task', toolArgs: { name: 'n', agent_type: agent, description: 'd', prompt: `TASK-REF: ${runId}/${id}. go`, mode: 'sync' } });
  const bad = hook('pre', mk('T1', 'security-reviewer'), env);
  assert.equal(bad.denied, true); assert.match(bad.reason, /WRONG_AGENT/);
  assert.ok(existsSync(path.join(logs, 'denied-actions.jsonl')), 'a denial is also written to the denied-action audit log');
  assert.equal(engine.loadRun(ctx, runId).tasks.T1.status, 'READY');
  const ok = hook('pre', mk('T1', 'maritime-domain'), env);
  assert.equal(ok.denied, false); assert.equal(ok.status, 0);
  assert.equal(engine.loadRun(ctx, runId).tasks.T1.status, 'RUNNING');
  const post = hook('post', { ...mk('T1', 'maritime-domain'), toolResult: { resultType: 'success', textResultForLlm: GOOD_T1 } }, env);
  assert.equal(post.status, 0); assert.match(post.stderr, /"outcome":"completed"/);
  assert.equal(engine.loadRun(ctx, runId).tasks.T1.status, 'COMPLETED');
  assert.equal(hook('pre', { toolName: 'view', toolArgs: { path: 'README.md' } }, env).denied, false);
  const raw = spawnSync(process.execPath, [path.join(repo, 'harness/hooks/delegation-guard.cjs'), 'pre'], { input: '}{ not json', encoding: 'utf8', cwd: repo, env: { ...process.env, ...env } });
  assert.equal(raw.status, 2, 'unparseable input to the pre hook is refused (fail closed)');
  const rawPost = spawnSync(process.execPath, [path.join(repo, 'harness/hooks/delegation-guard.cjs'), 'post'], { input: '}{ not json', encoding: 'utf8', cwd: repo, env: { ...process.env, ...env } });
  assert.equal(rawPost.status, 0, 'the post hook never blocks');
  const slow = hook('post', { toolName: 'task', toolArgs: { prompt: 'x' } }, env);
  assert.equal(slow.status, 0, 'the post hook never blocks');
});

test('the hook is registered repository-wide for both events, with the orchestrator told to use the marker', () => {
  const cfg = JSON.parse(readFileSync(path.join(repo, '.github/hooks/orchestration.json'), 'utf8'));
  assert.match(cfg.hooks.preToolUse[0].command, /delegation-guard\.cjs pre/);
  assert.match(cfg.hooks.postToolUse[0].command, /delegation-guard\.cjs post/);
  assert.ok(cfg.hooks.preToolUse[0].timeoutSec <= 30 && cfg.hooks.postToolUse[0].timeoutSec <= 30);
});

test('CLI: plan check, init, status, next, drive, trace, report and verify work across separate process invocations', () => {
  const runs = tmp('gf-cli-'); const env = { HARNESS_RUNS_DIR: runs };
  const files = tmp('gf-clif-');
  const bad = path.join(files, 'bad.json'); const fs = require_fs();
  fs.writeFileSync(bad, JSON.stringify({ schema: 'greenfuel.task-plan/v1' }));
  assert.equal(cli(['check-plan', '--file', bad], env).status, 1);
  assert.match(cli(['check-plan', '--file', TEMPLATE], env).out, /plan OK: 2 tasks/);
  assert.equal(cli(['init', '--file', bad], env).status, 2);
  const init = JSON.parse(cli(['init', '--file', TEMPLATE, '--draft-source', 'test', '--draft-attempts', '2', '--json'], env).out);
  assert.equal(JSON.parse(cli(['init', '--file', TEMPLATE, '--json'], env).out).existed, true);
  const id = init.runId;
  assert.match(cli(['status'], env).out, new RegExp(`${id} ACTIVE`));
  assert.equal(JSON.parse(cli(['next', '--run', id], env).out).recommendation.action, 'delegate');
  fs.writeFileSync(path.join(files, 'p1.txt'), 'prompt one'); fs.writeFileSync(path.join(files, 't1.md'), GOOD_T1); fs.writeFileSync(path.join(files, 't2.md'), GOOD_T2); fs.writeFileSync(path.join(files, 'short.md'), 'short');
  assert.equal(cli(['start', '--run', id, '--task', 'T1', '--agent', 'security-reviewer'], env).status, 1, 'a refusal exits 1');
  assert.equal(cli(['start', '--run', id, '--task', 'T1', '--agent', 'maritime-domain', '--prompt-file', path.join(files, 'p1.txt')], env).status, 0);
  assert.equal(cli(['submit', '--run', id, '--task', 'T1', '--result-file', path.join(files, 'short.md')], env).status, 1, 'a failed acceptance exits 1');
  assert.equal(cli(['retry', '--run', id, '--task', 'T1'], env).status, 0);
  fs.writeFileSync(path.join(files, 'p2.txt'), 'prompt two, with feedback');
  assert.equal(cli(['start', '--run', id, '--task', 'T1', '--agent', 'maritime-domain', '--prompt-file', path.join(files, 'p2.txt')], env).status, 0);
  assert.equal(cli(['submit', '--run', id, '--task', 'T1', '--result-file', path.join(files, 't1.md')], env).status, 0);
  cli(['start', '--run', id, '--task', 'T2', '--agent', 'architecture-critic', '--prompt-sha', engine.sha256('x')], env);
  assert.equal(cli(['submit', '--run', id, '--task', 'T2', '--result-file', path.join(files, 't2.md')], env).status, 0);
  assert.equal(cli(['verify', '--run', id], env).status, 0);
  assert.match(cli(['trace', '--run', id], env).out, /Execution trace/);
  cli(['trace', '--run', id, '--write'], env); cli(['report', '--run', id, '--write'], env);
  assert.ok(existsSync(path.join(runs, id, 'TRACE.md')) && existsSync(path.join(runs, id, 'REPORT.md')));
  assert.equal(JSON.parse(cli(['status', '--run', id, '--json'], env).out).state, 'COMPLETED');
  fs.appendFileSync(path.join(runs, id, 'events.jsonl'), 'garbage\n');
  assert.equal(cli(['status', '--run', id], env).status, 3, 'an integrity failure exits 3');
  assert.equal(cli(['verify', '--run', id], env).status, 3);
  assert.equal(cli(['nonsense'], env).status, 2);
  assert.equal(readdirSync(runs).length, 1, 'only this test run directory was created');
});

function require_fs() { return globalThis.process.getBuiltinModule('node:fs'); }

test('pre: a tracked delegation the tool would reject (no name, agent or prompt) is denied before any attempt is started', () => {
  const h = setup();
  const noName = { toolName: 'task', toolArgs: { agent_type: 'maritime-domain', description: 'd', prompt: `${MARK(h, 'T1')}. go`, mode: 'sync' } };
  const d = engine.delegationPre(h.ctx, noName);
  assert.equal(d.decision, 'deny'); assert.equal(d.rule, 'ORCH-ARGS'); assert.match(d.reason, /name is missing/); assert.match(d.reason, /No attempt was started/);
  assert.equal(h.status('T1'), 'READY'); assert.equal(h.st('T1').attempts, 0, 'a malformed call spends nothing');
  const noAgent = { toolName: 'task', toolArgs: { name: 'n', description: 'd', prompt: `${MARK(h, 'T1')}. go`, mode: 'sync' } };
  assert.match(engine.delegationPre(h.ctx, noAgent).reason, /agent_type is missing/);
  assert.equal(h.st('T1').attempts, 0);
  assert.equal(engine.delegationPre(h.ctx, task(h, 'T1', 'maritime-domain', 'now well formed')).decision, 'allow');
  assert.equal(h.st('T1').attempts, 1);
});
