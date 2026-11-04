# Architecture summary

GreenFuel Architecture Studio: one web application, one thin server-side API, GitHub as the source of truth, the existing harness reused. No database, queue, cache service or second service. The detailed design is in [TARGET-ARCHITECTURE](../TARGET-ARCHITECTURE.md); this page states what is actually running.

```
 Browser (React 19, Tailwind 4, Radix, Lucide)
   │  HTML, JSON over HTTPS; JSON is gzip when accepted
   ▼
 Next.js 16 server (Node 22)  ── proxy.ts: Host allow-list (DNS-rebinding guard)
   │  /api/v1/*: guard() = read gate, gzip; mutations: session + role + CSRF + origin
   │
   ├── reads a git clone of the repository (STUDIO_REPO_ROOT), ref origin/main
   │     └── fetched every 60 s by the host process (and on a signed webhook); no database
   ├── file-backed state in STUDIO_CACHE_DIR: proposals, audit log, deck state and builds, register baseline
   ├── sign-in: Microsoft Entra ID (OIDC + PKCE) | GitHub CLI (development) | none (public-readonly)
   └── write-back (only in a signed-in mode): GitHub App → branch → commit → pull request → merge by a person → webhook → re-read
```

## What it is made of

| Part | Choice | Why |
|---|---|---|
| Web app and API | Next.js 16 App Router, one process | One deployable. Server components read the repository directly, so there is no API layer to keep in step |
| Source of truth | The GitHub repository, read from a local clone of `origin/main` | The Studio shows nothing the repository does not say, and changes state only by a merged pull request |
| Read model | Built in memory from the repository per commit, keyed by commit, person and open proposals | No database to reconcile. A webhook, an approval or a new commit clears it and a background rebuild follows |
| Governance | `harness/` policies, validators and signing, reused and not duplicated | The Studio calls the same rules CI enforces |
| Write-back | GitHub App with contents and pull-request write, one repository | Smallest permission that can open a pull request. It cannot merge or touch `main` |
| Approval evidence | Ed25519 signature over a hash-chained event, key held by the server | A person's identity and what they saw are bound together; AI text cannot stand in for it |
| Presentation | PptxGenJS (loaded only on build), PowerPoint for render and PDF | Editable native objects; PowerPoint measures real layout |
| Dependencies | 9 production packages, none unused, 0 known vulnerabilities | Radix dialog/popover/dropdown, Lucide, JSZip, PptxGenJS, Next, React |

## Hosting (Azure, as deployed)

Resource group `rg-greenfuel-studio-sea` (Southeast Asia), five resources:

| Resource | Setting | Note |
|---|---|---|
| Container App `ca-gfstudio` | 0.5 vCPU, 1 GiB, **exactly one replica**, external HTTPS ingress, `allowInsecure: false`, TCP startup and liveness probes | One replica because sessions are in memory and state is file-based. Do not scale out without moving them |
| Container Apps environment `cae-gfstudio-sea` | Consumption | |
| Container Registry (Basic) | Image `greenfuel-studio:m12-<sha>`, built in the registry (`az acr build`) | Immutable tag per release |
| User-assigned identity `id-gfstudio` | `AcrPull` on the registry | No registry password |
| Log Analytics `log-gfstudio-sea` | 30-day retention, 0.1 GB/day cap | Container console and system logs. **No alert rules exist** |

Live mode is **`public-readonly`**: anyone with the URL can read, nobody can sign in, and nothing can change. It holds no signing key and no GitHub App credential, so a decision cannot be approved there. **Nor can one be approved on the owner's computer today**: the access policy accepts approvals only from Microsoft Entra ID, the Entra app registration still needs an administrator's consent, and this computer has no signing key and no GitHub App credentials configured. A real approval needs all three (an accepted sign-in, a signing key, a GitHub App installation) in one running Studio. It fetches the repository over HTTPS every 60 seconds (no webhook is configured on Azure, so a merge appears within about a minute).

Infrastructure as code is `studio-azure-deploy/main.bicep` (registry, identity, logging, environment, role assignment, app; `authMode` parameter, default `public-readonly`). By an earlier owner decision it is **outside the repository**, so it is not version-controlled with the code. A Key Vault is not used because the tenant forces public network access off on every vault, which the app could not reach without a private endpoint and a network.

## Consistency between laptop and Azure

Both run the same code from the same commit and read the same GitHub branch. `GET /api/v1/version` returns the build id, the data commit and the record counts on each; the release check compares them. After this review both were build `cc98446`, data `cc98446`, 58 decisions.

## Decisions this design rests on

Native first; GitHub is canonical; a decision exists only as a merged pull request; an AI agent cannot approve; the Azure site is read-only until a sign-in the tenant allows is available (the Entra app registration needs an administrator's consent, which is not granted).
