# Forensic audit of the greenfuel-agent-harness

Independent audit against the FY27 Azure Master Architect Capstone Assessment Guide (rubric file `AMA_Capstone_Rubric_Participants.pdf`, read in full: 20 criteria, 100 points, four sections, floors and outcome bands). **No official score is assigned anywhere in this audit.** Companion documents: [RUBRIC-TRACEABILITY](RUBRIC-TRACEABILITY.md), [CRITICAL-GAPS](CRITICAL-GAPS.md), [PRIORITIZED-BACKLOG](PRIORITIZED-BACKLOG.md), [EVIDENCE-REGISTER](EVIDENCE-REGISTER.md), [CAPSTONE-READINESS](CAPSTONE-READINESS.md).

- **Audited commit:** `c6ff681` (latest `main`), on working branch `capstone/rubric-enhancement`. Date 2026-10-29.
- **Method:** read the source, tests, workflows, agent files, hooks, MCP configuration, ADRs, acceptance reports and evidence; ran every validator and the full test suite; ran new simulated attacks against the real hook scripts; compared the results with what the README, the acceptance report and STATE claim.
- **Not done, by instruction:** no application was built, nothing was deleted or rewritten, no Azure or GitHub setting was changed, nothing was pushed.
- **Not examined:** VS Code chat behaviour (this session runs in Copilot CLI, and the repository's agents do not load here); a real Azure subscription; anything that needs a human panel.

## 1. Baseline facts (all re-observed in this audit)

| Fact | Observed value | How observed |
|---|---|---|
| Tracked files | 552 (322 under `docs/`, 77 under `tests/`, 49 under `harness/`, 17 under `infra/`) | `git ls-files` |
| Application code (`src/`) | **none** | folder does not exist |
| Custom harness code | about 8,000 non-empty lines in 36 files (`.cjs` hooks and engines about 4,000; `.mjs` scripts about 3,550) | line count |
| Test code | about 5,600 lines in 33 test files, 425 top-level `test()` declarations, **770 reported results** | line count; TAP output |
| Markdown | 150 files, about 157,000 words | word count |
| Solution-specific code | `harness/contracts/ingestion-contract.mjs` (247 lines), candidate validators in `spec-validators.mjs`, a non-deployable Bicep scaffold (8 modules, 467 lines), synthetic fixtures | read |
| ADRs | 15 plus template; 13 Accepted (all about the harness or a scaffold exception), **2 Proposed (the two solution-architecture ADRs, 0004 and 0015)** | read |
| Requirements | 99 (BR 9, FR 33, NFR 21, SEC 15, DATA 10, AGT 11), 80 Must | counted |
| Baseline decisions | 37, **all Open** (kinds: stakeholder fact 21, fact plus verification 6, verification 1, architecture 7, mixed 2) | counted |
| Duration of the build | 53 commits over 2 days (2026-10-28 to 2026-10-29) | `git log` |
| Validators | `validate-harness`, `-permissions`, `-orchestration`, `-memory`, `-loop`, `-evaluation`, `-azure` (with `--bicep`), `-agents --versions`, `-tools`, `evaluate verify`, `audit-denials verify`: **all pass**; `deployment-readiness` reports **NOT-READY** (correct) | run now |
| Full test suite | **770 of 770 pass, 0 skipped**, twice, in a clean clone outside OneDrive (319 s and 249 s). Earlier in-place runs took 359 s to 806 s | TAP output saved and summarised in the evidence register |
| CI | green on `c6ff681` (validate and evaluation re-run) | `gh run list` |
| Versions | VS Code 1.143.0 and Copilot CLI 1.0.105, matching the tested versions | `validate-agents --versions` |
| Evaluation run | `EVRUN-9b6110b026`: 53 PASS, 3 FAIL, 1 BLOCKED, 16 PENDING; gates G1 PASS, G2 and G3 FAIL, G4 to G7 BLOCKED | `evaluate verify` re-derives it |
| Repository | public, MIT, description set, **no topics, no release, secret scanning and push protection disabled, branch protection not applied** | `gh` read-only |

## 2. The twelve critical questions

### 2.1 Are the 12 specialist agents usable inside VS Code?
**Format-valid and CLI-demonstrated; VS Code usability is not shown by any recorded evidence.**
- All twelve `.agent.md` files pass `validate-agents`, which checks them against a policy built from the VS Code and GitHub documentation (allowed front-matter keys, tool names, `agents` allow-list, one `preToolUse` hook each, no forbidden keys). Each file is 380 to 980 words.
- Native delegation was shown once, in Copilot CLI (run `RUN-afb2a0466e`, orchestrator to principal-architect, security-reviewer, architecture-critic).
- VS Code chat behaviour is recorded as **owner-reported** (TODO T18), not observed by the assistant and not an evidence record. Agent-scoped hooks inside VS Code chat, a write attempted inside a delegated subagent, MCP trust prompts, context loading (R11) and the review roles (R12) are all unverified (T8, T9, T12).
- The current VS Code documentation labels hooks **Preview** and says local `chat.useHooks` does not stop the shared runtime loading a configuration. Hooks only load in a trusted folder, and nothing warns when they do not.
- In this session the agents did not load at all, because the session's working folder is the folder above the repository. The panel demo must therefore be run from the repository root.

### 2.2 Are agent permissions technically enforced or merely documented?
**Enforced in code for named agents, partly enforced for the default session, and not enforced at all at the operating-system, GitHub and Azure layers.**
- The negative permission tests pass, and 53 of the 57 simulated probes that a reviewer would expect to be stopped are stopped for a named agent with a shell (`qa-engineer`). The four that are not are reads of home-folder credential stores through the `view` tool (see 2.3).
- The default session is deliberately weaker: tier ceilings and deny-unknown apply only to named agents (`permissions.json`, `unscopedSession`, and `CTL-01` only fires when `mode === 'agent'`).
- Not enforced: agents and test code run as the user's operating-system account (no sandbox, TODO T15); GitHub branch protection and CODEOWNERS review are not in effect (EV-0060: NOT-PROTECTED; now possible because the repository is public); no Azure identity, role or lock exists; the approver registry is empty, so no signed approval has ever been verified outside tests.

### 2.3 Can the command-policy hook be bypassed?
**Yes. Simulated, harmless probes found candidate gaps (EV-0062, EV-0063, EV-0064; script and raw output in `docs/capstone/probes/`).**

| Probe class | Default session | Named agent with shell or `view` |
|---|---|---|
| More than 20 forms of `az group delete`, `azd up/down`, ARM REST `DELETE`, `Remove-AzResourceGroup`, encoded, concatenated, aliased, wrapped in `cmd`, `pwsh`, `bash`, `wsl`, `python`, `node` | stopped | stopped (no shell, or stopped) |
| `az` written with a PowerShell backtick escape (``a`z group delete``) | **allowed** | stopped |
| `echo <base64> \| base64 -d \| sh` | **allowed** | stopped |
| Read `%USERPROFILE%\.azure\msal_token_cache.json`, `.config\gh\hosts.yml`, `.kube\config` by shell or by the `view` tool | **allowed** | **allowed through the `view` tool** (the secret-path class covers `.env`, key files, `.git-credentials`, `.npmrc`, not the cloud and GitHub credential stores) |
| `gh auth token` (credential extraction; only `az account get-access-token` is denied) | **allowed** | stopped (not on the shell allow-list) |
| Edit `.vscode/settings.json`, `package.json`, `memory/decisions/*`, `.github/agents/*.agent.md`, create `.git/hooks/*` | **allowed, not even a prompt** | stopped (`CTL-01`) |
| Edit `.github/hooks/*`, `harness/hooks/*`, `harness/policy/*`, `.github/workflows/*`, approver registry | prompt (`ask`) | stopped |
| `git push --force`, `git push origin HEAD:main`, `gh repo delete`, `gh api -X DELETE`, env dump | prompt or stopped | stopped |

Two of the "misses" for `azure-platform` are errors in the probe's expectation (that agent has no shell, so denying `git status` is correct) and are not counted as gaps. The structural limits stand regardless of any single pattern: the screen is regular-expression based (ENFORCEMENT-STATUS says so), and a hook that is not loaded enforces nothing.

### 2.4 Does the execution engine really resume interrupted work?
**It resumes state. It does not resume work.**
- Real and tested: a crash between writing `run.json` and appending events is repaired on load; a fresh context continues where the last stopped; an expired delegate lease is swept as INTERRUPTED and can be retried; a stale lock from a crashed process does not block; a memory task resumes with its checkpoint and warnings; an interrupted loop attempt is re-screened and re-verified in a new process.
- `tasks.mjs resume` verifies the hash chain, sweeps leases, writes a checkpoint and **prints what to do next**. A person, CI or a model session then performs it. Nothing re-launches an agent.
- Shown live once (CLI). The retry path, lease expiry, error classes and task approvals were exercised only by tests. Not exercised in VS Code.

### 2.5 Can a model falsify its own evidence or approval state?
**Approvals: no, but only because none exist. Evidence: partly yes.**
- Approvals need a signature from a private key held outside the repository; the registry is empty, so every P2-and-above action is denied. That is safe, and it also means signed approval has never been used for real (TODO T13).
- Named agents cannot write `docs/evidence/records/` (denied, probe-confirmed). But `record-evidence.mjs` stores `--claim` as free text that is **never checked against the command**; a record is an independent JSON file with an output hash of only the last 2,000 bytes; records are not signed or chained; a deleted or edited record is detected only through Git history. `validate-harness` does not re-verify records.
- Memory writers are self-declared (`--as human:name`); the interim control is that the owner reads the diff (T23, roadmap R14).
- "Independent" design and security reviews were made by other language models. Not a human review, and the reviews are not evidence records.

### 2.6 Are the 99 requirements mapped to executable acceptance tests?
**No product acceptance tests exist, because no product exists.**
- Generated coverage: 29 requirements (28 Must) are "tested and passing", 9 have a failing test, 2 a blocked test, 12 only a pending production-agent test, 12 are designed only, 35 specified only.
- "Tested and passing" means a **harness or candidate-contract test on synthetic fixtures** passed. For example FR-008, FR-009 and FR-011 (emissions) rest on EVAL-PRC-DAT-004, a methodology fixture check, plus a deliberately simple arithmetic fixture. The coverage document says this in its preamble; a panel reader who sees only the table, or the "29" quoted alone, would be misled.
- Every requirement has acceptance criteria text and a validation method in `REQUIREMENTS.md`; none is an automated test of running software.

### 2.7 Why are 37 baseline decisions unresolved?
**Because the owner deferred them (TODO T2, 2026-10-28) and because 28 of them are facts or legal readings that only a stakeholder or counsel can supply.**
- 21 are stakeholder facts, 6 need a fact plus verification, 1 is a pure regulatory verification; only 9 involve an architecture choice.
- The register states "no option is recommended". That posture is correct for a real engagement where facts are missing, and it is the opposite of what rubric criteria C3 and B1 reward (a recommendation, defended).
- Consequence in the repository: both solution designs compute **Blocked**, the two solution ADRs stay Proposed, gates G2 and G3 fail, and hard constraints HC-01, HC-06, HC-07, HC-08 stay Conditional.
- For the capstone the register can be converted, without inventing facts, into **labelled case-study assumptions** that the architect decides and defends (see PRIORITIZED-BACKLOG B-02).

### 2.8 Is the intermittent test failure understood?
**No. It is bounded, not explained.**
- EV-0054: 1 of 762 failed. The recorder keeps only the last 2,000 bytes, so the test was not identified. EV-0052 and EV-0053 are different and explained (run before the generated evidence index was regenerated).
- It did not recur: EV-0055, EV-0058, and two new full runs in a clean clone (770 of 770, both) passed.
- Observation: the failing run was among the slowest in the OneDrive-synced folder (628 s) while a clean clone outside OneDrive takes 249 to 319 s. Tests that depend on timing exist (spawn timeouts of 180 s and 60 s in the evaluation tests, a 1-second timeout with a 15-second bound in the loop test, lease and `utimes` tests). **This is a hypothesis, not a finding**: no experiment has produced the failure again.
- To close it: make the recorder keep failing-test names (TODO T41); repeat the suite in place under CPU load until it fails or 20 consecutive runs pass; move the repository out of OneDrive (TODO T5).

### 2.9 Are the certificate evidence and lineage contracts sufficient?
**Not for the claim "tamper-evident, locally hosted certificates" in front of a panel.**
- Certificate contract: a hash chain over records with a payload hash, a record hash, a link to the previous record, a hosting-zone label, a methodology reference with a definition hash, and a human quality-manager approval for Issued and Filed. One valid fixture and mutation tests.
- Missing: any signature, signer identity or key identifier (D-013 open); an external anchor or trusted timestamp; revocation or supersession semantics beyond a status word; a link from the certificate to the evidence package hash; a scheme-specific schema; verification that the "approver" is a person (the check is a self-declared string `approverType: human`). "Locally hosted" is a label, not a verified placement.
- Lineage contract: enforces layers, origins (no model origin) and per-source sequence, but **has no effective period for methodology and factors and no time-order or plausibility rule** (the two genuine evaluation FAILs, EVAL-PRC-DAT-005 and DAT-006).
- The newer ingestion contract implements the time rules and a stand-alone store check, and has been through two independent review rounds. It is not integrated with the lineage contract: the repository has **two different models of an event**.

### 2.10 Is the harness becoming overengineered relative to the capstone deliverable?
**Yes, by a wide margin, and the evidence is in the proportions.**

| Measure | Harness and governance | Solution (the capstone subject) |
|---|---|---|
| Custom code | about 8,000 lines plus about 5,600 lines of tests | about 250 lines (ingestion contract), a non-deployable scaffold, candidate validators |
| Accepted ADRs | 13 | 0 solution-architecture ADRs |
| Running software | validators, hooks, engines | none |
| Working demo of a business outcome | none | none |

- Components that go beyond what the deliverable needs, in order of weight: the custom task and run store and its hash chain, the custom memory store with a ledger, the loop engine (human-run), the evaluation framework with run hashing, the acceptance generator, eleven validators, a 60-record evidence store, and 157,000 words of Markdown.
- Native alternatives exist for some of them: native custom agents and subagents, native memory plus a state file, native tasks. The harness documents why custom code was needed (ADR 0001), but its mass now exceeds the thing it is meant to govern.
- The harness is also, honestly, the strongest evidence in the repository for A2, A3 and C3 and a plausible thought-leadership artifact (D1). The recommendation is therefore **freeze, not delete**: no further harness features; spend remaining effort on the product slice, the numbers and the narrative.

### 2.11 Does the repository contain a working Azure application?
**No.** No `src/`, no deployed resource, no subscription, no application identity. The Bicep scaffold compiles (`validate-azure --bicep`, EV-0045) and is non-deployable by design; the readiness utility says NOT-READY. Azure deployment was deferred by the owner (TODO T36). The capability the panel is likely to ask about (five business agents on Azure) is absent.

### 2.12 Can any business outcome be demonstrated and measured?
**No.** `BUSINESS-CASE.md` states it is not a financial case; no baseline (D-034), no KPI value, no latency, throughput, cost per delivery or evaluation score for any business agent exists. What is measured is the quality of the harness itself (tests, gates, evaluation counts). Those numbers are real but they are not the numbers the rubric asks for (B7 names cost per transaction, latency, evaluation scores and value at stake).

## 3. Claims compared with the evidence

| Claim | Where | Verdict |
|---|---|---|
| "Verified so far: the hook denies in Copilot CLI 1.0.102 ... Not yet verified: VS Code chat behaviour" | README | **Stale.** Tested version is 1.0.105; much more was verified in later stages |
| "ADR 0001 and 0002 are Proposed, not Accepted" | [HARNESS-ARCHITECTURE](../harness/HARNESS-ARCHITECTURE.md) section on gaps | **Stale.** Both are Accepted |
| "Forbidden until ... `infra/`, Bicep ..." | [AGENTS.md](../../AGENTS.md) | **Incomplete.** `infra/` exists under the ADR 0014 exception, which AGENTS.md does not mention |
| "Registry of 47 tools" | STATE (tool-layer stage) | Historical. The registry now holds 51 (33 enabled) |
| "Node.js 20 or later" | README, `engines` | **Unverified.** Every run in this audit and in CI used Node 22 |
| 33 capabilities, 12 verified | acceptance report | Consistent with the evidence at the time; the verified count depends on the fresh-clone and hook claims, which this audit narrows (2.3) |
| "Unauthorized operations are technically blocked" (pillar 4) | README and acceptance report | **True for named agents with stated exceptions; false as a blanket statement** (2.2, 2.3) |
| "TESTED AND PASSING" for 29 requirements | REQUIREMENTS-COVERAGE | Accurate only with its preamble; **likely to be misread** as 29 requirements satisfied |
| "Reproducible setup" | acceptance report | **Confirmed**: fresh clone plus 770 of 770 tests with no install step |
| "No Azure resource created" | everywhere | **Confirmed**: no sign-in used, no resource exists |
| Acceptance report states what was not verified | acceptance report | **Confirmed**, and it is the repository's strongest honesty signal |

Documents also quoted in earlier stages that are historical rather than wrong: ADR status mentions inside dated STATE and TODO history rows.

## 4. Duplicated code, ineffective controls and unnecessary complexity

- **Duplicated secret and path redaction**: separate `redact` implementations in `eval.cjs`, `loop.cjs`, `orchestration/engine.cjs`, `permission-engine.cjs` and `tool-output-guard.cjs`, plus a regular expression in `record-evidence.mjs`. They read the same pattern file but drift independently; one shared module would remove four copies.
- **Duplicated helpers**: `readJson` in five files, an atomic-write helper in three, canonical JSON and hashing in two.
- **Two event models** (lineage contract and ingestion contract), see 2.9.
- **Documentation duplication**: [ARCHITECTURE-DEFENSE](../acceptance/ARCHITECTURE-DEFENSE.md) overlaps the defence question bank; STATE.md (about 3,900 words) is an accumulating log mixed with the current resume point.
- **Ineffective or untested controls**: OS isolation absent; branch protection absent; GitHub secret scanning disabled; the output hook, agent-scoped hooks and MCP trust prompts unverified in VS Code; approver registry empty; self-declared memory writers; unsigned evidence records.
- **Empty structure**: the eight `docs/design/*` folders that the agents are scoped to write to contain only two-line READMEs; the single proposal in them is an unapproved demonstration.
- **Control that works but is mis-pitched**: the "independent" reviews. They find real defects (RV-0002 section 7 lists 12 findings: 8 fixed, 1 mistaken, 3 open by design), but a model reviewing a model is not independence in the panel's sense.

## 5. Findings that cut against the harness's own principles

1. The repository states "evidence over assertion" and then lets a claim string stand beside an exit code without checking that the command supports the claim.
2. "Deny unknown tools and operations" is stated as a default; the default session is exempted, and the default session is the one a human uses.
3. "Secure by default" for a public repository: secret scanning and push protection were left disabled when the repository was made public.
4. The decision register refuses to recommend, while the capstone rewards a defended recommendation.

## 6. What this audit could not establish

- Whether any agent works in VS Code today.
- Whether the Microsoft-specific publishing and IP rules permit this repository in its current public form (needs the owner's confirmation).
- Panel date, thought-leadership deadline, masterclass attendance and artifact choice: not in the repository; see [CAPSTONE-READINESS](CAPSTONE-READINESS.md).
- Anything about delivery, listening, composure or influence (criteria B5, C2) beyond preparation material.
