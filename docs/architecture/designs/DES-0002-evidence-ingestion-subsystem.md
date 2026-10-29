# DES-0002: Jurisdiction-local, tamper-evident evidence ingestion subsystem

This is the end-to-end acceptance scenario of the harness (see [HARNESS-ACCEPTANCE-REPORT](../../acceptance/HARNESS-ACCEPTANCE-REPORT.md)). It is a real design question, assessed honestly against the approved baseline. It is **not** an approval: the gate computes Blocked (see [RV-0002](../reviews/RV-0002-evidence-ingestion-subsystem.md)). No Azure resource and no application exist or were created. The only code produced is a **candidate contract and reference model** with synthetic fixtures ([ingestion-contract.mjs](../../../harness/contracts/ingestion-contract.mjs)), written so the design can be tested before anything is built. Every statement about Azure services is provisional ([ADR 0014](../../adr/0014-azure-readiness-scaffold-and-provisional-selection.md)). No performance, availability or cost figure appears here, and no standard or scheme is treated as binding.

- **Design ID:** DES-0002
- **Review:** RV-0002
- **ADRs:** ADR-0015
- **Tags:** DATA, EDGE
- **Scope capabilities:** EDG
- **Extra requirements in scope:** BR-002, BR-006, FR-002, SEC-001, SEC-002, SEC-008, SEC-012, DATA-001, NFR-001, NFR-009, AGT-003

## 1. Decision question
How do delivery measurement events (meter readings, blend entries, transfer start and end) get from the barge or terminal into an evidence store inside the originating port jurisdiction, so that the link to shore may be intermittent, nothing is lost, duplicated or silently reordered, any later alteration is detectable, and no data leaves the jurisdiction by the act of ingestion? This serves BR-007 (intermittent connectivity never prevents a delivery being evidenced), BR-002 (verifiable evidence) and BR-006 (residency). It follows [DES-0001](DES-0001-delivery-measurement-storage-topology.md), which places the authoritative store in the jurisdiction (option C there); this design is the path into that store. It is needed now because the evidence store, the edge and the certificates all depend on what an ingested event is guaranteed to be.

## 2. Options

| Option | Name | Summary | Disposition |
|---|---|---|---|
| A | Online-only ingestion | The edge sends each event to the shore ingestion service as it happens, with no durable local log. If the link is down the event is not captured | Rejected (hard constraint) |
| B | Edge hash-chained log with store-and-forward | The edge appends each event to a local append-only log, each event carrying a per-source sequence number, a trusted time and the hash of the previous event. Batches are forwarded when the link allows. The jurisdiction cell verifies the chain, accepts events once in sequence, holds a batch that has a gap, ignores an identical repeat, refuses a repeat with different content, and stores accepted events immutably | Selected |
| C | Managed ledger as the system of record | Events are written straight to a ledger service for integrity; the edge keeps only a plain queue | Deferred |
| D | Post-delivery file export | An operator exports the meter log after the delivery and uploads it | Not selected |

Exactly one option is Selected. Option A has a Violated verdict in [RV-0002](../reviews/RV-0002-evidence-ingestion-subsystem.md).

## 3. Alternatives comparison

