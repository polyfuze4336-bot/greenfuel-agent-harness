# Decision review workflow

Status: implemented and tested against a simulated GitHub. **Not exercised against real GitHub.** Not pushed. Branch `studio/ui-readonly`.

You open a decision, read everything needed to decide it, and approve, select an alternative, reject, request revision, defer,
add conditions, comment or reopen. The Studio never writes to your branch or to `main`. Each action becomes one small file, sent
as a pull request. The decision changes status in the Studio only after that pull request is merged and the Studio has verified the file.

## 1. How to use it

1. Run the Studio (`npm run build`, then `npm start`, from `apps/architecture-studio`) and open http://localhost:3100/decisions.
2. Choose **Review pending decisions**, or open any decision and choose **Review and decide**.
3. Read the record. Choose **Sign in with GitHub**. The Studio asks GitHub which account is signed in on this computer (`gh api user`).
4. Choose an action. Each one opens a dialog that asks for what it needs, then **Submit**. This opens a pull request.
5. A person reviews and merges the pull request on GitHub. Choose **Check GitHub status**. When the Studio has verified the merge, the decision shows the new status.

Keys on the review page: `N` and `P` for the next and previous pending decision; `A`, `R`, `D`, `V`, `C`, `O` open the approve, reject, defer, request-revision, comment and reopen dialogs. A key only opens a dialog. Nothing is submitted by a key.

**The policy ships with one registered approver (section 12). Anyone else is denied every decision action.** Comments are allowed to any verified account.

## 2. What the page shows

| You asked for | Where |
|---|---|
| What decision is required | "What decision is required" |
| Why it matters | "Why it matters": business justification, priority and its basis, decisions that cite it, requirements waiting on it |
| Business and technical context | Category, owner, required approver role, source file and line |
| Recommended option, alternatives, pros and cons | The full record, copied from the source with line numbers. A field the source does not state says so. Link to the side-by-side comparison |
| Risks and dependencies | "Relevant requirements, risks and dependencies" |
| Relevant requirements | Requirements that trace to the decision or are blocked by it, with priority and acceptance |
| Related architecture diagrams | Mermaid source found in the decision's own file and in documents that cite it. Shown as source, not drawn, because no diagram renderer is an approved dependency (T61) |
| Source GitHub file | Source link and read-only preview |
| Previous decisions and history | Decision timeline (review records, requests in flight, source status and owner log, source commits) and an audit trail |
| Previous versions | The commits that changed the source file; each opens read-only at that commit |
| Consequences of approval or rejection | Derived only from recorded relationships and ADR sections. Nothing is predicted |

## 3. Rules and where each is enforced

| Rule | How it is met |
|---|---|
| One decision at a time | One decision id per request; no bulk route exists; one change per decision may be in flight |
| No silent bulk approval | Same. The API takes one action for one decision |
| Rejection requires a reason | At least 10 characters, enforced in the dialog and again on the server. So do deferral, revision and reopening |
| Alternative selection is recorded | The chosen option, whether it is the recommended one, and a required rationale are in the event |
| Conditional approval captures conditions | At least one, at most 10, each stored in the event and shown with the canonical status |
| Critical decisions need the configured role | A decision is critical if its priority is Must, or its source status is Blocked. It needs the role in `critical.requiredRoles` (programme owner). Other decisions need a role the record names, or the programme owner |
| Approval is not granted by an AI agent | See section 4. Agent sessions, bot and organisation accounts, and unlisted accounts are refused. A person must still merge the pull request |
| A previously approved decision cannot be silently overwritten | Once approved or rejected, only **Reopen** and **Comment** are offered. A decision the source already marks Approved is protected the same way. Records are append-only files |
| Every action needs an authenticated identity | Session cookie, CSRF token and same-origin check, and the GitHub account is verified again at the moment of acting |
| Every action creates an audit event | A hash-chained log of accepted, refused, stale, duplicate and sign-in attempts, plus one review-record file per accepted action |
| A Blocked decision cannot be approved | Quality gates read the source's own status, so a reopened decision that the source calls Blocked still cannot be approved. Reject, defer, revision and comment stay available |

## 4. Identity and roles

