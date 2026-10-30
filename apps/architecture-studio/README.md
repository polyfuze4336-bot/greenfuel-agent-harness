# Architecture Decision Studio

A local web application over the decisions, tasks, approvals, assumptions and evidence recorded in this repository. It reads committed git content and shows it. **Reading never changes anything.** The one thing that writes is the [decision review workflow](../../docs/architecture-studio/REVIEW-WORKFLOW.md): it proposes a decision as a pull request, never to your branch or to `main`, and shows a decision as decided only after a person has merged it. Until a person is registered as an approver in `harness/policy/decision-workflow.json`, nobody can decide; one account is registered at present.

This is **not** the bunkering platform. It is part of the engineering and governance control plane, and no business logic of the Green-Fuel Bunkering Certification Platform lives here.

> Governance status: the Studio was built on the owner's explicit instruction. Its authorising ADR does not exist yet and no approver is enrolled, so the build is unsigned. See [UI-READONLY-REPORT](../../docs/architecture-studio/UI-READONLY-REPORT.md) section 7 and owner TODO T61.

## Run it

Needs Node 22.18 or later and git. From this folder:

```powershell
npm ci --ignore-scripts
npm run build
npm start          # http://localhost:3100, loopback only
```

`npm run dev` runs the development server on the same address. Open `http://localhost:3100`.

| Variable | Default | Meaning |
|---|---|---|
| `STUDIO_REPO_ROOT` | the git repository containing the working directory | Repository to read |
| `STUDIO_REF` | `HEAD` | Branch, tag or commit to read. Only plain ref names are accepted |
| `STUDIO_ALLOWED_HOSTS` | none | Extra `Host` header values to accept, comma separated. Leave unset |
| `STUDIO_E2E_DELAY_MS` | `0` | Test only: delays repository reads so loading states can be shown |
| `STUDIO_CACHE_DIR` | `<working directory>/.studio-cache` (git-ignored) | Where the sync baseline, review proposals and the audit log are kept. Never inside the tracked tree |
| `STUDIO_CANONICAL_REF` | `origin/main` | The branch whose review records make a decision canonical, as `remote/branch` |
| `STUDIO_TEST_MODE`, `STUDIO_TEST_FIXTURE_DIR`, `STUDIO_TEST_REMOTE_GIT_DIR` | unset | Test only: simulated GitHub identity and pull requests against a throw-away clone. A banner is shown. Never set these for real use |

## What it shows

| Page | Source of truth it reads |
|---|---|
| Overview | Every figure is derived; each carries its definition |
| Decision Register | `docs/adr/*.md` (20 ADRs) and `docs/context/DECISION-REGISTER.md` (37 open entries) |
| Work Queue | TODO, the roadmap, the capstone backlog, gaps and rubric traceability, the security review, residency validation, the risk register, decisions, design gates and requirement gaps; merged records under `docs/work-items/`. See [WORK-QUEUE](../../docs/architecture-studio/WORK-QUEUE.md) |
| Approvals | `harness/policy/approvers.json`, `docs/approvals/`, Proposed ADRs and design reviews |
| Architecture & Evidence | design reviews, requirements and traceability, risks, assumptions, evidence records, documents |
| Presentation Studio | `docs/capstone/presentation/` |

Counting and status rules are in [DATA-MAPPING](../../docs/architecture-studio/DATA-MAPPING.md). The Decision Register uses the Decision Intelligence Engine (`src/lib/intel/`), documented in [DECISION-INTELLIGENCE](../../docs/architecture-studio/DECISION-INTELLIGENCE.md): seven statuses, provenance for every field, duplicate and overlap candidates, change detection, Compare Alternatives, and clearly labelled AI suggestions that never alter a record. A test compares the Studio's counts with the independent discovery snapshot.

## How it is built

