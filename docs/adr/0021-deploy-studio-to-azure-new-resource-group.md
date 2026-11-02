# ADR 0021: Deploy the Architecture Decision Studio to Azure, in a new resource group

- **Status:** Proposed
- **Type:** Governance
- **Date:** 2026-11-02
- **Deciders:** Programme owner (to accept with a signed approval once an approver key is enrolled, TODO T13)
- **Supersedes:** none. It narrows the deferral in TODO T36 for the Studio only.

## Context
- FACT: The owner instructed, in chat on 2026-11-02, "deploy this decision register/control tower to azure in a new RG", and confirmed in a form: region `southeastasia`, resource group `rg-greenfuel-studio-sea`, a cost ceiling of about 100 USD per month (source: owner form response, 2026-11-02), enrolment of the owner's Entra identity as sole Architecture Owner, and recording this decision as an ADR. **That is a recorded instruction, not a signed approval.** No approver key is enrolled, so this ADR stays Proposed.
- FACT: The Studio (`apps/architecture-studio/`) is governance tooling, not the bunkering application. The owner's decision under HC-11 is that it is outside the application's sovereignty and tenant-isolation rules ([docs/studio-acceptance/ARCHITECTURE.md](../studio-acceptance/ARCHITECTURE.md)).
- FACT: The phase is 0 and stays 0. This ADR does not raise it, does not unlock `src/` application code, and does not approve any deployment of the bunkering application or the use of real delivery, customer or certificate data.
- FACT: The repository is public, so the content the Studio shows is already public. The deployed Studio holds no secret that is not in Key Vault.
- FACT: Real Entra sign-in, a real GitHub App and a real deployment have never been exercised ([ACCEPTANCE-REPORT](../studio-acceptance/ACCEPTANCE-REPORT.md)). Deployment is how that gap is closed, so some behaviour will be observed for the first time.
- FACT: The deck builder needs Windows PowerPoint. A Linux container can outline and build a SAMPLE deck but cannot render a final deck.
- ASSUMPTION: The subscription `ME-MngEnvMCAP682563-mkhalib-1` is the owner's sandbox and the owner may create billable resources in it. Existing resource groups belong to other projects and are not reused or changed.

## Options considered
1. **Azure Container Apps, one replica, in a new resource group (proposed).** Linux container with Node 22 and git; Azure Container Registry (Basic) built with `az acr build`; Key Vault (RBAC) for the Entra client secret; Log Analytics; a user-assigned managed identity; HTTPS only; Bicep, with a what-if reviewed before the deploy. Cheapest managed option that gives a real git binary and a managed identity.
2. **Azure App Service (Linux, Node 22 runtime).** Simpler to deploy code, but the presence of `git` in the platform image is not guaranteed and cannot be pinned, and the Studio shells out to git.
3. **A virtual machine.** Full control, including a possible Windows host with PowerPoint for final decks, but patching, network exposure and cost are all ours. Rejected for now; revisit only if final-deck rendering must run in Azure.
4. **Reuse an existing Container Apps environment or registry in the subscription.** Cheaper, but couples the Studio to unrelated projects and their lifecycle. Rejected: the owner asked for a new resource group.
5. **Do not deploy; keep running it locally.** No cost or exposure; leaves the "tested on a deployed application" gap open. The owner chose to deploy.

## Decision
Proposed for the owner's signed approval. The scope is bounded; anything outside it needs a new ADR.
1. **What:** the Studio only. No bunkering application, no business agent, no certificate, no delivery or customer data.
2. **Where:** subscription `870b491d-74bb-4aa7-95ab-647f262444d5`, new resource group `rg-greenfuel-studio-sea`, region `southeastasia`. The Studio is outside the bunkering residency rules (HC-11); the region is chosen for proximity to the programme and recorded here, not as a residency decision (D-009 stays open).
3. **Identity:** Microsoft Entra ID only. `STUDIO_REQUIRE_ENTRA=1`. Assignment required on the enterprise application. The owner's Entra identity is enrolled as Architecture Owner in `harness/policy/access-policy.json` by pull request.
4. **Read-only first:** no GitHub App is configured, so the deployed Studio cannot write to the repository. Approvals and proposals stay unavailable until the owner registers the App (a GitHub UI step) and a second pull request configures it.
5. **Infrastructure as code is kept OUT of this repository, by the owner's decision on 2026-11-02.** The harness phase gate (`validate-harness`, HC-11) forbids Bicep outside the non-deployable `infra/` scaffold and a root Dockerfile while the phase is 0, and changing that validator is a control-plane edit. The owner chose to leave the Bicep, Dockerfile and entrypoint untracked, in a local folder beside the repository, rather than add an exception. Consequence: the infrastructure code is **not versioned, not reviewable in a pull request and exists on one machine**; the deployed resources and the what-if output are recorded in the evidence instead. Moving it into the repository needs a validator exception or a phase raise, each a separate decision.
6. **Secrets:** only in Key Vault, mounted as files. None in the repository, the image, the Bicep or the deployment history.
7. **Cost:** a ceiling of about 100 USD per month (source: owner form response, 2026-11-02). The expected figure is far lower and is recorded with the deployment.
8. **No other resource group, tenant setting or subscription-level policy is changed.** The only tenant-level objects created are one application registration (`greenfuel-architecture-studio`) and its enterprise application.
9. **Reversible:** deleting the resource group and the application registration removes everything this ADR creates.

## Consequences
- Positive: the first real test of Entra sign-in, container hosting, and the read path on Azure; a URL for the capstone panel; infrastructure as code that can be reviewed and repeated.
- Negative: a recurring cost; a new public endpoint (read-only, Entra-gated); the owner's tenant and object ids and sign-in name become public in the access policy file.
- Risk: single-instance, in-memory sessions and a file-backed cache; a restart signs everyone out and the cache is rebuilt from git.
- Risk: the deployed Studio's clone of the repository could lag behind GitHub; a poll interval bounds this and webhooks are not configured.
- Limitation: no final-deck rendering in Azure (PowerPoint). Not an error.

## Revisit when
The GitHub App is registered (enable the write path); a second approver is enrolled (raise required reviews to 1); final-deck rendering must run in Azure; or the monthly cost exceeds the ceiling.

## Evidence
To be recorded with the deployment: what-if output, deployed resource list, health and probe results, cost estimate. See [docs/studio-acceptance/AZURE-DEPLOYMENT.md](../studio-acceptance/AZURE-DEPLOYMENT.md) once it exists.
