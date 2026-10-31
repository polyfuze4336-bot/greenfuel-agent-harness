# Security report: Architecture Decision Studio

Scope: the Studio application (`apps/architecture-studio`), its GitHub App integration, its authentication and authorization, the deck pipeline, and the build/CI workflows. **Not in scope:** the future bunkering application, any Azure resource (none exists).

**Method:** (1) an independent code-level security review by a separate review agent; (2) a black-box API probe ([api-probe.json](api-probe.json), 90 checks); (3) dependency audit; (4) secret scan of the working tree and all 94 commits; (5) the negative tests in [TEST-REPORT](TEST-REPORT.md); (6) the access-control tests from the earlier stage ([ACCESS-CONTROL](../architecture-studio/ACCESS-CONTROL.md)).

**Limits of this evidence:** all authentication was tested against a **stand-in for Entra ID**, GitHub against a **simulated service**, and nothing against a deployed host. No penetration test, no fuzzing campaign, no third-party review.

## 1. Independent review: reportable findings

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| none | — | — | — | No CRITICAL, HIGH or MEDIUM vulnerability met the reporting threshold | — |

The reviewer examined sign-in and session handling, authorization, CSRF and Origin checks, the GitHub App and webhook signature path, the deck pipeline's file handling, the git adapter, response headers, secrets handling and the workflows (actions pinned by SHA, `contents: read`, `pull_request` rather than `pull_request_target`). "No reportable finding" is a statement about what one review found at its confidence threshold, **not** a proof of absence.

## 2. Hardening items found, and what was done

| Ref | Item | Severity (reviewer) | Status |
|---|---|---|---|
| H-1 | `materialize` in `src/lib/baseline/facts.ts` could be given a name that escapes the temp folder | LOW | **Fixed**: backslash, colon and `..` names rejected; resolved path must stay under the temp directory |
| H-2 | Deck export served files without re-checking them against the generation record: a swapped or corrupted file, or a tampered sample/final mode, would have been served | Found by this acceptance work | **Fixed**: `verifiedLatest()` verifies sha256 and mode against `generation.json`; failures return `output-corrupted`, `output-missing`, `record-mismatch`, `no-record` or `no-build`. Tested live (corruption test) |
| H-3 | Authentication mode defaulted to development sign-in when `STUDIO_AUTH_MODE` was forgotten (fail-open default) | Found by this acceptance work | **Fixed**: `STUDIO_REQUIRE_ENTRA=1` forces Entra mode and fails closed until Entra is configured; unit-tested. **A deployment must set it** (in the [RUNBOOK](RUNBOOK.md)) |
| H-4 | Step-up re-authentication relies on token `iat`, not `auth_time` (`src/lib/auth/entra.ts`) | MEDIUM, confidence 6/10 | **Open.** Recheck against real Entra token claims before relying on step-up |
| H-5 | Proposal sync and `sync/reconcile` need a session but no specific role | LOW | **Open.** They only reconcile with GitHub and create no approval |
| H-6 | Idempotency-key lookup is not scoped to the caller (`review.ts`) | LOW | **Open.** Another user replaying a known key can see a duplicate result, not create an approval |
| H-7 | `POST /api/v1/refresh` and `/api/v1/register/sync` have no Origin/CSRF check | LOW | **Open.** They only refresh a cache; the probe confirms they reach no repository data change |

## 3. Black-box API probe (90 checks, 0 failed)

Run against a production build on localhost: 37 routes, 13 state-changing.

| Area | Result |
|---|---|
| State-changing routes with no session, with no, foreign and own origin | Every one refused with a 4xx (the two cache-refresh routes may answer 2xx and change no data; the webhook requires a valid HMAC signature). The development sign-in with the right origin was deliberately not probed because it would open a session |
| Read-only routes receiving `DELETE` | 405 or 404 |
| Path traversal on source preview, deck export and preview, review and queue ids (eight hostile paths including `..\`, encoded `..`, absolute paths, `.git/config`, NUL byte) | Refused (4xx); `%2e%2e` is normalized by Next into a redirect to a path that is itself checked |
| 3 MB bodies and malformed JSON | 4xx, no crash, no internals |
| Headers | CSP present without `unsafe-eval`; `X-Content-Type-Options: nosniff`; framing denied; `Referrer-Policy: no-referrer`; no `X-Powered-By`; `Cross-Origin-Resource-Policy: same-origin` |
| Error bodies | 404s and problem documents contain no stack traces, file paths or `node_modules` |

Note on the CSP: `script-src` and `style-src` include `'unsafe-inline'` (Next.js inline hydration scripts). A nonce-based policy would be stronger and is not implemented.

## 4. Dependencies, secrets

| Check | Result |
|---|---|
| `npm audit` in `apps/architecture-studio` | **0 vulnerabilities** (includes a pinned `image-size` override; `pptxgenjs` never loads it) |
| `npm audit` at repository root | Not applicable: the harness has no dependencies and no lockfile |
| Secret scan: private-key blocks, GitHub tokens, AWS and Azure storage/SAS keys, Slack tokens, over the working tree and all 94 commits | **0 matches** |
| Browser bundle | The access test confirms no secret reaches any script, page or response |
| Secret-shaped files | `.env.*` and `.studio-cache/` are git-ignored; no `.pem`/`.key`/`.pfx` tracked |

The scan is pattern-based and finds known token shapes only. It cannot find a low-entropy password or an unusual format.

## 5. Controls technically enforced (tested) versus limitations

| Control | Enforced where | Test evidence |
|---|---|---|
| Every action needs an authenticated identity; server-side authorization; no client-only approval controls | Server | Access suite; acceptance "unauthorized approval" (no role, viewer, contributor, security reviewer, agent identity, impostor) |
| AI, bots and agents cannot hold roles | Enrolment rules | Access suite; acceptance |
| A hand-written, replayed or altered approval record is not an approval | Signature and subject-hash verification | Acceptance "forged approval"; access suite |
| Approved text changed after approval voids the approval | Subject hash | Acceptance "change after approval" |
| Segregation of duties; revoked approver | Policy engine | Access suite |
| Baseline and final deck cannot be forged by editing state files | Server recomputation | Acceptance pre-baseline refusal, forged baseline and slide state |
| Corrupted or swapped deck output is not served | Hash verification | Acceptance corruption test |
| No privileged repository token bypasses review | Studio has no code path to `main` | Review and GitHub-sync tests |

**Remaining limitations** (none of these is hidden by the tests):

1. No real Entra tenant, GitHub App, branch protection or deployed host was used. Everything above is **local evidence**. (`validate` and `architecture-gate` did succeed on GitHub for the pushed commit.)
2. **No platform-enforced branch protection** (plan limitation). The only thing preventing a Contents-write credential from pushing to `main` is the Studio's own code.
3. Slide approvals are unsigned local state.
4. Single-instance, file-backed state; no shared store, so no multi-instance concurrency guarantees.
5. Development sign-in and `localhost`-only reads are conveniences for local use and must be disabled (`STUDIO_REQUIRE_ENTRA=1`) in any deployment.
6. Open items H-4 to H-7 above.
7. CI controls on GitHub cannot prevent every local coding action; the baseline gate blocks CI authorization, not a developer's machine.
