# Unresolved Decision Register

Status: baseline v0.1, 2026-10-28. **Every entry is open.** No decision here has been made, and no option is recommended. Entries become ADRs in [docs/adr/](../adr/) once decided by the named role.

## How to read this register

**Kind**
- **C**: stakeholder clarification. A fact only the business can supply.
- **D**: regulatory or certification claim that needs verification by a qualified person. See [CERTIFICATION-SCHEMES](CERTIFICATION-SCHEMES.md).
- **X**: architecture decision. The options are known; choosing needs analysis and approval.
- Combinations (for example C+D) need both.

**Needed by**
- **M1**: before options analysis for the reference architecture starts.
- **M2**: before reference-architecture ADRs can be accepted.
- **M3**: before the implementation phase can be unlocked (see [ADR 0002](../adr/0002-phase-gating-and-approval-enforcement.md)). No entry is pinned to M3 yet; M3 gating will be set when the reference architecture exists.

**Owner** is a role, not a named person. Naming the people is owner TODO T3 in [TODO](../state/TODO.md).

Requirements cite these IDs in [REQUIREMENTS-TRACEABILITY](REQUIREMENTS-TRACEABILITY.md). Assumptions that stand in until a decision is made are in [ASSUMPTIONS](ASSUMPTIONS.md).

## Register

