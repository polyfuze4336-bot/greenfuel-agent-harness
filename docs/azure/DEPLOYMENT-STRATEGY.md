# Deployment strategy

Status: proposed, Phase 0. **No Azure resource has been created, no what-if has been run and nothing has been deployed.** This document says how a deployment would be reached, not that one is ready. Nothing here authorises a deployment: that is a human action under HC-11, and production is never deployed automatically.

## Principles

| Principle | How it is enforced now | Still depends on a person |
|---|---|---|
| Infrastructure as code | [infra/](../../infra) scaffold, `validate-azure` static policy and `bicep build` | Review of the real design before anything is deployed |
| Separate dev, test, production | Three parameter files that cannot be deployed as they are; the validator rejects a shared or filled-in file | Choosing separate subscriptions (D-037) |
| Least-privilege deployment identities | Specified in [azure-identities.json](../../harness/policy/azure-identities.json); the permission engine denies Azure mutation for agents | Creating the identities and registering approvers (T13, T17) |
| Reuse only after checks | The reuse checklist below and in [RESOURCE-INVENTORY](RESOURCE-INVENTORY.md) | Running read-only discovery after sign-in approval (T11) |
| No dependence on developer-local files or services | The validator refuses a workflow that signs in or deploys; templates take no local path; nothing reads a developer machine | Building the application so it holds to this |
| No hard-coded credentials | Static checks refuse literal secrets, key reads, passwords and SAS; local authentication is off in every module | Reviewing real parameter values outside Git |
| No automatic production deployment | No workflow deploys; production is its own environment with its own approval | Environment protection rules on GitHub (T14) |
| Approval before resource creation or billable change | Gate DG-08 needs a signed approval bound to the reviewed commit; `deploymentApproved` accepts only `true` | Naming the approvers (T13) |

## Environments

Dev, test and prod are separate deployments of the same template with separate parameter files in [infra/params](../../infra/params), each with its own identity, its own approval and its own budget. A jurisdiction cell exists once per environment per jurisdiction. Rules:

- Dev and test hold **synthetic data only** (DATA-009). Real delivery evidence never enters them.
- A cell in test or dev is also created inside the jurisdiction only when it holds anything jurisdiction-bound; otherwise it uses synthetic data and carries no residency claim.
- Separate subscriptions are the recommended separation so that RBAC, policy, quota and cost are separate. The choice is open (D-037); a shared subscription would need an equivalent recorded separation.
- Promotion is by a reviewed commit and a new approval. Dev passing does not approve test; test passing does not approve production.

## Approval gates

The twelve gates in [deployment-gates.json](data/deployment-gates.json) are computed by `node harness/scripts/validate-azure.mjs --readiness` and by the existing `deployment-readiness` utility, which includes them. Records that clear a gate (`capability-verification`, `whatif-record`, `cost-estimate`, `runbook-exercise`, `smoke-test-record` under `docs/azure/data/`) must carry the schema, the commit they are bound to, a named human recorder, a date, evidence and their own fields (for example a what-if with a delete count of 0); an empty or agent-written file clears nothing. They are control-plane paths, so no agent can write them. A gate with no recorded blocker reads `NO-BLOCKERS-FOUND`. That is a statement that nothing recorded blocks it, not an approval: each gate also needs its named approver.

| Gate | What must exist |
|---|---|
| DG-01 | Approved design review and Well-Architected assessment |
| DG-02 | Residency established per port, or hosting option C chosen |
| DG-03 | Live region and service capability verification |
| DG-04 | Registered approvers, scoped identities, key custody decision |
| DG-05 | Real parameter values (outside the secret path), clean build and static checks, reviewed commit |
| DG-06 | Recorded what-if per environment, no unexpected delete |
| DG-07 | Sourced cost estimate and a budget |
| DG-08 | Signed approval bound to the reviewed commit, scope and environment |
| DG-09 | Runbooks, rollback and restore exercised in non-production |
| DG-10 | Smoke and integration tests run against non-production |
| DG-11 | Tenant, subscription and environment separation decided |
| DG-12 | Phase raised by a human, recorded in an ADR |

