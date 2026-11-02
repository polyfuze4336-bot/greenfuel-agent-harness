# Current-state audit

**Scope:** `main` at `7cb8473` (2026-11-02), branch `studio/audit-and-target-architecture`. **Nothing was implemented.** Everything below was checked in files or by running the code; where a statement is an inference, it is marked *(inferred)*.

**Headline.** The brief assumes a harness that must be *turned into* a Studio. It already is one: `apps/architecture-studio/` is a working Next.js application of about 21,000 lines of source and 9,300 lines of tests. The real problems are different from the brief's premise: the app is **slow after any idle period**, **unguarded by CI**, **undocumented in the README**, **sits on top of a decision process that has never produced one real approval**, and carries a presentation builder that is a second product. The right move is **simplify and harden, not rebuild**.

How this was checked: file inventory and line counts; `package.json`, workflows and policies read; `npm run validate` (OK, 20 s); `tsc --noEmit` on the Studio (clean, 9 s); the production Studio driven with Edge on 13 pages (load time, payload, console errors, screenshots); server timing with `curl` after idle and warm; GitHub API queried for branch protection. Earlier-session results (373 Studio unit tests, 1086 root tests, 225 Playwright tests, API probe 90/90) are **inherited from [TEST-REPORT](../studio-acceptance/TEST-REPORT.md)** at commit `b5b614b`; only docs changed since, and they were **not re-run** for this audit.

## 1. Repository inventory (verified)

| Area | Tracked files | Size | What it is |
|---|---|---|---|
| `docs/` | 528 | 189 `.md` (1.9 MB), 228 `.json`, 76 `.png` | Requirements, ADRs, designs, evidence, evaluation, Studio docs, state |
| `apps/architecture-studio/` | 227 | `src/lib` 12.6k LOC (89 files), `src/components` 6.4k (36), `src/app` 2.0k (57), `checks` 5.4k, `e2e` 3.9k, `scripts` 0.6k | The Studio |
| `tests/` | 95 | 9.2k LOC | Harness tests, run by root `node --test` |
| `harness/` | 93 | 12.3k LOC in 73 JS files | Hooks, permission engine, orchestration, memory, loop, evaluation, validators |
| `memory/` | 38 | JSON | Decisions, constraints, lessons, ledger |
| `.github/` | 33 | | 3 workflows, 12 agents, 7 instructions, 7 skills, 3 hook files, CODEOWNERS |
| `infra/` | 17 | | Bicep scaffold (not deployed) |
| Binary files | 78 | 19.5 MB | Screenshots, one PPTX, one PDF |
| `.git` | | 76.8 MB | |

Studio `src/lib` by domain: deck 2.7k LOC, workflow 2.3k, queue 1.5k, auth 1.5k, intel 1.4k, baseline 1.3k, repo 1.1k, github 0.5k. 37 API routes (13 mutating). 35 of 53 page/component files are client components. 15 source files exceed 300 lines.

## 2. Answers to the ten questions

### 2.1 What currently works? (verified)

| Capability | Evidence |
|---|---|
| Studio builds, typechecks, serves 13 pages (all HTTP 200) | `tsc` exit 0; browser probe |
| Register of 57 decisions (20 ADRs, 37 register entries) normalized with source path, line and commit | Overview and register screenshots; `/api/v1/register` |
| Incremental parse cache works | `filesRead 241, filesReused 241, filesReparsed 0` on repeat calls |
| Approval path creates branch, commit and PR; canonical only after merge; forged records refused | Acceptance run, [TEST-REPORT](../studio-acceptance/TEST-REPORT.md) (inherited) |
| Baseline gate, work queue, deck builder, access model | Same |
| Harness validators | `npm run validate`: OK |
| CI on GitHub | `validate` and `architecture-gate` green on `cb5e84b` |
| No secrets in tree or history; `npm audit` 0 | [SECURITY-REPORT](../studio-acceptance/SECURITY-REPORT.md) (inherited) |

### 2.2 What is documented but unimplemented, or documented wrongly?

