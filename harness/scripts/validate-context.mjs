// Checks the requirements baseline in docs/context. Zero dependencies.
// Checks: ID format and uniqueness, class and priority values, one traceability row per requirement,
// source rules (class A cites a case-study statement, class B cites ARCH), references to decisions,
// schemes, ADRs and case-study statements, decision-register shape, and context-manifest coverage.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const REQ_ID = /^(BR|FR|SEC|DATA|AGT|NFR)-\d{3}$/;
const CAPS = new Set(['DEA', 'EAA', 'DRA', 'MBA', 'CCA', 'XC', 'EDG', 'SOV']);
const KINDS = new Set(['C', 'D', 'X', 'C+D', 'X+C', 'X+D']);
const REQ_FILES = ['docs/context/REQUIREMENTS.md', 'docs/context/NON-FUNCTIONAL-REQUIREMENTS.md'];
const TRACE = 'docs/context/REQUIREMENTS-TRACEABILITY.md';
const REGISTER = 'docs/context/DECISION-REGISTER.md';
const SCHEMES = 'docs/context/CERTIFICATION-SCHEMES.md';
const PROBLEM = 'PROBLEMSTATEMENT.md';
const MANIFEST = 'docs/context/context-manifest.json';
const SCAN_DIRS = ['docs/context', 'docs/state'];

const refs = (text, re) => [...text.matchAll(re)].map((m) => m[0]);
const rowsOf = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('|'))
  .map((l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));

export function hasContext(root) {
  return existsSync(path.join(root, REGISTER));
}

function mdFiles(root) {
  const out = [path.join(root, PROBLEM)];
  for (const d of SCAN_DIRS) {
    const dir = path.join(root, d);
    if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith('.md')) out.push(path.join(dir, f));
  }
  return out.filter(existsSync);
}

export function loadContext(root) {
  const read = (p) => readFileSync(path.join(root, p), 'utf8');
  const errors = [];
  const fail = (msg) => errors.push({ check: 'context', msg });

  const reqs = new Map();
  for (const f of REQ_FILES) {
    if (!existsSync(path.join(root, f))) { fail(`missing ${f}`); continue; }
    for (const c of rowsOf(read(f))) {
      if (!REQ_ID.test(c[0])) continue;
      if (c.length !== 7) { fail(`${f}: ${c[0]} has ${c.length} cells, expected 7 (a pipe inside a cell?)`); continue; }
      const [id, caps, text, cls, pri, why, accept] = c;
      if (reqs.has(id)) fail(`${id} is defined more than once`);
      const capList = caps.split(',').map((s) => s.trim()).filter(Boolean);
      if (!capList.length || capList.some((x) => !CAPS.has(x))) fail(`${id}: caps '${caps}' must be a comma list of ${[...CAPS].join(', ')}`);
      if (!['A', 'B'].includes(cls)) fail(`${id}: class '${cls}' must be A or B`);
      if (!['Must', 'Should', 'Could'].includes(pri)) fail(`${id}: priority '${pri}' must be Must, Should or Could`);
      if (!text || !why || !accept) fail(`${id}: requirement, justification and acceptance criteria are all required`);
      reqs.set(id, { id, caps: capList, cls, pri, file: f });
    }
  }

  const decisions = new Map();
  if (existsSync(path.join(root, REGISTER))) {
    for (const c of rowsOf(read(REGISTER))) {
      if (!/^D-\d{3}$/.test(c[0])) continue;
      if (c.length !== 8) { fail(`${REGISTER}: ${c[0]} has ${c.length} cells, expected 8`); continue; }
      const [id, kind, need, why, options, owner, by, status] = c;
      if (decisions.has(id)) fail(`${id} is defined more than once in the decision register`);
      if (!KINDS.has(kind)) fail(`${id}: kind '${kind}' must be one of ${[...KINDS].join(', ')}`);
      if (!['M1', 'M2', 'M3'].includes(by)) fail(`${id}: needed-by '${by}' must be M1, M2 or M3`);
      if (!need || !why || !options || !owner) fail(`${id}: every register column must be filled`);
      if (!/^(Open|Decided \(ADR-\d{4}\))$/.test(status)) fail(`${id}: status '${status}' must be Open or Decided (ADR-nnnn)`);
      decisions.set(id, { id, kind, by, status });
    }
  }

  const schemes = new Set();
  if (existsSync(path.join(root, SCHEMES))) {
    for (const c of rowsOf(read(SCHEMES))) {
      if (!/^V-\d{2}$/.test(c[0])) continue;
      schemes.add(c[0]);
      if (!/^(Candidate|Verified|Not applicable)/.test(c[c.length - 1])) fail(`${c[0]}: status must start with Candidate, Verified or Not applicable`);
    }
  }

  const cs = new Set();
  if (existsSync(path.join(root, PROBLEM))) {
    for (const c of rowsOf(read(PROBLEM))) if (/^CS-(CAP-\d|C\d|P\d)$/.test(c[0])) cs.add(c[0]);
  }

  const adrDir = path.join(root, 'docs', 'adr');
  const adrs = new Set(existsSync(adrDir) ? readdirSync(adrDir).map((f) => f.match(/^(\d{4})-/)?.[1]).filter(Boolean) : []);

  const trace = new Map();
  if (existsSync(path.join(root, TRACE))) {
    for (const c of rowsOf(read(TRACE))) {
      if (!REQ_ID.test(c[0])) continue;
      if (c.length !== 8) { fail(`${TRACE}: ${c[0]} has ${c.length} cells, expected 8`); continue; }
      const [id, source, validation, evidence, decs, depends, open, verify] = c;
      if (trace.has(id)) fail(`${TRACE}: ${id} appears more than once`);
      trace.set(id, { id, source, validation, evidence, decs, depends, open, verify });
    }
  }
  return { reqs, decisions, schemes, cs, adrs, trace, errors };
}

