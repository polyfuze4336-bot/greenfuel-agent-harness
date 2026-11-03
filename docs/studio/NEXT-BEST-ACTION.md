# Next Best Action, Work Queue and Readiness

The Overview answers one question: **what do I do next to move this architecture toward an approved build?** The answer comes from fixed rules over repository records. No model is involved in any score, order or count.

Code: `apps/architecture-studio/src/lib/next/` (`rank.ts`, `overview.ts`, `changes.ts`, `stale.ts`, `server.ts`). The weights live in one table, `POINTS` in `types.ts`, and the tests and this page quote the same numbers.

## How an action is ranked

Every open item becomes an action with a score. The score is the sum of named reasons, and the side panel shows every reason with its points. Order is score, then "blocks the next phase", then what it unlocks, then its id, so the same facts always give the same order.

| Rule | Points | Applies to |
|---|---|---|
| Mandatory for the next implementation phase | +150 | A decision named by a gate of the active stage in `harness/policy/baseline-policy.json` |
| Gate that is not a decision | +100 | An approver, the phase, a baseline. It is satisfied after the mandatory decisions, so it ranks just below them |
| Change that failed to reach GitHub | +120 | Failed or conflicted write. Integrity first |
| Change saved here, not yet on GitHub | +110 | Until it is sent it changes nothing |
| Merge a pull request | +60, +100 if the decision is mandatory | Finishing a mandatory decision in flight outranks starting another |
| Mandatory for a later phase | +12 | Production-stage decisions |
| Requirement priority | Must +20, Should +10, Could +4 | Requirements the decision relates to |
| Unlocks undecided decisions | +3 each, cap 15 | Decisions that cite it |
| Unlocks Must requirements | +4 each, cap 20 | |
| Blocks a build | +15 | |
| Ready now | +20 | Nothing it depends on is undecided |
| Waits for undecided decisions | −25 | |
| Source blocked | −15 | |
| You are the required approver | +10 | Matches the signed-in identity |
| Someone else must approve | −20 | Shown under "Waiting on others" |
| Rejected, needs rework | +35 | |
| Deferred, revisit | +25 | |
| Stale evidence | +20 | See below |
| Tasks | Priority Critical 20, High 12, Medium 6, Low 0; blocks build +25; critical +15; ready +15; derived block −25; mine +10; unlocks +3 each, cap 15 | Work items |

An unowned task has no known owner, so it is neither mine nor someone else's.

## Mandatory versus optional

Only decisions that a gate of the **active stage** names are mandatory for the next phase. Decisions named only by later stages are "needed later". Every other open decision is optional: it is counted, never blocks, and never earns the mandatory points. The page says so, and says the counts are not a maturity score.

Readiness is true only when the area is ready, no mandatory decision is unapproved, and no non-decision gate stands in the way. Authorizing the baseline is a separate human step and is shown as the action "Authorize an architecture baseline".

## Progress

Progress is counts of records: mandatory decisions approved, gates satisfied, later decisions approved, queue tasks done. There is no percentage, score or maturity level anywhere.

## Work queue

One list for decisions, tasks, approvals and evidence gaps. Chips: My attention, Critical, Blocked, Pending, Completed, All (a narrower row keeps the finer views). The default order is next best action; choosing a column sorts by it, and "Next best action" restores the order.

## Stale evidence

Rules, applied to ADRs only (register entries share one file, so a per-entry time is not meaningful):

- **Missing**: a cited evidence record does not exist.
- **Failing**: the latest cited run failed.
- **Stale**: the latest cited run started before the ADR file last changed.

Superseded and rejected decisions are skipped. The stale rule is coarse: a run on the same day as an edit can be flagged. It is a prompt to re-check, not a verdict.

## Changes page

Sync failures, pending GitHub pull requests, decision history (one row per decision, newest first), baseline changes, stale evidence, affected tasks and build readiness, with the same freshness line as the Overview.

## Freshness, webhooks and outages

- The page shows the GitHub commit it was rendered from. When GitHub has a newer one it says so and offers **Update** (no automatic reload).
- The browser checks only on window focus and every 5 minutes. It never polls every few seconds.
- A GitHub webhook invalidates the server's derived views (queue and Overview), so the next read is current. Webhooks are an optimisation: the clone also fetches on a fixed interval (`STUDIO_SYNC_SECONDS`, default 60), which is the periodic reconciliation.
- If no fetch has succeeded for longer than three intervals the page says GitHub may be unreachable and that it is showing the last copy it has. A failed freshness check is reported, not hidden.
- Derived views are memoised for 2 seconds per session; cold requests cost about 11 s on Windows (process spawn), warm about 1.5 s.

## Critical blockers versus readiness

"Critical blockers" on the Overview lists every action that blocks the next phase, including build-blocking tasks. The readiness card lists only the mandatory decisions and the gates that are not decisions. So the blockers count is larger than the readiness list, and each row opens the rules behind its place.

## Verification

- 43 unit tests (`checks/next.check.ts`): priority ordering, blocker detection, dependency updates, stale evidence, empty states, no clock or randomness in the rules.
- 30 browser journey tests (`e2e/journey.spec.ts`): review to merge to webhook to readiness, new commits, stale evidence, outages and recovery, empty states, keyboard, axe, console, no polling, search latency, and reads that change nothing. They run against a GitHub stand-in over a real bare repository, with the real decisions and policy.
- The full unit suite (545) passes, and the existing browser specs were updated for the new pages and re-run.

## Limits

- Ranking is rule-based. It has no effort or cost estimates.
- With the real policy, readiness stays blocked by the `phase-0` and `no-approver` gates until a signed approver is enrolled.
- The browser journey tests use a GitHub stand-in over a real bare repository. They are not part of CI.
