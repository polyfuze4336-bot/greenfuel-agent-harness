import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it, before } from 'node:test';
import { GitRepositoryAdapter } from '../src/lib/repo/git.ts';
import { buildModel } from '../src/lib/repo/build.ts';
import type { StudioModel } from '../src/lib/repo/types.ts';

// B2: the Studio must never disagree with the harness about whether a design review is Blocked. The Studio does not run the design
// gate; it shows `computed` from a derived snapshot (docs/architecture-studio/inventory.snapshot.json). This test runs the harness's own
// gate (harness/scripts/design-gate.mjs) on every design review and compares, so a stale snapshot or a diverging rule is a failure.
const root = GitRepositoryAdapter.findRoot(process.cwd());
const gate = (await import(pathToFileURL(path.join(root, 'harness', 'scripts', 'design-gate.mjs')).href)) as {
  evaluateReviewFile: (root: string, reviewPath: string) => { computed: string; block: string[]; reject: string[]; errors: string[]; review: { id: string; status: string; file: string } };
};

let model: StudioModel;
before(() => {
  model = buildModel(new GitRepositoryAdapter(root, 'HEAD').open());
});

const word = (s: string | null | undefined) => (s ?? '').trim().split(/\s+/)[0] ?? '';
// The harness's rule (design-gate.mjs ALLOWED): a declared status may not be more permissive than the computed one.
const ALLOWED: Record<string, string[]> = { Rejected: ['Rejected'], Blocked: ['Draft', 'In review', 'Blocked'], Approvable: ['Draft', 'In review', 'Blocked', 'Approved'] };

describe('Studio versus the harness design gate', () => {
  it('there is at least one design review to compare', () => {
    assert.ok(model.reviews.length >= 3, `expected the repository's design reviews, found ${model.reviews.length}`);
  });

  it('for every design review the Studio shows the same computed result as the gate computes now', () => {
    const differences: string[] = [];
    for (const r of model.reviews) {
      const live = gate.evaluateReviewFile(root, r.src.path);
      if (live.errors.length) {
        differences.push(`${r.id}: the gate reports errors: ${live.errors[0]}`);
        continue;
      }
      if (word(r.computed) !== word(live.computed)) differences.push(`${r.id}: the Studio shows "${r.computed}" but the gate computes "${live.computed}" (the snapshot is stale or the rules diverge; run harness/scripts/studio-inventory.mjs --write)`);
    }
    assert.deepEqual(differences, []);
  });

  it('every declared status is allowed by the gate, and a gate-Blocked review is never shown as Approved', () => {
    const problems: string[] = [];
    for (const r of model.reviews) {
      const live = gate.evaluateReviewFile(root, r.src.path);
      const allowed = ALLOWED[word(live.computed)];
      if (allowed && !allowed.includes(r.declared)) problems.push(`${r.id}: declared ${r.declared} but the gate computes ${live.computed}`);
      if (word(live.computed) !== 'Approvable' && r.declared === 'Approved') problems.push(`${r.id}: shown Approved while the gate says ${live.computed}`);
    }
    assert.deepEqual(problems, []);
  });

  it('the blocking reasons the Studio counts equal the gate\'s', () => {
    const problems: string[] = [];
    for (const r of model.reviews) {
      const live = gate.evaluateReviewFile(root, r.src.path);
      if (r.blockReasons !== null && r.blockReasons !== live.block.length) problems.push(`${r.id}: Studio counts ${r.blockReasons} blocking reasons, the gate ${live.block.length}`);
    }
    assert.deepEqual(problems, []);
  });

  it('an ADR is shown Blocked exactly when it is still Proposed and a design review that names it is declared Blocked', () => {
    const problems: string[] = [];
    for (const d of model.register.records.filter((x) => x.kind === 'adr')) {
      const blockedReview = model.reviews.some((r) => r.declared === 'Blocked' && r.adrs.includes(d.id));
      const expected = /^Proposed/.test(d.statusRaw) && blockedReview;
      if ((d.status === 'Blocked') !== expected) problems.push(`${d.id}: shown ${d.status} (status line "${d.statusRaw.slice(0, 30)}") but a Blocked review ${blockedReview ? 'names' : 'does not name'} it`);
    }
    assert.deepEqual(problems, []);
  });
});