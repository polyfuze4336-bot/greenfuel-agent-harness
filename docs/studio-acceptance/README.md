# Studio acceptance

Start with the **[ACCEPTANCE-REPORT](ACCEPTANCE-REPORT.md)**: verdict *not accepted as a deployed application* (nothing is deployed); locally verified.

| Document | Purpose |
|---|---|
| [ACCEPTANCE-REPORT](ACCEPTANCE-REPORT.md) | Verdict, what is and is not proven, approvals needed |
| [TEST-REPORT](TEST-REPORT.md) | 20-step workflow, 12 negative tests, performance |
| [SECURITY-REPORT](SECURITY-REPORT.md) | Review findings, probe, dependencies, secrets, controls and limits |
| [ARCHITECTURE](ARCHITECTURE.md) | Studio as built; Azure design (not built) |
| [GITHUB-INTEGRATION](GITHUB-INTEGRATION.md) | What the run exercised in GitHub sync and what it did not |
| [APPROVAL-WORKFLOW-GUIDE](APPROVAL-WORKFLOW-GUIDE.md) | For approvers |
| [RUNBOOK](RUNBOOK.md) | Run, configure, operate, troubleshoot |
| [DEPLOYMENT-PLAN](DEPLOYMENT-PLAN.md) | Not executed; inputs and approval needed |
| [CAPSTONE-READINESS-ASSESSMENT](CAPSTONE-READINESS-ASSESSMENT.md) | Effect on capstone readiness |

Raw evidence: [measurements.json](measurements.json) (written by the acceptance spec; machine, timings, hashes), [api-probe.json](api-probe.json) (90 probe results and latency), and step screenshots (`step-*.png`, `final-deck-slide-*.png`). Re-create with `npx playwright test e2e/acceptance.spec.ts` and `node scripts/api-probe.mjs` in `apps/architecture-studio`.

The acceptance world is **synthetic**: its approvals prove a mechanism, not a real decision. Never present them as real approvals.
