# Architecture Governance

Status: v0.1, 2026-10-28. How the harness judges a major design. The aim is a design that can be defended under questioning, with every claim traceable to a requirement, a decision or evidence, and a mechanical refusal to call a design approved when it should not be.

## 1. What counts as a major design
A decision that affects any hard constraint, any data placement, identity or key model, integration contract, hosting model, or the agent permission model. When in doubt, it is major. Minor choices need no design file but must not contradict an Accepted ADR.

## 2. Artefacts and where they live

| Need | Artefact | Location |
|---|---|---|
| Decisions | Architecture Decision Records, template v2 | [docs/adr/](../adr/) and [template](templates/ADR-DESIGN.template.md) |
| Requirements-to-design traceability | Requirement trace table in each design; coverage report | [templates/DESIGN.template.md](templates/DESIGN.template.md); `design-gate.mjs --coverage` |
| Assumptions and constraints | Tables in each design; baseline [ASSUMPTIONS](../context/ASSUMPTIONS.md) | Designs |
| Hard constraints | Twelve constraints no design may violate | [HARD-CONSTRAINTS](HARD-CONSTRAINTS.md) |
| Risks and mitigations | Qualitative risk register | [RISK-REGISTER](RISK-REGISTER.md) |
| Alternative comparison | Options and comparison tables in each design | Designs |
| Explicit tradeoffs | Tradeoff table in each design | Designs |
| Ten-perspective evaluation | Perspective definitions and per-review verdicts | [REVIEW-PERSPECTIVES](REVIEW-PERSPECTIVES.md); review records |
| Review checkpoints | CP1 to CP5 | [REVIEW-CHECKPOINTS](REVIEW-CHECKPOINTS.md) |
| Design-defence questions | Question bank with critical questions | [DEFENSE-QUESTION-BANK](DEFENSE-QUESTION-BANK.md) |
| Gate | Rules and script | [DESIGN-REVIEW-GATE](DESIGN-REVIEW-GATE.md) |
| Templates | Design, review record, ADR | [templates/](templates/) |

## 3. What every design ADR must contain
Each is a required section checked by `npm run validate` for Design-type ADRs.

| Required content | ADR section |
|---|---|
| Decision ID and status | ADR number in the file name; Status field |
| Requirement addressed | Requirements addressed |
| Hard constraints respected | Hard constraints |
| Alternatives considered (at least three) | Options considered |
| Why the selected option is appropriate | Why this option is appropriate |
| Reliability and security consequences | Reliability consequences; Security consequences |
| Residency implications | Residency implications |
| Cost and operational implications | Cost and operational implications |
| Reversibility | Reversibility |
| Validation evidence | Validation evidence |
| Review outcome | Review field and Review gate |

## 4. Roles

| Role | Does | Must not |
|---|---|---|
| `architect` agent | Authors designs, ADRs, trace and risk entries under `docs/` | Review or approve its own design |
| `design-reviewer` agent | Screens options against hard constraints, assesses ten perspectives, records the review, runs the gate | Edit designs, ADRs or requirements; approve |
| `design-challenger` agent | Adversarial pass: strongest attacks, untested assumptions, straw-man alternatives; returns findings | Edit anything |
| Human decider | Names themselves in the review, approves at CP4, sets ADR Accepted | Delegate approval to an agent |

Separation between author and reviewer is by convention and by git history today. Copilot cannot restrict an agent to a folder by configuration, and the hook cannot see which agent is acting. Branch protection with required review (roadmap R4) is the planned enforcement.

## 5. Lifecycle of a design
1. **CP1 Intake.** Author states the decision question and scope, and records which baseline decisions are open.
2. **CP2 Options.** At least three options; the reviewer screens each against the hard constraints. Violating options are rejected with reasons.
3. **CP3 Design and defence.** Author completes trace, tradeoffs, assumptions, constraints and risks. Reviewer assesses the ten perspectives and puts the critical questions. Challenger runs an adversarial pass.
4. **CP4 Approval.** The gate computes Approvable. A named human approves; the ADR becomes Accepted.
5. **CP5 Validation.** After implementation exists, evidence for the validation plans is recorded.

At any step the reviewer can reject on a hard-constraint violation or a failed perspective.

## 6. What native Copilot provides and what is custom
Native: agents, skills, instructions, subagents, approvals, memory, hooks. Custom, each justified in the [capability matrix](../harness/CAPABILITY-MATRIX.md): the gate and architecture checks (`design-gate.mjs`, `validate-architecture.mjs`), because no native feature computes a verdict from a design record, couples ADR acceptance to a review, or lints for fabricated figures.

## 7. Starting a new design
Copy [DESIGN.template.md](templates/DESIGN.template.md) and [REVIEW-RECORD.template.md](templates/REVIEW-RECORD.template.md) into `designs/` and `reviews/` with the next numbers. Use the `design-authoring` skill, then hand over to the `design-reviewer` with the `design-review` skill. Run `npm run validate`.
