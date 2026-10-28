# ADR 0007: Tool layer, MCP configuration and output controls

- **Status:** Proposed
- **Type:** Governance
- **Date:** 2026-10-28
- **Deciders:** Programme owner (not yet decided; see TODO T10)
- **Supersedes:** none

## Context
- FACT: The owner asked for a tool layer in eight categories with a registry, valid MCP configuration, read-only separated from mutating tools, limits and logging where supported, sanitised untrusted output, no secrets in prompts, logs or Git, pinned and reviewed dependencies, no automatic installs, small deterministic repository utilities, and no Azure authentication or remote change without approval.
- FACT: Inspected 2026-10-28 and observed in Copilot CLI 1.0.105 ([TOOL-COMPATIBILITY](../harness/TOOL-COMPATIBILITY.md)): workspace `.mcp.json` carries a native tool allow-filter and a timeout; an agent's `tools:` can name `server/tool`; a `postToolUse` hook can rewrite the result the model sees.
- FACT: The `@azure/mcp` package has a `postinstall` script and a launcher that can run an install at runtime, and its npm `latest` tag was a beta ([MCP-SECURITY](../harness/MCP-SECURITY.md), reviews).
- FACT: Large tool results are saved to a temp file that agents read back; an untrusted result could bypass the boundary that way. Found in the live test and fixed.
- ASSUMPTION: Two enabled servers (one local and read-only, one official public documentation server) are enough for Phase 0.

## Options considered
1. **Enable the official Azure and GitHub MCP servers now.** Most capable, but they need sign-in, which the owner forbade without approval, and they carry install and prompt-injection risk.
2. **Registry, two read-only enabled servers, candidates pinned but not configured, native filters plus a guard and an output hook (chosen).** Uses native features for discovery, filtering and result rewriting, and custom code only for what is missing.
3. **No MCP at all; agents use the shell.** Fewest moving parts, but planners have no shell, so they could not run the validators, and shell is the most privileged tool.

## Decision
Proposed for approval:
- Adopt [tool-registry.json](../../harness/tools/tool-registry.json) as the single inventory. An enabled MCP tool must be read-only; a tool that mutates remote state or needs sign-in cannot be enabled for agents; a disabled tool must be reachable by no agent. These are checked by `validate-tools`.
- Enable `greenfuel-tools` (local, zero dependencies, 13 read-only tools) and `microsoft-learn` (remote, no authentication, three read-only tools, `azure-platform` only).
- Keep `azure-mcp` (pinned to 3.0.0 with its integrity hash) and `github-mcp-server` as **pending-approval candidates** in a file no client reads. Approving one follows the procedure in MCP-SECURITY.
- Add `tool-output-guard.cjs` as a repository-wide `postToolUse` hook: redact secret-shaped text, strip hidden characters, cap size, mark external content untrusted, write a metadata-only audit log.
- Extend `agent-guard.cjs` to deny any MCP tool not granted to the calling agent, matched by exact name (a lookalike server name or an unlisted tool is never the registered one), to allow read-type native tools by exact name only, and to limit web fetch to exact approved https hosts. Extend the repository-wide `policy-guard.cjs` to refuse, in any session, an unlisted tool of an enabled server (VS Code has no native tool filter).
- Add nine deterministic validators over specifications, candidate contracts (`v0-candidate`) and synthetic fixtures. They report EMPTY when nothing exists to check.
- No Azure or GitHub sign-in, no server installation and no remote change is part of this decision.

## Consequences
- Adding or changing a server, a pin, a tool or a grant is a control-plane change needing human approval.
- Planners can run validators without a shell. Only `azure-platform` can reach an external tool.
- The candidate data contracts are test oracles only. They must not be mistaken for decisions on D-013 or on the evidence model.
- The CLI's built-in GitHub server is still on for sessions that are not specialist agents.
- Guards depend on a trusted folder and on observed CLI behaviour. Re-run the live checks after upgrading.

## Reversibility
High. The servers, hook, registry and validators can be removed together; nothing else depends on them.

## Revisit when
Copilot changes MCP, hook or agent-tool behaviour; the owner approves Azure or GitHub sign-in; a candidate is approved; a real specification replaces a candidate contract; the product code layout (open question Q8) is decided.

## Evidence
An independent model review of the tool layer found five real gaps (a prefix rule that allowed `store_memory` and `session_*`, unvalidated `env` that could set `NODE_OPTIONS`, server-name lookalikes, a non-exact host match, and no filter for VS Code); each was fixed with regression tests. A sixth finding, an unescaped second boundary marker, was checked and found not to be a bug; tests now cover it.

Unit and mutation tests for the registry validator, the specification validators, the MCP server, the output hook and the guard, and the live record in [TOOL-DEMO](../harness/TOOL-DEMO.md). They show the controls act as described in the tested versions. They do not show how agents behave under a determined attack or in VS Code.
