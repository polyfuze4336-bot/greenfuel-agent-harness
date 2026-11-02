# Decision Impact Analysis and Architecture Examiner

Two read-only views on every decision in the Architecture Decision Studio. Both are built from the repository. Neither approves, rejects or changes anything, and neither calls a model.

| | Where | API |
|---|---|---|
| **Impact** | Decision page, **Impact** tab; review page, *Before you decide* | `GET /api/v1/decisions/{id}/impact?action=approve\|reject\|defer\|revise` |
| **Challenge** | Decision page, **Challenge** tab or the *Challenge this decision* button; review page | `GET /api/v1/decisions/{id}/examiner` |

Code: [`src/lib/impact/`](../../apps/architecture-studio/src/lib/impact/), [`src/lib/examiner/`](../../apps/architecture-studio/src/lib/examiner/), panels in [`src/components/decisions/`](../../apps/architecture-studio/src/components/decisions/). Tests: [`checks/impact.check.ts`](../../apps/architecture-studio/checks/impact.check.ts), [`checks/examiner.check.ts`](../../apps/architecture-studio/checks/examiner.check.ts), [`e2e/impact-examiner.spec.ts`](../../apps/architecture-studio/e2e/impact-examiner.spec.ts).

## Decision Impact Analysis

For a chosen outcome (approved, rejected, deferred, or sent back for revision) it shows what the repository says would be affected.

**The graph is explicit only.** An item is in the analysis because a record names the decision, or the decision names it: a traceability row, an ADR citation, a *Depends on* line, a task, a risk, a design review, a presentation Q&A row. Each item shows the reference that put it there, with file and line. Nothing is inferred by an AI.

| Group | Meaning |
|---|---|
| **Directly affected** | A record names this decision, or this decision names it |
| **Potentially affected** | Reached only through a decision that depends on this one (up to three steps, cycle-safe) |
| **Blocking** | What this decision rests on that is not yet settled, and what waits for it (requirements, tasks, reviews) |
| **Follow-up work** | What the action makes necessary, each with the repository fact that makes it so |
| **Possible rework** | Items already in the analysis that would have to be revisited on rejection or revision |
| **Missing references** | References that point at no record. Reported, never followed |
| **Cycles** | Dependency loops, shown as a closed path. Reported, never followed |

Items are grouped by what they are: requirements, decisions, security controls, sovereignty boundaries, data flows, components, infrastructure, cost, tasks, tests, risks, design reviews, slides and other documents. The category comes from where the citing document lives. It classifies a citation that exists and never creates one.

**Estimates are counts only.** The panel gives the number of records listed and, where the decision's own cost section states one, that text with its source. Effort, duration and cost are never estimated: no source in the repository sizes the work, and the panel says so.

**AI-suggested relationships** (`kind: "relationship"` in [`docs/architecture-studio/suggestions/`](../architecture-studio/suggestions/)) are shown in a separate block labelled *Unverified*, from both ends of the link. They are not counted, add nothing to the affected lists, and change no position. When a repository record later states the same link itself, the suggestion shows *Now explicit in the repository*.

**It changes nothing.** The panel names the status the action would lead to and states that only a review record merged through GitHub changes it.

## Architecture Examiner

*Challenge this decision* opens a short, layered view. The headline is the Examiner's position and the strongest argument against. Nine further sections are closed until opened: alternatives, pros and cons, hidden assumptions, reliability and failure, security and compliance, cost and operations, five panel questions, evidence needed to defend it, and a recommendation with its limits.

### What kind of statement each line is

Every line carries one of five labels, in words and not by colour alone.

| Label | Meaning |
|---|---|
| **Verified fact** | A mechanical fact about the repository: a status, a count, a missing reference |
| **Approved decision** | What an Approved record itself says |
| **Proposed interpretation** | What an unapproved record says, or a conclusion drawn by a stated rule |
| **Unverified assumption** | Something the decision depends on that no record has settled |
| **AI-generated** | From an AI, unreviewed, and never evidence |

### The position

A written rule, not a judgement and not an approval:

| Position | When |
|---|---|
| Not ready to defend | It rests on an unmade decision, cites a missing record, is in a cycle, recommends no option, or the record says its chosen option does not meet a criterion |
| Defensible with conditions | A covering design review is Blocked, a requirement still names an open clarification, or evidence is missing |
| Defensible on the record | None of the above is recorded |
| Not an architecture decision | The record is a stakeholder question or a regulatory claim |

