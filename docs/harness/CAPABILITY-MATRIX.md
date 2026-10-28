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
| C3 | Recorded architecture decisions | Context & Instructions | None specific (Markdown convention) | Convention only | `docs/adr/`, `adr-authoring` skill | Written; no ADR accepted yet |
| T1 | Per-role tool restriction | Tools & Azure Integration | Agent `tools` allow-list | No | `architect`, `reviewer` agents | Validator checks `tools` is explicit; enforcement by runtime not observed |
| T2 | Azure documentation and resource context | Tools & Azure Integration | Azure MCP server and Azure extensions (installed) | Allow-list per agent undecided | none | Not implemented (Q6) |
| T3 | Azure authoring and validation | Tools & Azure Integration | Bicep extension, `az bicep`, `what-if`, `azd` | No | `azure-iac.instructions.md` (rules only) | Rules written; no IaC in Phase 0 |
| T4 | No unnecessary dependencies | Tools & Azure Integration | n/a | Policy | Validator rejects any `package.json` dependency | Tested |
| O1 | Narrow roles | Orchestration & Role Separation | Custom agents | No | `architect`, `reviewer` | Written, not observed live |
| O2 | Planning | Orchestration & Role Separation | Built-in Plan agent | No | none | Native only |
| O3 | Isolated context for sub-tasks | Orchestration & Role Separation | Subagents (`task`) | No | none | Native only |
| O4 | Harness separate from business agents | Orchestration & Role Separation | None | Yes | Phase gate in policy; boundary rule in AGENTS.md; validator rejects `src/`, `infra/` in phase 0 | Tested (gate and validator); boundary rule is prose |
| G1 | Human approves risky actions | Guardrails & Human Approval | Permission levels, tool/URL/terminal approval | Bypassed by Allow all and Autopilot | Hook `ask` decisions | Tested (unit); not observed live |
| G2 | Hard block on deployment and Azure change | Guardrails & Human Approval | `preToolUse` hook deny | Needs a script and policy | `policy-guard.cjs`, `command-policy.json` | Tested (unit); not observed live |
| G3 | Protect guardrails from agent edits | Guardrails & Human Approval | None | Yes | Control-plane path rule in hook; CI re-run | Tested (unit); not observed live |
| G4 | No secrets in repo | Guardrails & Human Approval | GitHub secret scanning (repo-level, not yet enabled) | Local check needed | Secret patterns in validator; `.gitignore`; hook denies secret-file access | Tested (validator, hook) |
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
| `harness/scripts/validate-harness.mjs` | 147 | T4, O4, V4, G4, G6 | No native linter for this repository's conventions | none | Never fully; shrink as native validation of agents, skills and hooks appears |
| `tests/*.test.mjs` | 98 + 50 + 73 | all "Tested" rows | Tests for the above | `node:test` built in | With the components |

Total custom: about 510 lines of code plus 221 lines of tests, zero third-party packages.

## 3. Native capabilities available but not adopted yet

| Capability | Why not yet | Where tracked |
|---|---|---|
| Terminal sandboxing | Windows support and interaction with Azure CLI unverified | Q5, R3 |
| Assisted permissions (LLM judge) | Model-based and can err; hooks and approvals preferred first | R3 |
| Dev container or Codespaces for agent work | Larger setup; strongest isolation | R3 |
| Agent plugins and the customization marketplace | Supply-chain review required before use | R10 |
| Enterprise-managed AI settings | Needs tenant admin; would enforce hooks and permission levels centrally | Q9 |
| Copilot cloud agent, GitHub code review | Needs a GitHub remote and policy decisions | R4 |
| Custom MCP servers | None required yet | R2 |
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
