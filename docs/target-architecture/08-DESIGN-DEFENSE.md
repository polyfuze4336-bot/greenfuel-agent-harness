# 08 Design defence

Status: proposed, Phase 0. Seven required scenarios, each answered as an examiner would press: what happens, what the design guarantees, what it does **not** guarantee, and what evidence exists. "Exists" means a test or artefact in this repository today; most production behaviour has no test because no production component exists (RT-xx statuses come from the [evaluation report](../evaluation/EVALUATION-REPORT.md)). Placeholders are marked PH. Nothing here has been demonstrated against a running system.

## 1. Edge connectivity fails

**Trigger.** The link between a barge or terminal and its cell drops mid-delivery, for hours or longer.

**What happens.**
1. Capture does not depend on the link (HC-07). The edge keeps reading meters, stamping trusted time, signing batches and writing to its durable buffer. Delivery operations continue.
2. Local verification still runs at the edge: sequence contiguity, device identity, basic range and unit checks. Nothing is estimated or filled in.
3. The edge shows its state locally: buffer fill, last acknowledged sequence, time since last contact. If the buffer approaches its design limit it raises a local alert and, at the limit, **stops accepting new low-priority data before it drops anything**; the policy for what is dropped, if anything, is a decision (D-020), never a silent default.
4. On reconnection the edge resumes **from the last acknowledged sequence**. Ingestion accepts batches in order, is safe to repeat, reports gaps and quarantines conflicting replays (IC-02).
5. Package completeness is a computed status. A package missing the offline portion is "incomplete" until it arrives, and **no certificate can be drafted from an incomplete package**.

**Guaranteed.** No dependency of capture on shore; no reordering or loss that goes undetected; no duplicate counted twice; no invented value.
**Not guaranteed.** That a disconnection longer than the buffer's design period loses nothing (needs sizing, D-020, D-032); that a stolen or destroyed device's un-synchronised data survives (the durable buffer is local; a second unit or a paper fallback reduces the risk); that readings are authentic if the meter cannot sign (D-019).
**Decision rights.** Whether certificates may be issued while a port is offline is D-020; the default is **capture only**, issuance waits for shore.
**Evidence.** Candidate ingestion oracle with ordering, redelivery and gap tests (RT-02, RT-03 pass on fixtures); RT-08 (offline edge and delayed synchronisation) is **pending** and needs an edge simulator.

## 2. Sensor data arrives late

**Trigger.** Readings arrive minutes, hours or days after they were taken: delayed sync, a logger flush, a manual import.

**What happens.**
1. Every event carries the device's own time, the verifier's receipt time and a trust status. The receiving clock, not the sender, sets receipt; the sender cannot claim a receipt time (ADR 0013).
2. A late event is accepted only if it is **within the verifier's permitted age** and its sequence fits. An event older than the limit, or one whose device time is implausible against its neighbours, is **quarantined**, not discarded and not merged.
3. A late event that arrives after a package was marked complete **reopens the package**: the completeness status is recomputed and a certificate drafted from the earlier state is flagged. If the certificate was already issued, the late evidence is attached as an exception for the quality manager, who decides whether a correction is needed; the correction is a new version that supersedes the old (FR-030, FR-031).
4. The calculation record names its inputs by hash, so it is clear which results used which evidence.

**Guaranteed.** Late data cannot silently alter an issued certificate or a past calculation; the history of when each item arrived is kept.
**Not guaranteed.** That a manipulated device clock is detected if it stays within the allowed skew; that the permitted age is right (a placeholder pending D-021, D-020).
**Evidence.** The timestamp contract rule exists and is tested on fixtures (ADR 0013); RT-07 found a gap in the lineage contract that is **open** (EVAL-PRC-DAT-006). Re-opening a package and flagging an issued certificate is design only.

## 3. Certificates are tampered with

**Trigger.** A certificate is altered or replaced after issue: a quantity, an emissions value, the delivery it refers to, or the whole document swapped.

