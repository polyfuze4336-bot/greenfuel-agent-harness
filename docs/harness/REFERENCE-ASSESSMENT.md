# Reference Assessment: astha29may/AICodingAgentHarness

Assessment date: 2026-10-28. Reference: <https://github.com/astha29may/AICodingAgentHarness>, branch `main`, snapshot `9531685` (last push 2026-10-23 per the GitHub API).

## 1. Method and limits

**What was done.** The repository was fetched as a zip archive through `gh api` into a temporary folder and read as text. Nothing from it was installed, imported, executed or copied into this repository. File lists, sizes and line numbers below come from that snapshot.

**Depth of inspection.**

| Depth | Files |
|---|---|
| Read in full or in the relevant parts | `README.md`, `AGENTS.md`, `.github/ui/server/index.mjs`, `.github/scripts/set-approval.py`, `.github/scripts/sync-memory.py` (first 130 lines), `.github/memory/{policy,schema}.yaml`, `.github/memory/repo/conventions.yaml`, `.github/memory/global.lock`, `.vscode/settings.json`, `.gitignore`, `requirements*.txt`, `pyproject.toml`, `.github/ui/package.json`, `benchmarks/baseline/metrics.json`, `gan-harness/*` state files, instruction files, `parallel-build-orchestrator.agent.md` (head) |
| Targeted search only (frontmatter, tool lists, risky calls) | all 13 `.agent.md` files, `verification-evaluator.agent.md`, `technical-architect.agent.md`, `problem-statement-creation.agent.md`, `.github/scripts/run-benchmarks.ps1`, `lock-baseline.ps1`, `.github/ui/server/harness.mjs`, three unit tests |
| Not inspected | `.github/ui/src/**` (React components), diagrams, `medium-agent-harness-article.md`, demo script, `memory-architecture.md`, `IMPLEMENTATIONPLAN.md` (47 KB), skill bodies, `benchmarks/tasks/*`, most of `benchmarks/scripts/*`, most of the 23 test files |
| Not done | Running tests, `npm audit`, `pip-audit`, any dynamic behaviour check |

Conclusions about runtime behaviour are therefore inferences from static reading unless stated otherwise. Anything not inspected is not assessed.

**Licence.** The repository has no `LICENSE` file (`gh api` reports `license: null`). Without a licence the code is all-rights-reserved by default, so this project does not copy files or text from it. "Reused" and "adapted" below refer to ideas. All implementation here is original.

## 2. What the reference is

A pipeline of Copilot custom agents (problem statement, architect, planner, orchestrator, four build lanes, observability, reviewer, evaluator, feedback), eight skills, path-scoped instructions, a file-based memory scheme, a Node/React dashboard, a PowerShell benchmark runner and Python helper scripts. 181 files, about 80 MB.

## 3. Findings

Severity: High, Medium, Low. Confidence: how sure the evidence makes me (High = directly observed in a file).

### 3.1 Security and integrity

