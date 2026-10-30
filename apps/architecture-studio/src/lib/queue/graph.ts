// The dependency graph, the "what is blocking the build?" analysis and the impact rules.
//
// Only "requires" edges carry consequences. "references" edges are shown, never followed transitively, and never change a status.
// That is how unrelated work is left alone: an item is touched only through an edge a repository source states.
import type { Edge, Priority, WorkItem, WorkStatus } from './types.ts';
import { PRIORITY_RANK } from './types.ts';

export const BUILD_ID = 'BUILD';
export const BUILD_TITLE = 'Start of the application build (HC-11: implementation is not unlocked)';

export type GNodeKind = WorkItem['kind'] | 'requirement' | 'build';

export interface GNode {
  id: string;
  kind: GNodeKind;
  title: string;
  status: WorkStatus | null;
  resolved: boolean;
}

export interface Graph {
  nodes: Map<string, GNode>;
  /** What a node requires or references. */
  out: Map<string, Edge[]>;
  /** What requires or references a node. */
  inn: Map<string, Edge[]>;
  cycles: string[][];
}

/** A prerequisite is resolved when its outcome is known: done with evidence, rejected, or superseded. A claim of closure without evidence is not. */
export const isResolved = (s: WorkStatus | null) => s === 'Done' || s === 'Rejected' || s === 'Superseded';

export function buildGraph(items: WorkItem[], edges: Edge[], refNodes: { id: string; title: string }[] = []): Graph {
  const nodes = new Map<string, GNode>();
  for (const i of items) nodes.set(i.id, { id: i.id, kind: i.kind, title: i.title, status: i.status, resolved: isResolved(i.status) });
  for (const r of refNodes) nodes.set(r.id, { id: r.id, kind: 'requirement', title: r.title, status: null, resolved: true });
  nodes.set(BUILD_ID, { id: BUILD_ID, kind: 'build', title: BUILD_TITLE, status: null, resolved: false });
  const all: Edge[] = [...edges];
  for (const i of items) if (i.kind === 'build-blocker') all.push({ from: BUILD_ID, to: i.id, type: 'requires', basis: 'Each build blocker is a repository fact the Studio derived as blocking the build' });
  const out = new Map<string, Edge[]>();
  const inn = new Map<string, Edge[]>();
  for (const e of all) {
    if (!nodes.has(e.from) || !nodes.has(e.to)) continue;
    out.set(e.from, [...(out.get(e.from) ?? []), e]);
    inn.set(e.to, [...(inn.get(e.to) ?? []), e]);
  }
  return { nodes, out, inn, cycles: findCycles(nodes, out) };
}

/** Cycles over "requires" edges only. Reported, never followed twice. */
function findCycles(nodes: Map<string, GNode>, out: Map<string, Edge[]>): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 1);
    stack.push(id);
    for (const e of out.get(id) ?? []) {
      if (e.type !== 'requires') continue;
      const s = state.get(e.to) ?? 0;
      if (s === 0) visit(e.to);
      else if (s === 1) {
        const cyc = stack.slice(stack.indexOf(e.to));
        const key = [...cyc].sort().join('>');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push([...cyc, e.to]);
        }
      }
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const id of nodes.keys()) if (!state.get(id)) visit(id);
  return cycles;
}

/** Everything `id` requires, directly or through other requires edges. */
export function requiresClosure(g: Graph, id: string): Set<string> {
  const seen = new Set<string>();
  const walk = (n: string) => {
    for (const e of g.out.get(n) ?? []) {
      if (e.type !== 'requires' || seen.has(e.to)) continue;
      seen.add(e.to);
      walk(e.to);
    }
  };
  walk(id);
  return seen;
}

export interface Dependent {
  id: string;
  type: 'requires' | 'references';
  /** Number of requires edges between this item and the one asked about. 1 = direct. */
  depth: number;
  via: string[];
}

/**
 * Items that depend on `id`. Through requires edges: transitively, to `maxDepth`. Through references edges: direct only,
 * because a mention does not make later work depend on an earlier item.
 */
