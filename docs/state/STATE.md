# STATE

Resume point. Update with the `session-handoff` skill. Facts only; unverified items are labelled.

## Current phase and objective
Phase 0 (harness foundation). Objective: owner review of the foundation and decision on ADR 0001 and 0002.

## Done (with evidence)
Populated after the verification run; see below.

## Claimed, unverified
- Hook and agents behave as documented inside a live Copilot session (roadmap R1).
- CI workflow runs on GitHub (no remote exists).

## Next actions
1. Owner reviews the repository and answers [OPEN-QUESTIONS](../harness/OPEN-QUESTIONS.md), starting with Q1, Q2, Q3, Q4.
2. Accept, amend or reject [ADR 0001](../adr/0001-native-first-harness.md) and [ADR 0002](../adr/0002-phase-gating-and-approval-enforcement.md).
3. Run roadmap item R1 (live-session verification).

## Open approvals
- ADR 0001 (Proposed)
- ADR 0002 (Proposed)
- Creating a GitHub remote (not done)

## Blockers and risks
- Repository sits in a OneDrive-synced folder (Q1).
- Hook fail-open on timeout and evasion by shell commands (see HARNESS-ARCHITECTURE section 3.4).
