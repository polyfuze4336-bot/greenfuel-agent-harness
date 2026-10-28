# ADR 0004: Hold delivery measurements in jurisdiction-local authoritative stores

- **Status:** Proposed
- **Type:** Design
- **Date:** 2026-10-28
- **Deciders:** Programme owner and enterprise architect (roles; named humans pending)
- **Supersedes:** none
- **Review:** RV-0001

This ADR is the worked example of the governance process. It stays Proposed. The gate computes Blocked for the design, so it cannot be Accepted.

## Context
- FACT: CS-C1 requires delivery measurement data to remain within its originating port jurisdiction. CS-P4 forbids assuming that an Azure region satisfies this.
- FACT: CS-C7 states that edge-to-shore connectivity can be intermittent.
- ASSUMPTION: More than one port jurisdiction is in scope (AS-003, D-003), and the edge is inside the originating jurisdiction (AS-005).
- FACT: The meaning of residency per port (D-009), the hosting model and its existence per port (D-010), and the approved cross-border derived flows (D-011) are undecided.
- DECISION NEEDED: where raw readings, blend data and evidence packages are persisted.

## Requirements addressed
- BR-002: a complete, verifiable evidence package needs a defined place for its raw inputs. Completeness and reconstruction remain open (Partial).
- BR-006: delivery measurement data stays in its originating jurisdiction.
- BR-007: capture continues without live shore connectivity.
- SEC-001, SEC-004: placement and flow rules for bound data.
- FR-001, FR-006, NFR-005: ingestion and synchronisation at the edge.
- NFR-016: each port operates independently.

## Hard constraints
HC-01 (residency): option C is Conditional on D-009, D-010 and D-011; option B is Violated. HC-07 (intermittent connectivity): Conditional on D-020 and D-018. HC-08 (integrity): Conditional on D-013. HC-06, HC-09: Conditional on D-019 and D-027. HC-10, HC-11, HC-12: Satisfied. HC-02 to HC-05: not applicable to this design. See RV-0001 section 1.

## Options considered
1. **A. Do nothing.** Leave measurements in existing port systems. Trade-offs: no shared evidence binding; current systems unknown. Not selected.
2. **B. Single central store.** One group store serving ports in several jurisdictions. Simplest to operate and query. Violates HC-01 whenever more than one jurisdiction is in scope. Rejected (hard constraint).
3. **C. Jurisdiction-local authoritative stores (selected).** One authoritative copy of raw and evidence-grade data in the originating jurisdiction; edge buffers locally; derived data crosses only on approved flows. Trade-offs: one deployment per jurisdiction and reduced group visibility.
4. **D. Edge-only retention.** Sovereign data held only on edge devices. Not selected: durability and audit access undesigned (HC-08 unresolved).
5. **E. Federated local data planes with a shared control plane.** As C plus central policy and non-sensitive metadata. Deferred: what metadata and telemetry may cross is undecided (D-011). It may prove better than C once that is known.

## Decision
Select option C as the proposed baseline topology. Nothing crosses a border by default. The hosting model per port is deliberately not chosen. Option E stays open for comparison after D-011.

## Why this option is appropriate
Among the options evaluated, it is the one that can satisfy CS-C1 when several jurisdictions are involved while remaining fully specified today: option B cannot satisfy it, option D leaves integrity undesigned, and option E depends on a decision (D-011) that does not exist yet. It keeps capture independent of shore (CS-C7) and keeps each port operable on its own (NFR-016). The comparison and its reasons are in DES-0001 section 4. The claim is limited to the five options considered; it is not a proof that no other topology exists.

## Consequences
- Positive: an intended residency-preserving topology, conditional on D-003, D-009, D-010 and D-011; ports are independent; recovery can stay in the jurisdiction.
- Negative: operating one deployment per jurisdiction; group views limited to approved derived data; methodology and reference data versions must be distributed and governed across ports.
- New obligations: a per-port flow inventory, an approved derived-flow list, and sibling designs for certificate hosting, edge security, identity, retention, non-production environments, package completeness and recovery.

## Reliability consequences
Failure domains become per port, so one port's failure does not stop another. Edge queues and ordered synchronisation absorb link loss. Recovery must stay inside the jurisdiction, which limits resilience compared with multi-country copies (RK-013). Two recoveries are not yet designed. No availability or performance claim is made because no target exists (D-031).

## Security consequences
The authoritative store must be append-only and tamper-evident, with the mechanism and key custody still undecided (D-013). Agents hold read-only permission and no ingestion permission; the permission model is undecided (D-027). Administration from outside the jurisdiction is denied by default (SEC-002). Edge device security is a separate design (SEC-013).

## Residency implications
Raw readings, blend data and evidence packages have one authoritative copy in the originating jurisdiction (zones Z1 and Z2). The edge buffer is a persisted copy and is governed by the same rules; it is assumed to be inside the jurisdiction (DA-005). Backups, replicas, logs and telemetry holding them stay there. Derived data crosses only on the approved list from D-011. Readers, including AI, run in the same jurisdiction (SEC-003, D-028). Whether this satisfies each port's law depends on D-009 and is unverified.

## Cost and operational implications
Cost drivers: one deployment and operating arrangement per jurisdiction, edge hardware, local hosting, and licences for reference data. No amount is stated because no cost data exists. Operations are per port and in-jurisdiction (D-033). Costs must be attributable per port (NFR-019).

## Reversibility
Partly reversible. Adding a central tier later is possible only on an approved flow (D-011). Reversing option B would not be possible after the fact, because data already held abroad has already breached the constraint. The cheapest point to change course is before any port deployment exists.

## Validation evidence
None yet. The design is unvalidated. Planned validation is listed per requirement in DES-0001 section 5. The gate results are recorded in EV-0007 to EV-0010.

## Review gate
Review RV-0001 at checkpoint CP3, status Blocked. The gate computes Blocked because of open decisions, partial Must requirements, four perspectives not assessed and six critical questions unanswered. This ADR cannot be Accepted until a later review of this design is Approved.

## Revisit when
D-003 shows a single jurisdiction (option B does not exist as defined); D-009 or D-011 permit more to cross borders than assumed, which may favour option E; a verified hosting fact removes option C for a port; or the cost of per-port operation is found to outweigh the residency benefit.

## Evidence
RV-0001, DES-0001, and the gate runs EV-0007 to EV-0010. No performance, availability or cost evidence exists.
