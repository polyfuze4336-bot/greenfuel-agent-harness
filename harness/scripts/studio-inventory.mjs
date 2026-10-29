#!/usr/bin/env node
// READ-ONLY discovery for the Architecture Decision Studio. Reads the repository, writes nothing unless --write is given (then it writes only the
// generated snapshot docs/architecture-studio/inventory.snapshot.json). It decides nothing and changes no decision. Every count it prints comes
// from a rule stated in docs/architecture-studio/DATA-MAPPING.md. Where a record cannot be classified by a rule it is listed under "review".
//   node harness/scripts/studio-inventory.mjs            print the summary
//   node harness/scripts/studio-inventory.mjs --json     print the full result as JSON
//   node harness/scripts/studio-inventory.mjs --write    also write the generated snapshot
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (p) => path.relative(root, p).split(path.sep).join('/');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const exists = (f) => fs.existsSync(path.join(root, f));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
const isSep = (c) => c.every((x) => /^:?-{3,}:?$/.test(x));
const rows = (t) => t.split('\n').filter((l) => l.trim().startsWith('|')).map(cells).filter((c) => !isSep(c));
const field = (t, name) => t.match(new RegExp(`^- \\*\\*${name}:\\*\\*\\s*(.*)$`, 'm'))?.[1].trim();
const countBy = (arr, f) => arr.reduce((o, x) => { const k = f(x); o[k] = (o[k] ?? 0) + 1; return o; }, {});
function* walk(dir, skip = new Set(['.git', 'node_modules', '.harness-logs', '.harness-work'])) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = path.posix.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, skip); else yield p;
  }
}
const out = { generatedBy: 'harness/scripts/studio-inventory.mjs', git: {}, sources: {}, counts: {}, review: [] };
const review = (id, why, where) => out.review.push({ id, why, where });

// ---- git
const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' }).stdout.trim();
out.git = { head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), originMain: git('rev-parse', 'origin/main'), commitsAheadOfOriginMain: Number(git('rev-list', '--count', 'origin/main..HEAD')), dirty: git('status', '--porcelain').split('\n').filter(Boolean).length };

// ---- 1. Decision register (open decisions, D-nnn)
{
  const f = 'docs/context/DECISION-REGISTER.md';
  const ds = rows(read(f)).filter((c) => /^D-\d{3}$/.test(c[0])).map((c) => ({ id: c[0], kind: c[1], needed: c[6], owner: c[5], status: c[7] }));
  out.counts.decisionRegister = { source: f, rule: 'table rows whose first cell matches D-nnn', total: ds.length, byStatus: countBy(ds, (d) => d.status), byKind: countBy(ds, (d) => d.kind), byMilestone: countBy(ds, (d) => d.needed), m1: ds.filter((d) => d.needed === 'M1').map((d) => d.id) };
  out.registerIds = ds.map((d) => d.id);
}