export function validateContext(root) {
  if (!hasContext(root)) return [];
  const ctx = loadContext(root);
  const { reqs, decisions, schemes, cs, adrs, trace, errors } = ctx;
  const fail = (msg) => errors.push({ check: 'context', msg });
  const dash = (s) => !s || /^[–-]$/.test(s);

  for (const id of reqs.keys()) if (!trace.has(id)) fail(`${id}: no traceability row`);
  for (const id of trace.keys()) if (!reqs.has(id)) fail(`${id}: traceability row has no requirement`);

  for (const [id, t] of trace) {
    const r = reqs.get(id);
    if (!r) continue;
    const sourceCs = refs(t.source, /CS-(CAP-\d|C\d|P\d)\b/g);
    const arch = /\bARCH\b/.test(t.source);
    if (r.cls === 'A' && (!sourceCs.length || arch)) fail(`${id}: class A must cite CS- statements only (source: '${t.source}')`);
    if (r.cls === 'B' && !arch) fail(`${id}: class B must cite ARCH (source: '${t.source}')`);
    for (const s of sourceCs) if (!cs.has(s)) fail(`${id}: unknown case-study statement ${s}`);
    if (dash(t.validation) || dash(t.evidence)) fail(`${id}: validation method and evidence required are mandatory`);
    for (const d of refs(t.decs + ' ' + t.open, /D-\d{3}/g)) if (!decisions.has(d)) fail(`${id}: unknown decision ${d}`);
    for (const d of refs(t.open, /D-\d{3}/g)) if (decisions.has(d) && !decisions.get(d).kind.includes('C')) fail(`${id}: Open (C) lists ${d}, whose kind '${decisions.get(d).kind}' is not a clarification`);
    for (const a of refs(t.decs, /ADR-\d{4}/g)) if (!adrs.has(a.slice(4))) fail(`${id}: unknown ADR ${a}`);
    for (const v of refs(t.verify, /V-\d{2}/g)) if (!schemes.has(v)) fail(`${id}: unknown scheme candidate ${v}`);
    for (const q of refs(t.depends, /(BR|FR|SEC|DATA|AGT|NFR)-\d{3}/g)) {
      if (!reqs.has(q)) fail(`${id}: depends on unknown requirement ${q}`);
      if (q === id) fail(`${id}: depends on itself`);
    }
  }

  for (const f of mdFiles(root)) {
    const text = readFileSync(f, 'utf8');
    const rel = path.relative(root, f).split(path.sep).join('/');
    for (const d of new Set(refs(text, /\bD-\d{3}\b/g))) if (!decisions.has(d)) fail(`${rel}: references unknown decision ${d}`);
    for (const v of new Set(refs(text, /\bV-\d{2}\b/g))) if (!schemes.has(v)) fail(`${rel}: references unknown scheme candidate ${v}`);
    for (const q of new Set(refs(text, /\b(BR|FR|SEC|DATA|AGT|NFR)-\d{3}\b/g))) if (!reqs.has(q)) fail(`${rel}: references unknown requirement ${q}`);
    for (const s of new Set(refs(text, /\bCS-(CAP-\d|C\d|P\d)\b/g))) if (!cs.has(s)) fail(`${rel}: references unknown case-study statement ${s}`);
  }

  validateManifest(root, ctx, fail);
  return errors;
}

function matches(id, pattern) {
  return pattern.endsWith('*') ? id.startsWith(pattern.slice(0, -1)) : id === pattern;
}

export function profileRequirements(profile, ctx) {
  const spec = profile.requirements;
  if (spec === 'all') return new Set(ctx.reqs.keys());
  const out = new Set();
  for (const r of ctx.reqs.values()) {
    if (spec.caps?.some((c) => r.caps.includes(c))) out.add(r.id);
    if (spec.include?.some((p) => matches(r.id, p))) out.add(r.id);
    if (spec.withVerify && !/^[–-]$/.test(ctx.trace.get(r.id)?.verify ?? '–')) out.add(r.id);
  }
  return out;
}

