#!/usr/bin/env node
// Validates persistent memory as configuration and as data: the policy, the wiring (tools, path class, agent grants), the
// documents, and the integrity of everything committed under memory/. Zero dependencies.
// Usage: node harness/scripts/validate-memory.mjs [--root <dir>] [--json]
// It reads files only. The store's behaviour (writing, conflicts, poisoning, resume) is shown by the tests, not by this script.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const j = (root, p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));
const has = (root, p) => existsSync(path.join(root, p));
const TRUST = ['untrusted', 'unreviewed', 'reviewed', 'authoritative'];
const DIRS = ['decisions', 'lessons', 'task-state', 'architecture-state'];
const KINDS = { semantic: ['decision', 'proposal', 'assumption', 'fact', 'constraint'], episodic: ['lesson', 'incident', 'test-failure', 'resolution'], working: ['task-state'] };
const MEMORY_TOOLS = ['memory_search', 'memory_resume'];
const DOC_HEADINGS = {
  'docs/memory/MEMORY-MODEL.md': ['Semantic', 'Episodic', 'Working', 'Authority', 'Retrieval', 'Conflict', 'Resume', 'Why not SQLite'],
  'docs/memory/MEMORY-GOVERNANCE.md': ['Who may write', 'Approved decisions', 'Poisoning', 'Sensitive data', 'Expiry', 'Enforced', 'Human procedure', 'Limits'],
};

export function validateMemory(root) {
  const errors = [];
  const fail = (msg) => errors.push({ check: 'memory', msg });
  try { check(root, fail); } catch (e) { fail(`memory configuration is malformed and could not be fully evaluated (${e.message})`); }
  return errors;
}

// The ledger only ever grows. The copy committed at HEAD, and at origin/main or the previous commit when Git has them, must be a
// prefix of the working copy. This catches a rollback or rewrite of the whole memory folder that is internally consistent.
// It cannot catch a rewrite that was committed and pushed with nothing earlier to compare against (see MEMORY-GOVERNANCE).
export function ledgerAnchorProblems(root, refs = ['HEAD', 'origin/main', 'HEAD~1']) {
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 });
  let top;
  try { top = path.resolve(git('rev-parse', '--show-toplevel').trim()); } catch { return { problems: [], checked: [], skipped: 'not a Git checkout or Git is unavailable' }; }
  if (path.resolve(top).toLowerCase() !== path.resolve(root).toLowerCase()) return { problems: [], checked: [], skipped: 'root is not the Git top level' };
  const cur = existsSync(path.join(root, 'memory/ledger.jsonl')) ? readFileSync(path.join(root, 'memory/ledger.jsonl'), 'utf8').replace(/\r\n/g, '\n').split('\n').filter(Boolean) : [];
  const problems = []; const checked = [];
  for (const ref of refs) {
    let text;
    try { text = git('show', `${ref}:memory/ledger.jsonl`); } catch { continue; }
    const old = text.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
    checked.push(`${ref} (${old.length} rows)`);
    if (old.length > cur.length) problems.push(`the memory ledger has fewer rows than at ${ref} (${cur.length} against ${old.length}): memory was rolled back`);
    else for (let i = 0; i < old.length; i += 1) if (old[i] !== cur[i]) { problems.push(`the memory ledger differs from ${ref} at row ${i + 1}: history was rewritten, and the ledger only ever grows`); break; }
  }
  return { problems, checked, skipped: null };
}

