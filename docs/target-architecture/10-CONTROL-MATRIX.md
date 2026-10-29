# 10. Control matrix (hardening)

Status: **Phase 0, proposed, 2026-10-29.** Extends the [threat model](06-THREAT-MODEL.md) (TM-01 to TM-34) with the controls the hardening request asked for. Nothing here is an approved architecture and **no control below is implemented in a product**, because no product exists (phase 0, [blocker report](../phase/PHASE-1-BLOCKER-REPORT.md)).

## How to read the status columns

| Column | Meaning |
|---|---|
| **Candidate oracle (Phase 0)** | The property is stated as executable code in `harness/contracts/` on synthetic data with test-only keys, and the named tests pass. It proves that the *rule* is coherent and that the listed attacks are refused *by that rule*. It does not prove that any future implementation follows the rule. |
| **Product** | Always **Not implemented** today. The column exists so a reader cannot mistake an oracle for a delivered control. |
| **Not testable yet** | The control depends on something that does not exist (a deployed cell, a real identity provider, a real model, a real signing service). It is **designed only** and listed in [12](12-DATA-MOVEMENT-AND-RESIDENCY-VALIDATION.md) or [13](13-SECURITY-REVIEW.md) as pending. |

Test ids: **ST-01** certificate tampering, **ST-02** sensor replay, **ST-03** duplicate transfer, **ST-04** clock manipulation, **ST-05** forged event sequence, **ST-06** cross-shipowner access, **ST-07** unauthorized methodology change, **ST-08** missing feedstock evidence, **ST-09** malicious document prompt injection, **ST-10** unauthorized filing submission. A guard test, [security-scenarios.test.mjs](../../tests/security-scenarios.test.mjs), fails if any of them loses its tests.

Oracles: [custody](../../harness/contracts/custody-chain-contract.mjs), [lifecycle](../../harness/contracts/certificate-lifecycle-contract.mjs), [methodology](../../harness/contracts/methodology-registry-contract.mjs), [tenant boundary](../../harness/contracts/tenant-boundary-contract.mjs), [placement](../../harness/contracts/sovereignty-placement-contract.mjs), [audit chain](../../harness/contracts/audit-chain.mjs).

## 1. Jurisdictional sovereignty

| ID | Control | Threats | Requirements | Where it must live | Candidate oracle (Phase 0) | Test |
|---|---|---|---|---|---|---|
| SV-01 | Stores, replicas, backups and geo-redundant copies of bound data are inside the cell's jurisdiction; an undeclared paired region is a violation, not a pass | TM-06 | SEC-001, HC-01 | Platform policy plus a deployment-time check, evidence from live resource queries | Tested (rules PL-01, PL-02, PL-08) | [placement](../../tests/sovereignty-placement-contract.test.mjs) |
| SV-02 | Log workspaces, diagnostic sinks and telemetry export that contain bound content stay in the jurisdiction; whether they contain bound content must be declared | TM-26 | SEC-014 | Diagnostic settings, log pipeline | Tested (PL-03) | placement |
| SV-03 | A cross-jurisdiction flow of a bound class needs an approved-flow entry bound to the class, source, destination and resource pair, with a legal-basis reference, an approver and an unexpired date | TM-19 | SEC-004 | Flow register, network policy, egress controls | Tested (PL-04). The legal-basis reference is an **unverified string** and approved flows sit inside the manifest being checked, so a real system needs a register held by someone other than the manifest author | placement |
| SV-04 | Administration from outside the jurisdiction needs a break-glass approved inside it | TM-07, TM-33 | SEC-002 | Identity, privileged access, deployment identities | Tested (PL-06) | placement |
| SV-05 | Inference over bound data runs in the jurisdiction and its processing location is verified, not assumed | TM-34 | SEC-003, D-028 | Model deployment, network | Tested as a declared-manifest rule (PL-07); the real location is **not verified** | placement |
| SV-06 | Unknown or **undeclared** roles, locations, data classes, redundancy, access, admin paths and flow labels fail closed; duplicate ids and empty manifests are violations; a flow's classes must be held by its source; an approved flow is bound to class, source, destination, resource pair, legal basis, approver and expiry | TM-06 | SEC-001 | Manifest schema, policy | Tested (PL-00, PL-09, PL-10, PL-04) | placement |
| SV-07 | Validation of real replicas, backups, logs, diagnostics, support access and DR against live resources | TM-06, TM-07 | SEC-001, SEC-002, SEC-014 | Per cell, after deployment | **Not testable yet**; procedure in [12](12-DATA-MOVEMENT-AND-RESIDENCY-VALIDATION.md) | none |
| SV-08 | Exposure to a foreign legal request over a provider or the group | TM-08 | SEC-001 | Legal and contractual, not a technical control | **Not testable**; owner and legal question (D-009, D-011) | none |

