# Decision Workspace

How the Studio turns the repository's decision records into one read model, and how it treats each kind of record. The repository stays the source of truth; the Studio reads it and never edits it. Nothing here replaces the existing governance system (ADRs, the decision register, signed approvals, the review workflow).

## Sources

| Source | What it supplies |
|---|---|
| `docs/adr/*.md` (not `0000-template.md`) | One record per ADR: status, deciders, context, options, decision, consequences, requirements addressed |
| `docs/context/DECISION-REGISTER.md` | One record per open register entry: **Kind**, decision needed, why it matters, known options, owner role, needed-by milestone, status |
| `docs/context/REQUIREMENTS*.md`, `REQUIREMENTS-TRACEABILITY.md` | Priority, and which requirements a decision blocks or is cited by |
| `docs/architecture/RISK-REGISTER.md`, `docs/state/TODO.md`, the roadmap | Related risks and tasks |
| `docs/architecture/reviews/`, `docs/architecture/designs/` | Design reviews and the comparison tables behind alternatives |
| `docs/approvals/`, `harness/policy/` | Signed approval records, the approver registry, the access policy |
| Git history | Last modified commit and the file's change history |

Parsing is deterministic and lives in `apps/architecture-studio/src/lib/intel/`. Every populated field carries the file, line and rule it came from. A field no source states is `null` or empty and is listed as **not stated**. No model writes into the record.

## Three kinds of record, never interchangeable

The register's own legend defines them, and the Studio uses that legend, not the owner's role, to decide what a record is:

| Register Kind | Nature | What resolving it means | Approvable as an architecture decision in the Studio? |
|---|---|---|---|
| ADR, or **X** | Architecture choice | The options are known; choosing needs analysis and an approval from the named role | Yes, by the right role through the review workflow |
| **C** | Stakeholder clarification | A fact only the business can supply is recorded in the repository by the named role | **No.** Its "options" are possible answers, not architecture options |
| **D** | Regulatory verification | A qualified person verifies a regulatory or certification claim and the evidence is recorded | **No.** Never approved on a recommendation, human or AI. Filing approval is a separate process |
| Combinations (C+D, X+C, X+D) | Both | The most restrictive part decides | **No.** C+D and X+D are verifications; X+C waits for the business fact |
| Missing or unrecognised letter | Not stated | Not guessed | **No**, until the register states a Kind |

Of the 58 records at the commit this was built from: **28 architecture choices** (21 ADRs and 7 X entries), **22 stakeholder clarifications** (21 C and 1 X+C), **8 regulatory verifications** (1 D, 6 C+D, 1 X+D). Every record is in exactly one lane. These counts are asserted against the register file by an independent parser in the tests, so they change only when the register changes.

### What had to be fixed

Before this work, authorization classified a record by the *owner role text* only. A stakeholder clarification owned by the "Programme owner" (for example D-003, "Ports and jurisdictions in the first release") was classified as an architecture decision, sat in the review queue and could be approved, with a recommendation or without. The register entry's Kind was display text only. Now:

- `natures` is a structured field on every record, with a recorded source.
- The server's classification (`classify` in `src/lib/auth/access-policy.ts`) applies the nature first: D makes it `regulatory`, C makes it `clarification`, an unclear register entry is `unclassified`. All three are refused for approval, rejection, deferral and reopening with a plain explanation (`domain-not-approvable`). Comments and revision requests are still allowed.
- The review queue (`pendingOrder`) uses the same classification, so it never offers something the server would refuse.
- The interface says what a record is: a Kind badge, a notice on the record, its review page and its comparison, "Possible answers" and "Ways to verify" instead of "Alternative options", and "Comment and track" instead of "Review and decide". Compare alternatives is offered only for architecture choices.
- The Overview separates the three kinds of work, with counts.

The access policy file (`harness/policy/access-policy.json`) was not changed. The new `clarification` domain is application code, and it can only be more restrictive than the policy.

## What a decision shows