| Criterion | A | B | C | D |
|---|---|---|---|---|
| Capture continues with no shore link | Does not meet: no durable local capture, so an outage loses events | Meets: capture is local and forwarding is deferred | Conditional: needs a local queue, and the integrity guarantee exists only after the ledger write | Meets: the log exists on the meter side, but only after the delivery |
| Tamper evidence before the data reaches shore | Does not meet: nothing is chained at the source | Conditional: a chain detects alteration after sealing and, with the stand-alone store check, alteration of what was accepted; it does not stop a party who can rewrite the queue before first ingestion, or the store and its chain together, from re-hashing consistently. Authenticity and an external anchor need D-013 | Conditional: protection starts at the ledger, so events held at the edge are unprotected | Does not meet: a file can be edited between export and upload |
| Detects loss, duplication and reordering | Unknown: depends on the transport | Meets: contiguous sequence, gap reporting, identical repeats ignored, conflicting repeats refused (contract tests) | Conditional: depends on the ledger feature set, which is unverified | Does not meet: no sequence at source |
| Stays inside the jurisdiction | Conditional: the shore service must be in the jurisdiction (D-009, D-010) | Conditional: the edge, the buffer and the cell are all zones Z1 and Z2 by construction; whether that is enough is D-009 | Unknown: availability of any ledger service in the jurisdiction is unverified | Conditional: as B |
| Operational complexity | Meets: least to run | Conditional: an edge component and a verifier per jurisdiction | Conditional: a further managed service per jurisdiction | Meets: least to run, most manual work |
| Reversibility | Meets | Meets: the chain is a data format, so the store behind it can change | Conditional: ledger content is hard to move | Meets |
| Depends on undecided items | Conditional | Conditional: D-013, D-018, D-019, D-020, D-021 | Conditional: D-013 mostly | Conditional |

## 4. Requirement trace

| Requirement | Design element | How addressed | Status | Validation plan or evidence |
|---|---|---|---|---|
| BR-007 | Edge log and store-and-forward | Capture and local verification never wait for shore; forwarding resumes later and is repeat-safe | Partial | Contract tests EVAL-PRC-DAT-007. The tolerated disconnection and buffer limits are undecided (D-020) |
| FR-001 | Edge capture component, event contract | A reading is an event with a registered device identifier, kind, trusted time and sequence. The device identifier is registered with the cell, not authenticated; proving that the device produced the reading needs signing (D-013). The meter interface is unknown | Partial | Contract fixture only. Needs D-019, D-013 and the edge platform (D-018) |
| FR-006 | Forward and reconcile | The shore copy is the accepted chain; held batches, gaps and repeats are reported and never altered | Partial | EVAL-PRC-DAT-007. A real disconnection test needs an edge component that does not exist |
| SEC-013 | Edge device controls | Device authentication, signed software, protected storage and updates are not designed here | Unresolved | Edge security design (sibling, planned). Needs D-018 |
| DATA-002 | Event record and immutable store | Each raw event keeps its source, trusted time and sequence; gaps and reordering are detected by verification | Partial | EVAL-PRC-DAT-007, EVAL-PRC-DAT-008. The trusted-time source and sequence rules are D-021 |
| AGT-010 | Deterministic path | Ingestion contains no model and no agent; it runs when AI services are off | Partial | Design rule only. An integration test needs the application |
| NFR-004 | Edge buffer | Capture and local verification continue offline for the period D-020 will set; behaviour at the limit is not defined | Unresolved | Needs D-020 and the edge platform |
| NFR-005 | Sequence and idempotency | Per-source contiguous sequence; identical repeats ignored; gaps reported; conflicting repeats refused | Partial | EVAL-PRC-DAT-007 on the reference model. Resumable transport is not designed |
| NFR-006 | Local append, asynchronous forward | Capture is local and never waits for shore; failure handling at the edge is not designed | Partial | Needs the edge component and a failure test |
| NFR-017 | Clock source and skew rule, owned by the verifier | The cell checks time against its own clock and its own permitted skew, never a value the sender supplies; time may not go backwards within a source; the registered clock source must match; the skew has no default | Partial | EVAL-PRC-DAT-008. The approved clock source, the tolerance and the drift record are D-021 |
| BR-002 | Chained events as the base of the package | Gives the evidence package intact, ordered inputs; package completeness is not designed here | Partial | Sibling design for the evidence package. See RV-0002 overrides |
| BR-006 | Jurisdiction rule against the verifier's identity | Every jurisdiction and zone claim in a batch is compared with the cell's own identity and registry, never with the other claims; a source from another jurisdiction cannot be registered; flows other than ingestion are not covered | Partial | EVAL-PRC-SOV-004. Needs the per-port flow inventory (D-003, D-009) |
| FR-002 | Blend event | A blend entry is an event that must name its product, who entered it and who approved it, with its origin recorded; the approval is a recorded identifier, not an authenticated approval | Partial | Contract tests. Authenticated approval and source binding are a sibling design |
| SEC-001 | Cell and zone placement | Edge buffer and shore cell are zones Z1 and Z2; no replica, backup or log placement is designed here | Partial | EVAL-PRC-SOV-004 for the ingestion flow only. The per-port inventory is not done |
| SEC-002 | Administration | Not designed here: who can administer the edge and the cell, and from where. Whoever can write the store can rewrite events and recompute the chain unless chain heads are anchored outside the cell | Unresolved | Identity and roles design (sibling, planned). Needs D-033, D-027 |
| SEC-008 | Append-only store and chain | The store takes events once, in order, and refuses a replay with different content; a stand-alone check of the stored records finds a deleted or edited record. The store's own immutability is a property of the evidence store | Partial | EVAL-PRC-DAT-007. Store immutability is checked only in the Azure scaffold, not deployed |
| SEC-012 | Untrusted input | Event fields are data. Identifiers match a strict pattern, payloads are typed per kind, unknown fields are refused, and no hostile text is echoed into a message. Ingestion never renders event data into an agent prompt | Partial | Contract tests. Prompt-injection tests exist for the harness, not for the future agents |
| DATA-001 | Zone and classification of the event | Each event class is raw measurement data (zone Z1 and Z2 only); the catalogue with residency and isolation tags is not built | Partial | Needs the data catalogue |
| NFR-001 | Hash chain, conflict check and stand-alone store check | In-flight alteration, removal, reordering, replay and a re-hashed replacement are detected, and a deleted or edited accepted record is detected from the stored records. A party who can rewrite the whole store and its chain consistently is not detected: that needs signing and an external anchor | Partial | EVAL-PRC-DAT-007 on synthetic fixtures. Independent verification outside the cell and anchoring are not designed |
| NFR-009 | Continuous residency evidence | Not designed here: configuration and flow evidence on a cadence | Unresolved | Needs the per-port flow inventory and the cadence decision (D-009) |
| AGT-003 | Origin rule | An event whose origin is a model is refused; a missing reading is reported, never estimated; every accepted record is marked unauthenticated | Partial | EVAL-PRC-SOV-004, EVAL-PRC-DAT-007. Authentic origin needs device signing (D-013) |