A declared manifest is a claim. Passing the checker never says a resource is verified.

## 2. Shipowner isolation

| ID | Control | Threats | Requirements | Where it must live | Candidate oracle (Phase 0) | Test |
|---|---|---|---|---|---|---|
| IS-01 | The tenant and the actor type come only from a verified token; a client-supplied tenant is never read. Roles are **not** used by the oracle's data API (a role model is not modelled, D-015) | TM-17 | SEC-009 | Identity provider, API gateway | Tested with a fixture HMAC provider (not the real provider) | [tenant](../../tests/tenant-boundary-contract.test.mjs) ST-06 |
| IS-02 | Every read re-checks the tenant on the record, at the data boundary; absent and out-of-scope return the same response | TM-16 | SEC-005, SEC-006, HC-02 | Data-access layer, row-level controls | Tested | tenant ST-06 |
| IS-03 | Identifiers are strictly validated; traversal, case, whitespace, type-confusion and injection forms never reach another tenant's data | TM-16 | SEC-006 | API, data layer | Tested | tenant ST-06 |
| IS-04 | Lists, counts, pages and search are filtered by tenant in the query; cursors carry a tenant tag and only encode an offset within the caller's own data (a tag, not an integrity control); search is a literal match | TM-16 | SEC-005 | Data layer | Tested | tenant ST-06 |
| IS-05 | Cache keys are namespaced by tenant so a crafted key cannot collide | TM-15, TM-34 | SEC-005 | Cache layer | Tested | tenant ST-06 |
| IS-06 | A tool gateway authorises every agent call by catalogue, agent, run state, mode and strict schema (own keys only, no extra value reaches the handler); NEVER tools and unknown names, including prototype keys, are denied; handlers get a frozen copy of the arguments and a narrowed API with no raw store | TM-14 | AGT-002, AGT-005, AGT-006 | Gateway between agent runtime and tools | Tested | tenant ST-06, ST-09 |
| IS-07 | A tool handler runs as the run's own tenant-bound identity, so a valid-looking identifier from another tenant resolves to not-found | TM-16 | SEC-006 | Tool implementations | Tested | tenant ST-06 |
| IS-08 | The context builder drops any fragment that is not in the run's tenant and records the drop | TM-16, TM-34 | SEC-005 | Retrieval and context assembly | Tested | tenant ST-06, ST-09 |
| IS-09 | Isolation of shared inference state (prefix or key-value caches, batching, retries, traces, provider logs, retained prompts) | TM-34 | SEC-005 | Model hosting, per-tenant or per-cell deployment | **Not testable yet**; needs a real inference path (D-028) | none |

## 3. Chain of custody and evidence integrity

