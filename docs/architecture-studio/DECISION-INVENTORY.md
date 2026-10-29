# Decision inventory

Status: **discovery only, 2026-10-29**, counted on branch `architecture/target-design` at `392ac02`. **No decision, status or approval was changed or inferred.** Every count below names its source files and its extraction rule (the rule ids R-nn are defined in [DATA-MAPPING](DATA-MAPPING.md)). Regenerate with `node harness/scripts/studio-inventory.mjs`. Anything ambiguous is marked **REVIEW** and listed in section 10.

## 1. Headline counts

| What | Actual count | Source files | Extraction rule |
|---|---|---|---|
| **Decision records (ADRs)** | **20** | `docs/adr/0001` to `0020` (the `0000` file is a pointer to the template) | R-02 |
| of which Accepted | **13** (0001 to 0003, 0005 to 0014) | ADR `Status` lines | R-02 |
| of which Proposed | **7** (0004, 0015 to 0020) | same | R-02 |
| of which Rejected / Superseded / Deferred (as a status) | **0 / 0 / 0** | same; `Supersedes` is `none` on every ADR | R-02, R-15 |
| **Open decisions awaiting an answer** | **37** (all `Open`) | `docs/context/DECISION-REGISTER.md` | R-01 |
| of which needed by M1 / M2 | **17 / 20** | same, column "Needed by" | R-01 |
| **Design records / reviews** | **3 / 3**, all `Blocked` (declared) and `Blocked` (computed) | `docs/architecture/designs`, `reviews`; `design-gate.mjs` | R-03, R-04 |
| Gate blocking reasons / distinct open decisions named | **177 / 25** | `design-gate.mjs` on RV-0001 to RV-0003 | R-04 |
| **Tasks awaiting the owner (`TODO.md` rows)** | **48** | `docs/state/TODO.md` | R-07 |
| of which Open 23, Deferred 15, Approved 4, Decided 2, Done 2, Agreed 1, Not granted 1 | | same | R-07 |
| Other task sets (not merged with the above) | roadmap 17 + `R1b`, open questions 13, backlog 16, capstone gaps 24 | `IMPLEMENTATION-ROADMAP.md`, `OPEN-QUESTIONS.md`, `PRIORITIZED-BACKLOG.md`, `CRITICAL-GAPS.md` | R-09 to R-11 |
| **Approvals: enrolled approvers** | **0** | `harness/policy/approvers.json` | R-13 |
| **Approvals: signed decision-approval records** | **0** | `docs/approvals/` (README only) | R-12 |
| Acceptances recorded by owner instruction in chat (unsigned, grandfathered) | **13** ADRs; 18 dated rows in "Decisions made" | ADR status lines; `TODO.md` | R-14, R-08 |
| Reviews approved | **0**; phase **0** | `validate-approvals.mjs` output, quoted | R-12 |
| **Rejections: decision level** | **0** | ADR and review statuses | R-15 |
| Rejections: option level | **3** structured (`Rejected (hard constraint)`, one per design) and **26** of 71 ADR options worded "rejected" (approximate) | design tables; ADR "Options considered" | R-16 |
| **Registered assumptions** | **26**, all class B, **all unresolved** | `docs/context/ASSUMPTIONS.md` | R-17 |
| Inline assumptions not in the register | **28** in 20 files | `- ASSUMPTION:` bullets | R-18 |
| Model-input assumptions | **79** scenario, 12 verified, 1 benchmark (92) | `docs/business/model/inputs.csv` | R-19 |
| Risks | **14**, all `Open` | `RISK-REGISTER.md` | R-20 |
| Requirements | **99** (Must 80, Should 18, Could 1); traceability rows 99 (match) | `REQUIREMENTS.md`, `NON-FUNCTIONAL-REQUIREMENTS.md`, `REQUIREMENTS-TRACEABILITY.md` | R-21 |
| Evidence runs | **77** (15 with a non-zero exit, kept on purpose) | `docs/evidence/records/` | R-23 |
| **Critical blockers** | **6** (section 8) | computed or quoted | R-24 |
| Items requiring review | **11** flagged by the script; **20** consolidated items in section 10 | | |

