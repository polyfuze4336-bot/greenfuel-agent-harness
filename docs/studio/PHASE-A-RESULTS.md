# Phase A results

Phase A of the [SIMPLIFICATION-PLAN](SIMPLIFICATION-PLAN.md): make the Studio fast, guarded and honest. Branch `studio/phase-a-hardening`. Numbers are from the same machine and method as the [audit](CURRENT-STATE-AUDIT.md): production build, Windows, `localhost`, 8 samples per row, each measured after 2.5 s idle ("after idle") and immediately after ("warm"), in-process `fetch` timing (no `curl` start-up cost).

## A1: read model that does not rebuild on a timer

**Cause, measured (this was unknown in the audit).** A CPU profile of one rebuild: 86 % of the time was waiting on `git` subprocesses (`spawnSync`), 25 per rebuild at 65 to 130 ms each on Windows; `git ls-tree -r` alone ran 7 times (650 ms) and `git cat-file --batch` once (263 ms). Parsing was under 1 %.

**Change.**
1. Git trees (by commit id) and blobs (by object id) are immutable, so they are cached in the process (`src/lib/repo/git.ts`; bounded: 8 trees, 64 MB of blobs).
2. The 5-second clock expiry is replaced by a **repository fingerprint**: HEAD, every branch and remote-tracking ref, the uncommitted-file list and the last-fetch time, from four concurrent, non-blocking git calls. The model is rebuilt only when the fingerprint changes. A rebuild that another request already did for the same fingerprint is not repeated.
3. The parsed-fragment cache is shared across page and route bundles.

**Result.** The "before" column comes from the audit's `curl` timings, which include about 0.3 s of `curl` start-up on this machine, so the true improvement is slightly larger than shown.

| Request | Before, after idle | After, after idle (p50 / p95) | Warm p50 |
|---|---|---|---|
| `/api/v1/register` | 3.9 s | 268 / 381 ms | 67 ms |
| `/api/v1/decisions/ADR-0016` | 4.1 s | 267 / 281 ms | 67 ms |
| `/api/v1/search?q=sov` | 4.0 s | 245 / 272 ms | 65 ms |
| `/api/v1/approvals` | 3.8 s | 250 / 267 ms | 64 ms |
| `/queue` page | 1.4 s (API) | 261 / 300 ms | 71 ms |
| `/baseline` page | 0.7 s (API) | 264 / 293 ms | 72 ms |
| `/decisions/ADR-0016` page | 4 to 6.5 s | 438 / 449 ms | 140 ms |
| `/decisions` page | not separately timed | 548 / 654 ms | 216 ms |
| `/api/v1/review/ADR-0016` | 5.1 s | 710 / 733 ms | 447 ms |

Acceptance criterion PERF-01 (every page p95 under 500 ms after idle) is **met for the APIs and most pages, not met for `/decisions` (654 ms) and the review endpoint (733 ms)**. Those two are dominated by payload (760 KB of HTML) and by the review view's own computation: Phase B (B3). Git calls inside a rebuild are still synchronous; a rebuild after a real change blocks the event loop for roughly its own cost, now mostly parsing the changed files. Moving rebuilds off the main thread was not needed to reach these numbers and was not done.

Tests added (`checks/adapter.check.ts`): the fingerprint is stable, changes on a commit, a new branch and an uncommitted file and returns when the file is removed; cached content is never stale (a changed file reads as changed, an earlier commit still reads as it was); not-a-repository fails clearly.

## A2: the Studio is now built and tested in CI

