# STATE

Resume point. Update with the `session-handoff` skill. Facts only; unverified items are labelled.

## Current phase and objective
Phase 0. Baseline v0.1 is **approved** (ADR 0003, 2026-10-28); the 37 decisions stay open, deferred by the owner. Stage 2 now has an **architecture-governance capability** in [docs/architecture/](../architecture/): hard constraints, ten review perspectives, checkpoints, a design-review gate, a defence question bank and a risk register. It is demonstrated on one example, [DES-0001](../architecture/designs/DES-0001-delivery-measurement-storage-topology.md), which the gate computes as **Blocked**. Objective: owner review of the governance capability and the example.

## Done (with evidence)
- Owner decisions 2026-10-28: ADR 0001 and 0002 accepted; baseline approved and 2 commits pushed; M1 decisions deferred; R1 live test approved. CI succeeded on pushed commit `9f9a1f0`: `EV-0006`. Earlier CI on `fca906d`: `EV-0003`.
- Stage 0 evidence: `EV-0001`, `EV-0002`. Baseline evidence: `EV-0004`, `EV-0005`. R1 partly done in Copilot CLI only: [LIVE-TEST-R1](../harness/LIVE-TEST-R1.md) (hook enforces in a trusted folder, silently not loaded in an untrusted one).
- Governance built: twelve hard constraints, ten perspectives, five checkpoints, 60 defence questions (21 critical), 14 risks, three templates, two roles, three skills, and the gate (`design-gate.mjs`, `validate-architecture.mjs`). `npm test`: 102 tests, with mutation tests that reject, block and approve. Gate and validator evidence: `EV-0007` to `EV-0011`.
- Example: DES-0001 compares five options. The gate rejects the central store (HC-01), refuses to pass an unscreened option, and computes Blocked for the selected jurisdiction-local option, listing open decisions, partial Must requirements, four unassessed perspectives and six unanswered critical questions. [ADR 0004](../adr/0004-delivery-measurement-storage-topology.md) stays Proposed.
- Two independent model reviews of the governance work found gate bypasses and example overclaims; both were fixed or recorded (RK-014, DESIGN-REVIEW-GATE section 3). These reviews are not evidence records.
- No Azure resource was created or queried. Only local `az version` and `azd version` ran.

## Claimed, unverified
- Hook and agent behaviour in VS Code chat (R1 remainder); that agents follow `context-loading` (R11) that `design-reviewer` and `architecture-critic` behave as written (R12); that a write attempted inside a delegated subagent is stopped (see [DEMO-READONLY-DELEGATION](../agents/DEMO-READONLY-DELEGATION.md)).
- The example review was written by a model. No human has reviewed it.
- The gate checks structure and consistency, not truth. Open weaknesses are listed in DESIGN-REVIEW-GATE section 3.
- Every standard and scheme name is a candidate. Placeholder NFR numbers are proposals.
- The 2 newest commits are not pushed.

## Next actions
1. Owner reviews [GOVERNANCE](../architecture/GOVERNANCE.md), [HARD-CONSTRAINTS](../architecture/HARD-CONSTRAINTS.md), [DESIGN-REVIEW-GATE](../architecture/DESIGN-REVIEW-GATE.md) and the DES-0001 / RV-0001 example.
2. Owner approves pushing the new commits.
3. Owner names the deciders (T3) and answers or defers the M1 decisions; then run R13 sibling designs.
4. Finish R1 in VS Code; run R11 and R12.

## Open approvals
- Pushing the newest commits to GitHub
- ADR 0004 (Proposed; cannot be Accepted while RV-0001 is Blocked)
- All 37 decisions (Open, deferred)

## Blockers and risks
- Seventeen M1 decisions block any design from being Approved.
- No design can be Approved without a named human decider; none is named.
- Hooks are not loaded in untrusted folders, silently. Trust the folder first.
- The repository sits in a OneDrive-synced folder (Q1).
- The gate can be satisfied with vacuous reasons (RK-014); branch protection and an approver registry are roadmap R4.
