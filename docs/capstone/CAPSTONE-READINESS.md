# Capstone readiness

A one-page statement of where the repository stands against the FY27 Azure Master Architect Capstone Assessment Guide, written for the person who has to stand in front of the panel. **This is not a score.** The guide scores live (Sections A, B, C) and through two reviewers (Section D); nothing in a repository can predict those marks. What can be said is what evidence exists, what is missing, and where the guide's floors make a gap dangerous.

Detail: [FORENSIC-AUDIT](FORENSIC-AUDIT.md) · [RUBRIC-TRACEABILITY](RUBRIC-TRACEABILITY.md) · [CRITICAL-GAPS](CRITICAL-GAPS.md) · [PRIORITIZED-BACKLOG](PRIORITIZED-BACKLOG.md) · [EVIDENCE-REGISTER](EVIDENCE-REGISTER.md).

## The one-paragraph answer

The repository is an unusually honest, well-tested **coding-agent governance harness** and a set of **provisional, unaccepted designs**. It is not a solution: there is no application, no AI agent for the business, no Azure resource, no measured number about the use case, no narrative, no demo and no thought-leadership artifact yet. The strongest assets are the evidence discipline and the trade-off reasoning (A2, C3 honesty, B4 preparation). The weakest are the implementation (A4 to A7), the numbers (B7), the demo (B3) and the artifact (D1 to D3). The most dangerous single fact, given the guide's floors, is that Section A cannot reach its minimum without something working, and that a missing artifact is an "incomplete" that no total can offset.

## Where the evidence stands by section

| Section | Points | What exists | What is missing | Floor exposure |
|---|---|---|---|---|
| **A. Technical Excellence** (live) | 35 | Strong architecture options and trade-offs; a tested, validated harness; executable contracts; honest gap disclosure; a security-minded design | A working solution; any AI evaluation; any measurement; a stated threat model; an accepted architecture; VS Code verification | **High** for A4, A5, A6, A7; Medium for A1, A3; Low for A2 |
| **B. Communication & Executive Presence** (live) | 35 | Defence material with known-versus-assumed answers; a polished README; a documentation set | A narrative with a recommendation; a two-minute demo; use-case numbers; a deck; a navigable documentation spine; rehearsal | **High** for B1, B3, B6, B7; Medium for B2, B4, B5 |
| **C. Consultative & Stakeholder Skills** (live) | 15 | A record of conceding to reviewers; a risk-first habit; business framing text | A recommendation to defend; a quantified value and cost of inaction; stakeholder map; rehearsal | Medium |
| **D. Thought Leadership Artifact** (two reviewers before panel day) | 15 | A public MIT repository that reproduces from a fresh clone; real lessons with evidence | A chosen and finished artifact; discoverability; a submission; employer publishing confirmation; the deadline | **High** for D3; Medium for D1, D2; **floor risk if nothing is submitted** |

## What is demonstrated, and what needs people

| Kind | Items |
|---|---|
| **Demonstrated technical evidence** (re-runnable now) | 770 of 770 tests in a clean clone, twice; all validators; CI green; deterministic evaluation of the harness (53 pass, 3 genuine FAIL, 1 blocked, 16 pending); hook probes with raw output; design gate computing Blocked; readiness computing NOT-READY; Bicep scaffold compiles |
| **Needs a live panel** | B1 to B5, C1 to C3, the recovery half of B3, A2 and A7 under challenge |
| **Needs human judgment or decision** | Deciders and assumptions (B-02), the freeze decision (B-11), the recommendation, the artifact's insight, whether Azure is used at all |
| **Needs publication or submission** | D3 in full, most of D2, the publishing and IP confirmation |
| **Needs something to be built first** | A4 to A7, B3, B7, C1 numbers |

## The top ten changes, by capstone impact

1. **B-01** Build one thin, working, end-to-end vertical slice (local first).
2. **B-09** Choose, finish and submit the thought-leadership artifact; confirm the deadline.
3. **B-02** Decide by assumption: convert the 37 open decisions into defended case-study assumptions and accept the solution ADRs.
4. **B-03** Numbers pack: measured, sourced and assumed figures, each tagged.
5. **B-06** Narrative, two-minute demo, fallback and rehearsal kit.
6. **B-04** AI evaluation across at least two models, with failure modes.
7. **B-05** Solution threat model and shipowner isolation design, with AI risks.
8. **B-07** Discovery brief and value model.
9. **B-12** Documentation spine and stale-claim cleanup.
10. **B-08** Hardening quick wins from the probes, plus secret scanning, push protection and branch protection.

Ranking logic: the first five each move several criteria or a floor; six to eight each close one named gap that the guide's Excellent descriptor requires; nine and ten remove the cheapest ways a panelist can challenge credibility. Not in the top ten but close: mock panels (B-15), VS Code live verification (B-10), contract completeness (B-16).

## Direct answers to the ten questions that decide the conversation

| Question | Short answer |
|---|---|
| Are the 12 agents usable in VS Code? | Format-valid and CLI-demonstrated; VS Code use is owner-reported only |
| Are permissions enforced or documented? | Enforced in code for named agents; weaker for the default session; not enforced at OS, GitHub or Azure layers |
| Can the hook be bypassed? | Yes: 15 candidate gaps in the default session, 4 for named agents, all from harmless simulation |
| Does the engine resume interrupted work? | It resumes state and tells you what to do next; it does not resume the work |
| Can a model falsify evidence or approval? | Not approvals (none exist); evidence claims are free text and records are unsigned |
| Are the 99 requirements tied to executable acceptance tests? | No product tests exist; 29 requirements have passing harness or fixture tests |
| Why are 37 decisions open? | The owner deferred them; 28 need facts or legal readings only others can supply; 9 involve an architecture choice |
| Is the intermittent failure understood? | No; it did not recur in at least six full runs since; a timing hypothesis is untested |
| Do the certificate and lineage contracts suffice? | No: no signature, key identity, anchor, revocation or effective period |
| Is the harness over-engineered relative to the deliverable? | Yes: about 13,600 lines of harness code and tests against about 250 lines of solution code |

## What the audit needs from you (none of this was assumed)

1. **Panel date and the artifact deadline.** The guide says the artifact is due no later than two weeks before panel day and goes to the panel five business days before.
2. **Masterclass attendance.** The guide lists the number of required masterclasses as a floor; it is not visible in the repository.
3. **Which artifact format you intend** (reference implementation, white paper, blog post, other), and whether the repository is meant to be that artifact or the capstone build.
4. **Employer publishing and IP rules** for the public repository, which carries your Microsoft email in its commit history.
5. **Whether Azure is in scope for the capstone demo** or whether a local, offline slice is acceptable to you. That decision changes B-01, B-03 and B-04.
6. **Whether discovery involved real stakeholders** or is a case-study reading, so C1 and D1 claims are accurate.

## What this audit did not do

It did not build the application, change any control, push, publish, change a GitHub setting, sign in to Azure or GitHub MCP, or delete anything. It added only these six documents, a probe script and its raw outputs, and evidence records, on the branch `capstone/rubric-enhancement`.
