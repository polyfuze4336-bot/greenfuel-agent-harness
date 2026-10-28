# Specialist agent roster

Status: Accepted by the programme owner on 2026-10-28 ([ADR 0006](../adr/0006-specialist-agent-roster-and-enforcement.md)). These agents belong to the **coding harness**. The business agents of the bunkering product are separate, are designed under `docs/design/ai/`, and must never be defined in `.github/agents/`.

Source of truth for roles, tools, write scopes, command allow-lists and delegation: [agent-policy.json](../../harness/policy/agent-policy.json). Each agent file in [.github/agents/](../../.github/agents/) must match it; `node harness/scripts/validate-agents.mjs` checks that, and `npm run validate` includes it.

## Roster

| Agent | Class | Native tools | Writes (Phase 0) | Phase-1 scope, closed until a human raises the phase | Commands |
|---|---|---|---|---|---|
| orchestrator | planner | read, search, todo, agent | none | none | none |
| principal-architect | author | read, search, edit | designs, risk register, ADRs, state, system design | none | none |
| maritime-domain | planner | read, search | none | none | none |
| azure-platform | author | read, search, edit, web | `docs/design/azure/**` | `infra/**` | none |
| application-engineer | author | read, search, edit | `docs/design/application/**` | `src/api/**`, `src/web/**`, `src/integration/**` | none |
| ai-engineer | author | read, search, edit | `docs/design/ai/**` | `src/agents/**`, `evals/**` | none |
| data-engineer | author | read, search, edit | `docs/design/data/**` | `src/data/**`, `src/calc/**`, `db/**` | none |
| security-reviewer | planner | read, search | none | none | none |
| sre-engineer | author | read, search, edit | `docs/design/operations/**`, `docs/runbooks/**` | `ops/**` | none |
| qa-engineer | executor | read, search, edit, execute | `docs/design/test/**` | `tests/product/**` | five patterns |
| architecture-critic | planner | read, search | none | none | none |
| design-reviewer | executor | read, search, edit, execute | `docs/architecture/reviews/**` | none | three patterns |

Twelve agents: the eleven requested plus `design-reviewer`, kept because the approved governance capability ([ADR 0005](../adr/0005-approve-architecture-governance-v0-1.md)) needs a recorded reviewer who is not the author and who runs the gate. The earlier four harness agents were consolidated: `architect` to `principal-architect`, `design-challenger` to `architecture-critic`, `reviewer` into `qa-engineer`. The Phase-1 paths are provisional and tied to open question Q8 (product code layout).

## Classes: planning is separate from changing things

| Class | May | May not |
|---|---|---|
| planner | read, search, keep a todo list, and (orchestrator only) delegate | edit files, run commands, use the web |
| author | edit files inside its own write scope | run any command; edit anything outside its scope |
| executor | edit a narrow scope and run a short anchored allow-list of single commands | chain, pipe or redirect; run anything that deploys, installs, publishes or writes to git |

Only `azure-platform` has web access (approved https hosts only) and the external documentation MCP tools. MCP tools are granted per agent, read-only, by exact name.

## Delegation and dependency

```text
human
  |
orchestrator --delegates to--> the eleven specialists (one level)
specialists -------------------> return to the orchestrator; never delegate, never call each other
```

- Only the orchestrator has the `agent` tool and an `agents` list. It is `disable-model-invocation: true`, so no agent can select it. No specialist lists `agents`.
- Circular delegation is prevented by construction (no specialist can delegate), by three policy checks (only the orchestrator delegates; nobody delegates to the orchestrator or to itself; the delegation graph is acyclic) and at run time by the guard hook.
- `dependsOn` is an ordering graph for the orchestrator, not a permission. It is validated as acyclic: maritime-domain, then principal-architect; then data-engineer, azure-platform and security-reviewer; then application-engineer and ai-engineer; then sre-engineer and qa-engineer; architecture-critic and design-reviewer review before any approval request.
- Separation of duties: `design-reviewer` and `architecture-critic` share no write scope with `principal-architect` (checked). `qa-engineer` is the only agent whose verdicts count as evidence, and only through the recorder.

## Per-agent contract

Each agent file has the same ten sections, checked by the validator (each must be more than a stub): Mission, Allowed, Prohibited, Context (with a `Profiles:` line that must match policy and the [context manifest](../context/context-manifest.json)), Inputs, Outputs, Acceptance criteria, Escalation, Handoffs, Evidence. Every Evidence section states that completion claims need evidence or are marked unverified.

Human-approval conditions are in each agent's Escalation section. The common ones: any decision still Open in the [decision register](../context/DECISION-REGISTER.md), any hard-constraint violation, any cross-border flow, any Azure change or deployment, any approval or acceptance, raising the phase.

## Tool access

Each agent's MCP grants are in `agent-policy.json` (`mcp`) and in its `tools:` line as `server/tool`; none uses a wildcard. The full inventory, with which agent may use which tool, is the generated table in [TOOL-REGISTRY](../harness/TOOL-REGISTRY.md). The rules, checked by `validate-tools`:

- Planners and executors may use only read-local MCP tools. Authors may also use read-external ones, and only when they hold web access, which only `azure-platform` does.
- An enabled MCP tool must be read-only. Tools that mutate remote state or need Azure or GitHub sign-in cannot be granted to any agent.
- Web fetch is limited to approved https hosts; search is refused.
- Tool output from outside the repository is treated as untrusted data ([MCP-SECURITY](../harness/MCP-SECURITY.md)).

## Enforcement matrix

