# Hard Constraints

Status: v0.1, 2026-10-28. A hard constraint is a statement from the case study or the programme brief that no design may violate. The design-review gate ([DESIGN-REVIEW-GATE](DESIGN-REVIEW-GATE.md)) rejects a design whose selected option violates any of these. A hard constraint cannot be waived, traded off, or deferred.

How to use: the reviewer screens every option against every constraint and records a verdict (Satisfied, Conditional, Violated, Unresolved, Not applicable) with a reason. See [REVIEW-PERSPECTIVES](REVIEW-PERSPECTIVES.md) for where each constraint is examined.

Verdict meanings:
- **Satisfied**: the design, as written, meets the "Reject when" test, with the reason stated.
- **Conditional**: satisfied only if the named open decisions are answered a particular way. Treated as unresolved while any of them is open.
- **Violated**: the "Reject when" test is met. The option is rejected.
- **Unresolved**: the design says nothing, or too little, to tell.
- **Not applicable**: the constraint cannot touch this design. A reason is mandatory.

| ID | Constraint | Source | Reject when | Related requirements |
|---|---|---|---|---|
| HC-01 | Delivery measurement data stays within its originating port jurisdiction. A region choice is not proof | CS-C1; CS-P4 | Any raw or evidence-grade delivery measurement data, or anything derived from it that is not on an approved flow, is stored, replicated, backed up, logged, processed (including AI inference) or administered outside the originating jurisdiction; or residency rests on region selection alone; or no legal basis is recorded for a cross-border flow (D-009, D-011) | SEC-001; SEC-002; SEC-003; SEC-004; NFR-009; BR-006 |
| HC-02 | Customer compliance data is isolated per shipowner | CS-C2 | Any index, cache, embedding store, memory, log view, credential or compute context is shared across shipowners, or isolation relies on instructions to an agent | SEC-005; SEC-006; NFR-010; BR-004; FR-023 |
| HC-03 | Certificates are tamper-evident and locally hosted | CS-C3 | An independent verifier cannot detect alteration; or hosting, signing keys or verification depend on a location other than the one fixed under D-012; or verification needs a service outside that location | FR-026; SEC-007; NFR-011 |
| HC-04 | Certification filings require quality-manager approval | CS-C4 | Any path lets an agent identity, an unapproved person, or the preparer alone approve or submit a filing; or approval is not tied to the exact content submitted | FR-027; SEC-010; AGT-005 |
| HC-05 | Emissions calculations are reproducible and traceable to the exact methodology version | CS-C5 | A result cannot be re-run from stored inputs, methodology version and build; or a language model is on the calculation path; or the methodology version is implicit | FR-008; FR-009; FR-011; NFR-002 |
| HC-06 | AI cannot invent sensor measurements, emissions factors, feedstock evidence or certification status | CS-C6 | Any such value can originate from model output, or from an input with no recorded provenance; or a missing value is silently replaced by a default or estimate | FR-010; FR-014; FR-028; AGT-003; AGT-004 |
| HC-07 | Edge-to-shore connectivity can be intermittent | CS-C7 | Evidence capture or a delivery operation depends on live shore connectivity, or data is lost or reordered undetectably when the link drops | FR-006; NFR-004; NFR-005; NFR-006; BR-007; AGT-010 |
| HC-08 | The architecture supports evidence integrity, dispute resolution and audit reconstruction | CS-C8 | Evidence can be modified or deleted undetectably; or a certificate cannot be traced to raw readings, documents, methodology version, approvals and agent actions | NFR-001; SEC-008; FR-029; DATA-003; AGT-007; FR-005 |
| HC-09 | Autonomy is not permission | CS-P3 | A permission is derived from an autonomy label; or an action limit is enforced only by prompt; or any agent holds an unrestricted commercial, regulatory or infrastructure action | AGT-002; AGT-006; SEC-009 |
| HC-10 | Standards, schemes and regulations are candidates until verified | CS-P5 | The design states a candidate as binding, or claims compliance, applicability or certification, before the candidate is recorded as Verified (D-002) | FR-007; FR-012 |
| HC-11 | No autonomous production deployment, no resource creation by an agent, and no application build before the phase is raised by a human | CS-P2; programme brief | The design needs an agent to deploy to production or create cloud resources unattended; or requires application code before the phase is raised | BR-009; AGT-006; AGT-011 |
| HC-12 | No fabricated performance, availability, cost or compliance figures | Programme brief | The design, an ADR or a review states such a figure without a cited source, or presents a placeholder as a target | BR-008; NFR-003 |
