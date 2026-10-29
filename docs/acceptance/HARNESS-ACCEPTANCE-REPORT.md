# Harness acceptance report

Final acceptance review of the `greenfuel-agent-harness`, written as an independent review: the question is not whether files and scripts exist but whether each capability was shown to work. Nothing below is a success claim unless a recorded run, a test or an inspectable artefact stands behind it. Generated companions: [REQUIREMENTS-COVERAGE](REQUIREMENTS-COVERAGE.md) and [TEST-EVIDENCE-INDEX](TEST-EVIDENCE-INDEX.md). Others: [ARCHITECTURE-DEFENSE](ARCHITECTURE-DEFENSE.md), [REMAINING-RISKS](REMAINING-RISKS.md), [NEXT-PHASE-IMPLEMENTATION-PLAN](NEXT-PHASE-IMPLEMENTATION-PLAN.md) and the [end-to-end trace](E2E-ACCEPTANCE-TRACE.md).

## 1. Recommendation

| Question | Answer |
|---|---|
| Is the harness ready to govern Phase 0 design work? | **Yes, with conditions.** The control plane (validators, hooks, gates, evidence recorder, memory, loop, evaluation, CI) exists, runs deterministically and has real negative tests. The conditions are the limits stated in section 5. |
| Is it ready for application development (Phase 1)? | **No.** Critical blockers CB-1 to CB-4 below are open. The phase must be raised by the owner through an ADR, and nothing in this review does that. |
| Is it ready for any Azure deployment? | **No.** The readiness utility reports NOT-READY, deployment was deferred by the owner (TODO T36), and no tenant, subscription, identity or approver exists. |

**Overall readiness: CONDITIONALLY READY AS A PHASE 0 DESIGN-AND-GOVERNANCE HARNESS; NOT READY FOR BUILD OR DEPLOYMENT.**

### Critical blockers

| ID | Blocker | Why it blocks | What unblocks it |
|---|---|---|---|
| CB-1 | No human decider or approver is named (TODO T3, T13). The approver registry is empty | No design can be Approved, no ADR for a design can be Accepted, and no operation at tier P2 or above can be performed by an agent | The owner names deciders and approvers and registers their public keys through a reviewed change |
| CB-2 | The 37 baseline decisions are open, including D-003, D-009, D-010, D-011, D-013, D-018, D-019, D-020 and D-021 (TODO T2, T31, T34) | Hard constraints HC-01, HC-06, HC-07 and HC-08 are only Conditional on them, so DES-0001 and DES-0002 compute Blocked and gates G2 and G3 cannot pass | The owner supplies the facts. A blanket approval cannot |
| CB-3 | The independent evaluation shows genuine failures and a blocked progression: see section 4 | A critical gate failure blocks progression by design, and aggregate results do not hide it | Remediation of the three FAIL findings and the design approvals above |
| CB-4 | No operating-system isolation for agent sessions or for code under test (TODO T15, roadmap R15) | The hook is a screen and not a security boundary. Code under test can subvert its own test runner | A dev container, a separate account or a VM without Azure and Git credentials |

Non-critical but material: no branch protection on this plan (T14), human memory writers are self-declared (R14), the VS Code behaviours were reported by the owner and not observed (T8, T9, T12), and no production-agent test exists.

## 2. What was independently shown and what was not

- **Observed by me in this review:** a fresh `git clone` of the previous pushed commit passed the repository validator and every specialist validator, and the full test suite ran there (701 tests, all passing, none skipped) without installing any dependency, because the package has none. That observation was **not recorded** at the time. The recorded evidence is a fresh clone of the Stage 12 content commit that ran the repository validator and the new contract and generator tests (EV-0057). The end-to-end scenario was designed, prototyped and tested here, and its tests ran (EV-0048).
- **Independent model reviewers:** the contract and the design were challenged in two rounds by two separate read-only model agents (a design critic and a security reviewer). They found real defects, all recorded in RV-0002 section 7. They are models, not people, and they are not evidence records.
- **Not independent:** the author, the harness agents and the reviewers are all language models. No human has reviewed any design, ADR or this report. This is the largest governance limit and is recorded as RK-012.
- **Not done in this session:** the harness's own twelve specialist agents were not invoked, because this session's working folder does not load them. The scenario was executed by one session following the harness's documents and gates, with the independent review supplied by built-in model agents. Native delegation through the harness hook was shown earlier in the CLI (run `RUN-afb2a0466e`) and was reported by the owner in VS Code. VS Code itself was not observed and was not restarted.
- **Nothing was created in Azure** and no Azure or GitHub sign-in was used by any agent.