| ID | Finding | Evidence | Severity | Confidence |
|---|---|---|---|---|
| S1 | **Unattended execution by design.** The benchmark runner launches `copilot` with `--allow-all-tools --no-ask-user` at four call sites. A unit test asserts that `--allow-all-tools` is present, so removing it fails the test. No sandbox, container or network restriction is applied. | `.github/scripts/run-benchmarks.ps1` lines 104, 151, 183, 481; `.github/tests/integration/test_runner_generation_seam.py` lines 111-113 | High | High |
| S2 | **Approval gate is self-approvable.** Gates for design and plan are the file `gan-harness/approvals.json`. `AGENTS.md` and `technical-architect.agent.md` tell the agent to record approval with `python .github/scripts/set-approval.py --stage <x> --approve`. The gated agent has terminal access, and `--by` is an unauthenticated free-text string. The gate is a convention, not a control. | `AGENTS.md` (Approval gate section); `technical-architect.agent.md:109`; `set-approval.py` lines 37 (`--by`), 52-53 (write) | High | High |
| S3 | **Dashboard has write endpoints with no authentication and no host binding.** `app.listen(PORT, ...)` has no host argument, so Node binds all interfaces. `POST /api/approve` writes the approval file; `POST /api/promote` writes into `AGENTS.md`, `.github/agents/*.agent.md`, skills and `conventions.yaml`. Browser CSRF is partly mitigated because only `application/json` bodies are parsed and no CORS headers are set (cross-origin requests need a preflight). Other LAN hosts, local processes and DNS rebinding are not mitigated. The path allow-list in `promotionTarget` is a good control. | `.github/ui/server/index.mjs` lines 15-18 (port), 112-132 (approve), 156-253 (promote), 288 (`listen`) | High | High (static) |
| S4 | **Memory/instruction poisoning path.** The `agent-feedback` agent reads session transcripts (untrusted input) and writes candidates to a ledger; the dashboard then promotes ledger text verbatim into agent specs and `AGENTS.md`, which are loaded into every later session. A human clicks promote, but the UI shows a short descriptor and the promoted body is not sanitised. Only secret redaction is mentioned in policy. | `index.mjs` `candidateBullet`/`appendMarkdownRule` (lines 156-189); `policy.yaml` header comment | Medium | Medium (UI display not inspected) |
| S5 | **Over-broad tool grants relying on prose for restraint.** Build, evaluator and reviewer agents all list `execute/runInTerminal`; `code-reviewer` and `verification-evaluator` also hold `web/fetch` or edit tools. The architect lists `azure-mcp/{cosmos,search,sql}` and `workiq/*` described as read-only "by instruction". Nothing enforces read-only. | `.github/agents/code-reviewer.agent.md:7`, `verification-evaluator.agent.md:8`, `technical-architect.agent.md:5,28` | Medium | High |
| S6 | **Runtime package install and unpinned dependencies.** Scripts run `pip install pyyaml` at runtime. `requirements.txt` uses `>=` ranges and includes `openpyxl`, which no `.py`, `.ps1`, `.mjs`, `.ts` or `.tsx` file references. Dev requirements are pinned. The dashboard pulls ~120 KB of lockfile (express, chokidar, vite, react, recharts) for a status view; no audit was run. | `lock-baseline.ps1:75-76`, `run-benchmarks.ps1:209-210`, `requirements.txt`, `.github/ui/package.json` | Medium | High |
| S7 | **Confidential M365 data flows into agent context.** `problem-statement-creation` uses WorkIQ to read emails, meetings, Teams and SharePoint. The spec says treat as untrusted and read-only (good), but nothing limits scope, retention or where the summary is written (`output/`). For a client-confidential marine-fuels engagement this needs an explicit data-handling decision. | `problem-statement-creation.agent.md:8,17-23` | Medium | High |
| S8 | **No secret scanning, no CI, no hooks.** No `.github/workflows`, no pre-commit or hook files in the tree listing. `.coverage` (53 KB binary) and two `*.tsbuildinfo` files are committed. | tree listing | Low-Medium | High |

### 3.2 Technical weaknesses

| ID | Finding | Evidence | Confidence |
|---|---|---|---|
| T1 | **Tool names are Local-harness names.** Agents use `execute/runInTerminal`, `agent/runSubagent`, `session_store_sql`, `azure-mcp/*`, `workiq/*`. VS Code documents that `agent/runSubagent` is not portable to the Copilot harness (which uses `task`) and that tool lists need re-checking per harness. `AGENTS.md` makes `runSubagent` mandatory. The harness has two runtimes in VS Code 1.143; this design targets one. | `parallel-build-orchestrator.agent.md:7`; `AGENTS.md` execution policy; VS Code custom-agent reference | High |
| T2 | **Orchestrator lists itself as a subagent.** `agents: ['parallel-build-orchestrator', ...]`, and workspace settings enable `chat.subagents.allowInvocationsFromSubagents`. VS Code documents that this setting plus a self-listed agent permits recursion. No depth limit is stated. | `parallel-build-orchestrator.agent.md:11`; `.vscode/settings.json` | High |
| T3 | **Self-reported activity telemetry.** Agents are told to call `agent-activity.py start/end` around dispatches. The committed log has one `start` and two `end` events. The signal is only as reliable as the model's compliance. | `AGENTS.md`; `gan-harness/agent-activity.jsonl` | High |
| T4 | **Memory promotion rules are documented, not enforced.** `schema.yaml` requires at least two independent sources and `ab_replay: pass` before `approved`. A search of scripts and server code finds `ab_replay` nowhere outside the schema. The one committed approved record has `occurrences: 1`. `global.lock` has an empty `sha`, so the global tier is unpinned. | `schema.yaml`; `conventions.yaml`; `global.lock` | High |
| T5 | **Memory machinery duplicates native features.** VS Code now provides user, repository and session memory, and a committed instructions file is already the documented route for shared knowledge. The reference builds a parallel store, scorer and materialiser (`sync-memory.py`, ~10 KB) that regenerates `*.instructions.md`. | `sync-memory.py`; VS Code memory docs | Medium |
| T6 | **Output contract conflicts with evidence reporting.** `output-contract.instructions.md` demands "ONLY the code or unified diff, no summaries" for build agents, while the evaluator needs the generator's account of what was run and verified. | `output-contract.instructions.md` | Medium |
| T7 | **Evaluator is an LLM scoring a rubric.** Pass is a weighted 0-10 score at 7.0. The test-integrity check (tests weakened or deleted) is an instruction to the same model family that holds edit and terminal tools, not a diff-based gate. Generator and evaluator share a runtime and session tooling. | `verification-evaluator.agent.md:8,26,36` | Medium |
| T8 | **Documentation and links drift.** README links `.github/agents/problem-statement-creation.md`; the file is `problem-statement-creation.agent.md`. `README.md` is 456 lines and repeats AGENTS.md content; harness docs live under `.github/docs/`, mixed with tooling. | tree listing; README | High |
| T9 | **Tests mostly check that specs contain strings.** Inspected tests (`test_agents_have_capture_step`, `test_output_contract`) assert text presence in instruction files. That guards drift but does not show agents behave as specified. Other tests cover the Python scripts. None were run. | `.github/tests/unit/*` (2 of 23 read) | Medium (small sample) |

