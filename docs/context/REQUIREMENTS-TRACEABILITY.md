# Requirements Traceability

Status: baseline v0.1, 2026-10-28. One row for every requirement in [REQUIREMENTS](REQUIREMENTS.md) and [NON-FUNCTIONAL-REQUIREMENTS](NON-FUNCTIONAL-REQUIREMENTS.md). `npm run validate` checks that the two sets match exactly, that every referenced ID exists, that class A rows cite a case-study statement and class B rows cite `ARCH`, and that no mandatory cell is empty.

## Columns
- **Source**: `CS-...` statements in [PROBLEMSTATEMENT](../../PROBLEMSTATEMENT.md) for class A. `ARCH` for class B (proposed architecture assumption); `ARCH; CS-...` means derived from that statement.
- **Validation method**: how the requirement would be shown to hold. Methods: Review, Inspection (examine configuration or artefacts), Test (automated or scripted), Demonstration, Audit sample, Code review.
- **Evidence required**: the artefact that would count. Every item is **future evidence**. No such evidence exists yet and none is claimed. In this repository, evidence from command runs is created only by the recorder (see [evidence README](../evidence/README.md)).
- **Decisions**: related decisions from the [decision register](DECISION-REGISTER.md) (`D-nnn`) and accepted ADRs (`ADR-nnnn`).
- **Depends on**: other requirements that must hold first.
- **Open (C)**: unanswered stakeholder clarifications that could change the requirement.
- **Verify (D)**: unverified regulatory or certification candidates (`V-nn` in [CERTIFICATION-SCHEMES](CERTIFICATION-SCHEMES.md)) that could shape the requirement.
- A dash means none.

## Business requirements

| ID | Source | Validation method | Evidence required | Decisions | Depends on | Open (C) | Verify (D) |
|---|---|---|---|---|---|---|---|
| BR-001 | CS-CAP-1; CS-CAP-2; CS-CAP-3; CS-CAP-4; CS-CAP-5 | Review | Owner-approved capability definitions with FR mapping table | D-008; D-027 | – | D-003; D-004 | – |
| BR-002 | CS-C8 | Audit sample | Reconstruction exercise records for sampled deliveries | D-013; D-025 | FR-005; FR-029 | D-006; D-025 | – |
| BR-003 | CS-CAP-3 | Review | Commercial reviewer ratings on sampled packs; pack-to-record trace report | D-026 | FR-013; FR-014 | D-007; D-026 | V-24 |
| BR-004 | CS-CAP-5; CS-C2 | Test | Isolation test reports; production monitoring reports | D-015; D-029 | SEC-005; SEC-006 | D-005; D-015 | – |
| BR-005 | CS-CAP-4 | Demonstration | Reconciliation reports per balancing period; exception log | D-023 | FR-017; FR-018; FR-019; FR-020; FR-021 | D-023 | V-01; V-11 |
| BR-006 | CS-C1 | Inspection | Per-port data-flow inventory; configuration exports; negative test results; legal sign-off | D-009; D-010; D-011 | SEC-001 | D-003; D-009 | V-35 |
| BR-007 | CS-C7 | Test | Disconnection and reconnection test reports | D-018; D-020 | FR-006; NFR-004 | D-020 | – |
| BR-008 | ARCH | Review | Approved value measures and baselines per capability | D-034 | – | D-034 | – |
| BR-009 | CS-P2 | Inspection | Recorded validator run showing phase 0; git history of the phase flag | ADR-0002 | – | – | – |

## Functional requirements