## 2. ADRs (20): status, provenance, open decisions mentioned

"Provenance" is how the Accepted label was obtained. **None of the 13 is a signed approval.** The harness's own gate (`approval-gates.cjs`) states that a line of text saying "Accepted" is never enough for a new ADR, and exempts ADRs 0001 to 0015 as a fixed grandfathered list.

| ADR | Title | Type | Status | Date field | Provenance | Open D-ids mentioned |
|---|---|---|---|---|---|---|
| 0001 | Native-first harness; custom code only for documented gaps | none (pre-Type) | Accepted | 2026-10-28 | chat instruction | 0 |
| 0002 | Phase gating and human-approval enforcement via hooks | none (pre-Type) | Accepted | 2026-10-28 | chat instruction | 0 |
| 0003 | Adopt requirements baseline v0.1 as the design input | Governance | Accepted | 2026-10-28 | chat instruction | 0 |
| 0004 | Hold delivery measurements in jurisdiction-local authoritative stores | Design | **Proposed** | 2026-10-28 | none | 12 |
| 0005 | Approve architecture governance capability v0.1 | Governance | Accepted | 2026-10-28 | chat instruction | 0 |
| 0006 | Specialist custom-agent roster and enforcement model | Governance | Accepted | 2026-10-28 | chat instruction | 0 |
| 0007 | Tool layer, MCP configuration and output controls | Governance | Accepted | 2026-10-28 | chat instruction | 1 |
| 0008 | Least-privilege permission model for the coding harness | Governance | Accepted | 2026-10-28 | chat instruction | 1 |
| 0009 | Task-execution framework | Governance | Accepted | 2026-10-28 | chat instruction | 0 |
| 0010 | Persistent memory for the coding harness | Governance | Accepted | 2026-10-28 | chat instruction | 0 |
| 0011 | Bounded plan, execute, verify, critique, repair loop | Governance | Accepted | 2026-10-28 | chat instruction | 0 |
| 0012 | Independent evaluation framework | Governance | Accepted | 2026-10-28 | chat instruction | 0 |
| 0013 | Evaluation findings, effective periods, timestamp rules | Governance | Accepted | 2026-10-28 | chat instruction, **delegated to the architect** (REVIEW) | 2 |
| 0014 | Azure readiness stage: non-deployable IaC scaffold and provisional selection | Governance | Accepted | 2026-10-28 | chat instruction, **partial scope**: actual Azure deployment excluded, deferred as T36 (REVIEW) | 9 |
| 0015 | Jurisdiction-local, tamper-evident evidence ingestion | Design | **Proposed** | 2026-10-29 | none | 9 |
| 0016 | Sovereign evidence cells per jurisdiction with federated coordination | Design | **Proposed** | 2026-10-29 | none | 10 |
| 0017 | Deterministic core and bounded business agents | Design | **Proposed** | 2026-10-29 | none | 9 |
| 0018 | Evidence integrity and certificate mechanism: required properties | Design | **Proposed** | 2026-10-29 | none | 8 |
| 0019 | Azure services selected by requirement and verified per jurisdiction | Design | **Proposed** | 2026-10-29 | none | 6 |
| 0020 | Phase 1a: a local synthetic-data vertical slice inside this repository | Governance | **Proposed** | 2026-10-29 | none | 9 |

Notes: ADR 0014's `Date` field reads 2026-10-28 while its status records acceptance on 2026-10-29; the date field is the creation date. ADRs 0004 and 0015 are Proposed but fall inside the grandfathered range, so accepting them **without** a signature would be permitted by the harness gate: **REVIEW** whether that is intended.

## 3. Open decisions (37)

All 37 are `Open`; the register has no other value. "In gate" = named in a blocking reason of at least one design review. "Req. links" = requirements in the traceability table that cite it. Source: `DECISION-REGISTER.md` (R-01), `design-gate.mjs` (R-04), `REQUIREMENTS-TRACEABILITY.md`.

