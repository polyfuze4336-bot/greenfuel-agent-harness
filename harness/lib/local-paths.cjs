'use strict';
// Removes this machine's absolute paths and account name from captured command output before it is stored. Stack traces and test locations
// carry them, and stored output is committed. Replacement is textual and best effort: it reduces the chance of publishing a personal path,
// and `validate-harness` checks that the current account name does not appear in tracked files.
const os = require('node:os');
const path = require('node:path');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ROOT = path.resolve(__dirname, '..', '..');

function variants(p) {
  const fwd = p.replace(/\\/g, '/');
  // test runners print backslashes doubled inside quoted YAML values
  return [...new Set([p, p.replace(/\\/g, '\\\\'), fwd, `file:///${encodeURI(fwd)}`, `file://${encodeURI(fwd)}`, encodeURI(fwd)])];
}

// The account name, or '' when it is absent or a generic service-account name (CI runners, containers). Generic names are ordinary words
// and would change or flag unrelated text.
function distinctiveUser() {
  let user = '';
  try { user = os.userInfo().username; } catch { /* no account name available */ }
  const generic = new Set(['runner', 'root', 'admin', 'user', 'ubuntu', 'vscode', 'node', 'docker', 'default', 'system']);
  return user.length >= 4 && !generic.has(user.toLowerCase()) ? user : '';
}

function scrub(text, extraRoots = []) {
  let out = String(text);
  const roots = [...new Set([ROOT, ...extraRoots.map((r) => path.resolve(r))])];
  const swaps = [];
  for (const r of roots) for (const v of variants(r)) swaps.push([v, '<repo>']);
  for (const v of variants(os.homedir())) swaps.push([v, '<home>']);
  // longest first so a repository path is replaced before the home folder that contains it
  swaps.sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of swaps) if (from.length > 3) out = out.replace(new RegExp(esc(from), 'gi'), to);
  const user = distinctiveUser();
  if (user) out = out.replace(new RegExp(esc(user), 'gi'), '<user>');
  return out;
}

module.exports = { scrub, distinctiveUser };