## 5. Tradeoffs

| ID | We gain | We give up | Borne by | Reversible | Links |
|---|---|---|---|---|---|
| TD-001 | Capture that continues without shore and detectable alteration | An edge component and a verifier to build, run and keep current in every jurisdiction | Port operations, platform owner | Partly: the chain is a data format, but edge software is deployed per port | DA-001, RK-005 |
| TD-002 | No event is taken out of order, so evidence stays reconstructable | Shore visibility of a batch is delayed while an earlier batch is missing | Quality manager, commercial reviewer | Yes: a hold rule can change without changing the data | NFR-005, RK-005 |
| TD-003 | Integrity and ordering are provable now, on synthetic data | Authenticity (who produced a batch) waits for the signing decision, so every accepted record is marked unauthenticated and an evidence package must not treat it as trusted | Security architect, compliance counsel | Yes: a signature can be added to the batch format | D-013, RK-007 |
| TD-004 | A conflicting repeat is refused and kept visible instead of overwriting | A refused batch needs a person to investigate and may stall that source | Quality manager | Yes | SEC-008, RK-005 |

## 6. Assumptions and constraints

| ID | Assumption | If wrong | Validate by |
|---|---|---|---|
| DA-001 | The edge can run an append-only log and compute hashes (AS-005) | The chain moves to the nearest controllable device and unprotected time grows | Edge platform decision (D-018) and a prototype on the chosen platform |
| DA-002 | An approved trusted time source exists at the edge and drift can be recorded (D-021) | The timestamp rules cannot be enforced and NFR-017 stays open | Time-source decision and a drift test |
| DA-003 | A per-source sequence number survives restarts and power loss at the edge | A restart can reuse a number, which the cell reports as a conflict | Edge persistence test |
| DA-004 | A meter or its gateway can emit events that the edge can chain (D-019) | Events enter through an operator export, which is option D | Meter interface survey |
| DA-005 | The edge buffer and the cell are both inside the originating jurisdiction (AS-005) | Ingestion itself crosses a border | Per-port flow inventory (D-003, D-009) |

