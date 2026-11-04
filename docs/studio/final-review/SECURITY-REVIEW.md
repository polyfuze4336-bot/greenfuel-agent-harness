# Security review: GreenFuel Architecture Studio

Final review, 2026-11-03. Build `cc98446` plus the fixes listed below. Method: an independent read-only code audit of every API route, the authentication and authorization modules, the GitHub integration, the deck and repository modules, the container and the infrastructure template, followed by fixes and browser tests for what was found. It is **not** a penetration test: no running system was attacked, and live Azure settings were read only through the Azure CLI.

Earlier security work is in [SECURITY-REPORT](../../studio-acceptance/SECURITY-REPORT.md) and [ACCESS-CONTROL](../../architecture-studio/ACCESS-CONTROL.md). This page records what the final review found and what it verified.

## Result

No critical or high issue. One medium issue is **open**. Two low issues and one hardening item are **fixed**. Several hardening items are open and listed with an owner decision needed or a recommendation.

## Findings

| # | Severity | Where | Finding | Status |
|---|---|---|---|---|
| 1 | Medium (8/10) | `workflow/review.ts:355`, `workflow/overlay.ts` | An approval is bound to the source revision when it is **submitted**. After the merge nothing compares the recorded record hash with the record's current text, so an ADR edited after approval still shows **Approved** on the decision. The baseline subsystem catches it, but only for decisions already in an authorized baseline (`decision-text-changed`) | **Open.** Fix needs the signed approval event to carry a status-independent text hash, which is a schema change to signed records, so it was not made in a review pass. Mitigations: a change to an ADR is itself a reviewed pull request on a protected branch, and an authorized baseline invalidates on text change. Recommended: record `textHash` in the event and show "approved, text changed since" |
| 2 | Low (9/10) | `api/v1/register/sync` POST | No session, origin or CSRF check, and it overwrote one baseline file shared by every visitor, so on the public read-only site a stranger could reset what everyone sees as "changed since the last sync" | **Fixed.** Refused with 403 on a read-only deployment. Tested: `e2e/hardening.spec.ts` |
| 3 | Low (9/10) | `api/v1/sync/reconcile`, `api/v1/review/proposals/[pid]/sync` | A signed-in viewer could make the server push a branch and open a pull request through the GitHub App | **Fixed.** Both need the permission to propose. Tested |
| 4 | Hardening | `auth/config.ts` | An unset or mistyped `STUDIO_AUTH_MODE` fell back to the development sign-in, which signs a caller in as the account running the server | **Fixed.** A server told to answer on other hosts (`STUDIO_ALLOWED_HOSTS`) never uses it; it falls back to read-only. Unit-tested |
| 5 | Hardening | `lib/api.ts` | Git error text, which can include server paths, was returned to readers | **Fixed** for repository errors. The deck build route still returns up to 300 characters of an error message to a signed-in editor |
| 6 | Hardening | `studio-azure-deploy/main.bicep` | The template set Entra sign-in and `STUDIO_REQUIRE_ENTRA=1`, while the live app is `public-readonly`. Redeploying from it would have changed the live behaviour | **Fixed in the local template** (`authMode` parameter, default `public-readonly`, plus the scope and ref settings that were set by hand). A `what-if` against the live app shows no change to the auth mode. **Not applied.** The template is outside the repository by an earlier owner decision, so this fix is not in version control |

## Open hardening items

