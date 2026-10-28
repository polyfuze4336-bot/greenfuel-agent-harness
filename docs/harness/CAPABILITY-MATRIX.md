# Capability Matrix

Native-first: a custom component exists only where this matrix records a requirement with no adequate native answer. Status values are literal:

- **Tested**: covered by passing automated tests in this repository (see [STATE](../state/STATE.md) for the recorded run).
- **Written, not observed live**: files exist and are statically valid, but behaviour inside a real Copilot session has not been observed.
- **Not implemented**: planned only.

Native-capability claims come from the sources in Section 4, read on 2026-10-28 against VS Code 1.143.0 documentation. They describe documented behaviour, not behaviour verified on this machine.

## 1. Requirements to capabilities

| ID | Requirement | Pillar | Native answer | Gap? | Component here | Status |
|---|---|---|---|---|---|---|
| C1 | Always-on repo rules for every session | Context & Instructions | `AGENTS.md` | No | [AGENTS.md](../../AGENTS.md) | Written, not observed live |
| C2 | Rules that load only for relevant files | Context & Instructions | `.instructions.md` with `applyTo` | No | `.github/instructions/*` | Written, not observed live; frontmatter validated |
| C3 | Recorded architecture decisions | Context & Instructions | None specific (Markdown convention) | Convention only | `docs/adr/`, `adr-authoring` skill | Written; ADR 0001 and 0002 Accepted 2026-10-28 |
| C4 | Task-specific context instead of the whole repository | Context & Instructions | Always-on `AGENTS.md`, skills, file links, search. No native per-agent document restriction | Partial: profile definitions and a coverage check | `docs/context/context-manifest.json`, `context-loading` skill, manifest checks in `validate-context.mjs` | Manifest checks Tested; agents following the procedure not observed ([CONTEXT-LOADING-STRATEGY](../context/CONTEXT-LOADING-STRATEGY.md) section 8) |
| C5 | Requirements baseline is complete, consistent and traceable | Verification & Evidence | None | Yes | Baseline checks in `validate-context.mjs`: unique IDs, classes, one traceability row per requirement, source rules, resolvable references | Tested (mutation tests) |
| A1 | Every major design evaluated through ten perspectives and screened against hard constraints; reviewer can reject; Approved is prevented while critical items are unresolved | Verification & Evidence; Orchestration & Role Separation | Custom agents and skills for the roles. Nothing native computes a verdict from a design record | Yes | `design-reviewer` and `architecture-critic` agents, skills `design-authoring`, `design-review`, `design-defense`, `docs/architecture/`, `design-gate.mjs` | Gate Tested (mutation and positive-path tests); example computed Blocked and recorded; agent behaviour not observed |
| A2 | Design ADRs carry the required fields and cannot be Accepted without an Approved review; decisions count as decided only with an Accepted ADR | Context & Instructions | None | Yes | `validate-architecture.mjs`, `validate-context.mjs` | Tested |
| A3 | No fabricated figures or unverified compliance claims in architecture documents | Verification & Evidence | None | Yes | Heuristic lint in `validate-architecture.mjs` | Tested; heuristic, evadable by a determined author (RK-014) |
| T1 | Per-role tool restriction | Tools & Azure Integration | Agent `tools` allow-list | Partly | Twelve agents ([AGENT-ROSTER](../agents/AGENT-ROSTER.md)), `agent-policy.json`, `validate-agents.mjs` | Validator checks tools against policy and class (mutation tested); tool restriction and hook denials observed live in Copilot CLI 1.0.105 ([demo](../agents/DEMO-READONLY-DELEGATION.md)); VS Code chat not observed |
| T2 | Azure documentation and resource context | Tools & Azure Integration | Microsoft Learn MCP server (enabled, read-only, `azure-platform` only); Azure MCP server (installed in the developer's VS Code, not used by agents) | Yes, for the allow-list and guard | [TOOL-REGISTRY](TOOL-REGISTRY.md), `tool-registry.json`, `.mcp.json`, `.vscode/mcp.json`; Azure MCP is a pinned **pending-approval** candidate | Learn server discovery and one call observed live; Azure MCP not installed, started or authenticated; resource context needs sign-in (TODO T11) |
| T3 | Azure authoring and validation | Tools & Azure Integration | Bicep extension, `az bicep`, `what-if`, `azd` | No | `azure-iac.instructions.md` (rules only); registry entry `azure-bicep-validate` (phase-gated) | Rules written; no IaC in Phase 0 |
| T4 | No unnecessary dependencies | Tools & Azure Integration | n/a | Policy | Validator rejects any `package.json` dependency; the MCP server is hand-written with no SDK | Tested |
| T5 | Valid, minimal MCP configuration; read-only separated from mutation | Tools & Azure Integration | `.mcp.json` (`tools` filter, `timeout`), `.vscode/mcp.json`, agent `tools:` with `server/tool` | Partly: registry, validator, guard | `harness/tools/tool-registry.json`, `validate-tools.mjs`, `agent-guard.cjs`, [MCP-SECURITY](MCP-SECURITY.md) | Mutation tested; discovery, per-agent filtering and invocation observed live in Copilot CLI 1.0.105 ([TOOL-DEMO](TOOL-DEMO.md)); VS Code not observed (TODO T12) |
| T6 | Untrusted tool output, secrets and size limits | Guardrails & Human Approval | Native `postToolUse` hook can rewrite results | Yes: the sanitiser | `tool-output-guard.cjs`, `secret-patterns.json` | Unit and process-level tests; boundary, redaction and a saved-output gap observed and fixed live; injection flagging is heuristic |
| T7 | Deterministic checks over specifications, contracts and fixtures | Verification & Evidence | None | Yes | `spec-validators.mjs`, the `greenfuel-tools` server, nine named utilities | Mutation tested over synthetic fixtures; EMPTY (nothing checked) for contracts with no specifications; no application is validated |
| T8 | Memory retrieval: decisions, task state, history | Memory & Resumability | Repository as memory; native session todo | Yes: three read-only lookups | `get_accepted_decisions`, `get_task_state`, `get_implementation_history` | Tested; one lookup observed live; Copilot's own persistent memory is rejected in the registry |
| O1 | Narrow roles, separated planners and modifiers | Orchestration & Role Separation | Custom agents, `agents` list, agent-scoped hooks | Partly | Twelve agents, `agent-policy.json`, `agent-guard.cjs`, `validate-agents.mjs` | Policy checks and guard tested (unit and mutation); orchestrator delegation to two specialists and guard denials observed live in CLI; subagent-internal writes and VS Code not observed |
| O2 | Planning | Orchestration & Role Separation | Built-in Plan agent | No | none | Native only |
| O3 | Isolated context for sub-tasks | Orchestration & Role Separation | Subagents (`task`) | No | none | Native only |
| O4 | Harness separate from business agents | Orchestration & Role Separation | None | Yes | Phase gate in policy; boundary rule in AGENTS.md; validator rejects `src/`, `infra/` in phase 0 | Tested (gate and validator); boundary rule is prose |
| G1 | Human approves risky actions | Guardrails & Human Approval | Permission levels, tool/URL/terminal approval | Bypassed by Allow all and Autopilot | Hook `ask` decisions | Tested (unit); not observed live |
| G2 | Hard block on deployment and Azure change | Guardrails & Human Approval | `preToolUse` hook deny | Needs a script and policy | `policy-guard.cjs`, `command-policy.json` | Tested (unit); observed live in Copilot CLI 1.0.102 in a trusted folder only; not loaded in an untrusted folder; VS Code not tested |
| G3 | Protect guardrails from agent edits | Guardrails & Human Approval | None | Yes | Control-plane path rule in hook; CI re-run | Tested (unit); not observed live |
| G4 | No secrets in repo, prompts or logs | Guardrails & Human Approval | GitHub secret scanning (repo-level, not yet enabled) | Local check needed | One pattern list (`secret-patterns.json`) drives the repository scan, MCP configuration check and output redaction; `.gitignore`; audit log holds no arguments or content; hook denies secret-file access | Tested (validator, hook, redaction); heuristic |
| G5 | Command isolation | Guardrails & Human Approval | Terminal sandbox setting (`chat.agent.sandbox.enabled`) | Platform support unverified | none | Not implemented (Q5, R3) |
| G6 | Supply-chain control | Guardrails & Human Approval | Approval prompts | Partial | Hook asks on installs; SHA-pinned actions; validator checks pins | Tested |
| M1 | Personal preferences across sessions | Memory & Resumability | Memory tool, user scope | No | none | Native only |
| M2 | Workspace notes | Memory & Resumability | Memory tool, repository scope (local, unshared) | Not shareable | none | Native only |
| M3 | Team-shared, reviewable state | Memory & Resumability | Committed instructions and docs (VS Code guidance) | Convention needed | `docs/state/STATE.md`, `session-handoff` skill | Written; STATE.md populated |
| M4 | Resume interrupted work | Memory & Resumability | Session history and resume | Not portable across machines | STATE.md + git | Written, not observed live |
| V1 | Run tests and see failures | Verification & Evidence | Test and task tools | No | `npm test` | Tested |
| V2 | Evidence not assertion | Verification & Evidence | None | Yes | `record-evidence.mjs`, `evidence-validation` skill | Tested (script run in tests and recorded); agent behaviour not observed |
| V3 | Independent re-verification | Verification & Evidence | GitHub Actions | Workflow must run on GitHub | `.github/workflows/validate.yml` | Written; not run (no remote) |
| V4 | Structural correctness | Verification & Evidence | None | Yes | `validate-harness.mjs` | Tested |
| V5 | No fabricated Azure state | Verification & Evidence | None | Policy | Agent rules; docs instruction; Azure state never evidenced in Phase 0 | Prose only; cannot be machine-tested |

## 2. Custom code register

Every custom component, why it exists, and how big it is. Removal triggers are listed so they can be deleted when native features catch up.

| Component | Lines | Requirement | Why native is not enough | Dependencies | Remove when |
|---|---|---|---|---|---|
| `harness/hooks/policy-guard.cjs` + `harness/policy/command-policy.json` | 137 + 33 | G1, G2, G3, O4 | Approval modes can be bypassed; no native way to block specific commands or paths by phase | none (Node built-ins) | A native, policy-as-config permission feature covers deny rules by command and path |
| `harness/scripts/record-evidence.mjs` | 75 | V2 | No native tamper-evident record of a command result | none | A native, exportable tool-run log with exit codes is available and acceptable as evidence |
| `harness/scripts/validate-harness.mjs` | 155 | T4, O4, V4, G4, G6 | No native linter for this repository's conventions | none | Never fully; shrink as native validation of agents, skills and hooks appears |
| `harness/scripts/validate-context.mjs` | 250 | C4, C5 | No native check that a requirements baseline is internally consistent or that context profiles cover it | none | A native requirements or knowledge-base validation capability exists, or the baseline moves to a tool that enforces these rules |
| `harness/scripts/design-gate.mjs` | 286 | A1 | No native feature computes Rejected, Blocked or Approvable from a design and its review, or refuses a more permissive declared status | none | A native design-review or policy-as-code feature covers these rules; or the gate moves into GitHub branch protection with required checks |
| `harness/scripts/validate-architecture.mjs` | 134 | A1, A2, A3 | No native check on ADR structure, ADR-to-review coupling or fabricated figures | none | As above |
| `tests/*.test.mjs` | 98 + 50 + 73 + 89 + 187 | all "Tested" rows | Tests for the above | `node:test` built in | With the components |

Total custom: about 1,040 lines of code plus 500 lines of tests, zero third-party packages. The code grew by about 430 lines in this stage, all for the gate and its checks, and each piece is tied to a documented requirement above.

## 3. Native capabilities available but not adopted yet

| Capability | Why not yet | Where tracked |
|---|---|---|
| Terminal sandboxing | Windows support and interaction with Azure CLI unverified | Q5, R3 |
| Assisted permissions (LLM judge) | Model-based and can err; hooks and approvals preferred first | R3 |
| Dev container or Codespaces for agent work | Larger setup; strongest isolation | R3 |
| Agent plugins and the customization marketplace | Supply-chain review required before use | R10 |
| Enterprise-managed AI settings | Needs tenant admin; would enforce hooks and permission levels centrally | Q9 |
| Copilot cloud agent, GitHub code review | Needs a GitHub remote and policy decisions | R4 |
| Custom MCP servers | One small read-only local server (`greenfuel-tools`) because planners have no shell; third-party servers are registered and pinned but pending approval | R2, [ADR 0007](../adr/0007-tool-layer-mcp-and-output-controls.md) |
| Handoffs, prompt files | Local-harness-only | n/a |
| Autopilot and Allow all | Intentionally not used; they remove prompts | n/a |

## 4. Sources (read 2026-10-28)

- Customization overview: <https://code.visualstudio.com/docs/agent-customization/overview>
- Custom agents and file reference: <https://code.visualstudio.com/docs/agent-customization/custom-agents>, <https://code.visualstudio.com/docs/agents/reference/custom-agent-file-reference>
- Agent harnesses (Local vs Copilot): <https://code.visualstudio.com/docs/agents/run/agent-harnesses>
- Hooks (VS Code): <https://code.visualstudio.com/docs/agent-customization/hooks>; payloads and decisions: <https://docs.github.com/en/copilot/reference/hooks-reference>
- Approvals, permission levels, sandboxing: <https://code.visualstudio.com/docs/agents/run/approvals>
- Memory: <https://code.visualstudio.com/docs/agents/run/memory>
- Tools: <https://code.visualstudio.com/docs/agents/run/tools>
