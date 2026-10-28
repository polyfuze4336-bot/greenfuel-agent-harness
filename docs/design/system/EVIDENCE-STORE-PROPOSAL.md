# Proposal: jurisdiction-local evidence store for delivery measurement evidence

Status: Proposed, authored, unverified (revision 2). This is a proposal, not a decision. Nothing in it is approved or accepted. Phase 0: documents only. No resource is created, no code or infrastructure-as-code is written (HC-11).

Labels used: FACT (with source file path), ASSUMPTION, DECISION (a proposed decision, not yet taken by a human). Verdicts in this file are the author's proposed reading in the vocabulary of docs/architecture/HARD-CONSTRAINTS.md; they are not review verdicts. The design-review gate (docs/architecture/DESIGN-REVIEW-GATE.md) records the real ones.

## What changed in this revision

1. Per-constraint verdicts: addressed. A verdict table for the selected option is in "Requirement trace". The earlier claim "the only one with a written path" is withdrawn. HC-01, HC-02 and SEC-001 are Conditional or Unresolved while D-009, D-010, D-011, D-015 and D-016 are open.
2. Cell-level components: addressed. "Component inventory" lists each component as shared or per-shipowner. Every shared entry is flagged as a candidate HC-02 violation. Remaining shared entries are UNRESOLVED.
3. Alternative not eliminated by a hard constraint: addressed. Option B2 (per-shipowner-per-port stores) is added with a selection criterion; a fixed port-side edge variant and an in-jurisdiction versus external anchoring variant are also compared. The pick between B1 and B2 is a proposal only, pending D-015 and D-016.
4. Tamper-test matrix: addressed in "Tamper-test matrix". Two cases cannot be shown as always detected from this design (edge compromise before first anchor; anchor window). They are marked UNRESOLVED against SEC-008.
5. Edge in the flow inventory: partly addressed. The edge is added as a proposed inventory row F-16 and its location after departure is stated as UNRESOLVED (depends on D-010, D-020, D-009). It cannot be settled without a human decision on who owns the edge device.
6. Readers of evidence: addressed in "Readers of the evidence". Every reader outside the jurisdiction is a cross-border flow needing D-011 and a legal basis; none is approved here.
7. Verifier: partly addressed. Operator and location are proposed; "independent" is defined; availability of an independent party is an ASSUMPTION. Derived-value placement is stated. The operator is not named because naming one is a human decision.
8. Expiry scenario: addressed in "Expiry and legal-hold scenario". Retention length stays open (D-015).
9. Trace table and tests: addressed. SEC-002, SEC-006 and SEC-014 are cited. SEC-006 requires automated adversarial tests with zero cross-tenant disclosures. The HC-12 statement is stated as an unevidenced author assertion (no EV record exists).

Also, a stray empty working file named EVIDENCE-STORE-PROPOSAL.md.new was created by mistake in this folder by the author. It holds no design content and should be deleted by a human or the orchestrator; the author has no delete tool.

## Purpose and scope

FACT: Raw meter readings are the primary evidence (docs/context/REQUIREMENTS.md, FR-001). Raw delivery measurement data is classed Restricted, port-bound, evidence-grade (docs/context/DATA-CLASSIFICATION.md, DC-01); delivery evidence packages contain it (DC-02).

This proposal shapes a store that holds that evidence so that four properties hold together: port-jurisdiction residency, per-shipowner isolation, append-only tamper evidence, and offline edge reconciliation. It does not choose products, regions, sizes or prices.

## Requirement trace

