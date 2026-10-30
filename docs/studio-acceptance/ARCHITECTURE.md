# Architecture Decision Studio: architecture as built, and as it would be deployed

**Status:** the "as built" part is verified by the tests in [TEST-REPORT](TEST-REPORT.md). The "as deployed" part is a **design only**: nothing has been deployed to Azure ([DEPLOYMENT-PLAN](DEPLOYMENT-PLAN.md)).

The Studio is **not** the green-fuel bunkering application. It is a governance tool for the architecture of that application, and it is outside the scope of the bunkering application's sovereignty and tenant-isolation constraints (owner decision recorded under HC-11).

## 1. What it is

A Next.js 16 (Node 22) application in `apps/architecture-studio/`. It reads architecture records (ADRs, design reviews, requirements, risks, task manifests, approvals) from a git working copy of `polyfuze4336-bot/greenfuel-agent-harness`, normalizes them into a decision register, lets authorized people review decisions one at a time, proposes the result back to GitHub as a branch and pull request, computes build readiness, freezes an authorized architecture baseline, and builds an editable PowerPoint from that baseline.

**GitHub is the authority.** The Studio keeps only a cache and a local proposal store. A decision is shown as Approved only after the change is on the canonical branch.

## 2. Components

| Component | Where | Responsibility | Deterministic? |
|---|---|---|---|
| Repository adapter and parsers | `src/lib/intel`, `src/lib/repo` | Read files at a commit; extract decisions, options, requirements, tasks; keep provenance (path, line, commit) | Yes |
| Decision register | `src/lib/intel` | Normalize, validate, detect duplicates, detect changes, incremental sync, search | Yes |
| AI suggestions | `src/lib/intel` (labelled) | Optional, clearly labelled suggestions; never written to a record, never an approval | No, and never authoritative |
| Review workflow | `src/lib/workflow` | One decision at a time; approve, alternative, reject, defer, revise, conditions, comments, reopen; optimistic concurrency; idempotency keys; audit events | Yes |
| GitHub synchronization | `src/lib/github` | GitHub App auth, branch + commit + PR, webhook signature check, reconciliation, rate-limit and retry handling, conflict view | Yes |
| Access control | `src/lib/auth` | Entra ID sign-in, seven roles, enrolment, segregation of duties, signed approval records, session handling | Yes |
| Work queue | `src/lib/queue` | Tasks, blocking analysis, impact of rejected or deferred decisions | Yes |
| Baseline and build gates | `src/lib/baseline`, `.github/workflows` | Readiness validator, manifest, snapshot, drift detection, controlled reopening, CI gate | Yes |
| Presentation Studio | `src/lib/deck`, `scripts/render-deck.ps1` | Claims check, outline, PptxGenJS build, PowerPoint render, layout QA, export with hash verification | Yes (layout measured by PowerPoint) |
| Interface | `src/app`, `src/components` | Six areas: Overview, Decision Register, Work Queue, Approvals, Architecture & Evidence, Presentation Studio | n/a |

Detail: [DECISION-INTELLIGENCE](../architecture-studio/DECISION-INTELLIGENCE.md), [REVIEW-WORKFLOW](../architecture-studio/REVIEW-WORKFLOW.md), [GITHUB-SYNC](../architecture-studio/GITHUB-SYNC.md), [ACCESS-CONTROL](../architecture-studio/ACCESS-CONTROL.md), [WORK-QUEUE](../architecture-studio/WORK-QUEUE.md), [BASELINE](../architecture-studio/BASELINE.md), [PRESENTATION-STUDIO](../architecture-studio/PRESENTATION-STUDIO.md).

## 3. The approval path

```
person (Entra) ─► POST review action ─► server authorizes (role, ownership, SoD, step-up, CSRF, origin)
   ─► checks expected revision + idempotency key ─► builds a structured review record
   ─► GitHub App: branch decision-review/<ID>/… ─► commit ─► pull request
   ─► repository validation + required review on GitHub (policy, not the Studio)
   ─► a person merges on GitHub ─► Studio verifies the canonical branch ─► status becomes canonical
```

Proposal states shown to the user: locally submitted, awaiting GitHub update, pull request created, awaiting merge, applied to canonical repository, failed or conflicted. Only the last "applied" state changes a decision to Approved.

## 4. Trust boundaries

| Boundary | Control |
|---|---|
| Browser to Studio | Entra session cookie (HttpOnly, SameSite=lax, Secure in Entra mode), CSRF token, Origin check, CSP, frame denial |
| Studio to GitHub | GitHub App installation token minted server-side; private key read from a file path, never sent to the browser; no personal access token |
| GitHub to Studio | Webhook HMAC signature verified before any parsing; host allow-list |
| Repository content to Studio | Treated as data. A hand-written record, a Markdown claim or an agent commit cannot create an approval: approvals need a valid signature from an enrolled human key |
| Studio to local files | Path containment on source preview, materialization and deck export; deck output hash-verified before serving |
| Presentation | Final deck only after an authorized baseline, all presented decisions approved, supported claims, every slide approved at its content hash, rendered without QA errors, clean working tree |

## 5. State

| State | Location | Loss impact |
|---|---|---|
| Canonical records | GitHub repository | None to authority |
| Register and read cache | `STUDIO_CACHE_DIR` | Rebuilt from git |
| Proposals and audit events | `STUDIO_CACHE_DIR` store | Audit of *submissions* is also written to the repository as review records; the local audit alone is not the system of record |
| Slide approvals | Local editorial state (unsigned) | Re-approve slides; documented limitation |
| Generated decks | `docs/capstone/presentation/pptx/<deck-id>/` | Regenerated from commit |

## 6. Proposed Azure deployment (design, not built)

| Concern | Proposed | Why / open point |
|---|---|---|
| Host | Azure Container Apps (Linux) or App Service for Containers | Simple, managed-identity capable. **Open:** PowerPoint rendering is Windows-only, so a Linux host cannot produce a *final* deck (the `qa` gate). Options: Windows App Service with Office, or render on a Windows build agent and commit the rendered output. Not decided |
| Identity (human) | Entra ID app registration, seven app roles, enterprise-app assignment required | Needs tenant owner |
| Identity (workload) | System-assigned managed identity | To read Key Vault and pull from ACR |
| Secrets | Key Vault: GitHub App private key, webhook secret, Entra client secret | Mounted to a file path, matching the `…_FILE` settings |
| Repository access | GitHub App installed on one repository, minimal permissions | Needs repository owner |
| Registry and CI/CD | ACR, GitHub Actions with OIDC federation (no stored secrets) | Needs approval for billable resources |
| Monitoring | Log Analytics and Application Insights | Redact approvals and rationale text from logs |
| Network | HTTPS only; `STUDIO_ALLOWED_HOSTS` set to the real host; `STUDIO_REQUIRE_ENTRA=1` | Region choice is unresolved (D-009); the Studio is exempt from the bunkering residency rules, but the choice must still be recorded |

Environment settings the deployment must provide are listed in the [RUNBOOK](RUNBOOK.md).

## 7. Known architectural limits

1. The Studio reads a **local git clone**, so a deployment needs git, a clone and a way to fast-forward it (webhook-triggered pull).
2. Single-instance design: the proposal store and cache are files, not a shared database. Scaling out is not supported.
3. Slide approvals are not cryptographically signed.
4. No Azure resource, Entra tenant or GitHub App has been exercised: tests use a stand-in identity provider, a simulated pull-request service and a bare git remote.
