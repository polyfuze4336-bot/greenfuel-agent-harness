# Problem Statement

Programme: *Agentic Green-Fuel Bunkering Certification for an Asian Marine Fuels Group*.
Status: baseline v0.1, 2026-10-28. Fact-only. This document records what the case study states and nothing else. Interpretation, assumptions and design belong in [docs/context/](docs/context/). Every case-study statement has an ID (`CS-...`) that requirements cite as their source.

## 1. Statements in the case study

### 1.1 Business capabilities

| ID | Capability (as stated) |
|---|---|
| CS-CAP-1 | **Delivery Evidence Agent** binds mass-flow-meter readings, blend data, feedstock certificates and transfer evidence. |
| CS-CAP-2 | **Emissions Attribute Agent** calculates scheme-specific emissions attributes using deterministic, version-controlled calculation methods. |
| CS-CAP-3 | **Dispute Resolution Agent** prepares sensor-backed quantity and quality evidence for commercial review. |
| CS-CAP-4 | **Mass-Balance Agent** tracks certified fuel quantities across tanks, blending and delivery operations. |
| CS-CAP-5 | **Customer Compliance Agent** answers delivery-related compliance questions within shipowner-specific disclosure policies. |

### 1.2 Mandatory constraints

| ID | Constraint (as stated) |
|---|---|
| CS-C1 | Delivery measurement data remains within its originating port jurisdiction. |
| CS-C2 | Customer compliance data is isolated per shipowner. |
| CS-C3 | Certificates must be tamper-evident and locally hosted. |
| CS-C4 | Certification filings require quality-manager approval. |
| CS-C5 | Emissions calculations must be reproducible and traceable to the exact methodology version. |
| CS-C6 | AI cannot invent sensor measurements, emissions factors, feedstock evidence or certification status. |
| CS-C7 | Edge-to-shore connectivity can be intermittent. |
| CS-C8 | The architecture must support evidence integrity, dispute resolution and audit reconstruction. |

### 1.3 Programme direction

| ID | Statement |
|---|---|
| CS-P1 | The target is an Azure-native agentic solution. |
| CS-P2 | The business application is not to be built at this stage; the work product is a requirements baseline and an unresolved decision register. |
| CS-P3 | The business agents are referred to as "L4" agents. The scale that defines L4 is not given. An L4 agent is not to be assumed to hold unrestricted commercial, regulatory or infrastructure permissions. |
| CS-P4 | Deploying to an Azure region is not to be assumed to satisfy port-jurisdiction residency. |
| CS-P5 | Frameworks and standards are to be identified as candidates for validation, not as confirmed applicable. |

## 2. What the case study does not state
Each gap below is tracked in the [decision register](docs/context/DECISION-REGISTER.md).

- Which ports and jurisdictions are in scope, and the legal source of each residency obligation.
- Which fuels and blends are in scope.
- Which certification schemes and regulations apply, and which bodies receive filings.
- What a "certificate" is, who issues it, and what "locally hosted" is local to.
- Who the quality manager is, whether the role is per port or group-wide, and who performs "commercial review".
- The meaning of L4.
- Volumes, number of customers, existing systems, disconnection durations, availability targets, budget, timeline.
- Hosting model at the port and at the edge, and who owns edge hardware.
- Success measures and baselines.

## 3. Glossary (working, not authoritative)

| Term | Working meaning | Status |
|---|---|---|
| Delivery | One bunkering transfer of fuel to a receiving ship | Assumption AS-002 |
| Edge | Compute located with the delivery operation, before shore connectivity | Assumption AS-005 |
| Shore | Platform components reached over the edge-to-shore link | Assumption |
| Attribute | A calculated emissions value attached to a delivery under a named scheme and methodology version | Derived from CS-CAP-2 |
| Business agent | An AI agent that is part of the product (the five above). Distinct from the coding-harness agents in this repository | CS-P1, [ADR 0001](docs/adr/0001-native-first-harness.md) |