| You asked for | Where it comes from |
|---|---|
| ID, title, status, priority | Record header; status verbatim from the source with the rule that mapped it; priority from the requirements that trace to it, with the basis |
| Why it matters | Business justification (ADR "Why this option is appropriate", register "Why it matters") |
| Business consequences | ADR consequences become pros and cons on the chosen option; the review page states what happens if approved or rejected, derived from dependencies and blocked requirements |
| Recommended option, alternatives, pros and cons | Only what the source marks. Register entries recommend nothing. Side by side in Compare alternatives, with the comparison table's verdicts |
| Cost, reliability, security, data sovereignty, operational | ADR sections, each with its source line; "not stated" when absent |
| Dependencies | Decisions it cites and decisions that cite it |
| Related requirements | Blocked-until-decided, cited by an ADR, or named in a traceability row. Each with priority and how it relates |
| Related risks, tasks, reviews, ADRs | From the risk register, TODO and roadmap, and design reviews |
| Existing approvals | Status line, signed approval records, owner decision log, and merged review records, each labelled signed or unsigned |
| Source GitHub link | Permalink at a pushed commit that holds the byte-identical file, otherwise labelled "Local only" |
| Last modified commit, history | The newest commit that changed the source file, linked to GitHub when GitHub has it, and the last 20 changes to the file. The register is one file, so its history is the register's as a whole, and the record says so |
| Inline comments, next decision | Comments are review events recorded through the review workflow (sign-in required). Next and previous move through the architecture review queue |

AI may propose pros, cons and alternatives. They appear separately, labelled "AI suggestion · unreviewed · not evidence", never change a status and never count as an approval.

## Integrity rules enforced

- **Existing statuses are preserved**: the status text is kept verbatim; an unrecognised status is shown as Proposed and flagged, never promoted.
- **Missing fields stay unknown**: listed under "Not stated in any source".
- **Duplicate ids are detected**: both records are kept, the collision is reported, and validation fails for them.
- **Invalid references are flagged**: a record citing a decision or requirement that does not exist at this commit shows it under "Invalid references" and as a flag. A traceability table, risk or task that cites a missing decision produces a read warning with its location. The real repository has none today, and the test suite proves detection on controlled repositories.
- **Reading changes nothing**: opening every record, every page and every read endpoint leaves HEAD, refs, the working tree and the index exactly as they were.

## Tests

| Layer | What it proves |
|---|---|
| `checks/workspace.check.ts` (13 tests, throw-away git repositories) | Nature from Kind, never guessed; lanes; classification follows nature not owner; invalid decision and requirement references; dangling traceability citations; no false flags; duplicate ids; counts reconcile with the files; unknown fields; reads change nothing |
| `checks/workflow.check.ts` | The review queue excludes clarifications, verifications and unclassified records, whoever owns them |
| `e2e/workspace.spec.ts` (real repository) | Counts reconcile with the repository files; statuses preserved; every record has a nature, a real source and the blob git reports; nothing cites a missing record; each kind is labelled and offers only what it may; the queue holds only architecture decisions; search and filters; last modified and history equal git; source links resolve; reading changes nothing |
| `e2e/review.spec.ts` | An architecture owner cannot approve, reject or defer a stakeholder clarification: the server refuses, the page explains, no pull request is created, the refusal is audited |

In the throw-away review-workflow worlds only, stakeholder-only register entries are relabelled as architecture choices (except D-005, kept to prove the refusal), because those tests need many register entries that can be approved and the real register has few. The real repository is never changed.

## Known limits

- **Related requirements** show what the traceability table and the ADR name. A requirement that is related but written nowhere will not appear.
- **Register entries share one file**, so the "last modified commit" of a register entry is the last change to the whole register.
- **Inline comments** are decision-level comments through the review workflow, not comments anchored to a selected passage.
- **Business consequences** are the ADR's recorded consequences and a rule-based statement of what approval or rejection unblocks. Nothing is predicted by a model.
- **A decision's nature is only as good as the register's Kind column.** If the column is wrong, the Studio is wrong in the same way, and the correction is a change to the register.
- **Approval of a stakeholder clarification or a regulatory verification happens outside the Studio** (the named role records the fact or the verification in the repository). The Studio shows them, tracks them and refuses to pretend to approve them.