```
git objects at one commit ──► GitRepositoryAdapter (read-only allowlist)
                              ──► parsers (src/lib/repo/parse.ts)
                              ──► StudioModel (src/lib/repo/build.ts)
                              ──► server components and /api/v1/* (read-only)
                              ──► React UI (Next.js App Router, Tailwind, Radix primitives, lucide icons)
```

- **One commit, no drift.** The adapter resolves `HEAD` (or `STUDIO_REF`) once and reads blobs from that commit. Uncommitted edits are never shown; the sync popover reports how many exist.
- **Reading is read-only by construction.** `git.ts` runs only `rev-parse`, `ls-tree`, `cat-file`, `rev-list`, `for-each-ref`, `log`, `config --get`, `remote get-url`, `status`, `symbolic-ref` and `merge-base`, with `--no-optional-locks`. Any other subcommand throws. There is no method that writes. Tests prove HEAD, refs, the index and `git status` are unchanged after a full tour. Writing is a separate module (`workflow/publish.ts`) with its own allowlist.
- **Traceable to GitHub, honestly.** A record links to a GitHub permalink only when a pushed commit holds a byte-identical copy of the file, so the link shows exactly what the Studio read. Otherwise the record is labelled **Local only**.
- **Derived data is labelled.** The design-gate result and the `validate-approvals` output come from `docs/architecture-studio/inventory.snapshot.json`, a generated file. The Studio shows them as derived and does not re-run the gate.

## API (all read-only, JSON, `Cache-Control: no-store`)

| Method and path | Returns |
|---|---|
| `GET /api/v1/repository` | repository facts, metrics, blockers, attention items |
| `GET /api/v1/decisions?status=&type=&milestone=` | normalized register records; `status` is one of the seven statuses, otherwise 400 |
| `GET /api/v1/decisions/{id}` | one record with duplicates, labelled AI suggestions and alternatives, or a 404 problem |
| `GET /api/v1/register` | register health: counts, validation, duplicate candidates, suggestion count |
| `GET /api/v1/register/changes?from=` | what changed since the saved baseline, or since a ref such as `origin/main` |
| `GET /api/v1/register/sync` | the saved baseline |
| `POST /api/v1/register/sync` | incremental sync: re-reads changed files only and saves the baseline in `STUDIO_CACHE_DIR`. Writes nothing to the repository |
| `GET /api/v1/source?path=&line=&context=&at=` | read-only source preview (`docs/`, `harness/policy/`, `harness/scripts/`; text extensions only). `at` is a commit from the file's own history |
| `GET /api/v1/auth/session` | who is signed in, and the approver policy status |
| `POST /api/v1/auth/signin`, `POST /api/v1/auth/signout` | sign in as the GitHub account configured on this computer (confirmed by GitHub; bots and agent sessions refused) |
| `GET /api/v1/review/{id}` | review state: canonical status, request in flight, which actions are available and authorised, timeline, audit, next and previous pending decision |
| `POST /api/v1/review/{id}/actions` | **one** action on **one** decision (needs session, CSRF token, same origin, the revision seen and an idempotency key). Creates a proposal and sends it to GitHub as a pull request |
| `POST /api/v1/sync/reconcile` | re-check every open proposal against GitHub and list pull requests the Studio did not open from here (session and CSRF) |
| `GET /api/v1/sync/status` | how the Studio is connected to GitHub (App, CLI or simulated), credential expiry, rate limit, proposals in flight, last reconcile. No secret |
| `POST /api/v1/github/webhook` | GitHub webhook receiver. Authenticated only by the HMAC signature; only names what to re-check |
| `POST /api/v1/review/proposals/{pid}/sync` | move a proposal forward, or check whether its pull request was merged |
| `GET /api/v1/review/next?after=` | the next decision waiting for a person |
| `GET /api/v1/queue` | the Work Queue: every item with its source, the relationships, the build-blocking analysis, decision impacts and view counts |
| `GET /api/v1/queue/{id}` | one work item: what each action would do for the signed-in person, history, what depends on it, and for a decision what rejecting or deferring it would touch |
| `POST /api/v1/queue/{id}/actions` | **one** action on **one** work item (same guards as the review actions). Creates a proposal and sends it to GitHub as a pull request |
| `GET /api/v1/queue/requirements?from=` | decisions flagged for review because a linked requirement differs from the one at `from` |
| `GET /api/v1/tasks?status=&blocked=` | tasks |
| `GET /api/v1/approvals` | approval authority, pending approvals, reviews |
| `GET /api/v1/search?q=&kind=` | search hits |
| `GET /api/v1/history?path=` | last five commits touching a tracked file |
| `POST /api/v1/refresh` | discards the Studio's 5 second cache and re-reads. Does not fetch or write |

