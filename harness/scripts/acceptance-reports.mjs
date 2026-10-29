#!/usr/bin/env node
// Generates two acceptance documents from repository data, so they cannot drift from it or be edited into agreement:
//   docs/acceptance/REQUIREMENTS-COVERAGE.md   every requirement against its design trace rows, its evaluation tests and its latest result
//   docs/acceptance/TEST-EVIDENCE-INDEX.md     every evidence record, every committed evaluation run, the test files and the validators
// Usage: node harness/scripts/acceptance-reports.mjs [--write] [--check] [--root <dir>]
// Zero dependencies. It reads files only. A coverage class says what was SHOWN by a test that ran in the committed run; it never says a
// requirement is satisfied. The committed run is a human-run record (docs/evaluation/EVALUATION-FRAMEWORK.md).
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQ_RE = /^\| ((?:BR|FR|SEC|DATA|AGT|NFR)-\d{3}) \|/;
const read = (root, p) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const j = (root, p) => JSON.parse(read(root, p));
const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const MARK = '<!-- generated: node harness/scripts/acceptance-reports.mjs --write -->';

export function loadRequirements(root) {
  const out = [];
  for (const f of ['REQUIREMENTS.md', 'NON-FUNCTIONAL-REQUIREMENTS.md']) {
    for (const l of read(root, `docs/context/${f}`).split('\n')) {
      if (!REQ_RE.test(l)) continue;
      const c = cells(l);
      out.push({ id: c[0], caps: c[1], text: c[2], cls: c[3], pri: c[4] });
    }
  }
  return out;
}
function hardConstraintLinks(root) {
  const m = new Map();
  for (const l of read(root, 'docs/architecture/HARD-CONSTRAINTS.md').split('\n')) {
    const c = cells(l); if (!/^HC-\d\d$/.test(c[0] ?? '')) continue;
    for (const id of (c.at(-1) ?? '').match(/(?:BR|FR|SEC|DATA|AGT|NFR)-\d{3}/g) ?? []) m.set(id, [...(m.get(id) ?? []), c[0]]);
  }
  return m;
}
function designTrace(root) {
  const m = new Map(); const dir = 'docs/architecture/designs';
  for (const f of readdirSync(path.join(root, dir)).filter((x) => /^DES-\d{4}.*\.md$/.test(x)).sort()) {
    const des = f.slice(0, 8);
    for (const l of read(root, `${dir}/${f}`).split('\n')) {
      if (!REQ_RE.test(l)) continue; const c = cells(l);
      if (c.length >= 5 && ['Addressed', 'Partial', 'Unresolved', 'Not applicable'].some((s) => c[3].startsWith(s))) m.set(c[0], [...(m.get(c[0]) ?? []), `${des} ${c[3].split(/[ (]/)[0]}`]);
    }
  }
  return m;
}
function adrMentions(root) {
  const m = new Map(); const dir = 'docs/adr';
  for (const f of readdirSync(path.join(root, dir)).filter((x) => /^\d{4}-.*\.md$/.test(x))) {
    for (const id of new Set(read(root, `${dir}/${f}`).match(/(?:BR|FR|SEC|DATA|AGT|NFR)-\d{3}/g) ?? [])) m.set(id, [...(m.get(id) ?? []), f.slice(0, 4)]);
  }
  return m;
}
export function latestFullRun(root) {
  const dir = 'docs/evaluation/runs'; if (!existsSync(path.join(root, dir))) return null;
  let best = null;
  for (const id of readdirSync(path.join(root, dir)).filter((d) => /^EVRUN-[0-9a-f]{10}$/.test(d))) {
    const run = j(root, `${dir}/${id}/run.json`); if (!run.partial && (!best || run.startedAt > best.run.startedAt)) best = { id, run };
  }
  return best;
}
function catalogue(root) {
  const tests = [];
  for (const f of readdirSync(path.join(root, 'evaluation/catalogue')).filter((x) => x.endsWith('.json')).sort()) tests.push(...j(root, `evaluation/catalogue/${f}`).tests);
  return tests;
}

export function coverage(root) {
  const reqs = loadRequirements(root); const hc = hardConstraintLinks(root); const des = designTrace(root); const adr = adrMentions(root);
  const cat = catalogue(root); const run = latestFullRun(root);
  const status = new Map((run?.run.tests ?? []).map((t) => [t.id, t.status]));
  const rows = reqs.map((r) => {
    const tests = cat.filter((t) => t.requirements.includes(r.id));
    const exec = tests.filter((t) => t.mode === 'executable'); const pend = tests.filter((t) => t.mode === 'pending');
    const st = (t) => status.get(t.id) ?? 'NOT-RUN';
    let cls;
    if (exec.some((t) => st(t) === 'FAIL')) cls = 'TESTED, A TEST FAILS';
    else if (exec.some((t) => st(t) === 'BLOCKED' || st(t) === 'NOT-RUN')) cls = 'TESTED, A TEST BLOCKED';
    else if (exec.length) cls = 'TESTED AND PASSING';
    else if (pend.length) cls = 'PENDING TEST ONLY';
    else if (des.has(r.id)) cls = 'DESIGNED ONLY';
    else cls = 'SPECIFIED ONLY';
    return { ...r, hc: hc.get(r.id) ?? [], design: des.get(r.id) ?? [], adrs: [...new Set(adr.get(r.id) ?? [])].sort(), exec: exec.map((t) => `${t.id.replace('EVAL-', '')} ${st(t)}`), pend: pend.map((t) => t.id.replace('EVAL-', '')), cls };
  });
  return { rows, run };
}