- **Identity** comes from GitHub, not from a typed name. The Studio runs `gh api user` and requires an account of type `User`. It reads no token. It refuses to sign in inside an agent session (`HARNESS_AGENT_SESSION`).
- **Roles and approval authority** come from `harness/policy/access-policy.json` on the canonical branch, evaluated by the server for every action: roles, approval domains, designated approvers, sign-in freshness and segregation of duties. People are identified by a stable subject (`github:<numeric id>` or `entra:<tenant>:<object id>`), never by a name, so a renamed or recycled login gets nothing. The old `decision-workflow.json` is gone. See [ACCESS-CONTROL](ACCESS-CONTROL.md).
- If the policy is not yet on the canonical branch, the local copy is used and **every event records that**, so the pull request reviewer sees it.
- The policy is a control-plane file (`harness/`). Changing who may approve is a reviewed repository change, never a Studio action.
- A role that a record names but the approver does not hold is listed in the pull request ("roles named by the record but not held").

**What this does not prove.** It shows which GitHub account is configured on this computer. It cannot show that a human is at the keyboard: a script or an agent that can drive this browser or use the same `gh` login could act as you. The control against that is the pull request: nothing becomes canonical until a person merges it. Keep branch protection on, and never list an agent account.

## 5. The record

One JSON file per action: `docs/decision-reviews/<decision id>/NNNN-<action>.json` (see [decision-reviews/README](../decision-reviews/README.md)).

- Each event holds the actor, the options and conditions, the rationale, the role check, the status the source had, and a SHA-256 over its content.
- Each event names the hash of the one before it. A missing, reordered, edited or forged event is detected; events from the first problem onward are ignored and the decision is shown as inconsistent, with no action offered until it is fixed in the repository.
- The folder is outside `docs/adr/` and `docs/approvals/`, which are control-plane paths. **ADR files are never edited.**
- These are decision requests with a verified GitHub identity. They are **not** signed approvals under ADR 0008 and do not satisfy `validate-approvals`. A decision approved this way shows the basis "review record", and the Studio never calls it signed.

## 6. From submission to canonical

Six states, in this order. Failed and Conflicted are outcomes.

| State | Meaning |
|---|---|
| Locally submitted | Saved in the Studio. Nothing has been sent |
| Awaiting GitHub update | Being sent, or the last attempt could not reach GitHub (it is kept and can be retried) |
| Pull request created | The branch is pushed and the pull request is open |
| Awaiting merge | The pull request is open and unmerged |
| Applied to canonical repository | The pull request is merged and the Studio has verified the file, its hash and its chain on `origin/main` |
| Failed | The pull request was closed without merging, or GitHub refused the branch. Nothing was applied |
| Conflicted | The canonical branch moved for this decision, or the pull request merged but the file is not there as submitted |

How it is sent: the Studio builds one commit on top of the current `origin/main` with git plumbing and a temporary index, containing only the review-event file, and pushes it to a new branch `decision-review/<id>/<seq>-<action>-<hash>`. It never touches your working tree, index, branches or `HEAD`, never pushes to the canonical branch, and never forces. The commit is attributed to the verified GitHub account and is not signed. The write module (`publish.ts`) has its own allowlist of git commands and file paths, separate from the read-only adapter.

Until a request is Applied, the register, the overview counts and the header all show the decision's previous status.

## 7. Concurrency and duplicates

- Every request carries the **revision** the person saw (record content, review-chain head and any request in flight). If it has changed, the request is refused with "This decision changed after you opened it" and a Reload button. Text typed in a dialog is not cleared by a background refresh.
- Every dialog sends an **idempotency key**. A double click or a retry returns the proposal it already created; one pull request is opened.
- One change per decision may be in flight. A second, different change is refused until the first is applied, failed or conflicted.

## 8. Failure behaviour

| Failure | Result |
|---|---|
| GitHub or the network is unreachable | State stays Awaiting GitHub update with the error and attempt count. **Send to GitHub** retries. The commit is reused |
| Pull-request creation fails | Same; the pushed branch is reused, not pushed twice |
| Pull request closed unmerged | Failed. The decision is free again |
| Another event for the decision reaches `main` first | Conflicted. Nothing is pushed. Reload and decide again |
| A branch with the same name exists with other content | Failed, not retried, not overwritten |
| Merged, but the file was later reverted | Conflicted, and not trusted |
| The canonical ref cannot be read | The Studio refuses new requests and says so |

## 9. Security notes

