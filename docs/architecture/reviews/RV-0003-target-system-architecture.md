# RV-0003: Review of DES-0003

This review covers the system-level target architecture. It was drafted by the same session that wrote the design, then challenged by an independent read-only model reviewer whose findings are recorded in [09 Review and validation](../../target-architecture/09-REVIEW-AND-VALIDATION.md). It is **not an approval**: no human decider is named, no human has reviewed it, and the gate computes Blocked. A model reviewing a model's work shares blind spots (RK-012); the verdicts below are a record of what the gate can check, not independent assurance.

- **Review ID:** RV-0003
- **Design:** DES-0003
- **Checkpoint:** CP3
- **Status:** Blocked
- **Reviewer:** design review drafted by the author, with an independent read-only model critique (language models; no human review yet)
- **Decider:** pending
- **Date:** 2026-10-29

## 1. Hard-constraint screen

| Option | Constraint | Verdict | Reason | Conditions |
|---|---|---|---|---|
| A | HC-01 | Violated | By definition (DES-0003 section 2) option A holds data from every jurisdiction in one place, so data from all but one jurisdiction sits outside its originating jurisdiction, and a region choice is not proof. If only one jurisdiction is in scope (DA-001) the option as defined does not exist | none |
| C | HC-01 | Conditional | Placement, backups, logs, inference and administration are inside the cell by construction (DES-0003 section 2, ADR-0016). Whether each port's hosting satisfies its rule depends on what residency means (D-009), whether a qualifying hosting exists per port (D-010) and the approved derived flows (D-011) | D-009; D-010; D-011 |
| C | HC-02 | Conditional | Per-shipowner partitions of records, indexes, caches, logs, memory and credentials are inside the cell, and customer-facing agent work runs in a per-shipowner execution context with tenant-bound inference requests (DES-0003 sections 2 and 4, ADR-0017 item 7). The gateway holds the scope, not the agent. The customer entity model, policy format and the actual isolation properties of any inference endpoint are open and unverified | D-015; D-029; D-028 |
| C | HC-03 | Conditional | Certificates are signed in cell custody with an offline verification bundle (ADR-0018). What locally hosted is local to, and the custody and anchor mechanism, are undecided | D-012; D-013 |
| C | HC-04 | Conditional | The approval service is outside every agent's context and binds to the exact content hash; filing needs a separate approval (DES-0003 trace rows FR-027 and SEC-010). The quality-manager role and the identity model are open | D-007; D-027 |
| C | HC-05 | Conditional | The calculation service has no model on its path and results carry methodology, factor and build versions (ADR-0017, ADR-0018). Methodology governance and the reproducibility standard are open | D-022 |
| C | HC-06 | Conditional | No value or status originates from a model and missing values fail closed (ADR-0017); the design cannot guarantee provenance for sources whose interfaces are unknown | D-019; D-024 |
| C | HC-07 | Conditional | The edge buffers and signs; capture never waits for shore; sync is ordered and repeat-safe (DES-0003 trace rows BR-007 and NFR-005). Buffer sizing and offline rules depend on the disconnection period | D-020; D-018 |
| C | HC-08 | Conditional | Append-only store, chain per cell, lineage records and anchored digests (DES-0003 trace rows NFR-001 and FR-029, ADR-0018); the tamper-evidence mechanism is undecided | D-013; D-025 |
| C | HC-09 | Conditional | Permissions come from catalogue, role and approval enforced at the gateway, not from an autonomy label (ADR-0017); the identity and permission model does not exist yet | D-027; D-008 |
| C | HC-10 | Satisfied | DES-0003 relies on no scheme or standard as binding (CN-003); every named framework remains a candidate (D-002 stays open). The service matrix states no compliance claim | none |
| C | HC-11 | Satisfied | DES-0003 creates no resources and no code (CN-001); the evidence is documents plus an editable model script and an anonymous price retrieval; deployment is human-approved and deferred (T36, ADR-0016 rule 6) | none |
| C | HC-12 | Satisfied | DES-0003 sections 3 to 8 contain no cost, availability, latency or performance figure and the architecture validator's figures lint passes on them (see section 5); cost figures live in the business model with class labels and recovery or capacity values are marked placeholders (CN-002) | none |

