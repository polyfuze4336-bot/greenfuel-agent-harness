# Approval write-back to GitHub: what was asked, what exists, what proves it

You asked for a lightweight, reliable human approval workflow in which GitHub stays authoritative. Most of it was already built in earlier stages ([REVIEW-WORKFLOW](../architecture-studio/REVIEW-WORKFLOW.md), [ACCESS-CONTROL](../architecture-studio/ACCESS-CONTROL.md), [GITHUB-SYNC](../architecture-studio/GITHUB-SYNC.md)). This stage audited it line by line against your list, closed the gaps it found, and added tests that compare **GitHub, the server and the screen** after every action.

## Gaps found, and what changed

| Gap | Change |
|---|---|
| Branch protection was *assumed*, never checked. A repository with no merge policy would let anyone with write access land an approval unreviewed | New: the Studio reads the canonical branch's active rules from GitHub ([`merge-policy.ts`](../../apps/architecture-studio/src/lib/github/merge-policy.ts)). It shows the result on the sync panel, and **refuses to open a status-changing pull request** unless a rule requires pull requests. A comment is still allowed. See [Merge policy](#merge-policy) |
| The history showed who, when and why, but not **the GitHub commit** that carries each record | New: each review record in the decision timeline names the commit on the canonical branch that carries it, and the pull request that brought it where this Studio opened one. Linked to GitHub |
| Nothing exercised every action through the GitHub App path, or compared the screen with GitHub | New: [`e2e/approval-reconcile.spec.ts`](../../apps/architecture-studio/e2e/approval-reconcile.spec.ts), 23 scenarios, most ending in the same three-way comparison |
| One existing GitHub test assumed it ran first against its stand-in | Fixed to count only its own writes |

Everything else in your list was verified to exist and is unchanged.

## Your rules, and where each is enforced

| Rule | Enforced by | Evidence |
|---|---|---|
| Every decision reviewed individually; no blanket approval | One decision id per request. No bulk route exists | `approval-reconcile`: each scenario acts on one decision |
| Approve recommended option / an alternative / reject / request revision / defer / reopen / comment | Seven actions, each its own record type | One scenario each |
| Rejections need a reason | At least 10 characters, checked in the dialog and again on the server; also for defer, revision and reopen | "reject": none and a token reason are refused, no pull request opened |
| Conditional approvals capture conditions | At least one, at most ten, stored in the signed record and shown as canonical | "approve with conditions": the two conditions are on GitHub, in the API and on screen |
| AI agents cannot approve for you | Bot and agent accounts cannot sign in (`NOT_A_PERSON`). Agent sessions are refused. An identity that changes under a live session is refused. The pull request must still be merged by a person | "unauthorized", "AI agent or unverified identity" |
| Every action tied to an authenticated human | Verified identity at the moment of acting, a signed session, CSRF token and same-origin check. People are keyed by a stable subject, never by a login name | "unauthorized": no role, contributor, impostor with the owner's login, anonymous |
| Approval does not bypass the architecture gates | A Blocked decision cannot be approved. A decision already Approved cannot be overwritten, only reopened. Whoever asked for a revision cannot approve the result (segregation of duties) | In the real register 6 of the 21 ADRs are Blocked, and the Studio refuses to approve them. "revision" scenario: the same person's approval is refused with `sod-proposer`, a second person's goes through |
| GitHub is canonical | A decision changes in the Studio only after its pull request is merged and the Studio has verified the file, its hash chain and signature on `origin/main` | Every scenario checks the screen is unchanged until the merge |

## GitHub write-back, step by step

