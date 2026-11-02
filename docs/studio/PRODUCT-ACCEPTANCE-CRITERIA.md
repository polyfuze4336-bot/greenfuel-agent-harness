# Product acceptance criteria

How a reviewer decides that the simplified Studio is a polished, trustworthy decision control centre. Every criterion is **measurable**, has a **validation method**, and traces to a finding in [CURRENT-STATE-AUDIT](CURRENT-STATE-AUDIT.md) or to a requirement in the brief. "Baseline" is the audited value on `7cb8473`; "Target" is the pass line. Criteria describe the product, not a build plan; the order of work is in [SIMPLIFICATION-PLAN](SIMPLIFICATION-PLAN.md).

**Measurement conditions (so numbers are comparable):** production build (`next build` + `next start`), Windows 11, 8 CPUs, Edge, `localhost`, repository at the audited size (57 decisions, about 240 parsed files), no other load. Use `apps/architecture-studio/scripts/api-probe.mjs` plus a page probe equivalent to the one used in the audit (13 pages, network idle). Report median and p95 over at least 20 samples, **after 7 s idle** and warm.

## 1. Performance (PERF)

| ID | Criterion | Baseline | Target | Validation | Audit ref |
|---|---|---|---|---|---|
| PERF-01 | Time to first byte for every page after 7 s idle | 3.8 to 6.5 s | p95 under 500 ms | Probe, 20 samples per page | F-14 |
| PERF-02 | Page ready (network idle) for the 13 pages | 1.6 to 15.1 s | p95 under 2.5 s | Probe | F-16 |
| PERF-03 | Search results (`/api/v1/search`) after idle | 4.0 s | p95 under 300 ms | Probe | F-14 |
| PERF-04 | No request blocks others: a slow rebuild does not delay an unrelated request | Blocking (`spawnSync`) | Unrelated request under 300 ms during a rebuild | Concurrent probe | F-15 |
| PERF-05 | `/decisions` HTML size | 760 KB | under 150 KB | `curl` | F-17 |
| PERF-06 | Work Queue DOM nodes | 9,916 | under 1,500 initial | Browser | U-6 |
| PERF-07 | Decision detail time to usable | p95 3.4 s | p95 under 1 s | Probe | prior TEST-REPORT |
| PERF-08 | Snapshot freshness after a new commit lands | up to 5 s, then a 4 s rebuild | visible update within 5 s without blocking the page | Commit, then poll | F-14 |

## 2. Product experience (UX)

