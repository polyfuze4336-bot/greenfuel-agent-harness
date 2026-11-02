import { getQueue } from '../queue/server.ts';
import { getModel } from '../repo/index.ts';
import { analyzeImpact } from './analyze.ts';
import type { ImpactAction, ImpactResult } from './types.ts';

/** The impact of one decision, from the read model and the work queue's stated dependencies. Read-only. */
export async function impactFor(id: string, action: ImpactAction): Promise<ImpactResult | null> {
  const m = await getModel();
  let queue = null;
  try {
    const q = await getQueue();
    queue = { items: q.snapshot.items, edges: q.snapshot.edges, refNodes: q.snapshot.refNodes, unresolved: q.snapshot.unresolved };
  } catch {
    queue = null; // the analysis still runs, and says the queue was not available
  }
  return analyzeImpact({ commit: m.repo.commit, records: m.register.records, requirements: m.requirements, risks: m.risks, tasks: m.tasks, reviews: m.reviews, docs: m.docs, qa: m.presentation.qa, suggestions: m.register.suggestions, queue }, id, action);
}
