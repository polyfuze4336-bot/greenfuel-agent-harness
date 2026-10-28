# STATE

Resume point. Update with the `session-handoff` skill. Facts only; unverified items are labelled.

## Current phase and objective
Phase 0. Baseline v0.1 is **approved** (ADR 0003); the 37 decisions stay open, deferred by the owner. The architecture-governance capability is **approved as a process** (ADR 0005); [DES-0001](../architecture/designs/DES-0001-delivery-measurement-storage-topology.md) is computed **Blocked** and is not approved. The twelve specialist agents are **approved** ([ADR 0006](../adr/0006-specialist-agent-roster-and-enforcement.md)), the tool layer is **approved** ([ADR 0007](../adr/0007-tool-layer-mcp-and-output-controls.md)) and the **least-privilege permission model is approved** ([ADR 0008](../adr/0008-least-privilege-permission-model.md), Accepted 2026-10-28, including the working approval limits): policy-as-code, a decision engine called by the hooks, signed approvals, a hash-chained denied-action log, Azure identity and GitHub protection specifications (not applied), a validator and negative tests. Its follow-ups T13 to T17 are deferred by the owner. This stage added the **task-execution framework** ([ADR 0009](../adr/0009-task-execution-framework.md), **Accepted** 2026-10-28): a deterministic engine, a delegation hook driving native `task` delegation, a human-run CLI, two read-only MCP tools, a durable hash-chained run store and a live demonstration ([DEMO-EVIDENCE-STORE](../orchestration/DEMO-EVIDENCE-STORE.md)). The demonstration run `RUN-afb2a0466e` was closed by the owner with the critic's REWORK as the outcome. Persistent memory is **approved** ([ADR 0010](../adr/0010-persistent-memory.md), Accepted 2026-10-28, working values confirmed, T23 decided: interim procedure, signed approvals after T13). Stage 9 built a bounded Plan, Execute, Verify, Critique, Repair loop ([ADR 0011](../adr/0011-bounded-repair-loop.md), **Accepted** 2026-10-28; see [LOOP-VALIDATION-REPORT](../loop/LOOP-VALIDATION-REPORT.md)). No application code and no Azure resources exist; no Azure or GitHub sign-in was used by any agent.

## Done (with evidence)
- Owner decisions 2026-10-28: ADR 0001 and 0002 accepted; baseline approved; governance capability approved; specialist roster approved (ADR 0006); M1 decisions, decider naming (T3) and the T9 agent checks deferred. All earlier commits are pushed; CI succeeded on `2f52908` (`EV-0006` and earlier CI: `EV-0003`).
- Stage 0 evidence: `EV-0001`, `EV-0002`. Baseline evidence: `EV-0004`, `EV-0005`. Governance evidence: `EV-0007` to `EV-0011`. Specialist agent evidence: `EV-0014` to `EV-0016`; `EV-0012` and `EV-0013` record a recorder failure (npm could not be launched on Windows) and are kept because evidence is append-only.
- Governance built and demonstrated on DES-0001, which the gate computes as Blocked; ADR 0004 stays Proposed. Two independent model reviews of the governance work and one of the agent guard found real gaps, all fixed or recorded. Those reviews are not evidence records.
- **Tool layer (commits `5f9ba58` to `dec6404`, pushed, CI green):**
  - Registry of 47 tools in 8 categories with a validator and generated tables ([TOOL-REGISTRY](../harness/TOOL-REGISTRY.md)). Enabled MCP tools are read-only by rule; a disabled tool must be reachable by no agent.
  - Enabled servers: `greenfuel-tools` (local, zero dependencies, 13 read-only tools) and `microsoft-learn` (remote, `azure-platform` only). `.mcp.json` and `.vscode/mcp.json` agree with the registry.
  - **Not configured, not installed, not authenticated:** Azure MCP (pinned to 3.0.0 with its integrity hash, reviewed from the downloaded tarball) and GitHub MCP ([MCP-SECURITY](../harness/MCP-SECURITY.md)).
  - `tool-output-guard.cjs` (native `postToolUse`): secret redaction, hidden-character stripping, size cap, untrusted boundary, metadata-only audit log. `agent-guard.cjs` and `policy-guard.cjs` extended (exact MCP names, per-agent grants, exact read-tool names, exact web hosts, unlisted tools refused in any session).
  - Nine validators over specifications, candidate contracts (`v0-candidate`) and synthetic fixtures. With no specifications they say EMPTY. `validate-deployment-readiness` says NOT-READY: `EV-0020`.
  - `npm test`: 230 tests pass, `EV-0017`. `npm run validate` clean, `EV-0018`. Tool registry and configuration clean, `EV-0019`. Agents match policy and installed VS Code 1.143.0 and Copilot CLI 1.0.105 match the tested versions, `EV-0021`.
  - Live in Copilot CLI 1.0.105 ([TOOL-DEMO](../harness/TOOL-DEMO.md)): workspace discovery, per-agent tool filtering, a successful read-only invocation, validators run by a planner with no shell, a Microsoft Learn call with the untrusted boundary applied, and denials of an unapproved host and a plain-http URL. These are transcript observations, not evidence records.
  - Found live and fixed: large results are saved to a temp file by the CLI before the hook runs, so reads of those files are now treated as untrusted. An independent review then found five more gaps (broad read-tool prefix, unvalidated `env`, server-name lookalikes, non-exact host match, no VS Code filter), all fixed with tests; a sixth finding was checked and was not a bug.
