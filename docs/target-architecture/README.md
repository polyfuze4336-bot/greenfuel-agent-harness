# Target architecture

Status: **proposed design, Phase 0, 2026-10-29. Nothing here is approved.** The governed decision is [DES-0003](../architecture/designs/DES-0003-target-system-architecture.md), reviewed in [RV-0003](../architecture/reviews/RV-0003-target-system-architecture.md), which the design-review gate computes as **Blocked** until the open decisions are answered and a named human decides. The ADRs it proposes ([0016](../adr/0016-sovereign-evidence-cells-with-federated-coordination.md), [0017](../adr/0017-deterministic-core-and-bounded-agents.md), [0018](../adr/0018-evidence-integrity-and-certificate-mechanism-options.md), [0019](../adr/0019-azure-service-selection-by-requirement.md)) are **Proposed**. No Azure resource exists, no service or region has been verified, and no application code was written.

Labels used throughout: **A** stated in the case study, **B** proposed design or assumption, **C** needs stakeholder clarification, **D** needs verification. Figures in this folder are marked as placeholders or point to the [business value model](../business/BUSINESS-VALUE-MODEL.md), where every figure carries a class (verified, user-provided, benchmark or scenario assumption).

## The answer in one paragraph

Build the platform as **sovereign evidence cells**, one per port jurisdiction, each holding the system of record for that jurisdiction's delivery evidence and running the deterministic calculation, certificate, approval and agent services against it, with a thin **federated coordination plane** at group level that distributes signed methodology versions and policy and receives only data classes on an approved flow list. The edge (barge or terminal) captures, signs and buffers; it is a buffer and never the system of record. Calculation, hashing, signing, ledger posting and approval enforcement are deterministic software; the five business agents orchestrate, prepare and explain on top, with bounded tools, and are optional per cell. Azure services are chosen per requirement and verified per jurisdiction; where an in-jurisdiction Azure region is not established for a port, the cell runs on a jurisdiction-local edge or on-premises host with a controlled shore integration. A cloud region is never treated as residency proof.

## Contents

| Document | What it contains |
|---|---|
| [01 Business capability map](01-BUSINESS-CAPABILITY-MAP.md) | Capabilities, which are deterministic and which are agents, owners, requirements, value drivers |
| [02 Architecture options](02-ARCHITECTURE-OPTIONS.md) | Three required alternatives (plus doing nothing), the eleven-criterion comparison, the recommendation and why the others lose |
| [03 Architecture views](03-ARCHITECTURE-VIEWS.md) | Context, container and component views, data flows, trust boundaries, failure domains, deployment topology |
| [04 Integration contracts](04-INTEGRATION-CONTRACTS.md) | The contracts between components and with outside parties, with failure semantics |
| [05 Quality attributes](05-QUALITY-ATTRIBUTES.md) | RTO and RPO assumptions, performance and capacity assumptions, all placeholders |
| [06 Threat model](06-THREAT-MODEL.md) | Threats by trust boundary, controls, residual risk, validation |
| [07 Azure service decision matrix](07-AZURE-SERVICE-DECISION-MATRIX.md) | Each candidate service against the role, the alternatives, the residency checks and the evidence |
| [08 Design defence](08-DESIGN-DEFENSE.md) | What happens in the seven required failure and attack scenarios |
| [09 Review and validation](09-REVIEW-AND-VALIDATION.md) | Governance checks run, the independent review, the business-case validation and what is still unvalidated |
| [10 Control matrix (hardening)](10-CONTROL-MATRIX.md) | Controls by area (sovereignty, isolation, custody, certificate, methodology, responsible AI, audit) with threat, requirement, layer, candidate-oracle test and honest status |
| [11 Attack trees](11-ATTACK-TREES.md) | Six attacker goals decomposed into branches, each leaf marked ORACLE, DESIGN, OUT or OPEN |
| [12 Data movement and residency validation](12-DATA-MOVEMENT-AND-RESIDENCY-VALIDATION.md) | Designed flows, the per-cell validation procedure V-1 to V-12 (all NOT RUN), result states |
| [13 Security review](13-SECURITY-REVIEW.md) | The independent review of the candidate oracles, every finding, its remediation and what remains |
| [Stakeholders](../business/STAKEHOLDERS.md) | Eight candidate stakeholders, objectives, authority, constraints, measures, discovery questions |
| [Commercial value](../business/COMMERCIAL-VALUE.md) | Why trustworthy certification carries money, what the model counts and does not |
| [Business value model](../business/BUSINESS-VALUE-MODEL.md) | Generated from an editable model; every figure labelled |

## Relationship to existing records

- Builds on the [provisional Azure reference architecture](../azure/AZURE-REFERENCE-ARCHITECTURE.md) and [DES-0001](../architecture/designs/DES-0001-delivery-measurement-storage-topology.md) (storage topology, Blocked) and [DES-0002](../architecture/designs/DES-0002-evidence-ingestion-subsystem.md) (ingestion, Blocked). It does not replace them and does not approve them. DES-0003 is the system-level decision; the earlier designs remain sub-decisions with their own reviews.
- Respects every hard constraint ([HARD-CONSTRAINTS](../architecture/HARD-CONSTRAINTS.md)) and treats every standard or scheme as a candidate ([CERTIFICATION-SCHEMES](../context/CERTIFICATION-SCHEMES.md)).
- No decision in the [decision register](../context/DECISION-REGISTER.md) has been answered or assumed answered here. Where the design needs an answer it says which one and what changes if the answer differs.

## What this is not

Not an approved architecture, not a cost estimate (the model is a scenario tool), not a deployment plan, not a claim that any Azure service is available or compliant in any jurisdiction, and not a statement that any scheme or regulation applies.