| # | Finding | Evidence |
|---|---|---|
| F-01 | **`README.md` and `AGENTS.md` never mention the Studio** (0 matches for "Studio" or "apps/"). README says "harness foundation only"; true for the bunkering application, silent about 21k lines of app code. A newcomer cannot learn it exists. | `README.md` lines 1-9; grep |
| F-02 | `apps/architecture-studio/package.json` still says "a read-only viewer" | `package.json` `description` |
| F-03 | Docs say branch protection is unavailable (T14). The repo is now public and the API answers `404 Branch not protected` (not a plan error) with `rulesets: []`: **it is available and not applied.** | `gh api …/branches/main/protection` |
| F-04 | Studio documentation lives in three places: `docs/architecture-studio/` (14 docs), `docs/studio-acceptance/` (10), and now `docs/studio/` | file listing |
| F-05 | The real approval process has **never produced a real record**: `harness/policy/approvers.json` is `[]`; `docs/approvals/` and `docs/decision-reviews/` hold only a README. The 13 "Approved" decisions are ADR-0001 to 0014 marked Accepted "by instruction in chat" (text only, unsigned). The Overview says so honestly ("0 with a signed approval record"). | `approvers.json`; ADR status lines; Overview screenshot |
| F-06 | One person is enrolled in the access policy (`github:225331490`, `polyfuze4336-bot`, `architecture-owner`), so segregation of duties cannot be exercised with real people. | `harness/policy/access-policy.json` |
| F-07 | Final-deck generation needs Windows PowerPoint (COM); Studio e2e tests need local Edge (`channel: 'msedge'`). Neither runs on a Linux runner. | `playwright.config.ts`; `scripts/render-deck.ps1` |

### 2.3 What is duplicated or unnecessarily complicated?

| # | Finding | Evidence |
|---|---|---|
| F-08 | **Four overlapping decision stores:** `docs/adr/` (20 ADRs), `docs/context/DECISION-REGISTER.md` (37 D-entries), `memory/decisions/DEC-0001..0015` (JSON mirrors of ADRs, kept in step by an importer; the memory validator fails when they drift), and design reviews RV-0001 to 0003. The Studio re-normalizes the first, second and fourth on every rebuild; the harness has a separate importer for the third. | file listing; `DEC-0004.json`; earlier validator message "ADR-0004 is now Accepted but DEC-0004 is still proposed" |
| F-09 | **The Studio reuses the harness in only three places** (`registry.cjs`, `approval-gates.cjs`, `demo/facts.mjs` + `deck-data.mjs`, each via `createRequire`). Everything else is re-implemented: parsers (`src/lib/intel`), Blocked computation, work-item derivation (`queue/derive.ts`, 549 lines, alongside `harness/scripts/tasks.mjs`), signing (`auth/signing.ts`). Whether the Studio's "Blocked" always equals `design-gate.mjs` is **not tested** *(inferred risk)*. | `grep createRequire`; script list |
| F-10 | **The Presentation Studio is a second product** inside a decision tool: `src/lib/deck` 2.7k LOC, `components/deck` 434, `scripts/deck.ts`, `render-deck.ps1`, `pptxgenjs`, `jszip`, a hash-verified export path, and 40 slides whose content comes from `harness/demo/*`. It is the largest `src/lib` domain and the only Windows-only one. | LOC table |
| F-11 | `jszip` is imported by `src/lib/deck/inspect.ts` but **not declared** in `package.json`; it works only as a transitive dependency of `pptxgenjs`. | grep; `package.json` |
| F-12 | `docs/state/loops/` holds 65 committed repair-loop trace files, six of which (in two loop folders) contain a developer's local machine path. `docs/evidence/` (82) and `docs/evaluation/` (81) are generated records. These are audit trail, not documentation; they inflate the docs tree and the public surface. They are hash-sealed (`validate-loop` fails if one is edited), so the local path cannot be redacted without breaking the evidence chain. | `git ls-files`; grep |
| F-13 | Agent harness size: 12 specialist agents, 7 instructions, 7 skills, 17 MCP tools. No Studio feature needs a new agent. | `.github/`, `.mcp.json` |

### 2.4 Which files are authoritative?

| Concern | Authoritative | Derived (never edit) |
|---|---|---|
| Architecture decisions | `docs/adr/NNNN-*.md` (status line) plus signed `docs/approvals/AP-*.json` and merged `docs/decision-reviews/<ID>/*.json` | Studio register; `memory/decisions/DEC-*.json` |
| Open questions | `docs/context/DECISION-REGISTER.md` | Studio register entries |
| Design approval | `docs/architecture/reviews/RV-*.md` | Studio "Blocked" |
| Requirements | `docs/context/REQUIREMENTS.md` | Coverage reports under `docs/acceptance/` |
| Owner actions | `docs/state/TODO.md` (T1 to T68) | Studio work queue |
| Who may approve | `harness/policy/approvers.json` (keys), `harness/policy/access-policy.json` (people, roles) | |
| Build readiness | `harness/policy/baseline-policy.json`, `docs/baselines/*`, `docs/approvals/` | Studio baseline view |
| Governance of coding agents | `AGENTS.md`, `.github/**`, `harness/policy/*` | |
| Studio inventory | none; `docs/architecture-studio/inventory.snapshot.json` is generated and 64 KB | |

`AGENTS.md` is the correct authority for agent behavior and was not changed.

### 2.5 What should be removed, merged, or simplified?

