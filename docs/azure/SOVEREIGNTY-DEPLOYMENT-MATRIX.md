# Sovereignty deployment matrix

Status: proposed, Phase 0. It applies the [sovereignty matrix](../context/SOVEREIGNTY-MATRIX.md) to Azure deployment. **No port is named, no legal basis is verified, no region has been checked and nothing has been deployed.** An Azure region is not a residency control and is never treated as proof (HC-01, CS-P4). Where residency is not established, the design is a jurisdiction-local evidence store with a controlled shore integration.

## Hosting options

| Option | Meaning | When it is allowed |
|---|---|---|
| A | An in-country Azure region hosts the cell | Only when residency is **Established** for that port with evidence |
| B | An in-country Azure region for the shore services, and a jurisdiction-local edge store holds the evidence of record | When the shore services may be in the region but the evidence of record needs a local store |
| C | A jurisdiction-local evidence store (edge or on-premises, possibly managed with Azure Arc or Azure Local) with a controlled shore integration that carries only approved flows | **The default for every port until residency is established** |
| D | A partner in the jurisdiction hosts it | Same validations as A, plus a contract |
| None | No option is feasible | Escalate to the owner |

The shore integration of option C carries only the flows on the approved list (D-011, SEC-004): hashes, signed summaries or aggregates only if counsel approves them. Raw measurements and evidence packages stay in the jurisdiction.

## Port

The [port register](data/port-assessments.json) holds one entry per port. **It is empty**, because the ports and jurisdictions are not named (D-003) and the legal source of each residency obligation is not identified (D-009). The table below is therefore a template with no ports, not an assessment of any real port.

| Port | Jurisdiction | Residency status | Hosting option | Legal basis (D-009) | Azure region exists and has the services | Validations verified |
|---|---|---|---|---|---|---|
| none named | not decided | Undetermined | C (default) | not identified | not checked | 0 of 8 |

The decision rule for each port, applied in this order:

1. Name the port and the legal entity that operates in it (D-003).
2. Obtain the legal interpretation of "within the jurisdiction" for storage, processing, access, backups, metadata, telemetry and AI inference (D-009).
3. Check, live and read-only, whether a region in that jurisdiction exists and offers every service, SKU and feature the cell needs (see [REGIONAL-AVAILABILITY](REGIONAL-AVAILABILITY.md)). If not, the port is C or D.
4. Run the eight validations below with evidence. Any that fails, or is unverified, keeps the port out of option A.
5. Record the status. Only then can the hosting option be A or B.

## Validations

Each is required per port, with evidence, a named human verifier and a negative test that tries to break it. They are the same eight in the register and in the validator.

| Validation | The question | Evidence | How it can fail |
|---|---|---|---|
| replication | Is every copy of every store inside the jurisdiction? Is cross-region or geo replication off or constrained to the jurisdiction? | Exported replication settings for each store; a policy that denies a geo-redundant SKU; a negative test | A paired-region or geo-redundant default; a feature enabled later |
| backups | Are all backups and snapshots, including those of the database and key custody, inside the jurisdiction? | Vault and backup-policy exports; an in-jurisdiction restore test | A backup vault elsewhere; geo-redundant backup left on |
| diagnostics | Do logs, metrics, traces and crash data stay inside the jurisdiction, and are they free of sensitive content? | Workspace location; diagnostic-setting inventory; a log scan; a rule that nothing sensitive is emitted to Application Insights, whose ingestion endpoints the documentation lists as global | A global or default workspace; platform telemetry leaving the region |
| supportAccess | Can the vendor or any operator outside the jurisdiction reach the data? Under what approval and recording? | Support-access settings and contract terms; whether Customer Lockbox is enabled (it is documented as not covering Key Vault, Managed HSM, Service Bus or Container Apps); the operating model (D-033); a break-glass drill | Vendor support personnel or remote administration in another country |
| disasterRecovery | Where is each recovery target, and is it inside the jurisdiction? | The recovery design per layer; a failover or restore test showing the location | A failover target in another region or country |
| aiInference | Where do prompts, retrieved data and outputs go, and are they stored or reviewed outside the jurisdiction? | The deployment type, its documented processing location and its logging; a test with synthetic data (D-028) | A global or non-pinned model deployment; abuse-monitoring retention |
| identityAndControlPlane | Which identity, metadata and management data has a scope wider than the region, and is any evidence-bearing data in it? | The inventory of global services in use and what each holds; the tenant's geo-location (fixed at creation, with core directory data spanning more than one region, per the documentation); names and tags checked for sensitive content | Evidence referenced in a resource name, a tag or an identity attribute; a tenant geo-location that is not the jurisdiction |
| pipelines | Do build, test and deployment systems ever touch real data or run outside the jurisdiction with access to it? | Pipeline inventory; synthetic-data rule enforced (DATA-009) | A pipeline artefact or test environment holding real measurements |

## Data placement by cell tier

From the [data classification](../context/DATA-CLASSIFICATION.md) and the zones in the sovereignty matrix. This shows where a component may sit, not that it does.

| Component | Zone | Holds | Rule |
|---|---|---|---|
| Edge capture and local evidence buffer | Z1 | DC-01 to DC-03, local signing | Inside the jurisdiction; works offline (HC-07) |
| Jurisdiction cell: ingestion, evidence store, ledger, calculation, certificates, agents | Z2 | DC-01 to DC-14 as the matrix allows | Inside the jurisdiction; nothing leaves except an approved flow |
| Key custody | Z2 (Z1 if D-013 so decides) | DC-16 | In-jurisdiction custody (HC-03) |
| Methodology and reference data distribution | Z2 and Z3 | DC-05 | May be shared; carries no sensitive data |
| Customer compliance access | Z2, Z5 for own data | DC-11, DC-12 | One shipowner per access context (HC-02) |
| Group tier: IaC, configuration, source, synthetic test data | Z3 | DC-17, DC-18 | No real data |
| Model inference | Z2 or none | DC-13 and any grounded prompt | No inference on port-bound data outside the jurisdiction (D-028); a deterministic path never uses a model |

## Limits

- No port has been assessed; the register is empty and the matrix above is a template.
- Region existence, service availability and each validation are unverified. No claim in this file is about a real Azure region.
- The hosting options are a proposal. Choosing one for a port needs the decisions named above and a design review.
- The static validator checks that the register cannot mark a port Established without the evidence fields. It cannot check that the evidence is true: a named human verifier and review are the control.
