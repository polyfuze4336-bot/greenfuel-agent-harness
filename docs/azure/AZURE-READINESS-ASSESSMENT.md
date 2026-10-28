# Azure readiness assessment

Status: Phase 0, assessed from the repository on 2026-10-28. **The platform is not ready to deploy, and no Azure resource was created, no Azure sign-in was used, no query was run against Azure and no what-if was run.** This is an assessment of preparation, not of a deployment. A `NO-BLOCKERS-FOUND` reading would not be an approval. The readiness result is computed by `node harness/scripts/validate-azure.mjs --readiness` and by the `deployment-readiness` utility, which includes it.

## Verdict

**NOT-READY.** All twelve deployment gates have at least one recorded blocker. Most blockers are decisions and approvals that belong to the owner or to named roles, not engineering work. The engineering preparation that can be done without them is done and checked.

## Capabilities

| # | Capability | Prepared | Verified now | Not done |
|---|---|---|---|---|
| 1 | Environment discovery | Four read-only Resource Graph queries | Static check that they are read only | Not run: needs sign-in approval (T11) and the subscription (D-037) |
| 2 | Service and region capability verification | Method and per-candidate checklist | Nothing | No live check; DG-03 |
| 3 | Well-Architected assessment | Design-time assessment of the proposal | Not applicable | No tool run; no design record |
| 4 | IaC generation and validation | Eight-module scaffold, three parameter files, static policy checks, CI workflow | `bicep build` of every file with no diagnostics, and the static checks, on this machine; mutation tests of the checks | No real values; no review of the design; the scaffold is not deployable by design |
| 5 | Resource dependency planning | Module wiring in `main.bicep` | The compiler resolves the dependencies | Network, registry, API gateway and edge not scaffolded |
| 6 | Cost estimation and budget controls | Method, inputs, budget module | Static check that no default amount exists | No estimate; no budget; DG-07 |
| 7 | Identity and RBAC validation | Pinned role list; broad roles refused | Static check | No live role check; no approver registered |
| 8 | Residency and network boundary validation | Eight validations per port; register that refuses unsupported claims | A claim of residency by region alone is rejected by the validator and the evaluation | No port named; nothing validated |
| 9 | Deployment approval gates | Twelve computed gates | Gate computation | No approver; no signed approval |
| 10 | Post-deployment smoke and integration testing | Specified as DG-10 | Not applicable | Nothing deployed |
| 11 | Monitoring and operational readiness | Specified | Diagnostics and locks in the scaffold compile | No configuration, alert or runbook |
| 12 | Rollback and recovery | Specified | Not applicable | Not exercised |

## Blockers

Computed by the gate. A gate lists every recorded blocker; this table summarises them.

| Gate | Blockers recorded |
|---|---|
| DG-01 Design approved | No design review is Approved (DES-0001 is Blocked; the Azure reference architecture has no design record) |
| DG-02 Residency per port | No port named (D-003); residency interpretation, hosting model, AI inference location and edge platform open (D-009, D-010, D-028, D-018) |
| DG-03 Capability verified live | No live verification; needs read-only Azure access (T11, D-037) |
| DG-04 Identity, RBAC, key custody | Key custody open (D-013); no approver registered (T13); no deployment identities created (T17) |
| DG-05 IaC validated | Parameter files carry placeholders for dev, test and prod |
| DG-06 What-if reviewed | No what-if for any environment |
| DG-07 Cost and budget | No sourced estimate; no budget (D-034) |
| DG-08 Approval recorded | No signed approval |
| DG-09 Operations and recovery | Targets open (D-031); operating model and support access open (D-033); nothing exercised |
| DG-10 Smoke and integration tests | Nothing deployed |
| DG-11 Tenant and subscription | D-037 open |
| DG-12 Phase raised | Phase 0; raising it is a human decision in an ADR |

## Approvals needed before deployment

Nothing below has been requested from or granted by anyone. Order reflects dependency.

| # | Approval or decision | Who | Unblocks |
|---|---|---|---|
| 1 | Accept or change [ADR 0014](../adr/0014-azure-readiness-scaffold-and-provisional-selection.md) (the scaffold exception and the provisional selection) | Programme owner | Treating the scaffold and the provisional lean as agreed |
| 2 | Name the ports and the legal entity in each (D-003) | Programme owner | Everything per port |
| 3 | Legal interpretation of residency per port and the legal basis for any cross-border flow (D-009, D-011) | Compliance counsel, sovereignty lead | DG-02; the port register |
| 4 | Hosting model per port, edge platform and hardware ownership (D-010, D-018) | Enterprise architect, port operations | DG-02; option A, B or C |
| 5 | Azure tenant, subscription and landing zone; dev, test and prod separation (D-037) | Programme owner | DG-11, DG-03 |
| 6 | Approve a read-only Azure sign-in for discovery and capability verification (T11), with a named read-only identity | Programme owner, security architect | DG-03; the resource inventory |
| 7 | Name approvers, register their keys, confirm approval limits (T13) | Programme owner | DG-04, DG-08 |
| 8 | Create the scoped deployment identities, custom role, locks and policy (T17) | Programme owner, with the platform owner | DG-04 |
| 9 | Key custody and tamper-evidence mechanism (D-013) | Security architect | DG-04; certificate design |
| 10 | Where AI inference runs, per port (D-028) | Sovereignty lead, enterprise architect | The model plane |
| 11 | Recovery, availability and latency targets and the operating model (D-031, D-033) | Programme owner, port operations | DG-09 |
| 12 | Cost envelope and budget (D-034) and volumes | Programme owner | DG-07 |
| 13 | A design record and Approved review for the Azure reference architecture (roadmap R17), then the sibling designs (R13) | Design approver named under T3 | DG-01 |
| 14 | Environment protection and branch protection on GitHub, or an equivalent (T14) | Programme owner | Enforcing the approval gates in the pipeline |
| 15 | Raise the phase, recorded in an ADR (HC-11) | Programme owner | DG-12; any deployment |
| 16 | Per deployment: a signed approval bound to the reviewed commit, scope and environment (P3; P4 separately where needed) | Registered approvers | DG-08 |

## Limits

- The assessment reads files. It checks structure and recorded preconditions; it does not show that Azure behaves as the design assumes.
- The IaC scaffold compiled under the local Bicep compiler (a version recorded in the evidence). Compiling is not deploying: resource providers, API versions, role IDs, policy IDs and property names are not verified against a subscription.
- The five candidate-service lean decisions, the hosting options and the validation set are proposals.
- No claim here is a compliance claim. Standards and regulations stay candidates until verified (HC-10).
