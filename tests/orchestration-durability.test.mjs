import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, utimesSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { engine, repo, setup, runTask, GOOD_T1, GOOD_T2, tmp, TEMPLATE } from './support/orchestration-fixtures.mjs';

const P = (n) => engine.sha256(`prompt ${n}`);
const dirOf = (h) => engine.runDir(h.ctx, h.runId);
const eventsFile = (h) => path.join(dirOf(h), 'events.jsonl');
const lines = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean);
const integrity = (fn) => assert.throws(fn, (e) => e.code === 'INTEGRITY', 'expected an integrity failure');

test('a crash between writing run.json and appending its events is repaired on the next load, losing nothing', () => {
  const h = setup();
  engine.start(h.ctx, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(1) });
  const last = h.load().lastCommit.events;
  const all = lines(eventsFile(h));
  writeFileSync(eventsFile(h), `${all.slice(0, all.length - last.length).join('\n')}\n`);
  assert.equal(lines(eventsFile(h)).length, all.length - last.length, 'the crash left the log behind');
  const run = h.load();
  assert.equal(run.tasks.T1.status, 'RUNNING');
  assert.deepEqual(lines(eventsFile(h)), all, 'the missing events were re-appended exactly');
  assert.equal(engine.verifyRun(h.ctx, h.runId).ok, true);
});

test('state survives a restart: a fresh context continues where the last one stopped', () => {
  const h = setup();
  runTask(h, 'T1', GOOD_T1);
  const fresh = engine.makeContext({ runsDir: h.ctx.runsDir, now: h.clk.now });
  assert.equal(engine.loadRun(fresh, h.runId).tasks.T1.status, 'COMPLETED');
  assert.equal(engine.nextActions(fresh, engine.loadRun(fresh, h.runId)).ready[0].id, 'T2');
  engine.start(fresh, h.runId, 'T2', { agent: 'architecture-critic', promptSha256: P(2) });
  assert.equal(engine.submit(fresh, h.runId, 'T2', { resultText: GOOD_T2 }).outcome, 'completed');
  assert.equal(engine.loadRun(fresh, h.runId).state, 'COMPLETED');
});

test('tampering with history, state or captured results is detected', () => {
  const make = () => { const h = setup(); runTask(h, 'T1', GOOD_T1); return h; };
  let h = make();
  const edited = lines(eventsFile(h)); edited[3] = edited[3].replace('"ready"', '"accept"');
  writeFileSync(eventsFile(h), `${edited.join('\n')}\n`);
  integrity(() => h.load());

  h = make();
  const removed = lines(eventsFile(h)); removed.splice(2, 1);
  writeFileSync(eventsFile(h), `${removed.join('\n')}\n`);
  integrity(() => h.load());

  h = make();
  const swapped = lines(eventsFile(h)); [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
  writeFileSync(eventsFile(h), `${swapped.join('\n')}\n`);
  integrity(() => h.load());

  h = make();
  const j = JSON.parse(readFileSync(path.join(dirOf(h), 'run.json'), 'utf8'));
  j.tasks.T2.status = 'COMPLETED';
  writeFileSync(path.join(dirOf(h), 'run.json'), JSON.stringify(j, null, 2));
  integrity(() => h.load());

  h = make();
  writeFileSync(eventsFile(h), `${lines(eventsFile(h)).join('\n')}\nnot json\n`);
  integrity(() => h.load());

  h = make();
  const res = path.join(dirOf(h), h.st('T1').artifacts[0].path);
  writeFileSync(res, `${readFileSync(res, 'utf8')}\nan extra claim`);
  assert.ok(engine.verifyRun(h.ctx, h.runId).problems.some((p) => /altered/.test(p)));
});

test('rolling run.json back to an earlier copy, or truncating the log by more than one commit, is detected', () => {
  let h = setup();
  const early = readFileSync(path.join(dirOf(h), 'run.json'), 'utf8');
  runTask(h, 'T1', GOOD_T1);
  writeFileSync(path.join(dirOf(h), 'run.json'), early);
  integrity(() => h.load());

  h = setup();
  runTask(h, 'T1', GOOD_T1);
  const all = lines(eventsFile(h));
  writeFileSync(eventsFile(h), `${all.slice(0, 4).join('\n')}\n`);
  integrity(() => h.load());
});

test('verifyRun notices a rewritten checkpoint', () => {
  const h = setup();
  runTask(h, 'T1', GOOD_T1);
  const cp = path.join(dirOf(h), 'checkpoints', readdirSync(path.join(dirOf(h), 'checkpoints')).sort().at(-1));
  const c = JSON.parse(readFileSync(cp, 'utf8')); c.eventHead = 'f'.repeat(64);
  writeFileSync(cp, JSON.stringify(c));
  assert.ok(engine.verifyRun(h.ctx, h.runId).problems.some((p) => /not in the log/.test(p)));
});

test('a delegate that never reports is detected by its lease, swept as INTERRUPTED and can be retried with a new prompt', () => {
  const h = setup();
  engine.start(h.ctx, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(1) });
  h.clk.advanceMin(10);
  assert.deepEqual(engine.resume(h.ctx, h.runId).leasesExpired, [], 'within its lease the attempt is left alone');
  h.clk.advanceMin(25);
  assert.equal(engine.nextActions(h.ctx, h.load()).recommendation.action, 'resume');
  const r = engine.resume(h.ctx, h.runId);
  assert.deepEqual(r.leasesExpired, ['T1']);
  assert.equal(h.st('T1').status, 'FAILED'); assert.equal(h.st('T1').lastError.class, 'INTERRUPTED'); assert.equal(h.st('T1').terminal, false);
  assert.ok(lines(eventsFile(h)).some((l) => JSON.parse(l).action === 'lease-expired'));
  assert.deepEqual(engine.resume(h.ctx, h.runId).leasesExpired, [], 'resume is idempotent');
  engine.retry(h.ctx, h.runId, 'T1');
  engine.start(h.ctx, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(2) });
  assert.equal(engine.submit(h.ctx, h.runId, 'T1', { resultText: GOOD_T1 }).outcome, 'completed');
});