| Requirement or constraint | What it demands (FACT, source) | How the proposal responds |
|---|---|---|
| FR-001 | Every meter reading is stored with original value, device id and timestamp, bound to the delivery (docs/context/REQUIREMENTS.md) | Store raw readings unchanged as the primary record; derived values reference them and never replace them |
| FR-006 | Capture offline at the edge; reconcile later without altering; nothing lost; sequence gaps reported explicitly (docs/context/REQUIREMENTS.md) | Edge sequence-numbered, hash-chained capture; shore copy verified against edge hashes; gaps reported, never filled silently |
| SEC-001 | Store and process only in the originating port jurisdiction, including replicas, backups, logs, telemetry; a region is not proof; cannot be accepted until D-009 exists (docs/context/REQUIREMENTS.md) | PROPOSED approach only: one store per port jurisdiction, with evidence per flow. The mapping of this design's flows to F-01 to F-15 (docs/context/SOVEREIGNTY-MATRIX.md) is begun below (edge, readers, verifier) but NOT complete. Status: UNRESOLVED, cannot be assessed until D-009 and the per-port record exist |
| SEC-002 | Deny outside administrative and support access by default; break-glass inside the jurisdiction (docs/context/REQUIREMENTS.md) | Administration and break-glass inside the cell; access-denial tests; operator model is D-033. Status: Conditional on D-009, D-011, D-033 |
| SEC-006 | Prove isolation by test; automated adversarial tests on each release and on a schedule, with zero cross-tenant disclosures (docs/context/REQUIREMENTS.md) | Structure removes shared components where possible; proof is an automated adversarial test suite run each release and on a schedule with zero cross-tenant disclosures as the pass condition. No such tests exist yet. Status: Unresolved |
| SEC-014 | Security logs and monitoring inside the jurisdiction; log flows on the SEC-001 inventory; exports follow D-011 (docs/context/REQUIREMENTS.md) | Logs are per-shipowner and in-jurisdiction in B2; log flow is F-04 on the inventory. Status: Conditional on D-011 |
| SEC-008 | Append-only and tamper-evident; tamper tests that modify or delete are always detected (docs/context/REQUIREMENTS.md) | Hash chain plus delivery manifest plus store-level sequence plus anchors; see the tamper-test matrix. Two cases are not shown as always detected. Status: Conditional on D-013, D-019 and anchor cadence; Unresolved for edge compromise |
| HC-01 | Data stays in the originating jurisdiction; region choice is not proof (docs/architecture/HARD-CONSTRAINTS.md) | Residency rests on legal definition (D-009), flow inventory and negative tests, never on region selection alone. Status: Conditional on D-009, D-010, D-011; treated as Unresolved while any is open |
| HC-02 | No shared index, cache, log view, credential or compute context across shipowners (docs/architecture/HARD-CONSTRAINTS.md) | Isolation by structure per shipowner, not by agent instruction. Status: Unresolved while shared entries remain in the component inventory and D-015, D-016 are open |
| HC-07 | Capture must not depend on live shore connectivity; no undetectable loss or reordering (docs/architecture/HARD-CONSTRAINTS.md) | Edge is the first writer of record; shore is a replica that reconciles |
| HC-08 | Evidence cannot be changed or deleted undetectably; certificates trace to raw readings (docs/architecture/HARD-CONSTRAINTS.md) | Corrections are new linked records (FR-030); original retained |
| HC-11 | No agent resource creation or autonomous deployment (docs/architecture/HARD-CONSTRAINTS.md) | Documents only; any later provisioning is a human-raised phase |
| HC-12 | No unsourced figures (docs/architecture/HARD-CONSTRAINTS.md) | The author wrote no performance, cost, availability or compliance figures. This is a self-assertion: no EV record supports it, and the FACT labels in this file likewise have no EV record. qa-engineer or design-reviewer must check |
| HC-03 | Certificates tamper-evident and locally hosted at the D-012 location; verification must not need a service outside it (docs/architecture/HARD-CONSTRAINTS.md) | This store holds evidence, not certificates (DC-08). If the verifier or anchors are reused for certificates, D-012 applies. Status: Unresolved |

### Proposed per-constraint verdicts for the selected option (author's reading, for the gate to confirm or reject)