| Step | How |
|---|---|
| 1. Verify the current source revision | The request carries the revision the person saw and the source blob. If either moved, it is refused as stale |
| 2. Validate authorization | Role, domain, designated approver, sign-in freshness, segregation of duties, evaluated by the server on every request |
| 3. Smallest necessary change | One new JSON file, `docs/decision-reviews/<id>/NNNN-<action>.json`. Source files are never edited. Each scenario asserts the commit changed exactly one file |
| 4. Branch and commit | A new `decision-review/…` branch through the Git data API. Never an existing branch, never the canonical branch |
| 5. Pull request | Opened by the GitHub App. Idempotent: a retry finds the existing pull request |
| 6. Existing validation | The Studio reads and shows GitHub's checks and reviews for the pull request. The five repository checks run on every pull request |
| 7. Required merge policy | The Studio never merges, approves or closes. A person merges under GitHub's rules. The Studio now also checks that those rules exist |
| 8. Refresh the authoritative state | Fetch, verify the record, hash chain and signature, then fold it into the decision's status |
| 9. Update the UI only after confirmed success | Until step 8 the screen shows what GitHub holds. Each scenario asserts this before the merge |

The GitHub App has the minimum permissions: Contents and Pull requests write, Checks, Statuses and Metadata read, no events, installed on one repository.

## Merge policy

`GET /repos/{repo}/rules/branches/{branch}` returns the active rulesets for the branch.

| State | Meaning | Status-changing actions |
|---|---|---|
| Enforced | A pull request and at least one passing check are required | Allowed |
| Partly enforced | A pull request is required, no status check | Allowed, with a warning that a pull request could be merged without validation |
| Not enforced | No active ruleset requires a pull request | **Refused**: not sent to GitHub, nothing recorded. What was typed stays in the dialog. A comment is still allowed |
| Could not be read | GitHub did not answer | Allowed. The pull request itself will fail if GitHub is down. Shown as *Could not be read* |

If your GitHub plan has no rulesets (some private repositories), the state is *Not enforced* and approvals are not sent. Two enforceable alternatives:

