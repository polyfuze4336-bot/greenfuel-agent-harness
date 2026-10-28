# Task-execution framework

How a complex engineering request becomes a structured, resumable, auditable workflow in the greenfuel-agent-harness. This is part of the **coding harness**. It is not the business agents of the bunkering product, and it does not build the application.

Decision record: [ADR 0009](../adr/0009-task-execution-framework.md). The task format: [TASK-CONTRACT](./TASK-CONTRACT.md). The rules live in [orchestration-policy.json](../../harness/policy/orchestration-policy.json); the tables below are generated from it.

## What it is, and what it is not

It is a small deterministic engine ([engine.cjs](../../harness/orchestration/engine.cjs)), a human-run CLI ([tasks.mjs](../../harness/scripts/tasks.mjs)), a delegation hook ([delegation-guard.cjs](../../harness/hooks/delegation-guard.cjs)) and two read-only MCP tools. It keeps state in files under `docs/state/runs/`, one folder per run.

It is **not** a distributed orchestration service, a scheduler or a queue. Nothing runs in the background. One person (or CI) and one Copilot session at a time drive a run, and the lock file only stops two processes from corrupting it.

## Native versus custom

| Responsibility | Done by | Why |
|---|---|---|
| Decompose a request, choose agents, write delegation prompts, consolidate | The `orchestrator` agent, using Copilot's native reasoning and the native `task` tool | Native capability; no code needed |
| Delegate to a specialist and receive its reply | Native `task` delegation (synchronous) | Native |
| Run the specialist with its own tool list, write scope and hooks | Native custom agents plus the existing [permission model](../security/PERMISSION-MODEL.md) | Native plus the approved guards |
| Validate a plan against the contract | Engine, exposed read-only as `check_plan` | Deterministic rules a model must not self-judge |
| Decide whether a delegation may start (assigned agent, order, attempt budget, changed prompt, synchronous, approval, permissions) | Engine, called by the delegation hook before the `task` call | Needs enforcement, not advice |
| Store durable state, checkpoints, an append-only history | Engine (files, hash chain, lock) | Copilot sessions do not persist this |
| Capture the delegate's reply and run the acceptance tests | Engine, called by the delegation hook after the `task` call | "Done" must be judged by checks, not claimed |
| Classify errors, bound retries, escalate, stop | Engine and policy | Deterministic |
| Pause for human approval and verify it | Engine with Ed25519 signatures from the registered approvers | Same key registry as operation approvals |
| Read run state and recommended next action | Engine, exposed read-only as `get_run_status` | The orchestrator has no shell |
| Create a run, retry, unblock, reopen, approve, cancel | A human or CI through the CLI | State changes the orchestrator may not make |

## The twelve-step workflow

| Step | Who does it | How it is enforced or recorded |
|---|---|---|
| 1. Understand the request | Orchestrator | The plan's `request` and `objective` fields; nothing else is trusted |
| 2. Retrieve relevant project context | Orchestrator, with the [context-loading](../context/CONTEXT-LOADING-STRATEGY.md) profile `orchestration` | Each task lists its `inputContext`; the engine rejects missing, secret or isolated files |
| 3. Identify affected requirements and constraints | Orchestrator | The engine rejects requirement IDs that are not in the baseline and constraint IDs not in HARD-CONSTRAINTS; a result that cites a requirement that does not exist fails its acceptance test |
| 4. Create an execution plan | Orchestrator drafts; `check_plan` validates; a human initialises | `tasks.mjs init` refuses an invalid plan and derives the run id from the plan hash |
| 5. Identify dependencies and risks | Orchestrator | The engine requires an acyclic graph, computes order, levels and the critical path, and requires at least one risk with a mitigation |
| 6. Select the appropriate specialist agent | Orchestrator, within the delegation list | The engine checks the agent is real, delegable, holds the tools asked for and may write the artifact paths; the delegation hook denies a different agent at start |
| 7. Check required permissions | Engine at plan time and at every start | Tier, operations, ceilings, never-grantable operations and the phase gate; P2 or above makes the task wait for a signed approval. The specialist's own tool calls are still judged by the permission hooks |
| 8. Execute a bounded task | Specialist, one synchronous delegation per attempt | Attempt budget, lease, backoff, and a changed prompt on every retry |
| 9. Run relevant validation | Engine | Declarative acceptance tests run on the stored reply or the written file; command checks (allow-listed) run only through `tasks.mjs validate` and are recorded with exit code and output hash |
| 10. Request independent review | Plan and engine | An author's task needs a review task by a different, permitted agent that depends on it and ends with a verdict, or a written waiver; a blocking verdict stops the run from completing |
| 11. Record results and evidence | Engine | Hash-chained event log, captured results marked untrusted, artifact hashes, evidence references, checkpoints, a generated trace and report |
| 12. Continue, retry, escalate, or stop | `next` recommendation, then a human or CI | One recommended action from the state: delegate, validate, retry, resume, wait-for-approval, escalate, stop or complete |

