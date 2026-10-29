# ADR 0016: Sovereign evidence cells per jurisdiction with federated coordination

- **Status:** Proposed
- **Type:** Design
- **Date:** 2026-10-29
- **Deciders:** Design approver (not yet named, T3), with the quality manager, the compliance lead and the security architect
- **Supersedes:** none
- **Review:** RV-0003

## Context
- FACT: Delivery measurement data must stay within its originating port jurisdiction, and choosing an Azure region is not proof of that (CS-C1, CS-P4; HC-01).
- FACT: Customer compliance data is isolated per shipowner (CS-C2; HC-02). Certificates are tamper-evident and locally hosted (CS-C3; HC-03). Edge-to-shore connectivity can be intermittent (CS-C7; HC-07). The architecture must support evidence integrity, dispute resolution and audit reconstruction (CS-C8; HC-08).
- FACT: [DES-0001](../architecture/designs/DES-0001-delivery-measurement-storage-topology.md) proposes jurisdiction-local authoritative stores for measurements and leaves a shared control plane (its option E) deferred; [ADR 0004](./0004-delivery-measurement-storage-topology.md) is Proposed and its review is Blocked. This ADR is the system-level decision that contains that sub-decision and does not accept it.
- ASSUMPTION: The group operates in more than one port jurisdiction (AS-003, DA-001 in DES-0003). If only one jurisdiction is in scope, option A below becomes eligible.
- ASSUMPTION: The edge is inside the originating jurisdiction (AS-005). A group view of the whole business is wanted, but only from data classes on an approved flow (D-011).
- FACT: Ports, jurisdictions, the legal meaning of residency, the hosting model per port, the approved derived flows, key custody and the availability targets are open (D-003, D-009, D-010, D-011, D-013, D-031).

## Requirements addressed
- BR-006: operating in several jurisdictions with measurement data staying in its originating jurisdiction is what a cell per jurisdiction provides.
- BR-007: capture at the edge never depends on shore; the cell is where data lands when the link returns.
- SEC-001: every store, replica, backup, log stream and processing step for a jurisdiction's data lives in that jurisdiction's cell.
- SEC-002: administration of a cell is from inside its jurisdiction by default; break-glass is inside.
- SEC-003: inference over delivery data runs only in the cell, or not at all.
- SEC-004: the group plane receives only classes on an approved list; the default list is empty.
- NFR-009: a cell has one defined placement, so residency drift is detectable against one expectation.
- NFR-016: each cell operates independently when links to the group or other ports are lost.
- NFR-008: recovery for a cell is inside its jurisdiction.
- DATA-001: data items inherit placement and isolation tags from the cell and class.

## Hard constraints
- HC-01: respected by construction, not by region choice. Verdict in the review: Conditional on D-009, D-010 and D-011.
- HC-02: per-shipowner partitions inside the cell. Conditional on D-015.
- HC-03: certificates are hosted and signed in the cell. Conditional on D-012 and D-013.
- HC-07: the edge is a buffer; capture never waits for shore. Conditional on D-020.
- HC-08: append-only store and chain per cell, with anchored digests. Conditional on D-013.
- HC-11: this ADR creates nothing and requires no application code.

## Options considered
1. **Centralised Azure cloud (option A).** One platform in one region serving every port. Simplest to run and cheapest in the cost model. **Rejected (hard constraint):** holds data from several jurisdictions in one place, violating HC-01. Reopens only if one jurisdiction is in scope.
2. **Jurisdiction-local edge plus one Azure shore platform (option B).** Raw evidence stays at the edge or in a store at the port; one shore platform on Azure processes derived data. **Not selected:** makes the edge the system of record, leaves agents without a lawful place to read raw evidence, and drifts toward option A at the first shortcut.
3. **Sovereign evidence cells with federated coordination (option C).** One cell per jurisdiction holds the system of record and runs the deterministic services and agents; a thin group plane distributes signed artefacts and receives only approved classes. **Selected.**
4. **Continue today's process (option D).** Manual and document-based. **Not selected:** cannot make evidence tamper-evident and delivers none of the five capabilities.

