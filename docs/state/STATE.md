# STATE

Resume point. Update with the `session-handoff` skill. Facts only; unverified items are labelled.

## Current phase and objective
Phase 0. Baseline v0.1 is **approved** (ADR 0003); the 37 decisions stay open, deferred by the owner. The architecture-governance capability is **approved as a process** (ADR 0005); [DES-0001](../architecture/designs/DES-0001-delivery-measurement-storage-topology.md) is computed **Blocked** and is not approved. This stage added **twelve specialist custom agents** with a policy file, a per-agent guard hook and a validator ([AGENT-ROSTER](../agents/AGENT-ROSTER.md), [ADR 0006](../adr/0006-specialist-agent-roster-and-enforcement.md), Proposed). Objective: owner review of the roster and its limits (TODO T6). No application code and no Azure resources exist.

## Done (with evidence)
- Owner decisions 2026-10-28: ADR 0001 and 0002 accepted; baseline approved and 2 commits pushed; M1 decisions deferred; R1 live test approved. CI succeeded on pushed commit `9f9a1f0`: `EV-0006`. Earlier CI on `fca906d`: `EV-0003`.
- Stage 0 evidence: `EV-0001`, `EV-0002`. Baseline evidence: `EV-0004`, `EV-0005`. R1 partly done in Copilot CLI only: [LIVE-TEST-R1](../harness/LIVE-TEST-R1.md) (hook enforces in a trusted folder, silently not loaded in an untrusted one).
- Governance built: twelve hard constraints, ten perspectives, five checkpoints, 60 defence questions (21 critical), 14 risks, three templates, two roles, three skills, and the gate (`design-gate.mjs`, `validate-architecture.mjs`). `npm test`: 102 tests, with mutation tests that reject, block and approve. Gate and validator evidence: `EV-0007` to `EV-0011`.
- Example: DES-0001 compares five options. The gate rejects the central store (HC-01), refuses to pass an unscreened option, and computes Blocked for the selected jurisdiction-local option, listing open decisions, partial Must requirements, four unassessed perspectives and six unanswered critical questions. [ADR 0004](../adr/0004-delivery-measurement-storage-topology.md) stays Proposed.
- Two independent model reviews of the governance work found gate bypasses and example overclaims; both were fixed or recorded (RK-014, DESIGN-REVIEW-GATE section 3). These reviews are not evidence records.
- No Azure resource was created or queried. Only local `az version` and `azd version` ran.
- Specialist agents: twelve agents in three classes, `agent-policy.json`, `agent-guard.cjs`, `validate-agents.mjs`, five path-scoped instruction files, an `orchestration` context profile. Commits `43f3cbd` and `d719cf4` (local, not pushed). `npm test`: 148 tests pass, `EV-0015`; `npm run validate` clean, `EV-0016`; agents match policy and installed VS Code 1.143.0 and Copilot CLI 1.0.105 match the tested versions, `EV-0014`. `EV-0012` and `EV-0013` record a recorder failure (npm could not be launched on Windows, spawn error, no result); the recorder was fixed and the runs repeated as `EV-0015` and `EV-0016`. They are kept because evidence is append-only.
- Live tests in Copilot CLI 1.0.105 ([DEMO-READONLY-DELEGATION](../agents/DEMO-READONLY-DELEGATION.md)): the orchestrator delegated a read-only review of DES-0001 to `principal-architect` and `architecture-critic` with no file changes; guard denials for out-of-scope writes, off-list commands, chained commands, and off-list or self delegation. These are observations in a transcript, not evidence records.
- An independent model review of the guard found four blocking gaps (recorder `--out`, encoded path traversal, unclassified tools allowed, agent-writable approval status) and two smaller ones; all were fixed with tests.

## Claimed, unverified
- Hook and agent behaviour in VS Code chat (R1 remainder); that agents follow `context-loading` (R11) that `design-reviewer` and `architecture-critic` behave as written (R12); that a write attempted inside a delegated subagent is stopped (see [DEMO-READONLY-DELEGATION](../agents/DEMO-READONLY-DELEGATION.md)).
- The agents' output quality and consistency: one delegation run on one design. The roster has not been used for real work.
- Agent-scoped hooks in VS Code chat; a write attempted inside a delegated subagent; native `agents` allow-list enforcement on its own (TODO T9).
- The example review was written by a model. No human has reviewed it.
- The gate checks structure and consistency, not truth. Open weaknesses are listed in DESIGN-REVIEW-GATE section 3. The approval-status guard matches text and cannot authenticate a human (roadmap R4).
- Every standard and scheme name is a candidate. Placeholder NFR numbers are proposals.
- Commits `43f3cbd`, `d719cf4` and the evidence commit are not pushed; CI has not run on them (CI runs on Linux, the work was tested on Windows only).

## Next actions
1. Owner reviews the roster ([AGENT-ROSTER](../agents/AGENT-ROSTER.md)), the enforcement matrix and the demo record; approves, amends or rejects ADR 0006 (T6).
2. Owner approves pushing the new commits (T7); then check CI.
3. Owner names the deciders (T3) and answers or defers the M1 decisions; then run the governance gate on sibling designs.
4. Finish R1 in VS Code; run R11, R12 and the T9 agent checks.

## Open approvals
- ADR 0006, the specialist roster (Proposed)
- Pushing the newest commits to GitHub
- ADR 0004 (Proposed; cannot be Accepted while RV-0001 is Blocked)
- All 37 decisions (Open, deferred)

## Blockers and risks
- Seventeen M1 decisions block any design from being Approved.
- No design can be Approved without a named human decider; none is named.
- Hooks are not loaded in untrusted folders, silently. Trust the folder first.
- The repository sits in a OneDrive-synced folder (Q1).
- The gate can be satisfied with vacuous reasons (RK-014); branch protection and an approver registry are roadmap R4.
