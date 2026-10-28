# Task contract

Every task in a plan carries this contract. A plan is JSON (`greenfuel.task-plan/v1`); the engine rejects unknown properties, so a typo is an error, not silently ignored. A worked example is [EXAMPLE-PLAN.json](./templates/EXAMPLE-PLAN.json). Validate a plan with `check_plan` or `node harness/scripts/tasks.mjs check-plan --file plan.json`.

## Plan fields

| Field | Required | Meaning |
|---|---|---|
| `schema` | yes | `greenfuel.task-plan/v1` |
| `title`, `request`, `objective` | yes | What was asked and what the plan is for |
| `requirements` | yes | Affected requirement IDs; each must exist in the baseline |
| `constraints` | no | Affected hard-constraint IDs (HC-nn); each must exist |
| `risks` | yes | At least one `{id, text, mitigation}` |
| `tasks` | yes | At most the task limit in the policy |

## Task fields

| Field | Contract item | Rules |
|---|---|---|
| `id` | Unique task ID | Matches the policy pattern (`T` followed by letters, digits, `_` or `-`); unique in the plan |
| `title`, `objective` | Objective | Plain statements of the work |
| `requirements` | Requirements | At least one; each must be in the plan's list |
| `agent` | Assigned agent | A real agent the orchestrator may delegate to. The orchestrator is allowed only with `executor: "orchestrator"` |
| `executor` | | `delegate` (default) or `orchestrator`. An orchestrator-run task is read-only and its output is captured by a human |
| `inputContext` | Input context | At most the context limit; each file must exist and not be a secret, audit or isolated (shipowner or jurisdiction) path |
| `expectedArtifacts` | Expected artifacts | `{kind: "result"}` (the delegate's reply, captured by the hook) or `{kind: "file", path}`. A file path must be normalised, inside the agent's write scope, not a script, and not in a protected path class. An agent without an edit tool can produce only a `result` |
| `permissions` | Tool permissions | `{tier, tools, operations}`. Tools must be tools the agent has. Operations must be known and not never-grantable; `tier` must equal the highest operation tier; operations above the agent's standing ceiling (P2 or above) make the task wait for a signed approval; tiers P3 and P4 are refused in phase 0 |
| `dependsOn` | Dependencies | Existing task IDs; no cycle, no self-dependency |
| `acceptance` | Acceptance tests | At least one; every artifact must be covered by at least one test. Types below |
| `maxAttempts` | Maximum attempts | 1 up to the cap in the policy (default 2) |
| `status` | Status | Do not set it. Every task starts `PENDING`; the run store holds the real status |
| `evidence` | Evidence references | Do not set it. The engine fills it with artifact, captured-result, acceptance and command references and their hashes |
| `recovery` | Rollback or recovery plan | Required text of at least the policy length. It tells a human how to undo or redo the task; the engine does not execute it |
| `review` | Independent review | `{required: true, by: "<task id>"}` where that task is a different, permitted reviewer agent, depends on this task and has a `verdict` test; or `{waiver: "<reason>"}`. Required for author and executor agents |
| `approval` | Human approval | `{required: true, tier: "P2"|"P3"|"P4", reason}` to force an approval pause, in addition to any derived from the operations |

## Acceptance test types

A test is `{id, type, target, ...}`. `target` is `@result` or one of the task's file artifacts. Command checks have an `argv` instead.

| Type | Passes when |
|---|---|
| `file-exists` | The target exists and is not empty |
| `file-contains` | The `pattern` (regular expression, flags default `im`) matches |
| `file-not-contains` | The `pattern` does not match |
| `headings` | Each listed heading text appears as a Markdown heading |
| `min-words` | At least `min` words |
| `json-valid` | The target parses as JSON |
| `verdict` | One or more lines `Verdict: ACCEPT`, `ACCEPT-WITH-CONDITIONS`, `REWORK` or `REJECT` are present and **all agree** (`allowed` can narrow it); conflicting lines fail the check so an early quoted verdict cannot mask a final one. REWORK and REJECT are blocking |
| `cites-requirements` | At least `min` of the task's own requirement IDs are cited, and **no** cited requirement-style ID is missing from the baseline, so an invented requirement fails |
| `no-secret` | No secret-shaped text is in the target, and for a reply, none had to be redacted |
| `command` | An allow-listed `argv` exits 0. Run only by `tasks.mjs validate` and recorded as evidence; a plan cannot add commands |

File artifacts must also be **fresh**: written after the attempt began. A stale file cannot satisfy a new attempt.

## What the contract cannot say

It cannot say that content is true. It can require structure, citations that exist, a different reviewer and a human where a person must decide. Model claims that no test covers stay unverified, and the report says so.