- No Azure resource was created or queried by the harness. Only local `az version` and `azd version` ran, plus one `az account show` check that the machine is signed in (which is why live tests pointed Azure CLI at an empty configuration).
- **Permission model (commits `e4a935e`, `eff5bc7`, pushed):**
  - [PERMISSION-MODEL](../security/PERMISSION-MODEL.md) (generated tables), [APPROVAL-WORKFLOWS](../security/APPROVAL-WORKFLOWS.md), [BREAK-GLASS](../security/BREAK-GLASS.md), [SECRETS-HANDLING](../security/SECRETS-HANDLING.md), [DENIED-ACTION-AUDIT](../security/DENIED-ACTION-AUDIT.md), [NEGATIVE-TESTS](../security/NEGATIVE-TESTS.md) and [ENFORCEMENT-STATUS](../security/ENFORCEMENT-STATUS.md), which says what is enforced and what depends on a human.
  - Evidence at this commit: `npm test` 289 pass (`EV-0022`), `npm run validate` clean (`EV-0023`), `validate-permissions` OK (`EV-0024`), negative tests pass (`EV-0025`), GitHub protection check reports UNAVAILABLE with HTTP 403 (`EV-0026`).
  - Live in Copilot CLI 1.0.105 with Azure CLI pointed at an empty configuration: Azure deletion, `azd up`, another shipowner's fixture, a simulated secret and `az account get-access-token` were denied; the search result was filtered; delegation to a built-in agent was denied. Two attempts to make a delegate try a destructive command were declined by the models themselves, so no hook denial exists for a delegated delete.
  - An independent review found three real bypasses (run-time-built commands, direct ARM REST, run-time-built paths in a scoped session); fixed with regression tests. Two limits were documented, not fixed. That review is not an evidence record.
  - **Not enforced:** GitHub branch protection (HTTP 403 on this plan), Azure RBAC and locks (nothing created), operating-system isolation. The approver registry is empty, so no P2+ operation by an agent can succeed.

- **Task-execution framework (commits `3d88241`, `709c941`, pushed; ADR 0009 Accepted):**
  - [ORCHESTRATION](../orchestration/ORCHESTRATION.md), [TASK-CONTRACT](../orchestration/TASK-CONTRACT.md), the engine [engine.cjs](../../harness/orchestration/engine.cjs), policy [orchestration-policy.json](../../harness/policy/orchestration-policy.json), hook [delegation-guard.cjs](../../harness/hooks/delegation-guard.cjs), CLI [tasks.mjs](../../harness/scripts/tasks.mjs), validator `validate-orchestration`, MCP tools `check_plan` and `get_run_status` (orchestrator only; the orchestrator remains read-only).
  - Evidence at the committed HEAD: `npm test` 445 pass (`EV-0027`), `npm run validate` clean (`EV-0028`), `validate-orchestration` OK (`EV-0029`), live run verifies (`EV-0030`).
  - Live demonstration in Copilot CLI 1.0.105, run `RUN-afb2a0466e`: the orchestrator drafted the plan and validated it with `check_plan`; the hook enforced and recorded native delegation to principal-architect, security-reviewer and architecture-critic; the critic returned REWORK twice; the run ended NEEDS_HUMAN and the owner then closed it (45 events, 10 checkpoints, chain verified). The sample proposal is an unapproved model-written draft.
  - Defects found and fixed: four by the live run, and four by an independent model review (not an evidence record). Each has regression tests.
  - **Not exercised live:** the retry path, error classes, lease expiry, task approvals (the approver registry is empty) and VS Code. Tests cover the first four only.

