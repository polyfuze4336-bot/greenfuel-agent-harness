# RV-0001: Review of DES-0001

This review demonstrates the process on one real question: centralised versus jurisdiction-local storage of bunker delivery measurements. It was prepared by the `design-reviewer` role as a worked example. It is not an approval; no human decider has been named and the gate computes Blocked.

- **Review ID:** RV-0001
- **Design:** DES-0001
- **Checkpoint:** CP3
- **Status:** Blocked
- **Reviewer:** design-reviewer (language model, worked example; independent human review not yet done)
- **Decider:** pending
- **Date:** 2026-10-28

## 1. Hard-constraint screen

| Option | Constraint | Verdict | Reason | Conditions |
|---|---|---|---|---|
| B | HC-01 | Violated | By definition (DES-0001 section 3) option B holds, in one location, data from ports in several jurisdictions, so data from every jurisdiction but one sits outside its originating jurisdiction. If only one jurisdiction is in scope (DA-001), the option as defined does not exist | none |
| B | HC-07 | Conditional | Needs the same edge buffer and synchronisation design as option C; centralising does not remove it | D-020 |
| D | HC-08 | Unresolved | Durability and audit access for data held only on edge devices are not designed, so integrity and audit reconstruction cannot be judged | none |
| E | HC-01 | Conditional | As option C, plus a shared control plane whose permitted metadata and telemetry flows are undecided; deferred until those are known | D-011; D-010 |
| C | HC-01 | Conditional | Raw and evidence-grade data has one authoritative copy in the originating jurisdiction by intended topology, and the edge buffer is treated as part of it (DA-005). Whether that satisfies the constraint depends on what residency means (D-009), whether hosting exists in each jurisdiction (D-010), and the approved derived flows (D-011) | D-009; D-010; D-011 |
| C | HC-02 | Not applicable | This design places delivery measurements only. Customer compliance data placement is a separate design not yet written | none |
| C | HC-03 | Not applicable | Certificate hosting and signing are outside this design; it supplies the evidence packages certificates reference | none |
| C | HC-04 | Not applicable | Certification filings are outside this design, which only stores measurement data | none |
| C | HC-05 | Not applicable | Calculation is outside this design; it stores calculation inputs only and has no calculation path | none |
| C | HC-06 | Conditional | The store accepts values only from an ingestion service with device identity, and agents have no ingestion permission (DES-0001 section 2). Whether provenance can be recorded for every source depends on the unknown measurement interfaces | D-019 |
| C | HC-07 | Conditional | Edge queue, ordered repeat-safe synchronisation and gap reporting remove the dependency on live connectivity (NFR-005, FR-006). Buffer sizing and tolerated disconnection depend on D-020 | D-020; D-018 |
| C | HC-08 | Conditional | Append-only storage and sequence numbers are required of the store (SEC-008), but the tamper-evidence mechanism is undecided | D-013 |
| C | HC-09 | Conditional | Agents are read-only by design (SEC-009), but the identity and action-catalogue enforcement model does not exist yet | D-027 |
| C | HC-10 | Satisfied | The design relies on no scheme or standard as binding (CN-004). Candidates V-10 and V-22 appear only as unverified | none |
| C | HC-11 | Satisfied | The design creates no resources and no code (CN-003); hosting is described, not deployed; deployment would be by humans under ADR-0002 | none |
| C | HC-12 | Satisfied | DES-0001 sections 3 to 9 contain no performance, availability or cost figures, and the figures lint in the validator passes (EV-0009) | none |

## 2. Perspective verdicts

| Perspective | Verdict | Findings | Reference | Linked risk |
|---|---|---|---|---|
| PV-01 | Concern | The design serves BR-002, BR-006 and BR-007. No measures or baselines exist (D-034), so benefit cannot be shown. Group reporting needs are unknown | DES-0001 sections 1 and 6 | RK-004 |
| PV-02 | Concern | The boundary is clear: ingestion and storage are deterministic and agents are read-only. Interfaces to meters and existing systems are unknown (D-019, D-035) | DES-0001 section 2 | RK-005 |
| PV-03 | Concern | Placement follows the sovereignty matrix. The meaning of residency is undecided (D-009) and no per-port flow inventory exists | DES-0001 sections 2 and 5 | RK-001 |
| PV-04 | Not assessed | No Azure region or service has been verified for any jurisdiction and no landing zone exists (D-010, D-037). The reviewer will not infer availability | DES-0001 section 3 | RK-002 |
| PV-05 | Not assessed | Failure modes are listed, but no targets (D-031) or volumes (D-032) exist, so reliability and scalability cannot be judged | DES-0001 section 9 | RK-013 |
| PV-06 | Concern | Tamper evidence and key custody (D-013), identity and roles (D-027) and administration (D-033) are undecided | DES-0001 section 5 | RK-008 |
| PV-07 | Not assessed | The operating model (D-033) is undecided and the in-jurisdiction recovery design has not been done | DES-0001 sections 2 and 9 | RK-013 |
| PV-08 | Not assessed | No cost data exists and amounts must not be invented. Cost drivers are named in TD-001 but cannot be assessed | DES-0001 section 6 | RK-003 |
| PV-09 | Concern | The chain from reading to certificate is not designed beyond storage; sources are unknown (D-019); candidate standards are unverified (D-002) | DES-0001 section 5 | RK-009 |
| PV-10 | Concern | Strongest attacks: the jurisdiction assumption DA-001 may be wrong; the legal reading may permit more than assumed, undermining the case for the added cost; the edge buffer may itself be a cross-border copy (DA-005); buffer exhaustion; methodology drift between ports; the option E federated variant may dominate C once D-011 is known | DES-0001 sections 3, 6 and 7 | RK-001; RK-006 |