| ID | Kind | Decision or clarification needed | Why it matters | Known options (none chosen) | Owner role | Needed by | Status |
|---|---|---|---|---|---|---|---|
| D-001 | C+D | Which certification schemes, regulations and standards are in scope | Determines methodologies, evidence content and filings. Everything in CERTIFICATION-SCHEMES is only a candidate | One scheme first or several; EU-oriented, IMO-oriented, national, or a mix | Programme owner with compliance counsel | M1 | Open |
| D-002 | D | Who verifies candidate citations, by what procedure, and what evidence of verification is kept | No compliance claim may be made until verified. Secondary summaries disagreed in places | Internal compliance counsel; external verifier; scheme owner confirmation | Compliance counsel | M1 | Open |
| D-003 | C | Ports and jurisdictions in the first release; legal entity operating in each | Drives residency, hosting, approvals and law. Not stated in the case | Single port pilot; several ports; all ports | Programme owner | M1 | Open |
| D-004 | C | Fuel products and blends in scope (for example liquid biofuel blends versus other green fuels) | Measurement method, blending model and schemes differ by fuel | Liquid blends only first; add other fuels later | Programme owner, port operations | M1 | Open |
| D-005 | C | Customer population: count, types (owner, operator, charterer, manager), onboarding, languages | Sets isolation granularity, scale and disclosure workflows | See D-015 | Commercial lead | M1 | Open |
| D-006 | C | What a "certificate" is in this programme: types, issuer, relying parties; and which external bodies or registries receive "certification filings" | CS-C3 and CS-C4 cannot be designed without it | Group-issued delivery certificate; scheme-issued; both | Quality manager, compliance counsel | M1 | Open |
| D-007 | C | The quality-manager role: per port or group, number, delegates and deputies, separation of duties; other approver roles (commercial reviewer, data owner) | Approval design and SEC-010. The "commercial review" reviewer is not named in the case | One per port; central; layered | Programme owner | M1 | Open |
| D-008 | C | What "L4" means, the target autonomy level per agent, and per action | CS-P3. Autonomy is not permission. See [AGENT-AUTONOMY-MATRIX](AGENT-AUTONOMY-MATRIX.md) | Adopt the working scale in the matrix; adopt a programme scale | Programme owner, security architect | M1 | Open |
| D-009 | C+D | Residency interpretation per port: legal source, and whether "within jurisdiction" covers storage, processing, access, backups, metadata, telemetry and AI inference | CS-C1 and CS-P4. A region name does not answer this | Per-jurisdiction legal opinion; contractual interpretation; regulator confirmation | Compliance counsel, sovereignty lead | M1 | Open |
| D-010 | X | Hosting model per port: in-country cloud region, hybrid or edge-hosted platform, on-premises, partner | Whether an in-country Azure region exists and meets D-009 must be verified, not assumed | Azure in-country region; Azure hybrid or Arc-enabled infrastructure; on-premises; partner-hosted | Enterprise architect | M2 | Open |
| D-011 | X+C | Which derived data may cross jurisdictions (hashes, aggregates, certificate metadata, mass-balance totals) and on what legal basis | Group reporting and cross-port balance need some flow | None; hashes only; aggregates; approved list | Compliance counsel, enterprise architect | M2 | Open |
| D-012 | C | What "locally hosted" is local to (port, issuing entity, customer jurisdiction, group) and how third parties verify a certificate | CS-C3 and SEC-007 | Per-port hosting; per-entity; offline-verifiable bundle | Quality manager, compliance counsel | M1 | Open |
| D-013 | X | Tamper-evidence mechanism and key custody: signatures, hash chains, transparency log, ledger service, timestamping authority, HSM ownership | CS-C3, CS-C8, NFR-011 | Per-record signatures with append-only log; third-party timestamping; distributed ledger | Security architect | M2 | Open |
| D-014 | C | Rules for sharing dispute evidence with a customer, arbitrator or authority in another jurisdiction | Conflicts with CS-C1 | Share verified extracts only; in-jurisdiction viewing; contractual exception | Compliance counsel, commercial lead | M2 | Open |
| D-015 | C | Customer entity model: is "shipowner" a legal entity, a group, or a fleet; treatment of charterers and managers | CS-C2 isolation granularity | Per legal entity; per fleet; per contract | Commercial lead | M1 | Open |
| D-016 | C+D | Retention periods and legal-hold rules per data class and jurisdiction | DATA-006, storage, certificate verifiability | Per-scheme maximum; per-jurisdiction maximum | Compliance counsel | M2 | Open |
| D-017 | C+D | Whether personal data is processed (signatories, crew, surveyors, customer staff) and which privacy regimes apply | DATA-010 | Minimise to business contact data; pseudonymise | Data protection lead | M2 | Open |
| D-018 | X | Edge platform and topology: what runs on the vessel or terminal, hardware ownership, update path | CS-C7, SEC-013 | Gateway device; on-vessel server; terminal-hosted | Enterprise architect, port operations | M2 | Open |
| D-019 | C | Measurement sources and interfaces: meter makes and models, logger outputs, signing capability, sample and seal records, bunker delivery note formats, existing systems | FR-001 to FR-004 cannot be specified without them | Direct logger feed; file export; manual entry with approval | Port operations | M1 | Open |
| D-020 | C | Maximum disconnection duration and which actions are allowed offline (capture only, or also issue certificates) | NFR-004, SEC-007 | Capture-only offline; limited offline issuance | Port operations, quality manager | M1 | Open |
| D-021 | X | Trusted time source at the edge and drift handling | Evidence ordering and integrity | GNSS; network time; signed time service | Security architect | M2 | Open |
| D-022 | C+D | Methodology set and version governance: who approves a version, how factors are imported and signed, reproducibility standard (bit-identical versus tolerance), numeric rules | CS-C5, FR-007 to FR-012 | Scheme owner defaults only; group-specific actual values where permitted | Quality manager, compliance counsel | M1 | Open |
| D-023 | C+D | Mass-balance rules: system boundary, balancing period, allocation, loss and negative-balance handling per scheme | FR-017 to FR-021 | Per port; per legal entity; per scheme | Quality manager | M1 | Open |
| D-024 | C | What counts as feedstock evidence and how it is verified (documents, scheme database lookup, auditor attestation) | CS-C6, FR-003 | Verifier attestation; registry lookup; document check | Quality manager | M1 | Open |
| D-025 | C | Access and expectations of auditors and certification bodies for audit reconstruction | CS-C8, FR-029 | In-jurisdiction read-only access; exported packs | Quality manager | M2 | Open |
| D-026 | C | Dispute policy: types, time limits, who decides, forum, sample linkage, evidence pack contents | CS-CAP-3, FR-013 to FR-016 | Contractual process; standards-based process | Commercial lead, quality manager | M2 | Open |
| D-027 | X | Agent identity, permission and approval model: identities, action catalogue enforcement, approval service | CS-P3, AGT-002, SEC-010 | Per-agent managed identities with platform-enforced action catalogue and content-hash approvals | Security architect | M2 | Open |
| D-028 | X+D | Where AI inference runs and how prompts and retrieved data are kept in-jurisdiction | CS-C1 for any agent reading delivery data. Deployment types of AI services differ in where processing occurs and must be verified | In-jurisdiction model hosting; no AI on sovereign data; local models | Sovereignty lead, enterprise architect | M2 | Open |
| D-029 | C | Format, authoring and enforcement of shipowner disclosure policies; refusal and escalation behaviour | CS-CAP-5, FR-023, FR-024 | Policy as data per customer; templates | Commercial lead, quality manager | M2 | Open |
| D-030 | X | AI evaluation design and acceptance thresholds (no-invention, isolation, refusal) | AGT-008 | Fixed test sets with zero-tolerance cases; sampling review | Security architect, quality manager | M2 | Open |
| D-031 | C | Availability, recovery-point, recovery-time and latency targets per capability and port; whether certification is needed at delivery time | NFR-003 to NFR-008, NFR-014 | See NFR placeholders | Programme owner, port operations | M2 | Open |
| D-032 | C | Volumes: deliveries per port per day, customers, meter sample rates, retention volume | NFR-015, cost, edge sizing | Estimate from operations data | Port operations | M2 | Open |
| D-033 | C | Operating model: who runs and supports the platform per port, and support access across jurisdictions | SEC-002. Remote administration can breach residency | In-jurisdiction operators; controlled break-glass | Programme owner | M2 | Open |
| D-034 | C | Business value measures with baselines, cost envelope, timeline | BR-008. The case gives no financials | See [BUSINESS-CASE](BUSINESS-CASE.md) | Programme owner | M1 | Open |
| D-035 | C | Integration landscape: bunker management, ERP, port authority systems, customer portals | Interfaces and data ownership | Inventory existing systems | Programme owner | M2 | Open |
| D-036 | X | Non-production environments and data: synthetic data only, or approved masked data, per jurisdiction | DATA-009, residency in test | Synthetic only; in-jurisdiction test environments | Security architect, sovereignty lead | M2 | Open |
| D-037 | C | Azure tenant, subscription and landing zone for the programme; enterprise-managed Copilot settings; read-only identity for agents | Harness questions Q6 and Q9; no Azure resource exists or has been queried | Existing enterprise landing zone; dedicated tenant | Programme owner | M2 | Open |

## Summary
- 37 open entries (counted when this version was written): clarification only 21, verification only 1, architecture only 7, combined 8.
- M1 blockers (needed before options analysis): D-001 to D-009, D-012, D-015, D-019, D-020, D-022 to D-024, D-034.
- Nothing here has been decided by an agent. Any proposed answer lives in [ASSUMPTIONS](ASSUMPTIONS.md) with its risk if wrong.
