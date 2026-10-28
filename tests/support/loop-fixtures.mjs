// Support for the loop tests: copies a fixture into a throwaway workspace under .harness-work (inside the repository, because the
// guards classify repository-relative paths), builds a loop context with its own store and log folders, and applies scripted
// "repairs" by copying fixture files. A scripted repair stands in for a model: it shows the loop's decisions, not model skill.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const loop = require('../../harness/loop/loop.cjs');
export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIX = path.join(repo, 'tests', 'fixtures', 'loop');
const dirs = [];
process.on('exit', () => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const toolchainOk = () => !loop.resolveToolchain(loop.makeContext({ toolchainDir: process.env.HARNESS_TOOLCHAIN_DIR ?? path.join(process.env.LOCALAPPDATA ?? '', 'greenfuel-toolchain') })).error;
export const toolchainDir = () => process.env.HARNESS_TOOLCHAIN_DIR ?? path.join(process.env.LOCALAPPDATA ?? '', 'greenfuel-toolchain');

export function copyDir(from, to) { fs.cpSync(from, to, { recursive: true }); }

// scenario: a folder under tests/fixtures/loop with task.json and workspace/. Returns helpers bound to a fresh loop store.
export function setup(scenario, { task = {}, ctxOpts = {}, clock } = {}) {
  const id = crypto.randomBytes(4).toString('hex');
  const wsRel = `.harness-work/test-${scenario}-${id}`;
  const ws = path.join(repo, wsRel);
  fs.mkdirSync(path.dirname(ws), { recursive: true });
  copyDir(path.join(FIX, scenario, 'workspace'), ws);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'greenfuel-loop-'));
  dirs.push(ws, tmp);
  const state = { t: clock ?? Date.now() };
  const ctx = loop.makeContext({ loopsDir: path.join(tmp, 'loops'), logDir: path.join(tmp, 'logs'), toolchainDir: toolchainDir(), now: () => new Date(state.t), ...ctxOpts });
  const taskDef = { ...readJson(path.join(FIX, scenario, 'task.json')), ...task };
  const h = {
    ctx, ws, wsRel, tmp, state, task: taskDef,
    again: (o = {}) => loop.makeContext({ loopsDir: path.join(tmp, 'loops'), logDir: path.join(tmp, 'logs'), toolchainDir: toolchainDir(), now: () => new Date(state.t), ...ctxOpts, ...o }),
    init: () => { h.id = loop.init(ctx, { task: taskDef, workspace: wsRel }).loopId; return h.id; },
    // copy files from a fixture folder (for example ts-build/fix) over the workspace
    apply: (sub) => copyDir(path.join(FIX, scenario, sub), ws),
    write: (rel, text) => { fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true }); fs.writeFileSync(path.join(ws, rel), text); },
    read: (rel) => fs.readFileSync(path.join(ws, rel), 'utf8'),
    begin: () => loop.begin(ctx, h.id),
    end: (o) => loop.end(ctx, h.id, o),
    verify: () => loop.verify(ctx, h.id),
    status: () => loop.statusView(ctx, h.id),
    check: () => loop.verifyLoop(ctx, h.id),
    events: () => loop.readEvents(path.join(ctx.loopsDir, h.id)),
    load: () => readJson(path.join(ctx.loopsDir, h.id, 'loop.json')),
    dir: () => path.join(ctx.loopsDir, h.id),
    logRows: () => { const f = path.join(tmp, 'logs', 'denied-actions.jsonl'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; },
  };
  return h;
}
export const diagnosis = (h, evidenceLabel, approach, extra = {}) => ({ hypothesis: 'The failing check reads a value that the handler produces in the wrong shape.', evidence: [evidenceLabel], differentApproach: approach, ...extra });
export const lastLabel = (h) => h.load().lastFailure.labels.at(-1);
