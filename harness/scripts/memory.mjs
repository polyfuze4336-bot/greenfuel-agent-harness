#!/usr/bin/env node
// Command line for persistent memory. Reads are open. Every write names its writer with --as <type>:<name>; the writer type
// decides what the store will accept (see harness/policy/memory-policy.json). Memory files are a control-plane path, so agents
// cannot run this or write memory directly; they get read-only MCP tools (memory_search, memory_resume).
//
//   memory.mjs search <query> [--limit n] [--history] [--category semantic|episodic|working]
//   memory.mjs get <id>            memory.mjs list [--kind k] [--status s]
//   memory.mjs summary [--budget n] [--focus text]
//   memory.mjs conflicts           memory.mjs verify          memory.mjs denied [--last n]
//   memory.mjs add --file entry.json --as human:name
//   memory.mjs approve <id> --adr ADR-nnnn --as human:name
//   memory.mjs supersede <old-id> --file entry.json --as human:name
//   memory.mjs invalidate <id> --reason "..." [--adr ADR-nnnn] --as human:name
//   memory.mjs review <id> [--evidence EV-nnnn,...] --as human:name
//   memory.mjs sweep --as human:name        memory.mjs snapshot --as human:name
//   memory.mjs import --as importer:name    (ADRs and the hard-constraints table)
//   memory.mjs task start --objective "..." [--req FR-001,...] [--run RUN-...] [--ref file:...,...] [--owner role] --as agent:name
//   memory.mjs task checkpoint <id> --summary "..." [--done a;b] [--next a;b] [--ask a;b] --as agent:name
//   memory.mjs task done|abandon <id> --as agent:name        memory.mjs task resume <id>
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const store = require('../memory/store.cjs');

const argv = process.argv.slice(2);
const flags = {}; const pos = [];
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a.startsWith('--')) { const k = a.slice(2); const nxt = argv[i + 1]; if (nxt === undefined || nxt.startsWith('--')) flags[k] = true; else { flags[k] = nxt; i += 1; } } else pos.push(a);
}
const out = (o) => console.log(JSON.stringify(o, null, 2));
const fail = (code, message, extra = {}) => { out({ ok: false, error: code, message, ...extra }); process.exit(code === 'DENIED' ? 3 : 2); };
const list = (v, sep = ',') => (typeof v === 'string' ? v.split(sep).map((x) => x.trim()).filter(Boolean) : []);
const writerOf = () => {
  const m = /^([a-z]+):([a-z0-9][a-z0-9:._-]{0,59})$/.exec(String(flags.as ?? ''));
  if (!m) fail('USAGE', '--as <type>:<name> is required for a write (for example --as human:programme-owner)');
  return { type: m[1], name: m[2] };
};
const readEntryFile = () => {
  if (typeof flags.file !== 'string') fail('USAGE', '--file <entry.json> is required');
  try { return JSON.parse(fs.readFileSync(flags.file, 'utf8')); } catch (e) { return fail('USAGE', `cannot read ${flags.file}: ${e.message}`); }
};

const ctx = store.makeContext();
const [cmd, ...rest] = pos;
try {
  switch (cmd) {
    case 'search': out({ ok: true, ...store.retrieve(ctx, rest.join(' '), { limit: flags.limit ? Number(flags.limit) : undefined, includeHistory: Boolean(flags.history), categories: flags.category ? [flags.category] : undefined }) }); break;
    case 'get': out({ ok: true, entry: store.getEntry(ctx, rest[0]) }); break;
    case 'list': out({ ok: true, entries: store.loadValid(ctx).filter((e) => (!flags.kind || e.kind === flags.kind) && (!flags.status || store.effectiveStatus(e, ctx.now()) === flags.status)).map((e) => ({ id: e.id, kind: e.kind, status: store.effectiveStatus(e, ctx.now()), trust: store.effectiveTrust(e, ctx), title: e.title })) }); break;
    case 'summary': { const s = store.summarise(ctx, { budgetChars: flags.budget ? Number(flags.budget) : undefined, focus: typeof flags.focus === 'string' ? flags.focus : undefined }); if (flags.text) console.log(s.text); else out({ ok: true, ...s }); break; }
    case 'conflicts': out({ ok: true, conflicts: store.detectConflicts(ctx) }); break;
    case 'verify': { const r = store.verifyAll(ctx); out(r); process.exit(r.ok ? 0 : 1); break; }
    case 'denied': { const f = `${ctx.logDir}/${ctx.policy.denialLog.file}`; const rows = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; out({ ok: true, count: rows.length, last: rows.slice(-(Number(flags.last) || 10)) }); break; }
    case 'add': out({ ok: true, ...store.create(ctx, readEntryFile(), writerOf()) }); break;
    case 'approve': out({ ok: true, ...store.approve(ctx, rest[0], flags.adr, writerOf()) }); break;
    case 'supersede': out({ ok: true, ...store.supersede(ctx, rest[0], readEntryFile(), writerOf()) }); break;
    case 'invalidate': out({ ok: true, ...store.invalidate(ctx, rest[0], { reason: flags.reason, approvalRef: flags.adr }, writerOf()) }); break;
    case 'review': out({ ok: true, ...store.review(ctx, rest[0], { evidence: list(flags.evidence) }, writerOf()) }); break;
    case 'sweep': out({ ok: true, ...store.sweep(ctx, writerOf()) }); break;
    case 'snapshot': { const w = writerOf(); const s = store.writeSnapshot(ctx, w); out({ ok: true, approved: s.counts.approved, counts: s.counts }); break; }
    case 'import': { const w = writerOf(); const a = store.importAdrs(ctx, w); const c = store.importConstraints(ctx, 'ADR-0005', w); const s = store.writeSnapshot(ctx, w); out({ ok: true, decisions: a, constraints: c, approved: s.counts.approved }); break; }
    case 'task': {
      const [sub, id] = rest;
      if (sub === 'start') {
        if (typeof flags.objective !== 'string') fail('USAGE', '--objective is required');
        out({ ok: true, ...store.taskStart(ctx, { objective: flags.objective, requirements: list(flags.req), runRef: typeof flags.run === 'string' ? flags.run : null, contextRefs: list(flags.ref), dependencies: list(flags.dep), owner: typeof flags.owner === 'string' ? flags.owner : 'orchestrator' }, writerOf()) });
      } else if (sub === 'checkpoint') out({ ok: true, ...store.taskCheckpoint(ctx, id, { summary: String(flags.summary ?? ''), done: list(flags.done, ';'), next: list(flags.next, ';'), openQuestions: list(flags.ask, ';') }, writerOf()) });
      else if (sub === 'done' || sub === 'abandon') out({ ok: true, ...store.taskSetState(ctx, id, sub === 'done' ? 'completed' : 'abandoned', writerOf()) });
      else if (sub === 'resume') out({ ok: true, ...store.taskResume(ctx, id) });
      else fail('USAGE', 'task start|checkpoint|done|abandon|resume');
      break;
    }
    default: fail('USAGE', 'commands: search get list summary conflicts verify denied add approve supersede invalidate review sweep snapshot import task');
  }
} catch (e) {
  if (e instanceof store.MemoryError) fail(e.code, e.message, e.detail ? { reasons: e.detail } : {});
  fail('ERROR', e.message);
}
