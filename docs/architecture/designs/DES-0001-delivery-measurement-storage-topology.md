# DES-0001: Storage topology for bunker delivery measurements

This is the worked example for the architecture-governance capability. It is a real design question, assessed honestly against the approved baseline. It is **not** an approval: the gate computes Blocked (see [RV-0001](../reviews/RV-0001-delivery-measurement-storage-topology.md)). No Azure resource is named or assumed. No figure appears because none exists.

- **Design ID:** DES-0001
- **Review:** RV-0001
- **ADRs:** ADR-0004
- **Tags:** DATA, EDGE, OPS
- **Scope capabilities:** SOV, EDG
- **Extra requirements in scope:** BR-002, SEC-008, SEC-009, SEC-014, NFR-001, NFR-007, NFR-008, NFR-013

## 1. Decision question
Where are bunker delivery measurements (raw meter readings, blend data and the evidence packages that bind them) held: in one central store for the whole group, or in stores located in each originating port jurisdiction? This serves BR-002 (verifiable evidence), BR-006 (residency) and BR-007 (intermittent connectivity). It is the first storage decision every capability depends on.

Data classes affected, from [DATA-CLASSIFICATION](../../context/DATA-CLASSIFICATION.md): DC-01 raw measurements, DC-02 evidence packages, DC-03 blend data, and the derived classes DC-06 and DC-07 that inherit their restrictions.

## 2. Proposed topology (option C, conceptual)
- **Edge.** Each delivery's readings are captured at the edge with device identity and a sequence number, held in a durable local queue, and verified locally. Nothing in capture depends on the shore link. The queue is a persisted buffer: it holds raw readings, so it is subject to the same placement, retention, recovery and purge rules as the store (assumption DA-005: the edge is inside the originating jurisdiction).
- **Authoritative store per jurisdiction.** Raw readings, blend data and evidence packages have one authoritative copy, in a store located in the originating port's jurisdiction (zones Z1 and Z2 in [SOVEREIGNTY-MATRIX](../../context/SOVEREIGNTY-MATRIX.md)). Its hosting model is not chosen: candidates H-1 to H-5 remain open (D-010).
- **Synchronisation.** Edge to store is ordered, safe to repeat, and reports gaps. Interrupted transfers resume.
- **Readers.** Agents and services that read raw data run inside the same jurisdiction. Agents hold read-only permission and no ingestion permission; ingestion is a non-agent service.
- **Group view.** Nothing crosses a border by default. Group-level views are built only from derived data on the approved flow list that D-011 must produce.
- **Operations.** Logs and telemetry that contain jurisdiction-bound data stay in the jurisdiction. Recovery copies stay in the jurisdiction. Administration from outside is denied by default (SEC-002).
- **Not designed here.** Certificate hosting and signing, certification filings, calculation, customer isolation, edge device security, identity and roles, tamper-evidence mechanism and key custody, non-production environments, and evidence-package completeness and reconstruction. Each needs its own design; this design states what it requires of them.

## 3. Options

| Option | Name | Summary | Disposition |
|---|---|---|---|
| A | Do nothing | Leave measurements in whatever operational systems each port uses today; build no shared platform. The current systems are not known (D-019, D-035) | Not selected |
| B | Single central store | Every port's edge forwards all readings to one group store in one location serving ports in several jurisdictions, and every capability reads from it | Rejected (hard constraint) |
| C | Jurisdiction-local authoritative stores | Raw and evidence-grade data has one authoritative copy in the originating jurisdiction; edge buffers locally; derived data crosses only on approved flows | Selected |
| D | Edge-only retention | Sovereign data is held only on edge devices at the vessel or terminal; shore holds derived data only | Not selected |
| E | Federated: local data planes with a shared control plane | As C, plus a shared group control plane for policy, configuration and non-sensitive metadata. What metadata and telemetry may cross is undecided (D-011) | Deferred |

