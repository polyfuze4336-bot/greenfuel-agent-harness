# Bounded repair loop

How the harness lets a coding actor complete an engineering task through **Plan, Execute, Verify, Critique, Repair** without marking its own work successful, retrying blindly, or going beyond its authority. The decision is [ADR 0011](../adr/0011-bounded-repair-loop.md); the results are in [LOOP-VALIDATION-REPORT](./LOOP-VALIDATION-REPORT.md).

Implemented by [loop.cjs](../../harness/loop/loop.cjs), configured by [loop-policy.json](../../harness/policy/loop-policy.json), driven by the human-run CLI [loop.mjs](../../harness/scripts/loop.mjs) and checked by `validate-loop`.

## Native versus custom

| Need | Native Copilot | Custom (and why) |
|---|---|---|
| Delegating work to a specialist agent | The `task` tool and custom agents (used by the [task-execution framework](../orchestration/ORCHESTRATION.md)) | None |
| Denying a tool call | `preToolUse` hooks, which already run the guards of [ADR 0008](../adr/0008-least-privilege-permission-model.md) | The loop reuses those guards on the files an attempt changed and on the actions it reports |
| A bounded repair budget, failure fingerprints, a diagnosis requirement, protected files, a verification only the harness can run, and a tamper-evident history | Nothing equivalent | A small deterministic state machine with files as the store, because each of these needs deterministic enforcement and persistence |

The loop does not call a model and does not do the work. An actor edits files in a workspace between `begin` and `end`; the loop observes what changed and decides what happens next.

## Loop states

| State | Meaning |
|---|---|
| PLAN | The task contract (objective, acceptance criteria, checks, protected paths, limits) is validated. Nothing has run |
| EXECUTE | The first attempt is open |
| VERIFY | An attempt ended. The **loop** runs the declared checks. Nobody else can |
| CRITIQUE | Every check passed and an independent review is required |
| DIAGNOSE | A repair already failed. A diagnosis with a different approach is required before the next repair |
| REPAIR | Ready for, or in, a repair attempt |
| PASSED | Terminal. Reached only from VERIFY or CRITIQUE, by the loop |
| ESCALATED | Terminal. A person must decide |
| STOPPED | Terminal. Stopped immediately |
| CANCELLED | Terminal. A person cancelled it |

```
PLAN -> EXECUTE -> VERIFY --all checks pass--> (CRITIQUE) -> PASSED
                     |  \--first failure--> REPAIR -> VERIFY
                     |   \--repair failed--> DIAGNOSE -> REPAIR -> VERIFY
                     \--any time--> ESCALATED (a person decides) | STOPPED (a rule was broken)
```

The transitions are a table in the policy, checked by `validate-loop` and recorded in the event log, which `verify-store` replays: a log that ends in PASSED without a verification of the final files fails.

## The task contract

A loop starts from a file with: a title and objective; **acceptance criteria** (required); the acting agent or `session`; requirement and hard-constraint ids; **checks** (an id, a kind, an argv from the command allow-list, optional `covers` globs, a timeout and an optional `hardConstraint`); **protectedPaths** (required: the tests, fixtures and expected results a repair may not change); optional `allowedWritePaths`, a `review` rule, a shipowner or jurisdiction `scope`, and limits that can only be tightened. The workspace must be a folder under `.harness-work/`. Examples: [tests/fixtures/loop](../../tests/fixtures/loop).

## Failure classes

| Class | What the loop does |
|---|---|
| BUILD_ERROR, TEST_FAILURE, CONTRACT_FAILURE, CALCULATION_MISMATCH, TIMEOUT, REVIEW_REWORK | Repairable, inside the retry budget |
| POLICY_VIOLATION (a policy check with no declared hard constraint), NON_IDEMPOTENT_FAILURE, REPEATED_FAILURE, BUDGET_EXHAUSTED, REVIEW_BLOCK | Escalate to a person |
| HARD_CONSTRAINT_VIOLATION, PERMISSION_VIOLATION, ACCESS_VIOLATION, SENSITIVE_DATA, MISSING_CONTEXT, UNSAFE_ACTION, TEST_TAMPERING, UNTRACKED_CHANGE | **Stop at once**, with no repair offered |

A failing check that declares `hardConstraint` is a HARD_CONSTRAINT_VIOLATION: fixing it needs an architecture decision, not a code change. When several checks fail, the most severe class decides (an order in the policy).

## Retry budget

