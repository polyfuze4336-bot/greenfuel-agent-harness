// The acceptance world: a throw-away clone of this repository with its own bare "GitHub" remote, used to walk one decision and one deck
// through the whole workflow without touching the real repository or GitHub.
//
// What is SYNTHETIC here, and so proves a mechanism and not a real approval:
//   - the baseline policy is a small one (an enrolled approver plus one scope ADR), as in baseline.check.ts;
//   - the design reviews and the supporting ADRs the deck presents are marked Approved / Accepted in the world's first commit, so the
//     deck's decision gate can be reached. In the real repository they are Blocked or Proposed.
// The decision under test (ADR-0031) and everything after it go through the real workflow.
import fs from 'node:fs';
import path from 'node:path';
import { git, makeFixture, policyJson, type Fixture } from './review-fixture.ts';

const { buildEnrollment, registerEntry } = await import('../../../../harness/scripts/approval.mjs');
export const ACC_PASS = 'a-test-passphrase-123';

export const SUPPORTING_ADRS = ['0004', '0015', '0016', '0017', '0018', '0019'];

/** An ADR in the format the Studio parses: options, recommendation, consequences, and a decider the access policy recognizes. */
export function adrText(n: string, title: string, o: { extra?: string } = {}): string {
  return `# ADR ${n}: ${title}

- **Status:** Proposed
- **Type:** Governance
- **Date:** 2026-10-31
- **Deciders:** Programme owner
- **Supersedes:** none

## Context
- FACT: The acceptance world needs one new decision that arrives on GitHub after the Studio has started.
- FACT: [PROBLEMSTATEMENT](../../PROBLEMSTATEMENT.md) states the constraints this decision must respect.
- ASSUMPTION: The cost of the recommended option is one engineer-week; this is an estimate, not a measurement.

## Options considered
1. **Keep decision records in this repository (proposed).** Trade-offs: one source of truth and reviewable history, but every change needs the review workflow. Cost: no new service.
2. **A separate decision database.** Trade-offs: richer queries, but a second source of truth that can disagree with GitHub. Cost: a hosted database.
3. **Do nothing.** Trade-offs: no effort now, but decisions stay informal and unauditable. Cost: none now, audit risk later.

## Decision
Proposed for the programme owner's approval. If approved, decision records stay in this repository and change only through a reviewed pull request.

## Consequences
- Positive: every change has an author, a reviewer and a commit.
- Negative: a decision cannot be changed quickly outside the workflow.
- Risk: the workflow becomes a bottleneck if one person must approve everything.
${o.extra ?? ''}
## Revisit when
The number of decisions per week makes the review workflow a bottleneck.

## Evidence
- No evidence exists beyond this test world. It is Proposed and has no signed approval.
`;
}

export interface AcceptanceWorld {
  fx: Fixture;
  approver: { privateKeyPem: string; keyId: string; holder: string };
  repoRoot: string;
  /** Fast-forward the working copy to what is on GitHub, as a person pulling would. */
  pull(): void;
}

export function makeAcceptanceWorld(dir: string, repoRoot: string): AcceptanceWorld {
  const fx = makeFixture({ dir, cloneFrom: repoRoot, policy: policyJson() });
  const e = buildEnrollment({ holder: 'Test Architect', classes: ['architecture'], tiers: [], passphrase: ACC_PASS, now: new Date(Date.now() - 3 * 3600000) });
  const { entry } = registerEntry({ request: e.request, approvers: [], typedFingerprint: e.request.fingerprint, now: new Date(Date.now() - 2 * 3600000) });
  fs.writeFileSync(path.join(dir, 'approver.json'), JSON.stringify({ privateKeyPem: e.privateKeyPem, keyId: e.keyId, holder: 'Test Architect' }));

  const policy = {
    version: 1,
    activeStage: 'acceptance',
    rules: { reviewRecordsCountAsApproval: true, grandfatheredAdrsCountAsApproval: true, conditionalApprovals: 'flag', requirementChange: 'review', supersededBySuccessor: true },
    gates: [
      { id: 'approver-registry', title: 'An architecture-class approver is enrolled', type: 'harness', check: 'approvers', class: 'architecture', source: 'acceptance world: an architecture key must exist' },
      { id: 'scope-adr', title: 'The new decision ADR-0031 is approved', type: 'decisions', decisions: ['ADR-0031'], source: 'acceptance world: the decision under test' },
    ],
    stages: [{ id: 'acceptance', title: 'Acceptance world', gates: ['approver-registry', 'scope-adr'], includeMilestones: [], blockOn: [] }],
    areas: [{ id: 'application', title: 'Application', kind: 'implementation', stage: 'active', paths: ['^src/'] }],
    criticalAssumptions: { include: [], exclude: [] },
  };
  const files: Record<string, string> = {
    'harness/policy/baseline-policy.json': `${JSON.stringify(policy, null, 2)}\n`,
    'harness/policy/approvers.json': `${JSON.stringify({ version: 1, approvers: [entry] }, null, 2)}\n`,
  };
  // The supporting architecture the deck presents is pre-approved in this world only.
  for (const n of SUPPORTING_ADRS) {
    const f = fs.readdirSync(path.join(fx.work, 'docs', 'adr')).find((x) => x.startsWith(`${n}-`))!;
    const p = `docs/adr/${f}`;
    files[p] = fs.readFileSync(path.join(fx.work, p), 'utf8').replace(/- \*\*Status:\*\* Proposed/, '- **Status:** Accepted');
  }
  for (const rv of fs.readdirSync(path.join(fx.work, 'docs', 'architecture', 'reviews')).filter((f) => /^RV-000[123]-/.test(f))) {
    const p = `docs/architecture/reviews/${rv}`;
    files[p] = fs.readFileSync(path.join(fx.work, p), 'utf8').replace(/- \*\*Status:\*\* Blocked/, '- **Status:** Approved');
  }
  fx.commitToMain(files, 'acceptance world: reduced build policy, an enrolled approver and a pre-approved supporting architecture (SYNTHETIC)');
  const pull = () => {
    git(fx.work, 'fetch', '-q', 'origin');
    git(fx.work, 'merge', '-q', '--ff-only', 'origin/main');
  };
  pull();
  pull();
  return { fx, approver: { privateKeyPem: String(e.privateKeyPem), keyId: e.keyId, holder: 'Test Architect' }, repoRoot, pull };
}
