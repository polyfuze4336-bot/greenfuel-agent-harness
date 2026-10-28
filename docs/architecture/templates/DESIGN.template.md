# DES-NNNN: <short title>

<!-- Template. Copy to docs/architecture/designs/DES-NNNN-<slug>.md, replace every <placeholder>, delete these comments.
     Table shapes are read by harness/scripts/design-gate.mjs. Do not add pipe characters inside cells.
     Do not state figures (cost, availability, latency, throughput, savings) unless a source is cited next to them.
     Do not describe any scheme, standard or regulation as binding or satisfied unless it is recorded as Verified. -->

- **Design ID:** DES-NNNN
- **Review:** RV-NNNN
- **ADRs:** ADR-NNNN
- **Tags:** <comma list from: DATA, EDGE, AGENT, CERT, CALC, OPS, INTEG, COST>
- **Scope capabilities:** <comma list of requirement caps tags: DEA, EAA, DRA, MBA, CCA, XC, EDG, SOV>
- **Extra requirements in scope:** <comma list of requirement IDs outside those tags, or none>

## 1. Decision question
<One paragraph: what is being decided, for whom, and why now. Name the business requirements (BR-nnn) it serves.>

## 2. Options

| Option | Name | Summary | Disposition |
|---|---|---|---|
| A | <do nothing or current approach> | <summary> | <Selected, Not selected, Rejected (hard constraint), or Deferred> |
| B | <name> | <summary> | <disposition> |
| C | <name> | <summary> | <disposition> |

Exactly one option is Selected. An option marked "Rejected (hard constraint)" must have a Violated verdict in the review record.

## 3. Alternatives comparison

Each cell starts with one of: Meets, Conditional, Does not meet, Unknown. Then a short reason. Unknown is allowed and honest.

| Criterion | A | B | C |
|---|---|---|---|
| <criterion> | <Meets: reason> | <Conditional: reason> | <Does not meet: reason> |

## 4. Requirement trace

One row for every requirement tagged with a scope capability, and every extra requirement. Status is one of: Addressed, Partial, Unresolved, Not applicable, Waived (ADR-nnnn). "Addressed" needs a design element and a validation plan or evidence. "Not applicable" needs a reason in "How addressed". A Must requirement that is Partial or Unresolved blocks approval.

| Requirement | Design element | How addressed | Status | Validation plan or evidence |
|---|---|---|---|---|
| <ID> | <component or rule> | <how> | <status> | <plan or evidence ID> |

## 5. Tradeoffs

| ID | We gain | We give up | Borne by | Reversible | Links |
|---|---|---|---|---|---|
| TD-001 | <gain> | <loss> | <role or party> | <Yes, Partly, or No, with reason> | <IDs> |

## 6. Assumptions and constraints

| ID | Assumption | If wrong | Validate by |
|---|---|---|---|
| DA-001 | <assumption> | <consequence> | <cheap test or decision> |

| ID | Constraint | Source |
|---|---|---|
| CN-001 | <constraint> | <HC, CS, D, or AS identifier> |

## 7. Risks

| Risk | Residual note |
|---|---|
| RK-nnn | <what remains after mitigation> |

## 8. Open decisions that affect this design
<List D-nnn identifiers and what each changes. The gate also derives blocking decisions from the requirement trace.>
