# 05 Quality attributes: recovery, performance and capacity assumptions

Status: proposed, Phase 0. **Every number on this page is a placeholder for discussion (marked PH), not a target, a commitment or a measurement.** No availability, recovery-point, recovery-time or latency target exists in the case study (D-031), no volume exists (D-032), and HC-12 forbids presenting a placeholder as a target. The placeholders exist so that the design can be tested for *shape*: does the design have a mechanism that could meet a number of this kind, and does anything in it make a number of this kind impossible? The business owners set the real values.

## 1. Recovery assumptions

Definitions: **RPO** is how much accepted data may be lost; **RTO** is how long a capability may be unavailable. Evidence data is held to a stricter standard than convenience features.

| Ref | Capability | RPO placeholder | RTO placeholder | Mechanism that could meet it | What would make it impossible |
|---|---|---|---|---|---|
| PH-R1 | Edge capture | PH: zero for events the edge has acknowledged to the capture side | PH: a spare unit swapped on site within one working shift | Durable local write before acknowledgement; a second unit or a paper fallback flagged in the record | A single unit with volatile storage; no spare; no trusted clock after power loss (D-018, D-021) |
| PH-R2 | Cell evidence store and ledger, inside one site | PH: zero for committed writes | PH: hours | Zone-redundant storage and database standby inside the jurisdiction (to be verified per region) | A region with no availability zones; a local host with one machine |
| PH-R3 | Cell evidence store and ledger, site loss | PH: minutes of data | PH: one to two days | Second site in the **same jurisdiction**, or a verified in-jurisdiction region pair; asynchronous replication that never crosses the border | No second site or pair in the jurisdiction (RK-013): then the recovery objective for that port is weaker and must be accepted explicitly by the sponsor and compliance |
| PH-R4 | Certificate issuance | PH: zero for issued certificates and approvals | PH: one working day | Same as R2 and R3 plus key custody recovery | Signing keys recoverable only outside the jurisdiction (HC-03) |
| PH-R5 | Verification of an already issued certificate | n/a | PH: no dependence on the cell | Offline verification bundle with public material only | A verifier that calls a service outside the location fixed by D-012 |
| PH-R6 | Key custody | PH: zero loss of key material | PH: one working day | Hardware-backed custody with in-jurisdiction backup and split knowledge (D-013) | Custody mechanism that replicates keys outside the jurisdiction, or no backup (RK-007) |
| PH-R7 | Agent features | PH: not applicable (no authoritative data) | PH: days | Deterministic core continues; fall back to templates and humans | An agent on the critical path of any deterministic function (forbidden) |
| PH-R8 | Audit reconstruction | PH: zero | PH: days | Rebuild from the append-only store and chain; reconstruction is a read | Evidence that is not append-only (HC-08) |
| PH-R9 | Group coordination plane | PH: configuration only | PH: days to a week | Cells run on cached verified versions | A cell that cannot start without the plane |

**Offline period.** The case says connectivity can be intermittent (CS-C7). The requirement baseline carries a **placeholder of 72 hours** (AS-017, NFR-004). The design must keep capture working for any disconnection the edge buffer can hold and must report overflow rather than drop data; buffer sizing needs D-020 and D-032.

**Disaster-recovery rule.** A recovery copy, restore target or failover location for jurisdiction-bound data is itself a place the data lives. It must be in the jurisdiction (SEC-001). For a port whose jurisdiction has no suitable second location, the choice is a documented weaker recovery objective, not a cross-border copy.

## 2. Performance assumptions

Latency matters for people and for sync; it does not drive the architecture. All values below are PH.

