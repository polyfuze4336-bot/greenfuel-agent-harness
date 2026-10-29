// Demo runner. Usage:
//   node harness/demo/run.mjs <scenario|all>              run LIVE and print
//   node harness/demo/run.mjs <scenario|all> --record     run live, print, and save a recording of this genuine run
//   node harness/demo/run.mjs <scenario> --replay         replay the latest recording, with an unmissable RECORDED banner
//   node harness/demo/run.mjs list
import { SCENARIOS, TITLES } from './pipeline.mjs';
import { runLive, printLive, makeRecording, printReplay, latestRecording } from './recording.mjs';

const [name, ...flags] = process.argv.slice(2);
if (!name || name === 'list') { for (const k of Object.keys(SCENARIOS)) console.log(`${k.padEnd(14)} ${TITLES[k]}`); process.exit(name ? 0 : 2); }
const names = name === 'all' ? Object.keys(SCENARIOS) : [name];
for (const n of names) {
  if (!SCENARIOS[n]) { console.error(`unknown scenario ${n}`); process.exit(2); }
  if (flags.includes('--replay')) {
    const f = latestRecording(n); if (!f) { console.error(`no recording exists for ${n}; run with --record first`); process.exit(1); }
    if (!printReplay(f)) process.exit(1);
  } else {
    const r = await runLive(n); printLive(r);
    if (flags.includes('--record')) { const { file } = makeRecording(r); console.log(`recorded (this was a live run; the file is a recording of it): ${file}`); }
  }
}