| ID | Kind | Decision or clarification needed (abridged) | Owner role | Needed by | In gate | Req. links |
|---|---|---|---|---|---|---|
| D-001 | C+D | Certification schemes, regulations and standards in scope | Programme owner with compliance counsel | M1 | no | 0 |
| D-002 | D | Who verifies candidate citations, and the evidence kept | Compliance counsel | M1 | no | 0 |
| D-003 | C | Ports and jurisdictions in the first release; legal entity in each | Programme owner | M1 | yes | 0 |
| D-004 | C | Fuel products and blends in scope | Programme owner, port operations | M1 | no | 0 |
| D-005 | C | Customer population: count, types, onboarding, languages | Commercial lead | M1 | no | 0 |
| D-006 | C | What a "certificate" is; who receives "certification filings" | Quality manager, compliance counsel | M1 | yes | 3 |
| D-007 | C | The quality-manager role and other approver roles | Programme owner | M1 | yes | 4 |
| D-008 | C | What "L4" means; target autonomy per agent and action | Programme owner, security architect | M1 | yes | 3 |
| D-009 | C+D | Residency interpretation per port | Compliance counsel, sovereignty lead | M1 | yes | 5 |
| D-010 | X | Hosting model per port | Enterprise architect | M2 | yes | 7 |
| D-011 | X+C | Which derived data may cross jurisdictions, and on what basis | Compliance counsel, enterprise architect | M2 | yes | 5 |
| D-012 | C | What "locally hosted" is local to | Quality manager, compliance counsel | M1 | yes | 5 |
| D-013 | X | Tamper-evidence mechanism and key custody | Security architect | M2 | yes | 15 |
| D-014 | C | Rules for sharing dispute evidence across jurisdictions | Compliance counsel, commercial lead | M2 | no | 1 |
| D-015 | C | Customer entity model | Commercial lead | M1 | yes | 7 |
| D-016 | C+D | Retention and legal-hold rules | Compliance counsel | M2 | yes | 3 |
| D-017 | C+D | Whether personal data is processed | Data protection lead | M2 | no | 1 |
| D-018 | X | Edge platform and topology | Enterprise architect, port operations | M2 | yes | 8 |
| D-019 | C | Measurement sources and interfaces | Port operations | M1 | yes | 5 |
| D-020 | C | Maximum disconnection duration; actions allowed offline | Port operations, quality manager | M1 | yes | 5 |
| D-021 | X | Trusted time source at the edge | Security architect | M2 | yes | 3 |
| D-022 | C+D | Methodology set and version governance | Quality manager, compliance counsel | M1 | yes | 10 |
| D-023 | C+D | Mass-balance rules | Quality manager | M1 | no | 6 |
| D-024 | C | What counts as feedstock evidence and how it is verified | Quality manager | M1 | yes | 2 |
| D-025 | C | Auditor and certification-body access expectations | Quality manager | M2 | yes | 3 |
| D-026 | C | Dispute policy | Commercial lead, quality manager | M2 | no | 4 |
| D-027 | X | Agent identity, permission and approval model | Security architect | M2 | yes | 12 |
| D-028 | X+D | Where AI inference runs | Sovereignty lead, enterprise architect | M2 | yes | 2 |
| D-029 | C | Shipowner disclosure policy format and enforcement | Commercial lead, quality manager | M2 | yes | 4 |
| D-030 | X | AI evaluation design and acceptance thresholds | Security architect, quality manager | M2 | no | 7 |
| D-031 | C | Availability, recovery and latency targets | Programme owner, port operations | M2 | yes | 4 |
| D-032 | C | Volumes | Port operations | M2 | no | 1 |
| D-033 | C | Operating model per port | Programme owner | M2 | yes | 2 |
| D-034 | C | Business value measures, cost envelope, timeline | Programme owner | M1 | no | 1 |
| D-035 | C | Integration landscape | Programme owner | M2 | yes | 0 |
| D-036 | X | Non-production environments and data | Security architect, sovereignty lead | M2 | no | 1 |
| D-037 | C | Azure tenant, subscription and landing zone | Programme owner | M2 | yes | 0 |