## 3. Capability classification

Classes: **IMPLEMENTED AND VERIFIED** (built, and a recorded run or test shows it works as stated), **IMPLEMENTED BUT NOT VERIFIED** (built, but no recorded run or observation shows it works), **PARTIALLY IMPLEMENTED**, **NOT IMPLEMENTED**, **BLOCKED** (cannot proceed without a decision, identity or approval that does not exist). Verified means verified for what the evidence covers, and the limit column says what it does not.

### 3.1 The six pillars

| ID | Capability | Class | Evidence | Limit |
|---|---|---|---|---|
| **Pillar 1: Tools** | | | | |
| T-1 | Tool registry, validators, local MCP server and per-agent grants | IMPLEMENTED AND VERIFIED | EV-0017, EV-0019 and the tool tests in EV-0055 | Enabled tools are read-only by rule. Local zero-dependency server only |
| T-2 | Output sanitising (secret redaction, hidden characters, size cap, untrusted boundary) | IMPLEMENTED AND VERIFIED | Tool-guard tests and the Copilot CLI transcript in TOOL-DEMO | The transcript is an observation, not an evidence record. VS Code was not observed (T12) |
| T-3 | Remote documentation server (Microsoft Learn) for one agent | IMPLEMENTED BUT NOT VERIFIED | Configuration checked by validator; one CLI call observed | No recorded run of a call; VS Code trust prompt unverified |
| T-4 | Azure MCP and GitHub MCP | BLOCKED | Pinned and reviewed candidates, not configured | Needs a named read-only identity and subscription (T11, T33). Not approved |
| **Pillar 2: Context** | | | | |
| C-1 | Requirements baseline, decision register and context-loading profiles, checked for consistency | IMPLEMENTED AND VERIFIED | EV-0004, EV-0009, EV-0018; gate G1 passes in the committed run | Checks structure and consistency, not truth (RK-014) |
| C-2 | Specialist agents actually load the right documents per profile | IMPLEMENTED BUT NOT VERIFIED | Profiles and a validator exist | The live context test was never run (roadmap R11, T8) |
| C-3 | Hard constraints applied to designs by the design gate | IMPLEMENTED AND VERIFIED | Gate tests; EV-0007, EV-0008, EV-0010; RV-0002 gate run (EV-0049) | The gate computes from author- and reviewer-supplied text |
| C-4 | Requirements completeness | PARTIALLY IMPLEMENTED | 99 requirements, 37 decisions; see REQUIREMENTS-COVERAGE | Most decisions are open; many Must requirements are specified only |
| **Pillar 3: Execution** | | | | |
| E-1 | Deterministic task engine: dependency planning, state, checkpoints, resume, bounded retries, error classes, approval pauses, history | IMPLEMENTED AND VERIFIED | EV-0027, EV-0029, EV-0030 | Retry path, lease expiry and task approvals were tested but not exercised live |
| E-2 | Native delegation driven and recorded by the hook | IMPLEMENTED AND VERIFIED | Run `RUN-afb2a0466e` verifies (EV-0030) | Observed in Copilot CLI only. VS Code is owner-reported (T9) |
| E-3 | The end-to-end scenario run through the harness's own agents | PARTIALLY IMPLEMENTED | The trace and its evidence | The harness agents were not invoked in this session (section 2) |
| **Pillar 4: Permissions** | | | | |
| P-1 | Policy-as-code decision engine behind the hooks, with negative tests | IMPLEMENTED AND VERIFIED | EV-0024, EV-0025 | A regular-expression screen, not a boundary; evasion is possible and documented |
| P-2 | Signed human approvals for tier P2 and above | PARTIALLY IMPLEMENTED | Engine and tests with test keys | No real approver is registered, so no real approval has ever been verified (T13) |
| P-3 | Operating-system isolation or sandbox | NOT IMPLEMENTED | none | Agents run as the user's account (T15, R15) |
| P-4 | GitHub branch protection and required review on control-plane paths | BLOCKED | EV-0026 reports it unavailable on this plan | Needs a plan upgrade or a public or organisation repository (T14) |
| P-5 | Azure identities, custom role, locks and policy | BLOCKED | Specifications only, nothing created | Needs the subscription decision (D-037, T17, T33) |
| **Pillar 5: Memory** | | | | |
| M-1 | Store, governance, conflict detection, poisoning rejection, sensitive-field refusal, expiry, resume | IMPLEMENTED AND VERIFIED | EV-0031 to EV-0034; the seven memory scenarios | Verified with fixtures |
| M-2 | Survival across a VS Code restart | IMPLEMENTED BUT NOT VERIFIED | Storage is plain files in Git; a session was reconstructed from state in tests | No VS Code restart was performed |
| M-3 | Authenticated human memory writers | NOT IMPLEMENTED | none | Self-declared writers can approve entries (T23, R14). The owner reviews the diff as the interim control |
| **Pillar 6: Loop** | | | | |
| L-1 | Plan, execute, verify, critique, repair loop with budgets, failure classes, escalation and recovery | IMPLEMENTED AND VERIFIED | EV-0035 to EV-0038; LOOP-VALIDATION-REPORT; six scenarios | The TypeScript scenario is skipped in CI (allowed, recorded difference) |
| L-2 | Independent review inside the loop | IMPLEMENTED AND VERIFIED | Loop tests (self-review refused, wrong reviewer refused, rework counts as repair) | The reviewing agent is a model |
| L-3 | Sandboxed execution of code under test | NOT IMPLEMENTED | none | Code under test can replace the test runner's assertions (R15) |