| ID | Control | Threats | Requirements | Where it must live | Candidate oracle (Phase 0) | Test |
|---|---|---|---|---|---|---|
| CC-01 | Each event carries a signature over a hash that includes delivery, device, key id, algorithm, sequence, device time, kind, payload and previous hash; a forger without the device key cannot produce a valid event | TM-01 | SEC-008, SEC-013, DATA-002 | Edge capture, verifier | Tested | [custody](../../tests/custody-chain-contract.test.mjs) ST-05 |
| CC-02 | Per-device hash chain with contiguous sequence numbers; gaps, chain breaks and reordering are rejected | TM-02, TM-05 | SEC-008 | Verifier | Tested | custody ST-05 |
| CC-03 | A retry of an accepted event is an idempotent duplicate, including after the end; the same sequence with different content is a conflicting replay | TM-02 | DATA-002 | Ingestion | Tested | custody ST-02 |
| CC-04 | One physical transfer cannot become two deliveries (natural key of barge, vessel and planned start minute); a second transfer-start is refused | TM-02 | FR-032 | Delivery registry | Tested | custody ST-03 |
| CC-05 | The receipt time comes from the verifier clock, never from the device; future-dated, too-old and time-regressing device times are refused | TM-03 | DATA-002 | Verifier, time source | Tested against a fake clock | custody ST-04 |
| CC-06 | Device keys have validity windows and revocation, checked at receipt and again by the independent verifier | TM-10 | SEC-013 | Device registry | Tested | custody ST-04, ST-05 |
| CC-07 | Independent verification is a pure function of a bundle and a caller-supplied trust set; keys inside the bundle are ignored; a missing receipt, deleted event or altered payload is reported | TM-09, TM-21 | FR-029, SEC-008 | Auditor tooling | Tested | custody ST-05 |
| CC-08 | An external trusted time-stamping authority | TM-03 | D-021 | Time source | **Not modelled**: the oracle's receipt is the verifier's own signed clock reading, which is weaker | none |
| CC-09 | Key protection (hardware-backed custody, rotation, recovery) | TM-10 | SEC-011, D-013 | Key service | **Not modelled** | none |
| CC-10 | Anchoring the audit and ledger heads outside the writer so tail truncation is detectable | TM-09 | SEC-008, D-013 | Ledger service | Detection with a supplied anchor is tested; **where the anchor lives is undecided** | custody (audit chain) |
| CC-11 | Physical tampering with a device or replaced device software | TM-04 | SEC-013 | Device attestation, seals | **Not testable** in software | none |

## 4. Certificate lifecycle

| ID | Control | Threats | Requirements | Where it must live | Candidate oracle (Phase 0) | Test |
|---|---|---|---|---|---|---|
| CL-01 | Only listed transitions among DRAFT, EVIDENCE_PENDING, VALIDATED, APPROVED, ISSUED, SUPERSEDED, REVOKED; terminal states have no exits | TM-11 | FR-026, FR-031 | Certificate service | Tested | [lifecycle](../../tests/certificate-lifecycle-contract.test.mjs) |
| CL-02 | Validation is a deterministic service act, and only the validator service may validate (checked by actor type and role); issue likewise only by the issuer service. Validation is gated on verified, complete custody, a matching evidence manifest, a calculation record for this delivery and methodology, and verified feedstock evidence; an agent or a person by hand cannot declare evidence validated | TM-13, TM-31 | FR-028, AGT-003 | Validator and issuer services | Tested **against injected stand-ins** for the custody, calculation and feedstock services: it proves the gate refuses lying inputs. The oracles are **not wired together** (gap G-1) | lifecycle ST-08 |
| CL-03 | Approval is a **record signed with the approver's own registered key**, by a human quality manager who has not authored or edited the work, bound to the content hash (and to the filing id for filings), of the right meaning and `decision: approve`, single-use under a strictly validated id, and time-limited | TM-11, TM-23 | SEC-010, HC-04 | Approval service, approver registry | Tested with test-only approver keys; **who holds approver keys and how they are enrolled is not modelled** (CL-15) | lifecycle ST-10 |
| CL-04 | Issued content is immutable; a correction is a new certificate that supersedes the old; a change before approval discards validation and approval | TM-21 | FR-030, FR-031 | Certificate service | Tested | lifecycle ST-01 |
| CL-05 | Revocation needs a human quality-manager approval bound to the stated reason | TM-21 | FR-031 | Certificate service | Tested | lifecycle |
| CL-06 | Signed snapshot of revocations and supersessions with an issue time; an offline verifier reports validity only as of that time and reports staleness | TM-21 | SEC-007 | Verification tooling | Tested; the freshness limit is a policy input | lifecycle ST-01 |
| CL-07 | Independent certificate verification uses only a bundle and a supplied trust set | TM-21 | SEC-007, FR-029 | Auditor tooling | Tested | lifecycle ST-01 |
| CL-08 | Filing: draft only by agents; human approval bound to the exact bytes; a controlled submitter service sends exactly the approved bytes once; the body's response is stored as untrusted data and changes nothing else | TM-23 | FR-027, SEC-010, AGT-005 | Filing service | Tested | lifecycle ST-10 |
| CL-09 | A model or document asserting that approval exists | TM-23, TM-32 | SEC-010 | Approval service | Tested: draft text cannot stand in for an approval, and an approval object built by a caller is not authentic | lifecycle ST-10 |
| CL-10 | Evidence and approval freshness are checked again at issue (time of check is not time of use); the figures and quantities on a certificate must equal those the calculation and custody services report | TM-13, TM-31 | FR-008, FR-028 | Issuer service | Tested against the same injected stand-ins as CL-02 (G-1) | lifecycle ST-08 |
| CL-11 | Supersession is declared inside the approved content, limited to the same delivery, re-checked at issue, and a delivery has at most one live certificate | TM-21 | FR-030, FR-031 | Certificate service | Tested | lifecycle |
| CL-12 | Filing submission is single-shot: the state moves before the send, a re-entrant call cannot send twice, and a failed send ends in an uncertain state that needs a human, with no automatic retry | TM-23 | FR-027 | Filing service | Tested | lifecycle ST-10 |
| CL-13 | Stored and returned objects are copies: mutating a returned filing, tenant record, custody event or methodology view does not change state; test hooks exist only when a test factory asks for them | TM-09 | SEC-008 | All services | Tested for those four; this is a property of an in-process model, not of a data layer | lifecycle, tenant, methodology |
| CL-14 | The independent verifier handles prototype-named keys, key validity windows, snapshot key binding and snapshot age without throwing or trusting the bundle | TM-21 | SEC-007 | Auditor tooling | Tested | lifecycle ST-01 |
| CL-15 | Approver enrollment and approver key custody (who may hold an approval key, how it is issued, rotated and revoked) | TM-11, TM-24 | SEC-009, SEC-010 | Approver registry, identity | **Not modelled**: the harness approver registry is empty and enrollment is the owner's open step (T53) | none |

