// Everything the presentation pipeline reads, gathered once and read from a single commit. Each source it touches is recorded with its
// content hash, so a deck can say exactly which evidence version it was made from.
import crypto from 'node:crypto';
import path from 'node:path';
import { requireHarness } from '../harness-bridge.ts';
import { GitRepositoryAdapter } from '../repo/git.ts';
import { loadReadinessInput, type LoadOptions } from '../baseline/input.ts';
import { computeReadiness, type Readiness } from '../baseline/readiness.ts';
import { evaluateAreas, loadBaselineStates, type AreaGate, type BaselineState } from '../baseline/state.ts';
import type { NormalizedDecision } from '../intel/schema.ts';
import type { Requirement } from '../repo/types.ts';
import { parseTables, plain, type Table } from './mdtable.ts';

export interface UsedSource {
  path: string;
  sha256: string;
  /** Git blob id at the commit. */
  blob: string;
  bytes: number;
}

export interface RubricCriterion {
  id: string;
  title: string;
  mode: string;
  evidenceNow: string;
  floorExposure: string;
}

/** The facts the harness already derives from committed sources for the capstone (harness/demo/facts.mjs). Typed loosely on purpose: it is data. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Facts = Record<string, any>;

export interface Recording {
  path: string;
  scenario: string;
  kind: string;
  notLive: boolean;
  recordedAt: string;
  gitHead: string;
}

/** A slide of the existing HTML capstone deck (harness/demo/deck-data.mjs). Its speaker notes and evidence are reused so the two decks cannot disagree. */
export interface LegacySlide {
  id: string;
  say?: string;
  next?: string;
  ifAsked?: string[];
  seconds?: number;
  rubric?: string[];
  evidence?: { path: string; chip: string }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  visual?: Record<string, any>;
}

export interface DeckContext {
  root: string;
  ref: string;
  commit: string;
  branch: string | null;
  /** Count of tracked files that differ from the commit. Figures read by facts.mjs come from the working tree, so this must be 0 for a final deck. */
  uncommitted: number;
  facts: Facts;
  legacy: Record<string, LegacySlide>;
  readiness: Readiness;
  gates: AreaGate[];
  baselines: BaselineState[];
  decisions: NormalizedDecision[];
  requirements: Requirement[];
  rubric: RubricCriterion[];
  recordings: Recording[];
  /** Whether a path exists at the commit. */
  has(p: string): boolean;
  /** Reads a path at the commit and records it as a source. Undefined when it does not exist. */
  read(p: string): string | undefined;
  table(p: string, headStartsWith: string[]): Table | undefined;
  used(): UsedSource[];
  signatures: Readiness['signatures'];
  generatedAt: string;
}

export interface ContextOptions extends LoadOptions {
  /** Provide already-computed baseline data (the Studio caches it) instead of recomputing. */
  baselineView?: { readiness: Readiness; gates: AreaGate[]; baselines: BaselineState[]; decisions: NormalizedDecision[]; requirements: Requirement[]; signatures: Readiness['signatures']; commit: string };
}

export function openDeckContext(root: string, ref: string, o: ContextOptions): DeckContext {
  const adapter = new GitRepositoryAdapter(root, ref).open();
  const commit = adapter.commit;
  const used = new Map<string, UsedSource>();

  const read = (p: string): string | undefined => {
    const text = adapter.read(p);
    if (text === undefined) return undefined;
    if (!used.has(p)) used.set(p, { path: p, sha256: crypto.createHash('sha256').update(text).digest('hex'), blob: adapter.oid(p) ?? '', bytes: Buffer.byteLength(text) });
    return text;
  };

  let view = o.baselineView;
  if (!view) {
    const cur = loadReadinessInput(root, ref, o);
    const readiness = computeReadiness(cur.input);
    const baselines = loadBaselineStates(root, cur, readiness, { ...o, reproduce: false });
    view = { readiness, baselines, gates: evaluateAreas(readiness, baselines, cur.input.policy), decisions: cur.input.decisions, requirements: cur.input.requirements, signatures: readiness.signatures, commit: cur.input.commit };
  }

  // facts.mjs reads the committed sources it needs from the working tree of the repository it lives in.
  const facts = requireHarness<{ loadFacts(): Facts }>(root, 'demo', 'facts.mjs').loadFacts();
  const legacy: Record<string, LegacySlide> = {};
  for (const s of requireHarness<{ buildSlides(f: Facts): LegacySlide[] }>(root, 'demo', 'deck-data.mjs').buildSlides(facts)) legacy[s.id] = s;

  const rubric: RubricCriterion[] = [];
  const rt = read('docs/capstone/RUBRIC-TRACEABILITY.md');
  if (rt) {
    const t = parseTables(rt).find((x) => x.head[0] === 'ID' && x.head[1] === 'Criterion');
    for (const r of t?.rows ?? []) if (/^[A-D]\d$/.test(r[0] ?? '')) rubric.push({ id: r[0]!, title: plain(r[1] ?? ''), mode: plain(r[2] ?? ''), evidenceNow: plain(r[3] ?? ''), floorExposure: plain(r[4] ?? '') });
  }

  const recordings: Recording[] = [];
  for (const f of adapter.list('docs/capstone/presentation/recordings/')) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(read(f) ?? '{}') as { scenario?: string; kind?: string; notLive?: boolean; recordedAt?: string; gitHead?: string };
      recordings.push({ path: f, scenario: j.scenario ?? '', kind: j.kind ?? '', notLive: j.notLive === true, recordedAt: j.recordedAt ?? '', gitHead: j.gitHead ?? '' });
    } catch {
      /* an unreadable recording is simply not listed */
    }
  }

  return {
    root,
    ref,
    commit,
    branch: adapter.currentBranch(),
    uncommitted: adapter.uncommittedCount(),
    facts,
    legacy,
    readiness: view.readiness,
    gates: view.gates,
    baselines: view.baselines,
    decisions: view.decisions,
    requirements: view.requirements,
    rubric,
    recordings,
    has: (p) => adapter.has(p),
    read,
    table: (p, h) => {
      const text = read(p);
      if (!text) return undefined;
      const want = h.map((x) => x.toLowerCase());
      return parseTables(text).find((t) => want.every((w, i) => (t.head[i] ?? '').toLowerCase().startsWith(w)));
    },
    used: () => [...used.values()].sort((a, b) => a.path.localeCompare(b.path)),
    signatures: view.signatures,
    generatedAt: new Date().toISOString(),
  };
}
