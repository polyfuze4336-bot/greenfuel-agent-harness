# Test report: end-to-end acceptance of Architecture Decision Studio

**Tested commit:** `b5b614b` (local; nothing is pushed). **Machine:** Windows 10.0.26300, 8 CPUs, Node 22.23.4, Microsoft PowerPoint (for rendering).
**What was tested:** the Studio running as a production build on localhost. **What was not:** a deployed application. No Azure resource exists ([ACCEPTANCE-REPORT](ACCEPTANCE-REPORT.md)).

## 1. Suites, run on this commit

| Suite | Result |
|---|---|
| Repository harness tests (`npm test`, root) | **1086 / 1086 passed** |
| Repository validators (`npm run validate`) | **OK** |
| Studio unit tests (`npm run test:unit`) | **373 / 373 passed** (includes the Entra fail-closed switch) |
| Full Playwright run (`npx playwright test`, four servers, 36 minutes) | **225 passed, 1 skipped, 0 failed**; the skipped test (`intel.spec.ts` "a decision with no options…") is a pre-existing skip |
| of which the new acceptance spec (`e2e/acceptance.spec.ts`) | **21 / 21 passed** |
| API security and latency probe (`scripts/api-probe.mjs`) | **90 checks, 0 failed** ([api-probe.json](api-probe.json)) |
| `npm audit` (Studio) | 0 vulnerabilities |
| Secret scan (tree and 94 commits) | 0 matches |

Honest history: the first full run in the previous stage had two load-related failures (a register keyboard test and a work-queue spec) and a flaky reconciliation unit test; each passed alone. This run had none. One clean pass is evidence, not a guarantee against flakiness.

During this work the acceptance spec first failed three times, each time for a reason in my test or world and not in the product: (1) alternatives' pros/cons — the parser correctly does not invent them; (2) the repository validators correctly refuse text-only "Accepted" ADRs, so the check became "the pull request adds no validator failure beyond the base, and none about the new ADR"; (3) the queue calls an approved decision `Done`.

## 2. How the complete workflow was tested (the "acceptance world")

A throw-away clone of this repository with its own bare git remote standing in for GitHub, a simulated pull-request service, a stand-in identity provider with test users, and a reduced baseline policy (gates: an enrolled architecture-class approver and ADR-0021). People are simulated by `git` operations on the remote.

**Synthetic, so proving the mechanism and not a real approval:** the reduced policy; the supporting ADRs 0004, 0015-0019 and reviews RV-0001 to 0003 are marked Accepted/Approved as text in the world's first commit (the real repository has them Proposed or Blocked); the enrolled approver key and every "person". The decision under test, ADR-0021, and everything after it use the real workflow code.

### The twenty steps

| # | Step | Result | Evidence |
|---|---|---|---|
| 1 | New ADR added to GitHub | Pass | Commit on the remote; Studio behind by 1 before pull, 404 for it |
| 2 | Studio discovers it | Pass | After fast-forward and refresh, `register/changes` lists it as added |
| 3 | Appears as pending | Pass | Status Proposed; screenshot `step-03` |
| 4 | Open the decision | Pass | Review page renders; no accessibility violations (axe); screenshot `step-04` |
| 5 | Recommended option and alternatives | Pass | Recommended option and two alternatives; the recommended option carries the ADR's own consequences as pros/cons |
| 6 | Pros, cons, costs, risks, dependencies | Pass, with a stated limit | Alternatives show only the trade-offs the author wrote; **nothing is fabricated** (asserted). AI suggestions are separate and labelled |
| 7 | Approve with rationale | Pass | Action accepted with expected revision and idempotency key |
| 8 | Rationale and authenticated identity recorded | Pass | Review record on the branch holds actor `test-owner` / id and the rationale text, bound by signature |
| 9 | GitHub change generated | Pass | Branch `decision-review/ADR-0021/…`, commit, PR; `main` untouched |
| 10 | Repository validation runs | Pass (delta) | `validate-harness` on the PR head: 22 failures both on base and PR head (all from the synthetic text-only approvals), **0 introduced**, 0 mentioning ADR-0021. This is the real validator, **not GitHub Actions** |
| 11 | Merge through authorized workflow | Pass (simulated) | A person's fast-forward of the remote's `main` to the PR head |
| 12 | Studio refreshes canonical status | Pass | Approved with basis `review-record` only after the merge, within 0.7-0.9 s |
| 13 | Related tasks and dependencies update | Pass | Queue shows ADR-0021 `Done`; nothing unrelated changed status (only derived build blockers may move) |
| 14 | Readiness gate recalculates | Pass | The decision gate is met; the only remaining reason is `baseline` |
| 15 | Baseline generated | Pass | `baseline generate` for BL-0001; **proposed** until a person signs; signed with the enrolled key; Studio then shows approved/current and gate open |
| 16 | Presentation Studio reads the baseline | Pass | Deck model cites the baseline; screenshot `step-16` |
| 17 | Slide outline generated | Pass | 40 slides |
| 18 | Review and approve slides | Pass | The last presented decision (ADR-0020) approved through the same workflow; the deck gate then reports all presented decisions approved; all 40 slides approved one at a time at their content hashes |
| 19 | Editable PowerPoint generated | Pass | PowerPoint-rendered; QA 0 errors, 0 warnings, 8 info |
| 20 | Final deck exported with sources | Pass | FINAL deck from commit `e8e0998` (acceptance-world commit, not a repository commit); verify: 40 slides, 40 with notes, 5 native charts, 18 native tables, 0 pictures; 35 sources |

