# Phase B results

Phase B of the [SIMPLIFICATION-PLAN](SIMPLIFICATION-PLAN.md): make the Studio a control centre with real, checked data. Branch `studio/phase-b`. Same machine and method as [PHASE-A-RESULTS](PHASE-A-RESULTS.md) (production build, Windows, `localhost`, 8 samples after 2.5 s idle and immediately after).

| Item | Status |
|---|---|
| B1 a real decision through the real workflow | **Not done: needs you** (an approver key and one decision). See "What B1 needs" |
| B2 Studio versus the harness design gate | **Done**, tested, mutation-checked |
| B3 paging and payload | **Partly done**: the decision payload and the queue are cut; the page latency target is **not** met |
| B4 one bridge into the harness | **Done**, tested |

## B2: the Studio and the harness design gate agree, and a test says so

The audit could not say whether the Studio's "Blocked" always matched the harness. Finding: the Studio does **not** run the design gate. It shows `computed` from a committed, derived snapshot (`docs/architecture-studio/inventory.snapshot.json`), so a stale snapshot would show a wrong gate result with no error.

New `checks/design-gate-equivalence.check.ts` runs the harness's own `evaluateReviewFile` on every design review and compares it with what the Studio shows:

1. the Studio's computed result equals the gate's, for every review;
2. every declared status is one the gate allows, and a review the gate calls Blocked is never shown Approved;
3. the number of blocking reasons equals the gate's;
4. an ADR is shown Blocked exactly when it is still Proposed and a Blocked review names it.

Result today: **the Studio and the gate agree** on all three reviews (5 of 5 pass). **Proved it can fail:** a throw-away commit that marked RV-0001 Approved made two of the tests fail with "declared Approved but the gate computes Blocked"; the commit was reset. The test runs in the `studio` CI job, so a stale snapshot now fails CI. (Evidence of that: PR #3 and PR #4 each failed `studio` until the generated snapshot was regenerated after an ADR and a TODO row were added.)

## B4: one bridge into the harness

`src/lib/harness-bridge.ts` is now the only file in `src/` that loads harness code (`requireHarness`); the three `createRequire` sites in `baseline/facts.ts` and `deck/context.ts` call it. It refuses a path that leaves `harness/`. `checks/bridge.check.ts` (3 tests) loads the real approval rules and canonical JSON, checks the refusal, and fails if any other file under `src/` uses `createRequire`. Baseline (all) and deck (all) suites still pass after the change.

## B3: smaller pages

| Change | Evidence |
|---|---|
| The Decision Register table receives one slim row per decision (`src/lib/intel/row.ts`) instead of the full record; the full record, its related decisions and duplicates load **when a decision is opened** (`/api/v1/decisions/{id}/sheet`), with a skeleton and a retry on error | `checks/row.check.ts` (4 tests): searching rows finds exactly the decisions the full records would on 9 queries; the rows carry no options, pros, cons, sources or citations; rows are less than a third of the full records |
| `/decisions` HTML | **760 KB to 340 KB** (-55 %). Records alone were 401 KB; what remains is mostly 58 server-rendered rows with long GitHub links, plus the search text |
| Work Queue shows 100 rows at a time ("Show 100 more"); a selected item beyond the window is always shown | `e2e/polish.spec.ts`: at most 100 rows and fewer than 4,500 DOM nodes on first load (was about 9,900); "Show more" adds rows. Also fixed a bug found while testing: the window reset on every render because the filtered list was a new array each time |

**Not met, stated plainly.**

| Criterion | Target | Measured now |
|---|---|---|
| PERF-05 `/decisions` HTML | under 150 KB | **340 KB** (test threshold set at 400 KB with a note) |
| PERF-01 every page p95 after idle | under 500 ms | APIs 340 to 465 ms (met); `/queue` and `/baseline` pages 354 to 512 ms (borderline); **`/decisions` 652 to 852 ms, `/decisions/{id}` 563 to 955 ms, review endpoint 1,019 to 1,309 ms (not met)** |
| PERF-07 decision detail | p95 under 1 s | page about 0.56 to 0.96 s (met on one run, not the other) |

Why page time did not fall with the payload: server render time, not bytes, dominates. About 300 ms of every idle request is now the repository fingerprint, which is four `git` calls at 70 to 110 ms each on Windows (process start-up cost; measured individually). On Linux, where a process starts in a few milliseconds, that floor should be far lower; **that was not measured** (the deployed instance cannot be timed signed in). The review endpoint's 0.5 s warm cost is its own computation and was not optimized.

The next step to reach the targets is paging the register table itself (so fewer rows are server-rendered) or server-side search, plus profiling the review view. Both are Phase C-sized.

## Other changes made on the way

- Adding ADR-0021 (the Azure deployment) changed real counts (58 decisions, 45 pending), so seven e2e expectations were updated. These tests hard-code counts from the live repository, which is brittle: they will need the same edit whenever an ADR is added. A better design is to compute the expected counts from the same source files; not done.
- The acceptance world's synthetic ADRs (0021 to 0025) collided with the real ADR-0021, so they were renumbered 0031 to 0035 in the spec and the world.

## What B1 needs (you)

B1 proves the control centre with one real approval. The Studio and the harness are ready; what is missing can only come from you:

1. **Enrol a signing key on your own computer** (the passphrase never leaves it): `node harness/scripts/approval.mjs enroll --out <a folder outside the repository>`; then `register --request docs/approvals/enrollment…` and merge that through a pull request. The commands are listed on the Studio's Approvals page and in [APPROVER-ENROLLMENT](../security/APPROVER-ENROLLMENT.md).
2. **Pick one small real decision.** Natural candidate: **ADR-0021** (the Azure deployment), which is Proposed, small, and already carries your recorded instruction. Create the request with `approval.mjs decision --type adr --id 0021 --reason "…"`, sign it with your key, commit the record.
3. After the merge the Overview should show **1 signed approval**, and ADR-0021 should become Approved with basis "signed". That is the first real record this control centre has produced, and the criterion FUN-07 in [PRODUCT-ACCEPTANCE-CRITERIA](PRODUCT-ACCEPTANCE-CRITERIA.md).

I did not generate a key or sign anything: a signing key belongs to a person, and an approval made by me would be exactly what the system exists to prevent.

## Verification

| Check | Result |
|---|---|
| Studio unit tests | **397 / 397** (was 385: +5 equivalence, +3 bridge, +4 rows) |
| Typecheck | clean |
| Affected e2e (`polish`, `intel`, `studio`, `states`) | 63 passed, 1 skipped, 0 failed |
| Full Playwright suite | **229 passed, 1 skipped (pre-existing), 0 failed, but not in one run.** The first full run (30 min) had 208 passed and 1 failed with the 20 dependent tests not run: the acceptance chain failed because **my own renumbering of its synthetic ADRs was wrong** (it wrote `00321` for `0031`). After the fix the acceptance spec ran alone: 21 of 21 passed. 208 plus 21 is 229 |
| `main` ruleset: can the owner's admin bypass merge a PR whose required check fails? | **No.** A throw-away PR (#5) with a deliberately failing test was refused: `Required status check "studio" is failing`; the PR was closed and its branch deleted. This closes the "not tested" note in PHASE-A-RESULTS |