A stakeholder clarification is shown as a question for the business. A regulatory claim is shown as needing a qualified person. Neither is presented as an option to approve, whatever any recommendation says.

### The five panel questions

Always exactly five, never repeated: first up to three from the programme's [question bank](../architecture/DEFENSE-QUESTION-BANK.md) that name this decision, then questions derived from gaps the record actually has, then general bank questions, then standing questions.

### The AI critic

The Studio cannot call the Copilot agents. So there are two parts.

1. **A prompt.** *Copy prompt for the critic* gives a ready request for the [`architecture-critic`](../../.github/agents/architecture-critic.agent.md) and [`principal-architect`](../../.github/agents/principal-architect.agent.md) agents in VS Code Copilot Chat. The instructions are fixed text. Repository text goes only inside a fenced data block whose boundary the text cannot forge, after instruction-like lines are removed.
2. **A committed record.** The agent's answer is saved as `docs/architecture-studio/examiner/<ID>.json` and merged by pull request. The Studio shows it only after checking every claim.

**Each claim must cite a repository path, a line, and a quote copied exactly.** The quote must sit at or just after the cited line. A claim with no citation, a missing file, a wrong line, a quote that is not in the file, or a mix of good and bad citations is shown as *Unsupported: not verified* in a separate block and is counted nowhere. A record with an unknown field, a status or approval field, a label other than `AI CHALLENGE`, or another decision's id is refused whole.

Two real records are committed: [ADR-0016](../architecture-studio/examiner/ADR-0016.json) (16 claims) and [D-010](../architecture-studio/examiner/D-010.json) (14 claims). Every claim in both verified against the files. They are unreviewed AI output, not evidence and not approvals.

To produce another: open the decision, copy the prompt, run it in Copilot Chat, save the JSON, open a pull request.

### Prompt injection

Source documents are data. Instruction-like text (ignore-instructions, role reassignment, system markup, reveal-the-prompt, mark-this-approved, run-this, send-the-secrets) is detected in every field the Studio shows or sends, and in AI records. It produces a warning, is removed from the prompt, and never changes a position, a count or a status. The detector is deliberately conservative: a sentence that merely mentions ignoring rules is also flagged. A flag is a warning only. No record in the repository currently triggers it.

## What was verified

| Area | Result |
|---|---|
| Unit tests, Impact (26) and Examiner (42): dependency detection, approve/reject/defer/revise, missing references, cycles, AI relationship labelling, unsupported claims, prompt injection, five questions, the five labels, nothing mutated | Pass |
| Browser tests, 43, against the real repository: references checked in the source files without the Studio's parser, counts equal API and screen, all 58 records analysed four ways, AI quotes re-checked independently, loading and error with retry, keyboard, axe, phone width, reduced motion, console quiet, writes refused | Pass |
| Real data | 58 records. No cycle and no missing reference exists in the repository. Examiner positions: 20 Not ready to defend, 7 Defensible with conditions, 1 Defensible on the record, 30 Not an architecture decision. No source text trips the injection detector |
| Latency, local, warm | 0.3 to 0.6 s per request |
| Latency, local, cold | About 5 s for the first impact request after a start, because it also builds the Work Queue. The panel shows a loading state meanwhile |

Screenshots: [`screenshots/`](screenshots/) (`impact-*`, `challenge-*`).

A defect found while testing: every "on GitHub" commit link in the file history pointed at `/commit/` with no address or hash. It was introduced with the Decision Workspace and is fixed, with a test that checks each link is a full commit URL.

## Limits

- The Examiner is rule-based. It reports what the repository records and does not judge whether it is true.
- The AI part is committed records only. The Studio does not run the critic, and nothing is generated live.
- Only two decisions have a committed AI challenge. The rest show the rule-based dossier and the prompt.
- No effort, schedule or cost is estimated.
- Impact reaches decisions through explicit citations, three steps deep. A relationship nobody has written down is not found. That is by design: an AI may suggest it, and it stays unverified until a record says so.
- The browser tests are not part of CI. CI runs the typecheck, unit tests and build.
