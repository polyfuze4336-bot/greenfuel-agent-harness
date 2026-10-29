# RV-0002: Review of DES-0002

This review covers the end-to-end acceptance scenario: a jurisdiction-local, tamper-evident evidence ingestion subsystem. It was produced by two independent read-only model agents (a design critic and a security reviewer, each run twice) and synthesised by the author session. It is not an approval: no human decider has been named, no human reviewed it, and the gate computes Blocked.

- **Review ID:** RV-0002
- **Design:** DES-0002
- **Checkpoint:** CP3
- **Status:** Blocked
- **Reviewer:** independent model agents (design critic and security reviewer, two rounds); independent human review not yet done
- **Decider:** pending
- **Date:** 2026-10-29

## 1. Hard-constraint screen

| Option | Constraint | Verdict | Reason | Conditions |
|---|---|---|---|---|
| A | HC-07 | Violated | Online-only ingestion has no durable local capture, so an outage loses events and capture depends on a live shore connection | none |
| B | HC-01 | Conditional | The cell identity and the source registry are owned by the verifier, so a batch cannot assert its own jurisdiction. This does not prove legal residency, hosting, support, backup, telemetry or approved flows | D-003; D-009; D-010; D-011 |
| B | HC-02 | Unresolved | There is no shipowner identity, isolation boundary or access partition in this design, and deliveries are not bound to a shipowner | D-015; D-027 |
| B | HC-03 | Not applicable | Certificate hosting and signing are outside this subsystem. The design reviewer judged this Unresolved because signing and key custody are undecided; the author keeps Not applicable because no certificate is produced here, and the disagreement is recorded | none |
| B | HC-04 | Not applicable | No filing or approval path is designed here | none |
| B | HC-05 | Not applicable | No calculation or methodology path is in scope | none |
| B | HC-06 | Conditional | An origin of model is refused and a missing reading is reported, never estimated. Device and operator identity are registered, not authenticated, so every accepted record is marked unauthenticated | D-013; D-019 |
| B | HC-07 | Conditional | Capture and local verification never wait for shore, but the buffer limit, the tolerated disconnection, the behaviour at the limit and the recovery of the cell are undecided | D-018; D-020; D-031 |
| B | HC-08 | Conditional | Hash chain, per-source sequence, conflict refusal and a stand-alone store check are implemented and tested. A party who can rewrite the whole store and recompute every commitment is not detected without signing and an external anchor | D-013; D-018; D-021 |
| B | HC-09 | Satisfied | The ingestion contract is deterministic and contains no model and no agent (AGT-010; DES-0002 section 4) | none |
| B | HC-10 | Satisfied | No standard or scheme is treated as binding (CN-006); any such reference is a candidate and unverified | none |
| B | HC-11 | Satisfied | No Azure resource was created and no application was built (CN-005). The only code is a candidate contract and reference model with synthetic fixtures | none |
| B | HC-12 | Satisfied | DES-0002 sections 3 to 9 state no performance, availability or cost figure (CN-007) and the figures lint passes | none |

## 2. Perspective verdicts