Totals: **25** in gate, **12** not in gate (D-001, 002, 004, 005, 014, 017, 023, 026, 030, 032, 034, 036). **Seven decisions are cited by no requirement** (D-001 to D-005, D-035, D-037), so the traceability table cannot show what they would change: **REVIEW**. Several M1 decisions (D-001, D-002, D-004, D-005, D-023, D-034) are **not** in any gate reason even though the register says they are needed before options analysis. Kind counts: C 21, X 7, C+D 6, D 1, X+C 1, X+D 1 (clarification only 21, verification only 1, architecture only 7, combined 8). Owner roles in the register are **roles, not named people**; naming the people is T3, still deferred.

## 4. Designs and reviews (3 and 3)

| Design | Review | ADRs | Declared | Computed | Blocking reasons | Options: Selected / Not selected / Rejected / Deferred | Defence questions answered / unanswered |
|---|---|---|---|---|---|---|---|
| DES-0001 storage topology | RV-0001 | 0004 | Blocked | Blocked | 50 (17 decisions) | 1 / 2 / 1 / 1 | 11 / 6 |
| DES-0002 evidence ingestion | RV-0002 | 0015 | Blocked | Blocked | 42 (15 decisions) | 1 / 1 / 1 / 1 | 12 / 4 |
| DES-0003 target architecture | RV-0003 | 0016 to 0019 | Blocked | Blocked | 85 (24 decisions) | 1 / 2 / 1 / 0 | 14 / 7 |
| **Total** | 3 | | **3 Blocked** | **3 Blocked** | **177** | **3 / 5 / 3 / 2** | **37 / 17** |

"Selected" means the option under review, **not an approved option**. The `Decider` of every review is `pending`; two reviews were done by model agents and one drafted by the author with a model critique; **no human review has taken place**.

## 5. Tasks (48 `TODO.md` rows)

Status is derived (R-07) because `TODO.md` has no status column. Gaps in the numbering (T6, T7, T10, T18 to T22, T24 to T26, T29 and others) are tasks removed once answered, as the file states; their outcome is in the "Decisions made" table (18 rows) and in Git history.

