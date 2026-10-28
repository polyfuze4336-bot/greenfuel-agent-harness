# Tool compatibility

Status: v0.1. Inspected 2026-10-28. Installed and tested: VS Code 1.143.0 (installed, chat not driven) and GitHub Copilot CLI 1.0.105 (live tests). Machine: Windows. `node harness/scripts/validate-agents.mjs --versions` warns when the installed versions differ from the tested ones.

Sources: VS Code [Add MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers) and [MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration); GitHub [hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference); `copilot mcp --help` and `copilot mcp add --help` on the installed CLI; Microsoft Learn [Learn MCP Server overview](https://learn.microsoft.com/en-us/training/support/mcp) and [Azure MCP Server get started](https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/get-started); the `microsoft/mcp` and `github/github-mcp-server` repositories.

## Configuration files

| File | Read by | Top-level key | Fields this repository uses | Notes |
|---|---|---|---|---|
| `.vscode/mcp.json` | VS Code (and forwarded to Copilot harness sessions) | `servers` | `type`, `command`, `args`, `url` | Supports `${workspaceFolder}`, input prompts, `envFile`, per-server sandbox (macOS and Linux only). We use none of the last three, and **it has no tool allow-filter and no timeout field**: an unlisted tool of a registered server is refused by the repository-wide hook instead. Labelled deprecated in VS Code's guided flow |
| `.mcp.json` | Copilot CLI and Copilot harness sessions; VS Code only with an experimental setting | `mcpServers` | `command`, `args`, `type`, `url`, `tools`, `timeout` | The native `tools` allow-filter and `timeout` (ms) live here. No working-directory field: the relative script path assumes the session starts in the repository root |
| `.github/mcp.json` | Copilot CLI | `mcpServers` | none | **Forbidden** by `validate-tools` so configuration cannot drift into a third place |
| `~/.copilot/mcp-config.json` | Copilot CLI, per user | `mcpServers` | none | Personal. Not part of the repository |
| `harness/tools/mcp-candidates.json` | **Nothing** | `mcpServers` | n/a | Candidates awaiting approval; in client format so approval is a copy, not a rewrite |

The two active files describe the same two servers. `validate-tools` checks they agree with each other and with the registry.

## Observed in Copilot CLI 1.0.105

| Behaviour | Result |
|---|---|
| Workspace `.mcp.json` is discovered | Yes. `copilot mcp list` shows `greenfuel-tools` and `microsoft-learn` as workspace servers and a built-in `github-mcp-server` |
| The native `tools` filter and `timeout` are honoured and shown | Yes in `copilot mcp get`: the 13 tools and 20000 ms |
| `server/tool` entries in an agent's `tools:` restrict that agent | Yes. `architecture-critic` listed exactly its four granted tools and could not see the other nine or the Learn tools; `security-reviewer` had no lineage or readiness tool |
| Runtime name of an MCP tool | `<server>-<tool>`, for example `greenfuel-tools-trace_requirement`. The guard compares names with case and separators ignored |
| Agent-scoped `preToolUse` hook sees MCP calls | Yes; grants and denials are enforced (unit tested; live: a granted call ran, an ungranted tool was not available) |
| `postToolUse` fires for MCP tools and built-in tools | Yes (audit log shows both) |
| `postToolUse` can replace the result the model sees | Yes. Confirmed with a probe on `view`, and with the untrusted boundary added to a Microsoft Learn result |
| `postToolUse` payload | `sessionId`, `timestamp`, `cwd`, `toolName`, `toolArgs`, `toolResult.resultType`, `toolResult.textResultForLlm`. The output field that works is `modifiedResult` |
| Large results | The CLI replaces them with a short "saved to file" notice **before** the hook runs, and the agent then reads the file with `view` or `grep`. The hook therefore classifies reads of `*-copilot-tool-output-*.txt` as untrusted |
| Web fetch denial by host and scheme | Yes: `example.com` and `http://` were denied by the agent guard. Hosts are matched exactly (subdomains are not implied); only the initial URL is checked |
| Built-in GitHub MCP server | Present and on by default; the guard denies it for specialist agents. `--disable-builtin-mcps` is available |

## Not observed

- VS Code chat: MCP server start and trust prompts, `server/tool` syntax in an agent's `tools:`, agent-scoped hooks, and whether `.vscode/mcp.json` and `.mcp.json` interact when both are loaded. VS Code documents that servers needing input prompts are not forwarded to the Copilot harness; ours use none.
- The Local (non-Copilot) harness in VS Code.
- Whether the CLI kills a server that exceeds its `timeout`.
- MCP sandboxing (unavailable on Windows).
- Any Azure or GitHub MCP server running: none was installed, started or authenticated.
- Behaviour on other CLI or VS Code versions. The names and the saved-output file pattern are observations, not documented contracts; re-run the live checks after upgrading.

## Tool categories on this machine

| Category | Native or standard route used | What is not available and why |
|---|---|---|
| Repository | `git` read commands and `gh pr\|run list\|view\|checks` through the executor allow-list; native search | Writes and pull-request creation are human actions |
| Azure | None enabled | Needs sign-in and a subscription decision; Bicep tooling is phase-gated; the Azure MCP server is a pinned candidate |
| Documentation | Microsoft Learn MCP server and web fetch on two approved hosts | Standards-body hosts wait for the owner's scope decision (TODO T4) |
| Engineering | Native read, edit (scoped), execute (allow-listed) | Dependency installs are human-only; no build tools exist yet |
| Testing | `node --test`, `npm test`, `npm run validate`, contract checks over fixtures | No integration, security-scan, or end-to-end tooling: nothing to test |
| Architecture | Nine validators and a requirement tracer, over MCP and the command line | None |
| Observability | Local audit log only | Azure Monitor and Application Insights need sign-in and deployed resources |
| Memory | The repository (ADRs, STATE, TODO, evidence) through three read-only MCP tools; native session todo | Copilot's own persistent memory is rejected: it cannot be reviewed or validated |
