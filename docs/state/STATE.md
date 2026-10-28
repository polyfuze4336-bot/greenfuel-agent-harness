# STATE

Resume point. Update with the `session-handoff` skill. Facts only; unverified items are labelled.

## Current phase and objective
Phase 0 (harness foundation). Objective: owner review of the foundation and decision on ADR 0001 and 0002.

## Done (with evidence)
- Reference repository assessed from a read-only snapshot; findings in [REFERENCE-ASSESSMENT](../harness/REFERENCE-ASSESSMENT.md). Evidence: the document cites file paths and line numbers; no command was run against the reference code.
- Repository validator passes on commit `17a7de2`: [EV-0001](../evidence/records/EV-0001.json) (exit 0).
- 68 unit tests pass (policy guard decisions and hook process contract, evidence recorder, validator rules) on commit `17a7de2`: [EV-0002](../evidence/records/EV-0002.json) (exit 0). These test the scripts in isolation, not behaviour inside Copilot.
- Phase 0 gate holds: no `src/`, `infra/`, IaC, Dockerfile or `azure.yaml` exist (validator check `phase-gate`, in EV-0001). No Azure command was run during this stage.

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
