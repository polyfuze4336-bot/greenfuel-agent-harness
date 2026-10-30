# Operational runbook

Covers running the Studio **locally** (verified) and the settings a **deployment** would need (not deployed; see [DEPLOYMENT-PLAN](DEPLOYMENT-PLAN.md)).

## Run locally

```powershell
cd apps\architecture-studio
npm install            # first time only
npm run build          # a type error anywhere under src, checks or e2e fails the build
npm run start          # http://localhost:3100  (foreground; keep the window open)
```

- It answers **only on loopback** unless `STUDIO_ALLOWED_HOSTS` lists the host (DNS-rebinding defence). A different hostname returns 403.
- *"The localhost app is not running"* is almost always one of: the `npm run start` window was closed; the build failed so there is no `.next`; port 3100 is held by an old process (`Get-NetTCPConnection -LocalPort 3100 -State Listen`). Stop the owning process by id, rebuild, start again.
- Health check: `GET /api/v1/register` returns 200 with a commit. `GET /api/v1/sync/status` shows repository sync state.
- Development sign-in uses the GitHub CLI account on this computer and is labelled as development. It exists only when Entra mode is off.

## Settings (environment, never the repository, never the browser)

| Setting | Purpose |
|---|---|
| `STUDIO_REQUIRE_ENTRA=1` | **Set in every deployment.** Forces Entra mode; missing Entra settings then fail closed instead of falling back to development sign-in |
| `STUDIO_AUTH_MODE=entra`, `STUDIO_ENTRA_TENANT_ID`, `STUDIO_ENTRA_CLIENT_ID`, `STUDIO_ENTRA_CLIENT_SECRET_FILE`, `STUDIO_ENTRA_REDIRECT_URI` | Entra sign-in. The secret is read from a file path |
| `STUDIO_ACCESS_POLICY_SHA256` | Pins the access policy; a different policy is not trusted and nobody can act |
| `STUDIO_REPO_ROOT`, `STUDIO_BRANCH`, `STUDIO_CANONICAL_REF` | Which clone and ref are read |
| `STUDIO_GITHUB_REPO`, `STUDIO_GITHUB_APP_ID`, `STUDIO_GITHUB_APP_INSTALLATION_ID`, `STUDIO_GITHUB_APP_PRIVATE_KEY_FILE` | GitHub App |
| `STUDIO_GITHUB_WEBHOOK_SECRET`, `STUDIO_WEBHOOK_HOSTS` | Webhook verification and the one host allowed to reach the webhook route |
| `STUDIO_SIGNING_KEY_FILE`, `STUDIO_TRUSTED_SIGNING_KEYS_FILE` | Server signing of review records |
| `STUDIO_CACHE_DIR`, `STUDIO_DECK_DIR` | Cache/proposal store and deck output |
| `STUDIO_ALLOWED_HOSTS` | Host names the Studio answers to |

`STUDIO_ALLOW_DEV_APPROVALS`, `STUDIO_TEST_*` and `STUDIO_E2E_DELAY_MS` are for tests only and must never be set in a deployment. Entra mode ignores the development allowance.

## Routine operations

| Task | How |
|---|---|
| Pick up new commits | `git fetch` + fast-forward the clone, then `POST /api/v1/refresh` (the interface has a sync control) |
| A proposal is stuck | Open the decision; use *sync*. `POST /api/v1/review/proposals/{id}/sync` reconciles against GitHub |
| Reconcile everything | `POST /api/v1/sync/reconcile` (any signed-in user) |
| Review access | Approvals page, *Access review*; suspend or attest approvers there |
| Rotate the GitHub App key | Generate a new key on GitHub, replace the file, restart, delete the old key on GitHub |
| Rebuild a deck | Presentation Studio, or `node scripts/deck.ts build` (see [PRESENTATION-STUDIO](../architecture-studio/PRESENTATION-STUDIO.md)) |
| Verify a deck | `node scripts/deck.ts verify <deck-folder>` |

## Failure guide

| Symptom | Meaning | Action |
|---|---|---|
| Proposal *awaiting GitHub update* | GitHub was unreachable or rate-limited. **Not** a success | Retry sync; the same request is idempotent |
| *Conflicted* or *stale revision* | The repository changed after you opened the decision | Reconcile in the conflict view; nothing was overwritten |
| *policy-invalid* | Access policy hash does not match the pin, or the policy is invalid | Nobody can act until the pin and policy agree; fix through a reviewed change |
| Final deck refused | One of the gate items is unmet (see the list in the page) | Meet it; do not edit state files (a forged state file is detected) |
| Deck export refused with code `output-corrupted`, `output-missing` or `record-mismatch` | The file on disk no longer matches its generation record | Rebuild the deck |
| Baseline *drifted* | A decision or requirement changed after authorization | Follow change control; reopen through the controlled workflow |

## Tests

| Command | What it runs |
|---|---|
| `npm test` (repository root) | 1086 harness tests |
| `npm run validate` (root) | Repository validators |
| `npm run test:unit` (`apps/architecture-studio`) | 373 Studio unit tests |
| `npx playwright test` (`apps/architecture-studio`) | Browser and acceptance tests; needs ports 3100-3108 free and starts its own servers |
| `node scripts/api-probe.mjs http://localhost:3100 out.json` | Black-box API security and latency probe against a running Studio |

## Backup and recovery

The repository is the system of record; the cache can be deleted and is rebuilt. Back up only the access policy (it lives in the repository), the GitHub App private key and the signing keys (secrets store, not git).