- Changing routes accept only same-origin requests with a session cookie (`HttpOnly`, `SameSite=Strict`) and a matching CSRF header, and JSON bodies. The loopback-only Host check still applies.
- Review text is stored as data and shown as text. It is never interpreted as Markdown or HTML by the Studio.
- Test mode (`STUDIO_TEST_MODE=1`) replaces GitHub identity and pull requests with local files, and shows a banner. It exists only for the automated tests.
- No token or secret is read, stored or logged. Nothing is deployed and no Azure resource is touched.
- Next.js bundles each route separately, so the model cache lives on `globalThis` and errors are recognised by shape, not `instanceof`. Both were real defects found by the tests.

## 10. Tests

Run 2026-10-30: 38 workflow unit tests (85 unit tests in the Studio), 26 review-workflow browser tests (116 browser tests in the Studio, 1 intentional skip), repo-wide `npm test` 1085 of 1085, `validate-harness` OK. Browser tests drive the real UI in Microsoft Edge against a throw-away clone with a local bare remote and a simulated pull-request service (test mode, port 3103). Screenshots 31 to 38 in [screenshots](./screenshots) come from that run.

| Required test | Evidence |
|---|---|
| Approval | Unit "approves the recommended option through a pull request and is canonical only after the merge"; browser "approve the recommended option, watch it travel to GitHub, and see it Approved only after the merge is verified" |
| Rejection | Unit and browser rejection tests: no rationale refused; Rejected only after the merge |
| Alternative approval | Unit and browser: option and rationale recorded; the recommended option is refused as an "alternative" |
| Conditional approval | Unit and browser: at least one condition; conditions shown once canonical |
| Reopening | Unit and browser: approval cannot be overwritten; reopen needs a reason; the first approval stays on record |
| Unauthorized approval | Unauthenticated, unlisted, wrong role, bot, impostor login, no CSRF, wrong origin, agent session; all refused and audited |
| Duplicate submission | Same key returns the same proposal (including concurrently); a double click opens one pull request; a second change is refused while one is in flight |
| Stale revision | Out-of-date view refused with a reload path, in two browser pages |
| GitHub synchronisation failure | Unreachable remote, PR-creation failure, closed PR, competing event, branch collision, reverted merge |
| Also | Tamper evidence on the chain, publish allowlist, audit-chain editing, working tree untouched, axe on the page and dialogs, keyboard navigation |

## 11. Limits

- **Real GitHub has not been exercised.** The `gh` paths (`GhCliIdentity`, `GhCliGitHub`) are small, but only identity (`gh api user`) was checked against the real account; no real pull request was created. The simulated service merges by `git` fast-forward on a local bare remote, the way a real merge does.
- **Not proof of a human.** See section 4.
- **Approved here is not signed.** A decision approved through this workflow is a recorded decision. Signed approval under ADR 0008 still needs an enrolled approver and `approval.mjs`.
- **Branch protection is assumed**, not checked by the Studio.
- **One in-flight change per decision**, comments included.
- **Diagrams are shown as source**, not drawn.
- **Source text is shown as written**, so Markdown markers such as `**` appear in descriptions.
- **Role matching is by alias.** "Design approver (not yet named)" matches no role; such decisions fall back to the programme owner.
- **No notifications.** Status is refreshed by **Check GitHub status**, not by polling.
- **Edge only**, with automated accessibility checks and no manual screen-reader review.

## 12. Needs your decision

Recorded as owner TODO T62.

1. **Approvers.** On the owner's chat instruction (2026-10-30) `polyfuze4336-bot`, GitHub id 225331490, is enrolled as Architecture Owner (bootstrap) in `harness/policy/access-policy.json`, committed locally and not pushed. Add anyone else through a reviewed change. This account can decide architecture-domain decisions only when the operator sets `STUDIO_ALLOW_DEV_APPROVALS=1` (development) or after real Entra enrollment; it cannot decide security, regulatory or unclassified decisions, and cannot decide what it proposed. See [ACCESS-CONTROL](ACCESS-CONTROL.md).
2. **Push the policy and the Studio branches** so the policy is on `origin/main` and decisions record `canonical`.
3. **Whether a merged review record counts as approval** for this programme, or only as a recommendation until a signed approval exists. The Studio labels it "review record" either way.
4. **Authorising ADR** for the Studio and this write path (T61 item 3).
