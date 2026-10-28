# ADR 0013: Evaluation findings, effective periods, timestamp rules and the unapproved design

- **Status:** Accepted (2026-10-28, programme owner, by instruction in chat: "decide the best and document it"; the decision is the architect's, made on the owner's instruction)
- **Type:** Governance
- **Date:** 2026-10-28
- **Deciders:** Programme owner (delegated to the architect for this decision)
- **Supersedes:** none

## Context
- FACT: The committed evaluation run reports three failing tests ([EVALUATION-REPORT](../evaluation/EVALUATION-REPORT.md)): `EVAL-PRC-ARC-001` (DES-0001 is not Approved), `EVAL-PRC-DAT-005` (a calculation using an emissions factor set whose validity ended before the delivery is accepted) and `EVAL-PRC-DAT-006` (a reading timed before its predecessor, or in the far future, is accepted; HC-08 is reported violated).
- FACT: The candidate contracts for methodology and lineage are test oracles ([specs README](../specs/README.md)), not decisions. They have no effective-period concept, and they check that a trusted time is a valid time and that sequence numbers rise, not that time is ordered or plausible.
- FACT: HC-05 requires calculations reproducible from the exact methodology version, and HC-08 requires evidence integrity and audit reconstruction. An outdated factor and a manipulated timestamp both break those without breaking any hash.
- ASSUMPTION: The scheme-specific validity periods, the permitted clock skew and the time source depend on the schemes and edge equipment, which are open decisions (D-001, D-002 and the edge platform). This ADR fixes the rule, not the values.

## Options considered
1. **Relax the failing tests until they pass.** Rejected: that hides a real gap.
2. **Fix the validators silently.** Rejected: the contracts encode design decisions that need a recorded decision, a fixture change and mutation tests.
3. **Decide the rules now, implement them as roadmap R16 with the tests unchanged, and leave the tests failing until the implementation lands (chosen).**

## Decision
Accepted. The best course is to decide the rules, keep the tests as they are, and implement under R16:

1. **Effective periods.** Every emissions methodology version and every reference-data item (factor set, default value table, conversion table) carries `effectiveFrom` and `effectiveTo` as UTC times. An open end is allowed only when `openEnded` is true and a person recorded why. A calculation is rejected unless the trusted time of the delivery it covers lies inside the effective period of the methodology version and of every reference-data item it uses. A change in a factor or a period is a new version with a new definition hash, never an edit in place. Which periods a scheme actually prescribes is for the maritime-domain agent and the verifier of D-002 to supply as cited values; the contract never supplies one.
2. **Timestamps.** Every raw record carries `trustedTime` with the identifier of its clock source, and `receivedAt`, the time the receiving component accepted it. Rules: within one source, `trustedTime` does not decrease as `sequence` increases; `trustedTime` is not later than `receivedAt` plus a declared maximum skew; a record that breaks either rule is quarantined as an evidence-integrity finding with both values kept, and is never corrected or dropped. The maximum skew is a required parameter with no default, to be set by the maritime-domain and edge design from the equipment's clock specification. An offline edge device stamps `receivedAt` from its own clock and records its last synchronisation, so a drifted clock is visible rather than trusted.
3. **DES-0001 stays Blocked.** The design review gate is correct to block it. G2 will not pass until the owner answers or defers the open decisions with named deciders (T2, T3). No test, gate or review status is changed to make it pass.
4. **Implementation.** Roadmap R16 implements points 1 and 2 in the candidate contracts, fixtures and mutation tests, and re-runs the evaluation. `EVAL-PRC-DAT-005` and `EVAL-PRC-DAT-006` keep failing until it lands. R16 comes before any sibling design that depends on lineage or methodology (R13) is submitted for review.
5. **Targets (T28).** The owner agreed that no response-time, volume, recovery, cost or budget figure is invented. The pending performance, operations, cost and recovery tests stay pending until a requirement supplies a sourced target. Each must come from a stakeholder or a cited document.

## Consequences
- The two contract gaps are decisions with a recorded rule and an owner, not open questions, and the evaluation keeps showing them until fixed.
- G3 cannot pass before R16. That is intended.
- The contracts gain required fields (`effectiveFrom`, `effectiveTo`, `receivedAt`, clock source, maximum skew), which changes the fixtures and the schema version of the candidate contracts.
- No figure is chosen here: the skew and the periods are parameters.

## Reversibility
High. This ADR sets rules for test oracles. Reversing it means superseding the ADR and changing the oracles.

## Revisit when
The schemes are verified (D-002); the edge platform and its clock source are chosen; a verifier gives scheme periods; the owner asks to implement R16.

## Evidence
The failing tests and their evidence files in the committed run show the gaps. No code changed in this decision. Implementation evidence will be a new committed run in which `EVAL-PRC-DAT-005` and `EVAL-PRC-DAT-006` pass beside unchanged tests.
