'use strict';
// Detects changes to the control plane and the tests while a command runs.
// A test or script that edits the policy engine, a hook, a workflow or a test's assertions (to make itself pass) changes a file that was
// hashed before the run. Detection is after the fact and honest about it: it does not stop the write, the read-only mounts of the isolated
// environment do that; this proves whether a write happened.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PROTECTED = ['harness', 'tests', 'evaluation', '.github', '.vscode', '.devcontainer', 'package.json', '.mcp.json', '.gitignore', '.gitattributes', 'docs/evidence', 'docs/approvals', 'docs/adr'];
const SKIP_DIRS = new Set(['.git', 'node_modules', '.harness-logs', '.harness-work', '.harness-toolchain']);

function* walk(abs, rel) {
  let st; try { st = fs.lstatSync(abs); } catch { return; }
  if (st.isSymbolicLink()) { yield { rel, link: fs.readlinkSync(abs) }; return; }
  if (st.isDirectory()) {
    if (SKIP_DIRS.has(path.basename(abs))) return;
    for (const e of fs.readdirSync(abs).sort()) yield* walk(path.join(abs, e), rel ? `${rel}/${e}` : e);
  } else if (st.isFile()) yield { rel, abs };
}

function snapshot(root, protectedPaths = DEFAULT_PROTECTED) {
  const files = {};
  for (const p of protectedPaths) for (const f of walk(path.join(root, p), p)) files[f.rel] = f.link !== undefined ? `symlink:${f.link}` : crypto.createHash('sha256').update(fs.readFileSync(f.abs)).digest('hex');
  return files;
}

function diff(before, after) {
  const added = Object.keys(after).filter((k) => !(k in before)).sort();
  const removed = Object.keys(before).filter((k) => !(k in after)).sort();
  const modified = Object.keys(before).filter((k) => k in after && before[k] !== after[k]).sort();
  return { added, removed, modified, changed: added.length + removed.length + modified.length > 0 };
}

// Runs `run()` (which does the work) between two snapshots. `run` must be synchronous and return { status }.
function guard(root, run, { protectedPaths = DEFAULT_PROTECTED } = {}) {
  const before = snapshot(root, protectedPaths);
  let result; let thrown = null;
  try { result = run(); } catch (e) { thrown = e; }
  const after = snapshot(root, protectedPaths);
  const d = diff(before, after);
  return { ...d, filesWatched: Object.keys(before).length, status: result?.status ?? null, thrown: thrown ? thrown.message : null };
}

module.exports = { DEFAULT_PROTECTED, snapshot, diff, guard };
