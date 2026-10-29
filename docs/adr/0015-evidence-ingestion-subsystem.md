# ADR 0015: Jurisdiction-local, tamper-evident evidence ingestion by an edge hash-chained log with store-and-forward

- **Status:** Proposed
- **Type:** Design
- **Date:** 2026-10-29
- **Deciders:** Design approver (not yet named, T3), with the quality manager and the security architect
- **Supersedes:** none
- **Review:** RV-0002

## Context
- FACT: DES-0001 places the authoritative store for delivery measurements in the originating jurisdiction (its option C). It does not say how events reach the store ([DES-0001](../architecture/designs/DES-0001-delivery-measurement-storage-topology.md)).
- FACT: Edge-to-shore connectivity can be intermittent and evidence integrity, dispute resolution and audit reconstruction must hold (the case study; HC-07, HC-08).
- FACT: [ADR 0013](./0013-evaluation-findings-effective-periods-and-timestamps.md) decided the timestamp rule (ordered within a source and not later than the receiving clock plus a declared skew, with the skew a parameter with no default). The lineage contract does not yet apply it (`EVAL-PRC-DAT-006`, roadmap R16).
- FACT: The tamper-evidence mechanism and key custody (D-013), the edge platform (D-018), meter interfaces (D-019), the maximum disconnection (D-020) and the trusted time source (D-021) are open decisions.
- FACT: Phase 0 allows no application and no resource ([ADR 0002](./0002-phase-gating-and-approval-enforcement.md)); a candidate contract with synthetic fixtures is allowed.
- DECISION (by the owner's acceptance request): the acceptance review must exercise the harness on this design question end to end, without provisioning anything.
- ASSUMPTION: DA-001 to DA-005 in the design.

## Requirements addressed
- BR-007: capture and local verification never wait for shore.
- BR-002: gives the evidence package intact, ordered inputs.
- BR-006: ingestion never crosses a jurisdiction by construction.
- FR-001: a reading is an event with device identity, trusted time and sequence.
- FR-002: a blend entry is an event with a recorded origin.
- FR-006: offline capture and later reconciliation without altering the evidence.
- SEC-001: the edge buffer and the cell are zones Z1 and Z2.
- SEC-002: not addressed here; named as an open dependency.
- SEC-008: the store takes events once, in order, and refuses conflicting replays.
- SEC-012: payloads are data, never instruction.
- SEC-013: not addressed here; a sibling design.
- DATA-001: raw measurement events are zone Z1 and Z2 only.
- DATA-002: raw events keep source, trusted time and sequence, and gaps and reordering are detectable.
- AGT-003: a model cannot originate an event and a missing reading is reported, never estimated.
- AGT-010: ingestion is deterministic with no model.
- NFR-001: modification, deletion, reordering and replay are detected.
- NFR-004: the edge buffer carries capture for the period D-020 will set.
- NFR-005: ordered, idempotent, gap-reporting synchronisation.
- NFR-006: capture is local and asynchronous.
- NFR-009: not addressed here; named as an open dependency.
- NFR-017: the clock source and skew rule.

## Hard constraints
Verdicts come from the review [RV-0002](../architecture/reviews/RV-0002-evidence-ingestion-subsystem.md), which is the source of truth. Summary: HC-01, HC-06, HC-07, HC-08 and HC-09 are conditional on open decisions; HC-10, HC-11 and HC-12 are satisfied; HC-02 to HC-05 are outside this design. The online-only option violates HC-07.

## Options considered
1. **Online-only ingestion.** The edge sends each event live with no durable local log. Simplest to run. Rejected: an outage loses events, which violates HC-07 (connectivity may be intermittent) and breaks BR-007.
2. **Edge hash-chained log with store-and-forward (selected).** Each event carries a per-source sequence, a trusted time and the previous event's hash. The cell verifies the chain, takes events once and in order, holds a batch with a gap, ignores an identical repeat and refuses a conflicting repeat. Costs an edge component and a verifier per jurisdiction.
3. **Managed ledger as the system of record.** Integrity from a ledger service; the edge keeps a plain queue. Deferred: events at the edge are unprotected until the ledger write, a ledger service is unverified in any jurisdiction, and D-013 is open.
4. **Post-delivery file export.** Operator exports the meter log and uploads it. Not selected: no chain at source, no sequence, and a file can change between export and upload (HC-08).

## Decision
Select option 2 as the design direction. It is **Proposed**, not Accepted: the review computes Blocked, and a Design ADR cannot be Accepted unless its review is Approved. The chain format and the reference behaviour are captured as a candidate contract (`greenfuel.ingestion-batch/v0-candidate`) in [ingestion-contract.mjs](../../harness/contracts/ingestion-contract.mjs), used as an acceptance oracle and not as a decision on the signing mechanism.

## Why this option is appropriate
- It is the only option that keeps capturing with no shore link (HC-07, BR-007, NFR-004) and gives tamper evidence from the first event rather than from a later write (HC-08, SEC-008, NFR-001, DATA-002).
- It keeps every copy inside zones Z1 and Z2 by construction, so ingestion cannot be the flow that breaches residency (HC-01, BR-006, SEC-001), without deciding what residency means (D-009).
- It puts no model on the path (AGT-010) and refuses a model origin and any estimated reading (HC-06, AGT-003).
- Option 1 loses to HC-07. Option 3 loses on protection at the edge and on unverified availability. Option 4 loses on HC-08.

## Consequences
- An edge component and a cell verifier must be built and operated in every jurisdiction.
- Shore visibility of a batch can be delayed while an earlier batch is missing (TD-002).
- A verified batch means intact and consistent. It does not mean trusted: authenticity waits for D-013.
- The format is a data format: the store behind it, and the signing, can change.

## Reliability consequences
Removes the loss of events during an outage. Introduces hold, gap and conflict states that need operator handling and a runbook that does not exist. The tolerated disconnection and buffer behaviour at the limit are unknown (D-020), so loss at the limit is not excluded. No figure is stated.

## Security consequences
Detects alteration, removal, reordering, replay and timestamp manipulation of events. Does not authenticate the producer; edge device compromise, key custody and administration are not designed here (SEC-013, SEC-002, RK-007, RK-008). Payloads are data, and nothing in ingestion executes or interprets them.

## Residency implications
Delivery measurement events live in zones Z1 and Z2 only; the contract refuses a source, destination or zone outside the jurisdiction. Not decided: what residency means for storage, processing, metadata, backup and telemetry (D-009); which flows are approved (D-011); the hosting model per port (D-010). The edge buffer is treated as part of the jurisdiction (DA-005); if it is not, ingestion itself crosses a border.

## Cost and operational implications
Cost drivers: an edge component per port, a verifier and store per jurisdiction, and the operator effort for hold and conflict handling. No amount is stated and none is estimated. Operated in the jurisdiction (D-033, undecided).

## Reversibility
High for the format and the store behind it, because the chain is a data format. Lower for deployed edge software, which is per port. The cheapest point to change course is before the edge platform is chosen (D-018).

## Validation evidence
Contract tests and three evaluation tests on synthetic fixtures: `tests/ingestion-contract.test.mjs`, `EVAL-PRC-DAT-007`, `EVAL-PRC-DAT-008`, `EVAL-PRC-SOV-004`, recorded in the committed evaluation run and the evidence index. They show the candidate contract handles the cases in the design. They show nothing about a production component, which does not exist, and nothing about authenticity.

## Review gate
[RV-0002](../architecture/reviews/RV-0002-evidence-ingestion-subsystem.md) reviews DES-0002. The gate computes Blocked: hard constraints are conditional on open decisions, perspectives are not assessed, and Must requirements are Partial or Unresolved. An independent model review challenged the design and the contract; its findings and the fixes are recorded in the review. No human has reviewed it.

## Revisit when
D-013, D-018, D-019, D-020 or D-021 is decided; the edge platform cannot run an append-only log; a legal reading of residency says the edge buffer is not part of the jurisdiction; a scheme requires a different evidence format; or the signing mechanism changes what a batch must contain.

## Evidence
See [DES-0002](../architecture/designs/DES-0002-evidence-ingestion-subsystem.md), [RV-0002](../architecture/reviews/RV-0002-evidence-ingestion-subsystem.md), the contract tests, and the [test and evidence index](../acceptance/TEST-EVIDENCE-INDEX.md). The review and the independent challenge were performed by language models; independent human review has not been done.
