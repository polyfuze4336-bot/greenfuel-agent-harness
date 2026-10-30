// Builds the full Work Queue snapshot from the read model: derive items, overlay merged work-item events, apply the decision
// rules (rejected, critical deferred), build the dependency graph and the "what is blocking the build?" analysis.
import type { GitRepositoryAdapter } from '../repo/git.ts';
import { parseRequirements } from '../repo/parse.ts';
import type { StudioModel } from '../repo/types.ts';
import type { WorkState } from '../workflow/work-events.ts';
import { deriveWork, type RefNode } from './derive.ts';
import { analyseBuild, applyDecisionEffects, buildGraph, decisionsImpactedBy, flagRequirementImpact, requirementChanges, type BuildAnalysis, type DecisionEffect, type GNode, type Impact, type RequirementChange } from './graph.ts';
import { applyWorkOverlay } from './overlay.ts';
import type { Edge, UnresolvedRef, WorkItem } from './types.ts';
import { countViews, type View } from './views.ts';

export interface QueueSnapshot {
  commit: string;
  canonicalRef: string;
  items: WorkItem[];
  edges: Edge[];
  /** The part of the graph that blocks the build: the closure of the build's requirements, with the build itself. */
  blocking: { nodes: (GNode & { depth: number; unlocks: number; ready: boolean })[]; edges: Edge[]; analysis: BuildAnalysis };
  impacts: Impact[];
  unresolved: UnresolvedRef[];
  sources: { path: string; count: number }[];
  counts: Record<View, number>;
  refNodes: RefNode[];
  workProblems: string[];
}

export interface QueueOptions {
  work: Map<string, WorkState>;
  roleAliases: Record<string, string[]>;
  completionRoles: string[];
  canonicalRef: string;
}

const DOC_AREAS = /^docs\/(architecture\/designs|target-architecture|architecture|context)\//;

export function buildQueue(m: StudioModel, git: GitRepositoryAdapter, o: QueueOptions): QueueSnapshot {
  const d = deriveWork({ model: m, read: (p) => git.read(p), exists: (p) => git.has(p), roleAliases: o.roleAliases });
  let items = applyWorkOverlay(d.items, o.work, o.completionRoles, o.canonicalRef);
  const g0 = buildGraph(items, d.edges, d.refNodes);

  const effects: DecisionEffect[] = items
    .filter((i) => i.kind === 'decision' && (i.status === 'Rejected' || i.status === 'Deferred'))
    .map((i) => ({ decisionId: i.id, status: i.status as 'Rejected' | 'Deferred', critical: i.critical }));
  const applied = applyDecisionEffects(items, g0, effects);
  items = applied.items;

  const docs = new Map(m.docs.map((x) => [x.path, x]));
  const records = new Map(m.register.records.map((r) => [r.id, r]));
  const impacts = applied.impacts.map((im) => ({
    ...im,
    artefacts: (records.get(im.decisionId)?.citedBy ?? []).filter((p) => DOC_AREAS.test(p)).map((p) => ({ path: p, area: docs.get(p)?.area ?? 'document', authority: docs.get(p)?.authority ?? 'reference' })),
  }));

  const g = buildGraph(items, d.edges, d.refNodes);
  const analysis = analyseBuild(g);
  const onPath = new Set(analysis.blockers.map((b) => b.id));
  items = items.map((i) => (onPath.has(i.id) ? { ...i, blocksBuild: true } : i));

  const info = new Map(analysis.blockers.map((b) => [b.id, b]));
  const nodes = [...onPath, 'BUILD'].map((id) => {
    const n = g.nodes.get(id)!;
    const b = info.get(id);
    return { ...n, depth: b?.depth ?? 0, unlocks: b?.unlocks ?? 0, ready: b?.ready ?? false };
  });
  const keep = new Set(nodes.map((n) => n.id));
  const edges = [...g.out.values()].flat().filter((e) => e.type === 'requires' && keep.has(e.from) && keep.has(e.to));

  const workProblems = [...o.work.values()].flatMap((s) => s.problems);
  return { commit: git.commit, canonicalRef: o.canonicalRef, items, edges: d.edges, blocking: { nodes, edges, analysis }, impacts, unresolved: d.unresolved, sources: d.sources, counts: countViews(items), refNodes: d.refNodes, workProblems };
}

/** Requirements at another ref (a branch, a commit), parsed with the same parser as the current ones. */
export function requirementsAt(git: GitRepositoryAdapter) {
  const read = (p: string) => git.read(p) ?? '';
  return parseRequirements(read('docs/context/REQUIREMENTS.md'), read('docs/context/NON-FUNCTIONAL-REQUIREMENTS.md'), read('docs/context/REQUIREMENTS-TRACEABILITY.md'), 'docs/context/REQUIREMENTS.md', 'docs/context/NON-FUNCTIONAL-REQUIREMENTS.md', 'docs/context/REQUIREMENTS-TRACEABILITY.md');
}

export interface RequirementImpactReport {
  from: string;
  changes: RequirementChange[];
  /** Decisions a changed requirement directly touches, flagged for review. Advisory: no status was changed. */
  flagged: { decisionId: string; title: string; because: string[] }[];
}

export function requirementImpact(m: StudioModel, previous: ReturnType<typeof requirementsAt>, from: string): RequirementImpactReport {
  const changes = requirementChanges(previous, m.requirements);
  const decisions = m.register.records.map((r) => ({ id: r.id, relatedRequirements: r.blockingRequirements.map((x) => x.id) }));
  const nextReqs = [...m.requirements, ...previous.filter((p) => !m.requirements.some((n) => n.id === p.id))];
  const impacted = decisionsImpactedBy(changes, nextReqs, decisions);
  const byId = new Map(m.register.records.map((r) => [r.id, r]));
  return { from, changes, flagged: [...impacted].filter(([id]) => byId.has(id)).map(([id, because]) => ({ decisionId: id, title: byId.get(id)!.title, because })) };
}

export { flagRequirementImpact };