## 2. Perspective verdicts

| Perspective | Verdict | Findings | Reference | Linked risk |
|---|---|---|---|---|
| PV-01 | Concern | The design serves BR-002, BR-006 and BR-007 and the model quantifies value, but every figure is a scenario assumption and no baseline exists (D-034); the base scenario does not pay back within three years and labour savings alone do not carry it | DES-0003 sections 1 and 8; business value model sections 1 and 3 | RK-004 |
| PV-02 | Concern | The deterministic-core versus agent boundary is clear (ADR-0017). Integration contracts are design-level and the meter, system and body interfaces are unknown (D-019, D-035, D-001) | DES-0003 section 4; ADR-0017 | RK-005 |
| PV-03 | Concern | Placement follows the sovereignty matrix and region choice is not proof, but the legal meaning of residency per port is undecided (D-009) and no per-flow inventory exists | DES-0003 sections 2 and 4; ADR-0016 | RK-001 |
| PV-04 | Not assessed | No Azure service or region was verified for any jurisdiction; only list prices were retrieved, which show a meter exists and nothing else (D-010, D-037). The reviewer will not infer availability | DES-0003 section 3; ADR-0019 | RK-002 |
| PV-05 | Not assessed | Failure domains and behaviours are described, but no recovery, availability or performance target exists (D-031, D-032) and the arithmetic uses placeholders | DES-0003 section 4; D-031 | RK-013 |
| PV-06 | Concern | Strongest controls are structural (gateway, approval service, per-cell keys); identity scope, key custody mechanism and the support model are open (D-027, D-013, D-033) | DES-0003 trace rows SEC-009 and SEC-010; ADR-0018 | RK-007 |
| PV-07 | Not assessed | The operating model and in-jurisdiction recovery design are not done and no cell has been operated (D-033) | DES-0003 trace rows SEC-002 and NFR-008; D-033 | RK-013 |
| PV-08 | Concern | The cost model exists with verified list prices as the only verified input; cost is dominated by repeated fixed costs and operations people, and the option 2 figure is a floor. No budget exists (D-034) | DES-0003 section 5 TD-001; D-034 | RK-003 |
| PV-09 | Concern | The chain from reading to certificate is designed end to end, but authenticity at the source depends on meter signing (D-019), the mechanism is undecided (D-013) and no scheme is verified (D-002) | DES-0003 trace rows FR-029 and SEC-008; ADR-0018 | RK-009 |
| PV-10 | Concern | Strongest attacks on the design: the jurisdiction assumption DA-001 may be wrong; counsel may read residency more narrowly (DA-003) and make cells unnecessary for some ports; global identity or management planes may themselves breach a port's rule; the model's value may be mostly the premium line, which is unmeasured; agents may add little beyond deterministic orchestration | DES-0003 section 6 DA-001 and DA-003; TD-005 | RK-004 |

## 3. Requirement overrides

| Requirement | Author status | Reviewer status | Reason |
|---|---|---|---|
| AGT-011 | Addressed | Partial | The separation of estates is a design rule, and the harness side is tested, but nothing separates real business agents from the coding harness in a built system; the production side has no test |
| BR-009 | Addressed | Addressed | Agreed: no code and no resources were created, and the phase is zero (validate-harness phase gate) |

## 4. Defence dispositions