The selected option is the Option B family; the choice between B1 and B2 is open (see Options). Verdicts apply to B2 unless stated.

| Constraint | Proposed verdict | Reason and blocking decisions |
|---|---|---|
| HC-01 | Conditional (treat as Unresolved) | Needs D-009 (meaning of within the jurisdiction), D-010 (hosting), D-011 (approved flows). Flow mapping to F-01 to F-15 is incomplete. Hashes and anchors may be in scope |
| HC-02 | Unresolved | Shared entries remain (see Component inventory). Physical substrate sharing is unknown (D-010). D-015, D-016 open |
| HC-03 | Unresolved | Not the main subject; depends on D-012 if verifier is reused for certificates |
| HC-04 | Not applicable | No filing approval path in this store |
| HC-05 | Not applicable | No emissions calculation in this store; derived values only referenced (FR-001) |
| HC-06 | Not applicable | The store records meter values; it generates none. Input provenance is D-019 |
| HC-07 | Conditional | Edge-first design avoids live shore dependency; needs D-020 (offline duration) and edge storage sizing (TBD, see OPEN-QUESTIONS) |
| HC-08 | Conditional | Needs D-013 (mechanism), D-015 (retention), and resolution of the two UNRESOLVED tamper cases |
| HC-09 | Not applicable | No agent permission is created here |
| HC-10 | Satisfied as written | Named techniques are labelled candidates (docs/context/CERTIFICATION-SCHEMES.md). Reviewer to confirm |
| HC-11 | Satisfied as written | Documents only; nothing provisioned. Reviewer to confirm |
| HC-12 | Conditional on review | Author found no figures; no EV record yet |

## Proposed shape (DECISION proposals, not taken)

1. Jurisdiction cell. One logical boundary per port jurisdiction. Raw readings, evidence packages, replicas, backups, logs, telemetry, identity and key management for that cell are placed and administered inside that jurisdiction. Location inside the cell is not isolation: which of these components are per-shipowner is set out in "Component inventory". Residency rules are parameters per port, not one global setting (ASSUMPTION AS-010 in docs/context/ASSUMPTIONS.md).
2. Shipowner partition. Inside a cell, each shipowner has its own storage container, keys, credentials, index and compute context. No cross-shipowner cache, embedding store or log view (HC-02). Operator-owned evidence common to a delivery is handled under the open isolation decisions (D-015, D-016).
3. Append-only tamper evidence. Each record carries a content hash and the hash of its predecessor within a delivery chain. Chain heads are periodically anchored to an independent record that a verifier can read without the application. Immutability is enforced at the storage layer and by role design, with the write role unable to modify or delete. Candidate building blocks such as trusted timestamping and transparency logs are design input only (docs/context/CERTIFICATION-SCHEMES.md, V-32); suitability and legal weight are unverified. Anchors must themselves stay in-jurisdiction if they derive from raw data (SEC-001).
4. Edge first. The edge device writes each reading to a local append-only log with sequence number and hash chain, signed if the meter or logger supports it (D-019 open). On reconnection it uploads in order; shore verifies hashes and sequence and reports gaps explicitly. Edge-to-shore relays and brokers must be in-jurisdiction (SOVEREIGNTY-MATRIX F-11).
4. Edge first. The edge device writes each reading to a local append-only log with sequence number and hash chain, signed if the meter or logger supports it (D-019 open). On reconnection it uploads in order; shore verifies hashes and sequence and reports gaps explicitly. Edge-to-shore relays and brokers must be in-jurisdiction (SOVEREIGNTY-MATRIX F-11). The edge chain alone is not independent of an edge compromise (see the tamper-test matrix).
5. Verification. A verifier re-computes chains and compares anchors; its operator, location and meaning of "independent" are set out in "Verifier" below.
6. Delivery manifest and store sequence (DECISION, proposed). Besides the per-delivery chain, each delivery is opened with a registered opening record (delivery id, device id, session id) and closed with a closing record stating the final count and head hash. Each shipowner store also keeps one store-level monotonic sequence across deliveries. These two additions are what make tail truncation and whole-delivery deletion visible; the per-delivery chain alone does not.

