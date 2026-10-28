# Operations and disaster recovery

Status: proposed, Phase 0. **Nothing is deployed, so no monitor, alert, runbook, backup or recovery procedure has been run or tested.** This document specifies what operations and recovery must provide and what each needs before it can be claimed. Availability, recovery-point, recovery-time and latency targets are open (D-031) and no figure is invented here (HC-12).

## Monitoring

| Need | Design | Not yet decided or verified |
|---|---|---|
| Logs and metrics stay with the data they describe (DC-14) | One workspace per jurisdiction cell, in the cell's region; diagnostics from every resource go to it ([monitoring.bicep](../../infra/modules/monitoring.bicep)) | That the chosen region meets D-009 for logs; whether a log may cross a boundary (D-011) |
| No sensitive data in telemetry | Telemetry is classified; names of customers or vessels and measurement payloads are not logged; redaction before emit | A logging standard for the application; a test that scans emitted logs |
| Application and dependency health | Application Insights workspace-based, local authentication off | Instrumentation: no application exists |
| Evidence-pipeline health | Alerts on ingestion lag, dead-letter growth, duplicate-detection hits, sequence gaps, clock-skew quarantines (ADR 0013) | Thresholds: no target is agreed (D-031) |
| Edge health | Edge reports its last synchronisation, queue depth and clock status; a silent edge is an alert, not an assumption | The edge platform (D-018) |
| Audit | Every approval, every agent action and every denial is recorded and tamper-evident; reconstruction of a delivery from the audit store is a test (EVAL-PRD-OBS-001, pending) | The audit store design |
| Security signals | Entra sign-in and role-change logs, key operations, policy denials, resource lock changes | Where security tooling runs relative to the jurisdiction |
| Cost | Budget alerts per environment ([guardrails.bicep](../../infra/modules/guardrails.bicep)) | The budget (D-034) |

Alert rules, dashboards and their thresholds are not created. Who is paged, and in which jurisdiction they sit, depends on the operating model (D-033).

## Disaster recovery

The default design keeps every copy of jurisdiction-bound data inside the jurisdiction. That makes disaster recovery **within** the jurisdiction the baseline and cross-region recovery a decision, not a default.

| Layer | Baseline design | Open |
|---|---|---|
| Evidence blobs | Locally or zone redundant only (a geo-redundant SKU is refused by the validator); immutable versions; no permanent delete | Whether a second region **in the same jurisdiction** exists and may hold a copy |
| Ledger database | High availability inside the region as allowed by the SKU; backups kept in region; geo-redundant backup off | Recovery targets (D-031); whether a restore in a second in-jurisdiction region is possible |
| Messaging | Zone redundancy where the tier supports it; the edge buffer is the second copy of events | Replay rules after a failure; idempotent sync is tested by contract (NFR-005) |
| Keys and certificates | Key custody in the jurisdiction (HC-03); backup and recovery of keys are part of the key ceremony; certificates can be verified offline from a signed bundle | HSM choice and ownership (D-013) |
| Edge | Store-and-forward with a local append-only store; the edge can keep capturing while the shore is down (HC-07) | Maximum disconnection and permitted offline actions (D-020) |
| Control plane and IaC | The repository and reviewed templates recreate a cell; recreation never copies data across a boundary | Where the pipeline runs and what it can see |
| Customer-visible service | Customer compliance answers can be degraded, never fabricated: the agent says it cannot answer | The degraded-mode behaviour per agent |

**When no second in-jurisdiction region exists,** the options are zone redundancy within the one region, immutable backups in the jurisdiction, and the edge store as a recovery source; a recovery in another jurisdiction needs the legal basis and the approved flow (D-009, D-011) and is otherwise refused. Recovery locations for every layer are named per port in the [sovereignty matrix](SOVEREIGNTY-DEPLOYMENT-MATRIX.md); an unnamed location is a blocker.

Recovery testing: a restore and a failover exercise inside the jurisdiction, with a check that evidence hash chains, certificate verification and lineage are intact afterwards (EVAL-PRD-REL-002, pending). None has run.

## Runbooks

To be written and exercised in non-production before any production claim. Each names an owner, preconditions, steps, a verification, a rollback and an evidence record.

| Runbook | Covers |
|---|---|
| Deploy a cell | Approved template, what-if review, signed approval, deploy, smoke test |
| Roll back a deployment | Previous reviewed commit, what-if of it, application revision rollback |
| Edge outage and resynchronisation | Detect, keep capturing, resynchronise idempotently, reconcile sequence and clock status |
| Evidence integrity alarm | Quarantine, preserve, notify the quality manager, never repair in place |
| Restore evidence or ledger | In-jurisdiction restore, integrity verification, record |
| Key event | Rotation, suspected compromise, recovery of custody; P4 handling |
| Support access | Who may touch a cell from where, with time-limited approval and a recorded session (D-033, break-glass) |
| Incident response and notification | Roles, evidence preservation, notification duties by jurisdiction (not yet identified) |
| Cost and quota event | Budget alert, quota exhaustion |
| Decommission a cell | Retention, legal hold and destruction rules (D-016), approval as P4 |

## Limits

- No runbook exists; the table is a list of what must exist.
- No monitoring, alert, backup or recovery is configured. The scaffold sets diagnostics and locks only.
- Recovery objectives are open, so "meets recovery targets" cannot be said of any design.
- Support access across jurisdictions, vendor access and notification duties are unverified; they are validations in the sovereignty matrix.