Before step 15 the test also proves a **final deck is refused** with no baseline, including through a forged state file and the command line.

### Negative tests

| Test | Result | What was shown |
|---|---|---|
| Unauthorized approval | Pass | No role, viewer, contributor, security reviewer (wrong domain), an agent identity and an impostor are all refused by the server; nothing is sent to GitHub |
| Forged approval | Pass | A hand-written review record is rejected as inconsistent (`unknown field(s): sig`) and changes no status; a forged baseline approval and a forged slide approval change nothing |
| Rejected decision | Pass | Rejection needs a rationale, is recorded, is **not** treated as resolved, and cannot be approved over |
| Conflicting GitHub changes | Pass | A change landed after the user opened the decision: refused, nothing overwritten |
| Stale repository revision | Pass | Stale `expectedRevision` refused |
| GitHub API failure | Pass | Bare remote made unreachable: HTTP 200 with state `awaiting-github-update`, **never** "applied"; the same request succeeds once restored |
| Missing source file | Pass | The deck states what is missing instead of inventing |
| Duplicate decision | Pass | Two files claiming ADR-0021 are flagged `id-collision` (score 1) and not merged |
| Missing presentation evidence | Pass | Placeholders appear and a final deck is refused |
| Unavailable image generation | Pass, by design | No image generation is configured; the hero and Azure icon slots fall back to labelled vector artwork. No generated imagery is claimed |
| Corrupted presentation output | Pass | Flipped bytes, a swapped file and a tampered mode are detected on export and not served (`output-corrupted`, `record-mismatch`) |
| Build-gate bypass | Pass | After editing an approved decision, the baseline is invalidated (drift) and the final deck is refused again; forged state file and CLI cannot bypass it |

Interface: the pages in the workflow have no axe violations and render at tablet width.

## 3. Performance (measured, this machine, local)

Two measurements exist. `measurements.json` is from the full-suite run (machine under load from other tests); the isolated run, from the earlier console output of the same spec, is quoted for comparison.

| Measure | Isolated run | Under full-suite load (`measurements.json`) |
|---|---|---|
| Repository refresh after a pull (15 samples) | 2.1-2.8 s | 2.6-3.1 s (median 2.8 s) |
| Approval transaction, submit to pull request | 2.6 s | 3.1-3.4 s |
| Merge to canonical status shown in the Studio | 0.6-0.7 s | 0.75-0.85 s |
| Repository validation on the PR head (real validator) | 4.9 s | 6.6 s |
| Baseline authorization visible after commit | 3.8 s | 4.5 s |
| Approving 40 slides, one by one | 31 s | 40 s |
| Deck generation, sample, rendered by PowerPoint | 12.9 s | 15.4 s |
| Deck generation, FINAL, rendered by PowerPoint | 13.4 s | 14.8 s |

Read-path latency, warm, sequential, 30 samples against the real repository (57 decisions), production build, from the probe:

| Endpoint | p50 | p95 | max |
|---|---|---|---|
| Decision search: text / id / no match | 60 / 61 / 63 ms | 71 / 71 / 75 ms | 86 / **2305** / 79 ms |
| Decision register | 61 ms | 74 ms | 111 ms |
| Work queue | 631 ms | 973 ms | 1017 ms |
| Baseline readiness | 406 ms | 435 ms | 450 ms |
| Deck model | 562 ms | 604 ms | 722 ms |
| **Decision detail** | **661 ms** | **3369 ms** | 3467 ms |

Reading these honestly: search is fast (~60 ms p50), but **decision detail has a bimodal p95 of 3.4 s** and an occasional multi-second outlier on search; the cause (probably recomputation after a cache expiry) was not investigated. No performance target for the Studio is defined in any requirement, so there is nothing to pass or fail against; the figures are a baseline. They are single-user, local, with an empty network, and say nothing about a deployed host or concurrent users. No load test was run.

## 4. Not tested

- The deployed application (does not exist).
- Real Entra ID sign-in (a stand-in was used), a real GitHub App, real webhooks, real GitHub Actions, real branch protection, real merge policies.
- Concurrent users and load.
- Screen-reader use; PowerPoint accessibility (alt text, reading order); a human visual design review of the final deck.
- Linux hosting of the Studio and any final-deck rendering without PowerPoint.
