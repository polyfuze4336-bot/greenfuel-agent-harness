# STATE

Resume point. Update with the `session-handoff` skill. Facts only; unverified items are labelled.

## Current phase and objective
Phase 0. Baseline v0.1 is **approved** (ADR 0003); the 37 decisions stay open, deferred by the owner. The architecture-governance capability is **approved as a process** (ADR 0005); [DES-0001](../architecture/designs/DES-0001-delivery-measurement-storage-topology.md) is computed **Blocked** and is not approved. The twelve specialist agents are **approved** ([ADR 0006](../adr/0006-specialist-agent-roster-and-enforcement.md), Accepted). This stage added the **tool layer**: a tool registry, two enabled read-only MCP servers, an output-control hook and nine deterministic validators ([ADR 0007](../adr/0007-tool-layer-mcp-and-output-controls.md), Proposed). Objective: owner review of the tool layer (TODO T10). No application code and no Azure resources exist; no Azure or GitHub sign-in was used.

## Done (with evidence)
- Owner decisions 2026-10-28: ADR 0001 and 0002 accepted; baseline approved; governance capability approved; specialist roster approved (ADR 0006); M1 decisions, decider naming (T3) and the T9 agent checks deferred. All earlier commits are pushed; CI succeeded on `2f52908` (`EV-0006` and earlier CI: `EV-0003`).
- Stage 0 evidence: `EV-0001`, `EV-0002`. Baseline evidence: `EV-0004`, `EV-0005`. Governance evidence: `EV-0007` to `EV-0011`. Specialist agent evidence: `EV-0014` to `EV-0016`; `EV-0012` and `EV-0013` record a recorder failure (npm could not be launched on Windows) and are kept because evidence is append-only.
- Governance built and demonstrated on DES-0001, which the gate computes as Blocked; ADR 0004 stays Proposed. Two independent model reviews of the governance work and one of the agent guard found real gaps, all fixed or recorded. Those reviews are not evidence records.
- **Tool layer (commit `5f9ba58`, local, not pushed):**
  - Registry of 47 tools in 8 categories with a validator and generated tables ([TOOL-REGISTRY](../harness/TOOL-REGISTRY.md)). Enabled MCP tools are read-only by rule; a disabled tool must be reachable by no agent.
  - Enabled servers: `greenfuel-tools` (local, zero dependencies, 13 read-only tools) and `microsoft-learn` (remote, `azure-platform` only). `.mcp.json` and `.vscode/mcp.json` agree with the registry.
  - **Not configured, not installed, not authenticated:** Azure MCP (pinned to 3.0.0 with its integrity hash, reviewed from the downloaded tarball) and GitHub MCP ([MCP-SECURITY](../harness/MCP-SECURITY.md)).
  - `tool-output-guard.cjs` (native `postToolUse`): secret redaction, hidden-character stripping, size cap, untrusted boundary, metadata-only audit log. `agent-guard.cjs` and `policy-guard.cjs` extended (exact MCP names, per-agent grants, exact read-tool names, exact web hosts, unlisted tools refused in any session).
  - Nine validators over specifications, candidate contracts (`v0-candidate`) and synthetic fixtures. With no specifications they say EMPTY. `validate-deployment-readiness` says NOT-READY: `EV-0020`.
  - `npm test`: 230 tests pass, `EV-0017`. `npm run validate` clean, `EV-0018`. Tool registry and configuration clean, `EV-0019`. Agents match policy and installed VS Code 1.143.0 and Copilot CLI 1.0.105 match the tested versions, `EV-0021`.
  - Live in Copilot CLI 1.0.105 ([TOOL-DEMO](../harness/TOOL-DEMO.md)): workspace discovery, per-agent tool filtering, a successful read-only invocation, validators run by a planner with no shell, a Microsoft Learn call with the untrusted boundary applied, and denials of an unapproved host and a plain-http URL. These are transcript observations, not evidence records.
  - Found live and fixed: large results are saved to a temp file by the CLI before the hook runs, so reads of those files are now treated as untrusted. An independent review then found five more gaps (broad read-tool prefix, unvalidated `env`, server-name lookalikes, non-exact host match, no VS Code filter), all fixed with tests; a sixth finding was checked and was not a bug.
- No Azure resource was created or queried. Only local `az version` and `azd version` ran.

## Claimed, unverified
- VS Code chat behaviour for agents, hooks, MCP server start and trust prompts, and `server/tool` in agent `tools:` (TODO T8, T12). Whether the CLI kills a server at its `timeout`.
- Agent output quality and consistency: single runs. A write attempted inside a delegated subagent; native `agents` allow-list enforcement on its own (TODO T9, deferred).
- That the injection notice catches real attacks: it is a heuristic, tested on sample phrasings only.
- The candidate data contracts (placement, lineage, methodology, certificate) are test oracles, not decisions; D-013 and the evidence model remain open. No real specification exists, so the validators have checked only synthetic fixtures.
- The CLI's saved-output file naming is observed behaviour, not a documented contract.
- The example review was written by a model. No human has reviewed it.
- The gate checks structure and consistency, not truth (DESIGN-REVIEW-GATE section 3). The approval-status guard matches text and cannot authenticate a human (roadmap R4).
- Every standard and scheme name is a candidate. Placeholder NFR numbers are proposals.
- Commit `5f9ba58` and the evidence commit are not pushed; CI has not run on them (CI runs on Linux; the work was tested on Windows only).

## Next actions
1. Owner reviews the tool layer: [TOOL-REGISTRY](../harness/TOOL-REGISTRY.md), [MCP-SECURITY](../harness/MCP-SECURITY.md), [TOOL-DEMO](../harness/TOOL-DEMO.md); approves, amends or rejects ADR 0007 (T10).
2. Owner approves pushing the new commits; then check CI.
3. Owner decides whether and when to approve the Azure and GitHub MCP candidates, which includes sign-in approval and the subscription decision (T11).
4. Owner names the deciders (T3) and answers or defers the M1 decisions; then run the governance gate on sibling designs.
5. Finish R1 in VS Code and the VS Code tool checks (T12); run R11, R12.

## Open approvals
- ADR 0007, the tool layer (Proposed)
- Pushing the newest commits to GitHub
- Azure and GitHub sign-in, and any pending MCP candidate (none approved)
- ADR 0004 (Proposed; cannot be Accepted while RV-0001 is Blocked)
- All 37 decisions (Open, deferred)

## Blockers and risks
- Seventeen M1 decisions block any design from being Approved.
- No design can be Approved without a named human decider; none is named.
- Hooks are not loaded in untrusted folders, silently. Trust the folder first.
- The CLI's built-in GitHub MCP server stays on for sessions that are not specialist agents.
- The repository sits in a OneDrive-synced folder (Q1).
- The gate can be satisfied with vacuous reasons (RK-014); branch protection and an approver registry are roadmap R4.