export function renderCoverage(root) {
  const { rows, run } = coverage(root);
  const counts = {}; for (const r of rows) counts[r.cls] = (counts[r.cls] ?? 0) + 1;
  const order = ['TESTED AND PASSING', 'TESTED, A TEST FAILS', 'TESTED, A TEST BLOCKED', 'PENDING TEST ONLY', 'DESIGNED ONLY', 'SPECIFIED ONLY'];
  const must = rows.filter((r) => r.pri === 'Must');
  const L = [MARK, '# Requirements coverage', '',
    `Generated from the requirements baseline, the design trace tables, the ADRs, the evaluation catalogue and the committed evaluation run ${run ? `\`${run.id}\` (commit \`${(run.run.gitHead ?? 'unknown').slice(0, 7)}\`)` : '(none: no committed full run)'}. Do not edit: \`validate-harness\` regenerates this file and fails on any difference.`, '',
    '**What a class means.** It says what a test that actually ran has shown. It never says a requirement is satisfied. A passing test of a candidate contract or of the harness shows that contract or harness behaves as the test states; it does not show that a production system meets the requirement, and no production system exists. TESTED AND PASSING is therefore the strongest class that can exist today.', '',
    '| Class | Meaning |', '|---|---|',
    '| TESTED AND PASSING | At least one executable evaluation test names the requirement and every one of them passed in the committed run |',
    '| TESTED, A TEST FAILS | An executable test names it and failed. This is a finding, not a defect of the framework |',
    '| TESTED, A TEST BLOCKED | An executable test names it and did not run because a gate was not met |',
    '| PENDING TEST ONLY | Only a production-agent test names it, and that test cannot run because no agent or application exists |',
    '| DESIGNED ONLY | A design trace row exists and no test names it |',
    '| SPECIFIED ONLY | The requirement is in the baseline and nothing else refers to it |', '',
    `## Summary (${rows.length} requirements, ${must.length} Must)`, '', '| Class | All | Must |', '|---|---|---|',
    ...order.map((c) => `| ${c} | ${counts[c] ?? 0} | ${must.filter((r) => r.cls === c).length} |`), '',
    '## Requirement by requirement', '', '| ID | Priority | Capabilities | Hard constraints | Design trace | ADRs naming it | Executable tests (latest run) | Pending tests | Class |', '|---|---|---|---|---|---|---|---|---|'];
  for (const r of rows) L.push(`| ${r.id} | ${r.pri} | ${cell(r.caps)} | ${r.hc.join(', ') || '-'} | ${r.design.join('; ') || '-'} | ${r.adrs.map((a) => `ADR-${a}`).join(', ') || '-'} | ${r.exec.join('; ') || '-'} | ${r.pend.join('; ') || '-'} | **${r.cls}** |`);
  L.push('', '## Reading this honestly', '',
    '- A requirement whose only design row is in DES-0001 or DES-0002 is at most Partial there, because both designs are Blocked by the gate; see their review records.',
    '- Most Must requirements about agents, certificates, mass balance, the customer boundary and operations have no test at all. They belong to components that do not exist, and their pending tests say so.',
    '- A requirement listed with a test only through a hard constraint is covered indirectly. The hard-constraint matrix in the evaluation report is the better view for those.', '');
  return `${L.join('\n')}\n`;
}