| ID | Source | Validation method | Evidence required | Decisions | Depends on | Open (C) | Verify (D) |
|---|---|---|---|---|---|---|---|
| FR-001 | CS-CAP-1 | Test; Review | Hash-comparison test report with a simulated meter; interface specification | D-018; D-019 | – | D-019 | V-10; V-22; V-23 |
| FR-002 | CS-CAP-1 | Test | Test report; sample record showing source and approver | D-019 | – | D-007; D-019 | – |
| FR-003 | CS-CAP-1 | Test; Review | Stored originals bound per batch; missing-certificate display test | D-024 | – | D-024 | V-01; V-04 |
| FR-004 | CS-CAP-1 | Review; Test | Approved document-type list; completeness test report | D-019 | – | D-019 | V-09; V-21 |
| FR-005 | ARCH; CS-C8 | Test; Demonstration | Manifest verification test report | D-013 | FR-001; FR-002; FR-003; FR-004 | – | – |
| FR-006 | ARCH; CS-C7 | Test | Disconnection and reconciliation test report | D-018; D-020; D-021 | FR-001; DATA-002 | D-020 | V-10 |
| FR-032 | ARCH; CS-C6 | Test; Review | Hash and verification-status records; verifier procedure | D-024 | FR-003 | D-024 | V-01; V-04 |
| FR-007 | CS-CAP-2 | Test; Review | Test report showing refusal without scheme and version | D-022 | DATA-005 | D-001; D-022 | V-01; V-05; V-07; V-12 |
| FR-008 | CS-CAP-2; CS-C5 | Code review; Test | Code review record; repeat-run hash report | D-022 | – | D-022 | V-07 |
| FR-009 | CS-C5 | Test; Inspection | Sample calculation records; retrieval walkthrough | D-022 | FR-008; DATA-005 | D-022 | – |
| FR-010 | CS-C6 | Test | Fail-closed test report | D-022 | DATA-005 | D-022 | V-12 |
| FR-011 | CS-C5 | Test | Re-run reports on sampled historical records | D-022 | FR-009 | D-022 | – |
| FR-012 | ARCH | Review; Test | Methodology lifecycle procedure; approval records | D-022 | – | D-022 | V-08; V-12 |
| FR-013 | CS-CAP-3 | Review; Test | Sample pack; link-resolution test report | D-026 | FR-001 | D-019; D-026 | V-09; V-20; V-24 |
| FR-014 | CS-C6 | Test | Gap-case test report | D-026; D-030 | FR-013 | D-026 | V-24 |
| FR-015 | CS-CAP-3 | Test; Review | Permission test report; approved action catalogue | D-007; D-027 | AGT-002 | D-007; D-026 | – |
| FR-016 | ARCH; CS-C8 | Demonstration | Independent third-party verification using only the pack and instructions | D-012; D-013; D-014 | FR-005; NFR-018 | D-014 | – |
| FR-033 | ARCH | Review; Test | Sample packs showing present and absent meter status and sample references | D-026 | FR-013 | D-019; D-026 | V-25; V-26 |
| FR-017 | CS-CAP-4 | Test | Event replay test report | D-023 | DATA-004 | D-023 | V-01; V-11 |
| FR-018 | ARCH; CS-CAP-4 | Test | Blend violation test report | D-023 | FR-017 | D-004; D-023 | V-11 |
| FR-019 | ARCH | Test | Over-allocation rejection test report | D-023 | FR-017 | D-023 | V-01; V-11 |
| FR-020 | ARCH | Test | Seeded discrepancy test report | D-023 | FR-017 | D-023 | – |
| FR-021 | ARCH | Review; Test | Approved rule sets; period results | D-023 | FR-017 | D-023 | V-01; V-02; V-11 |
| FR-022 | CS-CAP-5; CS-C6 | Test | Answer-grounding test report | D-029; D-030 | FR-009; FR-028 | D-029 | V-05; V-06 |
| FR-023 | CS-CAP-5; CS-C2 | Test | Disclosure-policy enforcement test report | D-015; D-029 | SEC-005 | D-029 | – |
| FR-024 | CS-C6 | Test | Unanswerable-question test report | D-029; D-030 | FR-022 | D-029 | – |
| FR-025 | ARCH; CS-C8 | Test | Sampled answer reconstruction from logs | D-027 | AGT-007 | – | – |
| FR-026 | CS-C3 | Test; Inspection | Tamper test report; hosting-location evidence | D-006; D-012; D-013 | SEC-007; SEC-008 | D-006; D-012 | V-07; V-32 |
| FR-027 | CS-C4 | Test; Demonstration | Denied-submission test without approval; denied agent-approval attempt; rejected altered-content submission | D-006; D-007; D-027 | SEC-010 | D-006; D-007 | V-04 |
| FR-028 | CS-C6 | Test | Status-integrity test report | D-006 | – | D-006 | – |
| FR-029 | CS-C8 | Audit sample | Reconstruction exercise records | D-013; D-025 | DATA-003; AGT-007 | D-025 | – |
| FR-030 | ARCH | Test | Correction test report showing both versions | D-013 | SEC-008 | – | – |
| FR-031 | ARCH | Test | Supersession verification test report | D-012 | FR-026 | D-012 | – |

