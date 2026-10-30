# Capstone readiness assessment: effect of the Studio and its validation

Extends [CAPSTONE-READINESS](../capstone/CAPSTONE-READINESS.md) (which remains the one-page statement against the rubric). **This is not a score**; the rubric is scored live and by reviewers.

## What the Studio changes

The Studio is **governance tooling for the architecture**, not the solution. It strengthens evidence of *how* decisions are made and traced; it does not supply a working bunkering solution, measured results or a recommendation.

| Rubric area | Helped by the Studio | Not helped |
|---|---|---|
| A. Technical Excellence | Evidence of decision discipline: every decision traceable to a file and commit, approvals that cannot be forged, a build gate, a tested approval workflow; an honest limits list | **A working solution, AI evaluation of the business agents, measured results, an accepted architecture.** None of this exists, and the Studio does not substitute for it |
| B. Communication | A 40-slide editable sample deck with sources and notes; a repeatable way to regenerate it from the baseline; explicit placeholders for missing evidence | A recommendation narrative, a rehearsed demo, use-case numbers. The 7 placeholders (volumes, premiums, time saving, performance, recovery, telemetry, rehearsal) remain empty |
| C. Consultative | A decision record showing alternatives and conceded trade-offs | A stakeholder map, a quantified value case |
| D. Artifact | A candidate subject (an evidence-gated approval and presentation pipeline) | Selection, completion and submission |

## Where the repository stands now (measured from the real repository, not the test world)

- 57 decisions: **13 Approved, 37 Pending Review, 1 Proposed, 6 Blocked, 0 Rejected, 0 Deferred.**
- Build gate: **blocked** (phase 0; no architecture-class approver enrolled; ADR-0020 Proposed; no baseline authorized).
- Deck gate: 7 of 7 presented decisions not approved; 0 of 40 slides approved; 40 of 40 claim checks pass; 7 review placeholders; 0 of 10 rehearsal criteria recorded.
- **Therefore no final deck can exist today.** The sample deck is labelled SAMPLE.

## The path to a defensible deck (each step needs a person)

1. Enrol an architecture-class approver (T13) and sign approvals for ADR-0004, 0015-0020 once the reviews RV-0001 to RV-0003 stop being Blocked and a named decider exists.
2. Authorize a baseline (human, signed).
3. Resolve or accept the 7 placeholders with real evidence, or present them as stated gaps with written acknowledgement.
4. Approve each slide; render with PowerPoint; run a human design and accessibility review; rehearse.

## Risks the examination surfaced for the capstone

1. **Panel exposure:** a polished tool can make an unfinished architecture look finished. Every artifact must say what is simulated. The test world's "approved" decisions are synthetic and must never be shown as real approvals.
2. The final deck depends on Windows PowerPoint; a hosted deployment cannot produce it.
3. Branch protection is unavailable on this plan, so the approval path relies on application code, not platform enforcement.
4. No deployed instance exists, so a live demo of the Studio would run locally.

## Conditional assessment

Readiness of the **Studio** as a tool: good locally, unproven in Azure. Readiness of the **capstone solution**: unchanged from [CAPSTONE-READINESS](../capstone/CAPSTONE-READINESS.md); the Studio did not move A4 to A7, B3 or B7.
