---
name: adr-authoring
description: Write or supersede an Architecture Decision Record in docs/adr. Use before any design choice that affects security, cost, data, identity, integration or the harness itself.
---
# ADR authoring

1. Find the next number: list `docs/adr/` and use the next four-digit id. Copy [the template](../../../docs/adr/0000-template.md) to `docs/adr/NNNN-short-title.md`.
2. Fill every section. The **Options considered** section needs at least two real options plus "do nothing" where that is viable. Each option states its trade-offs.
3. Mark each statement in Context as FACT (with source), ASSUMPTION or DECISION.
4. Set `Status: Proposed`. Only a human changes it to `Accepted`. To change an Accepted decision, write a new ADR and set `Supersedes: NNNN`; never edit an Accepted ADR's decision.
5. List what evidence would show the decision was wrong (**Revisit when**).
6. Add the ADR to the "Open approvals" list in `docs/state/STATE.md`.
