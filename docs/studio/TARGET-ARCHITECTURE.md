# Target architecture

**Recommendation: keep the existing single Next.js application, make it a modular monolith with one thin API layer, keep GitHub as the only source of truth, and add no new infrastructure.** This is an evolution of `apps/architecture-studio/`, not a rewrite. Evidence and numbers are in [CURRENT-STATE-AUDIT](CURRENT-STATE-AUDIT.md); the order of work is in [SIMPLIFICATION-PLAN](SIMPLIFICATION-PLAN.md); how "done" is judged is in [PRODUCT-ACCEPTANCE-CRITERIA](PRODUCT-ACCEPTANCE-CRITERIA.md).

## 1. Constraints (from the brief and the repository)

- One lightweight web application and one thin server-side API.
- GitHub is canonical. The Studio holds a cache and proposals, never authority.
- Reuse the harness; add no specialist agent.
- No Redis, Kubernetes, broker or microservice, and no new database, without a **measured** justification. None exists today.
- Secure by default; human approval for high-impact actions; AI never approves; no production deployment (HC-11, T36).
- The Studio is not the bunkering application and is outside its sovereignty and tenant-isolation rules (owner decision, HC-11).

## 2. Logical architecture

```
Browser (React, server-rendered shell + small client islands)
   │  HTTPS, session cookie, CSRF token
   ▼
Next.js server  ──  one process
   ├─ ui/        pages and components, no business rules
   ├─ api/       route handlers: parse → authorize → call a service → return JSON/problem+json (thin)
   ├─ core/      pure functions: parse, normalize, validate, derive, score. No I/O
   ├─ adapters/  git (read), GitHub App (write), harness bridge, file store (cache/proposals)
   └─ features/  optional modules, loaded only when enabled (deck)
        │                 │                    │
        ▼                 ▼                    ▼
   local git clone   GitHub REST (App token)   harness/*.cjs|mjs (validators, approvals, memory)
   (read model)      branch, commit, PR        reused, not copied
```

Single direction of dependency: `ui → api → core ← adapters`. `core` imports nothing from `adapters`, which is what keeps parsing and rules testable without a server or git.

## 3. What stays, what changes

| Layer | Today | Target |
|---|---|---|
| Web app | Next.js 16, React 19, Tailwind 4, Radix, Lucide | Unchanged |
| API | 37 routes, 13 mutating | Same surface, handlers kept thin; every mutating route authorizes in one shared `authorize()` call (already true for review, queue, deck; extend to sync, reconcile, refresh) |
| Read model | Rebuilt from git when a 5 s TTL expires, synchronously | **Snapshot keyed by commit SHAs**, built asynchronously, served stale-while-revalidate (§4) |
| Harness use | 3 `createRequire` sites, much re-implemented | One `harness-bridge` module; validators decide, the Studio explains (§6) |
| State | `STUDIO_CACHE_DIR` files (cache, proposals, audit) | Unchanged for one instance; the cache is disposable, proposals and audit are mirrored to GitHub as records (already true) |
| Deck builder | Core part of the app | Optional feature module |
| Tests | Unit (`checks/`), e2e (`e2e/`), harness (`tests/`) | Same, plus a Studio CI job |

## 4. Performance design (the one structural change)

Problem (measured): a 3.5 to 6.5 s synchronous rebuild every time the 5 s TTL has lapsed; 241 of 241 parsed files are reused, so the cost is elsewhere and blocks the event loop.

Design:

1. **Cache key = `(canonical SHA, working-ref SHA, policy file hashes)`.** One `git rev-parse` (tens of ms) decides whether the snapshot is current. No clock-based expiry.
2. **Async git** (`execFile`, still allow-listed subcommands, still no shell) so a rebuild never blocks other requests.
3. **Stale-while-revalidate:** serve the last snapshot immediately, rebuild in the background when the key changes, and tell the user ("Showing `7cb8473`, updating"). Correctness is unchanged because every view already shows its commit.
4. **Profile before optimizing further.** The rebuild's breakdown is unknown. Add timing around git calls, assembly, duplicate detection, suggestions and overlay; fix the largest. If rebuild stays above 1 s, split the snapshot into per-domain lazily computed parts (register, queue, baseline) rather than adding a store.
5. **Smaller pages:** the server sends a summary view-model; tables load pages of 50 rows from the API; detail loads on demand.

