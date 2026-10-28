# Evaluation framework

The independent evaluation of the coding harness and of the future solution's contracts. It answers one question: **what does the evidence show, and what does it not show?** It never answers "how good is it?" with a number.

- Policy: [evaluation-policy.json](../../harness/policy/evaluation-policy.json). Engine: [eval.cjs](../../harness/eval/eval.cjs). Command line: [evaluate.mjs](../../harness/scripts/evaluate.mjs). Validator: [validate-evaluation.mjs](../../harness/scripts/validate-evaluation.mjs).
- Test definitions: [evaluation/catalogue/](../../evaluation/catalogue/) (data, never results). Executable checks: [evaluation/checks/](../../evaluation/checks/). Synthetic fixtures: [evaluation/fixtures/](../../evaluation/fixtures/).
- Results: [runs/](./runs/), one folder per run, with one evidence file per test. The generated [EVALUATION-REPORT.md](./EVALUATION-REPORT.md) is the report.
- Decision records: [ADR 0012](../adr/0012-independent-evaluation-framework.md) (Accepted) and [ADR 0013](../adr/0013-evaluation-findings-effective-periods-and-timestamps.md) (Accepted: the rules behind the two contract findings).

## Domains

Twelve domains, each with a three-letter code used in test IDs (`EVAL-HRN-SEC-001`): REQ requirements completeness and traceability; ARC architecture consistency and decision quality; FUN functional correctness; DAT data integrity and evidence provenance; SOV data sovereignty and shipowner isolation; SEC agent tool safety and permission enforcement; REL reliability and failure recovery; OBS observability and auditability; PRF performance and scalability; AZR Azure deployment readiness; OPS operational readiness; CST cost and maintainability. The validator requires every domain to have at least one test.

## Quality gates

| Gate | Meaning | What PASS needs |
|---|---|---|
| G1 | Requirements baseline complete | The requirements validator passes. It means complete and traceable, not that open decisions are resolved |
| G2 | Architecture reviewed and approved | The design review gate computes Approved for the design under review |
| G3 | Security and sovereignty design validated | The candidate contracts reject every hostile fixture, with no gap found |
| G4 | Implementation tests pass | Application tests pass. None can exist yet |
| G5 | Integration and agent evaluations pass | Production-agent evaluations pass. None can exist yet |
| G6 | Azure deployment readiness approved | No readiness blocker remains and the deployment evaluations pass. A human still approves |
| G7 | Operational and architecture defence evidence complete | Runbooks, recovery, audit reconstruction and defence evidence exist and pass |

Rules, enforced by code and tested:

- **There is no score.** A gate is decided by rules over individual results. Counts by status are printed for information and decide nothing.
- A gate is PASS only if it has at least one test and every test is PASS. One FAIL fails the gate. A FAIL that is critical, or that guards a hard constraint, makes it a critical failure.
- A gate whose predecessor is not PASS is BLOCKED. A gate with pending, blocked or missing tests is INCOMPLETE. Both block progression. Progression stops at the first gate that is not PASS.
- A test with `requires: ["G5"]` is not run until G5 passes, and in a partial run it is blocked.
- A hard constraint with any failing test is printed as VIOLATED at the top of the report, whatever the gates say. `NO TEST FAILED` is not a claim that the constraint is satisfied.
- **Entry criteria:** if any entry test of the harness suite fails, every gate is BLOCKED. The entry tests are the controls that protect the evaluation itself: denial of Azure deletion, unapproved deployment and secret reads; the control-plane write rule; the tamper-evident audit log; and the rule that the framework never reports PASS for a test that did not run.

## Result statuses

| Status | Meaning |
|---|---|
| PASS | The test ran and its expected outcome was observed. The evidence file records that it ran |
| FAIL | The test ran and the outcome was not observed, **or it could not show it ran**. A test absent from the output, killed at its time limit, or reporting nothing is a FAIL |
| BLOCKED | Not run because a precondition is not met (a required gate has not passed), or the test was skipped. A skipped test did not run, so it is never a PASS |
| PENDING | Specified, but the system it tests does not exist. Never a PASS |

`verifyRun` re-derives every recorded status from its evidence file, checks each evidence file against its hash, recomputes the gates and the hard-constraint matrix, and checks the run's integrity hash. A status edited to PASS, an edited evidence file, a deleted result and a forged gate are each reported.

## Separation of the suites

| Suite | Scope | State |
|---|---|---|
| Coding harness | `harness` (`EVAL-HRN-*`) | Executable now. Tests the harness's guards, memory, loop, orchestration and validators |
| Production, candidate contracts | `production-contract` (`EVAL-PRC-*`) | Executable now. Runs hostile synthetic fixtures through the candidate specification validators |
| Production, agents and platform | `production-agent` (`EVAL-PRD-*`) | **Every test is pending.** No business agent, application or Azure resource exists |

