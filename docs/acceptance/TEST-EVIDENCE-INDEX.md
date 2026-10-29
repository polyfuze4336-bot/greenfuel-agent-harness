<!-- generated: node harness/scripts/acceptance-reports.mjs --write -->
# Test and evidence index

Generated from the evidence records, the committed evaluation runs, the test folder and `package.json`. Do not edit: `validate-harness` regenerates this file and fails on any difference.

**What an evidence record is.** The recorder runs a command and stores what happened: arguments, exit code, duration, an output hash and the output tail, the Git commit and the runtime. It records facts about a run; it does not judge whether the command proves the claim. A claim is only as good as the command that backs it. A record with no exit code is a timeout or a kill, and is kept (append-only).

## A. Evidence records (70)

| ID | Recorded | Commit | Command | Outcome | Claim |
|---|---|---|---|---|---|
| EV-0001 | 2026-10-28 | `17a7de2` | `node harness/scripts/validate-harness.mjs` | exit 0 | Repository validator reports no problems |
| EV-0002 | 2026-10-28 | `17a7de2` | `node --test` | exit 0 | All unit tests for policy guard, recorder and validator pass |
| EV-0003 | 2026-10-28 | `fca906d` | `gh run view 40638160417 --repo polyfuze4336-bot/greenfuel-agent-harnes` | exit 0 | GitHub Actions workflow validate completed successfully on pushed commit fca906d |
| EV-0004 | 2026-10-28 | `9771268` | `node harness/scripts/validate-harness.mjs` | exit 0 | Repository validator, including requirements baseline checks, reports no problems |
| EV-0005 | 2026-10-28 | `9771268` | `node --test` | exit 0 | All 80 tests pass: policy guard, recorder, validator and baseline/context mutation tests |
| EV-0006 | 2026-10-28 | `bacce2f` | `gh run view 40641249592 --repo polyfuze4336-bot/greenfuel-agent-harnes` | exit 0 | GitHub Actions workflow validate completed successfully on pushed commit 9f9a1f0 |
| EV-0007 | 2026-10-28 | `bacce2f` | `node harness/scripts/design-gate.mjs docs/architecture/reviews/RV-0001` | exit 0 | Design gate: declared status of RV-0001 is consistent with the computed result (Blocked) |
| EV-0008 | 2026-10-28 | `bacce2f` | `node harness/scripts/design-gate.mjs docs/architecture/reviews/RV-0001` | exit 3 | Design gate rejects option B (single central store) for DES-0001 under HC-01 |
| EV-0009 | 2026-10-28 | `bacce2f` | `node harness/scripts/validate-harness.mjs` | exit 0 | Repository validator, including architecture checks and figures lint, reports no problems |
| EV-0010 | 2026-10-28 | `bacce2f` | `node harness/scripts/design-gate.mjs docs/architecture/reviews/RV-0001` | exit 2 | Design gate refuses to pass the unscreened option E for DES-0001 |
| EV-0011 | 2026-10-28 | `bacce2f` | `node --test` | exit 0 | All 102 tests pass including gate reject, block and approve paths |
| EV-0012 | 2026-10-28 | `43f3cbd` | `npm test` | no exit (spawnSync npm ENOENT) | Full test suite passes on the specialist-agent commit |
| EV-0013 | 2026-10-28 | `43f3cbd` | `npm run validate` | no exit (spawnSync npm ENOENT) | Repository validation (context, architecture, agents) is clean on the specialist-agent commit |
| EV-0014 | 2026-10-28 | `43f3cbd` | `node harness/scripts/validate-agents.mjs --versions` | exit 0 | Agent definitions match agent-policy.json; installed VS Code and Copilot CLI match tested versions |
| EV-0015 | 2026-10-28 | `d719cf4` | `npm test` | exit 0 | Full test suite passes on the recorder-fix commit |
| EV-0016 | 2026-10-28 | `d719cf4` | `npm run validate` | exit 0 | Repository validation (context, architecture, agents) is clean on the recorder-fix commit |
| EV-0017 | 2026-10-28 | `5f9ba58` | `npm test` | exit 0 | Full test suite passes on the tool-layer commit |
| EV-0018 | 2026-10-28 | `5f9ba58` | `npm run validate` | exit 0 | Repository validation (context, architecture, agents, tools) is clean on the tool-layer commit |
| EV-0019 | 2026-10-28 | `5f9ba58` | `node harness/scripts/validate-tools.mjs` | exit 0 | Tool registry, MCP configuration, grants and generated tables validate on the tool-layer commit |
| EV-0020 | 2026-10-28 | `5f9ba58` | `node harness/scripts/spec-validators.mjs deployment-readiness` | exit 2 | Deployment-readiness utility reports NOT-READY (exit 2) with its blockers; nothing is deployable |
| EV-0021 | 2026-10-28 | `5f9ba58` | `node harness/scripts/validate-agents.mjs --versions` | exit 0 | Agent files match policy; installed VS Code and Copilot CLI versions vs tested |
| EV-0022 | 2026-10-28 | `e4a935e` | `npm test` | exit 0 | npm test passes on Windows at the committed HEAD (all suites including permission tests) |
| EV-0023 | 2026-10-28 | `e4a935e` | `npm run validate` | exit 0 | npm run validate is clean at the committed HEAD |
| EV-0024 | 2026-10-28 | `e4a935e` | `node harness/scripts/validate-permissions.mjs` | exit 0 | validate-permissions reports the permission policy coherent, with specifications consistent with agent policy and tool registry |
| EV-0025 | 2026-10-28 | `e4a935e` | `node --test tests/permission-negative.test.mjs` | exit 0 | negative permission tests (five scenarios, filings, protected branches, audit tamper, review regressions) pass |
| EV-0026 | 2026-10-28 | `e4a935e` | `node harness/scripts/verify-github-protection.mjs` | exit 3 | GitHub branch protection spec check: read-only comparison reports unavailable on this plan |
| EV-0027 | 2026-10-28 | `3d88241` | `npm test` | exit 0 | npm test passes at the committed HEAD (all suites including the task-execution framework tests) |
| EV-0028 | 2026-10-28 | `3d88241` | `npm run validate` | exit 0 | npm run validate is clean at the committed HEAD |
| EV-0029 | 2026-10-28 | `3d88241` | `node harness/scripts/validate-orchestration.mjs` | exit 0 | validate-orchestration passes: policy coherent, hook registered, orchestrator read-only, docs current, committed run intact |
| EV-0030 | 2026-10-28 | `3d88241` | `node harness/scripts/tasks.mjs verify --run RUN-afb2a0466e` | exit 0 | tasks verify RUN-afb2a0466e: chain, checkpoints, captured replies, accepted files and command evidence match the record |
| EV-0031 | 2026-10-28 | `17fda31` | `npm test` | exit 0 | npm test passes at the memory commit |
| EV-0032 | 2026-10-28 | `17fda31` | `npm run validate` | exit 0 | npm run validate is clean at the memory commit |
| EV-0033 | 2026-10-28 | `17fda31` | `node --test tests/memory.test.mjs tests/validate-memory.test.mjs` | exit 0 | node --test of the memory test files passes |
| EV-0034 | 2026-10-28 | `17fda31` | `node harness/scripts/validate-memory.mjs` | exit 0 | validate-memory reports OK at the memory commit |
| EV-0035 | 2026-10-28 | `a323bb9` | `npm test` | exit 0 | npm test passes at the loop commit (pinned TypeScript toolchain installed locally) |
| EV-0036 | 2026-10-28 | `a323bb9` | `npm run validate` | exit 0 | npm run validate is clean at the loop commit |
| EV-0037 | 2026-10-28 | `a323bb9` | `node --test tests/loop-engine.test.mjs tests/validate-loop.test.mjs` | exit 0 | loop engine and validate-loop tests pass at the loop commit |
| EV-0038 | 2026-10-28 | `a323bb9` | `node harness/scripts/validate-loop.mjs` | exit 0 | validate-loop reports OK at the loop commit |
| EV-0039 | 2026-10-28 | `e80a5ff` | `npm test` | exit 0 | npm test at e80a5ff: all tests pass, none skipped (includes evaluation engine and validator tests) |
| EV-0040 | 2026-10-28 | `e80a5ff` | `npm run validate` | exit 0 | npm run validate at e80a5ff is clean, including validate-evaluation |
| EV-0041 | 2026-10-28 | `e80a5ff` | `node harness/scripts/validate-evaluation.mjs` | exit 0 | validate-evaluation OK: committed run EVRUN-ac57aba1cf re-derives from its evidence and the report matches it |
| EV-0042 | 2026-10-28 | `e80a5ff` | `node harness/scripts/evaluate.mjs verify --run EVRUN-ac57aba1cf` | exit 0 | evaluate.mjs verify of EVRUN-ac57aba1cf: every status, gate and hard-constraint verdict re-derives from evidence |
| EV-0043 | 2026-10-28 | `dbe2f23` | `npm test` | no exit (SIGTERM) | npm test at dbe2f23: all tests pass, none skipped (includes Azure validator, evaluation re-run and record tests) |
| EV-0044 | 2026-10-28 | `dbe2f23` | `npm run validate` | exit 0 | npm run validate at dbe2f23 is clean, including validate-azure and validate-evaluation |
| EV-0045 | 2026-10-28 | `dbe2f23` | `node harness/scripts/validate-azure.mjs --bicep` | exit 0 | validate-azure --bicep at dbe2f23: static policy passes and every Bicep file compiles with no diagnostics (local compiler, no Azure call) |
| EV-0046 | 2026-10-28 | `dbe2f23` | `node harness/scripts/evaluate.mjs verify --run EVRUN-bdce820495` | exit 0 | evaluate.mjs verify of EVRUN-bdce820495 re-derives every status, gate and hard-constraint verdict |
| EV-0047 | 2026-10-28 | `dbe2f23` | `npm test` | exit 0 | npm test at dbe2f23: all tests pass, none skipped (includes Azure validator, evaluation re-run and record tests). Supersedes EV-0043, which timed out  |
| EV-0048 | 2026-10-29 | `c37b3f1` | `node --test tests/ingestion-contract.test.mjs evaluation/checks/ingest` | exit 0 | Ingestion candidate contract tests and its three evaluation checks pass (synthetic fixtures; a specification harness, not the application) |
| EV-0049 | 2026-10-29 | `c37b3f1` | `node harness/scripts/design-gate.mjs docs/architecture/reviews/RV-0002` | exit 0 | Design gate: declared status of RV-0002 (Blocked) is consistent with the computed result |
| EV-0050 | 2026-10-29 | `c37b3f1` | `node harness/scripts/spec-validators.mjs deployment-readiness` | exit 2 | Deployment-readiness utility reports NOT-READY (exit 2): the end-to-end scenario pauses before any Azure provisioning |
| EV-0051 | 2026-10-29 | `c37b3f1` | `node harness/scripts/evaluate.mjs verify --run EVRUN-36a72c3e30` | exit 0 | evaluate.mjs verify of EVRUN-36a72c3e30 re-derives every status, gate and hard-constraint verdict |
| EV-0052 | 2026-10-29 | `c37b3f1` | `npm run validate` | exit 1 | npm run validate is clean at c37b3f1 (stage 12), including the acceptance-document generator check and validate-evaluation |
| EV-0053 | 2026-10-29 | `c37b3f1` | `npm test` | exit 1 | npm test at c37b3f1: all tests pass, none skipped (includes the ingestion contract, acceptance-document generator and evaluation re-run tests) |
| EV-0054 | 2026-10-29 | `2c35ce3` | `npm test` | exit 1 | npm test at 2c35ce3 (stage 12): all tests pass, none skipped (includes the ingestion contract, acceptance-document generator and evaluation re-run tes |
| EV-0055 | 2026-10-29 | `e4c9139` | `npm test` | exit 0 | npm test at e4c9139 (stage 12): all 762 tests pass, none skipped. Supersedes EV-0053 and EV-0054, which each recorded failures (EV-0054: one test fail |
| EV-0056 | 2026-10-29 | `e0f88cb` | `npm run validate` | exit 0 | npm run validate is clean at the stage 12 content commit, including the acceptance-document generator check and validate-evaluation |
| EV-0057 | 2026-10-29 | `490df78` | `node harness/scripts/fresh-clone-check.mjs tests/ingestion-contract.te` | exit 0 | Fresh clone of the committed HEAD (no install step): the repository validator is clean and the ingestion contract and acceptance-generator tests pass |
| EV-0058 | 2026-10-29 | `53855db` | `npm test` | exit 0 | npm test at the publication-hygiene commit: all tests pass, none skipped (adds agent-connectivity, local-path scrubbing and acceptance tests) |
| EV-0059 | 2026-10-29 | `7aba8a1` | `npm run validate` | exit 0 | npm run validate is clean at the publication-hygiene commit, including the local-account-name privacy check |
| EV-0060 | 2026-10-29 | `09913a8` | `node harness/scripts/verify-github-protection.mjs` | exit 1 | GitHub branch protection spec check after the repository became public: read-only comparison of the live settings with github-protection.json |
| EV-0061 | 2026-10-29 | `1a500f7` | `npm run validate` | exit 0 | npm run validate on branch capstone/rubric-enhancement before the audit documents (clean tree) |
| EV-0062 | 2026-10-29 | `1a500f7` | `node docs/capstone/probes/hook-bypass-probe.mjs session` | exit 0 | Simulated hook probe, default session: which tool calls the always-on guard stops (allow/ask/deny); MISS lines are candidate control gaps |
| EV-0063 | 2026-10-29 | `1a500f7` | `node docs/capstone/probes/hook-bypass-probe.mjs qa-engineer` | exit 0 | Simulated hook probe, qa-engineer agent guard |
| EV-0064 | 2026-10-29 | `1a500f7` | `node docs/capstone/probes/hook-bypass-probe.mjs azure-platform` | exit 0 | Simulated hook probe, azure-platform agent guard |
| EV-0065 | 2026-10-29 | `726d8e5` | `node harness/scripts/evaluate.mjs verify --run EVRUN-9b6110b026` | exit 0 | evaluate.mjs verify of the current committed run EVRUN-9b6110b026 re-derives every status, gate and hard-constraint verdict (capstone audit) |
| EV-0066 | 2026-10-29 | `45c0f13` | `npm test` | exit 0 | npm test on branch capstone/rubric-enhancement with the audit documents: all tests pass, none skipped (capstone audit) |
| EV-0067 | 2026-10-29 | `9a23b10` | `npm test` | exit 0 | npm test on the hardening branch (full suite, recorder-run, clean tree at start) |
| EV-0068 | 2026-10-29 | `e7e1e56` | `node harness/scripts/design-gate.mjs docs/architecture/reviews/RV-0003` | exit 0 | Design-review gate on RV-0003 (DES-0003): computes Blocked, declared Blocked, 0 rejection reasons, 0 errors |
| EV-0069 | 2026-10-29 | `e7e1e56` | `node harness/scripts/validate-harness.mjs` | exit 1 | validate-harness on the architecture branch (all validators incl. architecture lint, approvals, evidence, business model) |
| EV-0070 | 2026-10-29 | `e7e1e56` | `node harness/scripts/business-model.mjs check` | exit 0 | business-model check: inputs classed, price file valid, report current |

## B. Committed evaluation runs (1)

Only the latest full run is kept in the tree; earlier runs remain in Git history. The full per-test table is in [EVALUATION-REPORT](../evaluation/EVALUATION-REPORT.md).

| Run | Commit | Partial | PASS | FAIL | BLOCKED | PENDING | Gates |
|---|---|---|---|---|---|---|---|
| EVRUN-9b6110b026 | `587d609` | no | 53 | 3 | 1 | 16 | G1 PASS, G2 FAIL, G3 FAIL, G4 BLOCKED, G5 BLOCKED, G6 BLOCKED, G7 BLOCKED |

## C. Test files (41) run by `npm test`

The count is the number of top-level `test(` declarations in the file. Generated cases (mutation tables) run several tests per declaration, so the executed total is larger; the executed total is in the evidence record for `npm test`.

| File | Declarations |
|---|---|
| tests/acceptance-reports.test.mjs | 3 |
| tests/agent-connectivity.test.mjs | 5 |
| tests/agent-guard.test.mjs | 26 |
| tests/approvals.test.mjs | 12 |
| tests/approver-enrollment.test.mjs | 10 |
| tests/audit-denials.test.mjs | 4 |
| tests/business-model.test.mjs | 17 |
| tests/control-plane-guard.test.mjs | 8 |
| tests/design-gate.test.mjs | 22 |
| tests/enforcement-attestation.test.mjs | 5 |
| tests/evaluation-engine.test.mjs | 28 |
| tests/evidence-integrity.test.mjs | 12 |
| tests/hook-gap-regression.test.mjs | 10 |
| tests/ingestion-contract.test.mjs | 20 |
| tests/isolation.test.mjs | 10 |
| tests/live-validation.test.mjs | 5 |
| tests/local-paths.test.mjs | 3 |
| tests/loop-engine.test.mjs | 31 |
| tests/mcp-names.test.mjs | 5 |
| tests/mcp-server.test.mjs | 15 |
| tests/memory.test.mjs | 23 |
| tests/orchestration-durability.test.mjs | 12 |
| tests/orchestration-engine.test.mjs | 35 |
| tests/orchestration-hook-cli.test.mjs | 9 |
| tests/orchestration-plan.test.mjs | 9 |
| tests/permission-negative.test.mjs | 10 |
| tests/permissions-engine.test.mjs | 12 |
| tests/policy-guard.test.mjs | 5 |
| tests/record-evidence.test.mjs | 8 |
| tests/spec-validators.test.mjs | 21 |
| tests/tool-output-guard.test.mjs | 12 |
| tests/validate-agents.test.mjs | 25 |
| tests/validate-azure.test.mjs | 9 |
| tests/validate-context.test.mjs | 12 |
| tests/validate-evaluation.test.mjs | 3 |
| tests/validate-harness.test.mjs | 12 |
| tests/validate-loop.test.mjs | 2 |
| tests/validate-memory.test.mjs | 10 |
| tests/validate-orchestration.test.mjs | 5 |
| tests/validate-permissions.test.mjs | 4 |
| tests/validate-tools.test.mjs | 23 |

## D. Validators and commands

| Script | Command |
|---|---|
| validate | `node harness/scripts/validate-harness.mjs` |
| validate:requirements | `node harness/scripts/spec-validators.mjs requirements` |
| validate:architecture | `node harness/scripts/spec-validators.mjs architecture` |
| validate:sovereignty | `node harness/scripts/spec-validators.mjs sovereignty` |
| validate:agent-permissions | `node harness/scripts/spec-validators.mjs agent-permissions` |
| validate:evidence-lineage | `node harness/scripts/spec-validators.mjs evidence-lineage` |
| validate:emissions-methods | `node harness/scripts/spec-validators.mjs emissions-methods` |
| validate:certificate-integrity | `node harness/scripts/spec-validators.mjs certificate-integrity` |
| validate:deployment-readiness | `node harness/scripts/spec-validators.mjs deployment-readiness` |
| validate:tools | `node harness/scripts/validate-tools.mjs` |
| validate:permissions | `node harness/scripts/validate-permissions.mjs` |
| validate:orchestration | `node harness/scripts/validate-orchestration.mjs` |
| validate:memory | `node harness/scripts/validate-memory.mjs` |
| validate:loop | `node harness/scripts/validate-loop.mjs` |
| validate:evaluation | `node harness/scripts/validate-evaluation.mjs` |
| validate:azure | `node harness/scripts/validate-azure.mjs` |
| validate:approvals | `node harness/scripts/validate-approvals.mjs` |
| validate:isolation | `node harness/scripts/validate-isolation.mjs` |
| validate:business | `node harness/scripts/business-model.mjs check` |
| test:guarded | `node harness/scripts/guarded-run.mjs -- node --test` |
| evaluate | `node harness/scripts/evaluate.mjs` |
| test | `node --test` |

## E. How to reproduce

```
git clone <repository>; cd greenfuel-agent-harness
node harness/scripts/validate-harness.mjs        structure, secrets, phase gate, and every sub-validator
node harness/scripts/evaluate.mjs rerun           re-run the whole evaluation and compare it with the committed run
node --test                                       the test suite (set CI=true; the TypeScript scenario needs the pinned toolchain)
```

There are no dependencies to install. Node 20 or later is required (the harness was developed on Node 22). The TypeScript build scenario of the loop needs a pinned toolchain installed outside the manifest; without it that test is skipped and the evaluation reports it BLOCKED, never passed.