## Generated reference

<!-- generated:start (node harness/scripts/validate-orchestration.mjs --write) -->

### Task states and allowed transitions

| From | May move to | Note |
|---|---|---|
| PENDING | READY, BLOCKED, AWAITING_APPROVAL, CANCELLED |  |
| READY | RUNNING, BLOCKED, PENDING, CANCELLED | PENDING: only by the reopen cascade, which invalidates dependents of a reopened task |
| RUNNING | VALIDATING, FAILED, BLOCKED, AWAITING_APPROVAL, READY, CANCELLED | AWAITING_APPROVAL: the work needs a human decision part-way; the attempt is refunded because nothing was completed; READY: only by release, when an attempt never ran (for example the tool rejected a malformed call after the hook started it); the attempt is refunded and the release is logged with its reason |
| BLOCKED | PENDING, READY, CANCELLED |  |
| FAILED | READY, PENDING, CANCELLED | READY: only by retry, when the error class is retryable and attempts remain; PENDING: only by the reopen cascade |
| VALIDATING | COMPLETED, FAILED, BLOCKED, CANCELLED | BLOCKED: a missing input discovered while validating |
| AWAITING_APPROVAL | READY, PENDING, CANCELLED | PENDING: only by the reopen cascade |
| COMPLETED (terminal) | VALIDATING, READY, PENDING | VALIDATING: only by resume, when a recorded artifact no longer matches its hash; READY: only by reopen, after a blocking review verdict, within maxReopensPerTask; PENDING: only by the reopen cascade |
| CANCELLED (terminal) | nothing |  |

### Error classes and what the engine does

| Class | Retryable | Action | Backoff (seconds) | Meaning |
|---|---|---|---|---|
| TRANSIENT | yes | retry | 5, 30, 120 | Timeout, rate limit, network or tool crash that may not recur |
| INTERRUPTED | yes | retry | 0, 0, 0 | The attempt stopped without reporting (crash, closed session, expired lease) |
| ACCEPTANCE_FAILED | yes | retry | 0, 0, 0 | The output was produced but failed an acceptance test. The retry must use a changed prompt that carries the failed checks |
| INPUT_MISSING | no | block | n/a | A needed input, context file or answer is absent. Another attempt cannot fix it |
| PERMISSION_DENIED | no | escalate | n/a | A guard or hook refused an action. Trying another route is a bypass, not a retry |
| CONFLICT | no | escalate | n/a | Requirements, constraints or agent outputs contradict each other and need a human decision |
| POLICY_VIOLATION | no | stop | n/a | A hard constraint or approval rule was broken or nearly broken. The run is frozen for human review |
| INTERNAL | no | stop | n/a | The framework's own state is inconsistent or corrupt |
| UNKNOWN | yes, at most 1 | retry | 5 | Not recognised. One retry, then escalate |

### Run states

`ACTIVE`, `COMPLETED`, `NEEDS_HUMAN`, `STOPPED`, `CLOSED`, `CANCELLED`. A run is COMPLETED only when every task is COMPLETED and no blocking review verdict (REWORK, REJECT) stands. NEEDS_HUMAN means no task can proceed without a person. STOPPED freezes the run after a policy violation or an internal inconsistency. CLOSED means a human concluded a NEEDS_HUMAN or STOPPED run (`tasks.mjs close`); closing approves nothing. While a run is ACTIVE, NEEDS_HUMAN or STOPPED, a delegation without its task marker is denied.

### Limits (placeholder working values)

