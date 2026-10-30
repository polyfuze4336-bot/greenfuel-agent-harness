# Approval workflow guide

For the people who approve. The Studio helps you decide; it never decides for you, and neither does an AI agent.

## Roles

| Role | Can do |
|---|---|
| Viewer | Read |
| Contributor | Propose decisions and revisions |
| Architect | Review and recommend |
| Security Reviewer | Approve security-specific gates |
| Architecture Owner | Approve designated architecture decisions |
| Deployment Approver | Authorize named Azure deployment gates |
| Administrator | Manage access and policy; **not** an automatic override of any approval requirement |

Roles come from the access policy in the repository, bound to a verified Entra identity (`entra:<tenant>:<object id>`). Names and e-mail addresses are never identities. Agents, bots and service principals cannot be enrolled.

## Reviewing a decision

1. Open **Decision Register**, choose a decision, then **Review**. **Next pending** moves to the next one; there is no bulk approval.
2. Read, in order: what is required, why it matters, context, the recommended option, alternatives with their trade-offs, risks and dependencies, requirements, source file (with commit), history and the consequences of each outcome. AI-written suggestions are labelled and are never part of the record.
3. Choose one action:
   - **Approve recommended option**
   - **Approve an alternative** (the choice is recorded)
   - **Approve with conditions** (conditions are mandatory and recorded)
   - **Reject** (a rationale is required)
   - **Request revision**
   - **Defer** (a reason is required)
   - **Comment**
   - **Reopen** an approved decision through the controlled workflow (a decision is never silently overwritten)
4. The Studio checks your role, ownership, segregation of duties, the revision you saw (a stale revision is refused) and an idempotency key (a double click does not duplicate).
5. A branch and pull request are created. The decision shows its progress: locally submitted, awaiting GitHub update, pull request created, awaiting merge, **applied to canonical repository**, or failed/conflicted. It is **Approved only at the last stage**.
6. If GitHub changed after you opened the decision, you see original, current and proposed values and must reconcile; nothing is overwritten.

## Other approvals are separate

| Approval | Where | Note |
|---|---|---|
| Architecture decision | Review workflow | Does **not** authorize regulatory filings or deployment |
| Certification-scheme filing | Quality manager, outside the Studio | Not an architecture approval |
| Architecture baseline | Baseline page; signed with an enrolled key | Required before a final deck and for build gates |
| Azure deployment gate | Deployment Approver, named gate | Phase raise recorded in an ADR (HC-11) |
| Slide approval | Presentation Studio | Local editorial state, **unsigned** |

## What cannot approve

Text saying "Approved" in a Markdown file, a commit by an agent or bot, a Copilot comment, a hand-written review record, a replayed record, a record whose subject text has changed, or a revoked approver. The acceptance run tests the forged and hand-written cases ([TEST-REPORT](TEST-REPORT.md)); earlier stages test replay, revocation and segregation of duties ([ACCESS-CONTROL](../architecture-studio/ACCESS-CONTROL.md)).