## Decision
Adopt option C as the target topology, with these rules:
1. **The unit of placement is the jurisdiction.** A cell holds every store, backup, log stream, inference endpoint and administration path for that jurisdiction's delivery data and customer data. Cells follow jurisdictions, not ports; ports that share a jurisdiction for residency purposes share a cell (D-009).
2. **The edge is a buffer, never the record.** It captures, stamps trusted time, signs and queues; the cell is the system of record.
3. **One cell contract, per-port hosting.** Each cell implements the same interfaces. It runs on an Azure region only where residency, service availability and the needed controls are verified for that jurisdiction; otherwise on a jurisdiction-local host. The choice is made per port (D-010).
4. **The group plane carries no raw or evidence-grade data.** It distributes signed methodology packages and policy bundles down and accepts only listed classes up. The list is empty until D-011 and D-009 fill it.
5. **A cell is not allowed to hold production data until its recovery path is inside its jurisdiction** (or a weaker objective has been explicitly accepted).
6. **Nothing in this ADR is deployed, and deployment is pull-based.** Deployment remains human-approved and is deferred by the owner (T36). When it happens, the group plane only publishes signed change sets; each cell's in-jurisdiction runner pulls, verifies and applies them with an identity that cannot read or export production data. The group plane holds no credentials to change a cell, so deployment is not an out-of-jurisdiction administration route (SEC-002).

## Why this option is appropriate
It is the only option that can satisfy HC-01, HC-02, HC-03, HC-07 and HC-08 together while keeping every capability, including agents, in each jurisdiction. Option A violates HC-01. Option B satisfies HC-01 only by confining agents to derived data and by relying on edge devices as the system of record, which weakens HC-08 and recovery. Option D meets none of the mandatory constraints. Option C also subsumes B: a port with no suitable cloud region runs its cell locally. The cost is repeated fixed cost per jurisdiction, which the business model shows explicitly as the price of sovereignty and does not hide.

## Consequences
- Positive: residency, isolation and recovery are properties of a cell that can be tested; a failure, a breach or an audit touches one jurisdiction; adding a port inside a jurisdiction is cheap.
- Negative: one deployment and one operating arrangement per jurisdiction; group-level visibility is poorer than a central design (RK-004); cost does not fall with scale because fixed costs repeat (RK-003).
- Obligations: a hosting matrix per port, an approved-flow list with a legal basis, a recovery design per cell, and a cell definition that deploys identically everywhere.

## Reliability consequences
Failure domains are per cell. A cell outage does not stop other ports; issued certificates stay verifiable offline; the edge keeps capturing. The group plane is a soft dependency: cells run on the last verified methodology and policy. Weak points: recovery for a jurisdiction with no second location (RK-013), the identity provider as a global dependency, and edge buffer limits (D-020).

## Security consequences
Smaller blast radius per cell, administration from inside, keys held per cell, nothing sensitive in the group plane. Cost: more places to protect and more identities and key ceremonies (RK-007, RK-008). A cell must verify every artefact it pulls from the group plane.

## Residency implications
Raw measurements, evidence packages, calculation records, certificates, customer data, keys, telemetry, backups and inference stay in the cell's jurisdiction. The only cross-boundary flows are the approved list (empty by default) and offline-verifiable bundles and filings sent on approved flows. Which jurisdiction's rule defines "within" for each port, and whether the edge counts, are open (D-009).

## Cost and operational implications
Drivers, not amounts: fixed costs per cell (key custody, a standby database, messaging, monitoring, operations people), the number of jurisdictions, and local hosting where no region qualifies. The business value model prices these as scenario assumptions with Azure list prices as the only verified inputs. Operating a cell needs local or approved-inside operators because outside administration is denied by default (D-033).

## Reversibility
Partly reversible. Merging cells later is possible if the law allows, but data placed in a jurisdiction cannot be moved without the same legal check. Adding a group-plane flow later is cheap if D-011 approves it. Moving from option C back to a central design would breach HC-01, so the cheapest point to change course is before any production data exists.

## Validation evidence
None yet: no cell, region or host has been built or verified. Planned: per-port placement review, per-flow negative tests, edge-simulator disconnection tests, in-jurisdiction recovery exercise, and isolation tests per shipowner. The existing candidate ingestion oracle covers one interface only.

## Review gate
Reviewed in [RV-0003](../architecture/reviews/RV-0003-target-system-architecture.md): the gate computes Blocked. This ADR cannot be Accepted while the review is not Approved, and the review needs a named human decider.

## Revisit when
D-003 shows a single jurisdiction; D-009 shows residency covers storage only; D-010 shows most ports lack a qualifying region; D-011 produces a list long enough to make the group plane a data store; or the sponsor will not fund the cost of sovereignty.

## Evidence
- [DES-0003](../architecture/designs/DES-0003-target-system-architecture.md), [02 Architecture options](../target-architecture/02-ARCHITECTURE-OPTIONS.md), [03 Architecture views](../target-architecture/03-ARCHITECTURE-VIEWS.md), [business value model](../business/BUSINESS-VALUE-MODEL.md).
- No evidence records for production behaviour exist.
