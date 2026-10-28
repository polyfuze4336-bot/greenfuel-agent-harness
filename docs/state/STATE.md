# STATE

Resume point. Update with the `session-handoff` skill. Facts only; unverified items are labelled.

## Current phase and objective
Phase 0. Stage 0 (harness foundation) is accepted. Stage 2 has started with the **requirements baseline v0.1** in [docs/context/](../context/). Objective: owner review of the baseline and answers to the M1 decisions in the [decision register](../context/DECISION-REGISTER.md). No options analysis or design has started.

## Done (with evidence)
- ADR 0001 and ADR 0002 accepted by the programme owner on 2026-10-28.
- Private GitHub repo `polyfuze4336-bot/greenfuel-agent-harness` created and Stage 0 history pushed (owner approved the repo and its owner account). The `validate` workflow completed successfully on commit `fca906d`: `EV-0003`.
- R1 partly done in Copilot CLI 1.0.102: the hook denied `azd up` and a write to `src/` in a trusted folder, and did nothing in an untrusted folder. Details and limits in [LIVE-TEST-R1](../harness/LIVE-TEST-R1.md). No evidence record, because the output was relayed by the model rather than captured by the recorder.
- Earlier Stage 0 evidence: validator pass `EV-0001` and 68 unit tests `EV-0002`, both on commit `17a7de2`.
- Requirements baseline v0.1 written: 99 requirements (37 class A, 62 class B), 37 open decisions, 25 unverified scheme or standard candidates, data classification, sovereignty and autonomy matrices, assumptions, and a context-loading strategy with 15 profiles. Counts come from `npm run stats`.
- An independent model review of the baseline (a separate agent, not an evidence record) raised 10 issues: break-glass access contradicting residency (SEC-002), cross-boundary placements missing the legal-flow condition (SOVEREIGNTY-MATRIX), mixed A and B content in six rows, a bit-identical standard fixed before D-022, offline issuance assumed before D-007 and D-020, a signed-source assumption (AGT-003), numeric targets inside class A rows, and two context profiles that omitted sovereignty controls. All were fixed in the baseline. It found no problems in the standards and regulation citations; that does not verify them.
- `npm run validate` and `npm test` pass on the baseline commit: `EV-0004` and `EV-0005`. These show the baseline is internally consistent (IDs, traceability, references, manifest coverage). They do not show the content is right.
- No Azure resource was created or queried. Only local `az version` and `azd version` ran.

## Claimed, unverified
- Hook and agent behaviour in VS Code chat (remaining part of R1).
- That agents follow the `context-loading` procedure (R11).
- Every regulatory, scheme and standard name in [CERTIFICATION-SCHEMES](../context/CERTIFICATION-SCHEMES.md). All are candidates. Verification procedure is D-002.
- Placeholder NFR numbers (NFR-003, NFR-004, NFR-007, NFR-008) are proposals, not targets.
- Whether the baseline matches the owner's intent. No stakeholder has reviewed it.
- The CI workflow on commits after `fca906d` (not pushed).

## Next actions
1. Owner reviews the baseline, in this order: [PROBLEMSTATEMENT](../../PROBLEMSTATEMENT.md), [DECISION-REGISTER](../context/DECISION-REGISTER.md), [REQUIREMENTS](../context/REQUIREMENTS.md), [ASSUMPTIONS](../context/ASSUMPTIONS.md).
2. Owner answers or defers the 17 M1 decisions.
3. Owner approves pushing the new commits to the private repo.
4. Finish R1 in VS Code chat; run R11.

## Open approvals
- Baseline v0.1 (not yet approved by the owner)
- Pushing commits after `fca906d` to GitHub (not pushed)
- All 37 decisions in the register (Open)

## Blockers and risks
- Seventeen M1 decisions block options analysis.
- Hooks are not loaded in untrusted folders, silently. Trust the folder first.
- Repository sits in a OneDrive-synced folder (Q1).
- Hook fail-open on timeout and evasion by shell commands (see HARNESS-ARCHITECTURE section 3.4).
