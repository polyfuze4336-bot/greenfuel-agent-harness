# ADR 0011: Bounded Plan, Execute, Verify, Critique, Repair loop

- **Status:** Proposed (awaiting owner decision)
- **Type:** Governance
- **Date:** 2026-10-28
- **Deciders:** Programme owner
- **Supersedes:** none

## Context
- FACT: The owner asked for a bounded Plan, Execute, Verify, Critique, Repair loop so Copilot can complete engineering tasks reliably within architecture constraints and permissions: tasks start with acceptance criteria; every action respects the agent's permissions; verification uses executable tests or inspectable evidence; an agent must not mark its own untested work successful; repeated failures trigger diagnosis; destructive or non-idempotent operations are not retried automatically; security controls are never bypassed to pass tests; failures and repair history are preserved; a human is required beyond approved authority. Default limits are 3 repair attempts, 2 identical failures, a configurable timeout and budget, and an immediate stop for permission violations, missing critical context or unsafe actions.
- FACT: The harness already has native delegation with a hook, the guards and permission engine of [ADR 0008](./0008-least-privilege-permission-model.md), a task-execution framework with retries and escalation ([ADR 0009](./0009-task-execution-framework.md)) and memory ([ADR 0010](./0010-persistent-memory.md)). The task framework tracks delegated tasks and their acceptance tests; it has no notion of a repair attempt that changes files, of failure fingerprints, or of a diagnosis requirement.
- FACT: Observed on this machine, no TypeScript compiler was installed. A pinned one was installed outside the repository's manifest for the build-failure scenario.
- FACT: In Phase 0 no agent may change application or workspace code (ADR 0002, HC-11), so an agent cannot yet be the repairing actor.
- ASSUMPTION: Timeouts, wall-clock and check-run budgets and size caps are working values. The two headline limits are the owner's.

## Options considered
1. **Prompt-only loop.** The orchestrator is told to verify and repair in a loop. Rejected: the actor would decide when it is done, and nothing is enforced or kept.
2. **Extend the task-execution engine with repair semantics.** Rejected for now: its unit is a delegated task, not a file-changing attempt, and bolting fingerprints and diagnosis onto it would couple two designs that can be reviewed separately.
3. **Run the checks inside the actor's session and let it report results.** Rejected: that is self-declared success.
4. **A small deterministic loop with files as the store, a human-run CLI that is the only thing that runs checks, observed before and after workspace manifests, reuse of the existing guards, and a hash-chained history (chosen).**

## Decision
Proposed. Adopt, if the owner accepts:
- [loop.cjs](../../harness/loop/loop.cjs) with [loop-policy.json](../../harness/policy/loop-policy.json), the CLI [loop.mjs](../../harness/scripts/loop.mjs), and `validate-loop` in `npm run validate` and CI, as described in [LOOP](../loop/LOOP.md).
- PASSED reachable only from a verification the loop ran on the final files, plus an independent approval where the task requires one.
- Failure classes that stop at once (hard constraint, permission, isolation, sensitive data, missing context, unsafe action, tampering, untracked change), that escalate (repeated failure, budget, non-idempotent failure, blocked review, a policy failure with no declared constraint) or that are repairable within 3 repair attempts and 2 identical failures; a diagnosis with a different approach before any repair that follows a failed repair.
- `docs/state/loops/` as a control-plane path and the loop CLI on no agent's command list: only a person drives a loop in this stage.
- A pinned TypeScript toolchain outside the manifest, verified before use.
- No sandbox and no agent-run loop yet; both are recorded as open items (R15, T24).

## Consequences
- A safe coding error can be repaired with a recorded, verified history, and a hard-constraint violation, a permission violation, tampering or a repeated failure ends in a stop or an escalation with the reason and what a person must decide.
- The loop catches honest mistakes, weakened tests, tampered expected results, files changed during a check and unscreened changes. It does **not** stop code under test that deliberately subverts the runner it is loaded into; that needs a sandbox and an independent review, which is why a review can be required per task.
- An agent cannot yet run a loop, so Copilot does not yet complete tasks unattended. This is deliberate: it keeps verification out of the actor's hands until the owner decides T24.
- More custom code to maintain: one module with a test suite.

## Reversibility
High. Removing the module, CLI, policy, validator and the path-class entry returns the harness to its previous state. Loop records are plain files.

## Revisit when
The owner decides T24 (agent-run loop commands); Phase 1 allows agent code changes; a sandbox exists (R15); Copilot changes hook behaviour for `task`; or a real specification replaces the working values.

## Evidence
Automated tests (`tests/loop-engine.test.mjs`, `tests/validate-loop.test.mjs`) cover the six requested scenarios, the diagnosis and budget rules, non-idempotent and forbidden operations, timeouts, review, forged state, untracked and check-time changes, resume in a new process and the CLI. Four live runs through the CLI are committed under `docs/state/loops/`. An independent model review found four exploitable defects (a check rewriting files and still passing, an unobserved dependency folder, node options that load code, scanning skipped for large files) and a budget floor; each was fixed with a regression test, and two limits it exposed are stated in [LOOP](../loop/LOOP.md). That review is not an evidence record. See [LOOP-VALIDATION-REPORT](../loop/LOOP-VALIDATION-REPORT.md) for what was and was not shown.