### 3.2 Additional validation areas

| ID | Capability | Class | Evidence | Limit |
|---|---|---|---|---|
| A-1 | Architecture evidence traceability (requirement to design to test) | PARTIALLY IMPLEMENTED | REQUIREMENTS-COVERAGE is generated and checked | Many requirements are designed only or specified only |
| A-2 | Independent design review | PARTIALLY IMPLEMENTED | Gate plus two model review rounds on DES-0002 | No human review and no approved design |
| A-3 | Azure deployment controls (static): non-deployable scaffold, twelve computed gates, approval requirement | IMPLEMENTED AND VERIFIED | EV-0020, EV-0044, EV-0045, EV-0050 | Static checks only; nothing ran against Azure |
| A-4 | Actual Azure deployment | BLOCKED | Deferred by the owner (T36) | Also needs T32, T33 and signed approvals |
| A-5 | Prompt-injection resistance | PARTIALLY IMPLEMENTED | Hook, output guard and memory tests; contract tests for hostile payloads | No model-level test and no production agent exists |
| A-6 | Deterministic test execution | PARTIALLY IMPLEMENTED | EV-0055 (762 tests, all pass); two further unrecorded full runs also passed; CI green on the pushed commits | **One unexplained intermittent failure:** EV-0054 recorded 1 failed test of 762 on a clean tree and it did not recur in three later full runs, so determinism is not shown. The recorder keeps only the output tail, so the test was not identified (finding F-9, TODO T41). EV-0052 and EV-0053 are explained failures from running before the generated evidence index was regenerated. One scenario is skipped in CI |
| A-7 | Audit-log completeness | PARTIALLY IMPLEMENTED | The denial log chain verifies | It is local, git-ignored, denial-only and not anchored outside the machine (T16) |
| A-8 | Reproducible setup | IMPLEMENTED AND VERIFIED | Fresh clone (EV-0057) and CI | One local operating system; the toolchain for TypeScript and Bicep is optional |
| A-9 | Documentation quality | IMPLEMENTED BUT NOT VERIFIED | Link, figure and compliance-claim lints | No human reader. This review found stale status labels, now fixed |
| A-10 | Production-agent security and evaluation tests | NOT IMPLEMENTED | Tests are catalogued as pending | No production agent exists |
| A-11 | Evaluation gates G2 to G7 | BLOCKED | The committed run | G2 and G3 fail on real findings; G4 to G7 are blocked behind them |

