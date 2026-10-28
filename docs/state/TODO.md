# TODO

Owner-facing list of pending answers and approvals. Items are removed only when answered and reflected in an ADR or the relevant document. The engineering backlog is in [IMPLEMENTATION-ROADMAP](../harness/IMPLEMENTATION-ROADMAP.md); this file is for things only the owner can supply.

## Owner has deferred ("will answer later", 2026-10-28)

| # | Item | Source | Blocks |
|---|---|---|---|
| T1 | Answer harness open questions Q1-Q13 | [OPEN-QUESTIONS](../harness/OPEN-QUESTIONS.md) | R1-R4, R9 |
| T2 | Answer stakeholder clarification items in the unresolved decision register (all `Open` entries) | [DECISION-REGISTER](../context/DECISION-REGISTER.md) | Stage 2 design |
| T3 | Name the deciders for ADR acceptance, phase changes and each approval role (quality manager, commercial reviewer, data owner, compliance counsel) | Q3, D-007 | Any approval workflow |
| T4 | Confirm which standards and regulations are in scope, and nominate a qualified person to verify candidate citations | [CERTIFICATION-SCHEMES](../context/CERTIFICATION-SCHEMES.md), D-001, D-002 | Any compliance claim |
| T5 | Decide whether to move the repository out of the OneDrive-synced folder | Q1 | Repository reliability |
| T6 | Review requirements baseline v0.1: the A and B class labels, the placeholder NFR numbers, the proposed autonomy ceilings and the data-classification scheme; approve or amend | [REQUIREMENTS](../context/REQUIREMENTS.md), [NON-FUNCTIONAL-REQUIREMENTS](../context/NON-FUNCTIONAL-REQUIREMENTS.md) | Stage 2 options analysis |
| T7 | Approve pushing the commits after `fca906d` to the private repo (nothing after the Stage 0 history has been pushed) | [STATE](STATE.md) | CI check of the baseline |
| T8 | Run or watch the remaining R1 checks in VS Code chat, and R11 context-loading test | [IMPLEMENTATION-ROADMAP](../harness/IMPLEMENTATION-ROADMAP.md) | Trust in the guardrails and in the context strategy |

## Decisions made

| Date | Decision | Recorded in |
|---|---|---|
| 2026-10-28 | ADR 0001 and ADR 0002 accepted | [ADR 0001](../adr/0001-native-first-harness.md), [ADR 0002](../adr/0002-phase-gating-and-approval-enforcement.md) |
| 2026-10-28 | GitHub repo `polyfuze4336-bot/greenfuel-agent-harness`, private, owner is the authenticated `gh` account | [STATE](STATE.md) |
| 2026-10-28 | Roadmap item R1 (live-session verification) approved to run | [IMPLEMENTATION-ROADMAP](../harness/IMPLEMENTATION-ROADMAP.md) |