New workflow `.github/workflows/studio.yml`: `npm ci`, typecheck, unit tests, `next build` on Ubuntu, actions pinned by SHA, `contents: read`, no path filter (a skipped required check would block merging). **CI result (PR #1): the job passed in 1 minute on GitHub.** It ran 383 unit tests in 37 s on Linux (typecheck 1.5 s, build 4 s), against 7 minutes on this Windows machine. All the new tests ran in CI. CI counted 383 where my local run counted 385; the 2-test difference was not traced.

## A3: console errors and raw Markdown

| Defect | Cause | Fix | Evidence |
|---|---|---|---|
| React hydration error #418 on three decision pages | A `<ul>` (reference chips) inside a `<p>` in the AI-suggestion list | `<p>` became `<div>` | Dev-mode scan of all 13 pages: 0 messages |
| `/access` logged a 401 when signed out | The page called the review endpoint before checking who was signed in | Ask the session first; show "not signed in" without the failing request | Same scan |
| Literal `**bold**` and backticks in decision text (17 of 57 decisions) | Plain text rendering | Small safe renderer for bold and code only (`src/lib/rich-text.ts`, `components/rich-text.tsx`); no HTML is produced; an unmatched marker is shown as written, never guessed | `checks/rich-text.check.ts` (5 tests) and `e2e/polish.spec.ts`: 0 console problems on 13 pages, no markers on any of the 57 decision pages |

## A4: documentation

`README.md` and `AGENTS.md` now describe the Studio, how to run it, its boundary (not the bunkering application; never approves anything) and its status (not deployed; workflow not yet used for a real approval). The Studio `package.json` description no longer says "read-only". `docs/studio/README.md` is the index. The two older Studio doc folders are linked, not moved, because generated files cite their paths.

## A5: dependencies and local paths

`jszip` is now declared (3.10.2, the version already installed). New test `checks/deps.check.ts` fails on any imported-but-undeclared package; shown to fail on a deliberately undeclared import and then pass. **Local paths:** redacting the six loop records was attempted and **reverted**: they are hash-sealed, and `validate-loop` failed after the edit. The path remains in those six files and in history.

## A6: ruleset on `main`

Approved by the owner. Applied 2026-11-02 as repository ruleset `main-protection` (id 26343459, enforcement active, no bypass actors):

| Rule | Setting |
|---|---|
| Deletion | blocked |
| Force push (non-fast-forward) | blocked |
| Pull request | required; stale approvals dismissed on push; **required approving reviews: 0**; code-owner review: **not** required |
| Required status checks | `validate`, `evaluate`, `studio`, `gate` (not required to be up to date with `main`) |

**Verified, not assumed.** From a clean clone: `git push origin HEAD:main` was rejected ("push declined due to repository rule violations: 4 of 4 required status checks are expected"), `git push --force` was rejected, and deleting `main` was refused. `main` was unchanged afterwards. PR #1 itself went through the new flow: all five checks passed, then it was merged.

**Deviation from the repository's own specification, stated plainly.** [`harness/policy/github-protection.json`](../../harness/policy/github-protection.json) asks for one approving review, code-owner review, up-to-date branches, linear history, conversation resolution and restricted pushes. With a single human approver (the owner's decision), nobody else can approve a pull request, so a required review would block every merge. The ruleset therefore enforces pull requests and checks but **not independent review**: the owner can still merge their own change, and separation of duties is enforced by the Studio's signed-approval model, not by GitHub. If a second approver is ever enrolled, raise required reviews to 1 and enable code-owner review (the rule `.github/CODEOWNERS` already exists).

`npm run permissions:github` still prints `NOT-PROTECTED`: that script and the spec read classic branch protection, not rulesets. Both are control-plane files, so they were **not changed**; teaching the verifier about rulesets and rewriting the spec's stale status text is a follow-up that needs the owner's approval, and it must be checked against the evaluation run that records the current output (`EVAL-HRN-OBS-003`).

Docs updated to say the ruleset exists: TODO T14, STATE, and dated notes in GITHUB-SYNC, GITHUB-INTEGRATION and SECURITY-REPORT. Older design documents and the generated inventory snapshot still describe the earlier state.
## Verification

| Check | Result |
|---|---|
| Studio unit tests | **385 / 385** (was 373; +12 new) |
| `npm run typecheck` | clean |
| `npm run validate` | OK |
| Polish e2e (`e2e/polish.spec.ts`) | 2 / 2 |
| Full Playwright suite (Windows, local) | **227 passed, 1 skipped (pre-existing), 0 failed**, 29.6 min; the second clean full pass |
| `studio`, `validate`, `evaluate`, `gate`, `control-plane-guard` on PR #1 | all pass |
| Ruleset on `main` (A6) | active; direct push, force push and deletion each refused (see A6) |