See [SIMPLIFICATION-PLAN](SIMPLIFICATION-PLAN.md). In short: isolate the deck builder as an optional module, merge the three Studio doc locations, stop committing generated loop traces, derive `memory/decisions` from ADRs instead of mirroring them, and replace the 5-second whole-model TTL.

### 2.6 Which existing validators and services can be reused?

All of them, and the Studio should call them through **one** bridge instead of three `createRequire` sites: `harness/approvals/{registry,approval-gates}.cjs` (signed approvals), `harness/scripts/design-gate.mjs` (Blocked status), `harness/scripts/spec-validators.mjs` (requirements, architecture, sovereignty), `harness/scripts/tasks.mjs`, `harness/lib/{integrity,evidence-integrity,local-paths}.cjs`, `harness/policy/*.json`, and the memory store for resumable state. They are plain Node with no dependencies, which is what makes reuse cheap.

### 2.7 What blocks a working decision control centre?

| # | Blocker | Evidence |
|---|---|---|
| B-1 | No enrolled approver key, so no decision can be *really* approved (F-05) | `approvers.json` `[]` |
| B-2 | Every page after 5 s idle costs 3.5 to 6.5 s (F-14) | §3 |
| B-3 | No branch protection or ruleset, so the PR-based approval path is advisory (F-03) | API |
| B-4 | CI never builds or tests the Studio (F-18) | §3 |
| B-5 | The 7 decisions the deck presents are Proposed or Blocked; build gate blocked at phase 0 | Overview |
| B-6 | Hosting not decided; no deployed instance; final deck needs Windows | [DEPLOYMENT-PLAN](../studio-acceptance/DEPLOYMENT-PLAN.md) |

### 2.8 What prevents it feeling like a polished commercial SaaS product?

Observed in the production build with Edge (1440 × 900); the visual foundation is good (consistent sidebar, typography, restrained colour), so these are specific defects, not a restyle:

| # | Defect | Evidence |
|---|---|---|
| U-1 | **Slow and uneven**: warm page loads of 2 to 12 s; 4 to 6 s stalls after idle | §3 |
| U-2 | **React hydration error #418** on `/decisions/{id}`, `/review`, `/compare` | console capture |
| U-3 | **Raw Markdown shown literally**: ADR-0016 "What decision is required" prints `**The unit of placement is the jurisdiction.**` | decision page screenshot |
| U-4 | **Text-heavy**: long explanatory paragraphs on Overview, Register and every panel; a first-time viewer meets prose before the answer | screenshots |
| U-5 | **Dense register**: 82 buttons on `/decisions`; five filter chips, four selects and three collapsibles before the first row; native `<select>` controls | screenshot; DOM count |
| U-6 | **Work Queue page is huge**: 9,916 DOM nodes, 338 buttons, 24,811 px tall | probe |
| U-7 | Six equal-weight KPI tiles on Overview; the single message ("Not ready for approval") is above them but competes | screenshot |
| U-8 | Signed-out state shows avatar "AR" and a "7" notification badge while the decision page says "Sign in with GitHub" (development identity) | screenshots |
| U-9 | `/access` logs a 401 console error when signed out | console capture |
| U-10 | Large pages ship full data in the HTML: `/decisions` 760 KB, decision detail 333 KB, review 411 KB | `curl` size |

### 2.9 What security boundaries are missing?

| # | Gap | Notes |
|---|---|---|
| S-1 | **No platform-enforced branch protection** (F-03). `CODEOWNERS` exists but nothing requires it | now available and free |
| S-2 | The repo is **public**: everything in it, including the one enrolled approver identity, history and commit author emails, is visible. Webhook and key handling assume a private repo in places (`proxy.ts` comment: "serves private repository content with no sign-in") | `src/proxy.ts` |
| S-3 | **Development sign-in is the default.** `STUDIO_REQUIRE_ENTRA=1` (added in the acceptance work) fixes it only if a deployment sets it | `src/lib/auth/config.ts` |
| S-4 | Step-up re-authentication uses `iat`, not `auth_time` (MEDIUM, open) | SECURITY-REPORT H-4 |
| S-5 | Sync, reconcile and refresh endpoints need only a session (or nothing), no role or Origin check (LOW, open) | H-5 to H-7 |
| S-6 | Slide approvals are unsigned local state | |
| S-7 | CSP allows `'unsafe-inline'` for scripts and styles | probe |
| S-8 | The Studio shells out to `git` with `spawnSync` (allow-listed subcommands, no shell); safe by construction but **synchronous**, which also makes any slow call a denial-of-service lever *(inferred)* | `repo/git.ts:13,69` |
| S-9 | Fork pull requests will run workflows on a public repo; they use `pull_request` with read-only tokens, which is correct; **required approval for outside contributors is a repo setting that was not verified** | |
| S-10 | No real Entra or GitHub App exercised (inherited) | |

## 3. Performance and complexity risks (measured)