Classification totals are in [section 7](#7-classification-totals).

## 4. Evaluation result

The committed run is `EVRUN-36a72c3e30` (made at the clean commit `e4a2f82`): PASS 53, FAIL 3, BLOCKED 1, PENDING 16, of 73 tests. Gate G1 passes, G2 and G3 fail, G4 to G7 are blocked, and hard constraint HC-08 is marked violated. The failing tests are findings, not defects of the framework, and none was edited to pass:

| Test | Finding | Remediation owner |
|---|---|---|
| EVAL-PRC-ARC-001 | DES-0001 is not Approved, so the architecture gate cannot pass | Owner and deciders |
| EVAL-PRC-DAT-005 | The methodology and reference-data contract has no effective period | Roadmap R16, ADR 0013 |
| EVAL-PRC-DAT-006 | The lineage contract lacks the time-order and trusted-time rule | Roadmap R16, ADR 0013 |

The three tests added by this stage (EVAL-PRC-DAT-007, EVAL-PRC-DAT-008, EVAL-PRC-SOV-004) check the candidate ingestion contract and ran in the committed run. They show the reference model behaves as the tests state on synthetic fixtures. They do not show that any production component exists or that any scheme is satisfied.

## 5. Findings from this review

| # | Finding | Severity | Status |
|---|---|---|---|
| F-1 | The first contract let the sender set the receiving time, policy and jurisdiction claim, so the checks compared claims with claims | High | Fixed, tested |
| F-2 | Cross-source key collisions, prototype keys, non-finite numbers and echoed hostile text | High and Medium | Fixed, tested |
| F-3 | The stand-alone store check could be bypassed by removing a source head, and a delivery could end without a start | High | Fixed, tested |
| F-4 | Backdated events were bounded only by non-decreasing order | Medium | Fixed: the verifier's own maximum age is a required parameter |
| F-5 | A forged consistent continuation advances the chain and stalls the real edge; the whole store can be rewritten by whoever can write it; storage is unbounded across many small batches | High | **Open by design:** needs signing, quarantine, an external anchor and quotas (D-013, D-020, D-031). Disclosed in DES-0002 and RV-0002 |
| F-6 | Stale ADR status labels in four documents (ADR 0010, 0011, 0012, 0014 shown as Proposed after acceptance) | Low | Fixed in this stage |
| F-7 | The committed evaluation run became stale when three tests were added to the catalogue | Process | Fixed: a new full run was recorded |
| F-8 | The audit log is denial-only and local, so the question "what did agents do" is answered only by evidence records and run stores | Medium | Open (T16) |
| F-9 | One full test run (EV-0054) recorded 1 failed test of 762 on a clean tree. It did not recur in three later full runs. The recorder keeps only the last part of the output, so the failing test was not identified | Medium | **Open:** cause unknown. The recorder should keep failing-test names (TODO T41) |

## 6. What needs the owner

1. Review and decide whether to push the Stage 12 commits.
2. Decide the status of ADR 0015 and DES-0002: they remain Proposed and Blocked, and only a named human decider with a human review can change that.
3. Name the deciders and approvers (T3, T13) and answer or defer the open decisions (T2, T31, T34).
4. Decide on isolation (T15) and on branch protection (T14).
5. Decide whether and when to raise the phase. Nothing here begins application development or Azure deployment.

## 7. Classification totals

| Class | Count |
|---|---|
| IMPLEMENTED AND VERIFIED | 12 |
| IMPLEMENTED BUT NOT VERIFIED | 4 |
| PARTIALLY IMPLEMENTED | 8 |
| NOT IMPLEMENTED | 4 |
| BLOCKED | 5 |
| **Total capabilities assessed** | **33** |

No capability is classified higher than its recorded evidence supports. The twelve verified rows are verified for what the evidence covers and each states its limit.