test('a manual checkpoint records the exact head of the log', () => {
  const h = setup();
  runTask(h, 'T1', GOOD_T1);
  const cp = engine.checkpoint(h.ctx, h.runId, { label: 'before review' });
  assert.equal(cp.eventHead, h.load().eventHead);
  assert.equal(engine.verifyRun(h.ctx, h.runId).ok, true);
});

test('a stale lock left by a crashed process does not block the run', () => {
  const h = setup();
  const lock = path.join(dirOf(h), '.lock'); mkdirSync(lock);
  const old = new Date(Date.now() - 5 * 60000); utimesSync(lock, old, old);
  engine.start(h.ctx, h.runId, 'T1', { agent: 'maritime-domain', promptSha256: P(1) });
  assert.equal(h.status('T1'), 'RUNNING'); assert.equal(existsSync(lock), false);
});

test('two processes cannot both start the same task: exactly one wins, and the log stays consistent', async () => {
  const runs = tmp('gf-race-');
  const env = { ...process.env, HARNESS_RUNS_DIR: runs };
  const run = (args) => new Promise((resolve) => { const c = spawn(process.execPath, [path.join(repo, 'harness/scripts/tasks.mjs'), ...args], { cwd: repo, env }); let out = ''; let err = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; }); c.on('close', (code) => resolve({ code, out, err })); });
  const init = await run(['init', '--file', TEMPLATE, '--json']);
  assert.equal(init.code, 0, init.err);
  const runId = JSON.parse(init.out).runId;
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => run(['start', '--run', runId, '--task', 'T1', '--agent', 'maritime-domain', '--prompt-sha', engine.sha256(`racer ${i}`), '--actor', `racer-${i}`])));
  const winners = results.filter((r) => r.code === 0);
  assert.equal(winners.length, 1, `exactly one start may win, got ${winners.length}: ${results.map((r) => r.code).join(',')}`);
  assert.ok(results.filter((r) => r.code !== 0).every((r) => /NOT_READY|RUN_NOT_ACTIVE|LOCK/.test(r.err)), results.map((r) => r.err).join('|'));
  const ctx = engine.makeContext({ runsDir: runs });
  const loaded = engine.loadRun(ctx, runId);
  assert.equal(loaded.tasks.T1.attempts, 1);
  assert.equal(engine.verifyRun(ctx, runId).ok, true);
});

test('concurrent submissions from many processes keep the chain intact', async () => {
  const runs = tmp('gf-race2-');
  const env = { ...process.env, HARNESS_RUNS_DIR: runs };
  const run = (args) => new Promise((resolve) => { const c = spawn(process.execPath, [path.join(repo, 'harness/scripts/tasks.mjs'), ...args], { cwd: repo, env }); let err = ''; c.stderr.on('data', (d) => { err += d; }); c.on('close', (code) => resolve({ code, err })); });
  const runId = JSON.parse((await new Promise((resolve) => { const c = spawn(process.execPath, [path.join(repo, 'harness/scripts/tasks.mjs'), 'init', '--file', TEMPLATE], { cwd: repo, env }); let o = ''; c.stdout.on('data', (d) => { o += d; }); c.on('close', () => resolve(o)); }))).runId;
  await Promise.all([run(['checkpoint', '--run', runId, '--label', 'a']), run(['checkpoint', '--run', runId, '--label', 'b']), run(['resume', '--run', runId]), run(['checkpoint', '--run', runId, '--label', 'c']), run(['resume', '--run', runId])]);
  const ctx = engine.makeContext({ runsDir: runs });
  const v = engine.verifyRun(ctx, runId);
  assert.equal(v.ok, true, v.problems.join('; '));
  const ev = engine.readEvents(engine.runDir(ctx, runId));
  assert.deepEqual(ev.map((e) => e.seq), ev.map((_, i) => i + 1), 'sequence numbers are contiguous');
});