| Limit | Value |
|---|---|
| maxTasks | 25 |
| maxAttemptsCap | 3 |
| maxReopensPerTask | 1 |
| leaseMinutes | 30 |
| maxPlanBytes | 60000 |
| maxResultBytes | 200000 |
| maxArtifactsPerTask | 10 |
| maxContextFilesPerTask | 12 |

<!-- generated:end -->

## How state is kept

Each run is a folder `docs/state/runs/RUN-<first ten hex digits of the plan hash>/`:

| File | Content |
|---|---|
| `run.json` | The embedded plan and the current state of every task. A cache of the log, sealed by a state hash |
| `events.jsonl` | Append-only history. Each event holds the actor, task, action, transition, reason, the state hash and the previous event's hash |
| `results/` | The delegate's reply for each submission (`T1-s1.md`, `T1-s2.md`, never overwritten), stored with an UNTRUSTED header; secret-shaped text is redacted before it is stored. A reopened task's earlier replies are archived in `run.json` and stay verified |
| `checkpoints/` | A snapshot at creation, after each completed task, at each run-state change and on request: revision, event head and state hash |
| `evidence/` | Command check records: argv, exit code, output hash and tail, commit |
| `approvals/` | Signed task approvals that were applied |
| `TRACE.md`, `REPORT.md` | Generated from the log and state by `tasks.mjs trace` and `report` |

The runs folder is a **control-plane path**: agents cannot write it. Only the engine writes it, through the hook or the CLI.

**Integrity.** Every load verifies the hash chain, that `run.json` points at the end of the log, and that the state hash matches the last event. The state hash covers the whole run state (plan, order, limits and every task field) apart from the log pointers; blocking verdicts are read from the policy, not from the run. `tasks.mjs verify` additionally re-hashes captured replies (current and archived), accepted file artifacts and command evidence; a line-ending difference (Windows against Linux checkouts) is tolerated, any other change is reported. Editing an event, removing or reordering one, replacing `run.json` with an older copy, or changing task state by hand makes the run refuse to load (`INTEGRITY`, exit code 3).

**Crash safety.** A change is written to `run.json` first, together with its events, then appended to the log. If the process dies in between, the next load re-appends the missing events exactly. A read-only caller (the MCP status tool) verifies the same repaired chain in memory and writes nothing.

**Concurrency.** Every change takes a lock folder, loads and verifies the run, changes it in memory, and commits once. A stale lock (older than a minute) is cleared. Six simultaneous `start` commands on one task produced exactly one winner in the tests.

**Resume.** `tasks.mjs resume` verifies the run, marks an attempt whose lease expired as INTERRUPTED (retryable), moves a COMPLETED task whose artifact no longer matches its recorded hash back to VALIDATING, writes a checkpoint and prints what to do next. A checkpoint lets you prove the run was not rolled back or rewritten; it does not restore an earlier state. Recovery of a task is to retry it.

## Idempotency

| Operation | Repeating it |
|---|---|
| `init` with the same plan | Returns the existing run; nothing changes |
| `start` with the same prompt while the attempt is RUNNING | No-op that returns the same attempt |
| `submit` with the same reply after it was recorded | No-op |
| `resume` | Nothing to sweep the second time |
| `retry`, `unblock`, `cancel`, `approve`, `reopen` | Refused once the state has moved (they are not repeatable by design) |
| `release` | Refused once the attempt is no longer RUNNING |
| Re-running a delegated task | **Not idempotent.** A model's output differs between attempts. The framework bounds it (attempts, changed prompt) and records every attempt |

## Human approval pauses

A task waits in AWAITING_APPROVAL when its operations are P2 or above, when the plan marks it with an `approval` block, or when a running task asks for a decision (`pause-approval`, which refunds the attempt). The human reads the request, signs it with `approval.mjs sign` using a registered approver key, and applies it with `tasks.mjs approve`. The signature covers the run, task and **plan hash**, so it cannot be reused on another plan; it expires, is single use, and P4 needs two distinct approvers. A rejection cancels the task. With the committed, empty approver registry no task approval can succeed, which is the secure default. A task approval is separate from the operation approvals the permission hooks check on each tool call.

## Delegation hook rules