1. Enable rulesets. This repository's `main` has two, both active, and on 2 November 2026 the real API reported *Enforced: a pull request and 4 passing checks (validate, evaluate, studio, gate), force pushes blocked*.
2. If the branch is protected another way (classic branch protection, which the app's permissions cannot read), set `STUDIO_MERGE_POLICY=warn` after confirming it. `off` disables the check. The default is `require`.

Even with no protection at all, the Studio cannot be tricked into showing an approval. **Read-time verification is the enforceable alternative**: a review record counts only if its signature verifies against the server's trusted key, its hash chain is intact, and its author was enrolled with the role at the time. A record somebody commits straight to `main` fails those checks and is reported, not applied (tested below).

## Conflicts

If the source file or the decision's review state changed while you were reviewing, the submit is refused with a conflict that holds three things: the state you saw, the current state with the conflicting record, and **your proposed decision unchanged**. Nothing is sent. You must tick that you have read the current state before the same decision can be re-applied, or discard it. The refusal is in the audit log. Tested in the browser (existing [`github-sync.spec.ts`](../../apps/architecture-studio/e2e/github-sync.spec.ts)) and at the API level in the new spec.

## Approval history

The decision timeline shows, for each record: the action, **who** (verified account), **when**, **why** (the rationale, comment or conditions) and **the GitHub commit** that carries it, with the pull request number. The commit is found by asking git which commit on the canonical branch introduced the record file, so it is true even for a record made by another Studio instance. Markdown that says "approved by the owner" is shown as a claim in the source and flagged as unsigned. It is never counted as a review record or a signed approval.

## What the tests prove

[`e2e/approval-reconcile.spec.ts`](../../apps/architecture-studio/e2e/approval-reconcile.spec.ts) runs a Studio configured as a GitHub App against a stand-in for the GitHub REST API (port 3105) over a real bare git repository. Every scenario that lands a record ends with one comparison:

- **GitHub:** the record files on `main`, their count, the last record's action, actor, option, conditions and signature, the commit that carries it, and the files that commit changed (exactly one).
- **Server:** the same count, the same record by hash, no chain problems, the same effective status, the same canonical commit as GitHub, and a timeline entry naming that commit.
- **Screen:** the status the page shows, the actor, the reason, the conditions, and the short commit in the history.

| Your test | Scenario |
|---|---|
| New decision added to GitHub, appears pending | Eight ADRs are committed to `main`, appear as Proposed, and reading them changes nothing |
| Approve | Recommended option; an alternative with its option key; with two conditions |
| Reject | Reason required, then Rejected after the merge |
| Defer | Deferred after the merge |
| Reopen | An approval cannot be overwritten; reopening needs a reason; the first approval stays on record |
| Request revision, comment | One chain of two records; a comment changes no status |
| Conflict | GitHub moves while the person reviews. Proposed decision preserved, conflicting record shown, nothing written; resubmitting against the current revision succeeds |
| Failed GitHub write | Connection dropped: no false success, no pull request, the screen unchanged; retry completes it once |
| Unauthorized | No role, contributor, an impostor with the owner's login, an anonymous caller, a bot that cannot sign in, a changed identity under a live session, a wrong origin and a missing CSRF token. Nothing reaches GitHub. Refusals are audited |
| Duplicate submission | The same key sent twice and sent concurrently: one proposal, one pull request, one record |
| Forged approval | A hand-written record on `main`; a record with a recomputed hash under the real owner's name and a borrowed signature; Markdown claiming approval. None becomes an approval |
| GitHub rate limiting | Long (`Retry-After: 120`): reported with when to retry, nothing claimed, retry completes it. Short (1 s): waited out, no failure |
| Merge policy | No rule: approval not sent, comment allowed, screen says why. Rules restored: allowed. Rules unreadable: shown as unknown |
| History | Each record names its author, date, reason and a real commit URL |

Unit tests: [`merge-policy.check.ts`](../../apps/architecture-studio/checks/merge-policy.check.ts) (10) and five more in [`workflow.check.ts`](../../apps/architecture-studio/checks/workflow.check.ts) for the gate.

## One real run against real GitHub

The stand-in proves the Studio's behaviour. One run on 3 November 2026 checked the same path against the real repository, as the real GitHub App (app 5576378, installed on this repository only), signed in as the real owner. It submitted **one comment** on D-036, an action that needs no approval authority and changes no status, and left nothing behind.

| Step | What was observed |
|---|---|
| Studio's connection | Mode *GitHub App*. Merge policy *Enforced*: a pull request and 4 passing checks (validate, evaluate, studio, gate) |
| Submit | 13.5 s from click to pull request. State *Pull request created* |
| On GitHub, read independently with gh | Pull request #18, authored by pp/greenfuel-architecture-studio, open, base main, **one file changed**: docs/decision-reviews/D-036/0001-comment.json. The commit is attributed to the signed-in person. The record names that person's verified subject, carries the server's signature and its hash |
| Canonical state | main unchanged, at 4f4dd90. D-036 unchanged, 0 records. Studio state *Awaiting merge* |
| Validation | All five required checks ran and passed on the real pull request (including alidate and control-plane-guard). The Studio reported *validation success*. GitHub still reported the merge **blocked**, awaiting the review the ruleset requires: passing checks were not treated as approval |
| Reconcile | The pull request was closed unmerged with gh and the branch deleted. The Studio's next check reported *Failed: closed without merging* and D-036 stayed as it was |
| Left behind | A closed, unmerged pull request #18 and nothing else: no branch, main untouched |

What this did **not** cover on real GitHub: merging, because that is a person's act and nothing was merged; an approval, because no approver key is enrolled (B1); and rate limiting, because it cannot be provoked on demand. Those are covered by the stand-in only.

## Limits

- The stand-in is not GitHub. It proves how the Studio behaves, not how GitHub behaves. The one real-GitHub run, above, is narrow.
- Classic branch protection is not readable with the app's permissions. A repository that uses it reports *Not enforced* until you set `STUDIO_MERGE_POLICY=warn`.
- A merge-policy check that cannot be read does not stop a decision. It is shown, and the pull request creation would fail anyway if GitHub were down.
- Segregation of duties means the owner cannot approve a decision they asked to have revised. A second enrolled approver is needed. In the real policy only one person is enrolled, so a revision requested by the owner can only be approved by someone else once a second approver is enrolled.
- The Azure deployment is read-only and not connected to the GitHub App, so no approval can be made from it. Entra sign-in is still blocked by tenant consent.
- No signed approval under ADR 0008 exists yet (B1): no approver key is enrolled.
- The browser tests are not part of CI.