## Component inventory (cell level)

FACT: HC-02 rejects any index, cache, embedding store, memory, log view, credential or compute context shared across shipowners (docs/architecture/HARD-CONSTRAINTS.md). Any "shared" entry below is a candidate HC-02 violation.

| Component | Option B1 (partitions in one cell) | Option B2 (per-shipowner-per-port store) |
|---|---|---|
| Raw reading storage | per-shipowner | per-shipowner |
| Index | per-shipowner | per-shipowner |
| Cache | per-shipowner | per-shipowner |
| Compute context for ingest and query | per-shipowner by design intent; substrate sharing UNRESOLVED (D-010) | per-shipowner; substrate sharing UNRESOLVED (D-010) |
| Credentials and identity directory | SHARED (cell-level identity) - candidate HC-02 violation | per-shipowner credentials; any identity service that issues them is a shared component, UNRESOLVED (D-017) |
| Key management root | SHARED (cell-level) - candidate HC-02 violation | per-shipowner keys and custody; root of trust UNRESOLVED (D-013) |
| Logs and log view (SEC-014) | SHARED if collected at cell level - candidate HC-02 violation | per-shipowner log stream and view; any collector is shared, UNRESOLVED |
| Telemetry and metrics (F-04) | SHARED if cell level - candidate HC-02 violation | per-shipowner; aggregate telemetry must exclude shipowner data, UNRESOLVED |
| Management plane (F-08) | SHARED - candidate HC-02 violation | SHARED unless split; UNRESOLVED |
| Anchor log | SHARED if one log for all - candidate HC-02 violation | per-shipowner anchor chain |
| Verifier | SHARED if one instance - candidate HC-02 violation | per-shipowner instance or context |
| Operator-owned evidence common to a delivery | Handled under D-015 and D-016; UNRESOLVED | same |
| Edge device | per-delivery; if one device serves deliveries for several shipowners it is shared, UNRESOLVED | same |

Result: B1 as originally written has five or more candidate HC-02 violations. B2 reduces them but leaves management plane, identity issuance, collectors and physical substrate as UNRESOLVED. This proposal does not claim HC-02 is satisfied.

## Edge in the SEC-001 flow inventory

DECISION (proposed): add row F-16 to the per-port inventory: "Edge device storage, edge hardware location and edge custody". The F-01 to F-15 inventory (docs/context/SOVEREIGNTY-MATRIX.md) covers the edge link (F-11) but not the edge device holding the first copy.

FACT: Zone Z1 is defined as computing located with the delivery operation inside the originating jurisdiction, and this rests on assumption AS-005 (docs/context/SOVEREIGNTY-MATRIX.md).

UNRESOLVED: where the edge device sits and who owns it after the delivery operation departs. If the device is on a vessel or barge that sails, the first copy of raw data leaves the jurisdiction (HC-01) in a way no region choice addresses. Variants: (E1) fixed port-side edge, owned or contracted by the port-side operator, readings captured at the terminal; (E2) vessel-borne edge, which needs D-009 and D-011 answers about carrying data out; (E3) shore-hosted first record, which depends on live connectivity and is eliminated by HC-07. Proposed: E1, pending D-009, D-010, D-019, D-020. Ownership and custody of the device: TBD (see OPEN-QUESTIONS).

## Readers of the evidence

FACT: Delivery evidence packages (DC-02) contain raw data and are Restricted, port-bound; placement in Z5 and Z7 is conditional and Z3, Z4, Z6 are prohibited (docs/context/DATA-CLASSIFICATION.md, docs/context/SOVEREIGNTY-MATRIX.md).