| Rule | Meaning |
|---|---|
| Marker | A tracked delegation carries `TASK-REF: RUN-xxxxxxxxxx/Tn` in its prompt |
| ORCH-ARGS | A tracked call missing `name`, `agent_type` or `prompt` is denied **before** an attempt starts, because the tool would reject it and the attempt would be wasted (found in the live demonstration) |
| ORCH-01 | While any run is ACTIVE, NEEDS_HUMAN or STOPPED, a delegation without the marker is denied, so the framework cannot be skipped by omission. A human ends a waiting or frozen run with `tasks.mjs close` (which approves nothing) or cancels it |
| WRONG_AGENT | The `agent_type` must be the task's assigned agent |
| NOT_READY | Dependencies complete, approvals applied, task READY |
| BACKGROUND_DENIED | Tracked delegation must be synchronous, so the reply can be captured |
| ATTEMPTS_EXHAUSTED, BACKOFF | Bounded attempts; a transient failure waits out its backoff |
| UNCHANGED_PROMPT | A retry prompt must differ from the previous attempt's |
| PERMISSION | The permissions are checked again at each start |

The pre hook fails closed for `task` calls. The post hook never blocks the call. The agent's own tool calls remain judged by [agent-guard](../../harness/hooks/agent-guard.cjs) and the [permission model](../security/PERMISSION-MODEL.md), which this framework adds to and does not replace.

## Limits, stated plainly

- **A rewrite of `run.json` and the whole log with recomputed hashes is not detected by the chain alone.** The chain is tamper-evident against partial edits, not against someone who can rewrite every file consistently. Committing runs to Git, reviewing them, and keeping the last event hash somewhere the writer cannot change are the stronger controls, and the last is not built.
- **The engine proves structure, not truth.** It shows that a reply was stored, has the required sections, cites requirement IDs that exist, ends with a verdict, or that a file exists, is fresh and matches its hash. It cannot show that the content is correct. The review tasks and the human are the check on content.
- **Actor names are self-declared** for CLI calls. Only events recorded by the hook carry an identity the hook observed (`hook:delegation-guard`), and even there the agent name comes from the tool call arguments.
- **An attempt is started before the tool runs.** If the tool then rejects the call for a reason the hook cannot see, the attempt is left RUNNING with nobody working on it. The hook checks the arguments it knows the tool requires (ORCH-ARGS), and a human can `release` an orphaned attempt, which refunds it and logs why. Without a release, the lease expiry marks it INTERRUPTED and it counts against the budget.
- **Orchestrator-run tasks** (such as a consolidation) have no hook to capture their output. A human captures it with `tasks.mjs submit --result-file`, and the event log says so.
- **The marker depends on the orchestrator including it.** ORCH-01 makes omission safe while a run is active. With no active run, delegation is untracked by design.
- **Hooks load only in a trusted folder** and have been observed only in Copilot CLI 1.0.105, not in VS Code chat (TODO T12 and T18).
- **No parallel delegation.** Tasks run one at a time, synchronously. Independent tasks in one level are not run concurrently.
- **No rollback.** A task's recovery plan is a statement for a human; the engine does not undo file changes. File artifacts are limited to the agent's own write scope, and drift is detected, not reverted.
- **Run ids are derived from the plan hash.** Two plans that differ in any field are different runs.
- **The limits are placeholders** chosen by this design (attempts, lease, sizes). They are not derived from any external requirement.
- **The control-plane protection of `docs/state/runs/` is enforced by the permission hooks**, which stop agents but not a human or another tool with write access to the folder. The hash chain would detect such edits on the next load; it cannot stop them.

## Running it

```
node harness/scripts/tasks.mjs check-plan --file plan.json
node harness/scripts/tasks.mjs init --file plan.json
node harness/scripts/tasks.mjs status
node harness/scripts/tasks.mjs next
node harness/scripts/tasks.mjs validate --run RUN-xxxxxxxxxx --task T1
node harness/scripts/tasks.mjs retry --run RUN-xxxxxxxxxx --task T1
node harness/scripts/tasks.mjs resume --run RUN-xxxxxxxxxx
node harness/scripts/tasks.mjs trace --run RUN-xxxxxxxxxx --write
node harness/scripts/validate-orchestration.mjs
```

Exit codes: 0 done; 1 a refusal or invalid input (a normal, logged outcome); 2 usage or engine error; 3 integrity failure.