- **Persistent memory (commits `17fda31`, `58129a2`; ADR 0010 Accepted):**
  - [MEMORY-MODEL](../memory/MEMORY-MODEL.md), [MEMORY-GOVERNANCE](../memory/MEMORY-GOVERNANCE.md), the store [store.cjs](../../harness/memory/store.cjs), policy [memory-policy.json](../../harness/policy/memory-policy.json), CLI [memory.mjs](../../harness/scripts/memory.mjs), validator `validate-memory`, MCP tools `memory_search` (orchestrator, principal architect, architecture critic) and `memory_resume` (orchestrator), and the data in [memory/](../../memory/README.md): 10 decisions imported from the ADRs (8 approved; ADR 0004 and ADR 0010 are proposals), the 12 hard constraints as pinned constraints, and 7 lessons from this project's real incidents written as an agent with unreviewed trust.
  - Git-versioned JSON, a hash-chained ledger anchored against Git history, a generated architecture snapshot, an in-memory keyword index. No SQLite and no vector database (justified in the model, with revisit conditions).
  - Tested: the seven requested scenarios, tamper, deletion and rollback detection, quarantine, review, expiry, invalidation, import and drift, compact summaries, a validator mutation matrix, the read-only tools, the control-plane denial for every agent, and the CLI's write rules. Evidence at commit `17fda31`: `npm test` 514 pass (`EV-0031`), `npm run validate` clean (`EV-0032`), the two memory test files pass (`EV-0033`), `validate-memory` OK (`EV-0034`). All ran on Windows with `CI=true`; CI itself has not run on this commit.
  - An independent model review found eight issues; six were fixed with regression tests, one task-list filter was corrected, and two limits are stated in the governance document (the `human` writer type is self-declared; task-state edits are not detected). That review is not an evidence record.
  - **Not done:** a VS Code restart was not performed. Resume was shown in a new process from files only. Retrieval quality was not measured (no recall figures exist). The memory tools were not exercised live in VS Code chat or Copilot CLI.

- **Repair loop (commits `a323bb9`, `0fc216a`, `22cd764`; ADR 0011 Accepted 2026-10-28):**
  - [LOOP](../loop/LOOP.md), [LOOP-VALIDATION-REPORT](../loop/LOOP-VALIDATION-REPORT.md), the engine [loop.cjs](../../harness/loop/loop.cjs), policy [loop-policy.json](../../harness/policy/loop-policy.json), human-run CLI [loop.mjs](../../harness/scripts/loop.mjs), validator `validate-loop` (in `npm run validate` and CI), fixtures under [tests/fixtures/loop](../../tests/fixtures/loop), and four recorded live loops in [docs/state/loops](loops): `LOOP-ff64d5605a` (TypeScript build error repaired and verified, PASSED), `LOOP-58fa845034` (sovereignty violation, STOPPED as a hard-constraint violation), `LOOP-6b343aa07f` (identical failure, ESCALATED), `LOOP-e1fb99c938` (cross-shipowner read, STOPPED).
  - Limits are the owner's: 3 repair attempts, 2 identical failures. Timeouts, budgets, size caps and the lease are working values.
  - An independent model review found four reproduced defects and a budget floor; all fixed with regression tests (not an evidence record). One limit is not fixable here: code under test can subvert the runner it is loaded into (roadmap R15).
  - Evidence at commit `a323bb9`: `npm test` 576 pass with the toolchain installed (`EV-0035`), `npm run validate` clean (`EV-0036`), the loop and validator tests 62 pass (`EV-0037`), `validate-loop` OK (`EV-0038`). Without the toolchain the TypeScript test is skipped (checked separately, 1 skipped, 0 failed). CI has not run on this commit.
  - **Not done:** no model-driven or agent-driven repair (Phase 0; begin, end and review are human-run; `qa-engineer` may now run `verify`, `status` and `verify-store`, tested with the hook only), no sandbox, no VS Code or Azure use, CI skips the TypeScript scenario (toolchain not installed there). A pinned TypeScript 5.9.3 was installed outside the manifest with `--ignore-scripts` (T25).

