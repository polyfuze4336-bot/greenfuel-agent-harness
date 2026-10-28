# ADR 0012: Independent evaluation framework

- **Status:** Proposed (awaiting the programme owner's decision)
- **Type:** Governance
- **Date:** 2026-10-28
- **Deciders:** Programme owner
- **Supersedes:** none

## Context
- FACT: The owner asked for an independent evaluation framework across twelve domains, seven quality gates (G1 to G7) where a critical gate failure blocks progression and an aggregate must not hide a hard-constraint violation, eleven red-team scenarios, separate harness and production-agent tests, safe fixtures and mock identities, and an evaluation report with test ID, requirement ID, scenario, expected, actual, evidence, severity, status and remediation. A test must never be reported as passed unless it ran. The stage stops after one passing and one intentionally blocked test.
- FACT: The harness already has validators, test suites, a design review gate, an evidence recorder, a tamper-evident audit log and the guards of [ADR 0008](./0008-least-privilege-permission-model.md). It has no component that runs a catalogue of tests against requirements and hard constraints, derives gates from results, and keeps the evidence.
- FACT: No business agent, application or Azure resource exists, and none may be built before a human raises the phase ([ADR 0002](./0002-phase-gating-and-approval-enforcement.md)). Production-agent tests therefore cannot run.
- FACT: While building the framework, its first executable checks found a defect in the permission audit log: free-text `reason` and `paths` were written without redaction, so a command carrying a token could leave its first characters in the log. It was fixed in the same stage and has a regression check.
- ASSUMPTION: Time limits, output limits and the minimum-pass counts of suites are working values, not measurements.

## Options considered
1. **A documented checklist and a manually written report.** Rejected: nothing would stop a status from being written as PASS without a run.
2. **A single score per domain and per gate.** Rejected: an aggregate can hide a hard-constraint violation, which the owner ruled out. Gates are decided by rules over individual results instead.
3. **An external evaluation product or service.** Rejected for now: new dependencies, a service and an authentication step that the harness does not need, with no way to meet "never PASS without a run" more simply.
4. **A small deterministic engine over a data catalogue, with the runner executing only allow-listed commands, one evidence file per result, statuses re-derived from evidence, gates and hard constraints computed by rule, and a report generated from the run (chosen).**

## Decision
Proposed. Adopt:
- [eval.cjs](../../harness/eval/eval.cjs), [evaluation-policy.json](../../harness/policy/evaluation-policy.json), the human-run CLI [evaluate.mjs](../../harness/scripts/evaluate.mjs), and `validate-evaluation` in `npm run validate` and CI, as described in [EVALUATION-FRAMEWORK](../evaluation/EVALUATION-FRAMEWORK.md).
- Four statuses: PASS (ran and showed its outcome), FAIL (including "could not show it ran"), BLOCKED (precondition unmet, or skipped), PENDING (the system does not exist). Only PASS counts, and only with evidence that it ran.
- Gates G1 to G7 decided by rules, no score, a hard-constraint verdict printed above the gates, entry criteria that block every gate if a harness control test fails, and `requires` so a readiness check cannot run before the gates it depends on.
- Three suites kept apart by ID prefix and enforced by validation: the coding harness, production candidate contracts, and production agents (all pending).
- `evaluation/` and `docs/evaluation/` as control-plane paths, and no agent granted the evaluation runner, so an agent cannot edit a test or produce a result. Running the evaluation and committing its run and report are human steps.
- A committed full run and a report that must equal what the latest run generates.

## Consequences
- The evaluation reports real gaps, and the first run did: DES-0001 is not approved (G2 fails), the candidate contracts accept an outdated emissions factor set and a manipulated timestamp (G3 fails, HC-08 is reported VIOLATED), and later gates are blocked. These findings are for the owner and the principal architect to decide; the framework does not fix them.
- Gate PASS is necessary, never sufficient. Approval remains human.
- Production-agent, performance, operations, cost and recovery tests remain pending until the phase is raised and targets are agreed.
- More custom code to maintain: one module, one validator and two test files. No new dependency.
- The runner is not a sandbox: it runs test files with the user's permissions. Test files are control plane and human-reviewed. This is the same limit as roadmap item R15.
- An independent adversarial review of the framework found six defects (forged TAP and summary output, a hard-constraint test outside any gate, an exit code that hid failure, a misleading partial-run verdict, metadata outside the integrity hash, unverified report output). All were fixed with regression tests. The integrity hashes remain checksums, not signatures.
- A person with write access could replace a run and report together if both are consistent. Review and branch protection are the control.

## Reversibility
High. Removing the module, CLI, policy, catalogue, checks, validator and path-class entries returns the harness to its previous state. Runs are plain files.

## Revisit when
- The owner raises the phase and a first production agent exists: its pending tests become executable.
- A sandbox for running checks is built (R15): the runner should use it.
- The owner agrees performance, cost or recovery targets: the pending tests get runners.
- The mass-balance contract is defined: RT-09 gets an executable contract check.

## Evidence
Automated tests ([evaluation-engine.test.mjs](../../tests/evaluation-engine.test.mjs), [validate-evaluation.test.mjs](../../tests/validate-evaluation.test.mjs)) cover the status rules, the gate rules, forged results, the catalogue validator and the command line. A full evaluation run is committed under `docs/evaluation/runs/` with its generated [EVALUATION-REPORT](../evaluation/EVALUATION-REPORT.md); the report, not this ADR, states what passed, failed, was blocked or is pending. Its first full run also caught a defect in this stage's own work (this ADR lacked its Evidence section and failed the architecture validator). An independent model review found six defects in the framework, each fixed with a regression test; that review is not an evidence record. See [EVALUATION-FRAMEWORK](../evaluation/EVALUATION-FRAMEWORK.md) for what was and was not shown.