## 4. Alternatives comparison

| Criterion | A | B | C | D | E |
|---|---|---|---|---|---|
| Residency (HC-01) | Unknown: where current systems keep data is not known (D-019, D-035) | Does not meet: one store serving several jurisdictions holds data outside the originating one | Conditional: stays local by intended topology; depends on D-009, D-010 and D-011 | Conditional: stays at the edge; depends on whether D-009 counts the edge as the jurisdiction | Conditional: as C, and the shared control plane adds a flow that D-011 must approve |
| Intermittent connectivity (HC-07) | Unknown: current behaviour not known | Conditional: needs an edge buffer and synchronisation design that this option does not remove | Conditional: same buffer and synchronisation design; buffer sizing needs D-020 | Meets: capture never depends on shore | Conditional: as C; a shared control plane must not be on the capture path |
| Evidence integrity and audit reconstruction (HC-08) | Unknown: current controls not known | Conditional: mechanism undecided (D-013) | Conditional: mechanism undecided (D-013); more places to protect | Unknown: durability and audit access at the edge are not designed | Conditional: as C |
| Group-level visibility | Does not meet: no shared view exists | Meets: one place to query | Conditional: only approved derived data crosses (D-011) | Does not meet: shore holds derived data only | Conditional: better than C for policy and status, same limit for raw data (D-011) |
| Operational complexity | Unknown: current effort not known | Meets: one platform to run | Does not meet: one deployment and one operating arrangement per jurisdiction (RK-003) | Does not meet: many devices at many sites to protect and update | Does not meet: per-jurisdiction deployments plus a shared plane to run |
| Reliability and recovery | Unknown: not assessed | Conditional: one failure domain affects every port | Conditional: failure domains per port, but recovery must stay in jurisdiction (RK-013) | Does not meet: loss of a device can lose evidence unless durability is designed | Conditional: as C; the shared plane is a new dependency to bound |
| Reversibility | Meets: nothing is built | Does not meet: data already held abroad has already breached the constraint; deleting it later does not undo that | Conditional: adding a central tier later needs an approved flow (D-011) | Conditional: moving data off the edge later needs the same approved flow | Conditional: a shared plane can be added to C later, subject to D-011 |
| Fit with the five capabilities | Does not meet: no shared evidence binding | Meets: simplest for cross-capability reads | Conditional: readers must run in-jurisdiction (D-028) | Conditional: readers need shore access to derived data only | Conditional: as C |
| Cost and licensing | Unknown: no cost data exists; not compared | Unknown: no cost data exists; not compared | Unknown: no cost data exists; not compared | Unknown: no cost data exists; not compared | Unknown: no cost data exists; not compared |
| Azure platform support | Unknown: nothing verified | Unknown: nothing verified | Unknown: nothing verified for any jurisdiction (D-010) | Unknown: nothing verified | Unknown: nothing verified |

## 5. Requirement trace

