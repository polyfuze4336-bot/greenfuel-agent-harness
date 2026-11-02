# Azure deployment of the Studio

Records what was deployed under [ADR-0021](../adr/0021-deploy-studio-to-azure-new-resource-group.md) on 2026-11-02, how it was verified, what was **not** verified, and what it costs. Everything here was observed on the deployed resources unless marked otherwise.

## Result

| | |
|---|---|
| **URL** | `https://ca-gfstudio.redgrass-c48c30d5.southeastasia.azurecontainerapps.io` |
| Status | **Running and healthy, read-only, Entra sign-in only.** Signed-in behaviour is **not yet verified** (see below) |
| Subscription | `870b491d-74bb-4aa7-95ab-647f262444d5` (the owner's sandbox) |
| Resource group | `rg-greenfuel-studio-sea`, `southeastasia`, created for this; no other group touched |
| Image | `greenfuel-studio:m2-dbbf889`, digest `sha256:fd8230518d5c407912b0954d5b82c9f29fdb56e2d3d8074cffefcd11a711bc66`; built from the Studio at repository commit `dbbf889` |
| Repository the Studio reads | this repository, cloned inside the container from `origin/main`, re-fetched every 60 s |
| Phase | unchanged (0). No bunkering application, no production or certification data |

## What exists

| Resource | Type | Notes |
|---|---|---|
| `ca-gfstudio` | Container App | 1 replica fixed (min 1, max 1), 0.5 vCPU, 1 GiB, external HTTPS ingress only, TCP probes |
| `cae-gfstudio-sea` | Container Apps environment | Consumption, logs to Log Analytics |
| `acrgfstudioo2a4s7kb` | Container Registry, Basic | Admin user disabled; the app pulls with a managed identity (`AcrPull`) |
| `id-gfstudio` | User-assigned managed identity | Only permission: `AcrPull` on that registry |
| `log-gfstudio-sea` | Log Analytics workspace | 30-day retention, **daily cap 0.1 GB** |

Tenant-level objects created: one application registration and enterprise application, `greenfuel-architecture-studio` (client id `0f1982fa-032c-47f5-a2da-ae6cd319708a`), with the seven `Studio.*` app roles, **assignment required**, and the owner's Entra identity assigned `Studio.ArchitectureOwner`. One client secret (1 year) exists on it and is held only as a Container Apps secret.

## Deviations from ADR-0021 as written

| Planned | Actual | Why |
|---|---|---|
| Secret in Key Vault | **Secret held as a Container Apps secret** (a `@secure()` deployment parameter) | A tenant governance policy, `KeyVaultPublicNetworkModify` in the initiative *MCAPSGov Deploy and Modify Policies*, forces public network access **off** on every Key Vault, even when the template asks for it on. The app could not read a vault without a private endpoint and a VNet. I did **not** create a policy exemption to defeat a security control. The vault that was created was deleted and purged |
| System-assigned identity | User-assigned identity | The identity must exist before the app so its `AcrPull` role can be in place |
| IaC in the repository | **IaC kept outside the repository** | Owner decision B: the harness phase gate forbids Bicep outside `infra/` at phase 0 |

The container secret is encrypted by the platform and not readable through the API, but it is a weaker home than Key Vault: anyone with Contributor on the app can replace it. A private-endpoint Key Vault is the stronger design and needs a VNet-integrated environment plus a private endpoint; that cost was **not estimated** and is not in the figures below.

## How it was verified

| Check | Result |
|---|---|
| What-if before each deploy | Step 1: 8 creates, nothing modified or deleted. Step 3: the app created; the environment, registry and role assignment shown as `Modify` (property noise), nothing deleted |
| Revision health | `Healthy`, 1 replica |
| Container start | Log line `studio: repository at dbbf889`: the clone and checkout work inside the container |
| `GET /` signed out | 200, the Microsoft sign-in screen only; **no repository content** in the page (no decision id or title) |
| `GET /api/v1/register` signed out | 401 `Sign in required` |
| `GET /api/v1/auth/entra/login` | 307 to `login.microsoftonline.com` for tenant `08cef5cb-…` with the right client id and redirect URI; PKCE `S256`, `state`, `nonce`, `max_age=900`; the state cookie is `Secure; HttpOnly; SameSite=Lax` |
| Browser | The Microsoft sign-in page loaded from the Studio's sign-in link |
| API probe against the URL | 90 checks, 89 passed. The one failure was my probe expecting 404 for an unknown decision where a signed-out Entra deployment correctly answers 401; the probe was corrected. Headers: strict CSP (still with `unsafe-inline`), `nosniff`, framing denied, no-referrer, no `X-Powered-By` |
| Policy pin | The server's pinned hash `66bbb1e7…19e1` equals the hash of `harness/policy/access-policy.json` on `main` |

## What was NOT verified

1. **Signed-in use.** Signing in needs the owner's password and multi-factor prompt, which I did not enter. So **not verified on Azure**: that the sign-in completes, that the owner's enrolment and role are honoured, that the register and review pages render with data, that the cookie works behind the Container Apps ingress (including the Origin check on POST requests), and that the policy pin is accepted.
2. That the in-container clone has advanced to the latest `main` after the policy change merged (the log only prints the first sync).
3. Any write path: no GitHub App is configured, so approvals and proposals are unavailable by design.
4. Behaviour under load, restart and failure; the 60-second sync under network failure.
5. Final-deck rendering: needs Windows PowerPoint, so a final deck cannot be built here (a sample deck can).

## Observed issues

- **Log noise:** every signed-out page request logs an `AccessDeniedError: Sign in to read the Architecture Studio` stack trace, because the page throws and the framework logs it. It is expected behaviour logged as an error. It should be caught and logged as one line; recorded for Phase B.
- **Image build:** two build failures were caused by my own packaging (a Windows CRLF line ending in the entrypoint script, and a test config included in the typecheck without its imports). Both are fixed in the local IaC folder.
- **The Azure CLI log streamer crashes** on the Unicode banner Next.js prints, in a cp1252 console. The build script reads logs through the registry's log link instead.

## Cost

Estimated from the Azure Retail Prices API (southeastasia, queried 2026-11-02) at the deployed sizes. **These are estimates, not billing data**; check Cost Management after a few days.

| Item | Estimate per 30.4 days |
|---|---|
| Container App, 0.5 vCPU and 1 GiB, one replica: all idle | about 16 USD before the free grant |
| Container App, worst case, active the whole month | about 55 USD before the free grant (about 48 USD after the monthly free grant of 180,000 vCPU-seconds and 360,000 GiB-seconds) |
| Container Registry, Basic | about 5 USD |
| Log Analytics | the retail price was **not retrieved**; the ingestion cap of 0.1 GB per day bounds it (assuming a list price of a few USD per GB, an ASSUMPTION, at most a few USD per month) |
| Realistic total with this traffic | **roughly 15 to 25 USD per month** |
| Worst-case total | about 65 USD per month, **under the 100 USD ceiling** |

## Operate

| Task | How |
|---|---|
| Redeploy a new image | Build with the local script `build-image.ps1`, then `az containerapp update -n ca-gfstudio -g rg-greenfuel-studio-sea --image <registry>/greenfuel-studio:<tag>`. A full Bicep redeploy needs the client secret again as a parameter |
| Rotate the Entra secret | `az ad app credential reset`, then redeploy the app with the new secret (it is replaced, not appended) |
| Change who can sign in | A reviewed pull request to `harness/policy/access-policy.json`, then **update `STUDIO_ACCESS_POLICY_SHA256`** on the app; until the pin matches, nobody can act |
| Stop the spend | `az group delete -n rg-greenfuel-studio-sea` and `az ad app delete --id 0f1982fa-032c-47f5-a2da-ae6cd319708a` remove everything this ADR created |
| Where the IaC is | `studio-azure-deploy/` beside the repository folder, **untracked and on one machine**: `main.bicep`, `Dockerfile`, `.dockerignore`, `deploy/entrypoint.sh`, `build-image.ps1` |

## Next actions for the owner

1. Open the URL, sign in with Microsoft, and tell me what you see; then I can finish the signed-in verification.
2. Register the GitHub App (GitHub UI) to enable the write path, then a second change configures it.
3. Enrol an approver signing key (TODO T13) so ADR-0021 can be Accepted with a signed approval.
4. Decide whether to move the secret to a private-endpoint Key Vault, and where the IaC should live.