Errors are `application/problem+json`. Write methods on the data routes return 405. The only routes that accept a change are `auth/*`, `review/*` and `queue/*{id}/actions` above; `publish.ts` is the only code that writes to git, and it can only add review-record or work-item files on a new `decision-review/...` or `work-item/...` branch.

## GitHub App

With `STUDIO_GITHUB_APP_ID`, `STUDIO_GITHUB_APP_INSTALLATION_ID`, `STUDIO_GITHUB_REPO` and `STUDIO_GITHUB_APP_PRIVATE_KEY_FILE` set, the Studio writes through a GitHub App (installation token scoped to the one repository, five minimum permissions) instead of the GitHub CLI, and reads `origin/main` by default. Optional: `STUDIO_GITHUB_WEBHOOK_SECRET`, `STUDIO_WEBHOOK_HOSTS`, `STUDIO_GITHUB_API_URL`. Setup, the twelve-step flow, conflict handling, audit fields, reliability and what is and is not verified: [GITHUB-SYNC](../../docs/architecture-studio/GITHUB-SYNC.md). It has been tested against a stand-in for the GitHub API, **not against real GitHub**.

## Security

- Binds to `localhost` and rejects any request whose `Host` header is not loopback (DNS-rebinding defence; `src/proxy.ts`).
- Strict Content-Security-Policy (`default-src 'self'`, `frame-ancestors 'none'`), `nosniff`, `no-referrer`, no `X-Powered-By`. No third-party request is made by any page: no web fonts, analytics or CDN.
- There is no sign-in. **Do not expose the port.** The identity menu shows the local git identity and says it is not authenticated.
- Refs are validated (no leading `-`, no `..`), file paths for history must exist in the commit's tree, and no absolute path is sent to the browser.
- Dependencies are pinned by the lockfile and were installed with `--ignore-scripts`. `npm audit` reported 0 vulnerabilities (see the report).

## Tests

```powershell
npm run typecheck     # tsc --noEmit
npm run test:unit     # adapter, parsers, read-only guarantee, count agreement (node --test)
npm run build
npm run test:e2e      # Playwright on Microsoft Edge; starts its own servers on 3100 to 3105 (3103 is test mode with a simulated GitHub; 3104 is a Studio configured as a GitHub App, talking to the stand-in GitHub API on 3105)
```

The end-to-end run also regenerates the screenshots in `docs/architecture-studio/screenshots/`. The unit checks live in `checks/` and the browser tests in `e2e/` so the repository-wide `node --test` does not collect them.

## Known limits

- "Blocked tasks" is rule-based on the task's own wording, not a recorded field. The rule is shown wherever the number appears.
- Roadmap items record no status, so none is shown.
- The Studio does not recompute the design gate or verify approval signatures. It shows what the files say and what the derived snapshot recorded.
- Tested on Microsoft Edge (Chromium) only, with automated accessibility checks. No manual screen-reader review has been done.
- Write-back is limited to the review workflow: proposals as branches and pull requests, as designed in [INTEGRATION-DESIGN](../../docs/architecture-studio/INTEGRATION-DESIGN.md) option C, built and tested against a **simulated** GitHub only. See [REVIEW-WORKFLOW](../../docs/architecture-studio/REVIEW-WORKFLOW.md) section 11.