| Requirement | Design element | How addressed | Status | Validation plan or evidence |
|---|---|---|---|---|
| BR-002 | Evidence packages held in the authoritative store | This design gives the packages a defined home; completeness and independent reconstruction are not designed here | Partial | Sibling design for package completeness and reconstruction (plan) |
| BR-006 | Per-jurisdiction authoritative store | Raw data has its one authoritative copy in the originating jurisdiction; proof is not yet defined for any port | Partial | Per-port flow inventory and negative tests (plan); needs D-003 and D-009 |
| BR-007 | Edge queue and synchronisation | Capture and local verification never wait for shore | Addressed | Disconnection test (plan, NFR-004) |
| FR-001 | Edge ingestion with device identity | Readings carry device identity, timestamp and sequence at capture | Addressed | Simulated-meter hash comparison test (plan) |
| FR-006 | Edge queue and synchronisation | Offline capture, later ordered reconciliation, gap reporting | Addressed | Disconnection and reconciliation test (plan) |
| FR-026 | Not covered | Certificate hosting and signing are a separate design; this design supplies the local evidence packages certificates reference | Partial | Sibling design required |
| SEC-001 | Per-jurisdiction store; in-jurisdiction logs and recovery | Primary data, the edge buffer, replicas, backups and telemetry kept local by rule; evidence per flow not yet defined | Partial | Flow inventory F-01 to F-15 per port (plan); needs D-009 |
| SEC-002 | Administration rule | Outside administration denied by default | Partial | Access-denial tests (plan); operating model is D-033 |
| SEC-003 | Reader placement rule | Anything that reads raw data, including AI, runs in-jurisdiction; mechanism not designed | Partial | Processing-location evidence (plan); needs D-028 |
| SEC-004 | Approved derived-flow list | No flow by default; list does not exist yet | Partial | Approved flow register (plan); needs D-011 |
| SEC-008 | Append-only store | Stated as a requirement on the store; mechanism undecided | Partial | Tamper tests (plan); needs D-013 |
| SEC-009 | Read-only agent roles | Agents read only; identities and roles not defined | Partial | Role review (plan); needs D-027 |
| SEC-013 | Edge ingestion | Assumes authenticated ingestion; device security not designed here | Partial | Separate edge-security design |
| SEC-014 | In-jurisdiction telemetry | Telemetry holding bound data stays local; export per D-011 | Partial | Log-flow inventory (plan) |
| DATA-001 | Placement from the sovereignty matrix | Data classes placed in Z1 and Z2; catalogue tags not yet created | Addressed | Data catalogue review (plan) |
| DATA-002 | Edge sequence numbers; append-only store | Sequence assigned at edge; trusted time source undecided | Partial | Gap and reorder detection test (plan); needs D-021 |
| DATA-006 | Not covered | Retention periods are undecided | Unresolved | Retention matrix (plan); needs D-016 |
| DATA-009 | Not covered | No non-production boundary, masking approval path or enforcement mechanism is designed here | Partial | Sibling design for non-production environments (D-036) |
| AGT-010 | Deterministic ingestion and storage | Capture and storage never need an AI service | Addressed | Run with AI services disabled (plan) |
| NFR-001 | Append-only store | Detection requirement placed on the store; mechanism undecided | Partial | Tamper tests (plan); needs D-013 |
| NFR-004 | Edge queue | Longest disconnection is undecided, so the requirement cannot be sized | Unresolved | Disconnection test (plan); needs D-020 |
| NFR-005 | Synchronisation | Ordered, repeat-safe, resumable, gap-reporting | Addressed | Interrupted-synchronisation tests (plan) |
| NFR-006 | Edge queue | Capture is designed not to block operations; load at the edge not assessed | Partial | Load and failure tests (plan) |
| NFR-007 | Not covered | No availability target exists | Unresolved | Target from D-031 (plan) |
| NFR-008 | Not covered | In-jurisdiction recovery design not done; targets undecided | Unresolved | Recovery exercise (plan); needs D-031 |
| NFR-009 | Residency verification | Continuous verification needed; mechanism not designed | Partial | Drift-detection tests (plan); needs D-009 |
| NFR-013 | Correlation identifiers | Identifiers from edge through store planned | Partial | End-to-end trace of one delivery (plan) |
| NFR-016 | Per-jurisdiction independence | Each jurisdiction captures and stores without the others | Addressed | Inter-port isolation drill (plan) |
| NFR-017 | Not covered | Trusted time source undecided | Unresolved | Drift test (plan); needs D-021 |

## 6. Tradeoffs

