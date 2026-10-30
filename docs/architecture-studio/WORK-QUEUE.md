# Architecture Work Queue

The Work Queue lists everything that must be completed before the application build, and shows what is blocking that build. It is part of the [Architecture Decision Studio](../../apps/architecture-studio/README.md) and follows the same rules: it reads the repository, it never invents a fact, and every change is a pull request that a person merges.

Status: built on branch `studio/ui-readonly`, **not pushed, not approved** (owner decisions in [T63](../state/TODO.md)). Tested against a simulated GitHub only.

## What it is built from

These repository sources are all read by deterministic parsers (`src/lib/queue/sources.ts`, `derive.ts`). Nothing is written by a model.

| Source | Becomes | IDs |
|---|---|---|
| `docs/state/TODO.md` | Owner tasks | T1 and up |
| `docs/harness/IMPLEMENTATION-ROADMAP.md` | Roadmap items | R1 and up |
| `docs/capstone/PRIORITIZED-BACKLOG.md` | Capstone backlog | B-01 and up |
| `docs/capstone/CRITICAL-GAPS.md` | Capstone gaps | G-01 and up |
| `docs/capstone/RUBRIC-TRACEABILITY.md` | Rubric criteria, kept as **evidence gaps** | RC-A1 to RC-D3 |
| `docs/target-architecture/13-SECURITY-REVIEW.md` | Security findings and open items | SF-xx, SO-n |
| `docs/target-architecture/12-DATA-MOVEMENT-AND-RESIDENCY-VALIDATION.md` | Validation procedures | V-1 to V-12 |
| `docs/architecture/RISK-REGISTER.md` | Risks | RK-xxx |
| docs/adr/*.md and docs/context/DECISION-REGISTER.md | Decisions | ADR-nnnn, D-nnn |
| Design review records and the design review gate | Gates | DES-nnnn |
| docs/context/REQUIREMENTS.md and the NFR file | Requirement gaps: Must requirements with open clarifications or claims to verify | RG-<requirement id> |
| Studio build blockers | The reasons the build cannot start | BLK-n |

At the commit this was written, that gives 323 items (302 outside the rubric evidence gaps, 21 evidence gaps), 543 relationships, of which 306 state that one thing must come first. The API always returns the live numbers.

## Rules

These are the rules the queue follows. Each is tested in `checks/queue.check.ts`.

- **A field is copied from a source with its file and line, or it is shown as "Not stated in the source".** Owner, priority, acceptance criteria, evidence required, due date: none is filled in.
- **A due date exists only if a source states one** ("due YYYY-MM-DD") or a merged assignment records one. None exists in the repository today.
- **Done needs completion evidence:** an evidence record (`EV-nnnn`) from a run that succeeded, a file that resolves, a decision record, or a merged completion approval. A source that says closed without evidence gives **"Closed, no evidence"**, which is not resolved and still blocks.
- **A dependency is "requires" only where a source's wording says so** ("until", "blocked by", "needs", "requires", "after"). A bare mention is "references". Only "requires" carries consequences, and it is followed transitively. A mention is shown, never followed.
- **Rubric criteria are evidence gaps, not engineering tasks.** They are excluded from All tasks and from the build-blocking chain, and have their own view. The official rubric file is not in the workspace; they are read from the repository's own rubric traceability, which is its record of the rubric.
- **Critical** is a written rule per kind (risk impact High, security severity High and not fully fixed, gap severity Critical, design gate computing Blocked, build blocker), never a judgement.

## Views

All tasks, My tasks, Pending approvals, Blocked, Critical risks, Architecture gaps, Completed, Rejected or cancelled, and Evidence gaps (rubric). Each view states its rule on the page (`VIEW_RULE`). The counts come from one function used by the server and the browser. My tasks are items assigned to you by a merged record, plus unassigned open items whose owner text names a role you hold; it needs a verified GitHub sign-in.

## Automatic relationships

| Event | Effect | Never |
|---|---|---|
| A decision is **rejected** | Work that requires it is listed as affected and flagged "review needed". Work that only mentions it is listed as possibly affected. The design and architecture documents that cite it are listed. | Changes a status |
| A **critical** decision is **deferred** | Unresolved work that requires it becomes **Blocked**, with the reason. Implementation work that must stay blocked is named. | Does anything for a non-critical deferral |
| A **requirement changes** | Decisions that list it, or that it lists, are flagged for review (compare against a branch, tag or commit). | Touches work with no direct link |
| Any of the above | Unrelated work, with no "requires" edge to the decision, is left exactly as it was. | Invalidates unrelated work |

Limit: the repository records no mapping from a decision to named architecture components. The impact shows the documents that cite the decision and the work whose sources say it requires it, and says so on the page.

## What is blocking the build?

`/queue/blocking`. The build is a node that requires every build blocker (BLK-n), and each blocker requires the work its sources say it needs. Resolved work ends a branch: what it needed no longer blocks anything. The page shows the count, the work that can be started now (everything it needs is resolved), ordered by how much of the chain it unlocks, the work that is waiting and what it waits for, an SVG dependency graph with a list form of the same edges, decisions that change what is blocked, and a requirement-change check. Cycles, if any, are reported. Resolving the list does not start the build: that still needs the owner's approval under HC-11.

At the commit this was written: 41 unresolved items stand between the repository and the build, 33 can be started now, no cycle, no decision currently rejected or critically deferred.

## Actions and the write path

Assign, Prioritize, Comment, Mark blocked (and clear), Request clarification, Submit for review, Approve completion, Reject completion, Reopen. Each is one JSON file under `docs/work-items/<id>/NNNN-<action>.json`, hash-chained to the previous event, sent as a pull request by the same pipeline as the decision reviews (`src/lib/workflow/sync-core.ts`). The Studio never writes to the working tree or to `main`.

- An item changes only after the pull request is merged and the Studio has verified the file, its hash and its chain on the canonical branch. Until then the item says "Locally submitted", "Awaiting GitHub update", "Pull request created" or "Awaiting merge", and shows its old state. A failure or conflict is shown as such.
- Every action needs a GitHub identity the Studio verified itself (`gh api user`, type User). Comments are open to any verified account. Everything else needs a person registered in `harness/policy/decision-workflow.json` (login **and** numeric id must match). An AI agent session is refused.
- Completion needs `work.completionRoles`. The person who submitted for review cannot approve it when `work.requireIndependentCompletionApproval` is true. **The shipped policy sets it to false**, because only one approver is registered; the parser default is true. Setting it is an owner decision (T63).
- Submit for review needs evidence that already exists on the canonical branch, and an `EV` record's recorded run must have succeeded. The Studio cannot judge whether the evidence is enough: a person does that when approving.
- Reasons of at least 10 characters for prioritize, block, clarify, reject completion and reopen. Assignees must be registered. Blocked-by ids must be items in the queue. Dates must be real.
- One change per item at a time, a revision check against stale views, idempotency keys against duplicate submissions, an audit event for every attempt (accepted, denied, stale, invalid, duplicate, sync).
- These records are not signed approvals under ADR 0008 and change no ADR, approval manifest or control-plane file.

Decisions are decided in the [review workflow](REVIEW-WORKFLOW.md), not here; the queue links to it.

## Tests

- `checks/queue.check.ts` (44 unit tests): every parser against real and synthetic text, status mapping, "Closed, no evidence" staying unresolved, requires versus references, transitive closure, cycle detection, the build analysis (ready items, unlocks, resolved branches ending), each impact rule including that unrelated work is untouched, requirement-change detection, due dates, and the whole snapshot against this repository.
- `checks/workflow.check.ts` (38 tests, still passing after the shared pipeline was extracted) and the work-item rules.
- `e2e/studio.spec.ts` (Work Queue) and `e2e/work-queue.spec.ts`, in a real browser: views and counts against the API, the rubric kept out of All tasks, all requested fields on an item, signed-out and unregistered users, assign through to canonical, My tasks, prioritize, comment, block, clarify, evidence rejection, separation of duties, Done only after merge, reopen, reject completion, duplicate and stale submissions, a rejected decision flagging only linked work, a critical deferral blocking only linked work, a requirement change flagging only linked decisions, the graph and keyboard, accessibility (axe), cross-origin and unauthenticated requests.

Screenshots 40 to 53 in [screenshots/](screenshots/) are captures from those runs.

## Limits

- The write path has been exercised only against the simulated GitHub service and a local bare remote. It has **not** been run against real GitHub.
- The official rubric PDF is not in the workspace; evidence gaps come from the repository's traceability record of it.
- No decision-to-component mapping exists in the repository, so component impact is limited to citing documents.
- Source parsing depends on the table and heading formats now in use; a document that changes shape surfaces as unresolved references or missing fields, not as silent data.
- Tested in Microsoft Edge only.
