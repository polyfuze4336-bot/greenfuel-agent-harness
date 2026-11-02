// Starts the Studio on this computer and keeps it on the latest GitHub main.
// Without this, the Studio shows whatever this checkout has (its current branch, and only what was last fetched). Here it serves the
// remote-tracking ref origin/main and fetches it every STUDIO_SYNC_SECONDS (default 60), so the branch checked out here does not matter.
// It only fetches: nothing is pushed, merged or checked out. A failed fetch is logged, and the last good copy keeps being served.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => spawnSync('git', ['-C', appDir, ...args], { encoding: 'utf8' });

const top = git('rev-parse', '--show-toplevel');
if (top.status !== 0) {
  console.error('studio: this folder is not inside a git repository, so there is nothing to keep in sync.');
  process.exit(1);
}
const branch = process.env.STUDIO_CANONICAL_BRANCH?.trim() || 'main';
if (!/^[A-Za-z0-9._/-]+$/.test(branch)) {
  console.error('studio: STUDIO_CANONICAL_BRANCH has characters that are not allowed in a branch name.');
  process.exit(1);
}
const seconds = Math.max(15, Number(process.env.STUDIO_SYNC_SECONDS) || 60);

function sync() {
  const r = git('fetch', '--quiet', 'origin', branch);
  if (r.status !== 0) console.error(`studio: fetch failed, serving the last copy and retrying (${(r.stderr || '').trim().split('\n')[0]})`);
  return r.status === 0;
}

const ok = sync();
const head = git('rev-parse', '--short', `origin/${branch}`);
if (head.status !== 0) {
  console.error(`studio: origin/${branch} does not exist in this clone. Run: git fetch origin ${branch}`);
  process.exit(1);
}
console.log(`studio: serving origin/${branch} at ${head.stdout.trim()}${ok ? '' : ' (not refreshed: offline?)'}; fetching every ${seconds}s`);
const timer = setInterval(sync, seconds * 1000);

const next = path.join(appDir, 'node_modules', 'next', 'dist', 'bin', 'next');
const child = spawn(process.execPath, [next, 'start', '--hostname', 'localhost', '--port', process.env.PORT || '3100'], {
  cwd: appDir,
  stdio: 'inherit',
  env: { ...process.env, STUDIO_REF: `origin/${branch}` },
});
const stop = () => { clearInterval(timer); child.kill(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => { clearInterval(timer); process.exit(code ?? 0); });