| ID | We gain | We give up | Borne by | Reversible | Links |
|---|---|---|---|---|---|
| TD-001 | An intended residency-preserving topology and independence of each port | The simplicity and likely lower cost of running one platform; one deployment per jurisdiction | Operations teams and the programme owner | Partly: a central tier can be added later only on an approved flow | RK-003; D-011 |
| TD-002 | A defensible answer to CS-C1, if D-009 confirms the reading | Group-level visibility of raw data; group views use approved derived data only | Group reporting and commercial staff | Partly: depends on what D-011 permits | RK-004; SEC-004 |
| TD-003 | A port keeps capturing and storing when links to others fail | Consistency of methodology and reference-data versions must be actively managed across ports | Quality manager | Yes: the distribution mechanism can change | RK-006 |
| TD-004 | Recovery that stays inside the jurisdiction | The resilience of a design with copies in several countries | The programme owner holds the residual risk | Partly: cross-border copies need a legal basis | RK-013; D-011 |

## 7. Assumptions and constraints

| ID | Assumption | If wrong | Validate by |
|---|---|---|---|
| DA-001 | More than one port jurisdiction is in scope (AS-003) | Option B as defined does not exist and the comparison changes | D-003 |
| DA-002 | Suitable hosting exists inside each jurisdiction (AS-009) | Option C cannot be built for that port | Verify per port before committing (D-010) |
| DA-003 | Edge devices can buffer, sequence and verify readings (AS-005, AS-006) | The capture design needs a different shape | Equipment survey (D-019) |
| DA-004 | Group views can work from approved derived data | Pressure to centralise returns | Owner review of reporting needs (D-011) |
| DA-005 | The edge buffer is physically inside the originating jurisdiction (AS-005) | The buffer itself is a cross-border copy and HC-01 is at risk | Equipment and vessel-movement survey (D-019) |

| ID | Constraint | Source |
|---|---|---|
| CN-001 | Delivery measurement data stays in its originating jurisdiction; region choice is not proof | HC-01 |
| CN-002 | Capture cannot depend on live shore connectivity | HC-07 |
| CN-003 | No resource creation or application code in Phase 0 | HC-11; ADR-0002 |
| CN-004 | Standards and schemes are candidates until verified | HC-10 |

## 8. Risks

| Risk | Residual note |
|---|---|
| RK-001 | Open until D-009 is Decided |
| RK-002 | Open until hosting is verified per port |
| RK-003 | Accepted as part of the tradeoff only if the owner funds it |
| RK-004 | Open until D-011 produces the approved flow list |
| RK-005 | Open until D-019 and D-020 are answered |
| RK-006 | Open; needs a methodology distribution design |
| RK-008 | Open until D-033 is answered |
| RK-010 | Open; balancing boundary undecided |
| RK-013 | Open; recovery design not done |
| RK-014 | Open; the gate checks structure and consistency, not truth |

## 9. Failure modes (qualitative)

| Failure | Detection | Behaviour | Recovery |
|---|---|---|---|
| Shore link lost | Edge sees failed synchronisation | Capture continues into the local queue | Resume ordered synchronisation; report any gap |
| Edge queue full | Edge capacity alert | Alert operators; manual fallback per port procedure | Drain after reconnection; investigate sizing (D-020) |
| Edge device lost or damaged | Missing heartbeat or sequence gap | Evidence since last synchronisation may be lost | Depends on durability design; not yet designed |
| Authoritative store unavailable | Synchronisation errors | Edge queues continue | Restore inside the jurisdiction; design not done |
| Corrupted or duplicated transfer | Sequence and integrity checks | Reject and request resend | Resume from last good sequence |
| Clock drift at the edge | Drift check against the approved time source | Flag affected records | Review ordering; source undecided (D-021) |

## 10. Open decisions that affect this design
D-003 (which jurisdictions), D-009 (meaning of residency), D-010 (hosting model and existence), D-011 (approved derived flows), D-013 (tamper evidence and keys), D-016 (retention), D-018 (edge platform), D-019 (measurement sources), D-020 (disconnection period), D-021 (trusted time), D-028 (AI inference location), D-031 (targets), D-033 (operating model), D-036 (non-production data). The gate derives the blocking subset from the traceability of the in-scope requirements.
