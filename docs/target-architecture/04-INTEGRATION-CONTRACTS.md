# 04 Integration contracts

Status: proposed, Phase 0. These are **design-level contracts**: they say who talks to whom, what is carried, what is guaranteed and what happens when the other side is down. They are not wire protocols and not schemas to build. One contract, IC-02 (edge to ingestion), has an executable **candidate** oracle, [ingestion-contract.mjs](../../harness/contracts/ingestion-contract.mjs), exercised on synthetic fixtures by the existing tests; its schema id ends in `v0-candidate`, so it is a test oracle for ideas under decision and not a decision. All others are untested designs. Wire formats, device protocols and external endpoints depend on D-019, D-035, D-001 and D-006 and are not chosen.

## Rules every contract follows

| Rule | Statement | Source |
|---|---|---|
| Canonical identifiers | Delivery, batch, tank, vessel, customer and methodology version have one identifier each, issued in one place, matching a strict pattern; identifiers are treated as hostile input | DATA-004 |
| Idempotency | Every write carries an identity (source, session, sequence or content hash) so a repeat is accepted once and a conflicting repeat is a reported conflict, never a silent overwrite | NFR-005 |
| Trusted time | A timestamp is judged against the receiving side's clock, not the sender's; a batch carries no `receivedAt`, policy or jurisdiction claim for the verifier to believe | ADR 0013 |
| No free text across a boundary | Fields crossing a trust boundary are typed, bounded and matched to a pattern; free text stays inside the cell and is marked untrusted | SEC-012 |
| Missing is missing | A missing value is a recorded gap with a reason, never a default, an estimate or a model output | HC-06, FR-010 |
| Provenance on every item | Source, device or person, method of capture and trust status travel with the value | DATA-003, DATA-008 |
| Versioned and explicit | Each contract has a version; each calculation names methodology, factor set and build | HC-05, FR-009 |
| Failure is a state | Timeouts, partial delivery and rejection are explicit states with defined next steps, not exceptions that vanish | NFR-005, NFR-006 |
| Least data | A contract carries only the listed fields; adding a field is a design change with a data-class review | DATA-001, SEC-004 |

## Contract register

| ID | From to | Carries | Guarantees | When the other side is down or the call fails | Status and open decisions |
|---|---|---|---|---|---|
| IC-01 | Meter or logger to edge capture | Readings with device id, unit, value, device time | Capture reads, never writes to the meter; source recorded | Missing reading recorded as a gap with a reason; capture continues for other sources | Interface unknown: meter makes, protocols, signing (D-019, SEC-013) |
| IC-02 | Edge buffer to cell ingestion | Signed batch: source and device identity, session, contiguous sequence range, event payloads, batch hash chained to the previous | Ordered, repeat-safe, gap-reporting; the verifier owns identity, clock and policy; unauthenticated records are marked as such until signing exists | Edge keeps queueing durably; resumes from the last acknowledged sequence; a conflicting replay is quarantined and reported | Candidate oracle exists (DES-0002); signing and clock mechanism open (D-013, D-021, D-020) |
| IC-03 | Ingestion to evidence store and ledger | Accepted events, binding records, package manifest with item hashes and completeness status | Append-only; a package manifest lists every bound item and its hash; completeness is a computed status, not an assertion | Accepted events are held in a durable queue; no partial package is presented as complete | Design only; mechanism for tamper evidence open (D-013) |
| IC-04 | Calculation request to calculation service | Delivery id, inputs hash, scheme id, methodology id and version, factor set id and version | Deterministic; the response and the stored record carry inputs hash, methodology and factor versions, build id and outputs; re-run reproduces or explains the difference | Fails closed on a missing input or factor (FR-010); returns a refusal code, never an estimate | Methodology set and governance open (D-022); schemes unverified (D-001, D-002) |
| IC-05 | Methodology registry to calculation service | Signed methodology package: code or parameters, factor sets with source citation, approver, effective period, retire date | Signature verified before use; old versions kept for reproduction; effective dates enforced | Cell keeps using the last verified version; staleness is shown; a package that fails verification is rejected and alerted | Lifecycle owner and signing open (D-022, SEC-015) |
| IC-06 | Mass-balance service to ledger | Events derived from signed source events: receipt, storage, transfer, blend, delivery | Mass-conservation rule enforced; allocation cannot exceed the certified balance unless scheme rules and an approver allow it; conflicts are exceptions for humans | Conflicting records raise an exception, never a silent resolution; posting is idempotent | Boundary and period rules open (D-023) |
| IC-07 | Certificate service to approval service | Certificate draft: payload, manifest hash, calculation record hash, balance position | The approval binds to the exact content hash; any change invalidates it | Draft stays pending; no certificate issues without an approval record | Certificate definition and issuer open (D-006, D-012) |
| IC-08 | Quality manager to approval service | Approval decision: approver identity and role, decision, content hash, time, meaning of approval | Strong identity; separation of duties; agents cannot hold this permission; a deputy acts under the same rules | If the identity provider is down, approvals wait; no bypass; break-glass is inside the cell and logged (SEC-002) | Roles, deputies open (D-007, D-027) |
| IC-09 | Certificate service to hosting and verifier | Signed certificate, manifest, hash chain proof, verification instructions, **a signed chain-head and revocation snapshot with issue time and maximum freshness age** | A third party verifies with public material only, offline, without services outside the location fixed by D-012; the result is "valid as of the snapshot time", never "latest" unless a newer authenticated snapshot is held | Verification never depends on the cell being up; supersession and revocation are published in the chain and in each new snapshot | Locality and mechanism open (D-012, D-013) |
| IC-10 | Filing service to certification body or registry | Filing draft, then the approved filing, bound to a content hash | Submission only after a separate quality-manager approval of that content; the sent bytes equal the approved bytes | A rejected or failed filing returns to the exception queue with the body's response stored as untrusted data; no autonomous change and retry | Bodies, formats, channels unknown (D-001, D-006); an approved flow entry is required |
| IC-11 | Agent runtime to tool gateway | Tool call: agent identity, action, arguments, scope token | Catalogue, scope and approval enforced by the gateway; result carries record references; output sanitised; everything logged | Denial is explicit with a reason code; the agent cannot retry around it | Identity and permission model open (D-027) |
| IC-12 | Shipowner to customer compliance access | Authenticated question; shipowner scope token; disclosure policy id | One shipowner per context; policy evaluated before retrieval; answers cite records and methodology versions; defined refusal and escalation codes | If the agent or inference is unavailable, a templated answer or human escalation; never another customer's data | Policy format, customer entity model open (D-015, D-029) |
| IC-13 | Group plane to cell (down) | Methodology packages, policy bundles, configuration | Signed, pull-based, verified in the cell; carries no jurisdiction data | Cell uses cached verified versions | Distribution mechanism open |
| IC-14 | Cell to group plane (up) | **Only classes on the approved list**; candidates: certificate status and identifiers, digest hashes for anchoring, aggregate mass-balance totals, health | Typed fields only, no free text, no raw or evidence-grade data, outbound only | Queued locally; loss of the group plane never affects the cell | **Denied by default until D-011 and D-009 decide the list** |
| IC-15 | Cell to ERP, bunker management, port systems | Delivery references and certificate status, in the direction and fields the integration needs | Minimal fields; no raw readings leave the cell unless on an approved flow | Queued or dropped per contract; the cell never blocks on an external system | Systems unknown (D-035) |
| IC-16 | Telemetry to in-cell monitoring | Metrics, traces, audit events | No jurisdiction-bound content in telemetry; export only on approved flows | Local buffering; loss of monitoring never stops evidence capture | Retention open (D-016) |

