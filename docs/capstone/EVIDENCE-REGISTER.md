# Evidence register

What evidence exists for the capstone, how it was produced, how to re-run it, and what it does not show. Evidence is separated by **kind** because the rubric and the panel treat them differently:

- **Recorded**: produced by the evidence recorder (`harness/scripts/record-evidence.mjs`): argv, exit code, output hash, last 2,000 bytes, Git commit, runtime. A record states what ran, not whether a claim is true, and the claim text is free.
- **Observed in this audit**: I ran it and saw it, but no record was made by the recorder. Reproducible by the command shown.
- **Committed artifact**: a file in the repository that a script can re-derive or re-check.
- **Owner-reported**: you told me it happened; I did not see it.
- **Model review**: an independent read-only model agent reviewed work. Useful and sometimes decisive, but not independent in the panel's sense and not an evidence record.
- **Absent**: evidence the rubric asks for and the repository does not contain.

Commit audited: `c6ff681` on branch `capstone/rubric-enhancement`. Environment: Windows, Node 22.23.4, VS Code 1.143.0, Copilot CLI 1.0.105.

## 1. Recorded evidence that matters to the capstone

| ID | Claim (as recorded) | Result | Supports | Limit |
|---|---|---|---|---|
| EV-0007, EV-0008, EV-0010 | Design gate: declared status consistent; rejects the central-store option under HC-01; refuses an unscreened option | exit 0, 3, 2 as intended | A2, A1 | The gate checks structure and consistency, not truth |
| EV-0020, EV-0050 | Deployment-readiness utility reports NOT-READY | exit 2 | A4 (disclosure), C3 | Shows absence of readiness, not capability |
| EV-0025 | Negative permission tests pass (five scenarios, filings, protected branches, audit tamper) | exit 0 | A3, A7 | Hook-level only; no sandbox |
| EV-0026 | Branch protection check: unavailable on the plan at the time | exit 3 | A3 (disclosure) | Superseded by EV-0060 |
| EV-0029, EV-0030 | Orchestration validator and run `RUN-afb2a0466e` verify | exit 0 | A7 | One live run, CLI only |
| EV-0034, EV-0038 | Memory and loop validators OK | exit 0 | A7 | Fixtures; no model-driven repair |
| EV-0045 | `validate-azure --bicep`: static policy passes and every Bicep file compiles | exit 0 | A1, A4 | Local compiler, no Azure call, non-deployable |
| EV-0048 | Ingestion contract tests and three evaluation checks pass | exit 0 | A1, A3, A4 | Synthetic fixtures; a specification harness, not the application |
| EV-0049 | Design gate on RV-0002: declared Blocked equals computed Blocked | exit 0 | A2, C3 | Blocked is the honest result |
| EV-0052, EV-0053 | `npm run validate` and `npm test` failed | exit 1 | C3, A4 | Explained: run before the generated evidence index was regenerated. Kept |
| EV-0054 | `npm test`: 1 of 762 failed | exit 1 | A4 | **Unexplained**; see FORENSIC-AUDIT 2.8 |
| EV-0055 | `npm test`: 762 pass, none skipped | exit 0 | A4, D2 | Slow in the synchronised folder |
| EV-0057 | Fresh clone of the committed HEAD, no install step: validator clean, contract and generator tests pass | exit 0 | D1, D2, A4 | Partial test set in the clone |
| EV-0058 | `npm test` at the publication-hygiene commit: all pass | exit 0 | A4 | Same |
| EV-0059 | `npm run validate` clean at that commit | exit 0 | A4 | Structure and consistency |
| EV-0060 | GitHub branch protection check on the public repository | exit 1: NOT-PROTECTED | A3 (disclosure) | Protection now possible, not applied |
| EV-0061 | `npm run validate` on the audit branch before the audit documents | exit 0 | A4 | Baseline for this audit |
| EV-0062, EV-0063, EV-0064 | Simulated hook probes: default session, `qa-engineer`, `azure-platform`. Raw output in `docs/capstone/probes/` | exit 0 (the probe reports counts) | A3 | 15, 4 and 6 "MISS" rows; 2 of the 6 for `azure-platform` are wrong expectations in the probe, not gaps. Candidate gaps, not proven exploits |
| EV-0065, EV-0066 | Recorded at the audit documents commit: `evaluate.mjs verify` of the current committed run, and `npm test` | see the index after recording | A4, A6 | See TEST-EVIDENCE-INDEX; EV-0051 verified an earlier, superseded run |

The full list of 60-plus records with commits is generated in [TEST-EVIDENCE-INDEX](../acceptance/TEST-EVIDENCE-INDEX.md).

## 2. Observed in this audit (not recorded)