| Reader | Zone (location) | Flow status |
|---|---|---|
| Shipowner users | Z5 if outside the jurisdiction; may be Z2 if reading in-jurisdiction | Outward delivery is a cross-border flow: Conditional on D-014, D-009 legal basis, D-011 approved flow (F-14). UNRESOLVED |
| Certification body or scheme verifier | Z7 | Conditional on D-025, D-009, D-011. UNRESOLVED |
| Registries, authorities, auditors, arbitrators | Z7 | Conditional on D-025 or D-014 (disputes), D-009, D-011. UNRESOLVED |
| Verifier of tamper evidence | proposed Z2 | See "Verifier" |
| Operator and support staff | Z2 if in-jurisdiction; Z6 if outside | Z6 denied by default (SEC-002); D-033 |
| Group or regional hub staff | Z3 | Prohibited for DC-01 and DC-02 in the matrix |
| AI agents or inference | Z4 | Prohibited for DC-01 and DC-02 in the matrix (F-07) |

Proposed rule (DECISION): no outward delivery path exists until a legal basis is verified and the flow is on the approved list. A reader who can only be served from outside the jurisdiction receives nothing in the meantime; whether a derived, redacted package may leave is a D-011 question.

## Verifier

DECISION (proposed): "Independent" means independent of (a) the application code path that writes evidence, (b) the operators and administrators of the store, and (c) the edge device, with the verifier's own credentials and access scope. It does not mean independent of the jurisdiction: verification of raw-derived data runs in-jurisdiction.

- Operator: UNRESOLVED. A party not administering the store is wanted. ASSUMPTION: a suitable independent in-jurisdiction party exists per port; this is unverified. If none exists, independence from (b) cannot be met and SEC-008 and HC-08 stay Conditional.
- Location: in the originating jurisdiction (Z2), because it reads DC-01 data and hashes derived from it (SEC-001).
- Per-shipowner separation: one verifier context and credential set per shipowner store in B2; a single verifier across shipowners would be shared (candidate HC-02 violation).
- Derived values: hashes, chain heads, anchors and verification reports are computed and stored in the same cell as the data they derive from (FR-001, SEC-001), treated as in-scope until counsel says otherwise (D-009, D-011).
- Offline verification of certificates against an outside service is out of scope here (HC-03, D-012).

## Tamper-test matrix

SEC-008 requires that modification or deletion is always detected (docs/context/REQUIREMENTS.md). Each row is a test case to be written; none has been run.

| Case | Detection point | Status |
|---|---|---|
| Modify a record | Verifier recomputes the record hash and chain; mismatch at that record. Also mismatch against the latest anchor | Expected detected, untested |
| Delete the tail of a delivery | Closing record states final count and head hash; shore receipts of the head hash; manifest mismatch. A per-delivery chain alone would not show it | Detected only if the closing record or a later anchor already exists. Tail deleted before any anchor or receipt is UNRESOLVED |
| Delete a whole delivery | Store-level sequence shows a gap; opening record registered in the store-level sequence and anchored. A per-delivery chain alone would not show it | Detected after the next anchor covering the sequence; before it, a window exists. UNRESOLVED for that window; anchor cadence TBD (see OPEN-QUESTIONS, D-013) |
| Reorder records | Sequence number and predecessor hash mismatch at the first out-of-order record | Expected detected, untested |
| Replay a record or a delivery | Record hash binds delivery id, device id, session id and sequence; a duplicate or foreign-delivery record fails the binding and duplicate sequence check; replay of a whole prior session fails session id and store-level sequence | Expected detected, untested; session-id design depends on D-019 |
| Edge compromise before first upload | Shore cannot tell; the edge chain was written by the compromised party. Partial mitigations: device signing where supported (D-019), meter-side counters, shore head receipts sent back to the edge | UNRESOLVED. Not shown as always detected; SEC-008 remains Conditional |
| Tamper inside the anchor window | Between periodic anchors an administrator rewriting the store and its chain is detected only if receipts or other copies exist | UNRESOLVED; needs D-013 |
| Write role abuse | Write role cannot modify or delete; any role change is itself logged per shipowner | Expected, untested |

