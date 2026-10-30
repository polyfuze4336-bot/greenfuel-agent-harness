#!/usr/bin/env node
// Control-plane guard for CI: independent enforcement that does not depend on any hook, agent or local machine.
//
// Rule: every commit in the range base..head that touches a control-plane path must be GitHub-VERIFIED (a valid signature that GitHub checked
// against the committer's registered signing keys) and must be made by an enrolled repository owner (or merged by GitHub on an owner's behalf).
// An agent in the dev container holds no signing key and no remote credentials, so it cannot produce such a commit. A model that writes
// text into the registry, an ADR or a policy file cannot make that text pass this check.
//
// The rule set and the owner list are read from the BASE commit, never from the change being judged, so a change cannot weaken its own guard.
// It fails closed: an unreadable policy, an API error, a missing owner list or an unverifiable commit is a finding, not a pass.
// Modes: "enforce" fails the job on any finding. "report" prints every finding and passes. The mode is a human decision:
// set the repository variable GF_CONTROL_PLANE_ENFORCE to true (or "enforce": true in control-plane-owners.json) once the owner has set up
// signed commits (docs/security/APPROVER-ENROLLMENT.md). Until then this guard reports and does NOT enforce, and the documents say so.
//
// Usage: node harness/scripts/ci-control-plane-guard.mjs --base <sha> --head <sha> --repo owner/name [--mode report|enforce]
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const registry = require('../approvals/registry.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ZERO = /^0+$/;

// Always protected, whatever the base policy says. The base policy can only add to this list.
const BASELINE_PATTERNS = ['^\\.github/', '^harness/', '^evaluation/', '^\\.vscode/', '^\\.devcontainer/', '^\\.mcp\\.json$', '^package\\.json$', '^\\.gitignore$', '^\\.gitattributes$', '^memory/', '^docs/approvals/', '^docs/baselines/', '^docs/adr/', '^docs/evidence/'];

function realDeps(repoDir = root) {
  const git = (args) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return {
    git,
    readAtRef: (ref, file) => git(['show', `${ref}:${file}`]),
    listCommits: (base, head) => {
      const out = git(['log', '--name-only', '--format=%x01%H', `${base}..${head}`]);
      return out.split('\x01').filter(Boolean).map((chunk) => { const [sha, ...files] = chunk.split('\n').map((s) => s.trim()).filter(Boolean); return { sha, files }; });
    },
    fetchCommit: async (repo, sha) => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new Error('GITHUB_TOKEN is not available');
      const res = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'greenfuel-control-plane-guard' } });
      if (!res.ok) throw new Error(`GitHub API answered ${res.status} for commit ${sha.slice(0, 8)}`);
      const j = await res.json();
      return { verified: j.commit?.verification?.verified === true, reason: j.commit?.verification?.reason ?? 'unknown', authorLogin: j.author?.login ?? null, committerLogin: j.committer?.login ?? null };
    },
  };
}

export async function checkRange({ base, head, repo, mode, deps = realDeps(), env = process.env }) {
  const findings = []; const touched = new Set(); let enforce = mode === 'enforce' || (mode === undefined && env.GF_CONTROL_PLANE_ENFORCE === 'true');
  const finding = (msg) => findings.push(msg);
  let patterns = BASELINE_PATTERNS.map((p) => new RegExp(p, 'i'));
  let owners = null;
  try {
    const perm = JSON.parse(deps.readAtRef(base, 'harness/policy/permissions.json'));
    const cp = perm.pathClasses.find((c) => c.id === 'control-plane');
    if (cp) patterns = [...patterns, new RegExp(cp.pattern, 'i')];
  } catch (e) { finding(`the control-plane policy at the base commit could not be read (${e.message}); using the built-in list only`); }
  try {
    const o = JSON.parse(deps.readAtRef(base, 'harness/policy/control-plane-owners.json'));
    owners = (Array.isArray(o.owners) ? o.owners : []).map((x) => String(x.login ?? '').toLowerCase()).filter(Boolean);
    if (o.enforce === true) enforce = true;
  } catch (e) { finding(`the control-plane owner list at the base commit could not be read (${e.message}); no commit can be attributed to an owner`); owners = []; }
  let commits;
  try { commits = deps.listCommits(base, head); } catch (e) { return { ok: !enforce, enforce, findings: [...findings, `the commit range ${String(base).slice(0, 8)}..${String(head).slice(0, 8)} could not be listed (${e.message})`], touched: [] }; }
  for (const c of commits) {
    const cp = c.files.filter((f) => patterns.some((re) => re.test(f)));
    if (!cp.length) continue;
    cp.forEach((f) => touched.add(f));
    let v;
    try { v = await deps.fetchCommit(repo, c.sha); } catch (e) { finding(`${c.sha.slice(0, 8)}: cannot verify the commit (${e.message}); it touches ${cp.slice(0, 3).join(', ')}${cp.length > 3 ? ', ...' : ''}`); continue; }
    const author = String(v.authorLogin ?? '').toLowerCase(); const committer = String(v.committerLogin ?? '').toLowerCase();
    const byOwner = owners.includes(committer) || (committer === 'web-flow' && owners.includes(author));
    if (!v.verified || v.reason !== 'valid') finding(`${c.sha.slice(0, 8)}: touches the control plane (${cp.slice(0, 3).join(', ')}${cp.length > 3 ? ', ...' : ''}) but is not a GitHub-verified commit (${v.reason})`);
    else if (!byOwner) finding(`${c.sha.slice(0, 8)}: touches the control plane but was not made by an enrolled owner (author ${v.authorLogin ?? '?'}, committer ${v.committerLogin ?? '?'})`);
  }
  // A registry change must also be a valid registry: well-formed entries with proof of possession.
  if ([...touched].includes('harness/policy/approvers.json')) {
    try {
      const reg = registry.registryProblems(JSON.parse(deps.readAtRef(head, 'harness/policy/approvers.json')).approvers ?? []);
      for (const e of reg.errors) finding(`approver registry: ${e}`);
    } catch (e) { finding(`approver registry at the head commit could not be checked (${e.message})`); }
  }
  return { ok: !enforce || findings.length === 0, enforce, findings, touched: [...touched].sort(), commits: commits.length };
}

async function main() {
  const a = process.argv.slice(2); const opt = (n) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; };
  const deps = realDeps();
  let base = opt('base'); const head = opt('head') ?? 'HEAD'; const repo = opt('repo') ?? process.env.GITHUB_REPOSITORY; const mode = opt('mode');
  if (!repo) { console.error('control-plane-guard: --repo owner/name is required'); process.exit(2); }
  if (!base || ZERO.test(base)) { try { base = deps.git(['rev-parse', `${head}~1`]).trim(); } catch { console.error('control-plane-guard: no base commit and no parent: cannot judge the range'); process.exit(2); } }
  const r = await checkRange({ base, head, repo, mode, deps });
  for (const f of r.findings) console.error(`${r.enforce ? 'FAIL' : 'REPORT'} ${f}`);
  console.log(`control-plane-guard: ${r.enforce ? 'ENFORCED' : 'REPORT ONLY (not enforced: no owner has enabled enforcement)'}; ${r.commits ?? 0} commit(s) checked, ${r.touched.length} control-plane file(s) touched, ${r.findings.length} finding(s)${r.ok ? '' : ': BLOCKED'}`);
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(`control-plane-guard: ${e.message}`); process.exit(2); });