## 5. Emissions methodology

| ID | Control | Threats | Requirements | Where it must live | Candidate oracle (Phase 0) | Test |
|---|---|---|---|---|---|---|
| EM-01 | Methods and factor sets are versioned, effective-dated, signed at approval and immutable afterwards; the signature is recomputed over the stored fields on every use, so rewriting a record and its hash together is still detected | TM-18, TM-30 | FR-012, DATA-005 | Methodology registry | Tested | [methodology](../../tests/methodology-registry-contract.test.mjs) ST-07 |
| EM-02 | A change needs a human owner to propose, a different human reviewer, and a different human quality manager to approve; anyone who proposed **or edited** a version cannot review or approve it; an agent cannot hold any of these | TM-18, TM-30 | FR-012, AGT-006 | Registry | Tested | methodology ST-07 |
| EM-03 | A retroactive effective date or an overlapping effective period is refused | TM-20, TM-30 | FR-012 | Registry | Tested | methodology ST-07 |
| EM-04 | A factor set needs a cited source; tampering with a stored approved record is detected and calculation refuses | TM-18, TM-20 | DATA-005, FR-010 | Registry | Tested | methodology ST-07 |
| EM-05 | Fixed-point arithmetic, decimal strings only, units checked, precision and rounding mode stored as data | TM-30 | DATA-007, FR-008 | Calculation service | Tested | methodology |
| EM-06 | A calculation record is signed by the calculation service and names the exact method and factor versions with their hashes, the inputs hash and the build id; a re-run uses those versions, confirms they were the versions that applied on the delivery date (retired versions still count), and reports any difference | TM-30 | FR-009, FR-011, HC-05 | Calculation service | Tested | methodology |
| EM-07 | A missing input, factor or unit mismatch fails closed | TM-13 | FR-010 | Calculation service | Tested | methodology |
| EM-08 | The real method of any certification scheme | TM-20 | D-001, D-002, D-022 | Domain owner | **Not modelled**: the oracle uses a toy linear formula on synthetic factors and implies nothing about any scheme | none |

## 6. Responsible AI

