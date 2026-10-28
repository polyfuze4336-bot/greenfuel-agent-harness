---
name: adr-authoring
description: Write or supersede an Architecture Decision Record in docs/adr. Use before any design choice that affects security, cost, data, identity, integration or the harness itself.
---
# ADR authoring

1. Find the next number: list `docs/adr/` and use the next four-digit id. Copy [the ADR template](../../../docs/architecture/templates/ADR-DESIGN.template.md) to `docs/adr/NNNN-short-title.md` and set `Type` to Design, Harness or Governance.
2. Fill every section for the type. A **Design** ADR must also document: requirements addressed, hard constraints, at least three options, why the selected option is appropriate, reliability and security consequences, residency implications, cost and operational implications, reversibility, validation evidence, and the review gate. Use the `design-authoring` skill and have the design reviewed first.
3. Mark each statement in Context as FACT (with source), ASSUMPTION or DECISION. Do not state figures or compliance claims without a cited source.
4. Set `Status: Proposed`. Only a human changes it to `Accepted`, and a Design ADR can be Accepted only when its review is Approved (`npm run validate` enforces this). To change an Accepted decision, write a new ADR and set `Supersedes: NNNN`; never edit an Accepted ADR's decision.
5. List what evidence would show the decision was wrong (**Revisit when**).
6. Add the ADR to the "Open approvals" list in `docs/state/STATE.md`.
