# Non-Functional Requirements

Status: baseline v0.1, 2026-10-28. Companion to [REQUIREMENTS](REQUIREMENTS.md); the column meanings and class definitions (A, B, C, D) are explained there. Validation, evidence and decisions for each row are in [REQUIREMENTS-TRACEABILITY](REQUIREMENTS-TRACEABILITY.md).

**About numbers.** The case study states no targets. Where a row shows a number it is a **placeholder proposed for discussion (class B), not a target and not agreed**. Each is tied to a decision (D-020, D-031, D-032) that will replace it. Do not design to a placeholder without confirming it.

## 1. Integrity and reproducibility

| ID | Caps | Requirement | Cls | Pri | Business justification | Acceptance criteria |
|---|---|---|---|---|---|---|
| NFR-001 | XC | Evidence integrity: any change to or deletion of a stored evidence record is detectable by independent verification | A | Must | CS-C8 | In tamper tests covering modification, deletion, reordering and replay, detection rate is 100 percent; verification runs without the application's own code path |
| NFR-002 | EAA | Reproducibility: the same inputs, methodology version and build reproduce the same results, across repeated runs and across rebuilt environments, under the reproducibility standard set by D-022 | A | Must | CS-C5 | Pinned toolchain and dependencies; repeated runs on a shared test set reproduce results per the D-022 standard (proposal for discussion: bit-identical outputs; a tolerance-based standard is the alternative); a failure blocks the release |
| NFR-003 | XC | Audit reconstruction effort: a full chain from certificate to raw readings can be rebuilt within a defined effort target | A | Must | CS-C8 | Target set under D-025 and D-031 (placeholder for discussion: one business day per sampled delivery by a trained reviewer using platform tools); the requirement cannot be assessed against a number until the target is set |
| NFR-011 | XC | Long-term verifiability: a certificate and its evidence remain verifiable for the full retention period, independent of platform version or vendor changes | B | Must | Certificates can be contested years later | Verification of archived samples succeeds after a simulated platform upgrade and after key rotation (D-016, D-013) |
| NFR-012 | XC | Cryptographic agility: algorithms and keys can be rotated without invalidating historical certificates | B | Should | Algorithms weaken over time | A rotation exercise leaves old certificates verifiable and new ones signed with the new key |
| NFR-017 | EDG | Trusted time: edge timestamps come from an approved source and drift is recorded | B | Must | Evidence ordering and dispute defence | Drift beyond the approved tolerance is flagged on the record and alerts operators (D-021) |

## 2. Edge, resilience and continuity

| ID | Caps | Requirement | Cls | Pri | Business justification | Acceptance criteria |
|---|---|---|---|---|---|---|
| NFR-004 | EDG | Edge autonomy: capture and local verification continue without shore connectivity for at least the maximum disconnection period | A | Must | CS-C7 | The period comes from D-020 (placeholder for discussion: 72 hours). A test disconnection of that length loses no evidence and exhausts no buffer; the requirement cannot be assessed against a number until D-020 is answered |
| NFR-005 | EDG | Edge-to-shore synchronisation is idempotent, resumable and ordered, and reports gaps | B | Must | Links drop mid-transfer | Interrupted syncs resume; retries create no duplicates; gaps are listed rather than hidden |
| NFR-006 | EDG,DEA | Evidence capture does not delay or block a bunkering operation | B | Must | Operations come first | During load and failure tests, delivery operations proceed unaffected; capture failure raises an alert and a manual fallback exists (D-019) |
| NFR-007 | XC | Shore service availability per port for evidence query, certificate verification and approvals | B | Should | Reviewers and customers expect access | Placeholder: 99.9 percent monthly for the verification and approval services; confirm under D-031 |
| NFR-008 | XC | Recovery objectives: no loss of acknowledged evidence; defined recovery time | B | Must | Evidence loss is unrecoverable | Placeholder: recovery point of zero for acknowledged records within the jurisdiction; recovery time per D-031. Recovery test performed with in-jurisdiction replicas only |
| NFR-016 | XC,SOV | Each port can operate independently if links to the group or other ports are lost: capture, integrity verification, calculation and queued workflows continue. Whether certificate issuance and approvals also continue offline depends on D-007 and D-020 | B | Should | Residency and resilience both favour local operation | Isolation drill: with inter-port links cut, a port continues capture, verification, calculation and queuing. Offline issuance and approval behaviour is tested only to the extent D-007 and D-020 allow it |

## 3. Performance and scale

| ID | Caps | Requirement | Cls | Pri | Business justification | Acceptance criteria |
|---|---|---|---|---|---|---|
| NFR-014 | CCA,DRA | Response times: customer compliance answers and dispute pack assembly complete within targets | B | Should | Usability for commercial staff and customers | Placeholders to be set under D-031 after volumes (D-032) are known; measured on representative data |
| NFR-015 | XC | Scalability: each port scales independently to the volumes in D-032 | B | Should | Volumes are unknown | Load test at the stated volumes plus headroom agreed with the owner |

## 4. Verifiability of constraints

| ID | Caps | Requirement | Cls | Pri | Business justification | Acceptance criteria |
|---|---|---|---|---|---|---|
| NFR-009 | SOV | Residency is continuously verifiable: configuration and flow evidence is produced on a cadence, and drift is detected and alerted | B | Must | CS-C1 must be demonstrable, not asserted | A seeded out-of-jurisdiction replication or endpoint is detected within the cadence set under D-009 and blocked |
| NFR-010 | CCA,XC | Tenant isolation is verifiable: automated tests run in the release pipeline and on a schedule | B | Must | CS-C2 must be demonstrable | Zero cross-tenant results across the test suite; the suite is extended whenever a new data path appears |
| NFR-013 | XC | Observability: logs, metrics and traces link edge events, shore processing and agent actions through correlation identifiers, and stay in-jurisdiction | B | Should | Reconstruction and operations | A single delivery can be traced end to end from one identifier, with telemetry subject to SEC-014 |

## 5. Operability, interoperability and cost

| ID | Caps | Requirement | Cls | Pri | Business justification | Acceptance criteria |
|---|---|---|---|---|---|---|
| NFR-018 | DRA,XC | Interoperability: evidence packs and certificates use documented, open formats that a third party can verify without proprietary software | B | Should | Auditors, arbitrators and customers | A verification tool written independently from the format specification verifies sample packs |
| NFR-019 | XC | Cost transparency: costs are attributable per port, capability and customer | B | Should | Informs pricing and value measures | Tagging and cost reports exist per port and capability (D-034) |
| NFR-020 | CCA | Language and accessibility needs of customers and port staff are identified and met | B | Could | Asian ports and customers span languages | Language list approved (D-005); documents in other languages are handled as untrusted input and flagged |
| NFR-021 | EAA,MBA | Evolvability: methodology versions and scheme rules change without redeploying unrelated components | B | Should | Schemes and regulations change | A new methodology version is introduced through the lifecycle in FR-012 with no change to unrelated services |