| Perspective | Verdict | Findings | Reference | Linked risk |
|---|---|---|---|---|
| PV-01 | Concern | The design serves BR-002, BR-006 and BR-007. No measure or baseline exists (D-034), so benefit cannot be shown | DES-0002 section 1 | RK-004 |
| PV-02 | Concern | The boundary is clear: ingestion is deterministic and no agent is involved. Interfaces to meters and existing systems are unknown (D-019, D-035) | DES-0002 sections 2 and 4 | RK-005 |
| PV-03 | Concern | Placement follows the sovereignty matrix. The meaning of residency is undecided (D-009) and no per-port flow inventory exists | DES-0002 sections 4 and 6 | RK-001 |
| PV-04 | Not assessed | No Azure region or service has been verified for any jurisdiction and no landing zone exists. The reviewer will not infer availability | DES-0002 section 8 | RK-002 |
| PV-05 | Concern | Failure modes are listed with detection, behaviour and recovery. No targets (D-031) or volumes (D-032) exist, and cumulative store growth and source rate are not bounded by the contract | DES-0002 section 9 | RK-013 |
| PV-06 | Concern | Integrity is implemented, authenticity is not: any party who can reach the endpoint can append a consistent forged continuation, which also stalls the genuine edge. Signing, enrolment and quarantine are undecided and disclosed (D-013). Administration is undesigned | DES-0002 sections 7 and 9 | RK-007 |
| PV-07 | Not assessed | The operating model (D-033) is undecided and the in-jurisdiction recovery design has not been done | DES-0002 section 9 | RK-013 |
| PV-08 | Not assessed | No cost data exists and amounts must not be invented | DES-0002 section 5 | RK-003 |
| PV-09 | Concern | The chain from reading to certificate is not designed beyond ingestion. Authentic origin of a reading needs device signing (D-013) and the sources are unknown (D-019) | DES-0002 section 4 | RK-007 |
| PV-10 | Concern | Strongest attacks found by the reviewers and disclosed: a forged consistent continuation, a store writer who rewrites the whole chain, a flood of small valid batches, and an edge restart that reuses a sequence number. Option C may dominate B once D-013 is decided | DES-0002 sections 3, 7 and 9 | RK-008 |

## 3. Requirement overrides

| Requirement | Author status | Reviewer status | Reason |
|---|---|---|---|
| NFR-001 | Partial | Partial | Integrity of what was accepted is tested on synthetic fixtures. Detection of a whole-store rewrite needs signing and an external anchor, which do not exist |
| SEC-008 | Partial | Partial | The stand-alone store check finds a removed head, a deleted or edited record and an edited derived state. Immutability of the real store is not tested |
| NFR-004 | Unresolved | Unresolved | The offline buffer period and behaviour at its limit are undecided (D-020) |
| BR-006 | Partial | Partial | The jurisdiction rule is checked against the verifier's own identity for the ingestion flow only. No other flow is covered |

## 4. Defence dispositions

| Question | Disposition | Answer or reason | Reference |
|---|---|---|---|
| DQ-01-01 | Answered | Serves BR-002, BR-006 and BR-007. No measure or baseline exists and none is invented (D-034) | DES-0002 section 1 |
| DQ-02-01 | Answered | Ingestion, sequencing and verification are deterministic software. No agent or model takes part and a model-origin event is refused | DES-0002 AGT-003 row |
| DQ-02-03 | Answered | The edge logs locally, chains each event and forwards in order. The cell holds a batch with a gap, ignores an identical repeat and refuses a conflicting one | DES-0002 FR-006 and NFR-005 rows |
| DQ-03-01 | Answered | Edge buffer and cell are zones Z1 and Z2 and the verifier's own identity is the reference. The negative test for a foreign jurisdiction exists. The per-port flow inventory does not, so evidence is limited to the ingestion flow | DES-0002 BR-006 row |
| DQ-03-02 | Unanswered | The meaning of residency per port is undecided (D-009) and no legal source is verified | none |
| DQ-04-01 | Unanswered | No Azure service or region has been verified for any jurisdiction (D-010, D-037) | none |
| DQ-04-03 | Answered | The design deploys nothing. Deployment is by humans and the Azure deployment gates keep agents without deployment rights | ADR-0014 |
| DQ-05-01 | Answered | Failure modes with detection, behaviour and recovery are listed. Two recoveries are marked not designed | DES-0002 section 9 |
| DQ-05-02 | Answered | No availability, recovery or performance target exists (D-031) and the design makes no such claim | D-031 |
| DQ-06-01 | Unanswered | Agent and human identities and roles are not defined (D-027) | none |
| DQ-07-02 | Unanswered | Collection of logs and traces holding jurisdiction-bound data is not designed here | none |
| DQ-08-01 | Answered | Drivers: an edge component and a verifier per jurisdiction, edge hardware and local hosting. No amounts, because none exist | DES-0002 TD-001 |
| DQ-09-02 | Answered | Sequence, a chained hash and a registered device and source protect readings against in-flight alteration, removal and reordering. They do not prove who produced a reading: that needs signing (D-013) | DES-0002 TD-003 |
| DQ-10-01 | Answered | The strongest case against B is that integrity without authenticity can be defeated by a party who reaches the endpoint. It is disclosed, every record is marked unauthenticated, and it is recorded as a risk | DES-0002 RK-007 note |
| DQ-10-02 | Answered | DA-001 (the edge can run an append-only log) and DA-005 (edge and cell are both inside the jurisdiction). Tested by the edge platform decision and the per-port flow inventory | DES-0002 DA-001; DA-005 |
| DQ-10-03 | Answered | A violates HC-07. C stays Deferred because protection begins only at the ledger and availability is unverified. D has no sequence at source and a file can be edited before upload | DES-0002 section 3 |