Measured exit: p95 TTFB under 500 ms for every page after idle, on the same machine and probe as the audit.

When would a database or cache server be justified? Only if, after §4 steps 1 to 5, a measured rebuild above 1 s or concurrent-user contention appears on the chosen host. Until then the answer is no.

## 5. Source of truth and state

| Data | Authority | Studio keeps |
|---|---|---|
| Decisions, requirements, tasks, reviews, approvals, baselines | Files on the canonical branch in GitHub | A derived snapshot (disposable) |
| A proposed change | The pull request and its review record on GitHub | A local proposal row until GitHub confirms (state machine: locally submitted → awaiting GitHub update → pull request created → awaiting merge → applied → failed/conflicted) |
| Audit | Review records and PRs on GitHub | A local audit log (secondary, not the system of record) |
| Sessions, CSRF | The Studio | Server-side session store, in memory or a small file |
| Resumable agent work | `harness/memory` and `docs/state` | Not duplicated |

Rule: **a decision is shown as Approved only after the canonical branch says so.** This is already enforced and tested; it must not regress.

## 6. Harness reuse

| Concern | Called through the bridge | Behavior |
|---|---|---|
| Signed approvals | `approval-gates.cjs`, `registry.cjs` | Validity is decided by the harness |
| Design Blocked | `design-gate.mjs` | Add an equivalence test; the Studio's status must equal the harness's |
| Requirements, sovereignty, architecture checks | `spec-validators.mjs` | Surfaced as "validation" on a decision |
| Tasks | `tasks.mjs` | The queue explains; it does not diverge |
| Memory | `memory/store.cjs` | Decision memory derived from ADRs, not hand-mirrored |
| Control-plane protection | `ci-control-plane-guard.mjs`, CODEOWNERS, rulesets | Unchanged and made enforceable by a ruleset |

No new agent is needed. The twelve existing agents already cover architecture, security, data, AI, SRE, QA and review; the Studio is a tool they and the human use, not a participant in approvals.

## 7. Rejected architectural alternatives

| Alternative | Why rejected |
|---|---|
| **Rewrite** in a lighter framework (Vite, Hono, Astro) | About 21k lines and 9k lines of tests would be discarded for a speculative gain. The measured slowness is a caching and I/O problem, not a framework one. Revisit only if build or runtime cost is measured as the limiting factor |
| **Separate SPA and API services** | Adds deployment, CORS, auth hand-off and a second runtime for no measured need; Next route handlers already form a thin API |
| **Microservices** (sync, approvals, deck, queue) | Four domains share one snapshot and one session; splitting them multiplies failure modes. No team or scaling boundary requires it |
| **Database (SQLite, Postgres, Cosmos DB)** | Creates a second source of truth that can disagree with GitHub, the exact risk the design avoids. The snapshot is derivable and disposable. Not needed for one instance |
| **Redis or another cache server** | Solves a problem (shared cache across instances) that does not exist: single instance, and the cost is not cache misses on parsing |
| **Message broker or workflow engine for sync** | The sync path is a handful of REST calls with idempotency keys and a reconcile endpoint, already tested for retry, rate limit and conflict |
| **Kubernetes / AKS** | One small stateful process; Container Apps or App Service would suffice if ever deployed. No scale evidence |
| **Azure Functions API behind a static site** | A static site cannot hold sessions or the write path; cold starts and a split state model add risk |
| **GitHub-native only** (Issues, Projects, Discussions) | Cannot express signed approvals, the baseline gate or the structured review workflow; no custom UI |
| **VS Code extension / webview** | Good for developers but not for approvers or the panel; would duplicate auth and PR flow. Could be added later over the same API |
| **More specialist agents** (UI, sync, governance) | Existing agents cover the roles; extra agents widen the permission surface (see AGENTS.md and ADR-0006) |
| **LLM-written decisions or approvals** | Violates the principle that AI never approves; AI stays a labeled suggestion |
| **Studio holding a privileged repo token** | Bypasses review; the GitHub App with minimum permissions, plus a ruleset, is the design |

