# Requirements

Status: baseline v0.1, 2026-10-28. Requirements baseline for the business solution. Non-functional requirements (`NFR-nnn`) are in [NON-FUNCTIONAL-REQUIREMENTS](NON-FUNCTIONAL-REQUIREMENTS.md). Validation method, evidence required, related decisions, dependencies and open items for **every** requirement are in [REQUIREMENTS-TRACEABILITY](REQUIREMENTS-TRACEABILITY.md). Together the three files carry the seven attributes asked for: business justification, priority, acceptance criteria (here), and validation method, related architectural decisions, dependencies, evidence required (traceability).

## How to read this document

**Classes** (column `Cls`)
- **A**: stated in the case study (see [PROBLEMSTATEMENT](../../PROBLEMSTATEMENT.md)). The traceability source column names the `CS-` statement.
- **B**: proposed architecture assumption or derived requirement. Not stated by the case; needs owner agreement. Where it derives from a case statement, the source column shows both.
- **C**: needs stakeholder clarification. Shown in the traceability "Open (C)" column as decision-register IDs. A requirement can be A or B and also carry open clarifications.
- **D**: depends on a regulatory or certification claim that is not verified. Shown in the "Verify (D)" column as `V-nn` IDs from [CERTIFICATION-SCHEMES](CERTIFICATION-SCHEMES.md).

**Priority**: Must, Should, Could (relative to the first usable release, which is itself undefined: D-003, D-034).

**Caps** (capability tags): DEA delivery evidence, EAA emissions attribute, DRA dispute resolution, MBA mass balance, CCA customer compliance, XC cross-cutting, EDG edge and connectivity, SOV sovereignty. Specialist agents use these tags to load only the relevant rows (see [CONTEXT-LOADING-STRATEGY](CONTEXT-LOADING-STRATEGY.md)).

**Acceptance criteria** state an observable test. Where a number is needed and unknown, the criterion refers to the decision that will supply it. No number in this baseline is a confirmed target.

**Ground rules that apply to every row**
- An Azure region is not assumed to satisfy port-jurisdiction residency (CS-P4).
- An agent's autonomy label confers no permission (CS-P3).
- Standards named anywhere are candidates (CS-P5).
- A row labelled A states only what the case study states. Controls, mechanisms and numbers that go beyond it are separate class B rows.
- Where an acceptance criterion depends on an undecided definition (for example D-009 or D-012), the criterion cannot be assessed until that decision exists. It is not treated as passed.

## 1. Business requirements (BR)

| ID | Caps | Requirement | Cls | Pri | Business justification | Acceptance criteria |
|---|---|---|---|---|---|---|
| BR-001 | DEA,EAA,DRA,MBA,CCA | The programme provides the five business capabilities in the problem statement | A | Must | Defines scope | Each capability has an owner-approved definition mapped to its FR ids; any later change to the capability set is made through an ADR |
| BR-002 | XC | Every green-fuel delivery can be supported by a complete, verifiable evidence package | A | Must | Evidence is what customers, reviewers and certification bodies rely on | For sampled deliveries an independent reviewer reconstructs the delivery facts from the package alone, and every gap is explained in the package |
| BR-003 | DRA | Quantity and quality disagreements can be reviewed on sensor-backed evidence | A | Must | Moves disputes from recollection to records | For sampled disputes the commercial reviewer rates the pack sufficient to review, and every figure in it traces to a stored record |
| BR-004 | CCA | A shipowner receives delivery-related compliance answers without exposure of any other shipowner's data | A | Must | Commercial confidentiality and customer trust | Zero cross-customer disclosures in isolation tests and in production monitoring |
| BR-005 | MBA | The group can show that certified quantities claimed on deliveries reconcile to certified quantities held and received | A | Must | Claims of certified fuel must not exceed certified supply | Each balancing period yields a reconciliation with no unexplained negative balance; every exception has a recorded resolution |
| BR-006 | SOV | The group can operate in several port jurisdictions while measurement data stays in its originating jurisdiction | A | Must | Legal and contractual obligation | Per-port data-flow inventory shows no unapproved flow of measurement data out of the jurisdiction, refreshed on a cadence set under D-009 |
| BR-007 | EDG | Intermittent edge-to-shore connectivity never prevents a delivery from being evidenced | A | Must | Deliveries happen whether or not the link is up | Controlled disconnection tests show complete, ordered evidence after reconnection |
| BR-008 | XC | Value measures and baselines are agreed before implementation | B | Should | The case gives no financial or operational baseline | Measures and baselines exist per capability and are approved by the programme owner; no value is asserted that lacks a baseline |
| BR-009 | XC | The business application is not built until the architecture baseline is approved and a human raises the phase | A | Must | Architecture before implementation | The phase flag stays at 0 until an Accepted ADR raises it; the validator rejects application and IaC files meanwhile |

