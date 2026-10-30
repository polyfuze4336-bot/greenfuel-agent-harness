# Architecture baseline and build authorization

Status: built and tested locally. **Not pushed, not approved, never run on GitHub.** The gate groupings in [baseline-policy.json](../../harness/policy/baseline-policy.json) are a proposal for the owner to review (TODO T66). The change rules are in [CHANGE-CONTROL](../architecture/CHANGE-CONTROL.md).

## What it does

It answers one question per kind of work (application code, infrastructure, deployment): **may this work be authorized yet, and if not, exactly why not?** It never grants anything. A person grants by signing a baseline; the code only checks that the signature is valid, bound to the right content, and still describes the repository.

```
 repository at a ref ──► facts (git, harness approvals) ──► readiness (pure) ──► gates per area
                                                                │                      │
                                              baseline.ts generate (only if ready)     ├─ Studio /baseline (display only)
                                                    │                                  ├─ CLI report / gate / verify
                                    docs/baselines/BL-nnnn/ + manifest.json            └─ GitHub Actions: architecture-gate.yml
                                                    │
                           human signs a `baseline` approval (approval.mjs) ──► authorized
```

## Where it is

| Piece | File |
|---|---|
| Policy (gates, stages, areas) | [harness/policy/baseline-policy.json](../../harness/policy/baseline-policy.json) |
| Policy parser; fails closed | [policy.ts](../../apps/architecture-studio/src/lib/baseline/policy.ts) |
| Facts from git and harness approvals | [facts.ts](../../apps/architecture-studio/src/lib/baseline/facts.ts), [input.ts](../../apps/architecture-studio/src/lib/baseline/input.ts) |
| Readiness validator (pure) | [readiness.ts](../../apps/architecture-studio/src/lib/baseline/readiness.ts) |
| Manifest and artifacts | [manifest.ts](../../apps/architecture-studio/src/lib/baseline/manifest.ts), [render.ts](../../apps/architecture-studio/src/lib/baseline/render.ts) |
| State, drift, change impact, gates | [state.ts](../../apps/architecture-studio/src/lib/baseline/state.ts) |
| CLI | [baseline.ts](../../apps/architecture-studio/scripts/baseline.ts) |
| CI gate | [architecture-gate.yml](../../.github/workflows/architecture-gate.yml) |
| Studio page and API | `/baseline`, `/api/v1/baseline` (read-only) |
| Signed approval types | `baseline`, `baseline-reopen` in [approval-gates.cjs](../../harness/approvals/approval-gates.cjs) |

## The measures

For each area the validator reports the ten measures requested, plus "Not yet decided" (eleven rows), each with its members and the rule that produced it (shown in the Studio and in `READINESS-REPORT.md`):