## 3. Requirement overrides

| Requirement | Author status | Reviewer status | Reason |
|---|---|---|---|
| BR-007 | Addressed | Partial | The design provides an edge queue, but the disconnection period and buffer behaviour at the limit are unknown (D-020), so the requirement cannot be shown to hold |
| FR-001 | Addressed | Partial | The meter interface and signing capability are unknown (D-019), so ingestion integrity cannot be judged |
| DATA-001 | Addressed | Partial | Placement is stated, but no catalogue with residency and isolation tags exists |

## 4. Defence dispositions

| Question | Disposition | Answer or reason | Reference |
|---|---|---|---|
| DQ-01-01 | Answered | Serves BR-002, BR-006 and BR-007. No measure or baseline exists and none is invented (D-034) | DES-0001 section 1 |
| DQ-02-01 | Answered | Ingestion, storage and sequencing are deterministic software; agents only read | DES-0001 section 2 |
| DQ-02-03 | Answered | The edge queues, verifies locally, and synchronises in order with gap reporting when the link returns | DES-0001 FR-006 and NFR-005 rows |
| DQ-03-01 | Unanswered | Placement comes from the sovereignty matrix, but no per-flow evidence or negative tests exist because no flow inventory has been done for any port | none |
| DQ-03-02 | Unanswered | The meaning of residency per port is undecided (D-009); the design is blocked until it is | none |
| DQ-04-01 | Unanswered | No Azure service or region has been verified for any jurisdiction (D-010, D-037) | none |
| DQ-04-03 | Answered | The design deploys nothing; humans deploy and agents hold no deployment rights | ADR-0002 |
| DQ-05-01 | Answered | Failure modes with detection, behaviour and recovery are listed; two recoveries are marked not yet designed | DES-0001 section 9 |
| DQ-05-02 | Answered | No availability, recovery or performance target exists (D-031) and the design makes no such claim | D-031 |
| DQ-06-01 | Unanswered | Agent and human identities and roles are not defined (D-027) | none |
| DQ-07-01 | Unanswered | The operating model and support access are undecided (D-033) | none |
| DQ-07-02 | Answered | Telemetry holding bound data stays in the jurisdiction; export only on an approved flow | DES-0001 SEC-014 row |
| DQ-08-01 | Answered | Drivers: one deployment and operating arrangement per jurisdiction, edge hardware, local hosting, licences for reference data. No amounts, because none exist | DES-0001 TD-001 |
| DQ-09-02 | Unanswered | Protection of readings between meter and storage depends on unknown source interfaces (D-019) | none |
| DQ-10-01 | Answered | Strongest case against option C is its operational multiplication and lost group visibility. It does not win over B because B violates HC-01; the costs are recorded as risks | DES-0001 TD-001; TD-002 |
| DQ-10-02 | Answered | DA-001: more than one jurisdiction. If only one, the question dissolves. Tested by D-003. Also DA-005: the edge buffer is inside the jurisdiction | DES-0001 DA-001; DA-005 |
| DQ-10-03 | Answered | A: no shared evidence binding. B: violates HC-01. D: durability and audit access undesigned (HC-08 unresolved). E: deferred until what may cross (D-011) is known | DES-0001 section 4 |

## 5. Gate result
Gate runs are recorded by the evidence recorder: EV-0007 (declared status checked against the computed result), EV-0008 (what-if: option B selected, which the gate rejects), EV-0009 (the repository validator, including the figures lint) and EV-0010 (what-if: option E selected, which the gate refuses to pass as unscreened). The computed result for option C is Blocked, matching the declared status. This section states nothing that those runs did not produce.

## 6. Conditions to proceed
1. The owner answers or defers the decisions listed in DES-0001 section 10; the gate lists which ones block.
2. Verify Azure region and service availability per jurisdiction, from authoritative sources, before PV-04 can be assessed.
3. Split scope: certificate hosting (FR-026), edge security (SEC-013), retention (DATA-006) and non-production environments (DATA-009) belong to sibling designs. Until then they keep this design Blocked.
4. Run the per-port flow inventory F-01 to F-15 for at least the first port in scope.
5. Once D-011 is answered, compare option E against option C properly; E may be the better design.
6. A human decider and an independent human review are needed before any approval. This record was produced by a model.