## 2. Functional requirements (FR)

### 2.1 Delivery Evidence (CS-CAP-1)

| ID | Caps | Requirement | Cls | Pri | Business justification | Acceptance criteria |
|---|---|---|---|---|---|---|
| FR-001 | DEA,EDG | Ingest mass-flow-meter readings with device identity and timestamp and bind them to the delivery | A | Must | Raw readings are the primary evidence | In a test delivery, every reading emitted by the simulated meter is present in the delivery's evidence with its original value, device id and timestamp; storage guarantees are in DATA-002 and SEC-008 |
| FR-002 | DEA | Bind blend data to the delivery, recording its source and who entered or approved it | A | Must | Blend composition drives mass balance and attributes | Each delivery shows blend data with source and approver; unsourced blend data is rejected |
| FR-003 | DEA | Bind feedstock certificates to the delivery batch | A | Must | Feedstock evidence underpins any sustainability claim | Each delivery batch lists the feedstock certificates bound to it, each with its stored original; a delivery without a bound certificate is shown as such (verification handling is in FR-032) |
| FR-004 | DEA | Bind transfer evidence to the delivery (document types defined under D-019) | A | Must | Completes the delivery record | Each delivery lists its transfer evidence items by type and source; missing mandatory items are flagged |
| FR-005 | DEA | Produce a delivery evidence package with a manifest of all bound items, their hashes and a completeness status | B | Must | One object that customers, reviewers and auditors can verify | A package is never marked complete while a mandatory item is missing; the manifest hash verifies the whole package |
| FR-006 | DEA,EDG | Capture evidence at the edge while offline and reconcile to shore later without altering it | B | Must | Direct consequence of intermittent connectivity | Disconnect for the D-020 duration during a test delivery: nothing lost; after reconnection the shore copy matches edge hashes; any gap in sequence is reported explicitly |
| FR-032 | DEA | For each bound feedstock certificate, check document integrity and record a verification status. Never infer certificate content or verification status | B | Must | Keeps verified and unverified evidence distinguishable (supports CS-C6) | Each certificate has a hash and a status (verified by named source, unverified, failed); an unverifiable certificate is never shown or counted as verified (D-024) |

### 2.2 Emissions Attribute (CS-CAP-2)

| ID | Caps | Requirement | Cls | Pri | Business justification | Acceptance criteria |
|---|---|---|---|---|---|---|
| FR-007 | EAA | Calculate emissions attributes for a delivery under an explicitly named scheme and methodology version | A | Must | Customers need scheme-specific attributes | Each result names scheme and methodology version; a request without them is refused |
| FR-008 | EAA | Perform calculations in deterministic, version-controlled code; a language model never produces the numbers | A | Must | Reproducibility and defensibility | Identical inputs, methodology version and build give identical outputs across repeated runs and clean rebuilds; code review confirms no model call in the calculation path |
| FR-009 | EAA | Store with each result a record that traces it to the exact methodology version and allows re-running it: inputs, methodology id and version, factor-set id and version with source, code build id, outputs | A | Must | Traceability to the exact methodology version | From any result, a reviewer retrieves every item listed and can re-run the calculation |
| FR-010 | EAA | Take emission factors and parameters only from controlled, approved reference data, and fail closed when a required value is missing | A | Must | AI and operators must not invent factors | With a required factor removed, the calculation fails with an explicit error and produces no result |
| FR-011 | EAA | Re-run any historical calculation from its record and either match the original result or explain the difference | A | Must | Reproducibility must be demonstrable, not claimed | Re-run of a sample of historical records matches stored outputs; any mismatch is reported with the cause |
| FR-012 | EAA | Manage the methodology version lifecycle: propose, review, approve, effective date, retire; retain old versions for reproduction | B | Must | Methods change; history must stay reproducible | A new version cannot be used before approval and effective date; retired versions remain runnable; approvals are recorded (D-022) |

