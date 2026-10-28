# RV-NNNN: Review of DES-NNNN

<!-- Template. Copy to docs/architecture/reviews/RV-NNNN-<slug>.md. Written by the reviewer, not the design's author.
     The declared status must be one the gate allows for the computed result (see DESIGN-REVIEW-GATE).
     Run: node harness/scripts/design-gate.mjs docs/architecture/reviews/RV-NNNN-<slug>.md -->

- **Review ID:** RV-NNNN
- **Design:** DES-NNNN
- **Checkpoint:** <CP1, CP2, CP3, CP4 or CP5>
- **Status:** <Draft, In review, Blocked, Rejected or Approved>
- **Reviewer:** <agent or person and role>
- **Decider:** <name and role of the human who decides at CP4, or pending>
- **Date:** <YYYY-MM-DD>

## 1. Hard-constraint screen

The selected option must have a row for every HC. Other options need rows only where a verdict justifies rejecting them. Verdicts: Satisfied, Conditional, Violated, Unresolved, Not applicable. Conditional needs decision IDs in the last column. Not applicable needs a reason.

| Option | Constraint | Verdict | Reason | Conditions |
|---|---|---|---|---|
| <A> | HC-01 | <verdict> | <reason tied to the design> | <D-nnn or none> |

## 2. Perspective verdicts

One row for each of PV-01 to PV-10. Verdicts: Pass, Concern, Fail, Not assessed. A Concern needs a linked risk. A Fail rejects the design.

| Perspective | Verdict | Findings | Reference | Linked risk |
|---|---|---|---|---|
| PV-01 | <verdict> | <findings> | <where in the design or evidence> | <RK-nnn or none> |

## 3. Requirement overrides

Where the reviewer disagrees with the author's status in the design's trace. The worse status counts.

| Requirement | Author status | Reviewer status | Reason |
|---|---|---|---|
| <ID> | <status> | <status> | <reason> |

## 4. Defence dispositions

One row for every critical question that applies to the design's tags. Dispositions: Answered (needs a reference), Unanswered (with the reason), Not applicable (with the reason).

| Question | Disposition | Answer or reason | Reference |
|---|---|---|---|
| DQ-nn-nn | <disposition> | <answer> | <ID or file> |

## 5. Gate result
<Which gate run, with evidence ID. Paste nothing here that was not produced by the run.>

## 6. Conditions to proceed
<What must change or be decided, and by whom, before the next checkpoint.>
