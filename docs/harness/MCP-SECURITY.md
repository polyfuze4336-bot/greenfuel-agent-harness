# MCP and tool security

Status: v0.1, Proposed (ADR 0007). Scope: every tool an agent can reach, with the focus on MCP servers because they run code or call services with the developer's privileges. The inventory is in [TOOL-REGISTRY](./TOOL-REGISTRY.md); what each Copilot surface supports is in [TOOL-COMPATIBILITY](./TOOL-COMPATIBILITY.md). The live record of discovery and invocation is in [TOOL-DEMO](./TOOL-DEMO.md).

## Trust model

| Thing | Trusted? | Why |
|---|---|---|
| Code in this repository, including the `greenfuel-tools` server | Trusted as far as review and CI go | Reviewed with every change; zero dependencies |
| An MCP server from another publisher | **Not trusted by default** | A local server runs as the developer; a remote one can change without notice |
| **Anything a tool returns that came from outside the repository** | **Untrusted data, never instructions** | Web pages, documentation, pull request text, run logs and search results can carry injected instructions |
| Tool descriptions and annotations from third parties | Advisory only | A server can claim `readOnlyHint` and still write |
| A validator result | An observation | It becomes evidence only when recorded by the [evidence recorder](../evidence/README.md) |

## Threats and controls

| Threat | Controls | Enforced by | Residual risk |
|---|---|---|---|
| **A malicious or compromised MCP server** (supply chain) | No server is installed automatically. Candidates live in a file no client reads. A package must be pinned to an exact version with its integrity hash, reviewed from the downloaded tarball (scripts not run), and installed by a human with scripts disabled. `-y` and `--yes` are refused | `validate-tools` (pins, integrity, no auto-confirm, candidates not configured) | A remote service cannot be version-pinned. It is allowed only with a tool allow-filter, host pinning and untrusted-output handling |
| **Prompt injection through tool output** | Output from external tools is wrapped in an UNTRUSTED boundary, stripped of control, zero-width, bidi and tag characters and HTML comments, size-capped, and flagged when it contains order-like phrases. The boundary's closing marker cannot be forged. Agents that read untrusted content are authors with a narrow write scope or planners with no write tool | `tool-output-guard.cjs` (native `postToolUse` result rewrite); agent classes | The flagging is heuristic and will miss rephrased attacks. The controls that hold are least privilege, read-only tools and human review of what authors write |
| **Untrusted content laundered through a saved file.** The CLI saves a large result to a temp file and the agent reads it back with `view` or `grep` | The hook treats reads of those saved-output files as untrusted too. Found and fixed during the live test (see TOOL-DEMO) | `tool-output-guard.cjs`, test `reading a saved copy...` | Relies on the CLI's temp-file naming, which is observed behaviour, not a documented contract |
| **Over-privileged tools** | Every tool has a privilege and a mutation class. An enabled MCP tool must be read-only. Tools that mutate remote state or need sign-in cannot be enabled for agents. Each agent lists exactly the MCP tools it may use (native `tools:` filter), and the guard denies any other MCP tool, including the CLI's built-in GitHub server. MCP names are matched **exactly** against accepted spellings of registered tools, so a lookalike server (`greenfueltools`) or an unlisted tool is never treated as the registered one. Read-type native tools are allowed by exact name only; `store_memory`, `session_*` and any new tool are denied until classified. Configured `env` must equal the reviewed registry `env`, loader variables such as `NODE_OPTIONS` are forbidden, and configuration entries may carry only reviewed properties | `validate-tools`; agent frontmatter; `agent-guard.cjs`; shared matcher `mcp-names.cjs` | A third-party tool that mislabels itself. Mitigated by not enabling any |
| **A tool the reviewed list does not contain** (for example a remote service that later adds one) in a client with no native tool filter | The CLI filters natively through `tools` in `.mcp.json`. VS Code has no such field, so the **repository-wide** `preToolUse` hook refuses, in every session, any tool that looks like one of this repository's enabled servers but is not in the registry (`MCP-UNLISTED`) | `policy-guard.cjs` | Not observed in VS Code (TODO T12). A client that does not run repository hooks has no filter |
| **Data leaving the jurisdiction or the organisation** | The registry records where each tool sends data. Web fetch is limited to **exact** approved https host names and only the initial URL is checked (a redirect to another host is not seen). Search is refused. The Azure server is candidate-only, with Microsoft telemetry switched off in its configuration. A query sent to Microsoft Learn must never contain project secrets, customer data or jurisdiction-bound measurements (HC-01) | Registry `egress`; `agent-guard.cjs` host allow-list | A redirect from an approved host. An agent could still paste sensitive text into a docs query. No technical control reads intent. Only `azure-platform` has external tools, and its work is reviewed |
| **Secrets in prompts, logs or Git** | No literal secret in any MCP configuration; no `envFile`, no input prompts; secret-named variables must be `${ENV}` references. Secret-shaped strings are redacted from every tool result. The audit log records tool names and counts only, never arguments or content, and is Git-ignored. One pattern list drives the repository scan, the configuration check and the redaction | `validate-tools`, `validate-harness` secret scan, `tool-output-guard.cjs`, CI | Patterns are heuristics. A user can still type a secret into a prompt |
| **Runaway output or time** | The local server caps output at 32 KB. The hook caps MCP and external output at the registry limit. Each server has a client-side timeout in `.mcp.json`. The hook has its own 10 s timeout | Server; hook; native `timeout` | The local server is synchronous and cannot interrupt itself, so the client timeout is the enforcer. Whether the CLI kills a slow server was not tested |
| **Unreviewed Azure access** | No sign-in has been performed or approved. Azure, Resource Graph, Monitor and Application Insights tools are `pending-approval`. Any mutation is `human-only` | Registry rules; repository policy hook | None while nothing is approved |
| **Confusing a tool result with proof** | The registry, the validators' notes and the agent definitions say results are observations. Only the recorder creates evidence | Convention plus `qa-engineer` verdict rules | A reviewer who ignores the rule |