- At most **3 repair attempts** per task (the owner's default; a task can only lower it).
- At most **2 identical failures**: the first occurrence counts, so a repair that leaves the failure unchanged escalates at once. A failure is fingerprinted from the check, its class and its output with times, line numbers, paths and hashes removed.
- A repair after a failed repair needs a **diagnosis**: it must cite a check run of the latest failure that exists in this loop, give a different approach (a restatement of an earlier approach or of the last repair summary is refused), and not propose weakening a test, an expected result or a control. Refusals are recorded.
- A failure after a destructive or non-idempotent step is **never retried automatically**.
- A configurable per-check timeout (the process is killed), a wall-clock budget, a check-run budget and an output cap. Defaults are working values, not measurements.

## Test selection

The first verification runs every check, cheapest kind first (build, contract, test, calculation, policy, access). After a repair, the checks whose `covers` globs match the changed files run first, with a check that has no `covers` always among them. The rest run only if those pass, and the loop is PASSED only when **every** declared check passed on the final files. Failures stop the run early.

## Independent review

If the task requires it, passing checks lead to CRITIQUE rather than PASSED. The reviewer must be on the policy's list (`architecture-critic`, `design-reviewer`) and not the task's own agent. REWORK counts as a repair, BLOCK escalates, and an approval counts only for the exact files that were verified: a change between verification and review stops the loop. The reviewer's text is stored as data and cannot instruct the loop. Native delegation to the critic can produce the review (see the orchestration framework); recording it is a human CLI step in this stage.

## Recovery after interruption

State is files: an event log and `loop.json`, written under a lock, with a lease on every open attempt. `resume` (or the next command) closes an attempt whose lease expired, observes and screens whatever it changed, and moves to VERIFY, which is safe to repeat. An interrupted attempt that broke a rule is stopped, not verified. Tests resume in a new process.

## Human escalation

Every ESCALATED or STOPPED loop carries what a person must decide (`outcome.requires`). The loop never works around a stop, never rolls back (the changes are kept in `attempts/<id>/after`), and cannot be reopened: a person starts a new loop.

## Evidence

Each check run is a file with the argv, exit code, duration, output hash, a redacted output tail and the workspace hash, plus the redacted output itself. Every attempt has `changes.json` and before and after copies of the files it touched. Every diagnosis and critique is a file. The hash-chained `events.jsonl` ties them together, and `loop.mjs verify-store` checks the chain, the replayed state, the files' hashes and the task contract. `loop.mjs report` writes a readable trace. These are **loop-local records**, like the run store; a person promotes a result to an evidence record with `record-evidence.mjs`.

## Enforced technically

| Control | Mechanism |
|---|---|
| Only the loop verifies; success cannot be declared | No API marks success; PASSED only from VERIFY or CRITIQUE; `verify-store` replays the log |
| A check or an expected result cannot be edited to pass | Before and after manifests of the whole workspace, `protectedPaths`, a second manifest after the checks ran |
| Changes respect permissions | Each changed file goes through the agent guard (or the permission engine for a person's session), the write scope, control-plane and isolation path classes, a credential and customer-marker scan of every changed file whatever its size |
| Isolation | A shipowner or jurisdiction scope on the task makes reading another's fixture a denial (DEF-04, DEF-03), recorded in the denied-action log |
| Destructive or secret operations | Operations on the policy's never-in-a-loop list stop the loop even if a guard allowed them |
| Commands | An anchored allow-list, an argv grammar with no options that load code, no `..`, no shell, a scrubbed environment (no `NODE_OPTIONS`) |
| Budgets and timeouts | Per-check kill, wall-clock and check-run budgets, repair and identical-failure limits |
| Agents cannot run or write the loop | The CLI is on no agent's command list and `docs/state/loops/` is a control-plane path; both tested for every agent |
| The configuration cannot loosen unnoticed | `validate-loop` and its tests |

## Human procedure

- Reading what a stopped or escalated loop requires, and deciding.
- Running the CLI. An agent cannot start, end or verify a loop in this stage (see Limits).
- Choosing the checks, protected paths and acceptance criteria of a task. The loop enforces them; it cannot tell whether they are the right ones.
- Recording a review, and promoting a loop result to an evidence record.

## Limits

- **The loop screens; it does not sandbox.** A check runs the workspace's code with the operator's rights. Code under test that deliberately subverts the test runner it is loaded into (for example by replacing assertion functions) cannot be ruled out by the loop. What it does catch is a check that rewrites files, edits to protected files, a dependency folder, large or binary additions, and options that load code. For adversarial code the controls are a required independent review and, later, a sandbox (roadmap R15).
- **Reported actions are self-reported.** The observed file changes and the denial log are not, but a command that an actor ran and did not report is not seen by the loop. In a hook-protected session the guards also deny it and the denial is found in the audit log during the attempt; in a session without hooks it is not.
- In **Phase 0** no agent may change application or workspace code, so an agent actor is stopped at its first change. The live demonstrations use the person's own session as the actor. Whether to let an agent run constrained loop commands is an owner decision (T24).
- The **reviewer's identity is declared** in the CLI call, not captured from a delegation hook.
- The TypeScript check uses a pinned toolchain installed outside the repository's manifest. Its lock integrity is a SHA-1 value from the package feed used here, not cross-checked against the public registry, and the entry file's SHA-256 is pinned as well. **CI does not install it**, so the TypeScript scenario is skipped there.
- Fingerprints are heuristic; two different failures with the same normalised text would be counted as identical, which errs toward escalating.
- Scripted repairs in the tests stand in for a model. They show the loop's decisions, not model skill.
- Limits (3 repairs, 2 identical failures) are the owner's; timeouts, budgets and size caps are working values.
