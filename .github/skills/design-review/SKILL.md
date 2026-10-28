---
name: design-review
description: Review a major architecture design independently through ten perspectives and the hard constraints, record the verdicts, and run the design-review gate. Use when a design (DES-nnnn) is ready for checkpoint CP2, CP3 or CP4 review, or when asked whether a design can be approved.
---
# Design review

You review work you did not write. You can reject. You cannot approve; only a named human can, at CP4.

1. Load context with the `context-loading` skill, then read [HARD-CONSTRAINTS](../../../docs/architecture/HARD-CONSTRAINTS.md), [REVIEW-PERSPECTIVES](../../../docs/architecture/REVIEW-PERSPECTIVES.md), [REVIEW-CHECKPOINTS](../../../docs/architecture/REVIEW-CHECKPOINTS.md) and [DESIGN-REVIEW-GATE](../../../docs/architecture/DESIGN-REVIEW-GATE.md).
2. Copy [REVIEW-RECORD.template.md](../../../docs/architecture/templates/REVIEW-RECORD.template.md) to `docs/architecture/reviews/RV-NNNN-<slug>.md`.
3. **Hard-constraint screen.** For the selected option, give a verdict and a reason for every HC. For other options, record verdicts that justify rejecting them. Violated means the "Reject when" test is met by the design as written. Use Unresolved rather than guessing. A region name is never proof of residency. An autonomy label is never a permission.
4. **Ten perspectives.** One verdict each. Use Not assessed when the evidence does not exist; never round up. A Concern needs a linked risk. A Fail rejects.
5. **Requirement overrides.** Where the author's status is too generous, record the stricter one with a reason.
6. **Defence.** Put every critical question that applies (use the `design-defense` skill). Answered needs a reference to something that exists.
7. **Challenge.** For a major decision, ask the `architecture-critic` for an adversarial pass and record what it found as perspective PV-10 findings or risks.
8. Set the status to the strictest honest value. Run `node harness/scripts/design-gate.mjs <review>`; the declared status must not be more permissive than the computed result. Record runs you rely on with the evidence recorder (`evidence-validation` skill).
9. Never set status Approved. Never name yourself as decider. If the gate computes Approvable, say so and ask for a human decision.

Reject when a hard constraint is violated or a perspective fails, and say which and why in plain words. Do not soften a rejection to keep a design alive; propose what would change the verdict instead.
