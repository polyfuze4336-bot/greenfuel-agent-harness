# Azure deployment plan (NOT EXECUTED)

**No Azure resource has been created, no Azure sign-in was used, and no infrastructure code has been written.** The owner deferred deployment (T36) and the request requires explicit approval first (HC-11). This page is what would be done, and what must be answered first.

## Inputs needed before anything is created

| # | Input | Why |
|---|---|---|
| 1 | Written approval to raise the phase and create billable resources (recorded in an ADR) | HC-11, T36 |
| 2 | Subscription, resource group and **region** | Region decision D-009 is unresolved. The Studio is not the bunkering application and is exempt from its residency rules, but the choice must be recorded |
| 3 | Reuse versus create: any existing approved resource group, Log Analytics workspace, Key Vault, ACR, Container Apps environment | Request: prefer existing approved resources. **There is no inventory of existing resources; none has been queried** |
| 4 | Entra tenant and an owner who can create the app registration and assign the seven roles | Human sign-in |
| 5 | GitHub App registration and installation by the repository owner | Repository operations |
| 6 | Host choice for **final-deck rendering** (see below) | Linux cannot run PowerPoint |
| 7 | Budget ceiling | No cost estimate was produced because the SKUs depend on 2, 3 and 6 |

## Proposed shape (from [ARCHITECTURE](ARCHITECTURE.md) section 6)

- One Container App or App Service (single instance), system-assigned managed identity.
- Key Vault with RBAC for the GitHub App private key, webhook secret and Entra client secret, mounted as files.
- ACR (or an existing registry) and a GitHub Actions workflow with OIDC federation to Azure; no stored cloud credentials.
- Log Analytics and Application Insights, with approval rationale excluded from logs.
- Infrastructure as Code in Bicep, validated with `az deployment group what-if` **before** any deploy, reviewed by the owner.
- Environment settings from the [RUNBOOK](RUNBOOK.md), including `STUDIO_REQUIRE_ENTRA=1`.

## Findings that change the plan

1. **Final-deck rendering is Windows-only.** The pipeline measures overflow with PowerPoint (COM). A Linux host can build a SAMPLE deck but can never satisfy the `qa` gate for a FINAL deck. Choose one: Windows App Service or VM with Office licensing, or render on a Windows build agent and commit the evidence, or add a different measured renderer and re-validate. Not decided.
2. **The Studio needs a git clone and git.** A container must clone with the GitHub App token and fast-forward on webhook.
3. **Single instance only.** File-based store.
4. **GitHub branch protection is unavailable** on the current plan; this is independent of Azure but weakens the whole approval path.

## Acceptance after deployment (what "tested on the deployed application" will mean)

Re-run, against the Azure URL: the API probe; sign-in through real Entra with each role; an approval that produces a real pull request, real Actions validation and a real merge; webhook refresh; baseline generate and authorize; a SAMPLE and (if rendering is solved) FINAL deck. Each item recorded with raw output. Until then the acceptance verdict stays conditional ([ACCEPTANCE-REPORT](ACCEPTANCE-REPORT.md)).
