# Cost and capacity

Status: proposed, Phase 0. **No cost has been estimated, no price has been looked up and no quota has been checked.** Any figure written now would be invented (HC-12, NFR-019), because the volumes, the ports, the SKUs and the budget are all undecided. This document defines how an estimate will be made and controlled, what it needs, and what stops spend.

## Not estimated

| Item | Why there is no figure |
|---|---|
| Monthly run cost per jurisdiction cell | No SKU, volume, retention, redundancy or region is decided |
| Cost of the edge or on-premises evidence store | The edge platform and hardware ownership are open (D-018, D-010) |
| Cost of model use | The models, deployment types and prompt volumes are open (D-028) |
| Non-production cost | The number and scale of environments is open (D-037) |
| Budget | The cost envelope is open (D-034) |
| Capacity and quotas | No target volume or response time exists (D-031, NFR-014, NFR-015); regional quota is not checked |

## Cost drivers

Qualitative only. These are what will move the cost, so each needs an owner and a measured or agreed input before an estimate exists.

| Component | What drives its cost | Input needed |
|---|---|---|
| Log Analytics and Application Insights | Ingested volume and retention | Retention rule per data class (D-016), log volume per delivery |
| Evidence storage | Stored volume, versions kept under immutability, transactions, redundancy | Evidence size per delivery, deliveries per period, retention |
| PostgreSQL | Compute tier, storage, high availability, backup retention | Ledger write rate, query load, recovery targets |
| Service Bus | Tier and capacity units, zone redundancy, message volume | Event rate per delivery, peak concurrency (D-031) |
| Container Apps | Active and idle replicas, vCPU and memory, jobs | Number of services and agents, scaling rules |
| Key custody | Vault tier, hardware-backed keys, operations | Signing rate, key types (D-013) |
| Model use | Tokens, deployment type, any provisioned capacity | Agent usage, prompt sizes, grounding approach |
| Networking | Private endpoints, data processed through them, egress, any firewall or gateway | Network design, cross-boundary flows (D-011) |
| Edge or on-premises | Hardware, support, connectivity | Platform and ownership (D-018, D-010) |
| Duplicated cells | Each jurisdiction is a cell, so fixed costs repeat per jurisdiction | Number of jurisdictions (D-003) |
| Non-production | Environments that are always on | Environment plan (D-037) |

Sovereignty changes cost structure: jurisdiction-local cells repeat fixed costs, redundancy stays in the jurisdiction, and some capabilities may not exist in a region. The cheapest design is not assumed to be allowed.

## How an estimate will be made

1. Fix the inputs above from stakeholders or measured data and record each with its source. An assumption is labelled as one.
2. Take unit prices from an official source at a recorded date: the Azure pricing calculator and the Azure Retail Prices API. Prices differ by region and currency, so the estimate is per region.
3. Compute per cell and per environment, and show the arithmetic so a reviewer can reproduce it.
4. Record the result in `docs/azure/data/cost-estimate.json` with inputs, price sources, date and owner. The readiness gate DG-07 stays a blocker until that file exists.
5. Re-estimate when an input or a decision changes. An estimate older than the last design change is stale.

## Budget

Controls designed now, all unapplied:

- A **budget per environment** with alert thresholds, in [guardrails.bicep](../../infra/modules/guardrails.bicep); the amount and recipients are required parameters with no default.
- **Tags** for environment and jurisdiction on every resource, so cost can be split; no customer or vessel names in tags.
- **Policy** to restrict locations and, when sizes are decided, allowed SKUs, so a larger resource cannot be created by mistake.
- **Approval** for any billable change (DG-08), so spend does not begin without a recorded approval.
- A **cost review** at each gate and on a schedule once running, owned by the programme owner.
- Auto-shutdown or scale-to-zero for non-production is a design option, not a decision.

## Capacity

- Capacity requirements come from D-031 (volumes, availability, recovery and latency targets) and NFR-014 and NFR-015, all open. No target is invented.
- Quotas and regional limits for each service must be checked live in the approved subscription before any deployment (DG-03). Quota is per subscription and per region, so a jurisdiction with few regions may bind first.
- Capacity tests need a deployed non-production environment and an agreed load model; none exists, so no test is claimed.

## Limits

- Everything above is method. It is not an estimate, a quote or a commitment.
- Price and quota data are not retrieved or verified.
- A budget alert warns; it does not stop spend. A hard stop needs an automation that has not been designed or approved.
