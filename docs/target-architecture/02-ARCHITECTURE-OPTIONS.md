# 02 Architecture options

Status: proposed, Phase 0. This is the supporting analysis for [DES-0003](../architecture/designs/DES-0003-target-system-architecture.md). The three required alternatives are options A to C; option D (continue as today) is kept so the choice is explicit. Verdict words are the gate's vocabulary: **Meets**, **Conditional** (holds only if named decisions are answered a particular way), **Does not meet**, **Unknown**. No figure appears: cost comparisons point to the [business value model](../business/BUSINESS-VALUE-MODEL.md), whose figures are scenario assumptions.

## The options

| Option | Name | What it is |
|---|---|---|
| A | Centralised Azure cloud | One group platform in one Azure region (or one paired set). Edge devices forward readings to it. Every capability, every agent and every store is there |
| B | Jurisdiction-local edge plus Azure shore platform | Raw evidence is held at the edge or in a store at the port. One shore platform on Azure runs calculation, certificates, agents and group views on **derived** data pulled from the ports |
| C | Hybrid sovereign evidence cells with federated coordination | One **cell** per port jurisdiction holds the system of record and runs the deterministic services and the agents against it. The cell runs in an in-jurisdiction Azure region where one is verified, otherwise on a jurisdiction-local host. A thin group plane distributes signed methodology and policy and receives only approved data classes |
| D | Continue today's process | Manual and document-based work with existing point systems. Current systems are not known (D-019, D-035) |

## Eleven-criterion comparison

| Criterion | A Centralised | B Edge plus shore | C Sovereign cells plus federation | D Today |
|---|---|---|---|---|
| Data residency (HC-01, SEC-001 to 004) | **Does not meet:** raw and derived data from several jurisdictions sit in one place; region choice is not proof (CS-P4). Reopens only if D-003 shows a single jurisdiction | **Conditional:** holds only if all processing of raw evidence, including AI inference, stays at the edge or the local store; the shore platform then sees only approved derived data (D-009, D-011, D-028) | **Conditional:** raw evidence, backups, logs, inference and administration stay in the originating jurisdiction by construction; whether a given port's hosting satisfies the local rule needs D-009 and D-010 | **Unknown:** where today's data sits is not known |
| Evidence integrity (HC-08, SEC-008) | **Conditional:** one append-only store is simple to protect, but a single compromise exposes every jurisdiction's evidence; mechanism undecided (D-013) | **Conditional:** the edge holds the only copy or a thin copy; protecting many devices is harder and durability at the edge is weak | **Conditional:** append-only store and hash chain per cell, digests anchored across cells; more places to protect, each with a stronger platform than an edge box (D-013) | **Does not meet:** document-based records can be altered undetectably |
| Availability | **Conditional:** one failure domain affects every port; cloud region availability unverified | **Conditional:** edge availability depends on a small device unless it is duplicated; shore outage stops derived services only | **Conditional:** failure domains are per cell, so one port's outage does not stop others; a cell's own recovery must stay in the jurisdiction (RK-013); targets undecided (D-031) | **Unknown** |
| Scalability | **Meets:** managed services scale centrally; load is small in the scenarios anyway | **Conditional:** edge compute is the limit; raw-data analytics must run on it | **Conditional:** each cell scales independently; adding a jurisdiction adds a cell (repeated fixed cost, RK-003) | **Does not meet:** effort grows with volume |
| Performance | **Conditional:** distance from a port to a remote region adds latency to interactive use; capture is unaffected because it is edge-first | **Meets:** capture and local reads are local | **Meets:** capture, calculation and customer answers run near the port; no latency target exists (D-031) | **Unknown** |
| Cost | **Meets** in the model's cost view, as the lowest of the three, but it is **ineligible** under HC-01, so it is a reference point and not an option | **Unknown:** priced as a floor only; calculation and AI over raw data at every port are not priced, so it looks cheaper than it is | **Conditional:** highest of the eligible options because each cell repeats fixed costs (key custody, standby database, operations); the price of sovereignty is shown in the model's section 5 | **Unknown:** no baseline cost exists (D-034) |
| Operational complexity | **Meets:** one platform to run | **Does not meet:** many small sites to patch, secure and recover, with weak local skills | **Does not meet:** one deployment and operating arrangement per jurisdiction plus a group plane; mitigated by one cell definition deployed identically (RK-003) | **Does not meet:** manual effort and error |
| Security | **Conditional:** one large target; admin from anywhere is easiest to allow and hardest to justify (SEC-002) | **Conditional:** many exposed edge sites; physical tamper | **Conditional:** blast radius is one cell; admin access stays inside; per-cell keys; group plane has no data to steal | **Does not meet:** weak controls on paper records |
| Certification auditability (FR-029, D-025) | **Conditional:** reconstruction is easy in one system, but auditors in other jurisdictions would read data held abroad | **Conditional:** reconstruction spans edge stores and shore derived data; gaps at edge hard to evidence | **Meets** in structure: reconstruction is a cell query, auditors read inside the jurisdiction, and verification bundles verify offline; depends on D-013 | **Does not meet:** audit preparation is a document hunt |
| Recovery | **Conditional:** one recovery plan, but recovery copies abroad breach HC-01 for other ports | **Does not meet:** recovering an edge device without a second copy loses evidence | **Conditional:** recovery stays in the jurisdiction (second site in the same jurisdiction, or a verified region pair); must exist for every cell; targets undecided (D-031) | **Unknown** |
| Vendor dependency | **Conditional:** deepest dependency on one cloud's regional services and global identity | **Conditional:** shore platform on Azure, edge on partner hardware | **Conditional:** cell contract is defined by interfaces (containers, PostgreSQL, object storage, AMQP, HSM), Azure is the reference implementation, and an on-premises cell is possible; some Azure services remain hard to replace (see the service matrix) | **Meets:** none, and none of the benefit |