| Question | Disposition | Answer or reason | Reference |
|---|---|---|---|
| DQ-01-01 | Answered | Serves BR-002, BR-006 and BR-007; measures are candidates with no baselines (D-034), and the model labels every figure | DES-0003 section 1; business value model |
| DQ-02-01 | Answered | Calculation, hashing, signing, posting, approval and isolation are deterministic services; agents prepare, retrieve and explain behind a gateway | ADR-0017 |
| DQ-02-03 | Answered | The edge keeps capturing, signing and queuing; on return it resumes from the last acknowledged sequence, idempotently, with gaps reported | DES-0003 trace row BR-007; design defence scenario 1 |
| DQ-03-01 | Unanswered | Placement by data class follows the sovereignty matrix, but no per-flow evidence or negative test exists because no port has been assessed | D-003 |
| DQ-03-02 | Unanswered | What within the jurisdiction means per port is undecided; the design is blocked until it is | D-009 |
| DQ-03-05 | Answered | Separate partitions for records, indexes, caches, logs, memory and credentials per shipowner; policy evaluated before retrieval at the gateway; isolation tests planned but not built | ADR-0017; design defence scenario 5 |
| DQ-04-01 | Unanswered | No Azure service or region has been verified for any jurisdiction; only list prices exist, which are not availability evidence | D-010 |
| DQ-04-03 | Answered | Humans deploy; agents hold no deployment rights; deployment is deferred and approval-gated | ADR-0016; ADR-0002 |
| DQ-05-01 | Answered | Failure domains from device to external body, each with what keeps working, what stops and how recovery stays in the jurisdiction | DES-0003 section 4; 03 Architecture views section 7 |
| DQ-05-02 | Unanswered | No availability, recovery or performance target exists and the design states placeholders only | D-031 |
| DQ-06-01 | Unanswered | Identities and roles are specified in principle (workload identity per component and agent; approval service outside agents) but the identity and permission model does not exist | D-027 |
| DQ-06-02 | Unanswered | Keys are held in cell custody in intent; the custody mechanism and who holds them are undecided | D-013 |
| DQ-07-01 | Unanswered | The operating model and support access are undecided; administration from inside the jurisdiction is the default | D-033 |
| DQ-07-02 | Answered | Logs, metrics and traces stay in the cell; export only on approved flows | DES-0003 trace row SEC-014; 03 Architecture views section 5 flow F11 |
| DQ-08-01 | Answered | Cost drivers are named per component and per cell, with amounts only as labelled scenario figures and Azure list prices from a cited source | business value model; ADR-0019 |
| DQ-09-01 | Answered | The chain from meter to certificate is shown stage by stage; the weakest link is authenticity at the meter | 03 Architecture views section 3; 06 Threat model TM-01 |
| DQ-09-02 | Answered | Signed batches, a durable buffer, contiguous sequences and gap reports protect readings from the meter into storage including while offline; authenticity needs device signing | 04 Integration contracts IC-02; 06 Threat model TM-02 and TM-05 |
| DQ-09-03 | Answered | Every standard and scheme is a candidate and none is relied on; D-002 stays open | DES-0003 CN-003; CERTIFICATION-SCHEMES |
| DQ-10-01 | Answered | The strongest argument against: per-jurisdiction fixed cost may exceed the value, and counsel may allow centralisation. It does not win because option A violates HC-01 as defined, and the cost of sovereignty is made explicit and the choice is reversible before production data exists | DES-0003 section 6 DA-001 and DA-003; ADR-0016 |
| DQ-10-02 | Answered | DA-001 (several jurisdictions) and DA-003 (residency covers processing and access) would break or reshape the design; both are tested early by D-003 and D-009 | DES-0003 section 6 |
| DQ-10-03 | Answered | Option A is rejected by HC-01; option B by HC-08 and agent access to raw evidence and its drift toward A; option D by the mandatory constraints and the five capabilities | DES-0003 section 2; 02 Architecture options |

## 5. Gate result
The gate computes **Blocked**. See the run recorded in 09 Review and validation (evidence identifier given there). The reasons it lists are the open decisions and unanswered critical questions above, not defects of the framework.

## 6. Conditions to proceed

1. The owner names a human decider and a human reviewer (T3, T37). Until then this review stays Blocked and ADRs 0016 to 0019 stay Proposed.
2. The owner answers or consciously defers D-003, D-009, D-010, D-011 (placement), D-013, D-012, D-006 (certificate and integrity), D-027, D-007, D-033 (identity, approval, operations), D-028 and D-030 (AI), D-031, D-032, D-034 (targets, volumes, value).
3. A subscription and read-only identity are granted so services can be verified per jurisdiction (T32, T33); no deployment is implied.
4. The business case is re-run on measured baselines before any funding decision.
5. A human reviews the design, the threat model and the business model; this model-written review is not a substitute.