Signing is optional (D-019). Without it, cases involving edge and anchor-window attacks cannot be closed.

## Expiry and legal-hold scenario

Scenario: a record reaches expiry (D-015 open; retention period TBD, see OPEN-QUESTIONS). Proposed handling (DECISION): payload removal is performed only by a retention process holding an approval reference; it appends a disposal record (record id, approval reference, time, legal-hold check result) to the chain and the store-level sequence, and the payload hash stays in the chain so that the chain still verifies. The verifier treats a record with a matching disposal record as authorised disposal, and a missing record without one as tampering. A legal hold blocks disposal and the hold is itself recorded. ASSUMPTION: keeping a payload hash after disposal is permitted; counsel must confirm (D-009, D-015). If not permitted, SEC-008 detection of later deletion would depend on the disposal record alone and the verdict stays Conditional.

## Options

Selection criterion (DECISION, proposed): among options not eliminated by a hard constraint, prefer the one with the fewest shared components in the inventory above (HC-02 exposure), and then the one that needs the fewest unverified legal assumptions. Operability is a tie-break only, because HC-02 cannot be traded off.

Option A: Single shared store per port, shipowner separation by row-level access rules. Eliminated: shared index and compute context across shipowners; isolation relies on rules the application enforces (HC-02). A straw option kept for the record.

Option B1: Per-jurisdiction cell with per-shipowner partitions, shared cell-level identity, key management, logs and telemetry. Not eliminated outright, but carries five or more candidate HC-02 violations (see inventory). Pro: fewer stores to run. Con: HC-02 Unresolved at best.

Option B2: Per-shipowner-per-port stores, each with its own keys, credentials, logs, anchor chain and verifier context, plus a fixed port-side edge, anchoring in-jurisdiction (proposed, not decided). Pro: fewest shared components; not eliminated by any hard constraint. Con: more stores, keys and anchors to operate; cost and effort not estimated (no figures); management plane still shared, UNRESOLVED.

Option C: One central store in a single cloud region with per-port logical tags and replication. Eliminated: residency would rest on region selection and tagging, rejected by SEC-001 and HC-01.

Option D: Distributed ledger shared across ports and parties. Eliminated as stated: replication of evidence-grade data to all nodes risks HC-01 unless nodes are per-jurisdiction and payloads are off-ledger. May be revisited for anchors only.

Variant comparison on two further choices:

- Anchoring, in-jurisdiction versus counsel-approved external. In-jurisdiction anchoring is not eliminated and avoids a new cross-border flow (HC-01, F-13). External anchoring is Conditional on D-009 treating hashes as outside scope or D-011 approving the flow; until then it is treated as No. Proposed: in-jurisdiction. Whether a suitable in-jurisdiction anchor exists at each port is an ASSUMPTION.
- First record, edge versus shore: shore-hosted first record is eliminated by HC-07; vessel-borne edge versus fixed port-side edge is covered under "Edge in the SEC-001 flow inventory".

Pick between B1 and B2: by the criterion, B2 is proposed, because B1 has more shared components. This is a proposal; the human isolation decisions D-015 and D-016 may change it. No option is shown here to satisfy HC-01, HC-02 or SEC-001; the verdict table gives the current reading.

## Assumptions

