# Infrastructure scaffold (not deployable)

This folder is the **scaffold** of the infrastructure for one jurisdiction cell. It is here so the validation pipeline, the guardrails and the readiness gate have something real to check. It is **not** a deployable design and **no part of it has been deployed, what-if run, reviewed or approved**.

- Status: Phase 0. No Azure resource has been created. No service in these files is a decision; they are the provisional leaning of [AZURE-REFERENCE-ARCHITECTURE](../docs/azure/AZURE-REFERENCE-ARCHITECTURE.md) and need a design record and review before they can be relied on ([ADR 0014](../docs/adr/0014-azure-readiness-scaffold-and-provisional-selection.md)).
- Every unresolved decision is a **required parameter with no default** (region, jurisdiction, SKUs, retention, allowed locations, budget). Nothing here invents a figure.
- `deploymentApproved` accepts only `true`, and the three files in [params/](params) carry `REQUIRES-APPROVAL` in every value except the environment name, so they cannot be deployed as they are. A human supplies real values after the approvals listed in [DEPLOYMENT-STRATEGY](../docs/azure/DEPLOYMENT-STRATEGY.md), in a copy outside the repository or in a reviewed change that the readiness gate accepts.
- Security defaults in the modules: no public network access, no shared keys or local authentication, no geo-redundant storage or backup, purge protection, `CanNotDelete` locks on stores, diagnostics to an in-cell workspace, no secrets in parameters, outputs or logs.
- [discovery/](discovery) holds read-only Resource Graph queries for environment discovery. They have not been run: running them needs the Azure sign-in the owner has not approved (T11).

## Checks (no Azure sign-in needed)

```
node harness/scripts/validate-azure.mjs            static IaC policy, parameters, documents, sovereignty register, readiness blockers
node harness/scripts/validate-azure.mjs --bicep    also runs `bicep build` on every file (needs the Bicep CLI; local, offline)
```

The same checks run in CI ([infra-validate.yml](../.github/workflows/infra-validate.yml)). `what-if` and any deployment need an Azure sign-in and an approval, and are not part of any workflow in this repository.

## Layout

| Path | Purpose |
|---|---|
| `main.bicep` | One jurisdiction cell, composed from the modules |
| `modules/` | monitoring, evidence storage, key custody, messaging, ledger database, runtime environment, identities and RBAC, guardrails |
| `params/` | One placeholder file per environment (dev, test, prod): environments are separate deployments, never one |
| `discovery/` | Read-only Resource Graph queries |