| ID | Criterion | Target | Validation |
|---|---|---|---|
| UX-01 | Zero browser console errors or warnings on all 13 pages, signed out and signed in (includes React #418 and the `/access` 401) | 0 | Probe console capture (U-2, U-9) |
| UX-02 | No raw Markdown syntax in rendered text | 0 occurrences of `**`, backticks or leading `#` in visible text on any decision page | DOM text scan on all 57 decisions (U-3) |
| UX-03 | Each primary page states one message and offers one primary action above the fold at 1440 × 900 and 1024 × 768 | One H1, one primary button | Visual review against a checklist (U-4, U-7) |
| UX-04 | Prose is secondary: no paragraph over 3 lines above the fold; definitions in a popover | Met | Review |
| UX-05 | Register: first data row visible without scrolling at 1440 × 900 | Met | Screenshot |
| UX-06 | Register and queue show pages of 50 with sort, filter, search and grouping that persist in the URL | Met; reload restores state | e2e |
| UX-07 | A single filter bar (no more than one row) replaces chips, selects and collapsibles | Met | Review (U-5) |
| UX-08 | Loading uses skeletons, never a blank page; errors state the cause and a next step; empty states explain why | Met on every page | e2e with delayed and failing API |
| UX-09 | Identity is accurate: no avatar initials or notification badge unless signed in and backed by real data | Met | e2e (U-8) |
| UX-10 | Decision review: reach the next pending decision, make a decision and see its pull-request state using the keyboard only | Met | Scripted keyboard run |
| UX-11 | Contrast and focus: WCAG 2.2 AA on every page, light and dark | 0 axe violations | `@axe-core/playwright` |
| UX-12 | Tablet portrait (768 px) and desktop (1440 px) layouts have no horizontal scroll or clipped controls | Met | e2e screenshots |
| UX-13 | An independent reviewer scores the product at least 4 of 5 on "feels like a commercial product" without prompting, using a written rubric with 5 reviewers or fewer | Median at least 4 | Human review (cannot be automated) |

## 3. Function (FUN)

| ID | Criterion | Target | Validation |
|---|---|---|---|
| FUN-01 | Every decision shows source file, line and commit, and links to GitHub at that commit | 100 % of 57 | Script over the register |
| FUN-02 | Missing fields are labelled "not stated", never invented; AI text is labelled a suggestion | 0 unlabelled | Existing tests plus a scan |
| FUN-03 | The Studio's Blocked status equals `design-gate.mjs` for every ADR and design review | 0 differences | New equivalence test in CI |
| FUN-04 | An action on a decision creates a branch and PR, never a push to `main` | Met | Existing acceptance spec |
| FUN-05 | A decision is Approved only after the canonical branch contains the merged record | Met | Existing acceptance spec |
| FUN-06 | Stale revision, duplicate submission, GitHub failure and conflict are refused or shown, never reported as success | Met | Existing negative tests |
| FUN-07 | At least **one real decision** has completed the real workflow: signed approver key, review record, PR, validation, merge, canonical | 1 real record on `main`; Overview shows 1 signed approval | Repository evidence (blocked by owner enrolment) |
| FUN-08 | With the deck feature disabled, the Studio builds, runs and passes its tests on Linux | Met | CI (Ubuntu) |

## 4. Security (SEC)

| ID | Criterion | Target | Validation |
|---|---|---|---|
| SEC-01 | Branch ruleset on `main`: pull request required, `validate` and `studio` checks required, no force push or deletion; CODEOWNERS review once a second approver exists | Active (since 2026-11-02, without required reviews: one approver) | `gh api repos/…/rulesets`; a direct push is refused |
| SEC-02 | Every mutating route authorizes server-side, including sync, reconcile and refresh, with Origin and CSRF checks | 0 unauthenticated or cross-origin writes | API probe (extend to 100 % of mutating routes) |
| SEC-03 | A deployment cannot start in development sign-in mode | `STUDIO_REQUIRE_ENTRA=1` enforced by configuration check | Unit test and startup refusal |
| SEC-04 | Step-up re-authentication uses `auth_time` or equivalent | Met | Unit test with real Entra claim shapes |
| SEC-05 | CSP without `unsafe-inline` for scripts | Met | Probe |
| SEC-06 | No secret and no new local path in the tree going forward. The 6 existing local-path files are hash-sealed evidence and stay as they are (redaction breaks `validate-loop`) | 0 secret matches; 0 local paths outside those 6 sealed files | Secret and path scan in CI |
| SEC-07 | Dependency audit clean | 0 high or critical | `npm audit` in CI |
| SEC-08 | A pull request from a fork cannot reach secrets or write to the repository | Verified | Repo settings check plus a test PR from a fork |
| SEC-09 | AI, bots and agents cannot approve; hand-written, replayed or altered approvals are rejected | Met | Existing tests (must stay green) |

## 5. Quality and operability (QA)

| ID | Criterion | Target | Validation |
|---|---|---|---|
| QA-01 | CI runs `npm ci`, typecheck, Studio unit tests and `next build` on every PR | Green; fails on an injected type error | Workflow run |
| QA-02 | Existing suites stay green: root 1086, Studio unit 373, acceptance spec 21, API probe 90 | No regression | CI and milestone run |
| QA-03 | A PR check completes in under 10 minutes | Met | Workflow timings (the Playwright suite runs nightly or on demand) |
| QA-04 | `npm ls` shows no undeclared import (`jszip` declared) | Met | Script |
| QA-05 | Cold start to first page on a clean clone, with documented steps | Under 10 minutes including install | Fresh-clone run |
| QA-06 | Studio source files over 400 lines | 0 (baseline: `queue/derive.ts` 549, `deck/content.ts` 513, `review-rail.tsx` 472, `decision-detail.tsx` 457) | `wc` script |

## 6. Documentation and honesty (DOC)

| ID | Criterion | Target | Validation |
|---|---|---|---|
| DOC-01 | `README.md` and `AGENTS.md` describe the Studio, how to run it, and what is and is not implemented | Met | Review (F-01) |
| DOC-02 | One Studio documentation home with an index; old paths redirect | Met | Link check |
| DOC-03 | Every claim of "works" in docs cites a test, command or file; known limits are listed on the same page | Met | Review |
| DOC-04 | No synthetic data is presented as real: acceptance-world approvals are labelled SYNTHETIC wherever shown | Met | Review |

## 7. Conditions for "accepted"

The simplified Studio is **accepted for local use** when: all PERF, UX-01 to UX-12, FUN-01 to FUN-06 and FUN-08, SEC-01 to SEC-07 and SEC-09, QA and DOC criteria pass; and the failures are listed rather than waived.

It is **accepted as a control centre** only when FUN-07 also passes (a real approval exists). Until then the honest label is "approval workflow verified with synthetic data".

It is **not accepted for deployment** by any of the above; deployment needs the separate approval and the [DEPLOYMENT-PLAN](../studio-acceptance/DEPLOYMENT-PLAN.md) inputs.

Criteria that cannot be automated (UX-13, SEC-08, FUN-07) are called out so a green automated run is not mistaken for acceptance.

## 8. Status after Phase B (2026-11-02)

| Criterion | Status |
|---|---|
| PERF-01 (p95 under 500 ms after idle) | APIs met; `/queue` and `/baseline` borderline; `/decisions`, `/decisions/{id}` and the review endpoint **not met** (Windows process start-up dominates) |
| PERF-05 (`/decisions` under 150 KB) | **Not met**: 340 KB (was 760 KB) |
| PERF-06 (queue under 1,500 initial DOM nodes) | Improved from about 9,900; the test asserts under 4,500; **1,500 not demonstrated** |
| UX-01, UX-02 (no console errors; no raw Markdown) | **Met** (Phase A, e2e) |
| FUN-03 (Studio Blocked equals the design gate) | **Met**, CI test, mutation-checked |
| FUN-07 (one real approval) | **Open**: needs the owner's signing key |
| SEC-01 (ruleset on main) | **Met**, with the owner able to bypass the review rule only; tested |
| QA-01 (CI builds and tests the Studio) | **Met** |
| QA-04 (undeclared imports) | **Met** |
| Others (UX-03 to UX-13, SEC-02 to SEC-08, DOC-02, QA-06) | Not started or not assessed |