- ASSUMPTION: Hosting model per port (in-country cloud region, hybrid or edge-hosted, on-premises, partner) is unknown; whether an in-country Azure region exists and meets residency is to be verified, not assumed (D-010, docs/context/DECISION-REGISTER.md).
- ASSUMPTION: Hashes and anchors derived from raw data may or may not count as measurement data; treated as in-scope until counsel says otherwise.
- ASSUMPTION: Edge devices have enough local persistent storage for the offline duration; the duration is TBD (see OPEN-QUESTIONS, D-020).
- ASSUMPTION: Meters or loggers may not support signing; manual entry with approval may exist (D-019).
- ASSUMPTION: Retention periods and legal hold rules are unknown (TBD, D-015).
- ASSUMPTION: In-jurisdiction support and break-glass staffing exists per port (SEC-002, D-033).
- ASSUMPTION: A suitable independent verifier party and an in-jurisdiction anchor exist at each port; unverified.
- ASSUMPTION: Edge device ownership and location after departure are unknown (see UNRESOLVED in the edge section).

## Risks

- R8: Shared management plane, identity issuance or log collector breaks per-shipowner isolation (HC-02, SEC-006). Mitigation: shrink shared set; automated adversarial tests with zero cross-tenant disclosures; effectiveness unverified.
- R9: Whole-delivery or tail deletion inside the anchor window goes undetected (SEC-008). Mitigation: opening and closing records, store-level sequence, receipts; unresolved.
- R10: Outward delivery to shipowners or certifiers is an unapproved cross-border flow (HC-01, D-011).
- R11: Vessel-borne edge carries first copies out of the jurisdiction (HC-01).
- R12: Disposal at expiry is indistinguishable from tampering if disposal records are missing (D-015).
- R1: Residency misread. If D-009 defines jurisdiction more broadly than storage (access, metadata, telemetry, AI inference), cell boundaries must widen. Mitigation: keep rules parameterised per port; no acceptance before D-009.
- R2: Remote support or management plane reaches data from outside the jurisdiction (SEC-002, F-08). Mitigation: in-jurisdiction administration and break-glass; negative tests.
- R3: Anchoring or timestamping service sits outside the jurisdiction and leaks derived data. Mitigation: in-jurisdiction anchors or counsel-approved flow on the approved list (D-011).
- R4: Edge compromise or clock error corrupts the first record. Mitigation: device identity, signed capture where possible, clock-discrepancy flagging; effectiveness unverified.
- R5: Key loss or partition misconfiguration blocks access or leaks across shipowners. Mitigation: per-shipowner keys, tested isolation (HC-02); key custody design is open.
- R6: Backups or disaster recovery copies fall outside the jurisdiction (F-02, F-03). Mitigation: in-jurisdiction targets and restore tests.
- R7: Unverified claims. All standards and techniques named are candidates (docs/context/CERTIFICATION-SCHEMES.md); none is a compliance claim.

## Open questions

- D-009: legal meaning of "within the jurisdiction" per port (storage, processing, access, backups, metadata, telemetry, AI inference). Human decision by compliance counsel and sovereignty lead. Not made here.
- D-003: which port jurisdictions are in scope.
- D-010: hosting model per port.
- D-011: approved cross-border flows and legal basis, if any.
- D-013: tamper-evidence mechanism and verifier approach.
- D-015 and D-016: retention and isolation model between shipowners and operator.
- D-019: meter, logger and signing interfaces.
- D-020: offline duration to be supported.
- D-033: operator access model and break-glass owner.
- D-014 and D-025: disclosure to customers, and to external recipients.
- D-012: location fixed for certificates, if the verifier is shared with certificates.
- D-017: identity location and model.
- Edge ownership, custody and location after departure; anchor cadence; retention period: TBD (see OPEN-QUESTIONS).

## Unverified claims for qa-engineer

- All FACT citations to file paths and requirement wording were read from the repository but not independently re-checked.
- The repository validators have not been run on this file by the author.
- No claim in this proposal has been tested; completion is authored, unverified.
- No EV record supports the HC-12 "no figures" statement or any FACT label; qa-engineer or design-reviewer must check.
- The validators were not run by the author, and the links rule in docs/instructions (relative Markdown links) was set aside because this task forbade Markdown links; reviewers should decide which applies.
- The stray file EVIDENCE-STORE-PROPOSAL.md.new must be removed.