### 2.3 Dispute Resolution (CS-CAP-3)

| ID | Caps | Requirement | Cls | Pri | Business justification | Acceptance criteria |
|---|---|---|---|---|---|---|
| FR-013 | DRA | Assemble a quantity and quality evidence pack for a delivery from sensor-backed records | A | Must | Commercial review needs sensor-backed facts | The pack lists raw readings and derived quantities, each linked to its stored record; quality evidence is included where it was recorded (further contents in FR-033) |
| FR-014 | DRA | State clearly what is evidenced and what is not; never extrapolate or fill gaps | A | Must | AI must not invent measurements | For a delivery with a missing reading, the pack shows the gap explicitly and contains no estimated value |
| FR-015 | DRA | Prepare packs for human commercial review; no agent decides, settles or communicates a dispute outcome | A | Must | Commercial outcomes are human decisions | Agent permissions contain no settle, concede or notify-outcome action; test attempts are denied and logged |
| FR-016 | DRA | Make packs independently verifiable by a third party, with verification instructions | B | Should | Arbitration and customer trust | A reviewer with no platform access verifies pack integrity using only the pack and published instructions (see D-012, D-014) |
| FR-033 | DRA | Include in each pack the meter verification status at delivery time and sample references, where they are recorded | B | Should | Quantity and quality disputes often turn on meter status and retained samples | Packs show meter status and sample references when present, and show "not recorded" when absent (D-019, D-026) |

### 2.4 Mass Balance (CS-CAP-4)

| ID | Caps | Requirement | Cls | Pri | Business justification | Acceptance criteria |
|---|---|---|---|---|---|---|
| FR-017 | MBA | Maintain a ledger of certified fuel quantities by batch across receipt, storage, transfer, blending and delivery | A | Must | Core of mass-balance tracking | Every movement in a test scenario is an event in the ledger; replaying events reproduces the balances |
| FR-018 | MBA | Record blending operations as events with inputs and outputs and flag violations of the mass-conservation rule | B | Must | Blending is where certified status is most easily lost | A blend whose outputs exceed inputs beyond the D-023 tolerance is flagged and blocked from posting until resolved |
| FR-019 | MBA | Prevent allocating certified quantity beyond the available certified balance unless the scheme rules and an approver allow it | B | Must | Prevents over-claiming | An allocation that would drive a balance negative is rejected by default |
| FR-020 | MBA | Reconcile physical stock measurements to the ledger and raise discrepancies as exceptions for human resolution | B | Should | Detect loss, error or tampering | A seeded discrepancy is raised as an exception and cannot be closed without a recorded human resolution |
| FR-021 | MBA | Apply balancing boundary and period rules of the applicable scheme | B | Must | Scheme rules define valid balancing | Balancing results are produced per the configured boundary and period; rule sets are versioned and approved (D-023) |

### 2.5 Customer Compliance (CS-CAP-5)

