# Loop validation report

What was run to validate the [bounded repair loop](./LOOP.md) ([ADR 0011](../adr/0011-bounded-repair-loop.md), Accepted), what each run showed, and what was **not** shown. Counts and commit hashes are in the recorded evidence (`EV-0035` to `EV-0038`, listed in [STATE](../state/STATE.md)); this report does not repeat numbers that an evidence record holds.

## What was run

- **Automated tests**: `tests/loop-engine.test.mjs` (the scenarios and rules), `tests/validate-loop.test.mjs` (the validator and a mutation matrix) and the existing permission and tool tests that the loop's wiring touches. Each loop test builds a throwaway workspace under `.harness-work/` and its own store and log folders. A "repair" in a test is a scripted file copy standing in for a model.
- **Live runs through the real CLI** (`harness/scripts/loop.mjs`), committed under [docs/state/loops](../state/loops). In these the repairing actor was the person's own session, and the repair in the first run was a genuine edit made by the assistant after reading the compiler output, not a scripted copy.
- **An independent adversarial review** by a separate model (not an evidence record).

## Scenario results

| # | Scenario | Test | Live run | Result |
|---|---|---|---|---|
| 1 | TypeScript build failure | `1.` (real compiler, pinned 5.9.3) and `1b.` (toolchain missing) | `LOOP-ff64d5605a` | Compiler error TS2322 classified BUILD_ERROR and kept; the loop gave the feedback; the fix (`Math.round` instead of `toFixed`) was verified by the loop's own second compiler run; **PASSED**, 1 of 3 repairs used. With no toolchain the loop **stops** as missing context instead of guessing |
| 2 | Failed API contract test | `2.` and `2b.` | none | CONTRACT_FAILURE; repaired and verified, the failing run still on disk afterwards, before and after copies of the repaired file kept. A repair that rewrote the protected contract check was refused as TEST_TAMPERING and **stopped** before any verification |
| 3 | Incorrect emissions calculation fixture | `3.` and `3b.` | none | CALCULATION_MISMATCH with the wrong result (1002.5) in the preserved output; repaired by multiplying; **PASSED**. Changing the expected result to match the wrong code was refused as TEST_TAMPERING and **stopped**. The expected result (2500 kg) is documented separately in [EXPECTED.md](../../tests/fixtures/loop/emissions/EXPECTED.md), agrees with the data file (checked by a test and by the validator) and is labelled an invented fixture value, not a scheme factor |
| 4 | Sovereignty policy violation | `4.` | `LOOP-58fa845034` | The real sovereignty validator rejected a placement that names a cloud region as its residency basis. HARD_CONSTRAINT_VIOLATION: **stopped** on the first failure, check run once, no repair offered, "an architecture decision is needed" recorded, `begin` refused afterwards |
| 5 | Unauthorized cross-shipowner access | `5.`, `5b.`, `5c.` | `LOOP-e1fb99c938` | A reported read of the other shipowner's fixture was denied (DEF-04), **stopped**, written to the denied-action log, never verified. The in-scope shipowner's own fixture was allowed. Copying the other shipowner's marker into the workspace was caught as SENSITIVE_DATA. An agent actor in Phase 0 was stopped at its first change; with an explicit Phase 1 scope the same change was allowed |
| 6 | Repeated failure that cannot be repaired safely | `6a.` to `6d.` | `LOOP-6b343aa07f` | A cosmetic change left the failure identical (a comment moved the line numbers; the fingerprint ignored them): **escalated** after one repair. Failures that differed each time were refused a retry without a diagnosis, five bad diagnoses were refused, then the budget of 3 repairs ended in **ESCALATED**, every failing run preserved. A failure after a `git commit` was escalated, not retried even with budget left. `az group delete` and a secret read were stopped |

The two requested demonstrations: the loop **repaired a safe coding error** (`LOOP-ff64d5605a`, scenario 1) and **stopped correctly when a hard constraint was violated** (`LOOP-58fa845034`, scenario 4).

## Rules checked beyond the six scenarios

Timeout kill and wall-clock budget; check-run budget; independent review (self-review refused, wrong reviewer refused, REWORK counts as a repair, BLOCK escalates, approval void if the files change); recovery of an interrupted attempt in a new process, and a stop when the interrupted attempt broke a rule; files changed between attempts, between end and verify, and **by a check while it ran**; a dependency folder and large or binary files; node options that load code and a poisoned `NODE_OPTIONS`; task-contract validation (fifteen malformed contracts); test selection order; fingerprint normalisation; a forged `loop.json`, an altered event log, altered evidence and a changed task contract all detected by `verify-store`; no function in the loop API can mark success; no agent can run the loop CLI or write the loop store.

## Review findings

| Finding | Outcome |
|---|---|
| A check could rewrite workspace files during its run and still produce PASSED (reproduced) | Fixed: the workspace is compared again after the checks and a change stops the loop; regression test |
| `node_modules`, `dist`, `out`, `coverage` were not observed, so code reachable by a check could change unseen (reproduced) | Fixed: no folder is excluded; a large workspace is refused; regression test |
| `node --test --import ./x.mjs` was accepted, so a preload could weaken assertions (reproduced) | Fixed: operands cannot start with a dash, and `NODE_OPTIONS` is not passed to checks; regression tests |
| Large or binary changed files skipped the credential and customer-marker scan (reproduced) | Fixed: every changed file is scanned whatever its size; regression test |
| The remaining wall-clock budget was floored to one second | Fixed: no floor |
| The validator failed because its documents were missing | Expected at that point; this report and LOOP.md resolve it |
| Code under test can replace assertion functions in the test runner it is loaded into, even with a clean command line | **Not fixable in this design.** Stated as a limit: needs a sandbox and an independent review (R15) |

## Not shown

- **No model-driven repair.** Test repairs are scripted copies, the live TypeScript repair was made by the assistant in this session, and an agent cannot run a loop yet (Phase 0, and the CLI is human-run). Nothing here measures how often a model repairs a failure within the budget.
- **No unattended completion by Copilot.** The orchestrator and specialists were not driven through a loop. After the report, the owner allowed `qa-engineer` to run `status`, `verify` and `verify-store` (T24); the grant is tested with the agent hook, but no agent has been run through a loop in a live session.
- **No sandbox.** A check runs workspace code with the operator's rights; deliberate subversion of the runner by code under test is not prevented (see above).
- **CI does not run the TypeScript scenario**: the compiler is installed outside the manifest and CI does not install it. The tests skip it there. The pinned lock integrity is a SHA-1 value from the package feed used here and could not be cross-checked against the public registry.
- **No hook-captured critique**: the reviewer's identity is declared in the CLI call.
- **No VS Code chat run** of any loop step, and no Azure resource, sign-in or deployment was used.
- **Reported actions are self-reported**; only the file changes and the denial log are observed.
- The emissions fixture shows that a calculation check cannot be edited to pass. It says nothing about any certification scheme, factor or methodology, and none is implied.
- Timeouts, budgets, size caps and the 30-minute lease are working values, not measurements.