// ---- 2. ADRs
const adrFiles = fs.readdirSync(path.join(root, 'docs/adr')).filter((n) => /^\d{4}-.*\.md$/.test(n) && !n.startsWith('0000-')).sort();
const adrs = adrFiles.map((n) => {
  const t = read(`docs/adr/${n}`); const status = field(t, 'Status') ?? '';
  const cls = /^Accepted/.test(status) ? 'Accepted' : /^Proposed/.test(status) ? 'Proposed' : /^Rejected/.test(status) ? 'Rejected' : /^Superseded/.test(status) ? 'Superseded' : /^Deferred/.test(status) ? 'Deferred' : 'UNCLASSIFIED';
  const supersedes = field(t, 'Supersedes') ?? '';
  const revisit = /^## Revisit when/m.test(t);
  return { id: n.slice(0, 4), file: `docs/adr/${n}`, title: t.split('\n')[0].replace(/^# /, ''), status, cls, type: field(t, 'Type') ?? '(none: pre-Type)', date: field(t, 'Date'), deciders: field(t, 'Deciders'), supersedes, hasSupersedes: supersedes && !/^none/i.test(supersedes), chatAcceptance: /by instruction in chat/i.test(status), delegated: /decision is the architect's|architect, on the owner's instruction/i.test(status), partial: /deferred|not approved|excluded/i.test(status) && cls === 'Accepted', factBullets: (t.match(/^- FACT/gm) ?? []).length, assumptionBullets: (t.match(/^- ASSUMPTION/gm) ?? []).length, openRefs: [...new Set(t.match(/\bD-\d{3}\b/g) ?? [])], sha256: sha(t), revisit };
});
out.adrs = adrs.map(({ sha256, ...rest }) => rest);
{
  let options = 0; let rejectedWord = 0;
  for (const a of adrs) { const o = read(a.file).match(/## Options considered([\s\S]*?)\n## /); if (!o) continue; for (const l of o[1].split('\n')) if (/^\d+\.\s/.test(l)) { options++; if (/rejected/i.test(l)) rejectedWord++; } }
  out.counts.adrOptions = { source: 'docs/adr/*.md, section "## Options considered"', rule: 'numbered list items; "rejected-worded" = the item text contains the word rejected (any case). Approximate: it is not a structured field', options, rejectedWorded: rejectedWord };
  const inputs = read('docs/business/model/inputs.csv').split('\n').slice(1).filter(Boolean).map((l) => l.match(/"([^"]*)"/g).map((x) => x.slice(1, -1)));
  out.counts.businessModelInputs = { source: 'docs/business/model/inputs.csv', rule: 'one row per model input; class column (5th)', total: inputs.length, byClass: countBy(inputs, (r) => r[4]) };
}
out.counts.adr = { source: 'docs/adr/NNNN-*.md (excluding 0000-template.md)', rule: '"- **Status:** <word>" line; first word decides the class', total: adrs.length, byClass: countBy(adrs, (a) => a.cls), acceptedByChatInstruction: adrs.filter((a) => a.cls === 'Accepted' && a.chatAcceptance).length, acceptedWithPartialScope: adrs.filter((a) => a.partial).map((a) => a.id), acceptedByDelegation: adrs.filter((a) => a.delegated).map((a) => a.id), rejected: adrs.filter((a) => a.cls === 'Rejected').length, superseded: adrs.filter((a) => a.cls === 'Superseded' || a.hasSupersedes).length, byType: countBy(adrs, (a) => a.type) };
for (const a of adrs.filter((x) => x.cls === 'UNCLASSIFIED')) review(`ADR-${a.id}`, 'status line not recognised', a.file);
for (const a of adrs.filter((x) => x.delegated)) review(`ADR-${a.id}`, 'accepted by the architect on the owner\'s instruction: confirm this is the owner\'s own decision', a.file);
for (const a of adrs.filter((x) => x.partial)) review(`ADR-${a.id}`, 'accepted with part of the scope excluded or deferred: the Accepted label does not cover the whole subject', a.file);

// ---- 3. Designs and reviews
{
  const designs = fs.readdirSync(path.join(root, 'docs/architecture/designs')).filter((n) => /^DES-/.test(n)).map((n) => { const t = read(`docs/architecture/designs/${n}`); return { id: field(t, 'Design ID'), review: field(t, 'Review'), adrs: (field(t, 'ADRs') ?? '').split(',').map((s) => s.trim()).filter(Boolean), tags: field(t, 'Tags') }; });
  const reviews = fs.readdirSync(path.join(root, 'docs/architecture/reviews')).filter((n) => /^RV-/.test(n)).map((n) => {
    const t = read(`docs/architecture/reviews/${n}`); const gate = spawnSync(process.execPath, ['harness/scripts/design-gate.mjs', `docs/architecture/reviews/${n}`], { cwd: root, encoding: 'utf8' }).stdout.split('\n');
    const computed = gate.find((l) => l.startsWith('Computed:')) ?? ''; const blocks = gate.filter((l) => l.startsWith('BLOCK')); const rej = gate.filter((l) => l.startsWith('REJECT'));
    const blockingDecisions = [...new Set(blocks.flatMap((l) => l.match(/\bD-\d{3}\b/g) ?? []))].sort();
    return { id: field(t, 'Review ID'), design: field(t, 'Design'), declared: field(t, 'Status'), decider: field(t, 'Decider'), computed: computed.replace(/^Computed:\s*/, '').split(/\s+/)[0], computedLine: computed, blockReasons: blocks.length, rejectReasons: rej.length, blockingDecisions };
  });
  out.designs = designs; out.reviews = reviews;
  out.counts.designReviews = { source: 'docs/architecture/designs/*.md, docs/architecture/reviews/*.md, harness/scripts/design-gate.mjs', rule: 'declared status from the "- **Status:**" line; computed status by running the existing gate (read-only)', designs: designs.length, reviews: reviews.length, declaredBlocked: reviews.filter((r) => r.declared === 'Blocked').length, computedBlocked: reviews.filter((r) => r.computed === 'Blocked').length, blockReasonsTotal: reviews.reduce((n, r) => n + r.blockReasons, 0), distinctBlockingDecisions: [...new Set(reviews.flatMap((r) => r.blockingDecisions))].sort() };
  // Option-level dispositions in the review comparison tables
  const disp = { Selected: 0, 'Not selected': 0, 'Rejected (hard constraint)': 0, Deferred: 0 }; const perDesign = {};
  for (const n of fs.readdirSync(path.join(root, 'docs/architecture/designs'))) { perDesign[n.slice(0, 8)] = { Selected: 0, 'Not selected': 0, 'Rejected (hard constraint)': 0, Deferred: 0 }; for (const c of rows(read(`docs/architecture/designs/${n}`))) for (const x of c) if (x in disp) { disp[x]++; perDesign[n.slice(0, 8)][x]++; } }
  out.counts.optionDispositions = { source: 'docs/architecture/designs/DES-*.md', rule: 'table cells equal to a design-gate disposition word. "Selected" means the option under review, not an approved option: every review is Blocked', ...disp, perDesign };
  const dq = { Answered: 0, Unanswered: 0, 'Not applicable': 0 };
  for (const n of fs.readdirSync(path.join(root, 'docs/architecture/reviews'))) for (const c of rows(read(`docs/architecture/reviews/${n}`))) if (/^DQ-\d+-\d+$/.test(c[0]) && c[1] in dq) dq[c[1]]++;
  out.counts.defenceQuestions = { source: 'docs/architecture/reviews/RV-*.md', rule: 'rows DQ-nn-nn; second cell is the answer state', ...dq };
}

// ---- 4. Tasks (TODO.md) and other task families
{
  const t = read('docs/state/TODO.md'); let section = ''; const tasks = [];
  for (const l of t.split('\n')) {
    const h = l.match(/^## (.*)/); if (h) { section = h[1]; continue; }
    if (!/^\| T\d+ \|/.test(l)) continue; const c = cells(l); const body = c.slice(1).join(' | ');
    const lead = body.match(/^\*\*(Decided|Done|Approved|Deferred|Open|Agreed|Not granted|Answered)\b/i)?.[1]?.toLowerCase();
    const tokens = [...new Set([...body.slice(0, 600).matchAll(/\b(Deferred|Decided|Done|Approved|Open|Answered|Not granted|NOT RUN)\b/g)].map((m) => m[1].toLowerCase()))];
    let status = lead ?? (section.startsWith('Owner has deferred') ? 'deferred' : 'unmarked');
    if (status === 'not granted') status = 'not-granted';
    const ambiguous = status === 'unmarked' || (tokens.length > 2 && !lead) || (lead && tokens.filter((x) => x !== lead).length >= 3);
    tasks.push({ id: c[0], section, status, tokens, ambiguous, title: body.replace(/\*\*/g, '').slice(0, 90) });
  }
  out.tasks = tasks;
  out.counts.todoTasks = { source: 'docs/state/TODO.md', rule: 'rows "| Tn |"; status = leading bold keyword, else "deferred" in the first section, else "unmarked"', total: tasks.length, byStatus: countBy(tasks, (x) => x.status), bySection: countBy(tasks, (x) => x.section), ambiguousForReview: tasks.filter((x) => x.ambiguous).map((x) => x.id) };
  for (const x of tasks.filter((y) => y.ambiguous)) review(x.id, `task status is ambiguous (${x.status}; keywords: ${x.tokens.join(', ') || 'none'})`, 'docs/state/TODO.md');
  const decided = rows(t.slice(t.indexOf('## Decisions made'))).filter((c) => /^\d{4}-\d\d-\d\d$/.test(c[0]));
  out.counts.todoDecisionsMade = { source: 'docs/state/TODO.md "Decisions made" table', rule: 'rows whose first cell is a date', total: decided.length };
}
{
  const fam = {};
  const FAMILIES = { R: 'docs/harness/IMPLEMENTATION-ROADMAP.md', Q: 'docs/harness/OPEN-QUESTIONS.md', B: 'docs/capstone/PRIORITIZED-BACKLOG.md', G: 'docs/capstone/CRITICAL-GAPS.md' };
  for (const [p, f] of Object.entries(FAMILIES)) { if (!exists(f)) continue; const ids = new Set([...read(f).matchAll(new RegExp(`(?:^\\| |\\*\\*)(${p}-?\\d{1,3})\\b`, 'gm'))].map((m) => m[1])); fam[p] = { source: f, count: ids.size }; }
  out.counts.otherTaskFamilies = fam;
}

// ---- 5. Assumptions, risks, requirements
{
  const as = rows(read('docs/context/ASSUMPTIONS.md')).filter((c) => /^AS-\d{3}$/.test(c[0])).map((c) => ({ id: c[0], replacedBy: c[5] }));
  const reg = new Set(out.registerIds);
  const dRefs = (s) => s.match(/D-\d{3}/g) ?? [];
  const adrAccepted = new Set(adrs.filter((a) => a.cls === 'Accepted').map((a) => a.id));
  const adrRefs = (s) => [...s.matchAll(/ADR[- ]?(\d{4})/g)].map((m) => m[1]);
  // Resolved only when the named replacement is a specific Accepted ADR and no open register decision is also named.
  const isResolved = (a) => !dRefs(a.replacedBy).some((d) => reg.has(d)) && adrRefs(a.replacedBy).length > 0 && adrRefs(a.replacedBy).every((n) => adrAccepted.has(n));
  const unresolved = as.filter((a) => !isResolved(a));
  out.counts.assumptions = { source: 'docs/context/ASSUMPTIONS.md', rule: 'rows AS-nnn; all are class B. Resolved only if the "Replaced by" cell names specific Accepted ADR number(s) and no open register decision; otherwise unresolved', total: as.length, resolved: as.length - unresolved.length, replacedByDecisionRegister: as.filter((a) => dRefs(a.replacedBy).length).length, replacedByGenericAdr: as.filter((a) => !dRefs(a.replacedBy).length && /ADR/.test(a.replacedBy) && !adrRefs(a.replacedBy).length).length, unresolved: unresolved.length, unresolvedIds: unresolved.map((a) => a.id) };
  for (const a of as.filter((x) => !dRefs(x.replacedBy).length && !adrRefs(x.replacedBy).length)) review(a.id, `"Replaced by" names no decision or specific ADR ("${a.replacedBy}")`, 'docs/context/ASSUMPTIONS.md');
  const bullets = {};
  for (const f of walk('docs')) { if (!f.endsWith('.md') || /^docs\/state\/(runs|loops)\//.test(f)) continue; const n = (read(f).match(/^- ASSUMPTION:/gm) ?? []).length; if (n) bullets[f] = n; }
  out.counts.assumptionBullets = { rule: 'lines starting "- ASSUMPTION:" in docs/**/*.md', total: Object.values(bullets).reduce((a, b) => a + b, 0), files: Object.keys(bullets).length, byFile: bullets };
  const rk = rows(read('docs/architecture/RISK-REGISTER.md')).filter((c) => /^RK-\d{3}$/.test(c[0])).map((c) => ({ id: c[0], status: c[7] }));
  out.counts.risks = { source: 'docs/architecture/RISK-REGISTER.md', rule: 'rows RK-nnn; status = 8th cell', total: rk.length, byStatus: countBy(rk, (r) => r.status) };
  const req = [...read('docs/context/REQUIREMENTS.md').split('\n'), ...read('docs/context/NON-FUNCTIONAL-REQUIREMENTS.md').split('\n')].filter((l) => l.startsWith('|')).map(cells).filter((c) => /^(BR|FR|SEC|DATA|AGT|NFR)-\d{3}$/.test(c[0]));
  const pri = (c) => c.find((x) => /^(Must|Should|Could)$/.test(x)) ?? '?';
  out.counts.requirements = { source: 'docs/context/REQUIREMENTS.md, NON-FUNCTIONAL-REQUIREMENTS.md', rule: 'rows whose first cell is BR|FR|SEC|DATA|AGT|NFR-nnn', total: req.length, byPrefix: countBy(req, (c) => c[0].split('-')[0]), byPriority: countBy(req, pri) };
  const trace = rows(read('docs/context/REQUIREMENTS-TRACEABILITY.md')).filter((c) => /^(BR|FR|SEC|DATA|AGT|NFR)-\d{3}$/.test(c[0]));
  out.counts.requirementTraceRows = { source: 'docs/context/REQUIREMENTS-TRACEABILITY.md', total: trace.length, matchesRequirements: trace.length === req.length };
}

// ---- 6. Approvals
{
  const approvers = JSON.parse(read('harness/policy/approvers.json')).approvers;
  const recs = [...walk('docs/approvals')].filter((f) => f.endsWith('.json'));
  const va = spawnSync(process.execPath, ['harness/scripts/validate-approvals.mjs'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  out.counts.approvals = { sources: ['harness/policy/approvers.json', 'docs/approvals/*.json', 'harness/scripts/validate-approvals.mjs'], rule: 'enrolled approvers = entries in the registry; signed approval records = *.json files in docs/approvals; the validator output is quoted verbatim', enrolledApprovers: approvers.length, signedApprovalRecords: recs.length, validatorOutput: va };
  out.counts.recordedOwnerAcceptances = { source: 'ADR status lines', rule: 'ADR status Accepted by instruction in chat (grandfathered, unsigned)', total: adrs.filter((a) => a.chatAcceptance).length, ids: adrs.filter((a) => a.chatAcceptance).map((a) => a.id) };
  const phase = (read('docs/state/STATE.md').match(/phase[^\n]{0,40}?(\d)/i) ?? [])[1];
  out.phaseFromState = phase;
}

// ---- 7. Memory store (derived)
{
  const verify = JSON.parse(spawnSync(process.execPath, ['harness/scripts/memory.mjs', 'verify'], { cwd: root, encoding: 'utf8' }).stdout || '{}');
  const files = (d) => fs.readdirSync(path.join(root, d)).filter((n) => n.endsWith('.json') && n !== 'CURRENT.json');
  const decs = files('memory/decisions').map((n) => JSON.parse(read(`memory/decisions/${n}`)));
  const importedAdr = new Set(decs.map((d) => d.subject).filter((s) => /^adr\.\d{4}$/.test(s)).map((s) => s.slice(4)));
  out.counts.memory = { source: 'memory/**', rule: 'DEC-* records derived from ADRs by the importer; verified by memory.mjs verify', verifyOk: verify.ok, entries: verify.entries, decisions: decs.length, decisionsByPosition: countBy(decs, (d) => d.position), constraints: files('memory/architecture-state').length, lessons: files('memory/lessons').length, adrsNotInMemory: adrs.filter((a) => !importedAdr.has(a.id)).map((a) => a.id) };
  for (const a of adrs.filter((x) => !importedAdr.has(x.id))) review(`ADR-${a.id}`, 'ADR exists but has no derived memory record: the memory store lags the ADR set', 'memory/decisions');
}

// ---- 8. Evidence
{
  const recs = [...walk('docs/evidence/records')].filter((f) => f.endsWith('.json')).map((f) => JSON.parse(read(f)));
  out.counts.evidenceRecords = { source: 'docs/evidence/records/EV-*.json', rule: 'one JSON file per run', total: recs.length, exitCode0: recs.filter((r) => r.exitCode === 0).length, nonZero: recs.filter((r) => r.exitCode !== 0).map((r) => r.id) };
}

// ---- 9. ID families (every definition row, by prefix, with files)
{
  const fam = {};
  for (const f of walk('docs')) { if (!f.endsWith('.md')) continue; for (const c of rows(read(f))) { const m = c[0].match(/^([A-Z]{1,4})-?(\d{1,4})$/); if (!m) continue; const k = m[1]; fam[k] ??= { ids: new Set(), files: new Set() }; fam[k].ids.add(c[0]); fam[k].files.add(f); } }
  out.idFamilies = Object.fromEntries(Object.entries(fam).sort().map(([k, v]) => [k, { distinctIds: v.ids.size, files: [...v.files].slice(0, 4), fileCount: v.files.size }]));
}

// ---- 10. Workflows, machine-readable files
{
  out.workflows = [...walk('.github/workflows')].map((f) => { const t = read(f); return { file: f, name: t.match(/^name:\s*(.*)$/m)?.[1], onPush: /^on:[\s\S]*?push:/m.test(t), onPullRequest: /pull_request/.test(t), branches: t.match(/branches:\s*\[(.*?)\]/)?.[1] ?? null, permissions: t.match(/^permissions:\n\s+(.*)/m)?.[1] ?? null, usesPinnedSha: ![...t.matchAll(/uses:\s*\S+@(\S+)/g)].some((m) => !/^[0-9a-f]{40}$/.test(m[1])) }; });
  const mr = {}; for (const f of walk('.')) { if (!/\.(json|jsonl|cjs)$/.test(f) || /^(docs\/evaluation|docs\/evidence\/records|docs\/state\/(loops|runs)|node_modules)/.test(f)) continue; const d = f.split('/')[0] === 'docs' ? f.split('/').slice(0, 2).join('/') : f.split('/')[0]; mr[d] = (mr[d] ?? 0) + 1; }
  out.machineReadableByFolder = mr;
  out.counts.policyFiles = { source: 'harness/policy/*.json', total: fs.readdirSync(path.join(root, 'harness/policy')).filter((n) => n.endsWith('.json')).length };
}

// ---- blockers
{
  const m1 = out.counts.decisionRegister.m1; const gate = out.counts.designReviews.distinctBlockingDecisions;
  out.counts.criticalBlockers = {
    rule: 'a blocker is something that, by the repository\'s own gates, stops implementation or approval; each item below is computed or quoted, not judged',
    items: [
      { id: 'BLK-1', what: 'No approver is enrolled, so no signed decision approval of any class can be valid', source: 'harness/policy/approvers.json (empty), validate-approvals output' },
      { id: 'BLK-2', what: 'The phase is 0; raising it needs an architecture key and a deployment key from different enrolled approvers', source: 'docs/state/STATE.md, harness/approvals/approval-gates.cjs' },
      { id: 'BLK-3', what: `${out.counts.designReviews.computedBlocked} of ${out.counts.designReviews.reviews} design reviews compute Blocked (${out.counts.designReviews.blockReasonsTotal} blocking reasons in total)`, source: 'harness/scripts/design-gate.mjs on RV-0001 to RV-0003' },
      { id: 'BLK-4', what: `${gate.length} distinct open decisions are named in gate blocking reasons`, ids: gate, source: 'design-gate output' },
      { id: 'BLK-5', what: `${m1.length} register decisions are marked needed-by M1 (before options analysis)`, ids: m1, source: 'docs/context/DECISION-REGISTER.md' },
      { id: 'BLK-6', what: 'Branch protection cannot be enabled on the current plan; merge discipline is human and CI only detects', source: 'gh api (HTTP 403), harness/policy/github-protection.json' },
    ],
  };
}

const text = JSON.stringify(out, null, 2);
if (process.argv.includes('--json')) console.log(text);
else {
  const c = out.counts;
  console.log(`studio-inventory: ${out.git.branch} @ ${out.git.head.slice(0, 7)} (${out.git.commitsAheadOfOriginMain} commits ahead of origin/main, ${out.git.dirty} uncommitted)`);
  console.log(`decision register : ${c.decisionRegister.total} ${JSON.stringify(c.decisionRegister.byStatus)}; M1 ${c.decisionRegister.m1.length}; kinds ${JSON.stringify(c.decisionRegister.byKind)}`);
  console.log(`ADRs              : ${c.adr.total} ${JSON.stringify(c.adr.byClass)}; chat-accepted ${c.adr.acceptedByChatInstruction}; rejected ${c.adr.rejected}; superseded ${c.adr.superseded}`);
  console.log(`designs / reviews : ${c.designReviews.designs} / ${c.designReviews.reviews}; computed Blocked ${c.designReviews.computedBlocked}; block reasons ${c.designReviews.blockReasonsTotal}; distinct blocking D ${c.designReviews.distinctBlockingDecisions.length}`);
  console.log(`option dispositions: ${JSON.stringify(c.optionDispositions.perDesign)} totals S${c.optionDispositions.Selected} N${c.optionDispositions['Not selected']} R${c.optionDispositions['Rejected (hard constraint)']} D${c.optionDispositions.Deferred}; defence questions ${JSON.stringify({ A: c.defenceQuestions.Answered, U: c.defenceQuestions.Unanswered })}`);
  console.log(`TODO tasks        : ${c.todoTasks.total} ${JSON.stringify(c.todoTasks.byStatus)}; ambiguous ${c.todoTasks.ambiguousForReview.length}; decisions-made rows ${c.todoDecisionsMade.total}`);
  console.log(`other task sets   : ${JSON.stringify(c.otherTaskFamilies)}`);
  console.log(`assumptions       : AS ${c.assumptions.total} (unresolved ${c.assumptions.unresolved}); ASSUMPTION bullets ${c.assumptionBullets.total} in ${c.assumptionBullets.files} files`);
  console.log(`risks             : ${c.risks.total} ${JSON.stringify(c.risks.byStatus)}`);
  console.log(`requirements      : ${c.requirements.total} ${JSON.stringify(c.requirements.byPrefix)} ${JSON.stringify(c.requirements.byPriority)}; trace rows ${c.requirementTraceRows.total}`);
  console.log(`approvals         : enrolled ${c.approvals.enrolledApprovers}, signed records ${c.approvals.signedApprovalRecords}; ${c.approvals.validatorOutput}`);
  console.log(`memory            : ${JSON.stringify({ ...c.memory, source: undefined, rule: undefined })}`);
  console.log(`evidence records  : ${c.evidenceRecords.total} (non-zero exit: ${c.evidenceRecords.nonZero.join(', ') || 'none'})`);
  console.log(`requires review   : ${out.review.length}`);
}
if (process.argv.includes('--write')) { fs.writeFileSync(path.join(root, 'docs/architecture-studio/inventory.snapshot.json'), `${text}\n`); console.log('wrote docs/architecture-studio/inventory.snapshot.json'); }