| Derived status | Count | Task ids |
|---|---|---|
| Open | 23 | T31, T32, T34, T37, T42 to T60 (T42 to T60 is 19 ids) |
| Deferred | 15 | T1 to T5, T8, T9, T11 to T17, T36 |
| Approved (as work) | 4 | T35, T38, T39, T40 |
| Decided (by the architect on the owner's instruction) | 2 | T23, T27 |
| Done | 2 | T30, T41 |
| Agreed | 1 | T28 |
| Not granted | 1 | T33 |

**REVIEW:** T2 carries "Deferred", "answered", "Approved" and "Open" in its text and is flagged ambiguous. Sections of `TODO.md` are dated 2026-10-30, which is **after** today (2026-10-29): see section 10.

## 6. Approvals and rejections

- **Signed approvals: none exist.** `harness/policy/approvers.json` has `"approvers": []`; `docs/approvals/` holds only a README. The validator output, quoted: "Registry: 0 trusted approver(s). ADRs accepted: 13 (13 grandfathered, unsigned, accepted by chat instruction before signing existed; 0 signed). Reviews approved: 0. Phase: 0. No approver is enrolled: no signed approval of any class can exist."
- **Recorded owner acceptances (unsigned):** the 13 Accepted ADRs and 18 dated rows in `TODO.md` "Decisions made". They are the owner's recorded instructions in chat. The studio must show them as **recorded, not signed**.
- **Rejections:** no ADR, review or register entry has a Rejected status. Option-level rejections exist (3 structured `Rejected (hard constraint)` options, one per design, and 26 approximate in ADR option lists).
- **Not granted:** T33 (the owner's blanket approval did not name a read-only Azure identity, tenant or subscription).
- **Deferred decisions:** ADR 0014 (actual Azure deployment, T36) and 15 tasks; 2 design options are `Deferred`.

## 7. Assumptions

| Set | Count | Status |
|---|---|---|
| Registered (`AS-001` to `AS-026`), class B | 26 | **0 resolved.** 23 name an open register decision as the replacement; AS-001 names "ADR" without a number; AS-021 and AS-025 name requirement ids (AGT-003/004, AGT-011) instead of a decision (**REVIEW**) |
| Inline `- ASSUMPTION:` bullets | 28 in 20 files (20 bullets in 19 ADRs, 8 in `EVIDENCE-STORE-PROPOSAL.md`) | none registered; **REVIEW**: they are not in the register, so a reader of the register would miss them |
| Business-model inputs | 79 scenario of 92 | scenario by definition; editable in `inputs.csv` |

## 8. Critical blockers (6)

A blocker here is something the repository's own gates or the platform enforce. Each is computed or quoted, not judged.

| Id | Blocker | Evidence |
|---|---|---|
| **BLK-1** | No approver is enrolled, so no signed decision approval of any class can be valid. Every new ADR acceptance, every design approval and any phase raise is blocked | `approvers.json`; `validate-approvals` |
| **BLK-2** | The phase is 0. Raising it needs an architecture key and a deployment key from different approvers (BLK-1 first) | `approval-gates.cjs`; `STATE.md` |
| **BLK-3** | All 3 design reviews compute **Blocked** (177 reasons) | `design-gate.mjs` |
| **BLK-4** | 25 open decisions are named in those reasons (table in section 3) | same |
| **BLK-5** | 17 decisions are needed by M1, before options analysis (D-001 to D-009, D-012, D-015, D-019, D-020, D-022 to D-024, D-034) | register |
| **BLK-6** | Branch protection cannot be enabled on this plan; `main` accepts any push and CI only detects | `gh api` HTTP 403; `github-protection.json` |

**What blocks what.** These are the repository's own statements, read, not decided here:

| Work | Blocked by |
|---|---|
| Any application code under a phase-gated path | BLK-1, BLK-2. ADR 0020 (Proposed) would bound a local synthetic **Phase 1a**; it needs the owner's signed approval, so it is itself blocked by BLK-1 |
| Phase 1a (ADR 0020, if approved) | by its own text, **not** D-003, D-009, D-010, D-011; it may need rework when D-006, D-007, D-012, D-013, D-027 are decided |
| Accepting the solution ADRs 0004, 0015 to 0019 | BLK-1 for the signature (0016 and above); the 25 gate decisions for a design to compute Approvable |
| Azure deployment | T36 (deferred by the owner), the NOT-READY readiness gate (EV-0076) and D-003, D-009, D-010, D-013, D-018, D-028, D-031, D-033, D-037 |
| **The Architecture Decision Studio itself** | **no decision in the register.** It is tooling that holds no bunkering data. It does need owner decisions about where it lives and how it may write (section 10 of this document and [IMPLEMENTATION-PLAN](IMPLEMENTATION-PLAN.md) OQ-1 to OQ-6) |

## 9. Which decisions are already approved, rejected, proposed, deferred or superseded

| State | ADRs | Notes |
|---|---|---|
| Approved (signed) | **none** | |
| Accepted by recorded owner instruction, unsigned | 0001, 0002, 0003, 0005 to 0014 (13) | grandfathered; 0013 delegated; 0014 partial |
| Proposed | 0004, 0015, 0016, 0017, 0018, 0019, 0020 (7) | none is approved |
| Rejected | none | |
| Deferred | actual Azure deployment (inside ADR 0014; T36) | |
| Superseded | none | `Supersedes: none` throughout, although overlaps exist (section 10) |
| Open (register) | D-001 to D-037 (37) | |

## 10. Conflicts, duplicates and items requiring review

| # | Item | What was found | Needed |
|---|---|---|---|
| 1 | **`main` is 24 commits behind** | The decision-approval gate, ADRs 0016 to 0020, the target architecture and capstone material are not on `main` | Owner decides the merge path |
| 2 | ADR 0004 and ADR 0016 overlap | Both Proposed, both about where evidence lives (jurisdiction-local stores versus sovereign evidence cells with federated coordination); ADR 0016 cites ADR 0004; neither declares a relationship | Owner or reviewer: supersede, merge or keep both |
| 3 | ADR 0015 and ADR 0018 overlap | Evidence ingestion and tamper-evident mechanism options | same |
| 4 | **ADR 0014 (Accepted) and ADR 0019 (Proposed)** | Both select Azure services; 0014 is "provisional", 0019 selects "by requirement". 0019 cites 0014. An accepted provisional selection and a proposed method could disagree | Reviewer: confirm 0019 does not contradict 0014 |
| 5 | Three documents describe the Azure service selection | ADR 0019, `docs/azure/AZURE-REFERENCE-ARCHITECTURE.md`, `docs/target-architecture/07-AZURE-SERVICE-DECISION-MATRIX.md` | Decide the authoritative one; mark the others derived |
| 6 | DES-0003's 13 numbered documents duplicate ADRs 0016 to 0019 and DES-0003 in prose | `docs/target-architecture/**` | Mark as supporting analysis |
| 7 | A proposal outside the ADR system | `docs/design/system/EVIDENCE-STORE-PROPOSAL.md`: "Status: Proposed, authored, unverified (revision 2)", 8 inline assumptions, "DECISION (a proposed decision)" labels | Convert to an ADR or declare it superseded by ADR 0016 |
| 8 | Autonomy baseline versus design record | `AGENT-AUTONOMY-MATRIX.md` (baseline) sets ceilings; `AGENTIC-AUTONOMY-DESIGN-RECORD.md` records two **more conservative** levels as a proposed change "for D-008" without editing the baseline | D-008 is the decision |
| 9 | ADRs 0004 and 0015 are Proposed but within the grandfathered range | accepting them without a signature would be allowed by the gate | Owner: confirm intent |
| 10 | Future-dated records | `TODO.md` ("hardening stage, 2026-10-30"; T15 "Update 2026-10-30"), `STATE.md`, `LIVE-VALIDATION.md` contain 2026-10-30; today is 2026-10-29 | Check the clock or the labels |
| 11 | ADR 0013 | accepted by the architect "on the owner's instruction" | Owner confirms it is the owner's decision |
| 12 | ADR 0014 | accepted for part of its scope | Show the excluded part wherever the status is shown |
| 13 | TODO T2 | status words conflict | Owner rewrites the row |
| 14 | TODO has no status column | status is derived from prose | Decide a structured field before write-back (OQ-4) |
| 15 | Memory lags | `memory/decisions` has DEC records for ADRs 0001 to 0015; **0016 to 0020 are missing** | Run the importer (human) or treat memory as stale |
| 16 | Seven decisions cited by no requirement; six M1 decisions in no gate reason | see section 3 | Traceability review |
| 17 | ID collisions | `T`, `G`, `B`, `R`, `C`, `D`, `A`, `Q` each mean different things in different files | Studio keys by source |
| 18 | AS-001, AS-021, AS-025 | replacement not a register decision | Review |
| 19 | 26 "rejected-worded" ADR options | not a structured field | Do not present as rejections |
| 20 | Rubric PDF absent | see [SOURCE-INVENTORY](SOURCE-INVENTORY.md) section 7 | Owner supplies the PDF |

The first 11 rows of the script's `review` list (ADR-0013, ADR-0014, T2, AS-001, AS-021, AS-025, ADR-0016 to ADR-0020 memory gaps) are items 11, 12, 13, 18 and 15; the others in this table were found by reading.

## 11. What was deliberately not done

No ADR, register entry, task, assumption or risk was edited. No status was changed. No approval was created or requested. Nothing was merged. The only repository writes are this folder, the read-only script `harness/scripts/studio-inventory.mjs` and its generated snapshot, on branch `studio/discovery`.
