# ADR 0003: Adopt requirements baseline v0.1 as the design input

- **Status:** Accepted (2026-10-28, programme owner, by instruction in chat)
- **Type:** Governance
- **Date:** 2026-10-28
- **Deciders:** Programme owner
- **Supersedes:** none

## Context
- FACT: Requirements baseline v0.1 exists in [docs/context/](../context/): 99 requirements, 37 open decisions, candidate standards, data classification, sovereignty and autonomy matrices, assumptions and a context-loading strategy. An independent model review found problems that were fixed before this decision.
- FACT: The owner approved the baseline and deferred answering the 17 M1 decisions on 2026-10-28.
- ASSUMPTION: Stakeholders beyond the owner have not reviewed the baseline.
- DECISION: A baseline is needed so designs can trace to requirements, even though some definitions are still open.

## Options considered
1. **Withhold approval until the M1 decisions are answered.** Cleaner, but blocks all design work and the review process itself.
2. **Approve the baseline with its decisions open (chosen).** Design work can start; the gate treats open decisions as blockers for approval.
3. **Approve only the case-study statements (class A).** Smaller, but leaves designs without the derived controls they must trace to.

## Decision
Baseline v0.1 is the approved input for design work. The 37 decisions stay open and deferred by the owner. The class labels, placeholders and candidate standards in it keep their stated status.

## Consequences
- Designs can be written and reviewed against the baseline now.
- No design can be Approved while an M1 or M2 decision linked to its in-scope Must requirements is Open. Such designs are exploratory and end at Blocked. This is enforced by the design-review gate.
- Changes to the baseline go through the `baseline-maintenance` context profile and `npm run validate`.

## Revisit when
The owner answers the M1 decisions, a stakeholder review contradicts a class A or B label, or a candidate standard is verified or discarded.

## Evidence
`EV-0004` and `EV-0005` show the baseline is internally consistent on the baseline commit. They do not show the content is correct.