export function dependentsOf(g: Graph, id: string, maxDepth = 6): Dependent[] {
  const found = new Map<string, Dependent>();
  const queue: { id: string; depth: number; via: string[] }[] = [{ id, depth: 0, via: [] }];
  const visited = new Set<string>([id]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of g.inn.get(cur.id) ?? []) {
      if (e.type !== 'requires' || visited.has(e.from) || cur.depth + 1 > maxDepth) continue;
      visited.add(e.from);
      const d: Dependent = { id: e.from, type: 'requires', depth: cur.depth + 1, via: cur.via };
      found.set(e.from, d);
      queue.push({ id: e.from, depth: d.depth, via: [...cur.via, e.from] });
    }
  }
  for (const e of g.inn.get(id) ?? []) if (e.type === 'references' && !found.has(e.from)) found.set(e.from, { id: e.from, type: 'references', depth: 1, via: [] });
  found.delete(BUILD_ID);
  return [...found.values()].sort((a, b) => (a.type === b.type ? a.depth - b.depth : a.type === 'requires' ? -1 : 1) || a.id.localeCompare(b.id, undefined, { numeric: true }));
}

// ---- what is blocking the build

export interface BuildBlocker {
  id: string;
  /** Distance from the build, counted in requires edges. 1 = the build requires it directly. */
  depth: number;
  /** True if everything it requires is already resolved, so it can be worked on now. */
  ready: boolean;
  /** How many unresolved items in the chain depend on it, directly or not. */
  unlocks: number;
  waitingFor: string[];
}

export interface BuildAnalysis {
  blockers: BuildBlocker[];
  /** Items that can be worked on now, most unlocking first. */
  ready: BuildBlocker[];
  cycles: string[][];
  unresolvedCount: number;
}

