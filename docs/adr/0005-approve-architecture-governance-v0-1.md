# ADR 0005: Approve architecture governance capability v0.1

- **Status:** Accepted (2026-10-28, programme owner, by instruction in chat after reviewing the stage summary)
- **Type:** Governance
- **Date:** 2026-10-28
- **Deciders:** Programme owner
- **Supersedes:** none

## Context
- FACT: The architecture-governance capability exists in [docs/architecture/](../architecture/) and was committed and pushed on 2026-10-28. CI succeeded on the pushed commit. Its tests (102 at the time) pass and its checks run in `npm run validate`; gate runs are recorded as EV-0007 to EV-0011.
- FACT: Two independent model reviews attacked the gate and the worked example; their findings were fixed or recorded (RK-014; DESIGN-REVIEW-GATE section 3).
- FACT: The example design DES-0001 is computed Blocked by the gate. No human decider has been named.
- ASSUMPTION: Stakeholders beyond the owner have not reviewed the capability.

## Options considered
1. **Approve selected parts only.** Cautious, but leaves the process half-usable and still needs a later decision.
2. **Approve the whole capability as a process, and approve nothing about the example design (chosen).** The process can be used now; the design question stays open and is judged by the gate.
3. **Withhold approval until a human decider is named and the gate has been run on a second design.** Strongest evidence, but blocks use of the process.

## Decision
The owner approves the following as **architecture governance capability v0.1**, to be used for every major design:

| Approved element | Where |
|---|---|
| Twelve hard constraints and the rule that none can be waived | [HARD-CONSTRAINTS](../architecture/HARD-CONSTRAINTS.md) |
| Ten review perspectives and their verdicts (Pass, Concern, Fail, Not assessed) | [REVIEW-PERSPECTIVES](../architecture/REVIEW-PERSPECTIVES.md) |
| Five review checkpoints CP1 to CP5 | [REVIEW-CHECKPOINTS](../architecture/REVIEW-CHECKPOINTS.md) |
| Design-review gate rules (reject, block, approvable; structure rules ST-1 to ST-12; decision-status rule; figures lint) and its limits | [DESIGN-REVIEW-GATE](../architecture/DESIGN-REVIEW-GATE.md) |
| Defence question bank (60 questions, 21 critical) | [DEFENSE-QUESTION-BANK](../architecture/DEFENSE-QUESTION-BANK.md) |
| Risk register format and the fourteen risks in it | [RISK-REGISTER](../architecture/RISK-REGISTER.md) |
| Design, review-record and ADR (template v2) templates | [templates/](../architecture/templates/) |
| Governance roles, skills `design-authoring`, `design-review`, `design-defense`, and the rule that no agent can approve or accept | [GOVERNANCE](../architecture/GOVERNANCE.md) |
| Automated checks: `design-gate.mjs`, `validate-architecture.mjs` | `harness/scripts/` |

**Not approved by this decision:**
- DES-0001 as a design, and ADR 0004. They remain Blocked and Proposed. DES-0001 and RV-0001 are approved only as a worked demonstration of the process.
- Any waiver, any design approval, and the naming of a human decider. Naming deciders is deferred by the owner (TODO T3). Until a decider is named, the gate cannot produce a valid Approved status, so no design can be Approved.
- The decision register (all 37 decisions stay open and deferred).

## Consequences
- Every major design from now on is authored, reviewed and gated under these rules. Changes to them follow the control-plane approval rule.
- No design can reach Approved until a human decider is named and the M1 and M2 decisions linked to its in-scope Must requirements are decided.
- The known weaknesses in DESIGN-REVIEW-GATE section 3 are accepted for now and tracked as RK-014; branch protection and an approver registry are roadmap item R4.

## Revisit when
The gate is run on a second design and exposes a rule that is wrong or missing; a human reviewer disagrees with a hard-constraint verdict in a way the rules cannot express; or R4 changes how approval is enforced.

## Evidence
EV-0006 (CI on the pushed commit), EV-0007 to EV-0011 (gate runs, validator, tests). These show the process runs and is internally consistent. They do not show that its judgments are correct.