The catalogue validator refuses a production test in the harness suite, a harness test in the production suite, a prefix that disagrees with the scope, and an executable `production-agent` test. A passing contract test means the candidate contract rejects that fixture. It does not mean any production agent is safe: the report says so in each section.

## Red-team scenarios

All eleven scenarios are covered. A scenario with a harness analogue (RT-01, RT-06, RT-10, RT-11) has a harness test and a production test. The others have a contract check or a pending production test.

| Scenario | Executable now | Pending |
|---|---|---|
| RT-01 malicious certificate text | harness: output guard marks it as data; memory refuses it | production agent ignores it |
| RT-02 missing meter readings | contract: missing readings rejected | |
| RT-03 duplicate delivery events | contract: duplicates and replays rejected | |
| RT-04 altered certificates | contract: alteration and replacement detected | |
| RT-05 wrong or outdated factors | contract: invented, unsourced, changed factors rejected; outdated factor test finds a gap | |
| RT-06 cross-shipowner disclosure | harness: another shipowner's fixture denied | Customer Compliance Agent cannot disclose |
| RT-07 manipulated timestamps | contract: timestamp test finds a gap | |
| RT-08 offline edge and delayed sync | | edge simulator, no loss or duplication |
| RT-09 conflicting mass balance | | no mass-balance contract or validator exists |
| RT-10 filing approval bypass | harness: filing cannot be authorised for an agent; contract: no certificate without a human approval | filing workflow |
| RT-11 unauthorized Azure deployment or deletion | harness: deletion and unapproved deployment denied | production identities under Azure RBAC |

All fixtures are synthetic. The feedstock-certificate fixture is hostile text in a file and is only ever read as data. Identities are mock. Nothing touches Azure.

## Running

All commands are human-run. No agent is granted `evaluate.mjs` (the validator enforces that), so an agent cannot produce or alter a result.

```
node harness/scripts/evaluate.mjs validate                  check the catalogue
node harness/scripts/evaluate.mjs run                       full run: every executable test, evidence for each, gates
node harness/scripts/evaluate.mjs run --ids EVAL-HRN-SEC-001,EVAL-PRC-AZR-001
node harness/scripts/evaluate.mjs verify --run EVRUN-xxxxxxxxxx
node harness/scripts/evaluate.mjs report --run EVRUN-xxxxxxxxxx --write
node harness/scripts/validate-evaluation.mjs                configuration, catalogue, committed runs and the report
node harness/scripts/evaluate.mjs rerun                     CI: re-run everything into a temp folder and compare with the latest committed run
```

A full run executes whole existing suites, so it takes several minutes. `run` records the run and then exits **3** when progression is blocked (a failing test, a violated hard constraint or a gate that is not PASS), so a pipeline cannot read a failed evaluation as success; a partial run reports `not evaluated` and exits 0 unless a test failed. `report` and `gates` refuse a run that does not verify. The loop's TypeScript scenario needs the pinned toolchain (`HARNESS_TOOLCHAIN_DIR`); without it that test is skipped and EVAL-HRN-FUN-004 is reported BLOCKED, not passed. A run is bounded: a time limit per command, an output limit, a scrubbed environment (no `NODE_OPTIONS`), no shell, and only commands that match the allow-list in the policy.

## Enforced

These restrictions are enforced by code and tested in [evaluation-engine.test.mjs](../../tests/evaluation-engine.test.mjs) and [validate-evaluation.test.mjs](../../tests/validate-evaluation.test.mjs):

- A PASS needs recorded evidence that the test ran; skipped, absent, killed, empty and pending tests are never PASS.
- Gates are decided by rules; a hard-constraint failure is not hidden by passing tests; entry-criteria failure blocks every gate.
- The catalogue cannot hold results, mixed suites, unknown requirement IDs, an executable production-agent test, or a command outside the allow-list. Coverage of every domain, gate, hard constraint and red-team scenario is required.
- `evaluation/`, `docs/evaluation/` (including committed runs and the report) and the evaluation policy are control-plane paths: no agent can write them. The permission engine denies it.
- The committed report must equal what the latest full run generates, so it cannot be edited by hand. Every committed run must re-verify. A full run must cover every test in the catalogue, so a run made before a test was added no longer verifies: only the latest full run is kept in the tree, and earlier runs stay in Git history.
- CI runs `validate-evaluation` on every push, and **re-runs the whole evaluation** (`evaluate.mjs rerun`, owner decision T29) in a separate job. The re-run goes to a temporary folder, is verified, and is compared with the latest committed run: every test status, every gate and every hard-constraint verdict must match, except tests the policy lists with the exact status the re-run may report. The one listed today is the TypeScript scenario (`EVAL-HRN-FUN-004`), which CI reports BLOCKED because the pinned toolchain is not installed there. The comparison is tested in [evaluation-engine.test.mjs](../../tests/evaluation-engine.test.mjs) and the policy entries are checked by `validate-evaluation`.

