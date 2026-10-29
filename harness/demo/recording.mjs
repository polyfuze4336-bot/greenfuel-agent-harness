// Recording and replay for the demo scenarios. A RECORDING is the captured output of a genuine earlier execution. Replaying it is never presented as live:
// the replay prints an unmissable banner with the recording time and commit, and refuses to play a file whose hash does not match (altered after capture).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { canonical, sha256 } from '../scripts/spec-validators.mjs';
import { SCENARIOS, TITLES, BANNER } from './pipeline.mjs';

export const recordingsDir = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), 'docs', 'capstone', 'presentation', 'recordings');
const TAG = { step: '[STEP]   ', ok: '[OK]     ', refused: '[REFUSED]', note: '[NOTE]   ', simulated: '[SIMULATED]' };
export const formatLine = (l) => `${(TAG[l.kind] ?? '[?]').padEnd(11)} ${l.text}`;

function gitHead() { try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } }

export async function runLive(name) {
  if (!SCENARIOS[name]) throw new Error(`unknown scenario ${name}`);
  const started = Date.now(); const lines = await SCENARIOS[name]();
  return { name, title: TITLES[name], lines, ms: Date.now() - started };
}
export function printLive(r, write = console.log) {
  write('='.repeat(100)); write(`LIVE EXECUTION in this process, now: ${r.title}`); write(BANNER); write('='.repeat(100));
  for (const l of r.lines) write(formatLine(l));
  write('-'.repeat(100)); write(`(executed live in ${r.ms} ms)`);
}

export function makeRecording(r, { dir = recordingsDir } = {}) {
  const rec = { schema: 'greenfuel.demo-recording/v1', kind: 'RECORDED-RUN', notLive: true, scenario: r.name, title: r.title, recordedAt: new Date().toISOString(), gitHead: gitHead(), node: process.version, banner: BANNER, lines: r.lines, outputSha256: sha256(canonical(r.lines)) };
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${r.name}-${rec.recordedAt.replace(/[-:]/g, '').slice(0, 15)}-${rec.outputSha256.slice(0, 8)}.json`);
  fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`); return { file, rec };
}
export function loadRecording(file) {
  const rec = JSON.parse(fs.readFileSync(file, 'utf8')); const problems = [];
  if (rec.schema !== 'greenfuel.demo-recording/v1' || rec.kind !== 'RECORDED-RUN' || rec.notLive !== true) problems.push('not a demo recording');
  if (sha256(canonical(rec.lines ?? [])) !== rec.outputSha256) problems.push('the recorded lines were altered after capture (hash mismatch)');
  return { rec, problems };
}
export function printReplay(file, write = console.log) {
  const { rec, problems } = loadRecording(file);
  if (problems.length) { write(`REFUSING TO REPLAY: ${problems.join('; ')}`); return false; }
  write('#'.repeat(100)); write('RECORDED RUN: THIS IS A RECORDING, NOT A LIVE EXECUTION'); write(`Captured ${rec.recordedAt} from commit ${rec.gitHead ?? 'unknown'} on node ${rec.node}. Scenario: ${rec.title}`); write(BANNER); write('#'.repeat(100));
  for (const l of rec.lines) write(formatLine(l));
  write('#'.repeat(100)); write(`END OF RECORDING (output sha256 ${rec.outputSha256.slice(0, 16)} verified). Say aloud: "This is the recording of a genuine run made on ${rec.recordedAt.slice(0, 10)}."`); write('#'.repeat(100));
  return true;
}
export function latestRecording(name, dir = recordingsDir) {
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).filter((x) => x.startsWith(`${name}-`) && x.endsWith('.json')).sort().pop(); return f ? path.join(dir, f) : null;
}