| ID | Constraint | Source |
|---|---|---|
| CN-001 | Ingestion never moves delivery measurement data outside its jurisdiction | HC-01 |
| CN-002 | Capture never depends on a live shore connection | HC-07 |
| CN-003 | Evidence integrity and audit reconstruction must hold | HC-08 |
| CN-004 | No model may originate a measurement or fill a missing one | HC-06 |
| CN-005 | No resource is created and no application code is written in Phase 0 | HC-11 |
| CN-006 | Standards and schemes stay candidates until verified | HC-10 |
| CN-007 | No performance, availability or cost figure without a source | HC-12 |

## 7. Risks

| Risk | Residual note |
|---|---|
| RK-005 | The contract defines gap, hold and repeat behaviour, but buffer size and the tolerated disconnection are unknown (D-020), so loss at the limit is not excluded |
| RK-007 | Chain integrity does not depend on keys, but authenticity does. An edge that is compromised, or a party who can reach the endpoint, can compute a perfectly valid chain of false events. Key custody, device enrolment and revocation, and the signing mechanism are undecided (D-013) |
| RK-008 | Administration and support access to the edge and the cell are not designed here. A party who can write the store can rewrite events and recompute the chain unless chain heads are anchored outside the cell |
| RK-001 | If residency obligations cover metadata, telemetry or a transit path, a flow the contract does not model could breach them |
| RK-009 | Any scheme or standard the evidence content must follow is a candidate and unverified (D-002) |

## 8. Open decisions that affect this design
D-013 (tamper-evidence mechanism and key custody): signing of batches. D-018 (edge platform): where the log runs and who owns the hardware. D-019 (meter interfaces and document types): how events are produced. D-020 (maximum disconnection and permitted offline actions): buffer behaviour at the limit. D-021 (trusted time, sequence and drift rules): the clock source and the skew. D-003, D-009, D-010, D-011 (ports, residency meaning, hosting, approved flows): whether the edge and cell placement is enough. D-027 (identity and action model) and D-033 (operating model): administration. D-031 (availability, recovery and latency targets): recovery of the cell. D-037 (tenant and subscription): where it would run. The gate derives the blocking decisions from the trace.

## 9. Failure modes
Detection, behaviour and recovery. No figure is stated.