| Rule | Native feature carrying it | Executable check | Limitation |
|---|---|---|---|
| Planner cannot edit or run commands | `tools` list in frontmatter | validator: tools equal policy and class rules; guard denies writes and shell | Tool names differ between runtimes; unrecognised names are ignored, so the validator rejects unknown aliases. Omitting `tools` grants all, so the validator requires it |
| Author writes only its own folders | none (no native path scoping) | agent-guard hook, per agent, phase-aware; paths are resolved canonically (encoded, UNC, drive-qualified and `..` forms refused) and both the written path and the real path behind any link must be in scope; validator checks scopes, overlaps and control-plane paths | Hook only. Not loaded in an untrusted folder; timeouts fail open (timeout capped by the validator); a guard is not a sandbox |
| Executor runs only listed commands | none | agent-guard allow-list (anchored, single command, no open-ended `.*`); the evidence recorder is allowed only with a fixed claim form and a short list of nested commands, and the recorder CLI cannot choose its output folder; validator probes each pattern against known dangerous commands | Pattern matching on command text, not sandboxing. A permitted tool such as `node --test` runs whatever the test files contain; the code under test is reviewed like any code |
| Unrecognised tools | none | guard classifies tool names (case and separators ignored) and denies a name it cannot classify | New runtime tool names are denied until added to the guard deliberately; read-type names are allowed by prefix |
| Only the orchestrator delegates, one level, no cycles | `agents` list and `agent` tool | guard denies other targets and self-delegation; validator checks graph | Native allow-list enforcement not observed separately (see [demo](./DEMO-READONLY-DELEGATION.md)); in Local VS Code nested subagents are off by default |
| Orchestrator is not invocable by other agents | `disable-model-invocation: true` | validator | Not tested in VS Code |
| Web only for azure-platform, only on approved hosts | `web` tool | guard denies web fetch for others; for `azure-platform` only https URLs on the registry's host list are allowed and search is refused | A redirect from an approved host is not seen by the guard |
| Only granted MCP tools | `server/tool` in the agent's `tools:`; per-server `tools` filter in `.mcp.json` | guard denies any MCP tool (including the CLI's built-in GitHub server) that is not in the agent's `mcp` list; validator and `validate-tools` check lists against the registry | Observed live in Copilot CLI; VS Code not observed |
| No application code or IaC in Phase 0 | none | phase in command-policy.json read by guard and policy hook; validator phase gate; CI | A human edit of the phase is the only way to open it |
| Agents cannot approve or accept | none | prompts; guard refuses any agent write containing a `Status` of Approved or Accepted; gate refusal of Approved without an Accepted ADR and a named decider; CI | The guard matches text, so a different wording can slip past it. The gate checks that a decider is named in the right form; it cannot authenticate that a human wrote it. Real enforcement needs branch protection and an approver registry (roadmap R4). Prompts are not controls |
| Supported frontmatter only | n/a | validator rejects handoffs, mcp-servers, infer, model, reasoning-effort, metadata, argument-hint, target and unknown keys | Policy list reflects inspected documentation on 2026-10-28 |

## Compatibility

Inspected on 2026-10-28 (sources listed in the policy): VS Code custom agent file reference, VS Code subagents, VS Code hooks, GitHub Docs custom agents configuration and hooks reference.

- **Used:** `.github/agents/*.agent.md` with `name`, `description`, `tools`, `agents`, `user-invocable`, `disable-model-invocation` and agent-scoped `hooks` (preToolUse, command type). Tool aliases `read`, `search`, `edit`, `execute`, `agent`, `web`, `todo`. Path-scoped `.github/instructions/*.instructions.md` with `applyTo`. Skills.
- **Deliberately not used:** `handoffs` (Local harness only, so not portable), the `mcp-servers` frontmatter key (servers are configured in `.mcp.json` and `.vscode/mcp.json` instead and granted per agent through `tools:`), `model` and `reasoning-effort` pinning (agents inherit the session model; pinned models can be unavailable), `infer` (deprecated), `metadata`, `argument-hint`, `target`.
- **Tested with:** VS Code 1.143.0 (installed; chat not driven) and Copilot CLI 1.0.105 (live tests in [DEMO-READONLY-DELEGATION](./DEMO-READONLY-DELEGATION.md)); agent-scoped hooks were first confirmed on CLI 1.0.102. `node harness/scripts/validate-agents.mjs --versions` warns when installed versions differ.
- **Hook payload has no agent name**, so each agent's hook passes its own name as an argument; the validator rejects a file whose hook names a different agent.
- **VS Code:** the harness is shared by VS Code, the CLI and the Copilot app per the documentation, but this stage did not observe VS Code chat behaviour. Verify agent-scoped hooks in VS Code before relying on them there (roadmap item).
- Nested subagents and `chat.subagents.allowInvocationsFromSubagents` apply to the Local harness; this design does not need them.

## Known limits

- Subagent write restrictions rely on the subagent's tool list; the hook was demonstrated for directly started agents, not for a write attempted inside a delegated subagent.
- Hooks are not loaded in an untrusted folder. A new clone has no hook enforcement until the folder is trusted; CI and review remain the independent check.
- A model-written review or test report is still model output. Evidence records and human approval are what turn it into something relied on.
- The validator reads files; it cannot show how a given Copilot build will behave. Re-run the live tests after upgrading Copilot.

## Changing the roster

Edit the policy and the agent file together, run `npm run validate` and `npm test`, record the result with the evidence recorder, and have a human approve the change (control-plane paths). Do not add an agent that can delegate, edit and execute at once.
