# ADR 0014: Azure readiness stage: non-deployable IaC scaffold and provisional service selection

- **Status:** Proposed (awaiting the programme owner's decision)
- **Type:** Governance
- **Date:** 2026-10-28
- **Deciders:** Programme owner
- **Supersedes:** none

## Context
- FACT: The owner asked the harness to be prepared to design, deploy, validate and operate an Azure-native green-fuel bunkering certification solution, with twelve Azure engineering capabilities, a port-by-port sovereignty assessment, infrastructure-as-code scaffolding and a validation pipeline, and a deployment-readiness gate, with no resources provisioned. Candidate services are candidates, not mandatory.
- FACT: The harness is in Phase 0 ([ADR 0002](./0002-phase-gating-and-approval-enforcement.md)). The command policy gates `infra/`, `*.bicep` and `*.bicepparam` paths for agents until a human raises the phase. The earlier evaluation test `EVAL-HRN-AZR-002` asserted that no infrastructure code existed.
- FACT: The ports, jurisdictions, legal basis, tenant, subscription, hosting model, edge platform, key custody, AI inference location, recovery targets and budget are all open decisions (D-003, D-009, D-010, D-018, D-013, D-028, D-031, D-037, D-034). No design is Approved (DES-0001 is Blocked).
- FACT: A Bicep compiler is installed on this machine. Building and linting need no Azure sign-in.
- ASSUMPTION: The owner's request for scaffolding is read as permission for a non-deployable scaffold and its checks, not as raising the phase and not as a decision on any service.

## Options considered
1. **Documents only, no infrastructure code.** Rejected: the owner asked for scaffolding and a validation pipeline, and a gate with nothing real to check proves little.
2. **A full deployable template with real defaults.** Rejected: it would encode undecided choices as defaults, invent figures and risk an accidental deployment.
3. **A non-deployable scaffold where every unresolved decision is a required parameter with no default, committed parameter files that carry placeholders only, security defaults in the modules, a static policy validator, a CI workflow that compiles and checks without signing in, and a computed twelve-gate readiness check (chosen).**

## Decision
Proposed. Adopt:
- The scaffold in [infra/](../../infra): `main.bicep` for one jurisdiction cell and eight modules, three parameter files whose values are all `REQUIRES-APPROVAL` except the environment name, and four read-only discovery queries. It is marked `SCAFFOLD, NOT DEPLOYABLE`. `deploymentApproved` accepts only `true`. No parameter has a default.
- The provisional selection in [AZURE-REFERENCE-ARCHITECTURE](../azure/AZURE-REFERENCE-ARCHITECTURE.md): a lean for each candidate service (lean in, reserve, defer, evaluate) with the questions to verify. **It is not a decision.** It needs a design record and review (roadmap R17) before it is relied on.
- [validate-azure.mjs](../../harness/scripts/validate-azure.mjs): static infrastructure policy (no public access, no shared keys or local authentication, no geo-redundant storage or backup, no key reads or secrets, no broad roles, pinned role list, no defaults), the port assessment register contract (a port is never Established by region alone), document checks, and the twelve-gate readiness computation, which the existing `deployment-readiness` utility now includes.
- [infra-validate.yml](../../.github/workflows/infra-validate.yml): compile and check only, read-only token, no Azure sign-in, no secret. A workflow that signs in or deploys is refused by the validator until the phase is raised.
- The default hosting for every port until residency is established is a jurisdiction-local evidence store with a controlled shore integration (option C). A region is never proof of residency.
- The agents' phase gate is unchanged: agents still cannot write `infra/` in Phase 0. This scaffold was written by a human-run session on the owner's instruction. The phase stays 0.
- `EVAL-HRN-AZR-002` is changed from "no infrastructure code exists" to the stronger property that the only infrastructure is the non-deployable scaffold: no deployment configuration, no deploying workflow, no deployable parameter value, and the phase is 0. New evaluation tests cover the validator's rejection of an insecure template and of a residency claim by region.

## Consequences
- The owner can see, check and review a concrete scaffold before any resource exists, and the gate says exactly what blocks a deployment.
- The scaffold may be wrong in ways a compiler cannot find: role and policy IDs, API versions and property names are unverified against a subscription.
- The agents still cannot touch `infra/`; changes follow human review.
- A future `infra/` content that diverges from the scaffold's rules fails CI.
- More custom code to maintain: one validator and its tests. No new runtime dependency. CI downloads the Bicep CLI by version, not by checksum.

## Reversibility
High. Removing `infra/`, `docs/azure/`, the validator, the workflow and the evaluation tests returns the harness to its previous state. Nothing exists in Azure.

## Revisit when
The owner names the ports and the subscription; a design record for the Azure architecture is reviewed; the phase is raised; the first read-only discovery or capability verification runs; the Bicep download can be checksum-verified.

## Evidence
Automated tests cover the static policy on insecure fixtures, the register contract, the record contract (an empty record, an agent recorder or a missing commit clears nothing), the gate computation, the parameter files and the document checks. `validate-azure --bicep` compiles every Bicep file locally with no diagnostics. The committed evaluation run records the new checks. None of this touched Azure: no sign-in, no query, no what-if and no deployment occurred. An independent model review of this stage could not be obtained (the review agent returned an authentication error), so the scaffold and validator rest on my own review and tests; the static policy is a regular-expression screen and the compiler cannot show that a deployment would behave as the comments say. See [AZURE-READINESS-ASSESSMENT](../azure/AZURE-READINESS-ASSESSMENT.md).