**What happens.**
1. A certificate carries the hash of its evidence manifest and calculation record, the methodology version, the issuing approval, the previous certificate's hash in the chain and a signature from the cell's key custody (IC-07, IC-09).
2. **Offline verification and freshness.** A verifier holding a bundle can establish integrity and validity **as of a signed chain-head and revocation snapshot** carried in the bundle (with its issue time and a maximum freshness age). It cannot learn offline of a revocation newer than that snapshot, so it reports "valid as of the snapshot time" and shows that time, and treats a snapshot older than the freshness limit as stale; "latest valid" is claimed only when the verifier holds a newer authenticated snapshot. Anyone who verifies can detect alteration; replacement with a different but validly signed certificate breaks the chain or shows a different manifest hash.
3. The cell's own store is immutable and chained, so an alteration of the original is detected by chain verification and by anchored digests (TM-09). Supersession and revocation are chain entries, so a third party can derive validity **as of the snapshot it holds** (point 2); freshness is a property of the snapshot, not of the bundle.
4. A verification failure is an incident: the cell raises it, the quality manager is told, and the certificate's status is shown as under investigation without anyone deleting anything.

**Guaranteed.** Detectability of alteration by anyone who verifies; no overwrite in the system of record; an audit trail of every version.
**Not guaranteed.** That anyone verifies (a recipient who does not check is not protected, so verification must be simple and prominent); that a privileged operator cannot destroy the whole store (needs an external anchor, D-013); that the signing keys are safe (custody mechanism undecided; TM-10).
**Evidence.** RT-04 (altered or replaced certificates): the **candidate contract** detects alteration and replacement on fixtures; there is **no certificate service or verifier**, so the production half is not tested.

## 4. Azure regional services become unavailable

**Trigger.** An Azure region, or a service inside it, that hosts a cell is degraded or down. (A **local-host cell** has the same questions with different mechanisms; the contract is the same.)

**What happens.**
1. **Other cells are unaffected.** Failure domains are per jurisdiction. The group coordination plane continues to serve; a cell that is down simply does not pull.
2. **Edge capture continues** and buffers (scenario 1).
3. **Already issued certificates remain verifiable** by anyone, because verification is offline and does not need the cell (PH-R5).
4. **Recovery stays in the jurisdiction.** If the cell was built zone-redundant, a zone failure is absorbed. For a region-level failure the cell fails over to a **second site in the same jurisdiction or a verified in-jurisdiction region pair**, never to a region elsewhere. If the jurisdiction has no such second location, the cell waits for the region to recover: this is a documented weaker recovery objective that the sponsor and compliance have accepted in advance, not a cross-border failover improvised during an outage (RK-013, SEC-001).
5. Degradation is staged: agent features and customer natural-language answers first (fall back to templates and human work); then binding, calculation and issuance wait; capture and verification never stop.
6. On recovery, edge buffers resynchronise in order; ingestion deduplicates; the ledger is verified against its chain and anchors before the cell reports healthy.

**Guaranteed.** No automatic cross-border failover; no loss of acknowledged edge data inside the offline design period; verification independent of the cell.
**Not guaranteed.** Any specific RTO or RPO (placeholders only, D-031); that every needed service has an in-jurisdiction pair or zone redundancy; that a managed service's own control plane or logs do not touch another region during an outage (per-service check).
**Evidence.** None for recovery: no cell exists. The design needs a recovery exercise per cell that restores inside the jurisdiction and proves nothing left it ([05](05-QUALITY-ATTRIBUTES.md) section 4a).

## 5. A shipowner attempts to access another customer's records

**Trigger.** Shipowner A, directly or through the compliance agent, tries to retrieve, infer or be prompted into revealing shipowner B's data. Variants: crafted question, indirect reference to a delivery, a shared vessel or charter, a cache or index hit, a prompt injection hidden in A's message.

**What happens.**
1. A's request arrives with a scope token for A's partition only. The **tool gateway evaluates the disclosure policy before any retrieval** and routes only to A's partition of records, indexes, caches and memory (FR-023, SEC-005). B's data is not in any component A's context can reach; it is not filtered after retrieval, it is not retrieved.
2. If the question refers to something that exists only in B's partition, the answer is the defined refusal or "no record in your scope", identical to a nonexistent record, so existence is not leaked (FR-024).
3. If A's message contains instructions, they are data and cannot change scope or policy (SEC-012). A prompt-injected agent still cannot read B's partition because the gateway, not the agent, holds the scope.
4. Every question, the records retrieved, the policy applied and the answer are logged (FR-025). Repeated out-of-scope attempts raise an alert.
5. Shared physical resources (a database server) are separated logically at partition level with row-level or schema-level separation and separate credentials; whether per-customer compute separation is needed is D-005, D-015.