| Failure | Detected by | Behaviour | Recovery |
|---|---|---|---|
| Shore link down | Forwarding times out; the edge records its last synchronisation | Capture continues locally; forwarding retries | On return the edge forwards in order; the cell holds a batch with a gap until the gap is filled |
| Batch delayed or lost in transit | A later batch arrives with a sequence gap | The later batch is held and the gap reported with the time it was first seen; nothing is taken out of order | The edge resends the missing range; the held batch is then taken. A gap that stays open raises an alert whose age threshold is not decided |
| Batch redelivered | Every event is already stored with the same hash | Ignored as a repeat; nothing changes | None needed |
| Replay with different content | An accepted event identifier arrives with a different hash | Refused and kept visible as a possible replacement; accepted evidence untouched | A person investigates; the edge log is compared with the cell chain |
| Edge log altered | The chain or the batch hash no longer matches | The batch is refused | Forensics on the edge device; the cell chain is the reference |
| Edge or sender compromised | Not detected by the chain: a valid chain of false events looks consistent | Accepted and marked unauthenticated | Needs signing and enrolment (D-013); until then no record is treated as trusted |
| Accepted record deleted or edited in the store | The stand-alone store check finds a missing or changed record or a broken link | Alarm; the store is not trusted until investigated | Restore inside the jurisdiction from the immutable store; a rewrite of the whole chain needs an external anchor, not designed |
| Unregistered source or device | The sender is not in the cell's registry | Refused | A person enrols it through the registry process, not designed here |
| Clock manipulated or drifted | Time goes backwards in a source, exceeds the cell's clock plus the cell's own permitted skew, or is older than the cell's own maximum event age (a required parameter with no default, D-020) | The batch is refused and recorded as an integrity finding | Clock repair; resubmission under a person's decision |
| Delivery lifecycle irregular | An event arrives with no start, a second start, or after the end of its delivery | The event is kept as evidence (refusing it would discard evidence and stall the source) and the delivery is flagged for a person; the derived state is recomputed from the stored events by the stand-alone check | A person reviews; the evidence package states the irregularity |
| Forged but consistent continuation | Not detected by the chain: a party who can reach the endpoint can append a consistent continuation that advances the chain, after which the real edge reports a conflict | Accepted and marked unauthenticated; the genuine edge then stalls | Needs signing, enrolment and a quarantine rule for unauthenticated batches (D-013). Not designed here |
| Store head or batch commitment removed | The stand-alone check takes the set of sources from events, heads and batch commitments together, so a removed head is reported | Alarm; the store is not trusted until investigated | Restore inside the jurisdiction; whoever can rewrite the whole store still needs an external anchor |
| Unbounded stream from a registered source | Not limited by the contract: limits apply per batch only | Storage can grow without bound | Needs a source rate, store quota and an overload disposition that never loses evidence silently (D-020, D-031). Not designed here |
| Meter reading missing | A delivery ends with no reading | Reported as an incomplete delivery; no value is estimated | A person reviews; the evidence package states the gap |
| Edge restart reuses a sequence number | The cell sees a used sequence with a different event | Refused as a conflict | Edge persistence fix; investigation |
| Cell store unavailable | Ingestion errors | The edge keeps buffering; the cell reports ingestion lag | Recovery inside the jurisdiction (not yet designed) |
| A model or tool output tries to enter as a measurement | The origin is not device, operator or import | Refused | None: that path is closed by design |

## 10. Scoped implementation plan
Nothing below has started, and none of it may start before the owner raises the phase (HC-11). Each step names its exit evidence. No effort, cost or duration is estimated.

| Step | Scope | Exit evidence | Needs |
|---|---|---|---|
| P0 (done in this stage) | Candidate contract, reference model, synthetic fixtures, tests, evaluation checks | tests/ingestion-contract.test.mjs and EVAL-PRC-DAT-007, EVAL-PRC-DAT-008, EVAL-PRC-SOV-004 pass in a committed run | Nothing |
| P1 | Decide the signing mechanism, edge platform, meter interfaces, maximum disconnection and trusted time | Decided ADRs for D-013, D-018, D-019, D-020, D-021 | The owner and the named roles (T34, T31) |
| P2 | Add batch signing, device enrolment and revocation, and an external anchor for chain heads once D-013 is decided; add the effective-period and trusted-time rules to the lineage contract (roadmap R16) | The two lineage evaluation tests pass; the ingestion contract gains signature, enrolment and anchor tests; records stop being marked unauthenticated only through signature verification | P1 |
| P3 | Design the siblings this one depends on: edge security and platform, evidence store immutability and recovery, identity and roles, per-port flow inventory | Design records and reviews through the gate | P1, the owner (R13, R17) |
| P4 | Raise the phase. Build the edge capture component and the cell ingestion service against the contract as the acceptance oracle | Contract tests pass against the real components; a controlled disconnection test | The owner (T36) and DG-01 to DG-12 |
| P5 | Non-production deployment under signed approvals, smoke and integration tests, runbooks exercised | DG-06 to DG-10 records | Signed approvals, the subscription (T32, T33) |

Nothing in P4 or P5 is authorised by this document.