## What is native and what is custom

| Need | Native Copilot capability used | Custom code, and why |
|---|---|---|
| Server discovery | Workspace `.mcp.json` (CLI) and `.vscode/mcp.json` (VS Code) | None |
| Per-server allow-list of tools and timeout | `tools` and `timeout` fields in `.mcp.json` (Copilot CLI only; VS Code's `mcp.json` has neither field, so the repository-wide hook covers it) | None |
| Per-agent tool restriction | `tools:` in the agent file (`server/tool`) | A policy file and validator, so the lists cannot drift |
| Deny an unlisted MCP tool | None | `agent-guard.cjs`, as a second layer |
| Rewrite or cap results | Native `postToolUse` hook | `tool-output-guard.cjs`; there is no built-in sanitiser |
| Run validators without a shell | None | The `greenfuel-tools` server; planners have no execute tool, and no other native way to give them these checks |
| Pinned, reviewed servers | None | Registry, candidate file and validator |

## Logging

`.harness-logs/tool-audit.jsonl` (Git-ignored, capped at about 2 MB): time, session id, tool name, result type, bytes in and out, redaction and flag counts, whether it was external or MCP. No arguments, no content. The `greenfuel-tools` server also writes one metadata line per call to its stderr, which the client shows in its server output. These are convenience logs: they are local files, not tamper-evident, and are not evidence records.

## Approving a candidate

No candidate is approved. The owner decides; nothing below is done automatically.

1. **Decide the need.** Name the task the server serves and why a native tool does not.
2. **Review the publisher and licence.** Official publisher, maintained, licence acceptable.
3. **Review the package without running it.** `npm view` for scripts and dependencies; `npm pack <pkg>@<exact> --ignore-scripts`; read the launcher and every script. Record the sha512 integrity.
4. **Pin.** Exact version, never a tag or range, and record why not the newest.
5. **Decide identity and scope.** For Azure or GitHub: which account, which read-only role, which subscription (D-037), and approval to sign in. Read-only mode is required, and an allow-filter lists exact tools.
6. **Install by hand** with scripts disabled, then confirm the read-only flag with the binary's own help output. Several flags here are unverified until then.
7. **Try it in a throwaway Copilot home** that trusts only this folder, with a deliberately hostile prompt, and keep the transcript.
8. **Register it**: add servers, tools and grants to `tool-registry.json` and `agent-policy.json`, move the entry from `mcp-candidates.json` to `.vscode/mcp.json` and `.mcp.json`, run `validate-tools --write`, `npm run validate` and `npm test`.
9. **Record an ADR** and have a human approve the control-plane change.

## Reviews done on 2026-10-28

| Server | Source | Findings | Decision |
|---|---|---|---|
| `greenfuel-tools` | This repository | Read-only by construction and by test: no writes, no network, one fixed `git log`; argument schemas closed; paths limited to `docs/specs` and `tests/fixtures`; output cleaned and capped | **Enabled** |
| `microsoft-learn` | Microsoft, remote, no authentication | Discovery listed three tools, all `readOnlyHint: true`; public documentation only; the publisher can change it, so it is allow-filtered and its output is untrusted | **Enabled**, `azure-platform` only |
| `azure-mcp` | `@azure/mcp`, Microsoft, MIT | `postinstall` script (only a platform-package check). The launcher can run an install command at runtime if the platform package is missing. The npm `latest` tag was a beta on the review date. Its documentation includes mutating examples. Telemetry to Microsoft is on by default. It needs `az login`. `--read-only` confirmed in upstream sources, not by running it | **Pending approval**, pinned to the latest stable 3.0.0, nothing installed or authenticated |
| `github-mcp-server` | GitHub, remote | Needs sign-in. Copilot CLI already ships a built-in copy that is on by default there; specialist agents cannot reach it | **Pending approval**, not configured |

## Known limitations

- Hooks load only in a trusted folder. In an untrusted folder the guards silently do not run (see [LIVE-TEST-R1](./LIVE-TEST-R1.md)).
- A `postToolUse` hook that crashes or times out lets the result through unchanged.
- The CLI's built-in GitHub MCP server stays enabled for sessions that are not one of the specialist agents. `--disable-builtin-mcps` turns it off per session.
- MCP sandboxing is available only on macOS and Linux; this machine runs Windows, so no server is sandboxed.
- A redirect from an allowed host to another host is not seen by the guard.
- VS Code shows a trust prompt the first time an MCP server starts. A human answers it; that is intended.
- Nothing here protects a user who types a secret into a prompt.
