# Assumptions

Status: baseline v0.1, 2026-10-28. Every item here is **class B**: a proposed architecture assumption that the case study does not state. An assumption holds a place until a decision or clarification replaces it. It is never a fact and must not be cited as one. If an assumption proves wrong, the "Risk if wrong" column says what breaks.

Class legend used across the baseline: **A** stated in the case study ([PROBLEMSTATEMENT](../../PROBLEMSTATEMENT.md)); **B** proposed assumption (this file); **C** needs stakeholder clarification ([DECISION-REGISTER](DECISION-REGISTER.md)); **D** regulatory or certification claim needing verification ([CERTIFICATION-SCHEMES](CERTIFICATION-SCHEMES.md)).

## 1. Assumptions

| ID | Assumption | Basis | Risk if wrong | How it will be validated | Replaced by |
|---|---|---|---|---|---|
| AS-001 | The five capabilities may map to five agents at design level, but implementation may share deterministic services between them | Case lists five agents | Over-fragmented design or missing shared services | Options analysis in Stage 2 | ADR |
| AS-002 | A "delivery" is one bunkering transfer to one receiving ship and is the unit of evidence | Terms used in the case | Evidence packaging and mass-balance boundaries change | Port operations walk-through | D-019 |
| AS-003 | The group operates in more than one port jurisdiction | "Originating port jurisdiction" and "Asian marine fuels group" | If single-jurisdiction, sovereignty design simplifies; if many, per-port variation grows | Programme owner | D-003 |
| AS-004 | Deliveries are liquid fuel blends measured by mass flow meters | "Mass-flow-meter readings", "blend data" | Gaseous or cryogenic fuels need different measurement and evidence | Programme owner | D-004 |
| AS-005 | "Edge" means computing on the bunker vessel or at the terminal, and the group controls or can specify it | "Edge-to-shore connectivity" | Third-party vessels or barges may restrict what can run at the edge | Port operations | D-018 |
| AS-006 | Meters or their loggers can supply readings electronically with a device identity; signing capability is unknown | Typical practice, unverified | Manual entry paths increase tamper risk | Equipment survey | D-019 |
| AS-007 | The group sells fuel to shipowners; customers are shipowners | "Shipowner-specific disclosure policies" | Different disclosure and dispute flows if the group is also a trader or operator | Commercial lead | D-005, D-015 |
| AS-008 | The group makes the certification filings, to bodies and registries not named in the case | "Certification filings require quality-manager approval" | Filings may be by third parties or not by the group | Quality manager | D-006 |
| AS-009 | Azure is the primary cloud platform, with edge or hybrid components where needed; an Azure region does not by itself satisfy residency | CS-P1, CS-P4 | Hosting may need non-Azure or hybrid elements in some ports | Sovereignty analysis | D-009, D-010 |
| AS-010 | Each jurisdiction may define residency differently, so rules are parameters per port, not one global setting | CS-C1 with no legal source | A single design would fail some jurisdictions | Compliance counsel | D-009 |
| AS-011 | Methodologies come from external scheme owners and are implemented as versioned code; the group does not invent methodology | "Scheme-specific" | The group may hold approved actual values that need governance | Quality manager | D-022 |
| AS-012 | "Reproducible" means identical outputs for identical inputs, methodology version and build, using defined numeric rules | CS-C5 wording | Tolerance-based reproducibility would relax NFR-002 | Quality manager | D-022 |
| AS-013 | A quality manager exists for each port or entity with at least one deputy | CS-C4 | Approvals could stall or be bypassed | Programme owner | D-007 |
| AS-014 | Human approval is performed in a service outside any agent's context, so agents cannot approve their own work | Control principle | Approvals could be spoofed through an agent channel | Design review | D-027 |
| AS-015 | Tamper evidence is shown by cryptographic means and independent verification; legal admissibility is not assumed | CS-C3, CS-C8 | Some jurisdictions may need qualified signatures or notarisation | Compliance counsel | D-012, D-013 |
| AS-016 | A trustworthy time source is available at the edge | Needed for ordering evidence | Evidence ordering can be disputed | Edge design | D-021 |
| AS-017 | Offline periods are bounded (placeholder 72 hours in NFR-004) and edge storage can hold the data | Placeholder for discussion | Longer outages lose evidence or block operations | Port operations | D-020 |
| AS-018 | A customer is a shipowner legal entity; charterers, managers and operators may need separate treatment | Common industry structure | Isolation boundary and disclosure rights change | Commercial lead | D-015 |
| AS-019 | Personal data is limited to business contact and signatory identities | Expected minimal | Privacy duties could expand | Data protection lead | D-017 |
| AS-020 | Non-production environments use synthetic or approved-masked data only | CS-C1 | Test data could breach residency | Sovereignty lead | D-036 |
| AS-021 | Business agents use language models for orchestration, retrieval, drafting and explanation, while every number, status and legal fact comes from deterministic tools and authoritative records | CS-CAP-2, CS-C6 | If models produce facts, CS-C6 is violated | Evaluation (D-030) | AGT-003, AGT-004 |
| AS-022 | English is the working language; documents in local languages are possible and are treated as untrusted input | Asian context | Language support is more expensive than assumed | Customer survey | D-005 |
| AS-023 | Existing bunker management, ERP and port systems exist and need integration | Typical enterprise estate | Greenfield assumptions may be wrong | Inventory | D-035 |
| AS-024 | Auditors and certification bodies need read access to evidence inside the jurisdiction | CS-C8 | Export-only access changes the architecture | Quality manager | D-025 |
| AS-025 | The coding harness and the business agents stay separate; harness agents never touch production | [ADR 0001](../adr/0001-native-first-harness.md), [ADR 0002](../adr/0002-phase-gating-and-approval-enforcement.md) | Production credentials could leak into developer tooling | Configuration review | AGT-011 |
| AS-026 | No Azure resource exists for this programme yet, and none has been created or queried by the harness | State of the work | n/a | Only local `az version` and `azd version` checks were run; no subscription, tenant or resource was queried or changed | D-037 |

## 2. Explicitly not assumed
These are the points the baseline refuses to assume; any of them could be wrongly taken for granted.

- That deploying to an Azure region satisfies port-jurisdiction residency (CS-P4).
- That any "L4" agent may take unrestricted commercial, regulatory or infrastructure actions (CS-P3).
- That any named scheme, regulation or standard applies (CS-P5).
- That regulatory details in any document here (titles, editions, dates, thresholds) are correct.
- That a single legal interpretation of "within the jurisdiction" fits all ports.
- That hashes, aggregates, logs or calculation records are free to leave a jurisdiction.
- That an AI model may be given delivery measurement data without checking where it is processed.
- That meters, loggers or edge hardware are controllable or trustworthy until surveyed.
- That any benefit, cost or volume figure exists. The case provides none.

## 3. Review rule
Each quarter, or when a linked decision changes, review this file: close assumptions that were decided, update risk, and delete those that no longer matter. Closed assumptions are recorded in the corresponding ADR, not silently removed.