## Human procedure

- **Running the evaluation** and committing its run and report are human steps. The committed run is a record of what one person ran at one commit, on one machine. CI verifies the record is consistent and re-runs the evaluation to confirm that it reproduces; a re-run is not a signature, and it is not the full test suite (that runs separately in CI).
- **Accepting a gate** is a human decision. A gate PASS is a necessary condition, never the approval. G6 in particular needs the owner's approval of deployment readiness.
- **Changing a test.** The catalogue and checks are control plane, so changing a test needs a human commit and review. An agent cannot weaken a test to make it pass, but a human can, and review is the control.
- **Resolving a finding** is a decision for the owner and the principal architect. The framework reports a gap; it never fixes a contract silently.

## Findings

Building the framework produced real findings. They are reported, not hidden:

1. **Audit log leak (fixed).** The permission audit log redacted the arguments preview but not the free-text `reason` and `paths`, so a command carrying a token had its first characters, including the token, written to the log. The engine now redacts every free-text field. `EVAL-HRN-OBS-002` is the regression check.
2. **Outdated emissions factor (open).** The methodology and lineage contracts have no effective period, so a calculation using a factor set whose validity ended before the delivery is accepted. `EVAL-PRC-DAT-005` fails. This is a design decision for the principal architect, not a silent validator change.
3. **Manipulated timestamp (open).** The lineage contract checks that a trusted time is a valid ISO time and that sequence numbers increase, but not that time is ordered or plausible, so a reading timed before its predecessor or in the far future is accepted. `EVAL-PRC-DAT-006` fails and is tagged to HC-08, so HC-08 is reported VIOLATED.
4. **No approved design (open).** DES-0001 is Blocked by the design review gate because decisions and hard-constraint questions are open. G2 fails, as it should.

The current figures are in the generated report, not in this document.

An independent adversarial review of the framework (a separate model, read-only) found further defects in it, each fixed with a regression test in [evaluation-engine.test.mjs](../../tests/evaluation-engine.test.mjs):

- A test could print a forged `ok N - EVAL-...` line, or a forged `# pass` summary, and be reported PASS. Now the result must appear exactly once, the number of top-level result lines must equal the reporter's own count, the **last** summary wins, the summary must add up, and an `ok` with a failing exit code and no reported failure is a FAIL.
- A failing critical or hard-constraint test that belongs to no gate failed no gate. It now blocks every gate.
- `run` exited 0 for a failed evaluation. It now exits 3 when progression is blocked.
- A partial run could print `NO TEST FAILED` for a constraint whose other tests were not run. The matrix is built from the whole catalogue, so those tests show as missing.
- The integrity hash did not cover the run's metadata, the evidence path was trusted from `run.json`, and `report` and `gates` printed unverified data. All three are fixed. The validator also rejects a committed run made with a different catalogue or policy from the current one.

## Limits

- A PASS shows that a named check ran and passed. It does not show that the check is the right check or that it is complete.
- Contract tests check candidate contracts against synthetic fixtures. They do not test a production agent, and they imply no scheme validity: nothing here is verified against a certification scheme or standard.
- Production-agent tests, performance, operations, cost and disaster recovery are pending. No target, volume, budget or recovery objective has been agreed, and none may be invented.
- Pending tests have definitions but no runner. They become executable only after the phase is raised by a human and the thing they test exists.
- The runner executes allow-listed commands without a shell, but it is not a sandbox: a test file runs with the user's permissions. Test files are control plane and human-reviewed. A sandbox is roadmap item R15.
- The integrity hash and the per-result evidence hashes are checksums, not signatures. The review noted that someone who can rewrite a whole run folder consistently can recompute them, and `verifyRun` would accept it. Authenticity would need a run made and signed by a protected CI identity outside the evaluated workspace; that is not built.
- Tests parse the TAP text of a child process. The checks above defeat the forgeries the review found, but a test file is trusted code that runs as the user and could in principle subvert the process around it; a structured event channel and a sandbox (R15) are the real fix.
- The committed run is a human-run record. A person with write access to the repository could replace a run and its report together, as long as they are consistent. Branch protection, code owners and review are the control, and they are only as strong as the repository settings (see the open items in the TODO list).
- Limits (time limit, output limit) are working values chosen by this design, not measurements.

## Native

GitHub Copilot and VS Code provide no native evaluation framework, quality gates or evidence store for this purpose, so the framework is custom, with the smallest footprint that gives deterministic enforcement: `node:test` and the TAP reporter for execution, JSON for the catalogue and runs, and the existing hash utilities. Native capabilities that are used: custom agents and the `qa-engineer` for authoring tests (it cannot run the evaluation), hooks for the control-plane write denial, GitHub Actions for validation, and independent agent review for the adversarial check of the framework itself. There are no new dependencies.
