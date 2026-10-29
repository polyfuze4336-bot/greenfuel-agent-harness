import fs from 'node:fs';
import path from 'node:path';
import type { GitRepositoryAdapter } from '../repo/git.ts';
import { assemble } from './assemble.ts';
import { diffRegisters } from './diff.ts';
import { detectDuplicates } from './duplicates.ts';
import { classify, extract, type Fragment } from './extract.ts';
import { STATUSES, type ChangeSet, type NormalizedDecision, type NormStatus, type RegisterSnapshot, type RegisterStats } from './schema.ts';
import { collectSuggestions } from './suggestions.ts';
import { populated, validateAll } from './validate.ts';

// Engine: git objects -> cached fragments -> normalized records -> checks. Synchronisation is incremental: a source file
// is parsed again only when its git blob id changed since the last sync, and the result is proved equal to a full rebuild
// by a test. Persisted state lives outside the repository (the Studio's cache folder) and never in the repository.

export type FragmentCache = Map<string, Fragment>;

export interface SyncState {
  schema: 1;
  ref: string;
  commit: string;
  savedAt: string;
  fragments: Record<string, Fragment>;
  records: NormalizedDecision[];
}

export interface StateStore {
  load(): SyncState | null;
  save(state: SyncState): void;
}

export class MemoryStateStore implements StateStore {
  state: SyncState | null = null;
  load() {
    return this.state ? (JSON.parse(JSON.stringify(this.state)) as SyncState) : null;
  }
  save(s: SyncState) {
    this.state = JSON.parse(JSON.stringify(s)) as SyncState;
  }
}

export class FileStateStore implements StateStore {
  readonly file: string;
  constructor(dir: string) {
    this.file = path.join(dir, 'register-sync-state.json');
  }
  load(): SyncState | null {
    try {
      const s = JSON.parse(fs.readFileSync(this.file, 'utf8')) as SyncState;
      return s.schema === 1 ? s : null;
    } catch {
      return null;
    }
  }
  save(state: SyncState) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, this.file);
  }
}

export interface FragmentBuild {
  fragments: Fragment[];
  reused: number;
  reparsed: number;
  removed: string[];
  files: Map<string, string>;
}

/** Read every source file the engine understands, reusing cached fragments whose blob id has not changed. */
export function buildFragments(adapter: GitRepositoryAdapter, cache: FragmentCache): FragmentBuild {
  const sources = adapter.listAll().flatMap((p) => {
    const kind = classify(p);
    return kind ? [{ p, kind }] : [];
  });
  const files = new Map(sources.map((s) => [s.p, adapter.oid(s.p)!]));
  const need = sources.filter((s) => cache.get(s.p)?.oid !== files.get(s.p));
  adapter.preload(need.map((s) => s.p));
  for (const s of need) {
    const text = adapter.read(s.p) ?? '';
    cache.set(s.p, { kind: s.kind, path: s.p, oid: files.get(s.p)!, data: extract(s.kind, s.p, text) });
  }
  const removed = [...cache.keys()].filter((p) => !files.has(p));
  for (const p of removed) cache.delete(p);
  return { fragments: sources.map((s) => cache.get(s.p)!), reused: sources.length - need.length, reparsed: need.length, removed, files };
}

export function buildRegister(adapter: GitRepositoryAdapter, cache: FragmentCache = new Map()): { snapshot: RegisterSnapshot; build: FragmentBuild } {
  const build = buildFragments(adapter, cache);
  const { records, warnings } = assemble({ fragments: build.fragments, commit: adapter.commit, blobOf: (p) => adapter.oid(p) ?? '' });
  const known = new Set<string>(records.map((r) => r.id));
  for (const f of build.fragments) {
    const d = f.data as { id?: string; rows?: { id?: string }[] };
    if (f.kind === 'evidence' || f.kind === 'design' || f.kind === 'review') if (typeof d.id === 'string') known.add(d.id);
    for (const r of d.rows ?? []) if (typeof r.id === 'string') known.add(r.id);
  }
  const sug = collectSuggestions(build.fragments, { records, hasPath: (p) => adapter.has(p), knownIds: known });
  const duplicates = detectDuplicates(records);
  const validation = validateAll(records);
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<NormStatus, number>;
  for (const r of records) byStatus[r.status]++;
  const stats: RegisterStats = {
    total: records.length,
    byStatus,
    byKind: { adr: records.filter((r) => r.kind === 'adr').length, 'register-entry': records.filter((r) => r.kind === 'register-entry').length },
    populated: Object.fromEntries(Object.entries(populated).map(([k, f]) => [k, records.filter(f).length])),
    filesRead: build.fragments.length,
    filesReused: build.reused,
    filesReparsed: build.reparsed,
    filesRemoved: build.removed.length,
  };
  return { snapshot: { commit: adapter.commit, ref: adapter.ref, records, duplicates, validation, suggestions: sug.suggestions, stats, warnings: [...warnings, ...sug.warnings] }, build };
}

function fileChanges(before: Record<string, Fragment> | null, files: Map<string, string>): ChangeSet['files'] {
  if (!before) return [];
  const out: ChangeSet['files'] = [];
  for (const [p, oid] of files) {
    const b = before[p];
    if (!b) out.push({ path: p, change: 'added' });
    else if (b.oid !== oid) out.push({ path: p, change: 'changed' });
  }
  for (const p of Object.keys(before)) if (!files.has(p)) out.push({ path: p, change: 'removed' });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Incremental synchronisation against the last saved state: re-parses only the source files whose blob id changed,
 * reports exactly what changed in the register, and saves the new state. Writes only to the Studio's own store.
 */
export function syncRegister(adapter: GitRepositoryAdapter, store: StateStore, now: () => string = () => new Date().toISOString()): { snapshot: RegisterSnapshot; changes: ChangeSet } {
  const prev = store.load();
  const cache: FragmentCache = new Map(Object.entries(prev?.fragments ?? {}));
  const { snapshot, build } = buildRegister(adapter, cache);
  const changes = diffRegisters(prev?.records ?? null, snapshot.records, prev?.commit ?? null, adapter.commit, fileChanges(prev?.fragments ?? null, build.files));
  store.save({ schema: 1, ref: adapter.ref, commit: adapter.commit, savedAt: now(), fragments: Object.fromEntries(cache), records: snapshot.records });
  return { snapshot, changes };
}

/** Changes between two commits of the same repository, computed from full builds. Read-only and stateless. */
export function changesBetween(from: GitRepositoryAdapter, to: GitRepositoryAdapter): ChangeSet {
  const a = buildRegister(from);
  const b = buildRegister(to);
  const before = Object.fromEntries(a.build.fragments.map((f) => [f.path, f]));
  return diffRegisters(a.snapshot.records, b.snapshot.records, from.commit, to.commit, fileChanges(before, b.build.files));
}