| # | Finding | Measurement |
|---|---|---|
| F-14 | **Whole-model rebuild every 5 s of idle**: `TTL_MS = 5_000` in `src/lib/repo/index.ts`. After idle, `/api/v1/register`, `/decisions/{id}`, `/search`, `/approvals` take **3.8 to 5.1 s**; immediately after, 0.3 s (of which about 0.3 s is `curl` start-up on this machine). | `curl` after 7 s idle vs. immediate |
| F-15 | The cost is **not parsing**: the fragment cache reuses 241 of 241 files. It is the rest of the rebuild (git subprocesses, assembly, duplicate and suggestion computation, review overlay) *(not profiled)*. Git calls are `spawnSync`, so **the Node event loop is blocked for the whole rebuild**, and concurrent users would queue behind it. | `repo/git.ts`; register stats |
| F-16 | Page loads to network idle: 1.6 to 15.1 s cold, 2.1 to 12.5 s on a second pass | Edge, 13 pages |
| F-17 | Payload and DOM: `/decisions` 760 KB HTML, 2,152 DOM nodes; Work Queue 9,916 nodes | probe |
| F-18 | **CI never builds or tests the Studio.** The `validate` job runs harness validators and root `node --test`; no step runs `npm ci`, `tsc`, `next build`, `test:unit` or Playwright. Only `architecture-gate` executes Studio code (`scripts/baseline.ts`, type-stripped). A Studio regression reaches `main` unchecked. | `.github/workflows/*.yml` |
| F-19 | Root `npm test` takes about 7.5 min (1086 tests); the Studio unit suite about 7.7 min; the full Playwright run 36 min. Fine for a milestone, hostile to iteration. | inherited, TEST-REPORT |
| F-20 | Install weight: `node_modules` 454 MB, `.next` 148 MB for a tool with 8 runtime dependencies | measured |
| F-21 | Single-instance, file-backed state; the proposal and audit store is local files | ARCHITECTURE.md |

Complexity risks: 15 files over 300 lines (`queue/derive.ts` 549, `deck/content.ts` 513, `review-rail.tsx` 472, `decision-detail.tsx` 457); two parallel decision pipelines (F-08); a large doc surface that must stay consistent with code (the inventory snapshot and acceptance-report generators exist because it drifts).

## 4. Dependency and runtime review

| Dependency | Used by | Verdict |
|---|---|---|
| `next`, `react`, `react-dom` | whole app | Keep |
| `@radix-ui/react-dialog` (7 files), `-popover` (2), `-dropdown-menu` (1) | accessible primitives | Keep dialog and popover; dropdown-menu is used once, candidate to replace |
| `lucide-react` (39 files) | icons | Keep |
| `tailwindcss`, `@tailwindcss/postcss`, `postcss` | styling | Keep |
| `pptxgenjs` (2 files), `jszip` (1, undeclared) | deck builder only | Move behind an optional module; declare `jszip` |
| `typescript`, `@playwright/test`, `@axe-core/playwright` | dev | Keep |
| Root harness | none | Zero dependencies, keep that |

No database, cache server, broker or container is used today, and none is justified by any measurement in this audit.

## 5. Highest-value improvements relative to effort

| Rank | Improvement | Effort | Value |
|---|---|---|---|
| 1 | Replace the 5 s TTL with a cache keyed by the commit SHAs it depends on (one `git rev-parse`), computed asynchronously with stale-while-revalidate | S | Removes F-14 to F-16 |
| 2 | Add a `studio` CI job: `npm ci`, `tsc`, unit tests, `next build` | S | Closes F-18 |
| 3 | Apply a ruleset to `main` (PR required, `validate` required, CODEOWNERS review) | S (needs owner approval) | Closes S-1 |
| 4 | Fix hydration #418 and render Markdown in decision text | S | U-2, U-3 |
| 5 | Update README, AGENTS, package description; consolidate Studio docs | S | F-01, F-02, F-04 |
| 6 | Enrol an approver and take **one** real decision through the real workflow | S (human) | Proves the control centre with real data (B-1) |
| 7 | Paginate the register and queue; stop inlining all records in the HTML | M | U-5, U-6, U-10 |
| 8 | Isolate the deck builder as an optional module | M | F-10, F-11 |
| 9 | Derive `memory/decisions` from ADRs | M | F-08 |
| 10 | Reduce prose; one primary message and one primary action per page | M | U-4, U-7 |

## 6. What this audit could not establish

- Where the 3.5 s rebuild time goes (no profiler run).
- Whether the Studio's Blocked and queue logic always matches the harness's (no equivalence test exists).
- Behaviour under concurrent users, on a deployed host, on Linux, or against real Entra and a real GitHub App.
- Fork-PR approval settings on the public repo.
- Accessibility with a screen reader; the automated axe tests passed earlier.