| ID | Caps | Requirement | Cls | Pri | Business justification | Acceptance criteria |
|---|---|---|---|---|---|---|
| FR-022 | CCA | Answer delivery-related compliance questions only from verified records, citing the record and methodology version used | A | Must | Answers must be defensible | Every answer in a test set cites records that exist and support it; unsupported answers are blocked |
| FR-023 | CCA | Apply the shipowner-specific disclosure policy before any answer is formed | A | Must | Customers differ in what may be disclosed | For a question outside policy, no restricted field appears in the answer, the retrieval trace or the logs visible to others |
| FR-024 | CCA | When evidence is missing or policy forbids disclosure, give a defined refusal or escalation, never a guess | A | Must | Prevents invented compliance statements | A test set of unanswerable questions yields refusals or escalations only |
| FR-025 | CCA | Log each question, the records retrieved, the policy applied and the answer for audit | B | Must | Audit reconstruction of what a customer was told | For a sampled answer, the log reproduces the question, records, policy version and answer |

### 2.6 Cross-cutting

| ID | Caps | Requirement | Cls | Pri | Business justification | Acceptance criteria |
|---|---|---|---|---|---|---|
| FR-026 | XC,SOV | Issue tamper-evident certificates, hosted locally (meaning per D-012), that reference the evidence package and methodology version | A | Must | CS-C3 | Altering any byte of a certificate, or its referenced package, is detected by verification. "Locally hosted" cannot be accepted until D-012 defines it; that definition is a test input |
| FR-027 | XC | Prepare certification filings as drafts; submission requires quality-manager approval | A | Must | CS-C4 | A filing cannot be submitted without a recorded quality-manager approval; submitting content that differs from what was approved is rejected (SEC-010); approval by an agent identity is impossible |
| FR-028 | XC | Read certification status only from the authoritative record; the platform never asserts a status that no authoritative process recorded | A | Must | AI must not invent certification status | Status shown in any view or answer matches the authoritative record; a test that tries to set status without the authoritative process fails |
| FR-029 | XC | Reconstruct the full chain from any certificate or filing back to raw readings, documents, methodology version, approvals and agent actions | A | Must | Audit reconstruction | For sampled certificates a reviewer completes the reconstruction using platform tools alone, within the target set under D-025 and NFR-003 |
| FR-030 | XC | Corrections create a new version with a reason and an approver; originals remain | B | Must | Evidence cannot be silently changed | After a correction both versions exist, linked, with reason and approver recorded |
| FR-031 | XC | Record supersession and revocation of certificates verifiably | B | Should | Relying parties must learn a certificate is no longer valid | A superseded certificate verifies as superseded, with date and reason (D-012) |

## 3. Security and sovereignty requirements (SEC)

