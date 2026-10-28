// A stand-in for spawnSync used by the evaluation tests: nothing real runs. Every executable test shows its expected outcome
// unless an option says otherwise. The engine's own decisions (status, gates, hard constraints, verification) are what the tests exercise.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ev = require('../../harness/eval/eval.cjs');
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function fakeRun({ fail = [], skip = [], omit = [], suiteOverride = {}, signal = null, commandOverride = {} } = {}) {
  const cat = ev.loadCatalogue(ev.makeContext({ root: ROOT, runsDir: os.tmpdir() }));
  const queue = new Map();
  for (const t of cat.tests.filter((x) => x.mode === 'executable' && x.runner.type === 'command')) { const k = ev.argvOf(t).slice(1).join(' '); queue.set(k, [...(queue.get(k) ?? []), t]); }
  return (_cmd, args) => {
    const line = args.join(' ');
    if (signal) return { status: null, signal, stdout: '', stderr: '' };
    if (args[0] === '--test') {
      const files = args.filter((a) => !a.startsWith('--'));
      if (files.length === 1 && files[0].endsWith('.eval.mjs')) {
        const names = [...fs.readFileSync(path.join(ROOT, files[0]), 'utf8').matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]).filter((n) => !omit.some((o) => n.startsWith(o)));
        const out = names.map((n, i) => `${fail.some((f) => n.startsWith(f)) ? 'not ok' : 'ok'} ${i + 1} - ${n}${skip.some((s) => n.startsWith(s)) ? ' # SKIP' : ''}`).join('\n');
        const bad = names.filter((n) => fail.some((f) => n.startsWith(f))).length;
        return { status: bad ? 1 : 0, stdout: `${out}\n# tests ${names.length}\n# pass ${names.length - bad}\n# fail ${bad}\n# skipped 0\n# todo 0\n# cancelled 0\n`, stderr: '' };
      }
      const o = suiteOverride[files.join(',')] ?? {};
      const tests = o.tests ?? 100; const sk = o.skipped ?? 0; const bad = o.fail ?? 0;
      return { status: bad ? 1 : 0, stdout: `# tests ${tests}\n# pass ${tests - sk - bad}\n# fail ${bad}\n# skipped ${sk}\n# todo 0\n# cancelled 0\n`, stderr: '' };
    }
    // commands run in catalogue order, so two tests that share one command line (the harness and production readiness checks) take their expectations in turn
    const t = queue.get(line)?.shift(); const o = t ? commandOverride[t.id] : null;
    if (o) return { status: o.exit, stdout: o.stdout ?? '', stderr: '' };
    return { status: [].concat(t.runner.expect.exit)[0], stdout: `${t.runner.expect.match ?? 'ok'}\n`, stderr: '' };
  };
}
