# GitHub synchronization

How the Architecture Decision Studio reads from and writes to `polyfuze4336-bot/greenfuel-agent-harness`, with a GitHub App as the write channel.

Status: built and tested against a **stand-in for the GitHub REST API**, not against real GitHub. No GitHub App has been registered yet, so the App path has never run against github.com. See [What has and has not been verified](#what-has-and-has-not-been-verified).

GitHub stays authoritative. The Studio never writes to the canonical branch, never merges, never approves a pull request and never edits an ADR or any source record. It adds one new file per action, on a new branch, in a pull request that a person merges under the repository's own policy.

## The twelve steps

| # | Step | Where it happens |
|---|---|---|
| 1 | Validate the action and the person's authority | `ReviewService.submit` / `WorkService.submit`: the identity is re-verified with GitHub at the moment of acting; the role rules in `harness/policy/decision-workflow.json` are applied; AI agent sessions are refused |
| 2 | Verify the source commit | The decision's source file is compared, by git blob id, with the same file on the canonical branch. The commit the person was looking at is recorded in the event (`basis.sourceCommit`) and in the proposal |
| 3 | Detect concurrent modification | The canonical branch is fetched at submit. Three checks: the source file changed (`source-changed`), the decision's record chain or phase changed (`stale-revision`), another change is in flight (`proposal-open`). At send time the chain is checked again (`CANONICAL_MOVED`, `SEQUENCE_TAKEN`) |
| 4 | Generate the structured record | One hash-chained JSON event, `docs/decision-reviews/<id>/NNNN-<action>.json` or `docs/work-items/<id>/NNNN-<action>.json` |
| 5 | Preserve the format and unrelated content | The commit adds exactly one new file on top of the canonical commit. An existing path is refused. No ADR, manifest, workflow or policy file can be written (`FILE_RE`) |
| 6 | Create a branch | `POST /git/refs`, only under `decision-review/` or `work-item/`, never an existing branch (`BRANCH_RE`) |
| 7 | Commit | Blob, tree and commit objects through the Git Data API, parented on the canonical commit |
| 8 | Create the pull request | `POST /pulls`. A retry after a lost response returns the existing pull request instead of opening a second one |
| 9 | Run validation checks | The repository's `validate` workflow runs on `pull_request`. The Studio reads check runs, commit statuses and reviews and reports them; it does not run or waive anything |
| 10 | Await the review or merge policy | The proposal stays at "Awaiting merge". The app has no merge call. Passing checks are shown as passing checks, not as approval |
| 11 | Confirm the canonical update | After a merge the Studio fetches the canonical branch and verifies the file, its hash and its place in the chain. Only then is the proposal **Applied** |
| 12 | Refresh the UI | The read model and the work queue are rebuilt from the canonical branch |

An item shows its new status only after step 11. Until then the screen says "Locally submitted", "Awaiting GitHub update", "Pull request created" or "Awaiting merge", and shows the old status.

## Authentication: a GitHub App

- The app signs a short RS256 JWT (issued a minute in the past, valid nine minutes) and exchanges it for an **installation token**. The token request names this one repository and the five permissions below, so a token can only be narrower than the app's grant.
- Tokens live in memory and are renewed a minute before they expire. A 401 triggers one renewal and one retry; a second 401 is reported as a credential problem a person must fix (the request is kept).
- The private key is read from a file on the server by `AppAuth`, held as an opaque key object, and never serialised, logged, stored or sent to the browser. `JSON.stringify` and `util.inspect` on the auth object show only the ids. Errors never contain a token.
- No personal access token is used for writing. (Reading the identity of the person at the keyboard still uses `gh api user`; see limits.)

### Permissions to grant (and nothing else)

| Permission | Level | Why |
|---|---|---|
| Contents | Read and write | create blobs, trees, commits and the new branch |
| Pull requests | Read and write | open pull requests and read their state and reviews |
| Checks | Read | report check runs |
| Commit statuses | Read | report commit statuses |
| Metadata | Read | mandatory |

Do **not** give the app Administration, Workflows, Actions or Secrets. Do **not** add it to any ruleset or branch-protection bypass list.

### Registering the app (a human step, not done yet)

1. GitHub → Settings → Developer settings → GitHub Apps → New GitHub App. Name it, for example, `greenfuel-architecture-studio`. Untick **Active** under Webhook for now (see below).
2. Set the permissions in the table above. "Where can this app be installed": only on this account.
3. Create the app, note the **App ID**, then **Generate a private key**. Move the `.pem` file outside the repository working tree and never commit it.
4. Install the app on `polyfuze4336-bot/greenfuel-agent-harness` only, and note the **installation id** (the number in the installation's URL).
5. Set the environment for the Studio (values are examples):

```powershell
$env:STUDIO_GITHUB_APP_ID = '123456'
$env:STUDIO_GITHUB_APP_INSTALLATION_ID = '7890123'
$env:STUDIO_GITHUB_REPO = 'polyfuze4336-bot/greenfuel-agent-harness'
$env:STUDIO_GITHUB_APP_PRIVATE_KEY_FILE = 'C:\secure\greenfuel-studio.pem'
npm run build; npm start
```

When all four are set the Studio switches to the App and reads the canonical branch (`origin/main`) by default. If any is missing it uses the GitHub CLI as before. The sync popover (top right) shows which mode is active.

### Webhooks (optional)

Webhooks make the Studio notice a merge or a failing check at once; without them a person clicks "Check GitHub status" or "Reconcile with GitHub", and nothing else polls.

1. Set `STUDIO_GITHUB_WEBHOOK_SECRET` to a long random string, and the same value as the app's webhook secret.
2. Expose **only** the webhook route, for example with a tunnel, and set `STUDIO_WEBHOOK_HOSTS` to the tunnel's host name. That host can `POST /api/v1/github/webhook` and reach nothing else; every other path answers 403 for it. Do not use `STUDIO_ALLOWED_HOSTS` for this: it would expose the whole Studio.
3. Subscribe the app to: Pull request, Pull request review, Check run, Check suite, Status, Push.

Each delivery must carry a correct `X-Hub-Signature-256` over the exact raw body (constant-time comparison), otherwise it gets 401 and an audit entry. A verified delivery is never trusted for its content: it only names which proposals to re-check, and the re-check asks GitHub. Delivery ids are remembered, so a replay is acknowledged and not processed twice. A delivery that could not be processed gets a 503 so it can be redelivered.

## Conflict handling

If GitHub changed after the decision was opened, nothing is sent and nothing is overwritten. The dialog shows three columns:

- **Original**: what the person opened (status, last recorded action, canonical commit);
- **Current**: what GitHub holds now (status, the action that changed it, commit, anything in flight, and for a changed source file its new version);
- **Proposed**: the person's own action, option, conditions and text.

The request can be re-applied only after the person ticks "I have read the current state". Re-applying uses the newer revision and a new idempotency key, and the server validates the action against the current state again (an action that is no longer allowed is refused). "Discard my action and reload" closes the dialog and reloads. The refusal is in the audit log either way.

A conflict found later, when the request is being sent (someone else's change merged in between), moves the proposal to **Conflicted** and writes nothing.

## Audit

Every attempt writes a hash-chained entry to `audit.jsonl` in the Studio cache folder (tamper-evident, verified by `verifyAudit`). Entries now carry:

| Field | Meaning |
|---|---|
| `actor` | the GitHub account the Studio verified |
| `action`, `decisionId` | what and on what (`work:<id>` for work items) |
| `facts.oldValue`, `facts.newValue` | the status (or assignee, priority) before and after |
| `facts.sourceCommit` | the commit of the source record the person saw |
| `facts.baseCommit` | the canonical commit the change was built on |
| `facts.pullRequest`, `facts.resultCommit` | the pull request, and the commit that carries the change (the commit that introduced the record once it is applied) |
| `facts.validation` | `success`, `failure`, `pending` or `none`, as GitHub reported |
| `at`, `code`, `detail` | timestamp, machine code (`pull-request-created`, `validation-failure`, `applied`, `conflicted`, `pr-closed-unmerged`, `webhook-handled`, `bad-signature`, ...) and a sentence |

The audit log is local to the machine running the Studio. The durable, shared record is the event file in the repository and the pull request.

## Reliability

| Property | How |
|---|---|
| Idempotent writes | A client idempotency key per action returns the existing proposal; the branch name is derived from it; pull-request creation returns the existing pull request for that branch; creating a branch at the commit it already has is success |
| Retry-safe | Every sync step checks what already happened before acting. GET requests are retried with backoff; writes are not retried blindly, the next sync resumes |
| Rate limits | `Retry-After`, `x-ratelimit-reset` and secondary-limit messages are honoured: short waits are slept (up to 10 s), longer ones stop and report when to try again. The proposal stays open; the sync popover shows the last limit seen |
| Failure recovery | A network error, 5xx, rate limit or credential problem keeps the proposal where it was with a retryable error; sending again completes it. A reconcile routine (button, optional webhook trigger) re-checks every open proposal and lists pull requests carrying the Studio's branch names that no local proposal accounts for (reported, never adopted) |
| No false success | "Applied" requires the merged file, its hash and its chain to be verified on the canonical branch. A merged pull request whose file is missing or different is "Conflicted". A closed, unmerged pull request is "Failed". Failing checks are shown and change nothing |

## Security boundaries

- The browser never receives the key, a token or the webhook secret. A test scans the built client bundle for them.
- The app cannot merge, approve, close, comment, delete or update. It can create a branch under two prefixes and add one record file. The code refuses anything else before a request is made.
- **Branch protection is not available on this repository's plan** (T14: it needs GitHub Pro or a public repository). Until it is, the code-level limits above are the only control stopping a Contents-write credential from writing to `main`; the app is never granted a bypass, and the Studio contains no code path that targets `main`. Enable branch protection or a ruleset, with required review and the `validate` check, as soon as the plan allows. The Studio will then also be unable to bypass it, by design.
- The webhook route is the only route reachable by a non-loopback host, and only for a host in `STUDIO_WEBHOOK_HOSTS`.

## What has and has not been verified

**Verified, by tests that ran here** (`checks/github-sync.check.ts`, 33 unit tests; `e2e/github-sync.spec.ts`, 15 browser tests):

| Scenario | Result |
|---|---|
| Successful approval PR | pass: one branch under the Studio's prefix, one file, main untouched until merge |
| Rejection PR | pass |
| Concurrent update conflict | pass: stale revision, source changed, and moved-before-send, each with nothing written; the three-column view and the acknowledgement |
| Network failure | pass: kept, reported as retryable, completed once on retry with no duplicate |
| Expired credentials | pass: renewed once; revoked credentials reported as a fixable credential problem and resumed |
| Duplicate request | pass |
| Failed CI | pass: shown as failed, proposal open, no merge offered |
| Rejected (closed) PR | pass: Failed, nothing applied |
| Successful merge and refresh | pass: Applied only after verification; status, timeline and work queue refresh |
| Rate limit, server errors | pass |
| Webhook signature, replay, foreign repository, tunnel host restriction | pass |
| JWT validity and the installation token's scope | pass, checked by the stand-in |
| Key and token never in responses, logs, stored state or the client bundle | pass |

**Not verified, and not claimed:**

- **Real GitHub.** The stand-in implements only the endpoints the Studio uses, over a real bare git repository, and verifies the app JWT. It is not GitHub. No GitHub App exists yet, so nothing has been sent to github.com. Differences in real GitHub behaviour (response shapes, eventual consistency between a ref and a pull request, mergeability states, secondary rate-limit wording) are untested. First real run: register the app, point the Studio at a throw-away branch or a scratch repository, and repeat the approval flow before using it on `main`.
- **CI on App-created pull requests.** `validate` runs on `pull_request`; that it runs, and passes, for a pull request carrying only a `docs/decision-reviews/` file has not been observed.
- **The webhook with a real tunnel and real GitHub deliveries.**
- **Branch protection**, which cannot be enabled on this plan.

## Limits

- The person at the keyboard is identified through the GitHub CLI (`gh api user`) on this computer, not through GitHub App user authorization. That is right for one person on one machine; a shared deployment needs user-to-server OAuth (for example the app's "Request user authorization" flow) so each person is verified separately.
- The audit log is local. Pull requests and event files are the shared record.
- Reconciliation reports unknown pull requests; it does not adopt, close or repair them.
- Commits are attributed to the person through the commit author and the pull request body, and created by the app; they are not signed by the person.