function check(root, fail) {
  const required = ['harness/policy/memory-policy.json', 'harness/memory/store.cjs', 'harness/scripts/memory.mjs', 'memory/README.md', 'docs/memory/MEMORY-MODEL.md', 'docs/memory/MEMORY-GOVERNANCE.md', ...DIRS.map((d) => `memory/${d}`)];
  for (const f of required) if (!has(root, f)) { fail(`missing ${f}`); if (f.endsWith('memory-policy.json') || f.endsWith('store.cjs')) return; }
  const P = j(root, 'harness/policy/memory-policy.json');
  if (P.schema !== 'greenfuel.memory-policy/v1') fail('memory policy schema must be greenfuel.memory-policy/v1');

  // kinds: three categories, unique prefixes, known directories
  const prefixes = new Set();
  for (const [cat, kinds] of Object.entries(KINDS)) for (const k of kinds) {
    const d = P.kinds[k];
    if (!d) { fail(`kind ${k} is missing (category ${cat})`); continue; }
    if (d.category !== cat) fail(`kind ${k} must be in category ${cat}`);
    if (!DIRS.includes(d.dir)) fail(`kind ${k}: directory '${d.dir}' is not one of ${DIRS.join(', ')}`);
    if (!/^[A-Z]{3}$/.test(d.prefix) || prefixes.has(d.prefix)) fail(`kind ${k}: prefix '${d.prefix}' must be three capital letters and unique`);
    prefixes.add(d.prefix);
    if (!Array.isArray(d.statuses) || !d.statuses.length) fail(`kind ${k}: statuses are required`);
  }
  for (const k of Object.keys(P.kinds)) if (!Object.values(KINDS).flat().includes(k)) fail(`kind ${k} is not one this validator knows; update the validator with the policy`);
  for (const k of ['decision', 'proposal', 'assumption', 'fact', 'constraint']) if (!P.kinds[k]?.statuses.some((s) => ['approved', 'active', 'proposed'].includes(s))) fail(`kind ${k} needs a live status`);
  if (!P.kinds.constraint?.statuses.includes('approved') || P.kinds.constraint.statuses.includes('proposed')) fail('a constraint exists only as approved, so a proposed rule cannot be mistaken for one in force');

  // authority ordering and writers
  const aw = P.authorityWeights;
  for (let i = 1; i < TRUST.length; i += 1) if (!(aw[TRUST[i]] > aw[TRUST[i - 1]])) fail(`authority weights must rise from ${TRUST[i - 1]} to ${TRUST[i]}`);
  if (JSON.stringify([...P.trust].sort()) !== JSON.stringify([...TRUST].sort())) fail(`trust levels must be exactly ${TRUST.join(', ')}`);
  const sf = P.statusFactors;
  for (const s of ['superseded', 'invalidated', 'expired', 'rejected']) if (sf[s] !== 0) fail(`status factor for ${s} must be 0 so retired knowledge is not returned as current`);
  if (!(sf.approved >= sf.active && sf.active > sf.proposed && sf.proposed > 0)) fail('status factors must rank approved >= active > proposed > 0');
  if (!(P.retrieval.recencyWeight <= 0.1)) fail('recency may only be a small tie-breaker (recencyWeight at most 0.1)');
  for (const w of ['human', 'importer', 'engine', 'agent', 'tool', 'document']) if (!P.writers[w]) fail(`writer ${w} is missing`);
  for (const [w, c] of Object.entries(P.writers)) {
    if (!TRUST.includes(c.maxTrust)) fail(`writer ${w}: maxTrust '${c.maxTrust}' is unknown`);
    if (['engine', 'agent', 'tool', 'document'].includes(w) && c.maxTrust === 'authoritative') fail(`writer ${w} must not be able to create authoritative entries`);
    if (['agent', 'tool', 'document', 'engine'].some((x) => x === w) && (c.may ?? []).some((m) => ['approve', 'supersede', 'invalidate', 'review', 'sweep'].includes(m))) fail(`writer ${w} must not approve, supersede, invalidate, review or sweep`);
    if (c.kinds !== '*') for (const k of c.kinds) if (!P.kinds[k]) fail(`writer ${w}: unknown kind ${k}`);
  }
  for (const w of ['tool', 'document']) if (!P.writers[w]?.quarantine || P.writers[w].maxTrust !== 'untrusted') fail(`writer ${w} must be quarantined at untrusted`);
  if (!P.writers.engine?.requiresEvidence) fail('engine entries must cite evidence');
  if (!P.writers.importer?.requiresVerifiedApproval) fail('the importer must require a verified approval');
  for (const [k, kd] of Object.entries(P.kinds)) {
    if (kd.category === 'episodic' && !P.ttlDays[k]) fail(`kind ${k}: episodic memory needs an expiry`);
    if (['assumption', 'proposal', 'task-state'].includes(k) && !P.ttlDays[k]) fail(`kind ${k} needs an expiry so it is revisited`);
    if (['decision', 'constraint', 'fact'].includes(k) && P.ttlDays[k]) fail(`kind ${k} must not expire by itself`);
  }

  // sensitive-data and quarantine controls exist
  for (const k of ['personal', 'customer', 'keyNames', 'secret']) if (!Array.isArray(P.sensitive?.[k]) || !P.sensitive[k].length) fail(`sensitive.${k} patterns are required`);
  for (const k of ['personal', 'customer', 'secret']) for (const re of P.sensitive?.[k] ?? []) { try { new RegExp(re); } catch { fail(`sensitive.${k}: invalid pattern ${re}`); } }
  if (!Array.isArray(P.injectionExtra) || !P.injectionExtra.length) fail('injectionExtra patterns are required');
  for (const re of P.injectionExtra ?? []) { try { new RegExp(re); } catch { fail(`injectionExtra: invalid pattern ${re}`); } }
  if (!P.invisibleChars) fail('invisibleChars is required');
  if (!P.denialLog?.file) fail('denialLog.file is required');
  if (!P.owners?.length) fail('owners (roles) are required');

  // wiring: control-plane path class, read-only tools, grants
  const perm = j(root, 'harness/policy/permissions.json');
  const cp = perm.pathClasses.find((c) => c.id === 'control-plane');
  if (!cp || !new RegExp(cp.pattern).test('memory/decisions/DEC-0001.json')) fail('permissions.json: memory/ must be a control-plane path so agents cannot write it');
  const reg = j(root, 'harness/tools/tool-registry.json');
  for (const t of MEMORY_TOOLS) {
    const r = reg.tools.find((x) => x.name === t);
    if (!r) { fail(`tool registry: ${t} is missing`); continue; }
    if (r.mutation !== 'none' || r.privilege !== 'read-local' || r.status !== 'enabled') fail(`tool registry: ${t} must be an enabled, read-local, non-mutating tool`);
  }
  for (const r of reg.tools) if (/^memory_(write|add|save|update|delete|approve|supersede|invalidate)/.test(r.name ?? '')) fail(`tool registry: ${r.name} is a memory write tool; agents must not be able to write memory`);
  const mcp = j(root, '.mcp.json').mcpServers['greenfuel-tools'];
  for (const t of MEMORY_TOOLS) if (!mcp.tools.includes(t)) fail(`.mcp.json: ${t} is not in the greenfuel-tools allow-list`);
  for (const t of mcp.tools) if (/^memory_(write|add|save|update|delete|approve|supersede|invalidate)/.test(t)) fail(`.mcp.json: ${t} would let an agent write memory`);
  const ap = j(root, 'harness/policy/agent-policy.json');
  for (const [name, a] of Object.entries(ap.agents)) {
    const mine = (a.mcp ?? []).filter((m) => m.includes('memory_'));
    for (const m of mine) if (!MEMORY_TOOLS.includes(m.split('/')[1])) fail(`agent ${name}: grants unknown memory tool ${m}`);
    const fm = readFileSync(path.join(root, `.github/agents/${name}.agent.md`), 'utf8');
    const line = /^tools:.*$/m.exec(fm)?.[0] ?? '';
    for (const t of MEMORY_TOOLS) if (line.includes(`greenfuel-tools/${t}`) !== mine.includes(`greenfuel-tools/${t}`)) fail(`agent ${name}: ${t} must be granted in both agent-policy.json and the agent file, or neither`);
  }

  // documents
  for (const [doc, heads] of Object.entries(DOC_HEADINGS)) {
    if (!has(root, doc)) continue;
    const text = readFileSync(path.join(root, doc), 'utf8');
    for (const h of heads) if (!text.includes(h)) fail(`${doc}: must cover '${h}'`);
    // a claim must stand on its own line: a denial elsewhere in the document does not excuse it
    for (const line of text.split('\n')) if (/restarted (the )?VS Code|VS Code (was|has been|got) restarted|after (a |the )?VS Code restart\b/i.test(line) && !/\b(not|never|no|without)\b|n't/i.test(line)) fail(`${doc}: must not claim a VS Code restart that was not performed (${line.trim().slice(0, 60)})`);
  }

  // data: every entry, the ledger, the snapshot
  const store = require(path.join(root, 'harness/memory/store.cjs'));
  const ctx = store.makeContext({ root, policyRoot: root, memoryDir: path.join(root, P.root), adrDir: path.join(root, 'docs/adr'), logDir: path.join(root, '.harness-logs') });
  const v = store.verifyAll(ctx);
  for (const p of v.problems) fail(p);
  for (const p of ledgerAnchorProblems(root).problems) fail(p);

  // memory and the sources it is derived from must agree
  const adrs = store.readAdrs(ctx); const entries = store.loadValid(ctx);
  for (const adr of adrs.values()) {
    if (!adr.status) continue;
    const e = entries.find((x) => x.provenance.source === 'adr' && x.provenance.ref === `file:${adr.file}`);
    if (!e) { if (adr.status === 'Accepted') fail(`${adr.id} is Accepted but has no memory entry; run: node harness/scripts/memory.mjs import --as importer:import-adr`); continue; }
    if (adr.status === 'Accepted' && e.validity.status === 'proposed') fail(`${adr.id} is now Accepted but ${e.id} is still proposed; run the importer to approve it`);
    if (adr.status !== 'Accepted' && e.validity.status === 'approved') fail(`${e.id} is approved but ${adr.id} is ${adr.status}`);
  }
  if (has(root, 'docs/architecture/HARD-CONSTRAINTS.md')) {
    const text = readFileSync(path.join(root, 'docs/architecture/HARD-CONSTRAINTS.md'), 'utf8');
    for (const m of text.matchAll(/^\|\s*(HC-\d{2})\s*\|/gm)) if (!entries.some((e) => e.kind === 'constraint' && e.refs.includes(m[1]))) fail(`${m[1]} is a hard constraint with no memory entry; run the importer`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root');
  const root = path.resolve(i > 0 ? process.argv[i + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const errors = validateMemory(root);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ root, ok: !errors.length, errors }, null, 2));
  else if (errors.length) { for (const e of errors) console.error(`FAIL [${e.check}] ${e.msg}`); console.error(`${errors.length} problem(s).`); } else console.log('validate-memory: OK');
  process.exit(errors.length ? 1 : 0);
}
