#!/usr/bin/env node
// Architecture baseline and build authorization, on the command line. Runs on plain Node 22 with no install: it reads git objects and
// uses the harness's own approval rules.
//
//   node apps/architecture-studio/scripts/baseline.ts report   [--ref HEAD] [--write] [--json]
//   node apps/architecture-studio/scripts/baseline.ts gate     --area <id> | --changed <base>..<head> | --all   [--change-control]
//   node apps/architecture-studio/scripts/baseline.ts generate --id BL-0001 --areas application[,infrastructure] [--supersedes BL-0000]
//   node apps/architecture-studio/scripts/baseline.ts verify   [--id BL-0001]
//   node apps/architecture-studio/scripts/baseline.ts reopen   --id BL-0001 [--decisions D-003,D-009] --reason "..."
//   node apps/architecture-studio/scripts/baseline.ts request  --id BL-0001
//
// Exit codes: 0 allowed or ok, 2 blocked or not ready (with the reasons), 1 error or bad usage.
// Data options: --root <repo folder> (default: the repository this file is in), --ref <ref to read> (default HEAD),
// --code-root <folder whose harness code runs> (default: the repository this file is in; in CI the trusted base checkout).
// STUDIO_TRUSTED_SIGNING_KEYS_FILE (JSON list of { publicKeyPem }) lets review-record signatures be checked; without it they are not,
// and every output says so.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadReadinessInput, type LoadOptions } from '../src/lib/baseline/input.ts';
import { BASELINE_DIR, buildBaseline, manifestHash, serialize } from '../src/lib/baseline/manifest.ts';
import { computeReadiness, type Readiness, type Reason } from '../src/lib/baseline/readiness.ts';
import { hintFor, renderMatrix, renderReport } from '../src/lib/baseline/render.ts';
import { REOPEN_SCHEMA, evaluateAreas, evaluateChange, loadBaselineStates, type AreaGate, type BaselineState } from '../src/lib/baseline/state.ts';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (n: string, d = ''): string => {
  const i = argv.indexOf(`--${n}`);
  return i > 0 && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--') ? argv[i + 1]! : d;
};
const flag = (n: string) => argv.includes(`--${n}`);

const here = path.resolve(import.meta.dirname, '..', '..', '..');
const root = path.resolve(opt('root', here));
const codeRoot = path.resolve(opt('code-root', here));
const ref = opt('ref', 'HEAD');

function loadOptions(): LoadOptions {
  const f = process.env.STUDIO_TRUSTED_SIGNING_KEYS_FILE?.trim();
  let keys: LoadOptions['trustedSigningKeys'];
  if (f) {
    try {
      keys = JSON.parse(fs.readFileSync(f, 'utf8')) as LoadOptions['trustedSigningKeys'];
    } catch {
      throw new Error(`STUDIO_TRUSTED_SIGNING_KEYS_FILE (${f}) cannot be read`);
    }
  }
  return { codeRoot, trustedSigningKeys: keys };
}

const out: string[] = [];
const say = (s = '') => {
  console.log(s);
  out.push(s);
};
function summary() {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) fs.appendFileSync(f, `${out.join('\n')}\n`);
}

function explain(reasons: Reason[], indent = '  ') {
  reasons.forEach((r, n) => {
    say(`${indent}${n + 1}. ${r.text}`);
    const h = hintFor(r.code);
    if (h) say(`${indent}   To unblock: ${h}`);
  });
}

function printGate(g: AreaGate) {
  say(`Area ${g.area} (stage ${g.stage}): ${g.state === 'open' ? 'OPEN' : 'BLOCKED'}${g.baseline ? `  [baseline ${g.baseline.id} v${g.baseline.version}, ${g.baseline.currentness}]` : ''}`);
  if (g.state === 'blocked') explain(g.reasons);
}

function caution(r: Readiness) {
  if (r.signatures === 'not-verified') say('Note: Studio review-record signatures were NOT checked here (no signing key available). The hash chain and enrollment were.');
}