**Guaranteed (by design).** Isolation does not depend on instructions to the agent (HC-02); a breach would require a flaw in the gateway or the partitioning, which is where the tests concentrate (SEC-006).
**Not guaranteed.** Side channels such as timing or answer-length differences; shared charter or manager relationships (D-015) that make "another customer" ambiguous; correct policy authoring by customers (D-029).
**Evidence.** RT-06: the coding-harness half passes (another shipowner's fixture is denied by the harness's hooks); the production half, where the Customer Compliance Agent is the subject, is **pending** because no production agent exists. The harness result must not be read as evidence about the production design.

## 6. A calculation method changes

**Trigger.** A scheme owner issues a new methodology version, a factor set is revised, or the group corrects a method error.

**What happens.**
1. The change is a **new version** in the methodology registry: proposed, reviewed, approved (by the people D-022 names), given an effective date, signed and distributed (FR-012, IC-05). Nothing is edited in place; old versions are retained for reproduction.
2. Cells verify the signature and the approver before use and apply the version **by effective date** to deliveries on or after it; the delivery's own date and scheme decide which version applies, not the date of calculation.
3. Past calculation records are **not changed**. Each names its methodology and factor-set versions (FR-009). A re-run of a historical calculation uses the version it used and reproduces the result, or explains the difference (FR-011) if a defect is found in the earlier build.
4. If the new version changes what an already issued certificate would show, the system identifies the affected certificates (by methodology reference), lists them for the quality manager, and any correction is a new certificate version with a reason and an approver that supersedes the old one, not an edit (FR-030).
5. During rollout, two versions can coexist across cells; each result is labelled so cross-port inconsistency is visible, not hidden (RK-006).

**Guaranteed.** Reproducibility: any result re-runs from stored inputs and its recorded versions; no silent change; a trace from a certificate to the exact method.
**Not guaranteed.** That the scheme's own rules are correctly implemented (verification against the scheme owner, D-001, D-002, D-022); that the effective-period rule is right: the evaluation found the contracts lack it (EVAL-PRC-DAT-005, open).
**Evidence.** Contract tests for unsourced, changed and invented factors pass on fixtures (RT-05); the **outdated-factor test found a gap** and is open. A method-change procedure is design only.

## 7. A certification filing is rejected

**Trigger.** A certification body or registry rejects or returns a filing: a format error, a missing document, a disagreement about method, or a request for more evidence.

**What happens.**
1. The rejection is received as **untrusted data**, stored with the filing, and routed to the quality manager. No agent acts on its content beyond summarising it (SEC-012).
2. The rejected filing is **not edited and resubmitted**. A new filing draft is prepared (by the filing agent or a person) and goes through the same approval: a new approval bound to the new content hash (HC-04, SEC-010).
3. If the reason is evidential (a gap in the package), the evidence is added by the normal binding process, the package recomputed, and the quality manager decides whether the certificate itself needs a correction (a new version). If the reason is methodological, it goes to the methodology owner (scenario 6).
4. The certificate's status is **read from the authoritative record** (what the body actually said), not set by the platform (FR-028). The platform never marks a filing accepted on its own.
5. The outcome, the reasons and every attempt remain in the audit trail so patterns (a recurring rejection cause) are visible and feed the process, not the agent's memory as truth.

**Guaranteed.** No autonomous resubmission; no changed content under an old approval; no platform-asserted status.
**Not guaranteed.** That the body will accept the next filing; that the channel is automatable (formats and channels are unknown, D-001, D-006).
**Evidence.** RT-10: the harness half shows an agent cannot authorise a filing and the contract rejects a certificate without a human approval on fixtures; the production filing workflow does not exist. The rejection loop is design only.

## What the examiner should not be told

- That any of this is built or demonstrated against a running system. It is not.
- That a number is a target. All recovery, performance and capacity figures are placeholders (D-031, D-032).
- That Azure or any named scheme satisfies a jurisdiction's rules. Nothing has been verified (D-002, D-009, D-010).
- That the model prepares, drafts and answers well. That is the hypothesis the evaluation framework must test (D-030).