## Security and sovereignty requirements

| ID | Source | Validation method | Evidence required | Decisions | Depends on | Open (C) | Verify (D) |
|---|---|---|---|---|---|---|---|
| SEC-001 | CS-C1; CS-P4 | Inspection; Test | Per-port data-flow inventory; policy and configuration exports; negative-test results; legal sign-off | D-009; D-010; D-011; D-028; D-033 | DATA-001 | D-003; D-009 | V-10; V-35 |
| SEC-002 | ARCH; CS-C1 | Test; Inspection | Access-denial test results; in-jurisdiction break-glass logs; register of any approved exception | D-009; D-011; D-033 | SEC-009 | D-009; D-033 | V-35 |
| SEC-003 | ARCH; CS-C1 | Inspection; Test | Model deployment location evidence; in-jurisdiction processing test | D-028 | SEC-001 | D-009 | V-35 |
| SEC-004 | ARCH; CS-C1 | Review; Test | Approved flow list; blocked-flow test results | D-011 | SEC-001 | D-011 | V-35 |
| SEC-005 | CS-C2 | Review; Inspection | Architecture review record; configuration exports | D-015 | DATA-001 | D-015 | – |
| SEC-006 | ARCH; CS-C2 | Test | Adversarial isolation test reports | D-015; D-030 | SEC-005 | D-015 | – |
| SEC-007 | ARCH; CS-C3 | Inspection; Test | Key custody evidence per port; offline verification test | D-012; D-013; D-020 | SEC-011 | D-012 | V-32 |
| SEC-008 | ARCH; CS-C8 | Test | Tamper test reports | D-013 | NFR-001 | – | V-32 |
| SEC-009 | ARCH | Review; Inspection | Role assignment reviews | D-027 | – | D-007 | – |
| SEC-010 | ARCH; CS-C4 | Test | Approval enforcement test reports | D-007; D-027 | SEC-009 | D-007 | – |
| SEC-011 | ARCH | Inspection; Test | Key custody and rotation records; secret-scan results | D-013 | – | – | V-31 |
| SEC-012 | ARCH | Test | Prompt-injection test reports | D-030 | AGT-002 | – | – |
| SEC-013 | ARCH | Review; Test | Edge threat model; signed-update rejection test | D-018 | – | D-019 | V-10; V-30; V-34 |
| SEC-014 | ARCH | Inspection | Log-flow inventory | D-011 | SEC-001 | – | V-31 |
| SEC-015 | ARCH | Inspection | Build records; dependency inventory | – | – | – | – |

## Data requirements

| ID | Source | Validation method | Evidence required | Decisions | Depends on | Open (C) | Verify (D) |
|---|---|---|---|---|---|---|---|
| DATA-001 | ARCH; CS-C1; CS-C2 | Review; Inspection | Data catalogue with classification, residency, isolation and retention tags | D-009; D-015; D-016 | – | D-009; D-015 | – |
| DATA-002 | ARCH; CS-C8 | Test | Gap and reorder detection test report | D-013; D-021 | – | D-019 | – |
| DATA-003 | CS-C5; CS-C8 | Test; Demonstration | Lineage walk reports on sampled values | – | – | – | – |
| DATA-004 | ARCH | Review | Identifier scheme document | D-015 | – | D-015; D-019; D-035 | – |
| DATA-005 | ARCH | Review; Test | Reference-data register with sources and approvals | D-022 | – | D-022 | V-12 |
| DATA-006 | ARCH | Review | Approved retention matrix | D-016 | – | D-016 | V-35 |
| DATA-007 | ARCH | Test; Review | Numeric rules document; cross-implementation test results | D-022 | – | D-022 | V-23 |
| DATA-008 | ARCH | Test | Status transition test report | – | – | – | V-26 |
| DATA-009 | ARCH; CS-C1 | Inspection | Non-production data inventory | D-036 | – | D-003 | V-35 |
| DATA-010 | ARCH | Review | Personal data inventory with lawful bases | D-017 | – | D-017 | V-33 |

## AI and agent control requirements