## Claimed, unverified
- VS Code chat behaviour for agents, hooks, MCP server start and trust prompts, and `server/tool` in agent `tools:` (TODO T8, T12). Whether the CLI kills a server at its `timeout`.
- Agent output quality and consistency: single runs. A write attempted inside a delegated subagent; native `agents` allow-list enforcement on its own (TODO T9, deferred).
- That the injection notice catches real attacks: it is a heuristic, tested on sample phrasings only.
- The candidate data contracts (placement, lineage, methodology, certificate) are test oracles, not decisions; D-013 and the evidence model remain open. No real specification exists, so the validators have checked only synthetic fixtures.
- The CLI's saved-output file naming is observed behaviour, not a documented contract.
- The example review was written by a model. No human has reviewed it.
- The gate checks structure and consistency, not truth (DESIGN-REVIEW-GATE section 3). The approval-status guard matches text and cannot authenticate a human (roadmap R4).
- Every standard and scheme name is a candidate. Placeholder NFR numbers are proposals.
- Commits `e4a935e` and `eff5bc7` were pushed and CI succeeded on `3a3fcdf`. The task-execution commits were pushed; CI failed twice on Linux for two portability bugs (a mixed line-ending hash check and a test that assumed `CI` was unset), both fixed, and **CI succeeded on `1990aae`**. Memory and the owner decisions on it were pushed and **CI succeeded on `a8f76a3`**, so the file-hash and Git-comparison logic has now run on Linux. The loop has not been through CI.
- Memory: retrieval weights, expiry periods, size limits and the interruption window are working values, not measured. The sensitive-data and injection scans are heuristics. Authority rests on ADR files, and the `human` writer type is declared by the caller.
- The framework proves structure and provenance, not truth. Model-written content (the sample proposal, the reviews) is unverified. Undeclared writes by an agent inside its write scope are not detected. Hooks for `task` were observed by the assistant only in Copilot CLI; the owner reports VS Code chat was verified (T18), which is recorded but not independently observed.
- The permission screen is regular-expression based; new evasions are possible. The default session is screened, not sandboxed.
- Approval limits (lifetimes, uses, approver counts) are proposals.

## Next actions
1. Owner follows up on T13 (approvers and limits), T14 (branch protection), T15 (OS isolation), T16 (break-glass contacts, audit retention), T17 (Azure identities after D-037): all deferred.
2. Owner decides whether and when to approve the Azure and GitHub MCP candidates (T11).
3. Owner names the deciders (T3) and answers or defers the M1 decisions; then run the governance gate on sibling designs.
4. Finish R1 in VS Code and the VS Code tool checks (T12, T18); run R11, R12.
5. Done: the demonstration run was closed (T19) and the framework limits confirmed (T20).
6. T23 stays open until T13: then implement signed approvals for memory (roadmap R14).
7. Done: ADR 0011 accepted, working values and toolchain acknowledged (T25), and qa-engineer allowed to run loop status, erify and erify-store (T24). Open: whether CI should install the TypeScript toolchain.

## Open approvals
- none for memory (ADR 0010 Accepted)
- ADR 0011 (repair loop; Proposed)
- Pushing the loop commits
- Azure and GitHub sign-in, and any pending MCP candidate (none approved)
- ADR 0004 (Proposed; cannot be Accepted while RV-0001 is Blocked)
- All 37 decisions (Open, deferred)

## Blockers and risks
- Seventeen M1 decisions block any design from being Approved.
- No design can be Approved without a named human decider; none is named.
- Hooks are not loaded in untrusted folders, silently. Trust the folder first.
- The CLI's built-in GitHub MCP server stays on for sessions that are not specialist agents.
- No agent has any P2+ ability until approvers are registered (T13). GitHub branch protection cannot be applied on this plan (T14).
- Agents run as the developer's OS user; hooks are a screen, not a sandbox (T15).
- The repository sits in a OneDrive-synced folder (Q1).
- The gate can be satisfied with vacuous reasons (RK-014); branch protection and an approver registry are roadmap R4.