1. Required decisions: gate decisions, milestone decisions and everything they `require` (the closure).
2. Approved.
3. Not yet decided (Proposed, Pending Review, Blocked): the one addition to the requested list.
4. Rejected, redesign required: never counted as resolved.
5. Deferred and required: a deferred decision blocks only if the area requires it.
6. Unresolved critical assumptions.
7. Outstanding security approvals.
8. Missing architecture evidence.
9. Must requirements without a decision.
10. Approved decisions without validation.
11. Blocking tasks (the Work Queue's `blocksBuild` flag).

A measure **blocks** an area only when the stage's policy says so. In the proposed policy the Phase 1a `application` stage blocks on unmet gates and on critical assumptions; `production` blocks on every measure. Optional and future-phase decisions are listed as non-blocking deferred decisions, not required.

## What counts as an approved decision

| Evidence | Counts? |
|---|---|
| An ADR status line "Accepted" alone | No. A signed approval is needed |
| A signed approval bound to the ADR's text hash, valid under the harness registry | Yes |
| A Studio review record with a valid hash chain (and signature when keys are supplied) | Yes, per policy, with a caveat that is printed |
| An ADR in the fixed grandfathered list | Yes, with a caveat |
| Conditional approval | Counts but is flagged |
| Rejected, Deferred, Pending | Never resolved |
| Superseded | Only with an approved successor |
| Design review | Needs the declared status Approved **and** a valid signed approval |

## Baseline lifecycle

1. **Generate:** `baseline.ts generate --id BL-0001 --areas application`. Refused unless the policy is valid and every scope area is ready. Writes `manifest.json` (schema `greenfuel.architecture-baseline/v1`), `decision-register.snapshot.json`, `READINESS-REPORT.md`, `DEPENDENCY-MATRIX.md`, `SUMMARY.md`, with sha256 of each artifact in the manifest.
2. **Request and sign:** a person runs `approval.mjs decision --type baseline` and signs with an architecture-class key; the signed record is committed by pull request.
3. **Verify:** `baseline.ts verify` checks artifact hashes, that the source commit exists and is an ancestor, that blobs and the policy hash at that commit match, and (optionally) re-makes the manifest from that commit and compares it.
4. **Authorized** only when the signed approval verifies **on the ref being read**. The Studio and CI read the same status.
5. **Drift:** any later change to something the baseline recorded is an impact (`decision-text-changed`, `decision-redecided`, `decision-not-approved`, `new-required-decision`, `policy-changed`, `requirement-changed`, and others), either `invalidates` or `review`.
6. **Reopen and supersede:** see [CHANGE-CONTROL](../architecture/CHANGE-CONTROL.md).

## CI gate

[architecture-gate.yml](../../.github/workflows/architecture-gate.yml) runs on pull requests and pushes to main, and is callable from deployment workflows with an `area` input. It runs the CLI from the **base** commit against the pull request head, writes a step summary with numbered reasons, and exits 2 when blocked. Actions are pinned to the SHAs used by `validate.yml`; permissions are `contents: read`; no secrets.

## Tested

| Check | Result when run |
|---|---|
| `checks/baseline.check.ts` (40 tests: policy, what counts as approved, gates, measures, this repository today, lifecycle in a throw-away clone with real signed approvals, failing closed, workflow text) | see the final report for the full re-run |
| `e2e/baseline.spec.ts` (10 browser tests: real measures and reasons, area switch, links, read-only statements, keyboard, API refuses writes, failure and retry, axe) | 10 of 10 passed |
| `tests/approver-enrollment.test.mjs` (baseline and reopen approvals) | 11 of 11 passed |
| CLI on this repository | `gate --area application` exits 2 (blocked) with numbered reasons |

## State of this repository today

Generated from the repository, not asserted: 57 decisions, 12 approved, 45 not yet decided, 0 rejected, 0 deferred. `application` (Phase 1a) has 3 blockers: the phase is 0, no architecture-class approver is enrolled, ADR-0020 is Proposed. `infrastructure` and `deployment` each require 41 decisions, none yet approved. **No baseline exists and none can be authorized until an approver is enrolled and the phase is raised by a human.** See [READINESS-REPORT](../baselines/READINESS-REPORT.md) and [DEPENDENCY-MATRIX](../baselines/DEPENDENCY-MATRIX.md).

## Limitations

1. **CI cannot prevent local actions** and cannot stop a push that bypasses it. Branch protection is unavailable on this plan (T14), so the check is advisory until it is enabled and made required.
2. The workflow has **never run on GitHub**.
3. Review-record signatures are verified in CI only when public keys are supplied; otherwise "not verified" is printed.
4. A pull request that first introduces the gate is judged by itself (no base copy exists); the workflow warns.
5. A push-to-main run detects a violation after the fact.
6. The gate groupings are a **proposal**, derived from the Phase 1 blocker report and ADR 0020, which are themselves not approved.
7. Two approval systems coexist (the Studio's Entra access policy and the harness approver registry); baselines use the harness one because CI can verify it with public keys.
8. `requirements-without-decisions` is computed globally, not per area.
9. "Blocking tasks" relies on the Work Queue's `blocksBuild` flag.
10. The Studio has no write path for baselines by design; the CLI generates and a person signs.
11. With one person as owner, segregation of duties cannot be satisfied for authorization (T65).
12. Authorizing a baseline does not raise the phase (HC-11); both are required.
