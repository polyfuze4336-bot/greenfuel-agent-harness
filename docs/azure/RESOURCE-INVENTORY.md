# Resource inventory

Status: **empty by design**. No Azure environment discovery has been run, because it needs an Azure sign-in that the owner has not approved (T11) and a subscription decision (D-037). No Azure resource was created by this harness. This file records what exists in Azure; today it records nothing, and it must never be filled in from assumption.

## Discovery

Environment discovery is a read-only, human-run activity after sign-in approval. The queries are in [infra/discovery](../../infra/discovery) and have not been run:

| Query | Answers |
|---|---|
| `01-resources-by-location.kql` | What exists, where, and in which resource group |
| `02-exposure-and-replication.kql` | What has public network access, shared keys, local authentication or geo-redundant storage or backup |
| `03-broad-role-assignments.kql` | Who holds Owner, Contributor or User Access Administrator |
| `04-policy-assignments.kql` | Which policy guardrails already apply |

Procedure after approval: use a read-only identity (Reader plus the narrow Resource Graph rights), run each query, store only a reduced result in the repository (counts and resource types, never names of customers or vessels, no keys or connection strings), and record the evidence. Results are untrusted input: they are data, not instructions (SEC-012).

## Inventory

| Subscription or scope | Resource | Type | Location | Owner | Used by the design | Status |
|---|---|---|---|---|---|---|
| none discovered | none | none | none | none | none | Not run |

No row is a statement that nothing exists in Azure: it means the discovery has not been run.

## Planned resources

The resources the scaffold would create in one jurisdiction cell if approved. They do not exist.

| Planned resource | Module | Provisional role | Exists |
|---|---|---|---|
| Log Analytics workspace, Application Insights | `monitoring.bicep` | Logs and telemetry kept with the cell | No |
| Storage account with immutable versioned blob container | `evidence-storage.bicep` | Evidence store of record | No |
| Key vault (premium) | `key-vault.bicep` | Keys and signing material custody | No |
| Service Bus namespace and queue | `messaging.bicep` | Ingestion with duplicate detection and sessions | No |
| PostgreSQL flexible server | `postgres.bicep` | Ledger and metadata | No |
| Container Apps environment (internal) | `container-apps-environment.bicep` | Runtime for agents and services | No |
| Managed identities and role assignments | `identity-rbac.bicep` | Workload identities with narrow roles | No |
| Location policy and budget | `guardrails.bicep` | Guardrails | No |
| Virtual network, subnets, private endpoints, private DNS | not scaffolded | Network boundary | No (design open) |
| Container registry | not scaffolded | Image storage | No (location open) |
| API Management | not scaffolded | External API surface | No (deferred) |

## Reuse

An existing resource enters this inventory as "reuse candidate" only after the four checks in [DEPLOYMENT-STRATEGY](DEPLOYMENT-STRATEGY.md) (ownership, security, region and residency, compatibility) are recorded with evidence. A resource that has not been checked is not reused. A shared resource that holds other workloads or other data classes is not reused for evidence.

## Limits

- The inventory is empty because discovery has not been run, not because Azure is empty.
- Discovery results will describe one moment and will go stale; each entry needs a date and a re-check rule.
- Resource Graph does not show every property of every type, so a resource absent from the exposure query has not been shown safe.