export function analyseBuild(g: Graph): BuildAnalysis {
  // Walk what the build requires. Resolved work ends a branch: what it needed no longer blocks anything.
  const chainFrom = (start: string): Set<string> => {
    const seen = new Set<string>();
    const walk = (n: string) => {
      for (const e of g.out.get(n) ?? []) {
        if (e.type !== 'requires' || seen.has(e.to)) continue;
        seen.add(e.to);
        const t = g.nodes.get(e.to);
        if (t && !t.resolved) walk(e.to);
      }
    };
    walk(start);
    return seen;
  };
  const inChain = chainFrom(BUILD_ID);
  const unresolved = [...inChain].filter((id) => {
    const n = g.nodes.get(id);
    return n && n.kind !== 'requirement' && !n.resolved;
  });
  const set = new Set(unresolved);
  // shortest distance from the build, not passing through resolved work
  const depth = new Map<string, number>([[BUILD_ID, 0]]);
  const q = [BUILD_ID];
  while (q.length) {
    const cur = q.shift()!;
    if (cur !== BUILD_ID && g.nodes.get(cur)?.resolved) continue;
    for (const e of g.out.get(cur) ?? []) {
      if (e.type !== 'requires' || depth.has(e.to)) continue;
      depth.set(e.to, depth.get(cur)! + 1);
      q.push(e.to);
    }
  }
  const chains = new Map(unresolved.map((o) => [o, chainFrom(o)]));
  const unlocksOf = (id: string) => unresolved.filter((o) => o !== id && chains.get(o)!.has(id)).length;
  const blockers: BuildBlocker[] = unresolved.map((id) => {
    const waitingFor = (g.out.get(id) ?? []).filter((e) => e.type === 'requires' && set.has(e.to)).map((e) => e.to);
    return { id, depth: depth.get(id) ?? 0, ready: waitingFor.length === 0, unlocks: unlocksOf(id), waitingFor };
  });
  blockers.sort((a, b) => a.depth - b.depth || b.unlocks - a.unlocks || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const ready = blockers.filter((b) => b.ready).sort((a, b) => b.unlocks - a.unlocks || a.id.localeCompare(b.id, undefined, { numeric: true }));
  return { blockers, ready, cycles: g.cycles, unresolvedCount: unresolved.length };
}

// ---- impact rules

export interface ImpactArtefact {
  path: string;
  area: string;
  authority: string;
}

export interface Impact {
  decisionId: string;
  rule: 'rejected' | 'deferred-critical';
  /** Work that requires the decision, transitively. It cannot proceed as planned. */
  requiring: Dependent[];
  /** Work that only mentions it. It may be affected and should be looked at, nothing more. */
  mentioning: Dependent[];
  requirements: string[];
  designGates: string[];
  decisions: string[];
  artefacts: ImpactArtefact[];
  /** For a critical deferral: implementation work that must remain blocked. */
  mustRemainBlocked: string[];
  note: string;
}

const IMPLEMENTATION: WorkItem['kind'][] = ['roadmap', 'backlog', 'validation', 'security'];

export interface ImpactContext {
  graph: Graph;
  items: Map<string, WorkItem>;
  artefactsFor(decisionId: string): ImpactArtefact[];
}

export function impactOf(ctx: ImpactContext, decisionId: string, rule: Impact['rule']): Impact {
  const deps = dependentsOf(ctx.graph, decisionId);
  const requiring = deps.filter((d) => d.type === 'requires');
  const mentioning = deps.filter((d) => d.type === 'references');
  const kindOf = (id: string) => ctx.items.get(id)?.kind;
  const d = ctx.items.get(decisionId);
  const pick = (ids: Dependent[], kinds: WorkItem['kind'][]) => ids.filter((x) => kinds.includes(kindOf(x.id) as WorkItem['kind'])).map((x) => x.id);
  const all = [...requiring, ...mentioning];
  return {
    decisionId,
    rule,
    requiring,
    mentioning,
    requirements: [...new Set([...(d?.relatedRequirements ?? []), ...pick(all, ['requirement-gap']).map((x) => x.replace(/^RG-/, ''))])],
    designGates: pick(all, ['design-gate']),
    decisions: pick(all, ['decision']).filter((x) => x !== decisionId),
    artefacts: ctx.artefactsFor(decisionId),
    mustRemainBlocked: rule === 'deferred-critical' ? requiring.filter((x) => IMPLEMENTATION.includes(kindOf(x.id) as WorkItem['kind']) && !isResolved(ctx.items.get(x.id)?.status ?? null)).map((x) => x.id) : [],
    note:
      rule === 'rejected'
        ? 'Work that requires this decision is listed as affected. Work that only mentions it may be affected. No status was changed.'
        : 'Implementation work that requires this deferred, critical decision must remain blocked until it is decided.',
  };
}

export interface DecisionEffect {
  decisionId: string;
  status: 'Rejected' | 'Deferred';
  critical: boolean;
}

/**
 * Applies the two decision rules to a copy of the items:
 *  - rejected decision: every item that requires or mentions it gets an advisory "review needed" flag. No status changes.
 *  - critical decision deferred: every unresolved item that requires it, transitively, becomes Blocked, with the reason.
 * A deferred decision that is not critical changes nothing. Items with no edge to the decision are never touched.
 */
export function applyDecisionEffects(items: WorkItem[], g: Graph, effects: DecisionEffect[]): { items: WorkItem[]; impacts: Impact[] } {
  const byId = new Map(items.map((i) => [i.id, { ...i, derivedBlocks: [...i.derivedBlocks], reviewNeeded: [...i.reviewNeeded] }]));
  const ctx: ImpactContext = { graph: g, items: byId, artefactsFor: () => [] };
  const impacts: Impact[] = [];
  for (const e of effects) {
    if (e.status === 'Deferred' && !e.critical) continue;
    const rule: Impact['rule'] = e.status === 'Rejected' ? 'rejected' : 'deferred-critical';
    const impact = impactOf(ctx, e.decisionId, rule);
    impacts.push(impact);
    const targets = rule === 'rejected' ? [...impact.requiring, ...impact.mentioning] : impact.requiring;
    for (const t of targets) {
      const it = byId.get(t.id);
      if (!it || t.id === e.decisionId) continue;
      if (rule === 'rejected') {
        it.reviewNeeded.push({ by: e.decisionId, reason: `${e.decisionId} was rejected and this item ${t.type === 'requires' ? 'requires' : 'mentions'} it: review it. Nothing was changed.` });
      } else if (!isResolved(it.status) && it.status !== 'Closed, no evidence') {
        it.derivedBlocks.push({ by: e.decisionId, reason: `${e.decisionId} is critical and deferred, and this work requires it` });
        if (it.status === 'Open' || it.status === 'Unmarked') {
          it.status = 'Blocked';
          it.statusBasis = `${it.statusBasis}; derived: it requires ${e.decisionId}, a critical decision that is deferred`;
        }
      }
    }
  }
  return { items: [...byId.values()], impacts };
}

// ---- requirement changes

export interface ReqLike {
  id: string;
  title: string;
  priority: string;
  cls: string;
  justification: string;
  acceptance: string;
  validation: string;
  evidenceRequired: string;
  decisions: string[];
  dependsOn: string[];
  openClarifications: string[];
  verifyClaims: string[];
}

const REQ_FIELDS: (keyof ReqLike)[] = ['title', 'priority', 'cls', 'justification', 'acceptance', 'validation', 'evidenceRequired', 'decisions', 'dependsOn', 'openClarifications', 'verifyClaims'];

export interface RequirementChange {
  id: string;
  change: 'added' | 'removed' | 'changed';
  fields: string[];
}

export function requirementChanges(prev: ReqLike[], next: ReqLike[]): RequirementChange[] {
  const a = new Map(prev.map((r) => [r.id, r]));
  const b = new Map(next.map((r) => [r.id, r]));
  const out: RequirementChange[] = [];
  for (const [id, r] of b) {
    const p = a.get(id);
    if (!p) out.push({ id, change: 'added', fields: [] });
    else {
      const fields = REQ_FIELDS.filter((f) => JSON.stringify(p[f]) !== JSON.stringify(r[f]));
      if (fields.length) out.push({ id, change: 'changed', fields });
    }
  }
  for (const id of a.keys()) if (!b.has(id)) out.push({ id, change: 'removed', fields: [] });
  return out.sort((x, y) => x.id.localeCompare(y.id));
}

/** Decisions that a changed requirement directly touches: the requirement lists them, or they list it as blocked by them. */
export function decisionsImpactedBy(changes: RequirementChange[], reqs: ReqLike[], decisions: { id: string; relatedRequirements: string[] }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const reqById = new Map(reqs.map((r) => [r.id, r]));
  for (const c of changes) {
    const direct = new Set<string>(reqById.get(c.id)?.decisions ?? []);
    for (const d of decisions) if (d.relatedRequirements.includes(c.id)) direct.add(d.id);
    for (const id of direct) out.set(id, [...(out.get(id) ?? []), c.id]);
  }
  return out;
}

/** Flags impacted decisions for review. Advisory: no status changes, and nothing without a direct link is touched. */
export function flagRequirementImpact(items: WorkItem[], impacted: Map<string, string[]>, changes: RequirementChange[]): WorkItem[] {
  const field = new Map(changes.map((c) => [c.id, c.change === 'changed' ? c.fields.join(', ') : c.change]));
  return items.map((i) => {
    const reqs = i.kind === 'decision' ? impacted.get(i.id) : undefined;
    if (!reqs?.length) return i;
    return { ...i, reviewNeeded: [...i.reviewNeeded, ...reqs.map((r) => ({ by: r, reason: `Requirement ${r} changed (${field.get(r)}): review this decision. Its status was not changed.` }))] };
  });
}

// ---- ordering

export const byPriority = (a: WorkItem, b: WorkItem) =>
  (a.priority ? PRIORITY_RANK[a.priority as Priority] : 9) - (b.priority ? PRIORITY_RANK[b.priority as Priority] : 9) || a.id.localeCompare(b.id, undefined, { numeric: true });