| ID | Caps | Requirement | Cls | Pri | Business justification | Acceptance criteria |
|---|---|---|---|---|---|---|
| SEC-001 | SOV | Store and process delivery measurement data only in its originating port jurisdiction, including replicas, backups, logs and telemetry that contain it. Region selection alone is not accepted as proof | A | Must | CS-C1 and CS-P4 | Per-port data-flow inventory covers storage, processing, backup, disaster recovery, telemetry, identity, key management and support; each flow is shown to remain in-jurisdiction by configuration evidence and by a negative test. The legal meaning of "within the jurisdiction" (D-009) is a test input; until it exists this cannot be accepted |
| SEC-002 | SOV | Deny administrative and support access to jurisdiction-bound data from outside the jurisdiction by default. Break-glass access is performed inside the jurisdiction; outside access is allowed only if D-009 verifies a legal exception and D-011 records the exact approved flow | B | Must | Remote administration can breach residency; break-glass is itself a transfer | Access attempts from outside are denied in test; in-jurisdiction break-glass use produces a log and an approval record; no outside path exists unless a recorded exception names it (D-033) |
| SEC-003 | SOV,XC | Run AI inference over delivery measurement data only inside the originating jurisdiction | B | Must | Prompts and retrieved data are data transfers | Test prompts containing measurement data are processed only by in-jurisdiction endpoints; configuration evidence confirms the processing location of every model deployment used (D-028) |
| SEC-004 | SOV | Allow cross-jurisdiction flows only for data classes on an approved list, with a recorded legal basis | B | Must | Group reporting needs some flow | Every cross-border flow maps to an approved entry (D-011); an unlisted flow is blocked and alerted |
| SEC-005 | CCA,XC | Isolate each shipowner's compliance data in storage, compute context, retrieval indexes, caches, logs and agent memory | A | Must | CS-C2 | Architecture review shows no shared index, cache or memory across shipowners; the isolation unit follows D-015 |
| SEC-006 | CCA,XC | Prove isolation by test: a principal or agent scoped to shipowner A cannot retrieve, infer or be prompted into disclosing shipowner B data | B | Must | Isolation must be demonstrated | Automated adversarial tests run on each release and on a schedule, with zero cross-tenant disclosures |
| SEC-007 | XC | Sign certificates with keys held under local control and verifiable without calling services outside the jurisdiction | B | Must | Derived from CS-C3: tamper evidence and local hosting need local key custody | Key custody evidence per port; verification works with the network to other jurisdictions blocked (D-012, D-013) |
| SEC-008 | XC | Keep evidence append-only and tamper-evident so any modification or deletion is detectable | B | Must | Mechanism for CS-C8 and NFR-001 | Tamper tests that modify or delete records are always detected by verification |
| SEC-009 | XC | Use strong identities for humans and for each agent with least privilege and no standing broad roles | B | Must | Limits blast radius | Role assignments are reviewed; no agent identity holds a broad role; just-in-time elevation is logged |
| SEC-010 | XC | Enforce quality-manager approval technically: agent identities cannot hold the approval permission, approvals bind to a content hash, and separation of duties applies | B | Must | Operationalises CS-C4 | Test: an agent identity cannot approve; an approval of content X cannot authorise content Y; the same person cannot both prepare and approve where D-007 forbids it |
| SEC-011 | XC | Manage keys and secrets in a managed key service under defined custody; no secrets in code, prompts or logs | B | Must | Key compromise breaks tamper evidence | Secret-scanning passes; key custody and rotation records exist (D-013) |
| SEC-012 | XC | Treat feedstock documents, customer messages and tool outputs as untrusted input that cannot change policy or permissions | B | Must | Prompt-injection defence | Injection test sets cannot cause a prohibited action, disclosure or status change |
| SEC-013 | EDG | Secure edge devices: authenticated devices, signed software, protected storage, update control and tamper considerations | B | Must | The edge is physically exposed | Device threat model reviewed; unsigned software is rejected; stolen-device scenario analysed (D-018) |
| SEC-014 | XC | Collect security logs and monitoring inside the jurisdiction with controlled, approved export | B | Should | Logs contain sensitive data | Log flows are on the SEC-001 inventory; exports follow D-011 |
| SEC-015 | XC | Protect the supply chain of the calculation engine and agent tooling: signed builds, dependency inventory, controlled promotion | B | Should | A tampered engine falsifies every result | Each release has a build record and dependency inventory; unsigned artefacts cannot be promoted |

## 4. Data requirements (DATA)

