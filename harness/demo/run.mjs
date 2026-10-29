// Demo runner. Usage:
//   node harness/demo/run.mjs <scenario|all>              run LIVE and print everything at once
//   node harness/demo/run.mjs <scenario> --step           run LIVE, then reveal one line per Enter key (presenter-paced)
//   node harness/demo/run.mjs <scenario|all> --record     run live, print, and save a recording of this genuine run
//   node harness/demo/run.mjs <scenario> --replay         replay the latest recording, with an unmissable RECORDED banner
//   node harness/demo/run.mjs verify                      pre-flight: every scenario has a recording and its hash verifies
//   node harness/demo/run.mjs list
import readline from 'node:readline';
import { SCENARIOS, TITLES, BANNER } from './pipeline.mjs';
import { runLive, printLive, makeRecording, printReplay, latestRecording, loadRecording, formatLine } from './recording.mjs';

const [name, ...flags] = process.argv.slice(2);
if (!name || name === 'list') { for (const k of Object.keys(SCENARIOS)) console.log(`${k.padEnd(14)} ${TITLES[k]}`); process.exit(name ? 0 : 2); }
if (name === 'verify') {
  let bad = 0;
  for (const k of Object.keys(SCENARIOS)) {
    const f = latestRecording(k); if (!f) { console.log(`MISSING  ${k}`); bad++; continue; }
    const { rec, problems } = loadRecording(f); if (problems.length) { console.log(`INVALID  ${k}: ${problems.join('; ')}`); bad++; } else console.log(`OK       ${k.padEnd(14)} recorded ${rec.recordedAt} commit ${String(rec.gitHead).slice(0, 8)}`);
  }
  console.log(bad ? `${bad} problem(s): re-record before presenting` : 'all recordings verify'); process.exit(bad ? 1 : 0);
}
const names = name === 'all' ? Object.keys(SCENARIOS) : [name];
for (const n of names) {
  if (!SCENARIOS[n]) { console.error(`unknown scenario ${n}`); process.exit(2); }
  if (flags.includes('--replay')) {
    const f = latestRecording(n); if (!f) { console.error(`no recording exists for ${n}; run with --record first`); process.exit(1); }
    if (!printReplay(f)) process.exit(1);
  } else if (flags.includes('--step')) {
    const r = await runLive(n); const rl = readline.createInterface({ input: process.stdin, terminal: false }); const keys = rl[Symbol.asyncIterator]();
    console.log('='.repeat(100)); console.log(`LIVE EXECUTION in this process, now: ${r.title}  (press Enter to reveal each line)`); console.log(BANNER); console.log('='.repeat(100));
    for (const l of r.lines) { await keys.next(); console.log(formatLine(l)); }
    console.log('-'.repeat(100)); console.log(`(executed live in ${r.ms} ms; lines revealed by the presenter)`); rl.close();
  } else {
    const r = await runLive(n); printLive(r);
    if (flags.includes('--record')) { const { file } = makeRecording(r); console.log(`recorded (this was a live run; the file is a recording of it): ${file}`); }
  }
}