| Observation | Command | Result | Supports | Limit |
|---|---|---|---|---|
| Full suite in a clean clone outside the synchronised folder, run 1 | `node --test` in a fresh clone, `CI=true`, toolchain present | 770 tests, 770 pass, 0 fail, 0 skipped, 319 s | A4, D2 | Not a recorder record; TAP output summarised here only |
| Same, run 2 | same | 770 of 770, 249 s | A4 | Two runs do not prove determinism (see the open flake) |
| All validators | `validate-harness`, `-permissions`, `-orchestration`, `-memory`, `-loop`, `-evaluation`, `-azure`, `-agents --versions`, `-tools` | all OK | A4 | Structure and policy checks |
| Bicep compile | `validate-azure.mjs --bicep` | every file compiles, no diagnostics | A1 | No Azure call |
| Readiness | `spec-validators.mjs deployment-readiness` | NOT-READY | A4 disclosure | |
| Evaluation run | `evaluate.mjs verify --run EVRUN-9b6110b026` | ok, 73 tests re-derive | A6 | Measures the harness |
| Denial log | `audit-denials.mjs verify` | chain intact, 111 records | A3 | Local, git-ignored, denial-only |
| Versions | `validate-agents.mjs --versions` | VS Code 1.143.0 and Copilot CLI 1.0.105 match the tested versions | A7 | |
| CI | `gh run list` | green on `c6ff681` | A4 | CI skips the TypeScript scenario (recorded allowed difference) |
| Repository settings | `gh repo view`, `gh api` (read-only) | public, MIT, description set; no topics, no release; secret scanning, push protection and Dependabot security updates disabled | A3, D3 | |
| Size and shape | `git ls-files`, line and word counts | 552 files, about 8,000 lines of harness code, about 5,600 lines of tests, 150 Markdown files, about 157,000 words, no `src/` | G-16 | |

## 3. Committed artifacts that can be re-derived

| Artifact | Re-derived by | Supports | Limit |
|---|---|---|---|
| Evaluation run `EVRUN-9b6110b026` and [EVALUATION-REPORT](../evaluation/EVALUATION-REPORT.md): 53 PASS, 3 FAIL, 1 BLOCKED, 16 PENDING; G1 PASS, G2 and G3 FAIL, G4 to G7 BLOCKED | `evaluate.mjs verify`, CI re-run | A6, C3 | Tests the harness and candidate contracts |
| [REQUIREMENTS-COVERAGE](../acceptance/REQUIREMENTS-COVERAGE.md) (99 requirements) | `acceptance-reports.mjs --check` | B6, A4 | "Tested and passing" means passing on a fixture |
| [HARNESS-ACCEPTANCE-REPORT](../acceptance/HARNESS-ACCEPTANCE-REPORT.md), [ARCHITECTURE-DEFENSE](../acceptance/ARCHITECTURE-DEFENSE.md), [REMAINING-RISKS](../acceptance/REMAINING-RISKS.md) | read | C3, B4, A2 | Written by the author model; no human review |
| DES-0001, DES-0002, RV-0001, RV-0002, ADR 0004 and 0015 | `design-gate.mjs` | A1, A2 | Blocked and Proposed |
| Task run `RUN-afb2a0466e` and loop runs under `docs/state/` | `tasks.mjs verify`, `validate-loop` | A7 | Loop evidence contains the local user name; it is hash-protected and was left unedited |
| Memory ledger | `validate-memory` | A7 | Self-declared writers |
| Agent roster, policy and diagram | `validate-agents`, `agent-connectivity.test.mjs` | A7, B6 | VS Code behaviour not observed |

## 4. Owner-reported and model-reviewed

| Item | Kind | Supports | Limit |
|---|---|---|---|
| Hooks, agent tools and MCP behaviour observed in VS Code chat (TODO T18) | Owner-reported | A7 | Not an evidence record; no transcript |
| Two rounds each by a design critic and a security reviewer on the ingestion contract (RV-0002 section 7: 12 findings, 8 fixed, 1 mistaken, 3 open by design); earlier reviews of the governance, permission, task, memory, loop and evaluation work | Model review | A3, A2 | Models, not people; not independent of the author's model family |

## 5. Evidence the rubric asks for and the repository does not contain

| Needed | Criteria | Backlog |
|---|---|---|
| A running end-to-end slice and a recorded run of it | A4, A5, A6, A7, B3 | B-01 |
| Measured latency, throughput and failure-injection results | A5, B7 | B-03 |
| A cost model per unit of business value from sourced prices | A5, B7, C1 | B-03 |
| A model comparison and an evaluation set for the business agents | A6 | B-04 |
| A stated solution threat model with mitigations mapped to tests | A3 | B-05 |
| An accepted solution architecture decision | A1, A2, C3 | B-02 |
| A narrative, a deck with notes, a demo script and a rehearsal log | B1, B2, B3, B5, B6 | B-06, B-15 |
| Stakeholder map, success measures with baselines, cost of inaction | C1 | B-07 |
| A thought-leadership artifact, its submission and any acceptance | D1, D2, D3, floor | B-09 |
| VS Code observation of the twelve agents | A7 | B-10 |
| Proof of masterclass attendance, panel date, artifact deadline | floors | you |

## 6. How to reproduce the audit

```
git fetch origin && git switch capstone/rubric-enhancement
node harness/scripts/validate-harness.mjs
node --test                                  # 770 expected
node docs/capstone/probes/hook-bypass-probe.mjs session
node docs/capstone/probes/hook-bypass-probe.mjs qa-engineer
node harness/scripts/evaluate.mjs verify --run EVRUN-9b6110b026
node harness/scripts/fresh-clone-check.mjs   # clean-clone validator check of the committed HEAD
```

The probe sends simulated tool calls to the real hook scripts. It executes nothing and writes its denial log to a temporary folder.
