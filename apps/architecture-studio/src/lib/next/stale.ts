import type { NormalizedDecision } from '../intel/schema.ts';
import type { StaleEvidenceFact } from './rank.ts';

// Evidence that cannot be relied on, by three written rules. None is a judgement.
//   missing  A decision cites an evidence record that does not exist at this commit.
//   failing  A decision cites a recorded run that exited non-zero.
//   stale    A decision cites a recorded run that started before the decision's own file last changed. The decision moved after the
//            evidence was taken, so the evidence may describe something that is no longer written down. This needs the decision to have
//            its own file, so it applies to ADRs. Register entries share one file, and a change to any row would make every row stale.

export interface RunFact {
  id: string;
  exitCode: number | null;
  startedAt: string;
}

/** A moment to the minute, in UTC, so two events on the same day can still be told apart. */
const stamp = (iso: string) => `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

export function staleEvidence(decisions: NormalizedDecision[], runs: Map<string, RunFact>, changedAt: (path: string) => string | null): StaleEvidenceFact[] {
  const out: StaleEvidenceFact[] = [];
  for (const d of decisions) {
    if (d.status === 'Superseded' || d.status === 'Rejected') continue;
    const changed = d.kind === 'adr' ? changedAt(d.source.path) : null;
    for (const e of d.evidence) {
      if (e.kind === 'design-review' || e.kind === 'design') continue;
      if (!e.resolved) {
        out.push({ decisionId: d.id, evidenceId: e.id, kind: 'missing', text: `${d.id} cites ${e.id}, which does not exist at this commit.` });
        continue;
      }
      const run = runs.get(e.id);
      const exit = run?.exitCode ?? e.exitCode;
      if (exit !== null && exit !== 0) {
        out.push({ decisionId: d.id, evidenceId: e.id, kind: 'failing', text: `${e.id}, cited by ${d.id}, exited ${exit}.` });
        continue;
      }
      if (run && changed && Date.parse(run.startedAt) < Date.parse(changed)) {
        out.push({ decisionId: d.id, evidenceId: e.id, kind: 'stale', text: `${e.id} was taken ${stamp(run.startedAt)}, before ${d.id} last changed (${stamp(changed)}).` });
      }
    }
  }
  return out.sort((a, b) => a.decisionId.localeCompare(b.decisionId, undefined, { numeric: true }) || a.evidenceId.localeCompare(b.evidenceId, undefined, { numeric: true }));
}