function main(): number {
  const lo = loadOptions();
  if (cmd === 'report') {
    const { input } = loadReadinessInput(root, ref, lo);
    const r = computeReadiness(input);
    if (flag('json')) {
      console.log(JSON.stringify({ ...r, areas: r.areas }, null, 2));
      return 0;
    }
    say(renderReport(r));
    if (flag('write')) {
      const dir = path.join(root, BASELINE_DIR);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'READINESS-REPORT.md'), renderReport(r));
      fs.writeFileSync(path.join(dir, 'DEPENDENCY-MATRIX.md'), renderMatrix(r, input));
      console.error(`Wrote ${BASELINE_DIR}/READINESS-REPORT.md and DEPENDENCY-MATRIX.md (derived; not approvals).`);
    }
    return 0;
  }

  if (cmd === 'gate') {
    const cur = loadReadinessInput(root, ref, lo);
    const r = computeReadiness(cur.input);
    const states = loadBaselineStates(root, cur, r, { ...lo, reproduce: true });
    const gates = evaluateAreas(r, states, cur.input.policy);
    say('ARCHITECTURE BUILD GATE');
    say(`Commit ${cur.input.commit.slice(0, 12)}. Policy ${cur.input.policy.hash.slice(0, 12)}. Baselines: ${states.length ? states.map((s) => `${s.id} ${s.status}/${s.currentness}`).join(', ') : 'none'}.`);
    caution(r);
    if (!cur.input.policy.valid) {
      say('The baseline policy is invalid, so nothing is authorized:');
      explain(cur.input.policy.problems.map((text) => ({ code: 'policy', text, refs: [] })));
      say();
      say('RESULT: BLOCKED. A gate that cannot read its policy fails closed.');
      summary();
      return 2;
    }
    say();
    const area = opt('area');
    const changed = opt('changed');
    if (area) {
      const g = gates.find((x) => x.area === area);
      if (!g) {
        console.error(`No area "${area}" in the policy. Areas: ${gates.map((x) => x.area).join(', ')}`);
        return 1;
      }
      printGate(g);
      say();
      say(g.state === 'open' ? `RESULT: ${area} is authorized by baseline ${g.baseline?.id}.` : `RESULT: BLOCKED. Work in "${area}" is not authorized. This gate stops CI from authorizing the workflow; it cannot stop a local edit.`);
      summary();
      return g.state === 'open' ? 0 : 2;
    }
    let files: string[] = [];
    if (changed) {
      const [base, head] = changed.split('..');
      if (!base || !head || /[^\w./^~@{}-]/.test(changed)) {
        console.error('--changed needs <base>..<head> as plain refs or commit ids');
        return 1;
      }
      const d = spawnSync('git', ['diff', '--name-only', '-z', `${base}...${head}`], { cwd: root, encoding: 'utf8' });
      if (d.status !== 0) {
        console.error(`git diff failed: ${String(d.stderr).slice(0, 200)}`);
        return 1;
      }
      files = String(d.stdout).split('\0').filter(Boolean);
    } else if (!flag('all')) {
      console.error('Give --area <id>, --changed <base>..<head>, or --all.');
      return 1;
    }
    const res = flag('all') ? { blocked: gates.some((g) => g.state === 'blocked'), touched: gates.map((g) => g.area), blockedAreas: gates.filter((g) => g.state === 'blocked'), violations: [] as Reason[] } : evaluateChange(files, cur.input.policy, gates, states, { changeControl: flag('change-control') });
    if (changed) say(`${files.length} file(s) changed; they fall in: ${res.touched.length ? res.touched.join(', ') : 'no gated area'}.`);
    for (const g of gates) if (flag('all') || res.touched.includes(g.area)) printGate(g);
    if (res.violations.length) {
      say('Architecture change control:');
      explain(res.violations);
    }
    say();
    say(res.blocked ? 'RESULT: BLOCKED. See the numbered reasons above. This gate stops CI from authorizing the change; it cannot stop a local edit or a push that bypasses CI.' : 'RESULT: allowed. No gated area is blocked and no uncontrolled architecture change was found.');
    summary();
    return res.blocked ? 2 : 0;
  }

  if (cmd === 'generate') {
    const id = opt('id');
    const areas = opt('areas').split(',').filter(Boolean);
    const cur = loadReadinessInput(root, ref, lo);
    const r = computeReadiness(cur.input);
    const states = loadBaselineStates(root, cur, r, { ...lo, reproduce: false });
    const prev = opt('supersedes') ? states.find((s) => s.id === opt('supersedes')) : null;
    if (opt('supersedes') && !prev) {
      console.error(`--supersedes ${opt('supersedes')}: no such baseline`);
      return 1;
    }
    if (states.some((s) => s.id === id)) {
      console.error(`${id} already exists. A baseline is never rewritten: make a new id that supersedes it.`);
      return 1;
    }
    const res = buildBaseline(cur.input, r, { id, version: prev ? prev.version + 1 : 1, supersedes: prev?.id ?? null, areas, generatedAt: new Date().toISOString(), codeRoot });
    if (!res.ok) {
      say(`CANNOT GENERATE ${id || '(no id)'}: the architecture is not ready for ${areas.join(', ') || '(no area)'}.`);
      explain(res.reasons);
      say();
      say('Nothing was written. There is no option to generate a baseline over an open gate.');
      return 2;
    }
    caution(r);
    for (const f of res.built.files) {
      const full = path.join(root, f.path);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, f.content, { flag: 'wx' });
    }
    say(`Generated ${id} v${res.built.manifest.version} from commit ${cur.input.commit.slice(0, 12)}: ${res.built.files.length} files in ${BASELINE_DIR}/${id}/.`);
    say(`Manifest hash (what an approval binds to): ${manifestHash(res.built.manifest, codeRoot)}`);
    say(`It is NOT approved. Review the files, commit them through a pull request, then have a human authorize it:`);
    say(`  node harness/scripts/approval.mjs decision --type baseline --id ${id} --reason "<why>" --out <file outside the repository>`);
    say(`  node harness/scripts/approval.mjs sign --file <that file> --key <your architecture-class key>`);
    say(`  commit the signed record to docs/approvals/ with a signed commit; CI verifies it.`);
    if (res.built.manifest.caveats.length) say(`Read before signing: ${res.built.manifest.caveats.length} caveat(s) in SUMMARY.md (unsigned or conditional approvals).`);
    return 0;
  }

  if (cmd === 'verify') {
    const cur = loadReadinessInput(root, ref, lo);
    const r = computeReadiness(cur.input);
    const states = loadBaselineStates(root, cur, r, { ...lo, reproduce: true });
    const want = opt('id');
    const list = want ? states.filter((s) => s.id === want) : states;
    if (!list.length) {
      say(want ? `No baseline ${want} at ${ref}.` : 'No baseline exists at this ref.');
      return want ? 1 : 0;
    }
    caution(r);
    let bad = 0;
    for (const s of list) {
      say(`${s.id} v${s.version}: ${s.status.toUpperCase()}${s.status === 'approved' ? ` / ${s.currentness}` : ''}  scope: ${s.scope?.areas.map((a) => `${a.id}@${a.stage}`).join(', ') ?? 'unknown'}`);
      if (s.authorization) say(`  authorized by approval ${s.authorization.approval} (keys ${s.authorization.signers.join(', ')}), issued ${s.authorization.issuedAt}`);
      for (const p of s.problems) (say(`  PROBLEM: ${p}`), bad++);
      for (const n of s.notes) say(`  note: ${n}`);
      for (const im of s.impacts) say(`  ${im.severity === 'invalidates' ? 'CHANGE' : 'review'}: ${im.text}${im.controlledBy ? ` [controlled by ${im.controlledBy}]` : ''}${im.affectedItems.length ? ` Affects: ${im.affectedItems.slice(0, 8).join(', ')}` : ''}`);
      for (const ro of s.reopenings) say(`  reopening ${ro.id}: ${ro.authorized ? 'AUTHORIZED' : 'no effect'}${ro.problem ? ` (${ro.problem})` : ''}`);
      if (s.status === 'approved' && s.currentness !== 'current') bad++;
    }
    summary();
    return bad ? 2 : 0;
  }

  if (cmd === 'reopen') {
    const id = opt('id');
    const reason = opt('reason');
    const decisions = opt('decisions').split(',').filter(Boolean);
    if (!reason.trim()) {
      console.error('--reason is required: a reopening says why.');
      return 1;
    }
    const cur = loadReadinessInput(root, ref, lo);
    const r = computeReadiness(cur.input);
    const states = loadBaselineStates(root, cur, r, { ...lo, reproduce: false });
    const s = states.find((x) => x.id === id);
    if (!s || s.status !== 'approved') {
      console.error(`${id} is not an approved baseline, so there is nothing to reopen.`);
      return 1;
    }
    const known = new Set(s.scope!.areas.flatMap((a) => a.decisions));
    const unknown = decisions.filter((d) => !known.has(d));
    if (unknown.length) {
      console.error(`Not in ${id}: ${unknown.join(', ')}.`);
      return 1;
    }
    const n = String(s.reopenings.length + 1).padStart(2, '0');
    const rid = `${id}-R${n}`;
    const file = path.join(root, BASELINE_DIR, id, `reopen-${n}.json`);
    fs.writeFileSync(file, serialize({ schema: REOPEN_SCHEMA, id: rid, baseline: id, baselineManifestSha256: s.manifestSha256, decisions, reason: reason.trim(), requestedAt: new Date().toISOString() }), { flag: 'wx' });
    say(`Wrote ${path.relative(root, file)}. It has NO effect until a human signs it:`);
    say(`  node harness/scripts/approval.mjs decision --type baseline-reopen --id ${rid} --reason "<why>" --out <file outside the repository>`);
    say(`While it is authorized, the affected areas are blocked until a new baseline version supersedes ${id}.`);
    return 0;
  }

  if (cmd === 'request') {
    const id = opt('id');
    const cur = loadReadinessInput(root, ref, lo);
    const r = computeReadiness(cur.input);
    const s = loadBaselineStates(root, cur, r, { ...lo, reproduce: true }).find((x) => x.id === id);
    if (!s) {
      console.error(`No baseline ${id} at ${ref}.`);
      return 1;
    }
    say(`Baseline ${id} v${s.version}: ${s.status}. Manifest hash ${s.manifestSha256}.`);
    if (s.problems.length) {
      say('It has integrity problems and cannot be authorized:');
      s.problems.forEach((p) => say(`  - ${p}`));
      return 2;
    }
    say('To authorize: read SUMMARY.md and the caveats, then:');
    say(`  node harness/scripts/approval.mjs decision --type baseline --id ${id} --reason "<why>" --out <file outside the repository>`);
    say('  node harness/scripts/approval.mjs sign --file <that file> --key <your architecture-class key>');
    say('  commit the signed record to docs/approvals/ with a signed commit and open a pull request.');
    say('Authorizing a baseline does not raise the phase. Both are needed before any gated build.');
    return 0;
  }

  console.error('usage: baseline.ts report | gate | generate | verify | reopen | request (see the header of this file)');
  return 1;
}

try {
  process.exitCode = main();
} catch (e) {
  console.error(`baseline: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
