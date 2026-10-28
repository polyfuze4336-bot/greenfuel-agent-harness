# TODO

Owner-facing list of pending answers and approvals. Items are removed only when answered and reflected in an ADR or the relevant document. The engineering backlog is in [IMPLEMENTATION-ROADMAP](../harness/IMPLEMENTATION-ROADMAP.md); this file is for things only the owner can supply.

## Owner has deferred ("will answer later", 2026-10-28)

| # | Item | Source | Blocks |
|---|---|---|---|
| T1 | Answer harness open questions Q1-Q13 | [OPEN-QUESTIONS](../harness/OPEN-QUESTIONS.md) | R1-R4, R9 |
| T2 | Answer stakeholder clarification items in the unresolved decision register (all `Open` entries). **Deferred by the owner on 2026-10-28.** Until answered, no design can be Approved: the gate blocks on every open M1 and M2 decision linked to an in-scope Must requirement | [DECISION-REGISTER](../context/DECISION-REGISTER.md) | Stage 2 design approval |
| T3 | Name the deciders for ADR acceptance, phase changes and each approval role (quality manager, commercial reviewer, data owner, compliance counsel) | Q3, D-007 | Any approval workflow |
| T4 | Confirm which standards and regulations are in scope, and nominate a qualified person to verify candidate citations | [CERTIFICATION-SCHEMES](../context/CERTIFICATION-SCHEMES.md), D-001, D-002 | Any compliance claim |
| T5 | Decide whether to move the repository out of the OneDrive-synced folder | Q1 | Repository reliability |
| T6 | Review the architecture-governance capability and the DES-0001 / RV-0001 example: hard constraints, perspectives, gate rules, question bank, risk register; approve or amend | [GOVERNANCE](../architecture/GOVERNANCE.md), [DESIGN-REVIEW-GATE](../architecture/DESIGN-REVIEW-GATE.md) | Using the gate for real designs |
| T7 | Approve pushing the newest commits (governance capability) to the private repo. The two baseline commits are already pushed | [STATE](STATE.md) | CI check of the governance work |
| T8 | Run or watch the remaining R1 checks in VS Code chat, the R11 context-loading test and the R12 review-role test | [IMPLEMENTATION-ROADMAP](../harness/IMPLEMENTATION-ROADMAP.md) | Trust in the guardrails, the context strategy and the review roles |

## Decisions made

| Date | Decision | Recorded in |
|---|---|---|
| 2026-10-28 | ADR 0001 and ADR 0002 accepted | [ADR 0001](../adr/0001-native-first-harness.md), [ADR 0002](../adr/0002-phase-gating-and-approval-enforcement.md) |
| 2026-10-28 | GitHub repo `polyfuze4336-bot/greenfuel-agent-harness`, private, owner is the authenticated `gh` account | [STATE](STATE.md) |
| 2026-10-28 | Roadmap item R1 (live-session verification) approved to run | [IMPLEMENTATION-ROADMAP](../harness/IMPLEMENTATION-ROADMAP.md) |
| 2026-10-28 | Requirements baseline v0.1 approved; the 37 decisions stay open and deferred | [ADR 0003](../adr/0003-adopt-requirements-baseline-v0-1.md) |
| 2026-10-28 | The two baseline commits pushed to the private repo; CI succeeded | [STATE](STATE.md) |