| ID | Caps | Requirement | Cls | Pri | Business justification | Acceptance criteria |
|---|---|---|---|---|---|---|
| DATA-001 | XC,SOV | Every data item has an owner, classification, residency tag, isolation tag and retention rule | B | Must | Controls follow classification | A catalogue exists; items without these attributes cannot be stored in production |
| DATA-002 | DEA,EDG | Store raw measurement data immutably with source, trusted timestamp and sequence number | B | Must | Ordering and completeness are evidence | Gaps or reordering are detectable by verification (D-021) |
| DATA-003 | XC | Keep lineage from every derived value to its inputs | A | Must | CS-C5 and CS-C8 | For sampled values, tooling lists all inputs recursively down to raw records |
| DATA-004 | XC | Use canonical identifiers for delivery, batch, tank, vessel, customer and methodology version | B | Must | Joins across capabilities must be unambiguous | Identifier scheme documented; duplicate or ambiguous identifiers are rejected |
| DATA-005 | EAA | Version reference data (emission factors, parameters, scheme rules) with source citation, approval and effective dates | B | Must | Factors must come from controlled sources | Each reference-data version has source, approver and dates; unsourced entries are rejected |
| DATA-006 | XC,SOV | Apply retention and legal-hold rules per data class and jurisdiction | B | Must | Evidence must last as long as claims can be contested | Retention matrix approved (D-016); deletion before expiry is prevented |
| DATA-007 | EAA,MBA | Define units, precision and rounding rules and enforce them in code | B | Must | Reproducibility depends on numeric rules | Numeric rules documented; differing implementations produce identical results on a shared test set |
| DATA-008 | XC | Carry a quality status on records: verified, unverified, disputed, corrected | B | Should | Consumers must see how far to trust data | Status visible in packs and answers; transitions are logged |
| DATA-009 | XC,SOV | Use only synthetic or approved-masked data outside production; no real delivery data leaves its jurisdiction for testing | B | Must | Test environments are often forgotten in residency | Non-production data inventory shows synthetic or approved-masked data only (D-036) |
| DATA-010 | XC | Minimise personal data and handle any that exists under applicable law | B | Should | Privacy duties may apply | Personal data inventory exists; each element has a lawful basis once D-017 is answered |

## 5. AI and agent control requirements (AGT)

| ID | Caps | Requirement | Cls | Pri | Business justification | Acceptance criteria |
|---|---|---|---|---|---|---|
| AGT-001 | XC | Each business agent has a written charter: purpose, tools, action catalogue, data scope, autonomy level, escalation path | B | Must | Bounded agents are governable | A charter exists per agent and is approved before any agent is built |
| AGT-002 | XC | Autonomy level never grants permission. Permissions come only from the action catalogue and platform-enforced roles. No agent, at any level, has unrestricted commercial, regulatory or infrastructure actions | A | Must | CS-P3 | Permission tests show every agent action is catalogued; attempts at uncatalogued actions are denied at the platform, not only by instruction |
| AGT-003 | XC | AI never creates sensor measurements, emissions factors, feedstock evidence or certification status; such values come only from authenticated authoritative sources and carry recorded provenance | A | Must | CS-C6 | No-invention test sets pass with zero tolerance; every number or status in an output links to a source record with its provenance. Cryptographic source signing is a separate control that depends on D-013 and D-019 |
| AGT-004 | XC | Numbers in agent outputs come from deterministic tools and are traceable to tool-call records | B | Must | Defends CS-C5 and CS-C6 | Sampled outputs show each figure with a tool-call id and matching record |
| AGT-005 | XC | Actions with external effect (filing submission, new disclosure categories, commercial concessions, configuration changes) require human approval by a defined role | B | Must | Generalises CS-C4 | The action catalogue marks each external-effect action with its approver role; execution without approval is impossible |
| AGT-006 | XC | Business agents cannot change infrastructure, identity, policy or methodology | B | Must | Prevents self-modification | Agent identities hold no write roles on these resources; attempts are denied and alerted |
| AGT-007 | XC | Retain a complete agent action log: inputs, retrieved evidence, tool calls, outputs, approvals, model and prompt versions | B | Must | Audit reconstruction of agent behaviour | For a sampled output, the log reproduces the whole decision path |
| AGT-008 | XC | Evaluate agents before release and monitor them afterwards on no-invention, isolation and refusal behaviour | B | Must | AI behaviour drifts | Evaluation suites with thresholds from D-030 run on every release and on a schedule; failures block release |
| AGT-009 | XC | Control and record prompt, model and tool-configuration versions with each output | B | Must | Reproduce what an agent did | Version ids appear in each output record |
| AGT-010 | XC,EDG | Keep deterministic evidence capture and calculation working when AI services or connectivity are unavailable | B | Must | AI is not on the critical path of evidence | With model endpoints disabled, capture, binding and calculation still complete |
| AGT-011 | XC | Keep business agents separate from coding-harness agents; harness agents have no access to production data, keys or tenants | B | Must | Programme principle and ADR 0001 | Harness configuration holds no production credentials; production identities are separate from developer identities |
