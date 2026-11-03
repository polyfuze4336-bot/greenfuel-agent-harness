# Architecture Decision Studio: documentation index

The Studio is a web application in [`apps/architecture-studio/`](../../apps/architecture-studio/). It reads the decisions, tasks and approvals in this repository, lets authorized people review and approve decisions one at a time through reviewed pull requests, computes build readiness and builds an editable presentation. **It is governance tooling, not the bunkering application.**

## Start here

| If you want to | Read |
|---|---|
| Run it | [RUNBOOK](../studio-acceptance/RUNBOOK.md) (local steps, settings, failure guide) |
| Know what is verified and what is not | [ACCEPTANCE-REPORT](../studio-acceptance/ACCEPTANCE-REPORT.md) |
| Understand the current state and its problems | [CURRENT-STATE-AUDIT](CURRENT-STATE-AUDIT.md) |
| See where it is going | [TARGET-ARCHITECTURE](TARGET-ARCHITECTURE.md), [SIMPLIFICATION-PLAN](SIMPLIFICATION-PLAN.md) |
| Judge "done" | [PRODUCT-ACCEPTANCE-CRITERIA](PRODUCT-ACCEPTANCE-CRITERIA.md) |
| See the four-destination interface, its performance numbers and screenshots | [FRONTEND-ACCEPTANCE](FRONTEND-ACCEPTANCE.md) |
| Understand how each kind of decision is read and treated (architecture choice, stakeholder clarification, regulatory verification) | [DECISION-WORKSPACE](DECISION-WORKSPACE.md) |
| See what a decision would affect, and challenge it as a review panel would | [IMPACT-AND-EXAMINER](IMPACT-AND-EXAMINER.md) |
| Approve a decision | [APPROVAL-WORKFLOW-GUIDE](../studio-acceptance/APPROVAL-WORKFLOW-GUIDE.md) |
| See how an approval reaches GitHub, how it is checked against GitHub, and what proves it | [APPROVAL-WRITEBACK](APPROVAL-WRITEBACK.md) |
| See how the next best action, work queue, readiness and freshness are decided | [NEXT-BEST-ACTION](NEXT-BEST-ACTION.md) |

## Reference, by topic

| Topic | Document |
|---|---|
| Decision register and normalization | [DECISION-INTELLIGENCE](../architecture-studio/DECISION-INTELLIGENCE.md) |
| Review workflow | [REVIEW-WORKFLOW](../architecture-studio/REVIEW-WORKFLOW.md) |
| GitHub synchronization | [GITHUB-SYNC](../architecture-studio/GITHUB-SYNC.md), [GITHUB-INTEGRATION](../studio-acceptance/GITHUB-INTEGRATION.md) |
| Authentication, roles, segregation of duties | [ACCESS-CONTROL](../architecture-studio/ACCESS-CONTROL.md) |
| Work queue | [WORK-QUEUE](../architecture-studio/WORK-QUEUE.md) |
| Baseline and build gates | [BASELINE](../architecture-studio/BASELINE.md) |
| Presentation Studio | [PRESENTATION-STUDIO](../architecture-studio/PRESENTATION-STUDIO.md) |
| Tests and security | [TEST-REPORT](../studio-acceptance/TEST-REPORT.md), [SECURITY-REPORT](../studio-acceptance/SECURITY-REPORT.md) |
| Deployment (design only, not executed) | [DEPLOYMENT-PLAN](../studio-acceptance/DEPLOYMENT-PLAN.md), [ARCHITECTURE](../studio-acceptance/ARCHITECTURE.md) |

The reports live in two older folders, `docs/architecture-studio/` and `docs/studio-acceptance/`. They are linked from here rather than moved, because other documents and generated files cite those paths. Consolidation is a later step in the [SIMPLIFICATION-PLAN](SIMPLIFICATION-PLAN.md).

## Status in one paragraph

Acceptance-tested locally with synthetic data; **not deployed**; its approval workflow has **not yet been used for a real approval** (no approver key is enrolled). Phase A (performance, CI, console errors, documentation, ruleset) is in [PHASE-A-RESULTS](PHASE-A-RESULTS.md); Phase B (design-gate equivalence, harness bridge, smaller pages) is in [PHASE-B-RESULTS](PHASE-B-RESULTS.md). The Azure deployment is in [AZURE-DEPLOYMENT](../studio-acceptance/AZURE-DEPLOYMENT.md).
