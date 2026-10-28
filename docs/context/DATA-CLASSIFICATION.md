# Data Classification

Status: baseline v0.1, 2026-10-28. Proposed classification scheme (class B) with the two case-study constraints applied (CS-C1 residency of delivery measurement data, CS-C2 isolation of customer compliance data). Requirements: DATA-001, SEC-001 to SEC-006. Decisions that can change this: D-009, D-011, D-015, D-016, D-017.

## 1. Scheme

Each data class carries four independent attributes rather than a single level. A single "secret/confidential/public" level cannot express "must stay in this port" or "must never mix between customers".

| Attribute | Values | Meaning |
|---|---|---|
| Confidentiality | Public, Internal, Confidential, Restricted | Who may read it |
| Residency | **Port-bound**, Entity-bound, Group-free, TBD | Port-bound: stays in the originating port jurisdiction (CS-C1). Entity-bound: stays within the legal entity or jurisdiction named by D-003. Group-free: may be held anywhere the group operates. TBD: undecided |
| Isolation | **Customer-isolated**, Shared | Customer-isolated: separated per shipowner in storage, compute context, indexes, caches, logs and agent memory (CS-C2) |
| Integrity tier | **Evidence-grade**, Controlled, Standard | Evidence-grade: append-only and tamper-evident with independent verification (CS-C8, CS-C3). Controlled: versioned and approved. Standard: normal engineering controls |

**Inheritance rule (proposed):** a derived item takes the most restrictive Residency and Isolation of its inputs unless an approved transformation, recorded under D-011, lowers it. A hash, an aggregate or a summary is not automatically free to leave; it is free only once D-011 says so. Applies equally to logs, traces, caches, embeddings and agent memory.

## 2. Classification of data classes

Basis **A** means the attribute is stated in the case study. **B** means proposed. A statement about "delivery measurement data" is applied to the classes that contain it by inheritance, which is itself a proposal.

| ID | Data class | Examples | Confidentiality | Residency | Isolation | Integrity tier | Basis | Open |
|---|---|---|---|---|---|---|---|---|
| DC-01 | Raw delivery measurement data | Meter readings, density, temperature, device ids, timestamps, logger output | Restricted | Port-bound | Shared | Evidence-grade | A (CS-C1); integrity B | D-009 |
| DC-02 | Delivery evidence packages | Manifests binding readings, blend, feedstock and transfer evidence | Restricted | Port-bound | Shared | Evidence-grade | B (contains DC-01) | D-009 |
| DC-03 | Blend and composition data | Blend ratios, component batches | Confidential | Port-bound | Shared | Evidence-grade | B | D-009, D-023 |
| DC-04 | Feedstock certificates and supplier documents | Sustainability certificates, proofs, supplier attestations | Confidential | TBD | Shared | Evidence-grade | B | D-024, D-009 |
| DC-05 | Methodology and reference data | Factor sets, parameters, scheme rules, code builds | Internal | Group-free | Shared | Controlled | B | D-022 |
| DC-06 | Emissions calculation records | Inputs (hashes), methodology id and version, outputs | Confidential | Port-bound | Shared | Evidence-grade | B (derived from DC-01) | D-011 |
| DC-07 | Mass-balance ledger | Batch and tank movement events, balances, exceptions | Confidential | Port-bound | Shared | Evidence-grade | B | D-011, D-023 |
| DC-08 | Certificates | Issued, superseded and revoked certificates and their signatures | Confidential | Port-bound (locally hosted, meaning per D-012) | Customer-isolated where addressed to one customer | Evidence-grade | A (CS-C3); other attributes B | D-006, D-012 |
| DC-09 | Certification filings and approvals | Drafts, approved content hashes, submissions, quality-manager approvals | Confidential | TBD | Shared | Evidence-grade | B | D-006, D-007 |
| DC-10 | Dispute evidence packs | Quantity and quality packs prepared for commercial review | Restricted | Port-bound | Customer-isolated | Evidence-grade | B | D-014, D-026 |
| DC-11 | Customer compliance data | Per-shipowner records served to customers, questions and answers | Confidential | TBD | Customer-isolated | Controlled | A (CS-C2) | D-015 |
| DC-12 | Customer disclosure policies | What each shipowner may be told | Confidential | TBD | Customer-isolated | Controlled | A (CS-CAP-5, CS-C2) | D-029 |
| DC-13 | Agent operational records | Prompts, retrieved context, tool calls, outputs, memory | Inherits highest of content | Inherits | Inherits | Evidence-grade for action logs | B (AGT-007) | D-028 |
| DC-14 | Platform telemetry and logs | Metrics, traces, audit logs | Inherits highest of content | Inherits (default Port-bound for in-jurisdiction components) | Inherits | Controlled | B | D-011 |
| DC-15 | Identity and access data | Users, approvers, agent identities, role assignments | Confidential | TBD | Shared | Controlled | B | D-017, D-033 |
| DC-16 | Cryptographic keys and signing material | Certificate signing keys, key-encryption keys | Restricted (secret) | Port-bound (custody local) | Shared | Controlled | B (SEC-007, SEC-011) | D-013 |
| DC-17 | Platform configuration and source code | Application code, deployment definitions (none exists yet) | Internal | Group-free | Shared | Controlled | B | – |
| DC-18 | Synthetic and test data | Fabricated readings and documents | Internal | Group-free | Shared | Standard | B (DATA-009) | D-036 |

## 3. Handling rules by attribute (proposed)

| Attribute value | Rules |
|---|---|
| Residency: Port-bound | Storage, processing, backup, disaster-recovery copies, telemetry and AI inference stay in the originating jurisdiction. Administrative access from outside is denied except through approved break-glass (SEC-002). Region choice alone is not evidence; see [SOVEREIGNTY-MATRIX](SOVEREIGNTY-MATRIX.md) |
| Residency: TBD | Treat as Port-bound until decided |
| Isolation: Customer-isolated | One isolation unit per shipowner (granularity per D-015). No shared index, cache, embedding store, log view or agent memory. Tests prove it (SEC-006, NFR-010) |
| Integrity: Evidence-grade | Append-only, signed or hash-linked, independent verification, retention per D-016. Corrections are new versions (FR-030) |
| Integrity: Controlled | Versioned, approved changes with approver and effective date |
| Restricted | Least privilege, no standing broad access, access logged |
| Secret | Managed key service; never in code, prompts, chat or logs |

## 4. Not covered here
- Personal data classification, pending D-017.
- Legal classification under any jurisdiction's law, pending D-009 and the verification of V-35.
- Retention periods, pending D-016.
