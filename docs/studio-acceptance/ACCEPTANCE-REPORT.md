# Final acceptance report: Architecture Decision Studio

**Date:** 2026-10-30 · **Commit tested:** `b5b614b` (documents added in `cb5e84b`; both pushed to `main` after your approval) · **Assessor stance:** independent examiner, evidence over assertion.

## Verdict

> ## NOT ACCEPTED as a deployed, release-ready application.
> ## ACCEPTED, with stated limits, as a locally verified application.

The request says: *"Do not declare success until the complete workflow has been tested using the deployed application."* **There is no deployed application.** Azure deployment requires your explicit approval and inputs that do not exist yet (subscription, region decision, Entra tenant, GitHub App, host choice for PowerPoint rendering), and no Azure resource was created or queried. So success is **not declared**.

What *is* established, with evidence: the complete 20-step workflow and 12 negative tests pass end to end against the production build of the Studio running locally, in a throw-away repository world with a bare git remote and a simulated pull-request service ([TEST-REPORT](TEST-REPORT.md)).

## Summary of evidence

| Area | Result | Where |
|---|---|---|
| 20-step workflow, new ADR to exported deck | **20 of 20 pass locally** (some steps use simulation, see below) | [TEST-REPORT](TEST-REPORT.md) |
| 12 negative tests | **12 of 12 pass** | [TEST-REPORT](TEST-REPORT.md) |
| Regression | Root 1086/1086; Studio unit 373/373; Playwright 225 passed, 1 pre-existing skip, 0 failed; `validate` OK | [TEST-REPORT](TEST-REPORT.md) |
| Security | Independent review: no reportable vulnerability; API probe 90/90; `npm audit` 0; secret scan 0; 3 hardening fixes made; 4 items open | [SECURITY-REPORT](SECURITY-REPORT.md) |
| Performance | Measured, local, single user; decision detail p95 3.4 s is the weak point | [TEST-REPORT](TEST-REPORT.md) |
| Deployment | **Not done** | [DEPLOYMENT-PLAN](DEPLOYMENT-PLAN.md) |
| Sample deck | Committed, editable, PowerPoint-rendered, marked SAMPLE | `docs/capstone/presentation/pptx/deck-7faeb8c-20261030T171910/` |

## Deliverables requested

| Deliverable | Status |
|---|---|
| Azure application URL | **None: not deployed** |
| Architecture documentation | [ARCHITECTURE](ARCHITECTURE.md) (as built; the Azure part is a design only) |
| GitHub integration documentation | [GITHUB-INTEGRATION](GITHUB-INTEGRATION.md), [GITHUB-SYNC](../architecture-studio/GITHUB-SYNC.md) |
| Approval workflow guide | [APPROVAL-WORKFLOW-GUIDE](APPROVAL-WORKFLOW-GUIDE.md) |
| Test report | [TEST-REPORT](TEST-REPORT.md) |
| Security report | [SECURITY-REPORT](SECURITY-REPORT.md) |
| Operational runbook | [RUNBOOK](RUNBOOK.md) |
| Sample generated deck | The committed sample above. **No final deck exists**; see below |
| Capstone readiness assessment | [CAPSTONE-READINESS-ASSESSMENT](CAPSTONE-READINESS-ASSESSMENT.md) |

## What the tests did not prove (read before relying on anything)

1. **Simulated, not real:** Entra ID (a stand-in token issuer), the GitHub App and pull-request service (a simulator and a bare remote), merge (a fast-forward of the remote), repository validation on a pull request (the real validator run by the test, **not GitHub Actions**), and people (test identities).
2. **Synthetic world data:** the supporting ADRs and reviews were pre-marked approved as text, and the baseline policy was reduced to two gates. The 22 validator failures in that world are the validators correctly refusing those text-only approvals; the test proves the pull request adds none.
3. **The real repository is not ready to be frozen.** Today it has 57 decisions: 13 Approved, 37 Pending Review, 1 Proposed, 6 Blocked, 0 Rejected, 0 Deferred. The build gate is blocked: phase 0, no enrolled architecture-class approver, ADR-0020 Proposed, no baseline. Seven decisions the deck presents (ADR-0004, 0015, 0016, 0017, 0018, 0019 and 0020) are not approved. **A real final deck cannot be produced today**; the final deck in the test was produced only inside the acceptance world.
4. **GitHub Actions:** after you approved the push, `validate` and `architecture-gate` both **succeeded on GitHub for commit `cb5e84b`** (`validate` also succeeded on 20 earlier pushes). That proves the checks pass on GitHub's runners; it does **not** show the gate blocking an unauthorized implementation change on GitHub (that is shown only by local tests), and no pull-request-triggered run was exercised. **No branch protection** (plan limitation).
5. **Final-deck rendering needs Windows PowerPoint.** A Linux host cannot meet the final-deck `qa` gate. This changes the deployment design.
6. Slide approvals are unsigned; accessibility of the generated deck (alt text, reading order) and a human design review were not done.
7. Performance numbers are one user on one machine; decision detail has a 3.4 s p95 and one search sample took 2.3 s; neither was root-caused.
8. Security evidence is one automated review, a black-box probe and tests; not a penetration test.

## Defects and gaps found by this examination

| Ref | Finding | Resolution |
|---|---|---|
| F-1 | Deck export did not verify the file against its generation record | Fixed; tested |
| F-2 | `materialize` path containment gap (LOW) | Fixed |
| F-3 | Authentication defaulted to development sign-in if the mode setting was forgotten | Fixed with `STUDIO_REQUIRE_ENTRA=1`; deployments must set it |
| F-4 | Step-up sign-in relies on `iat` rather than `auth_time` (MEDIUM, 6/10) | Open |
| F-5 | Sync and reconcile need a session but no role; idempotency lookup not caller-scoped; refresh routes lack an Origin check (all LOW) | Open |
| F-6 | Decision detail p95 3.4 s | Open, not investigated |
| F-7 | Final deck needs Windows PowerPoint | Open design decision |
| F-8 | CSP allows `'unsafe-inline'` for scripts and styles | Open |

## Approval needed from you

1. **Azure deployment.** Not started. To proceed I need: written approval to raise the phase and create billable resources (T36, HC-11); subscription and resource group; the region decision; whether to reuse existing approved resources (none have been inventoried); the Entra tenant and who can create the app registration; the GitHub App; and the PowerPoint rendering host decision ([DEPLOYMENT-PLAN](DEPLOYMENT-PLAN.md)).
2. ~~Pushing the local commits~~ **Done on your instruction**: fast-forward of `main` from `140c398` to `cb5e84b`; nothing else was pushed.
3. **Which open findings to fix** before any deployment (F-4 to F-8).
4. The architecture decisions that block a real baseline: ADR-0004 and 0015-0020, enrollment of an architecture-class approver, and the phase raise.

## Stopping point

Stopped after the final acceptance report, as instructed. The conditional verdict becomes a full acceptance only when the workflow is re-run on a deployed application and the "not proven" items above are exercised.