const exec = (e) => (e.exitCode === 0 ? 'exit 0' : e.exitCode === null ? `no exit (${e.signal ?? e.spawnError ?? 'killed'})` : `exit ${e.exitCode}`);
export function renderIndex(root) {
  const evDir = 'docs/evidence/records'; const ev = readdirSync(path.join(root, evDir)).filter((f) => /^EV-\d{4}\.json$/.test(f)).sort().map((f) => j(root, `${evDir}/${f}`));
  const runsDir = 'docs/evaluation/runs'; const runs = existsSync(path.join(root, runsDir)) ? readdirSync(path.join(root, runsDir)).filter((d) => /^EVRUN-/.test(d)).sort().map((id) => ({ id, run: j(root, `${runsDir}/${id}/run.json`) })) : [];
  const pkg = j(root, 'package.json');
  const testFiles = readdirSync(path.join(root, 'tests')).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => ({ f, n: (read(root, `tests/${f}`).match(/^\s*test\(/gm) ?? []).length }));
  const L = [MARK, '# Test and evidence index', '',
    'Generated from the evidence records, the committed evaluation runs, the test folder and `package.json`. Do not edit: `validate-harness` regenerates this file and fails on any difference.', '',
    '**What an evidence record is.** The recorder runs a command and stores what happened: arguments, exit code, duration, an output hash and the output tail, the Git commit and the runtime. It records facts about a run; it does not judge whether the command proves the claim. A claim is only as good as the command that backs it. A record with no exit code is a timeout or a kill, and is kept (append-only).', '',
    `## A. Evidence records (${ev.length})`, '', '| ID | Recorded | Commit | Command | Outcome | Claim |', '|---|---|---|---|---|---|'];
  for (const e of ev) L.push(`| ${e.id} | ${String(e.startedAt ?? '').slice(0, 10)} | \`${String(e.gitHead ?? '').slice(0, 7)}\` | \`${cell(e.argv.join(' ')).slice(0, 70)}\` | ${exec(e)} | ${cell(e.claim).slice(0, 150)} |`);
  L.push('', `## B. Committed evaluation runs (${runs.length})`, '', 'Only the latest full run is kept in the tree; earlier runs remain in Git history. The full per-test table is in [EVALUATION-REPORT](../evaluation/EVALUATION-REPORT.md).', '', '| Run | Commit | Partial | PASS | FAIL | BLOCKED | PENDING | Gates |', '|---|---|---|---|---|---|---|---|');
  for (const { id, run } of runs) L.push(`| ${id} | \`${(run.gitHead ?? '').slice(0, 7)}\` | ${run.partial ? 'yes' : 'no'} | ${run.counts.PASS} | ${run.counts.FAIL} | ${run.counts.BLOCKED} | ${run.counts.PENDING} | ${run.gates.map((g) => `${g.id} ${g.status}`).join(', ') || 'not evaluated'} |`);
  L.push('', `## C. Test files (${testFiles.length}) run by \`npm test\``, '', 'The count is the number of top-level `test(` declarations in the file. Generated cases (mutation tables) run several tests per declaration, so the executed total is larger; the executed total is in the evidence record for `npm test`.', '', '| File | Declarations |', '|---|---|');
  for (const t of testFiles) L.push(`| tests/${t.f} | ${t.n} |`);
  L.push('', '## D. Validators and commands', '', '| Script | Command |', '|---|---|');
  for (const [k, v] of Object.entries(pkg.scripts)) if (/^(validate|test|evaluate)/.test(k)) L.push(`| ${k} | \`${v}\` |`);
  L.push('', '## E. How to reproduce', '', '```', 'git clone <repository>; cd greenfuel-agent-harness', 'node harness/scripts/validate-harness.mjs        structure, secrets, phase gate, and every sub-validator', 'node harness/scripts/evaluate.mjs rerun           re-run the whole evaluation and compare it with the committed run', 'node --test                                       the test suite (set CI=true; the TypeScript scenario needs the pinned toolchain)', '```', '',
    'There are no dependencies to install. Node 20 or later is required (the harness was developed on Node 22). The TypeScript build scenario of the loop needs a pinned toolchain installed outside the manifest; without it that test is skipped and the evaluation reports it BLOCKED, never passed.', '');
  return `${L.join('\n')}\n`;
}

export const OUTPUTS = { 'docs/acceptance/REQUIREMENTS-COVERAGE.md': renderCoverage, 'docs/acceptance/TEST-EVIDENCE-INDEX.md': renderIndex };

export function validateAcceptance(root) {
  const errors = []; const fail = (msg) => errors.push({ check: 'acceptance', msg });
  try {
    for (const [f, render] of Object.entries(OUTPUTS)) {
      if (!existsSync(path.join(root, f))) { fail(`missing ${f}`); continue; }
      if (read(root, f) !== render(root)) fail(`${f} does not match what the generator produces from the repository; regenerate it with acceptance-reports.mjs --write, never edit it`);
    }
  } catch (e) { fail(`the acceptance documents could not be checked (${e.message})`); }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const ri = args.indexOf('--root');
  const root = ri >= 0 ? path.resolve(args[ri + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  if (args.includes('--write')) { for (const [f, render] of Object.entries(OUTPUTS)) { writeFileSync(path.join(root, f), render(root)); console.log(`wrote ${f}`); } process.exit(0); }
  if (args.includes('--check')) { const e = validateAcceptance(root); for (const x of e) console.error(`acceptance-reports: ${x.msg}`); if (!e.length) console.log('acceptance-reports: OK'); process.exit(e.length ? 1 : 0); }
  console.log('usage: acceptance-reports.mjs --write | --check');
  process.exit(2);
}