| ID | Source | Validation method | Evidence required | Decisions | Depends on | Open (C) | Verify (D) |
|---|---|---|---|---|---|---|---|
| AGT-001 | ARCH | Review | Approved agent charters | D-008; D-027 | – | D-008 | – |
| AGT-002 | CS-P3 | Test; Review | Permission test reports; approved action catalogue | D-008; D-027 | AGT-001 | D-008 | – |
| AGT-003 | CS-C6 | Test | Zero-tolerance no-invention evaluation results; provenance samples | D-013; D-019; D-030 | FR-028 | D-019 | – |
| AGT-004 | ARCH; CS-C5; CS-C6 | Test; Inspection | Sampled outputs with tool-call traces | D-027 | FR-008 | – | – |
| AGT-005 | ARCH; CS-C4 | Review; Test | Action catalogue with approver roles; blocked-without-approval tests | D-007; D-027 | AGT-002 | D-007 | – |
| AGT-006 | ARCH | Test; Inspection | Role assignment export; denial test results | D-027 | SEC-009 | – | – |
| AGT-007 | ARCH; CS-C8 | Test | Action-log reconstruction on sampled outputs | D-027 | – | – | – |
| AGT-008 | ARCH | Test | Evaluation suite results per release | D-030 | AGT-003 | – | – |
| AGT-009 | ARCH | Inspection | Sampled output records showing version ids | – | – | – | – |
| AGT-010 | ARCH; CS-C7 | Test | Run with AI services disabled | D-018 | FR-006 | – | – |
| AGT-011 | ARCH | Inspection | Configuration review; separation of identities | ADR-0001; ADR-0002 | – | D-037 | – |

## Non-functional requirements

| ID | Source | Validation method | Evidence required | Decisions | Depends on | Open (C) | Verify (D) |
|---|---|---|---|---|---|---|---|
| NFR-001 | CS-C8 | Test | Tamper test reports | D-013 | SEC-008 | – | V-32 |
| NFR-002 | CS-C5 | Test | Repeat-run hash reports across rebuilt environments | D-022 | FR-008 | D-022 | – |
| NFR-003 | CS-C8 | Audit sample | Timed reconstruction exercises | D-025; D-031 | FR-029 | D-025; D-031 | – |
| NFR-004 | CS-C7 | Test | Disconnection test report | D-018; D-020 | FR-006 | D-020 | – |
| NFR-005 | ARCH | Test | Interrupted synchronisation test reports | D-018 | FR-006 | – | – |
| NFR-006 | ARCH | Test | Load and failure test reports | D-018; D-019 | FR-001 | D-019 | – |
| NFR-007 | ARCH | Test; Inspection | Availability reports | D-010; D-031 | – | D-031 | – |
| NFR-008 | ARCH | Test | Recovery exercise report | D-010; D-031 | – | D-031 | – |
| NFR-009 | ARCH; CS-C1 | Test; Inspection | Drift-detection test results; periodic evidence reports | D-009; D-010 | SEC-001 | D-009 | V-35 |
| NFR-010 | ARCH; CS-C2 | Test | Isolation suite reports | D-015 | SEC-006 | D-015 | – |
| NFR-011 | ARCH | Test | Archive verification after a simulated platform upgrade | D-013; D-016 | – | D-016 | V-32 |
| NFR-012 | ARCH | Test | Key rotation exercise report | D-013 | – | – | V-32 |
| NFR-013 | ARCH | Inspection; Test | End-to-end trace of one delivery | D-010 | SEC-014 | – | – |
| NFR-014 | ARCH | Test | Latency measurements on representative data | D-031 | – | D-031; D-032 | – |
| NFR-015 | ARCH | Test | Load test report | D-032 | – | D-032 | – |
| NFR-016 | ARCH | Test | Inter-port isolation drill report | D-010; D-020 | – | D-003; D-007; D-020 | – |
| NFR-017 | ARCH | Test | Drift detection test report | D-021 | – | – | – |
| NFR-018 | ARCH | Test | Independent verifier test report | D-012; D-013 | FR-016 | D-014 | – |
| NFR-019 | ARCH | Inspection | Cost reports per port and capability | – | – | D-034 | – |
| NFR-020 | ARCH | Review | Approved language list | – | – | D-005 | – |
| NFR-021 | ARCH | Test | Change-introduction test report | D-022 | FR-012 | – | – |