## Shapes worth fixing now

These are the fields whose absence would break an architectural property. They are sketches for the design review, not schemas.

**Calculation record (IC-04, FR-009).** `calculationId`, `deliveryId`, `schemeId`, `inputsHash`, `inputRefs[]` (evidence item ids with hashes), `methodologyId`, `methodologyVersion`, `factorSetId`, `factorSetVersion`, `factorSource`, `codeBuildId`, `numericPolicyId` (units, precision, rounding, DATA-007), `outputs[]`, `status`, `createdAt` (cell clock). A record that omits any version cannot be re-run and is invalid.

**Approval record (IC-08, SEC-010).** `approvalId`, `contentHash`, `contentRef`, `approverId`, `approverRole`, `meaning` (issue or file), `decision`, `decidedAt`, `identityAssurance`, `prevApprovalHash`. The approval is valid only for exactly `contentHash`.

**Certificate payload (IC-07, IC-09).** `certificateId`, `version`, `supersedes`, `deliveryId`, `evidenceManifestHash`, `calculationRecordHash`, `methodologyVersionRef`, `balancePositionRef`, `issuedAt`, `issuerId`, `approvalId`, `chainPrevHash`, `signature`, `signerKeyId`. Corrections are new versions that name what they supersede (FR-030, FR-031).

**Customer answer (IC-12, FR-022 to FR-025).** `questionId`, `shipownerScope`, `policyId`, `records[]` (ids and hashes used), `methodologyVersionRef`, `answerText`, `status` (answered, refused, escalated), `refusalCode`. An answer without record references is invalid.

**Approved flow entry (IC-14, SEC-004).** `flowId`, `dataClass`, `fields[]`, `fromJurisdiction`, `toZone`, `legalBasisRef` (D-009), `approverId`, `approvedOn`, `expiry`. No entry, no flow.

## Contract tests that exist and that are needed

| Contract | Exists | Needed |
|---|---|---|
| IC-02 | Candidate oracle and tests on synthetic fixtures (DES-0002, EVAL-PRC-DAT-001 to 008 where applicable) | Device identity and signing once D-013 is decided; an edge simulator for disconnection (RT-08, pending) |
| IC-04, IC-05 | None | Re-run and explain-the-difference tests; method change test (see design defence, scenario 6) |
| IC-06 | None | Conflicting-record test (RT-09, pending) |
| IC-07, IC-08, IC-10 | Approval and filing gates exist only for the coding harness | Content-hash binding and agent-cannot-approve tests (RT-10, pending) |
| IC-09 | None | Offline verification of altered and replaced certificates (RT-04: the candidate oracle detects alteration; a certificate verifier does not exist) |
| IC-11, IC-12 | Harness-side permission tests only | Production-agent isolation and catalogue tests (RT-06 production half, pending) |
| IC-13, IC-14 | None | Approved-flow allow-list negative tests |