### 3.3 Claims not backed by artefacts in the repository

| Claim (README/docs) | Observed |
|---|---|
| Benchmark suite with a locked baseline | `benchmarks/baseline/metrics.json` has `locked_at: null`, `suite_score: null`, and every metric in the file is `null` |
| Efficiency trend per build | `gan-harness/efficiency-log.csv` contains only the header row |
| Self-learning feedback ledger | `gan-harness/feedback/ledger.jsonl` is 0 bytes |
| Global memory tier | `global.lock` `sha: ""` |

This is not evidence the system does not work; it is evidence that the repository contains no record of it working.

### 3.4 Missing controls (relative to this programme's principles)

| Principle | Gap in reference |
|---|---|
| Secure by default | Allow-all runner (S1); no secret scanning or CI (S8) |
| Human approval for high-impact actions | Approval is writable by the gated agent (S2); no deny list for Azure/deploy commands; "no deployments" is prose |
| Separation of harness and business agents | Output folders `src/`, `infra/` are documented "landing zones" for the product, in the same repo and agent set; no phase gate |
| Evidence-based validation | LLM score (T7); self-reported telemetry (T3); no captured command results |
| Persistent, resumable execution | File-based state exists, but promotion is unenforced (T4); no single resume point |
| No fabricated Azure state | No rule or check against invented resources; Azure MCP tools granted to the architect |
| Minimal dependencies | Dashboard, Python and PowerShell runtimes, Node, `pip`, `npm` all required |

## 4. Reusable patterns

| ID | Pattern | Why it is worth keeping |
|---|---|---|
| P1 | Role-specialised custom agents with explicit file ownership and a contract-first rule for parallel work | Reduces merge conflicts; sound when lanes exist. Deferred until the product has lanes |
| P2 | Path-scoped instructions via `applyTo` | Native, cheap, keeps context small |
| P3 | Skills for repeatable workflows | Native; progressive loading |
| P4 | Generator/evaluator separation with a test-integrity check | Right idea; needs a mechanical implementation (see Section 6) |
| P5 | Bounded iteration (max iterations, plateau and regression stop) | Prevents infinite loops; applicable to any agent loop |
| P6 | Fact-only problem statement with `TODO` templates | Keeps requirements separate from design |
| P7 | Allow-list of promotion destinations with path-escape check (`promotionTarget`) | A correct pattern for any write API |
| P8 | Treat tool and retrieved content as untrusted input; read-only discovery wording | Correct stance, needs enforcement |
| P9 | Memory records with scope, TTL, privacy classification and conflict keys | Good vocabulary for a later memory design |
| P10 | Benchmark tasks with fixtures to measure the harness itself | Good practice; none recorded results exist yet |

## 5. Component disposition register

Legend. **Reused**: idea kept, original implementation. **Adapted**: idea changed to address a finding. **Rejected**: not carried over. **Deferred**: sound but not needed in Phase 0 (roadmap item shown). **New**: no counterpart in the reference. No file or text is copied from the reference.