## 5. Gate result
The computed result is Blocked, matching the declared status. The command is `node harness/scripts/design-gate.mjs docs/architecture/reviews/RV-0002-evidence-ingestion-subsystem.md`; its recorded run is listed in the test evidence index.

## 6. Conditions to proceed
1. The owner decides or defers D-013, D-018, D-019, D-020 and D-021: signing and key custody, edge platform, meter interfaces, offline limits and trusted time.
2. Design quarantine for unauthenticated batches, source rate and store quota, and an external anchor for chain heads, once D-013 is decided.
3. Split the siblings this design depends on: edge security (SEC-013), evidence store immutability and recovery, identity and roles, and the per-port flow inventory.
4. Verify Azure region and service availability per jurisdiction from authoritative sources before PV-04 can be assessed.
5. A human decider and an independent human review are needed before any approval. This record was produced by models.

## 7. Review history: failures and remediation
Two rounds were run by two separate read-only model agents. Neither agent wrote any file in the repository.

| Round | Finding | Severity | Remediation | Evidence |
|---|---|---|---|---|
| 1 | The sender controlled the receiving time, the policy and the jurisdiction claim, so the checks compared claims with claims | High | The verifier now owns the cell identity, registry, skew and clock. A batch carries none of them and unknown fields are refused | Contract tests |
| 1 | Event and delivery keys collided across sources and attacker-keyed objects allowed prototype keys | High | Identifiers use a strict pattern and live in maps keyed by source and identifier | Contract tests |
| 1 | Non-finite numbers and negative zero canonicalised to the same text | Medium | Payload validation refuses them | Contract tests with hand-written hash vectors |
| 1 | No independent check of what was accepted | High | The stand-alone store check was added | Contract tests |
| 1 | Hostile text from a batch could be echoed into messages, and a deeply nested payload could crash the verifier | Medium | Only formatted values are echoed and nesting is checked iteratively before any recursion | Contract tests |
| 2 | The stand-alone check could be bypassed by removing a source head | High | The set of sources is taken from events, heads and batch commitments, each key is checked against its record, and a malformed store is reported instead of crashing | Contract tests |
| 2 | A delivery could end or receive readings without a start | High | A delivery lifecycle rule marks such a delivery as anomalous. The events are kept as evidence and the derived state is recomputed from the stored events | Contract tests |
| 2 | Backdated events were bounded only by non-decreasing order | Medium | The verifier's own maximum event age is a required parameter with no default | Contract tests |
| 2 | The reviewer reported that the fixture could not construct a store | Reported | The fixture already supplies the maximum event age and the suite runs. No change was needed, and this is recorded as a mistaken finding | Contract tests |
| 2 | A forged consistent continuation advances the chain and stalls the genuine edge | High | Not fixed in code: it needs signing and quarantine (D-013). Disclosed in the design | none |
| 2 | Cumulative storage and source rate are not bounded | Medium | Not fixed: disclosed in the design as needing D-020 and D-031 | none |
| 2 | The whole-store rewrite is not detected | High | Not fixed: disclosed. Needs an external anchor | none |
