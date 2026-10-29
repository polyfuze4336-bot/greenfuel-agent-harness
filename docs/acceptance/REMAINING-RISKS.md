# Remaining risks

Risks that remain after the acceptance review, in the order an owner should look at them. Design and programme risks live in the [risk register](../architecture/RISK-REGISTER.md) (RK-001 to RK-014) and are not repeated in full here. This list adds harness-level risks found or confirmed by this review. Likelihood and impact are qualitative: no figure has been sourced.

## 1. Critical

| ID | Risk | Evidence | Mitigation in place | What would close it |
|---|---|---|---|---|
| HR-01 | **Models author, review and challenge the work.** Shared blind spots can pass every gate, and gates check structure and consistency, not truth (RK-012, RK-014) | Two independent review rounds still found defects the author's own tests had missed | Separate reviewer roles, executable checks, visible genuine failures | A human decider and an independent human review, and a different reviewer family for high-stakes designs |
| HR-02 | **No isolation of agent sessions or of code under test.** The hook is a screen, and agents and test code run as the user's account | Enforcement status document; loop report limit | Denials, output guards, human approval for high-impact steps | Dev container, separate account or VM without Azure and Git credentials (T15, R15) |
| HR-03 | **Control-plane changes are protected only by review discipline.** Branch protection is unavailable on this plan | EV-0026 | The owner reviews diffs of `memory/` and `docs/adr/`; CI validates | Branch protection, required review, code owners (T14) |
| HR-04 | **No human approver or decider exists.** No tier P2 or higher operation by an agent can succeed, and no design can be approved | Empty approver registry | None needed: this is the safe state | Name approvers and register keys (T3, T13) |
| HR-05 | **Open owner decisions leave hard constraints only Conditional.** Residency meaning, hosting, tamper-evidence mechanism and key custody, edge platform, meter interfaces, disconnection limits and time rules | RV-0001, RV-0002, gate output | The gate blocks approval | The owner's facts (T2, T31, T34) |

## 2. High

| ID | Risk | Evidence | Mitigation in place | What would close it |
|---|---|---|---|---|
| HR-06 | **Integrity without authenticity in the ingestion design.** A party who can reach the endpoint can append a consistent forged continuation, and whoever can write the store can rewrite the whole chain | RV-0002 section 7 | Every accepted record is marked unauthenticated; disclosed | Signing, enrolment, revocation, quarantine and an external anchor (D-013) |
| HR-07 | **Evaluation findings are unremediated.** G2 and G3 fail, later gates are blocked and HC-08 is marked violated | The committed evaluation run | Visible, not hidden by a score | Roadmap R16 and the design approvals |
| HR-08 | **Production-agent controls are untested.** Prompt injection, cross-shipowner disclosure, approval bypass and tool misuse for the five business agents exist only as pending tests | Catalogue | Separate suites keep the harness result from implying production safety | The agents and their evaluation set, in a later phase |
| HR-09 | **No Azure facts verified.** Regional availability, services in each jurisdiction, quotas, prices and role assignments are unverified | docs/azure | Provisional selection, NOT-READY gate | A named read-only identity and subscription (T32, T33) |
| HR-10 | **Self-declared human memory writers.** A process with file access could claim to be a human or an importer | Memory governance | Owner reviews diffs; ledger is hash-chained and anchored against Git history | Signed approvals for memory writes (R14) |

## 3. Medium

| ID | Risk | Evidence | Mitigation in place | What would close it |
|---|---|---|---|---|
| HR-11 | **The audit log is incomplete by design.** Denial-only, local, git-ignored, not anchored | Audit verification | Evidence records and run stores hold the rest | Decide scope, retention and external anchor (T16) |
| HR-12 | **VS Code behaviour is unobserved by the harness.** Hook scoping in chat, subagent restrictions, MCP trust prompts and the output hook were reported by the owner | TODO T8, T9, T12 | CLI observation and tests | Live checks in VS Code chat |
| HR-13 | **Unbounded storage and stream rate in the ingestion reference model** | DES-0002 section 9 | Disclosed | Quotas and an overload rule, decided with D-020 and D-031 |
| HR-14 | **The full test suite is long** (several minutes), CI skips the TypeScript scenario, and one full run (EV-0054) had a single unexplained failure that did not recur | Evidence index; evaluation difference list; finding F-9 | Recorded timeouts, an allowed difference, the failure kept as evidence | The recorder should keep failing-test names so the next occurrence is identified (T41); optionally split the suite or add the toolchain to CI |
| HR-15 | **Repository in a synchronised folder** can corrupt or conflict | TODO T5 | Git is the source of truth | Move the repository (T5) |
| HR-16 | **Documents may drift from reality.** This review found stale status labels | Finding F-6 | Generated documents are regenerated and checked | A status check that compares ADR status with every mention |
| HR-17 | **Candidate standards and schemes are unverified.** Nothing about any scheme is claimed | CERTIFICATION-SCHEMES | HC-10 and the compliance-claim lint | A qualified person verifies citations (T4) |

## 4. Accepted limits that are not risks to close now

- The evaluation framework cannot show that a requirement is satisfied. It shows what a test that ran demonstrated.
- The emissions fixture is a deliberately simple arithmetic check and says nothing about any scheme.
- No performance, availability, volume or cost figure exists, and none may be invented (T28).