function validateManifest(root, ctx, fail) {
  if (!existsSync(path.join(root, MANIFEST))) { fail(`missing ${MANIFEST}`); return; }
  let manifest;
  try { manifest = JSON.parse(readFileSync(path.join(root, MANIFEST), 'utf8')); } catch (e) { fail(`${MANIFEST}: invalid JSON (${e.message})`); return; }
  for (const f of [...manifest.alwaysLoaded, ...manifest.core]) if (!existsSync(path.join(root, f))) fail(`manifest: missing file ${f}`);
  const covered = new Set();
  for (const [name, p] of Object.entries(manifest.profiles)) {
    for (const f of p.documents) if (!existsSync(path.join(root, f))) fail(`manifest profile ${name}: missing file ${f}`);
    if (p.requirements !== 'all') {
      for (const c of p.requirements.caps ?? []) if (!CAPS.has(c)) fail(`manifest profile ${name}: unknown capability ${c}`);
      for (const pat of p.requirements.include ?? []) if (![...ctx.reqs.keys()].some((id) => matches(id, pat))) fail(`manifest profile ${name}: '${pat}' matches no requirement`);
      const ids = profileRequirements(p, ctx);
      for (const id of ids) covered.add(id);
      const needs = new Set();
      for (const id of ids) needs.add(id.startsWith('NFR-') ? REQ_FILES[1] : REQ_FILES[0]);
      if (ids.size) needs.add(TRACE);
      for (const f of needs) if (!p.documents.includes(f)) fail(`manifest profile ${name}: selects requirements from ${f} but does not list it`);
    }
    for (const d of p.decisions) if (d !== '*' && !ctx.decisions.has(d)) fail(`manifest profile ${name}: unknown decision ${d}`);
    for (const v of p.schemes) if (v !== '*' && !ctx.schemes.has(v)) fail(`manifest profile ${name}: unknown scheme candidate ${v}`);
  }
  for (const id of ctx.reqs.keys()) if (!covered.has(id)) fail(`manifest: ${id} is not reachable from any scoped profile`);
}

function textBytes(root) {
  let total = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules', 'records'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|json)$/.test(e.name)) total += statSync(p).size;
    }
  };
  walk(root);
  return total;
}

function rowBytes(root) {
  const bytes = new Map();
  for (const f of [...REQ_FILES, TRACE]) {
    if (!existsSync(path.join(root, f))) continue;
    for (const line of readFileSync(path.join(root, f), 'utf8').split(/\r?\n/)) {
      const id = line.match(/^\|\s*((?:BR|FR|SEC|DATA|AGT|NFR)-\d{3})\s*\|/)?.[1];
      if (id) bytes.set(id, (bytes.get(id) ?? 0) + Buffer.byteLength(line) + 1);
    }
  }
  return bytes;
}

export function contextStats(root) {
  const ctx = loadContext(root);
  const rows = rowBytes(root);
  const sliced = new Set([...REQ_FILES, TRACE]);
  const size = (f) => statSync(path.join(root, f)).size;
  const manifest = JSON.parse(readFileSync(path.join(root, MANIFEST), 'utf8'));
  const byClass = { A: 0, B: 0 };
  const byFamily = {};
  for (const r of ctx.reqs.values()) { byClass[r.cls]++; const fam = r.id.split('-')[0]; byFamily[fam] = (byFamily[fam] ?? 0) + 1; }
  const alwaysBytes = [...manifest.alwaysLoaded, ...manifest.core].reduce((s, f) => s + size(f), 0);
  const profiles = Object.entries(manifest.profiles).map(([name, p]) => {
    const ids = profileRequirements(p, ctx);
    const wholeDocs = p.documents.reduce((s, f) => s + size(f), 0);
    const unsliced = p.documents.filter((f) => !sliced.has(f)).reduce((s, f) => s + size(f), 0);
    const rowSum = [...ids].reduce((s, id) => s + (rows.get(id) ?? 0), 0);
    return {
      name,
      requirements: ids.size,
      wholeDocumentBytes: alwaysBytes + wholeDocs,
      rowFilteredBytes: alwaysBytes + unsliced + (p.requirements === 'all' ? p.documents.filter((f) => sliced.has(f)).reduce((s, f) => s + size(f), 0) : rowSum),
    };
  });
  const decisionKinds = {};
  for (const d of ctx.decisions.values()) decisionKinds[d.kind] = (decisionKinds[d.kind] ?? 0) + 1;
  return {
    requirements: { total: ctx.reqs.size, byClass, byFamily },
    decisions: { total: ctx.decisions.size, byKind: decisionKinds },
    schemeCandidates: ctx.schemes.size,
    alwaysAndCoreBytes: alwaysBytes,
    wholeRepoTextBytes: textBytes(root),
    profiles,
  };
}
