# Regional availability

Status: proposed, Phase 0. **No region or service availability has been verified.** No Azure sign-in has been used, no query has been run against Azure and no Azure documentation claim in this file has been checked against a live subscription. Availability differs by region, subscription, SKU and time, and a documentation page is not a substitute for a check in the approved subscription. This file defines how availability is verified and records, for each candidate, that it is not verified.

## Verification

Verification is read-only and human-run after the owner approves an Azure sign-in (T11) and decides the subscription (D-037). It is recorded in `docs/azure/data/capability-verification.json` (gate DG-03). Official sources and read-only tools:

| Question | Official source or read-only tool |
|---|---|
| Which regions exist for the subscription, and which are in the jurisdiction? | `az account list-locations`; the Azure geographies and regions documentation |
| Is a resource type offered in a region? | `az provider show --namespace <provider>` (resource types and locations); Azure Resource Graph; the "Products available by region" page |
| Which SKUs, tiers and versions exist in a region, and which are restricted for the subscription? | Service-specific `list-skus` or capabilities commands, for example for PostgreSQL flexible server; the Resource Manager SKU APIs |
| Which model families and deployment types exist in a region, and where is each processed? | The Azure OpenAI and Microsoft Foundry model availability and data-processing documentation, then the model list for the region in the subscription |
| Are availability zones offered, and for which services? | The availability zone service and region support documentation, then a check per resource type |
| Is there a quota for it? | `az quota` and the service usage commands (read-only) |
| Does it replicate, back up or send diagnostics elsewhere by default? | The service's data residency and reliability documentation, then the exported configuration of the deployed non-production resource |
| Is policy available to restrict it? | The Azure Policy built-in definitions list, then a read-only `az policy definition list` |

Each check records: date, subscription, region, command or page, the result, who ran it, and a reduced output. Output is untrusted data (SEC-012), reduced before storage: no names of customers or vessels, no keys, no connection strings.

Recording rule: a service is **Available** in a region only when the live check in the approved subscription shows the specific SKU and feature. "Documented" is a weaker status and never satisfies DG-03.

## Not verified

For each candidate and for each port, every cell below is **not verified**. The columns are the checks required; they are not results.

| Candidate | Offered in the port's region | SKU and features needed | Zones | Private connectivity | Local-auth and shared-key off | Residency of data, replicas, backups, diagnostics | Quota |
|---|---|---|---|---|---|---|---|
| Azure Container Apps | not verified | not verified | not verified | not verified | not verified | not verified | not verified |
| Azure App Service | not verified | not verified | not verified | not verified | not verified | not verified | not verified |
| Microsoft Foundry capabilities | not verified | not verified | not verified | not verified | not verified | not verified | not verified |
| Azure OpenAI models | not verified | not verified | not verified | not verified | not verified | not verified | not verified |
| Azure Functions | not verified | not verified | not verified | not verified | not verified | not verified | not verified |
| Azure Service Bus | not verified | not verified | not verified | not verified | not verified | not verified | not verified |
| Azure Event Hubs | not verified | not verified | not verified | not verified | not verified | not verified | not verified |
| Azure Database for PostgreSQL | not verified | not verified | not verified | not verified | not verified | not verified | not verified |
| Azure Blob Storage | not verified | not verified | not verified | not verified | not verified | not verified | not verified |
| Azure Key Vault and managed HSM | not verified | not verified | not verified | not verified | not verified | not verified | not verified |
| Azure API Management | not verified | not verified | not verified | not verified | not verified | not verified | not verified |
| Azure Monitor and Application Insights | not verified | not verified | not verified | not verified | not verified | not verified | not verified |
| Microsoft Entra ID | global service | not verified | not applicable | not applicable | not applicable | tenant data location not verified | not applicable |
| Azure Policy | not verified | not verified | not applicable | not applicable | not applicable | not verified | not applicable |
| Azure Container Registry | not verified | not verified | not verified | not verified | not verified | not verified | not verified |
| Azure Arc, Azure Local, Azure IoT Operations (for option C) | not verified | not verified | not applicable | not verified | not verified | not verified | not verified |