## 8. Proposed file structure

Changes are moves and splits inside the existing app; paths below are the target. `lib` is regrouped into `core`, `adapters` and `features`, and old paths keep working until a phase completes.

```
apps/architecture-studio/
  src/
    app/                         # routes only: pages + api/ handlers (thin)
      (main)/                    # overview, decisions, queue, approvals, architecture
      (features)/presentation/   # present only when the deck feature is enabled
      api/v1/...                 # same 37 routes
    ui/                          # components (was src/components), shared primitives first
      primitives/                #   Button, Chip, FilterBar, InfoPopover, EmptyState, Skeleton
      decisions/ queue/ review/ baseline/ access/
    core/                        # pure, no I/O (was intel, queue/derive, baseline/readiness, workflow rules)
      decisions/ queue/ baseline/ workflow/
    adapters/
      git/                       # async read adapter (was repo/git.ts)
      github/                    # App auth, REST, webhook (was lib/github)
      harness-bridge.ts          # the single place that touches harness/*
      store/                     # cache, proposals, audit files
      auth/                      # Entra, sessions, access policy (was lib/auth)
    features/
      deck/                      # optional (was lib/deck + components/deck)
    snapshot.ts                  # commit-keyed read model
  checks/                        # unit tests (unchanged)
  e2e/                           # browser tests (unchanged)
  scripts/                       # baseline.ts (CI gate), api-probe.mjs, deck.ts (feature)
docs/studio/                     # the single home for Studio documents (index.md)
harness/                         # unchanged
```

`scripts/baseline.ts` must keep its path: `architecture-gate.yml` runs it, and CODEOWNERS protects it.

## 9. Security boundaries (target)

| Boundary | Control | Status |
|---|---|---|
| Identity | Entra ID in every deployment; `STUDIO_REQUIRE_ENTRA=1`; development sign-in only on loopback | Built; real Entra untested |
| Authorization | One server-side `authorize()` in every mutating route; roles from the pinned access policy | Extend to sync, reconcile, refresh |
| Origin and CSRF | Origin check and token on every mutating route | Add to refresh and register sync |
| Repository writes | GitHub App, minimum permissions, branch + PR only | Built; real App untested |
| Branch integrity | **Ruleset on `main`**: PR, required checks (`validate`, `studio`), CODEOWNERS review, no force push | **Not applied; now possible** |
| Approvals | Signed by an enrolled human key; text, agents and commits cannot approve | Built; no key enrolled yet |
| Outputs | Hash-verified before serving | Built |
| Content | Strict CSP, nonce-based scripts and styles | Today `unsafe-inline` |
| Public repository | No secret or personal data in tree or history; webhook secret only in the host's secret store | Scan clean; the public repo exposes history |
| Logs | No approval rationale or tokens in logs | To verify on a host |

## 10. Deployment posture (design only)

Unchanged from [DEPLOYMENT-PLAN](../studio-acceptance/DEPLOYMENT-PLAN.md): single instance, managed identity, Key Vault, Log Analytics. Nothing is created. The deck feature's Windows PowerPoint requirement is the main hosting constraint, and being an optional module is what lets the core Studio run on Linux.

## 11. Open questions

1. Is a ruleset acceptable for `main` now that the repo is public?
2. Who is the second human for segregation of duties?
3. Keep the deck builder in this repository, or move it out?
4. Where will the Studio be hosted, if at all, and is local-only use enough for the capstone?
