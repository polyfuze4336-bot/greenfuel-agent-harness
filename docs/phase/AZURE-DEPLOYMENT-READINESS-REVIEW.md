# Azure deployment request: readiness review and blocker report

Date: 2026-10-29. Status: **deployment not performed and not permitted.** Nothing was created, changed or billed in Azure. This is the formal readiness review the request asked for; its outcome is **NOT READY**.

## 1. Outcome in one paragraph

There is no application to deploy: phase 0 is in force, the only code is the candidate oracles in `harness/contracts/`, and the infrastructure is a non-deployable scaffold ([ADR 0014](../adr/0014-azure-readiness-scaffold-and-provisional-selection.md)). The deployment-readiness gate computes **NOT-READY** (evidence [EV-0076](../evidence/records/EV-0076.json), exit code 2, recorded as the gate's output and not as a pass). No human approver is enrolled, so no signed approval of any class can exist, and the owner deferred Azure deployment (T36). Read-only discovery was possible and was done. Load tests, resilience tests, observability measurements and a three-year measured cost cannot exist for a system that does not exist, and none is fabricated here.

## 2. Read-only discovery (done)

An Azure CLI session was already signed in; the harness did not sign in. Only list and show commands were run. Subscription and tenant identifiers are deliberately not recorded in this repository.

| Finding | Observation | Consequence |
|---|---|---|
| Subscriptions visible | 8 enabled; the default is a Microsoft-managed sandbox-style subscription; the others are unrelated programme subscriptions | The subscription and landing zone are an owner decision (D-037). None is approved for this programme |
| Resource groups in the default subscription | 23, for unrelated projects, in Southeast Asia, East US 2, East US, West US 2 and West US 3 | None belongs to this programme |
| Existing resources | Many unrelated Container Apps, Key Vaults, storage accounts, SQL databases, App Service plans, Cognitive Services accounts, managed identities and workspaces | See section 3 |
| Policy assignments (subscription scope) | 4: a jailbreak-safety control and three Defender for Cloud assignments | No allowed-locations, no-public-access or deny-effect residency policy was seen, so **no policy enforces residency** here |
| Quotas, regional availability, prices for target SKUs | **Not queried.** Quota and availability checks are only meaningful for a chosen region and SKU set, and none is approved | Open (DG-03) |

## 3. Reuse of existing resources

**Verdict: reuse nothing.** The gate's rule is ownership, security, region and compatibility checks first. For every discovered resource, ownership is not established as this programme's, they belong to other projects with unknown owners, and the region is not decided. Reusing a shared Key Vault, workspace, identity or database would also mix this programme's evidence and customer data with other workloads, which conflicts with shipowner isolation (HC-02) and jurisdiction-bound storage (HC-01). The only candidates worth a later look are tenant-level assets such as a shared container registry or a DNS zone, and only after the owner names them.

## 4. Sovereignty

| Question | Answer |
|---|---|
| Is a port jurisdiction named? | **No** (D-003). Without a port there is no residency assessment |
| Does the default subscription's region satisfy residency? | **Not determinable and not assumed.** A region name is not residency proof (HC-01). Southeast Asia is the dominant region in this subscription, but whether it meets any port's boundary depends on the legal reading (D-009), the hosting model (D-010), and replication, backup, log, support and inference locations, none of which are decided or verified |
| Is this subscription suitable for production evidence? | **No evidence it is.** It is a sandbox-style subscription shared with unrelated workloads, and no residency policy is assigned |
| Fallback | As designed in [DES-0003](../architecture/designs/DES-0003-target-system-architecture.md): where compliant Azure residency cannot be shown, keep sovereign evidence in an approved local or on-premises cell and send only approved flows to Azure ([12](../target-architecture/12-DATA-MOVEMENT-AND-RESIDENCY-VALIDATION.md)). No edge platform is chosen (D-018) |

## 5. Gate result (DG-01 to DG-12)

From [EV-0076](../evidence/records/EV-0076.json). Each line is a blocker that only a person or an upstream stage can clear.

- Phase 0; raising it is a human decision (DG-12, T53).
- No design review is Approved: RV-0001, RV-0002 and RV-0003 are Blocked (DG-01).
- No port (D-003), residency reading (D-009), hosting model (D-010), tamper evidence and key custody (D-013), inference location (D-028), availability and recovery targets (D-031), operating model (D-033), edge platform (D-018), tenant and landing zone (D-037) are decided.
- No approver is enrolled; the registry has 0 trusted approvers, so no signed approval exists for any billable change (DG-04, T13, T53).
- Scoped deployment identities, the custom role, locks and policy do not exist (DG-04, T17).
- All three parameter files still contain unresolved `REQUIRES-APPROVAL` values (DG-05).
- No what-if result exists for any environment (DG-06).
- No live region and service availability verification exists (DG-03).
- No application exists to deploy (phase 0).

## 6. Status of every requested output

| Requested output | Status | Reason |
|---|---|---|
| Deployment evidence | **Not applicable: no deployment** | Only the gate result (EV-0076) exists |
| Azure resource inventory | Discovery summary in section 2 only. [RESOURCE-INVENTORY](../azure/RESOURCE-INVENTORY.md) remains a plan | Nothing of this programme exists in Azure |
| Architecture deployment diagram | Exists as a design: [03 views](../target-architecture/03-ARCHITECTURE-VIEWS.md) and the [Azure reference architecture](../azure/AZURE-REFERENCE-ARCHITECTURE.md) (proposed, unverified) | A diagram of deployed resources cannot exist |
| Operational dashboard, SLO dashboard | **Not built** | There is no telemetry to chart; a dashboard of invented values would violate HC-12. Their content is specified in section 7 |
| Performance report | **Not produced** | No system to load; no benchmark invented. The workload specification is in section 8 |
| Resilience test report | **Not produced** | Nothing to restart or break. The test list is in section 9. The oracles' failure behaviour (replay, duplicates, send failure, and similar) is already covered by unit tests (EV-0075) and is not a service resilience result |
| Three-year cost model | Existing [business value model](../business/BUSINESS-VALUE-MODEL.md) holds a scenario operating cost with Azure list prices as the only verified input. Cost per delivery and per certificate are scenario outputs there | A measured model needs the chosen SKUs, regions, volumes (D-004, D-005) and inference usage. Not extended with invented figures |
| Runbooks | Existing [OPERATIONS-AND-DR](../azure/OPERATIONS-AND-DR.md) and [runbooks](../runbooks) are templates. They are untested | A runbook is not verified until it has been executed |

## 7. What the observability and SLO design must contain (specification, not measurement)

Instrumentation can only be written once the application exists. The specification below is what the future build must satisfy, so its acceptance can be tested.

- **One correlation id** from device event through ingestion, validation, calculation, certificate issue and portal view, carried as a trace context and a log field, never containing customer content.
- **Spans and metrics:** ingestion, evidence validation, calculation, certificate generation, approval wait, agent tool call (name, outcome, latency, denial reason), model call (tokens in and out, latency, error, version), queue depth and age, retries and dead-letters, database latency and connection use, and resource utilisation.
- **Logs:** structured, hash or identifier only for hostile or customer values, kept inside the cell's jurisdiction (SEC-014).
- **SLIs** to be defined for the seven requested areas (delivery ingestion, evidence availability, certificate turnaround, portal availability, data integrity, recovery time, recovery point). **Target values are not proposed here.** They depend on D-031 and on baselines (BR-008) that nobody has measured, and choosing them now would be inventing figures.

## 8. Load-test specification (to be run later, against a deployed non-production stack)

Synthetic only (DATA-009). Each run records the workload definition, build id, environment, SKU and region so it can be repeated: event rate and batch size, delivery count and duration, share of duplicate and out-of-order events, size of evidence payloads, concurrent portal users, and shipowner count. Report throughput, p50, p95 and p99 latency, failure rate and scaling behaviour, from the tool's raw output kept as evidence. A result without its raw output is not accepted.

## 9. Resilience-test list (to be run later, non-production only)

Service restart; queue backlog and drain; database unavailable and failover; edge connectivity loss and catch-up with no loss or duplication; duplicate event delivery; agent timeout; model endpoint failure with the deterministic path still working (AGT-010). Each test states the expected outcome before it runs and keeps the observed result, including failures.

## 10. What is needed from the owner, in order

1. **Phase and approver** (T53): enroll as approver, sign the phase decision. Until then no Azure change is allowed by the harness.
2. **Decisions** that the gate lists: D-003 (ports), D-009, D-010, D-013, D-018, D-028, D-031, D-033, D-037 (subscription and landing zone). Answer or explicitly defer each.
3. **Whether to approve read-only live verification** of regions, SKUs, quotas and prices for the chosen candidates (DG-03). This is the only Azure step that could be taken before any billable approval.
4. **A dedicated subscription** for this programme (or a named landing zone), not the shared sandbox, with a residency policy assigned.
5. **Then, and only then,** an application to deploy (the Phase 1 slice, T53 and T54), a what-if per environment, and a signed approval for each billable change.

Deployment will not be started by this harness without those, and production deployment is never automatic (HC-11).