| Reference component | Disposition | Here | Reason |
|---|---|---|---|
| Root `AGENTS.md` operating manual | Adapted | [AGENTS.md](../../AGENTS.md) | Shorter; no Local-only tool names; no self-reported telemetry; adds phase and boundary rules |
| 13 pipeline agents | Adapted | `principal-architect`, `qa-engineer` (and, later, the other specialists in [AGENT-ROSTER](../agents/AGENT-ROSTER.md)) | Explicit minimal tools per agent. Native Plan agent covers planning. Lane agents superseded by the roster |
| `parallel-build-orchestrator` and lanes | Deferred | R8 | Needs a product and contracts first; self-listing (T2) and portability (T1) must be fixed |
| `problem-statement-creation` + WorkIQ | Deferred | R9, Q7 | Data handling decision needed (S7) |
| `technical-architect` | Adapted | `principal-architect` | Drops Azure MCP data tools and WorkIQ; ADR-centric |
| `verification-evaluator` / `code-reviewer` | Adapted | `qa-engineer` + recorder | Verdict from recorded observations, not a score (T7) |
| `agent-feedback` retrospective and ledger | Deferred | R7 | Needs injection-safe, human-gated design (S4) |
| Skills: `implementation-planning`, `parallel-build`, `observability`, `tdd-workflow`, `code-review`, `verification-loop`, `search-first`, `anti-patterns` | Deferred | R8 | Not needed until implementation |
| Skill: `documentation-governance` | Rejected | none | Role definition mixed into `AGENTS.md`; docs conventions are an instruction file here |
| New skills | New | `adr-authoring`, `session-handoff`, `evidence-validation` | Directly serve the pillars |
| Instructions: architecture, build-lane, coding-style | Deferred | R8 | Implementation-phase content |
| Instruction: `output-contract` | Rejected | none | Conflicts with evidence reporting (T6) |
| Path-scoped instruction pattern | Reused | `docs.instructions.md`, `azure-iac.instructions.md` | P2 |
| Memory store, scorer, `sync-memory.py`, `global.lock` | Rejected | `docs/state/STATE.md`, ADRs, native memory | Duplicates native features, unenforced rules (T4, T5) |
| Memory record vocabulary (scope, TTL, privacy) | Reused (idea) | R6 | P9 |
| `approvals.json` + `set-approval.py` + dashboard approve | Rejected | ADR status + hook control-plane rule | Self-approvable (S2) |
| `agent-activity.py` | Rejected | none | Self-reported (T3) |
| Dashboard (`.github/ui`) | Rejected | none | S3, S6; no requirement for a UI yet |
| `run-benchmarks.ps1`, `lock-baseline.ps1` | Rejected | none | S1, S6 |
| Benchmark task definitions and scoring ideas | Deferred | R5 | P10; to be re-built as harness evals with no allow-all |
| Templates (problem, design, plan) | Deferred | R4 | Will be re-derived from ADR needs |
| `copilotscripts/` scratch folder | Rejected | none | Not needed |
| Harness docs inside `.github/docs/` | Rejected | `docs/` | Keep tooling and documentation apart |
| Bounded-iteration rule | Reused (idea) | R8 | P5 |
| Hooks | New | `.github/hooks/policy.json`, `harness/hooks/policy-guard.cjs` | Enforces S2/S5 prohibitions |
| Phase gate | New | `harness/policy/command-policy.json` | Principle: no app yet |
| Evidence recorder | New | `harness/scripts/record-evidence.mjs` | Principle: evidence not assertion |
| Repository validator | New | `harness/scripts/validate-harness.mjs` | Structural correctness |
| CI workflow with pinned actions | New | `.github/workflows/validate.yml` | Independent re-run outside the agent session |

## 6. Conclusions

1. The reference is a well-organised teaching harness with a useful role vocabulary. Its controls are mostly prose.
2. Three properties make it unsuitable as a base for a confidential, regulated programme: unattended execution by design (S1), a self-approvable gate (S2) and an unauthenticated write API (S3).
3. Most of what it builds in custom code now has a native Copilot equivalent (agents, instructions, skills, memory, approvals, subagents, hooks).
4. Its strongest transferable ideas are role separation, scoped instructions, bounded iteration, and measuring the harness itself. They are carried forward as roadmap items rather than code.
