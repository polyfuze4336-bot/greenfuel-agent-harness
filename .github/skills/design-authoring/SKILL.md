---
name: design-authoring
description: Author a major architecture design (DES-nnnn) with requirement trace, options, alternatives comparison, tradeoffs, assumptions, constraints and risks, ready for independent review. Use when a decision touches data placement, hosting, identity, keys, integration, agent permissions or any hard constraint.
---
# Design authoring

You write the design. You do **not** review or approve it.

1. Load context with the `context-loading` skill. Read [HARD-CONSTRAINTS](../../../docs/architecture/HARD-CONSTRAINTS.md) and [GOVERNANCE](../../../docs/architecture/GOVERNANCE.md).
2. Copy [DESIGN.template.md](../../../docs/architecture/templates/DESIGN.template.md) to `docs/architecture/designs/DES-NNNN-<slug>.md` using the next number. Reserve the review and ADR numbers named in the header.
3. State the decision question and the business requirements it serves. Set Tags (for defence questions) and Scope capabilities (for the requirement trace).
4. List at least three real options, including do-nothing or the current approach. Do not write a straw man. Mark exactly one Selected.
5. Fill the alternatives comparison. Every cell starts with Meets, Conditional, Does not meet or Unknown. Use Unknown when you do not know; never guess.
6. Fill the requirement trace for every requirement in scope. Be honest: if an open decision defines the requirement, it is Partial or Unresolved, not Addressed. A validation plan is a plan, not evidence.
7. Record tradeoffs (who gains, who loses, whether reversible), assumptions (what breaks if wrong, how to test), constraints, and the risks you rely on. Add new risks to the [RISK-REGISTER](../../../docs/architecture/RISK-REGISTER.md) with qualitative values only.
8. Draft the ADR from [ADR-DESIGN.template.md](../../../docs/architecture/templates/ADR-DESIGN.template.md) with status Proposed.
9. Run `npm run validate`. Hand over to the `design-reviewer`. Do not edit the review record.

Never write figures for cost, availability, latency, throughput, capacity or savings unless you cite a source next to them. Never state that a standard, scheme or regulation applies or is satisfied unless it is recorded as Verified. Never name an Azure region, service or resource as available unless a verified source and date are cited. If you do not know, write Unknown and say which decision would answer it.