| Ref | Interaction | Placeholder shape | Notes |
|---|---|---|---|
| PH-P1 | Edge capture acknowledgement | Immediate local write; never waits on shore | HC-07; no shore call on the capture path |
| PH-P2 | Edge to cell synchronisation after reconnect | Catch up an offline period in minutes, in order | Bounded by link, batch size and verification work |
| PH-P3 | Package completeness status after the last event | Seconds to minutes | Computed, deterministic |
| PH-P4 | Calculation after a request | Seconds | Deterministic code on small inputs |
| PH-P5 | Approval to issued certificate | Seconds after the approval is recorded | The approval queue, not compute, sets turnaround; the model's turnaround input is bounded by it |
| PH-P6 | Customer answer | Seconds to a short wait | Includes inference where available; falls back to templates |
| PH-P7 | Reconstruction of a certificate chain | Interactive for one certificate | One cell query |

## 3. Capacity assumptions

The arithmetic below uses the **scenario** volumes in the [business value model](../business/BUSINESS-VALUE-MODEL.md) (base: group-wide deliveries per year and a number of jurisdictions, both scenario assumptions) and placeholders for the rest. Its purpose is to show the order of magnitude.

| Ref | Quantity | Placeholder or derivation | Result (scenario arithmetic) |
|---|---|---|---|
| PH-C1 | Deliveries per cell per year | Base scenario deliveries divided by jurisdictions | Low hundreds, so on average a fraction of one delivery a day |
| PH-C2 | Peak concurrent deliveries per port | PH: a handful | Single digits |
| PH-C3 | Meters per delivery and reading rate | PH: two meters, one reading per second, a few hours | Tens of thousands of readings per delivery |
| PH-C4 | Ingestion rate at peak | PH-C2 times meters times rate | A handful of events per second per port |
| PH-C5 | Raw data per delivery | Readings at a few hundred bytes each | Single-digit megabytes; documents and packages raise it (the model uses a larger scenario allowance) |
| PH-C6 | Customer questions | PH: tens per day per cell | Trivial |
| PH-C7 | Model tokens | Scenario allowance per cell per year (model input) | Thousands of dollars or less in the scenarios, negligible against fixed costs |

**What the arithmetic says.** The workload is small. Throughput and storage are not the design drivers; **integrity, sovereignty, availability of the evidence and operations are**. This has three consequences:

1. **Fixed cost dominates.** Each cell carries key custody, a standby database, messaging, monitoring and people whatever the volume. That is why the model's cost is driven by the number of jurisdictions and by operations effort, not by volume, and why "scale-to-zero" savings are small. Fewer jurisdictions (if counsel allows) is the strongest cost lever (RK-003).
2. **Over-engineering for scale is a risk.** A design that adds a streaming platform, a data lake or a multi-region active-active scheme for a few events a second is carrying cost and attack surface that no requirement asks for.
3. **The volume could be wrong by an order of magnitude.** If the group's real throughput is far larger (many ports, high-frequency meters, many documents), storage and ingestion remain small relative to modern platforms, but the business-case volume drivers change materially. D-032 must supply the figures, and capacity tests need an agreed load model.

## 4. Scalability model

| Growth | Response | Limit |
|---|---|---|
| More deliveries in a jurisdiction | Scale services within the cell; storage grows linearly | Quota per subscription and region may bind first in a jurisdiction with few regions (checked per deployment) |
| A new port in an existing jurisdiction | Onboard edge units and sources into the existing cell | Marginal |
| A new jurisdiction | Stand up a new cell from the same definition and onboard it | Legal review, hosting decision and fixed cost per cell; this is the expensive step |
| More customers | Per-shipowner partitions; compute per partition scales with questions | Isolation tests grow with customer count; partition-per-customer cost needs D-005, D-015 |

## 4a. Validation plan for these assumptions

None of these assumptions is validated. They become evidence only through: (1) values supplied by D-031 and D-032; (2) an edge simulator for disconnection and reordering; (3) load and soak tests in a non-production cell with synthetic data; (4) failure-injection tests for each failure domain in [03](03-ARCHITECTURE-VIEWS.md); (5) a recovery exercise per cell that restores from backup **inside the jurisdiction** and proves nothing left it. None can run until the phase is raised and an environment exists.
