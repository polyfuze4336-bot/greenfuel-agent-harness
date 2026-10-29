# End-to-end acceptance trace

Scenario: *design a jurisdiction-local, tamper-evident evidence ingestion subsystem for a green-fuel bunkering delivery.* This trace maps the twelve required steps to artefacts and evidence. It is a record of what happened, including what did not go as well as the summary would like.

**How it was run, stated plainly.** One session (the author) followed the harness's documents and gates. The twelve specialist agents were **not** invoked, because this session's working folder does not load `.github/agents`; the scenario therefore does not demonstrate native delegation. Independent review was supplied by two separate built-in model agents (a design critic and a security reviewer), read-only, run twice. Native delegation through the harness hook was shown earlier in the CLI (`docs/orchestration/DEMO-EVIDENCE-STORE.md`, run `RUN-afb2a0466e`). No human took part. No Azure resource was created or queried.

| Step | Required | What was done | Artefact | Evidence |
|---|---|---|---|---|
| 1 | Read the authoritative requirements | Read the approved baseline, the hard constraints, the sovereignty matrix, ADR 0003, ADR 0013 and the unresolved decision register | docs/context/, docs/architecture/HARD-CONSTRAINTS.md | Baseline validation (EV-0004, EV-0018) |
| 2 | Identify the sovereignty and security constraints | HC-01 (residency), HC-06 (no invented measurement), HC-07 (offline), HC-08 (integrity and audit reconstruction) and HC-09 to HC-12; SEC-001, SEC-002, SEC-008, SEC-012, SEC-013, NFR-001, NFR-004 | DES-0002 section 6 constraints CN-001 to CN-007 | The design validator accepts the trace |
| 3 | Produce architecture alternatives | Four options: online-only, edge hash-chained log with store-and-forward, managed ledger, post-delivery file export | DES-0002 sections 2 and 3 | RV-0002 option screen |
| 4 | Select a justified design | Option B selected; A rejected for violating HC-07; C deferred; D not selected. Tradeoffs TD-001 to TD-004 and assumptions DA-001 to DA-005 recorded | DES-0002 | RV-0002 sections 1 and 4 |
| 5 | Record an ADR | Design ADR 0015, status **Proposed**. It cannot be Accepted because the gate computes Blocked | docs/adr/0015-evidence-ingestion-subsystem.md | Validator: a Design ADR needs an Approved review to be Accepted |
| 6 | Create a scoped implementation plan | Steps P0 to P5, each with exit evidence and needs; P4 and P5 are not authorised | DES-0002 section 10 | n/a: a plan |
| 7 | Generate a small testable prototype or contract fixture | A candidate contract and reference model, with synthetic fixtures. It is a specification harness and not the application | harness/contracts/ingestion-contract.mjs; tests/fixtures/ingestion/ | EV-0048 |
| 8 | Execute appropriate tests | Unit and contract tests, hand-written independent hash vectors, mutation spot-checks, three evaluation checks in the production-contract suite | tests/ingestion-contract.test.mjs; evaluation/checks/ingestion-contract.eval.mjs | EV-0048, EV-0055; the committed run `EVRUN-9b6110b026` |
| 9 | Request independent architecture and security review | Round 1 and round 2 with a design critic and a security reviewer | docs/architecture/reviews/RV-0002-evidence-ingestion-subsystem.md | Gate run EV-0049 |
| 10 | Record failures and remediation | RV-0002 section 7 lists every finding, its severity, the remediation or the reason it stays open, and the evidence | RV-0002 section 7 | Contract tests, including regression tests for each fixed finding |
| 11 | Produce evidence linking requirements to design and tests | Generated coverage and evidence index; the DES-0002 trace maps 21 requirements to design elements with a status each | docs/acceptance/REQUIREMENTS-COVERAGE.md; TEST-EVIDENCE-INDEX.md; DES-0002 section 4 | The generator output is compared with the committed files by the repository validator |
| 12 | Pause before any Azure provisioning | No Azure command was run. The readiness utility reports NOT-READY and gate DG-12 and the phase gate stay closed | docs/azure/DEPLOYMENT-STRATEGY.md | EV-0050 (exit 2, NOT-READY) |

## Failures during the scenario

| Failure | Found by | Remediation |
|---|---|---|
| The first contract trusted sender-supplied time, policy and jurisdiction | Round 1 | The verifier owns the cell identity, registry, skew and clock |
| Key collisions, prototype keys and echoed hostile text | Round 1 | Strict identifier pattern, maps keyed by source, formatted echo |
| Store check bypass by removing a head; delivery with no start | Round 2 | Source set from events, heads and batches; lifecycle rule that flags and keeps |
| Forged consistent continuation; whole-store rewrite; unbounded stream | Round 2 | **Not fixed.** Disclosed in DES-0002 and RV-0002; they need D-013, D-020 and D-031 |
| One reported blocker was mistaken (the fixture could not build a store) | Round 2 | Checked: the fixture already supplies the parameter. Recorded as a mistaken finding |

## What this scenario does not show

- That a real edge component, cell service or store exists or would behave as the reference model does.
- That any residency, certification or standards requirement is satisfied.
- That the harness's own agents can run the scenario end to end (they were not invoked).
- Anything about performance, availability or cost: none was measured or claimed.