## Recommendation: option C

**Select option C**, recorded as [ADR 0016](../adr/0016-sovereign-evidence-cells-with-federated-coordination.md) (Proposed) with conditions. It is the only option that can be made to satisfy HC-01, HC-02, HC-03, HC-07 and HC-08 together while keeping the full capability set, including agents, inside each jurisdiction.

The decisive reasons, in order:

1. **Residency by construction rather than by region (HC-01, CS-P4).** In C the unit of placement is the jurisdiction, so every store, backup, log stream, inference endpoint and administration path has one place it is allowed to live. A and the shore half of B depend on keeping raw data out of a shared platform by discipline.
2. **The system of record is not at the edge.** B puts the only durable copy on a small device. C treats the edge as a buffer (capture, sign, queue) and the cell as the record, which is what HC-07 and HC-08 need.
3. **Agents stay possible.** SEC-003 allows AI inference over delivery data only in its jurisdiction. In C that is a property of each cell; in B it forces inference onto edge hardware or removes the agents from the evidence.
4. **Blast radius and auditability.** A compromise, outage or audit touches one jurisdiction. A single reconstruction query exists per cell.
5. **It degrades gracefully per port.** A port with a verified in-country region runs an Azure cell; a port without one runs a cell on a jurisdiction-local host. The cell contract is the same, so the decision is made per port without changing the architecture.

## Why the alternatives are rejected

| Option | Disposition | Reason, in terms of a requirement or constraint |
|---|---|---|
| A Centralised Azure | **Rejected (hard constraint)** | Violates HC-01 for any group with more than one port jurisdiction: data from every jurisdiction but one is outside its originating jurisdiction, and region selection is not proof. It is also the weakest on SEC-002 (administration from outside) and RK-013. **Reopen condition:** D-003 shows one jurisdiction only. |
| B Edge plus shore | **Not selected** | Not a hard-constraint violation if the shore platform is confined to derived data, but it (1) makes the edge the system of record, weakening HC-08 and recovery; (2) leaves agents with no place to read raw evidence, contradicting BR-001 or forcing inference onto edge hardware (D-028); (3) trends toward A at the first shortcut, because the easy fix for a missing capability is to pull raw data to shore. Option C contains B: a port with no suitable region simply hosts its cell locally. |
| D Today | **Not selected** | Does not meet HC-08 (undetectable alteration), does not scale with volume, and delivers none of the five capabilities (BR-001). It stays visible as the baseline against which the model measures value. |

## Conditions attached to the recommendation

These are what make the recommendation honest. If any is wrong, the option is revisited.

1. **Cells may differ in hosting, not in contract.** Each cell implements the same interfaces ([04 Integration contracts](04-INTEGRATION-CONTRACTS.md)). A hosting-model matrix per port (D-010) decides Azure region or local host.
2. **The group plane carries no raw or evidence-grade data.** It distributes signed methodology packages and policy bundles down, and accepts only flows on an approved list (D-011) up. Default is nothing. A group view that needs more is a decision, not a default.
3. **Fewer cells if the law allows.** If counsel establishes that several ports share one jurisdiction for residency purposes (D-009), they share a cell. Cells follow jurisdictions, not ports.
4. **Agents are optional per cell.** A cell with no verified in-jurisdiction inference runs without agent features rather than sending sovereign data to an unverified endpoint (D-028, SEC-003).
5. **A cell's recovery is inside its jurisdiction** (second site or verified region pair) before it is allowed to hold production data (RK-013).
6. **Cost of sovereignty is accepted by the sponsor** ([BUSINESS-VALUE-MODEL](../business/BUSINESS-VALUE-MODEL.md) section 5). If the sponsor will not pay it, the choice is fewer ports, not a cheaper architecture that breaks HC-01.

## What would change the recommendation

| Observation | Effect |
|---|---|
| D-003: one port jurisdiction only | Option A becomes eligible; compare A against C on cost and recovery |
| D-009: counsel confirms residency covers storage only, not processing or telemetry | Some processing may centralise; the cell shrinks toward storage plus signing |
| D-010: no in-country Azure region meets the rule for most ports | Most cells are local hosts; operations cost rises and the Azure-native claim (CS-P1) weakens for those ports |
| D-013: a ledger or timestamping service is accepted by auditors only if run by a third party outside the jurisdiction | Conflicts with HC-03 locality; needs an explicit exception through the decision process, not a design workaround |
| D-028: no in-jurisdiction inference anywhere | Agents lose raw-evidence access everywhere; the case for "agentic" shrinks to drafting on non-sovereign material |
