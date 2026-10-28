# ADR 0009: Task-execution framework

- **Status:** Proposed
- **Type:** Governance
- **Date:** 2026-10-28
- **Deciders:** Programme owner (not yet decided)
- **Supersedes:** none

## Context
- FACT: The owner asked for a reliable framework that turns a complex request into a structured, resumable, auditable workflow: a twelve-step workflow, a task contract, nine task states, dependency-aware planning, durable state, checkpoint and resume, idempotency where possible, bounded retries, error classification, human approval pauses, failure escalation and an execution history. Native Copilot delegation is to be used where supported, custom scripts only where deterministic enforcement or persistence is required, and no distributed orchestration service is to be built.
- FACT: Observed 2026-10-28 in Copilot CLI 1.0.105: the repository-wide `preToolUse` and `postToolUse` hooks both fire for the native `task` tool. The pre payload carries the target `agent_type`, the prompt and the mode; the post payload carries the delegate's reply as `toolResult.textResultForLlm`. A hook can therefore enforce and record delegation without any change to how the orchestrator delegates. See [ORCHESTRATION](../orchestration/ORCHESTRATION.md).
- FACT: The orchestrator is read-only by an accepted decision ([ADR 0006](./0006-specialist-agent-roster-and-enforcement.md)): no edit tool, no command, no write scope. Two of the three agents the demonstration needs (`security-reviewer` and `architecture-critic`) are planners with no edit tool, so their output exists only as the reply of a delegation.
- FACT: The permission model ([ADR 0008](./0008-least-privilege-permission-model.md)) already supplies signed approvals, a never-grantable list and a hash-chained audit approach that this framework reuses.
- ASSUMPTION: The limits in the policy (attempts, reopens, lease, sizes, task count) are placeholder working values for the owner to confirm; they are not derived from any external requirement.

## Options considered
1. **Prompt-only orchestration.** The orchestrator tracks tasks in its own context. Rejected: no persistence across sessions, no enforcement, and "done" is self-declared.
2. **A service or queue (for example a workflow engine).** Rejected by the owner's instruction and by the "minimal dependencies" principle: nothing here needs concurrency across machines.
3. **Give the orchestrator a shell or write access to keep state.** Rejected: it would reverse ADR 0006 and make the planner a privileged executor.
4. **A small deterministic engine driven by native hooks, with files as the store, a human-run CLI and read-only MCP tools (chosen).** Native delegation does the work; the hook enforces order and captures results; the engine judges results against declared tests; the orchestrator stays read-only.

## Decision
Proposed for approval:
- Adopt [engine.cjs](../../harness/orchestration/engine.cjs) and [orchestration-policy.json](../../harness/policy/orchestration-policy.json): the task contract, nine states with an explicit transition table, plan validation (agents, tools, permissions, requirements, context, artifacts, acceptance, dependencies, risks, review), error classes with bounded retries and escalation, human approval pauses using the registered approver keys, and a durable, hash-chained run store under `docs/state/runs/`.
- Drive it from [delegation-guard.cjs](../../harness/hooks/delegation-guard.cjs), registered repository-wide: before a `task` call it starts the attempt or denies the delegation; after it, it stores the reply and runs the acceptance tests. While a run is active, a delegation without a `TASK-REF` marker is denied.
- Expose `check_plan` and `get_run_status` as read-only MCP tools to the orchestrator only. Create, retry, unblock, reopen, approve and cancel remain human or CI actions through [tasks.mjs](../../harness/scripts/tasks.mjs).
- Treat `docs/state/runs/` and the orchestration policy as control plane that agents cannot write.
- Do not give the orchestrator any new write or execute capability.
- Validate with [validate-orchestration.mjs](../../harness/scripts/validate-orchestration.mjs) in `npm run validate` and CI; commit a run only when it is finished and its chain verifies.

## Consequences
- A multi-step request now has an auditable record: who was delegated what, in what order, how many attempts, what came back (hashed and marked untrusted), what passed, and what needed a human.
- The engine proves structure and provenance, not truth. Content quality still depends on the specialist agents, the independent review task and the human.
- The orchestrator's consolidation has no hook to capture it; a human captures it with `submit --result-file`, and the log says so.
- Hooks are observed only in Copilot CLI 1.0.105 and need a trusted folder. VS Code behaviour is unverified (T12, T18).
- A run that is ACTIVE, waiting for a human or stopped blocks untracked delegation until it is finished, cancelled or closed by a human (`tasks.mjs close`); this is deliberate. The committed demonstration run is waiting for a human (TODO T19), so ad hoc delegation by agents is denied until the owner decides.
- More custom code to maintain: the engine is a single module with a test suite, but it is code the harness owns.

## Reversibility
High. Removing the hook registration, the hook, the engine, the CLI, the two MCP tools and the policy returns the harness to ad hoc delegation. Existing runs are plain files and remain readable.

## Revisit when
Copilot changes hook behaviour for `task` (payload, timing, background mode); the owner approves parallel delegation; VS Code chat is tested (T12, T18); the approver registry is populated (T13); or a real specification replaces the placeholder limits.

## Evidence
Automated tests cover plan validation (mutation matrix), every state and refusal, error classification, bounded retries, approvals (including replay, plan binding, expiry and the two-person rule), file and command acceptance, drift and tampering detection, crash recovery, rollback detection, multi-process races, the hook processes and the CLI. A live run in Copilot CLI 1.0.105 is recorded in [DEMO-EVIDENCE-STORE](../orchestration/DEMO-EVIDENCE-STORE.md). These show the framework behaves as described in the tested setup; they do not show that model-written content is correct. The live run exposed four defects and an independent model review of the framework found four more flaws (untracked delegation while a run awaited a human, a quoted verdict masking a final one, a state hash that left out the plan and policy fields, and a verify that ignored accepted files); all were fixed with regression tests. That review is not an evidence record.