| Item | Why it matters | Recommendation |
|---|---|---|
| Segregation of duties is off, and one approver is enrolled | One person can propose, approve and merge their own change unless a GitHub ruleset requires an independent review | Owner decision (2026-11-03, recorded). Revisit when a second approver exists |
| Policy pin (`STUDIO_ACCESS_POLICY_SHA256`) is optional in Entra mode | Without it, anyone who can merge to `main` can change roles. The double requirement for privileged roles is the remaining control | Make the pin mandatory when Entra mode is on |
| GitHub merge policy can fail open (`unknown` or `partial` does not block) | A pull-request rule with zero required approvals still counts as a human merge | Treat `unknown` as blocking, or show it prominently |
| Step-up freshness uses the token issue time, not `auth_time` | The 15-minute recent-sign-in check depends on Entra honouring `max_age` | Validate `auth_time` as well |
| Unauthenticated writes to the audit log | A flood of denied calls appends hash-chained entries, and each append re-reads the file | Rate-limit, or do not audit unauthenticated denials. The chain is tamper-evident against partial edits only, not signed or anchored |
| CSP allows `script-src 'unsafe-inline'`; no HSTS; no `__Host-` cookie prefix; `sameOrigin` ignores the scheme | Defence in depth. No XSS sink was found; the only `dangerouslySetInnerHTML` is a constant theme script | Nonce-based CSP; HSTS at the ingress; cookie prefix |
| Image uses `node:22-bookworm-slim` without a digest and unpinned `apt-get`; the template defaults `imageTag` to `latest` | Supply-chain drift | Pin the digest; deploy by immutable tag (this review's deploys already use `m12-<sha>`) |
| The access policy in the public repository names the tenant, client and administrator | Not secrets, but they help enumeration | Accepted |
| Signing key is not configured on Azure | Approval there is impossible. This is good, but implicit | Documented in [ARCHITECTURE-SUMMARY](ARCHITECTURE-SUMMARY.md) |

## Controls verified

Each was checked in code by the audit; those marked (test) are also covered by a browser or unit test.

* **Authentication.** The public-readonly mode cannot create a session: sign-in returns 404 and every state-changing route returns 401 (test). Sessions are 32 random bytes, only the SHA-256 is stored, a new token at every sign-in (no fixation), idle and absolute limits on every read, and roles are recomputed from policy on each request. The cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` off loopback. Entra uses authorization code with PKCE, state, nonce and a browser-binding cookie; the ID token must be RS256 with exact issuer, tenant, audience, expiry and nonce; no access or refresh token is requested.
* **Authorization.** Every state-changing route checks a session, a role, CSRF and the origin (matrix below). Privileged roles need both the Entra assignment and an active enrolment. The approver must be designated for the record, have MFA, and have signed in within 15 minutes. The policy parser drops any entry not marked as a human, so bots and agents cannot be enrolled. Regulatory, clarification and unclassified records are not approvable. (test)
* **CSRF and origin.** `Origin` must equal `Host`, the content type must be JSON, and `x-studio-csrf` must match a per-session token. A `Host` allow-list blocks DNS rebinding. (test)
* **Approval integrity.** A record counts only with an Ed25519 server signature over the event hash. Trusted keys come from server configuration, never from the repository. Hand-written approval files fail on hash or signature. AI challenge files must be marked unreviewed and carry no status. A stale source blob or revision is refused at submit, a duplicate submission returns the existing proposal, and a decision is locked while one change is in flight. (test)
* **GitHub App.** The private key is read from a file and kept out of logging. The installation token is scoped to one repository with contents and pull-request write, and checks, statuses and metadata read. The app never moves an existing branch, never writes to `main`, never merges and never approves. Webhooks use a constant-time HMAC-SHA256 over the raw body, a repository check and delivery-id replay protection; a missing secret returns 503. The GitHub API URL is an operator setting, so there is no request-controlled server-side request.
* **Input handling.** The source and history routes allow-list prefixes and extensions and reject `..`, leading `/` and backslashes; the revision must be 40 hex characters in the file's own history. Git is run with an allow-list of subcommands, array arguments and no shell, and refs cannot start with `-`. Deck previews and exports take no filename from the request and are re-hashed before they are served. Repository text renders only as React text.
* **Secrets.** The Entra client secret is a Container Apps secret mounted as a file, never an environment variable or an output. The image contains no secret. `.dockerignore` excludes `.env*` and caches. The container runs as a non-root user.
* **Audit trail and concurrency.** The audit log is hash-chained. The deck and review stores use a revision check, atomic temporary-file-and-rename writes and a per-key lock, so two browsers cannot silently overwrite each other (test).
* **Headers.** CSP with `frame-ancestors 'none'`, `object-src 'none'`, `connect-src 'self'` and `base-uri 'self'`; `X-Frame-Options: DENY`; `nosniff`; `Referrer-Policy: no-referrer`; a restrictive Permissions-Policy; CORP `same-origin`; no CORS; no `X-Powered-By`.

### State-changing routes

| Route | Session | Role | CSRF | Origin |
|---|---|---|---|---|
| `review/[id]/actions`, `queue/[id]/actions` | yes | yes | yes | yes |
| `deck/actions`, `deck/build` | yes | yes | yes | yes |
| `access/suspend`, `access/attest` | yes | yes | yes | yes |
| `sync/reconcile`, `review/proposals/[pid]/sync` | yes | **yes (fixed)** | yes | yes |
| `register/sync` POST | n/a | n/a | n/a | refused on a read-only deployment (**fixed**); on a laptop it writes only a cache file |
| `refresh` POST | read gate | no | no | rebuilds a cache only; on a read-only deployment it cannot fetch |
| `auth/signin`, `auth/signout` | n/a | n/a | sign-out has no token (nuisance logout only) | yes; sign-in is disabled outside development mode |
| `github/webhook` | n/a | n/a | n/a | HMAC; the proxy admits only POST to this path on the webhook hosts |

## Not verified

The exact `Authorization` header construction in the GitHub client (masked in the audit tooling), the live Azure settings beyond those read with the Azure CLI, `harness/scripts/approval.mjs` and GitHub ruleset enforcement in CI, and any behaviour at run time. A real approval has **not** been performed through the workflow against the real repository (see [FINAL-REVIEW](FINAL-REVIEW.md)).
