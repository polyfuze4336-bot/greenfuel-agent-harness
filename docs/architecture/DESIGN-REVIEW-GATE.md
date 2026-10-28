# Design Review Gate

Status: v0.1, 2026-10-28. The gate is how this repository stops a design from being marked Approved while it violates a hard constraint or leaves critical requirements unresolved. It is implemented in `harness/scripts/design-gate.mjs` and runs inside `npm run validate` and in CI.

## 1. What the gate does
It reads a design file (`DES-nnnn`) and its review record (`RV-nnnn`) and computes one of three results:

| Computed | Meaning | Statuses the review may declare |
|---|---|---|
| **Rejected** | A hard constraint is violated by the selected option, or a perspective has failed | Rejected only |
| **Blocked** | No rejection, but something critical is unresolved | Draft, In review, Blocked |
| **Approvable** | Nothing blocks. A human may now approve | Draft, In review, Blocked, Approved |

A review that declares a status more permissive than the computed result is a validation error, so the repository fails its checks. A reviewer may always declare a stricter status than computed.

## 2. Rules

### 2.1 Rejection (any one is enough)
| ID | Rule |
|---|---|
| RJ-1 | The selected option has a hard-constraint verdict of Violated |
| RJ-2 | Any of the ten perspectives has verdict Fail |

A hard constraint cannot be waived, and no tradeoff row can offset it.

### 2.2 Blocking (any one prevents approval)
| ID | Rule |
|---|---|
| BL-1 | A hard-constraint verdict for the selected option is Unresolved, or Conditional on a decision that is still Open |
| BL-2 | A perspective is Not assessed |
| BL-3 | A Must requirement in the design trace is Partial or Unresolved, after the reviewer's overrides (the worse of author and reviewer counts). Waived and Not applicable do not block |
| BL-4 | A baseline clarification or verification decision (kind C or D) with milestone M1 or M2 is Open and is listed against an in-scope Must requirement in the [traceability](../context/REQUIREMENTS-TRACEABILITY.md). A requirement cannot be called Addressed while the decision that defines it is unanswered |
| BL-5 | A critical defence question that applies to the design's tags is Unanswered or has no disposition |

### 2.3 Structure (errors; the review is invalid until fixed)
| ID | Rule |
|---|---|
| ST-1 | Design has at least three options, exactly one Selected, and a comparison table whose columns match the options and whose cells start with Meets, Conditional, Does not meet or Unknown |
| ST-2 | At least one tradeoff, assumption, constraint and linked risk; every referenced risk exists |
| ST-3 | The requirement trace has a row for every requirement tagged with a scope capability and for every extra requirement; statuses use the fixed vocabulary; Addressed has a design element and validation plan; Not applicable has a reason |
| ST-4 | The selected option has a verdict for every hard constraint; an option marked Rejected (hard constraint) has a Violated verdict, and an option with a Violated verdict is marked Rejected unless it is the selected one |
| ST-5 | All ten perspectives are present once; a Concern links an existing risk; anything other than Pass has findings |
| ST-6 | Every critical question that applies has a disposition; Answered needs a reference |
| ST-7 | Approved requires checkpoint CP4 and a named human decider written as "Name (role)"; model names, generic roles and placeholders are refused. The gate cannot prove the person is real or authorised |
| ST-8 | A waiver names an Accepted ADR and applies only to a class B requirement that is not tied to a hard constraint |
| ST-9 | Every requirement ID mentioned in the design, or listed under "Requirements addressed" in its ADR, has a trace row. A design cannot claim to serve a requirement it does not trace |
| ST-10 | Scope capabilities and Tags are non-empty and come from fixed vocabularies |
| ST-11 | A trace row cannot be Not applicable for a class A requirement or one tied to a hard constraint; any other Not applicable needs the reviewer's confirmation in the overrides table |
| ST-12 | A Satisfied hard-constraint verdict must cite a design element, decision, requirement or evidence ID; a Not applicable verdict needs a specific reason; every perspective verdict, including Pass, cites a reference |

### 2.4 Coupling with ADRs
A Design ADR cannot be Accepted unless its review is Approved. The ADR must name the review, and the design must list the ADR.

### 2.5 Decision status
A decision counts as decided only when the register says `Decided (ADR-nnnn)` and that ADR exists and is Accepted. `npm run validate` fails otherwise, and the gate treats anything else as Open.

### 2.6 Figures and claims lint
Files under `docs/architecture` and all ADRs are scanned line by line for monetary amounts, percentages, figures with units, availability claims and compliance claims. A figure fails validation unless its line carries "placeholder", "illustrative" or "source:". A compliance claim fails unless the line states a prohibition or marks the item as a candidate or unverified. This is a heuristic. It catches careless numbers, not a determined author, and it cannot tell whether a cited source is real.

## 3. What the gate does not do
An adversarial review of the gate on 2026-10-28 found the following routes, partly closed (rules ST-9 to ST-12, the decision-status rule and the stricter lint are the result) and partly open. Open ones are tracked as RK-014.
- It does not judge whether a reviewer's reason is true. A vacuous reason that cites an ID still passes.
- The author chooses scope capabilities and tags. Claims in the design and ADR must be traced, but a design that never mentions an affected requirement can omit it. The reviewer's hard-constraint screen and perspectives are the check.
- It does not check that a linked risk is relevant to a Concern, or that an Accepted ADR actually resolves the exact decision it is cited for.
- It cannot prove who the decider is, or that an approval was given. It does not stop a person editing a status; the edit simply fails validation unless the record supports it. Branch protection, required review and an approver registry belong to roadmap item R4; until then the human decider is the real control.
- A model wrote the example review. A model reviewer can share the author's blind spots (RK-012). Human review is required before approval.
- Approved means "proceed to implementation planning". It does not mean validated; only checkpoint CP5 evidence does that.

## 4. Commands
```
node harness/scripts/design-gate.mjs docs/architecture/reviews/RV-0001-delivery-measurement-storage-topology.md
node harness/scripts/design-gate.mjs <review> --select B     # what-if: evaluate a different option
node harness/scripts/design-gate.mjs --coverage              # requirements with no design trace row yet
```
Exit codes: 0 consistent; 1 invalid or inconsistent (including baseline errors). With `--select`: 0 Approvable, 2 Blocked or unscreened (the option needs a verdict for every hard constraint), 3 Rejected. Record runs that you rely on with the evidence recorder so the result is a fact, not a claim.

## 5. Worked example
[RV-0001](reviews/RV-0001-delivery-measurement-storage-topology.md) reviews [DES-0001](designs/DES-0001-delivery-measurement-storage-topology.md). The gate computes Blocked for the selected option, rejects the central-store option under HC-01, refuses to pass the unscreened federated option, and lists the open decisions, partial requirements, unassessed perspectives and unanswered questions that stand between the design and approval. An adversarial review of the example also led to adding the federated option and removing three overclaims.