## Pipeline

What exists: [infra-validate.yml](../../.github/workflows/infra-validate.yml) runs the static policy checks and `bicep build` with a read-only token. It does not sign in to Azure.

What would exist later, as a **specification only** (no such workflow is committed, and the validator refuses one until the phase is raised):

1. A reviewed pull request changes `infra/`; the static checks and `bicep build` pass.
2. A human with the approver role requests what-if for the target environment from a pipeline that uses **workload identity federation** to a scoped deployment identity, with no stored secret. The what-if result is recorded and reviewed; a deletion in it blocks the run.
3. A signed approval bound to that commit, scope and environment is recorded (P3 for non-production; P4 is separate and never implied).
4. A GitHub Environment with required reviewers gates the deploy job. For production a second approver is required and the job runs only on a manual dispatch, never on a push. Protection rules for private repositories depend on the GitHub plan (T14).
5. Post-deployment smoke and integration tests run; their result is recorded as evidence. A failure triggers the rollback procedure, not a retry loop.

## Identities

- **Deployment identities** are separate per environment, scoped to a resource group, with a custom role that cannot assign roles, delete or touch policy (see [azure-identities.json](../../harness/policy/azure-identities.json)). None exists yet (T17).
- **Workload identities** are user-assigned managed identities with narrow data-plane roles ([identity-rbac.bicep](../../infra/modules/identity-rbac.bicep)); the validator pins the allowed role IDs and refuses Owner, Contributor and User Access Administrator. The IDs are written from memory of the built-in roles and must be confirmed with a read-only `az role definition list` before use.
- **Human access** is through Microsoft Entra with just-in-time elevation. Break-glass follows [BREAK-GLASS](../security/BREAK-GLASS.md).
- No identity used by the coding agents may deploy. The agents have no Azure sign-in.

## Reuse of existing resources

An existing Azure resource is reused only after all four checks, each recorded in [RESOURCE-INVENTORY](RESOURCE-INVENTORY.md):

1. **Ownership.** A named owner agrees, and the resource is not shared with a workload that has other tenants or data classes.
2. **Security.** No public network access, no shared keys, diagnostics and locks as the scaffold sets, no broad role assignments (query 03), no unmanaged exposure (query 02).
3. **Region and residency.** The location and every replication, backup, diagnostic and support path are checked per port; the resource's region alone proves nothing.
4. **Compatibility.** SKU, version, features, quotas and policy assignments match the design.

Anything failing a check is created new in the approved scope, or the design changes. Nothing is reused by default.

## Rollback

- **Infrastructure:** the previous reviewed commit is the rollback. A what-if of the previous commit is reviewed before it is applied; resources carry `CanNotDelete` locks, so a rollback never deletes a store. Removing a lock or deleting a store is P4.
- **Data:** evidence is append-only and immutable with versions, so a data rollback is to a previous version, never a delete. Restores run inside the jurisdiction.
- **Application:** revision-based rollback of the runtime to the previous revision, with the database changes written to be backward compatible for one release. Scheme-specific calculation versions are never rolled back in place: a new version supersedes (HC-05).
- **Not exercised:** none of this has been run. DG-09 needs it exercised in non-production.

## Limits

- The scaffold is not a design and has not been reviewed. Service selection is provisional ([AZURE-REFERENCE-ARCHITECTURE](AZURE-REFERENCE-ARCHITECTURE.md)).
- Role IDs, the allowed-locations policy ID and several property names were written without a live check; `bicep build` accepts them but cannot prove a deployment would.
- The Bicep CLI downloaded by CI is pinned by version, not by checksum.
- Branch and environment protection on GitHub are not applied (T14), so the approval gates are enforced by the repository checks and by procedure, not by GitHub.