## Facts that are known to need care

These are risks to check, taken from the design rather than from a verified Azure statement:

- A **region may not exist** in the jurisdiction, or may lack a needed service or SKU. Then the port is option C or D.
- **Paired-region and geo-redundancy defaults** exist for some services. The scaffold refuses geo-redundant storage and backup, and an explicit check per service is still needed.
- **Model deployment types differ** in where prompts and outputs are processed and whether they are retained. The type used for any port-bound prompt must be verified (D-028); until then no inference on port-bound data.
- **Some services are global or have a global control plane** (identity, some monitoring and edge services). What they hold is part of the `identityAndControlPlane` validation.
- **Feature availability changes** over time, so a result has a date and an expiry.

## Documentation notes (cited, not live checks)

Read from official Microsoft documentation by an assisting research step on 2026-10-28, with no Azure sign-in. Each is a **documented statement to check live**, not a verified fact about any region or subscription, and no price, SLA, quota or performance figure is taken from them. Several change the design and are reflected in the scaffold.

| Area | Documented statement (source) | What it means for this design |
|---|---|---|
| Key Vault | A standard vault is replicated asynchronously to its paired region where one exists, with no documented opt-out other than choosing a region without a pair; Managed HSM is single-region by default and multi-region replication is opt-in ([Key Vault reliability](https://learn.microsoft.com/en-us/azure/reliability/reliability-key-vault), [multi-region replication](https://learn.microsoft.com/en-us/azure/key-vault/managed-hsm/multi-region-replication)) | A vault may place secret material in another region, which HC-01 and HC-03 may forbid. The scaffold vault is for secrets and certificates only. Signing-key custody (D-013) leans to a managed HSM and is not scaffolded. The pairing of the chosen region must be checked |
| Key Vault, Managed HSM, Service Bus, Container Apps | Not on the Customer Lockbox list; App Service, Functions, PostgreSQL, Blob Storage, API Management and OpenAI are ([Customer Lockbox](https://learn.microsoft.com/en-us/azure/security/fundamentals/customer-lockbox-overview)) | The `supportAccess` validation cannot lean on Lockbox for every service. Whether Lockbox is enabled for the subscription is a live check |
| Service Bus | Private Link is Premium only; geo-replication and geo-recovery are opt-in and Premium only; geo-recovery replicates metadata, not messages ([Private Link](https://learn.microsoft.com/en-us/azure/service-bus-messaging/private-link-service), [geo-DR](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-geo-dr)) | The scaffold accepts only Premium, because public access is off. Geo options stay unconfigured |
| Azure Monitor | Application Insights ingestion endpoints are global whatever the workspace region; workspace replication is opt-in ([private-link-security](https://learn.microsoft.com/en-us/azure/azure-monitor/fundamentals/private-link-security), [workspace replication](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/workspace-replication)) | No sensitive content may go to Application Insights; the `diagnostics` validation must account for the global endpoint |
| Microsoft Entra ID | A tenant's geo-location is fixed at creation; core directory data spans more than one Azure region within it; authentication requests are served by the nearest datacenter in the tenant's logical region ([data residency](https://learn.microsoft.com/en-us/entra/fundamentals/data-residency)) | Identity is a control-plane dependency that a regional design cannot pin. The `identityAndControlPlane` validation records what identity data holds and the tenant geo-location (D-037, D-017) |
| Azure Policy | "Allowed locations" excludes resource groups and global resources; a separate built-in covers resource-group locations; deny blocks creation, and existing resources are only flagged ([built-in policies](https://learn.microsoft.com/en-us/azure/governance/policy/samples/built-in-policies), [deny effect](https://learn.microsoft.com/en-us/azure/governance/policy/concepts/effect-deny)) | A location policy is a guardrail, never residency proof. A second assignment for resource-group locations is needed |
| Azure OpenAI | Data at rest stays in the resource geography for all deployment types; Standard processes in the chosen geography; Global Standard may process in any region; Data Zone confines processing to a zone; abuse monitoring reviews content by default and human review is possible below a confidence threshold; only eligible customers may apply to change it ([deployment types](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types), [abuse monitoring](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/abuse-monitoring), [data privacy](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy)) | Only a Standard deployment inside the jurisdiction could ever see port-bound data, and abuse-monitoring review may still count as a support path. Otherwise no inference on port-bound data (D-028) |
| Microsoft Foundry | The agent service has a basic mode with Microsoft-managed storage and a standard mode with customer-owned storage; there is no automatic failover ([environment setup](https://learn.microsoft.com/en-us/azure/foundry/agents/environment-setup), [resiliency](https://learn.microsoft.com/en-us/azure/foundry/how-to/high-availability-resiliency)) | Only the standard mode keeps agent state in customer storage. Still deferred until D-028 and a per-port data-path check |
| PostgreSQL | Geo-redundant backup is chosen at creation and cannot be changed later; password authentication can be deactivated ([backup and restore](https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore), [Entra](https://learn.microsoft.com/en-us/azure/postgresql/security/security-entra-concepts)) | The scaffold declines geo-redundant backup at creation, because it could not be undone |
| Blob Storage | LRS and ZRS avoid geo-replication; Shared Key can be disallowed; immutable storage supports time-based retention and legal hold; the firewall must be set to block public access ([redundancy](https://learn.microsoft.com/en-us/azure/storage/common/storage-redundancy), [immutable storage](https://learn.microsoft.com/en-us/azure/storage/blobs/immutable-storage-overview)) | Matches the scaffold. Immutability is hard to reverse: decide retention first (D-016) |
| API Management | The management plane and developer portal stay in the primary region even when the gateway spans regions; multi-region is Premium classic only ([multi-region](https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-deploy-multi-region)) | A gateway outside the jurisdiction is possible; deferred until the external API surface is decided |
| Container Apps, App Service, Functions | Regional with no default geo-replication; zone redundancy is opt-in and in-region ([Container Apps](https://learn.microsoft.com/en-us/azure/reliability/reliability-container-apps), [App Service](https://learn.microsoft.com/en-us/azure/reliability/reliability-app-service)); Functions needs a linked storage account in the same region and the documentation recommends LRS or ZRS for in-region residency ([storage considerations](https://learn.microsoft.com/en-us/azure/azure-functions/storage-considerations)) | Consistent with a single cell per jurisdiction |
| Azure Arc, Azure Local, IoT Operations | Arc keeps workload data on customer hardware and syncs metadata to a chosen region; Azure Local is documented for strict sovereignty and supports disconnected operation; Arc-enabled PostgreSQL is retired and only direct connectivity is supported for Arc data services; IoT Operations documents a limit on offline operation, to be compared with D-020 ([Arc](https://learn.microsoft.com/en-us/azure/azure-arc/servers/overview), [Azure Local](https://learn.microsoft.com/en-us/azure/azure-local/overview), [Arc data connectivity](https://learn.microsoft.com/en-us/azure/azure-arc/data/connectivity), [IoT Operations](https://learn.microsoft.com/en-us/azure/iot-operations/overview-iot-operations)) | Option C needs its own database choice: Arc-enabled PostgreSQL is not available. The edge store design is open (D-018, D-010) |

Facts that the documentation could not settle and that stay live checks: the actual service and SKU availability in each port's region and whether zones exist there; whether Customer Lockbox is enabled for the subscription; the current paired region; the tenant's actual geo-location; the current routing regions of any Global or Data Zone model deployment; whether location policy blocks every resource type used; the current connectivity endpoints of Arc and Azure Local; and whether a tier-gated feature (API Management private link, Registry geo-replication, Service Bus or Event Hubs private link) exists in a region.

## Limits

- No availability is verified. Nothing in this file says a service exists in any region.
- The documentation notes above are quoted from official pages by a research step and have not been re-read line by line by the owner. They can lag the platform.
- The jurisdiction's regions are not listed because the ports are not named (D-003).
- Documentation can lag the platform and vary by cloud, region and subscription; only the live check counts.