| ID | Control | Threats | Requirements | Where it must live | Candidate oracle (Phase 0) | Test |
|---|---|---|---|---|---|---|
| RA-01 | Everything except system and policy sources is fenced as untrusted data by default, with a per-run unpredictable fence, delimiter characters escaped, and a heuristic flag for instruction-like text (the flag detects, it does not prevent) | TM-12, TM-15 | SEC-012 | Context assembly | Tested | tenant ST-09 |
| RA-02 | Whatever a model proposes, the gateway decides: a scripted adversary that obeys injected instructions is denied and escalated | TM-12, TM-14 | AGT-002, AGT-006 | Gateway | Tested with scripted models only | tenant ST-09 |
| RA-03 | An answer is accepted only if each statement cites records retrieved in this run, every number appears as a whole value in a cited record, number words and exponent forms are refused unless present, a negated or qualified compliance claim goes to a human, and any compliance or certification claim cites an authoritative status record **and mentions its status value** | TM-13, TM-31 | AGT-003, AGT-004, FR-028 | Output validation | Tested; the claim detector and number-word list are patterns, and a wording they do not cover is **not** caught (extra claims next to the status word, units and signs are not checked). Necessary conditions, not proof of truth | tenant ST-09 |
| RA-04 | Refusals and escalations are logged as events with hashes only | TM-12 | AGT-007 | Audit service | Tested | tenant ST-09 |
| RA-05 | The run loop owns the step bound and escalates after repeated denials | TM-14 | AGT-007 | Agent runtime | Tested | tenant ST-09 |
| RA-06 | Sensitive tool output does not enter another tenant's context | TM-16 | SEC-005 | Retrieval | Tested through IS-08 | tenant ST-06 |
| RA-07 | Resistance of a real model to injection, and its rate of invented evidence | TM-12, TM-13 | AGT-008 | Evaluation | **Not tested**: needs a verified model deployment (D-028); the [evaluation plan](../design/ai/AGENT-EVALUATION-PLAN.md) lists every result as NOT RUN | none |

## 7. Audit

| ID | Control | Threats | Requirements | Where it must live | Candidate oracle (Phase 0) | Test |
|---|---|---|---|---|---|---|
| AU-01 | An append-only hash-chained audit log records allowed and denied actions; hostile values are stored only as hashes; an edit, removal, insertion or reorder is detected, and tail truncation is detected given an anchored head | TM-09, TM-32 | AGT-007, SEC-008 | Audit service | Tested | custody, lifecycle, methodology, tenant |

## Summary counts

Counts below are of controls in this file, by status. They are a tally of the rows above, not a measure of security.

| Status | Rows |
|---|---|
| Candidate oracle tested, product not implemented | see the tables above (every row marked "Tested") |
| Not testable yet or not modelled | SV-07, SV-08, IS-09, CC-08, CC-09, CC-11, CL-15, EM-08, RA-07 |
| Implemented in a product | none |

## Known gaps in the oracles

These are limits of the candidate oracles themselves, found by the [independent review](13-SECURITY-REVIEW.md) and left open on purpose. Each needs a decision or a later stage.

| Gap | What is missing |
|---|---|
| G-1 | The oracles are not wired together. The lifecycle's validators are injected stand-ins; the custody verifier does not yet return a manifest hash or quantities, and the calculation service does not return the figures the lifecycle compares. An integration test between them does not exist. |
| G-2 | The independent custody verifier computes `complete` from any device and does not check ordering across devices (a meter reading before the start, events after the end). The accepting verifier does; the offline one does not. |
| G-3 | Approver keys, the approver registry and key custody (CL-15) are not modelled. Approvals are verified against a supplied key map. |
| G-4 | In-process objects stand in for services. Immutability, copy-on-read and tenant checks are properties of the model, not of a database or an API. |
| G-5 | Pattern-based detectors (injection flag, claim words, number words) can be evaded by wording they do not cover. |
| G-6 | The review that found these items was done by a model (TM-32); a human review is open (T56). |

## What this matrix does not establish

It does not establish legal, regulatory or certification compliance. A control being "tested" here means its rule holds in a candidate oracle on synthetic data. Whether a jurisdiction accepts the design, whether a scheme recognises the evidence, and whether a real model resists injection are separate questions that stay open. See [13](13-SECURITY-REVIEW.md).
