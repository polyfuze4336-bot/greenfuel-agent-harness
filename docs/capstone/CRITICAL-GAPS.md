# Critical gaps

Every gap found by the [forensic audit](FORENSIC-AUDIT.md), ranked by what it does to the capstone, not by engineering interest. Severity: **Critical** (can fail a floor or caps several criteria), **High**, **Medium**, **Low**. "Mode" says how the gap is closed: **build** (an agent can do it in the repository), **owner** (needs your decision, fact or approval), **live** (only shown in front of the panel), **publish** (needs an external action). No official score is implied.

Rubric floors to keep in view (from the guide): each section must reach 60% (A 21 of 35, B 21 of 35, C 9 of 15, D 9 of 15); **no individual criterion may be scored 1**; the thought leadership artifact must have been submitted; required masterclasses attended. A floor failure is not offset by a high total.

| ID | Gap | Severity | Criteria | Evidence | Mode | Closed by |
|---|---|---|---|---|---|---|
| G-01 | **No working solution end to end.** No `src/`, no business agent, no Azure resource, no deployed or even local vertical slice | Critical | A4, A5, A6, A7, B3, B7 | Audit 2.11; acceptance report capability matrix; readiness NOT-READY | build, owner | B-01 |
| G-02 | **No AI solution and no model evaluation of any business agent.** Model choice is a candidate list; the 16 production-agent tests are PENDING; the evaluation framework measures the harness, not an AI solution | Critical | A6, A7, A3 | Reference architecture "Model use" row; evaluation catalogue; audit 2.12 | build | B-04, B-05 |
| G-03 | **No numbers the audience can act on.** No latency, throughput, cost per delivery, evaluation score or value at stake. The rubric says assertions without evidence cap B7 at 3 | Critical | B7, A5, C1 | COST-AND-CAPACITY (method, no figure); BUSINESS-CASE (not financial); HC-12 forbids unsourced figures | build, owner | B-03, B-07 |
| G-04 | **No decided solution architecture and no recommendation.** DES-0001 and DES-0002 compute Blocked; ADR 0004 and ADR 0015 Proposed; 0 Accepted solution ADRs; the register says "no option is recommended" | Critical | A1, A2, B1, C3 | Gate output; ADR list; DECISION-REGISTER header | owner, build | B-02 |
| G-05 | **Thought-leadership artifact not chosen, finished or submitted.** Missing artifact is an "incomplete", which blocks graduation; due two weeks before the panel; no topics, release, post or submission exists | Critical | D1, D2, D3, floor | Repo metadata (no topics, no release); no artifact document | owner, publish | B-09 |
| G-06 | **No narrative, deck, 2-minute demo or rehearsal material.** Section B (35 points) is scored live; the repository has catalogues, not an argument | Critical | B1, B2, B3, B5, B6 | No deck; demos are harness feature tours | build, live | B-06 |
| G-07 | **No stated threat model for the solution.** Harness threats are documented; the solution's trust boundaries, abuse cases and AI risks (grounding, injection, leakage) are not | High | A3 | `git grep -i "threat model"` finds only SEC-013 text and one table cell | build | B-05 |
| G-08 | **Shipowner isolation and agent identity are undesigned.** HC-02 Unresolved; D-015, D-027 open; no tenant model | High | A3, A1 | RV-0001, RV-0002 hard-constraint screens | owner, build | B-02, B-05 |
| G-09 | **Hook gaps in the default session**: backtick-escaped `az`, base64 pipe to shell, reads of cloud and GitHub credential stores, `gh auth token`, and edits to `.vscode/settings.json`, `package.json`, `memory/`, agent files and `.git/hooks` pass without even a prompt | High | A3, A7 | EV-0062 and `output-session.txt` (15 candidate gaps) | build | B-08 |
| G-10 | **Named agents can read home credential stores** (`.azure`, `.config/gh`, `.kube`) through the `view` tool; the secret-path class does not cover them | High | A3 | EV-0063, EV-0064 | build | B-08 |
| G-11 | **No OS isolation, branch protection not applied, secret scanning and push protection disabled** on a now-public repository | High | A3 | EV-0060; `gh api` security settings | owner | B-08 |
| G-12 | **VS Code usability of the 12 agents unproven.** Delegation shown in the CLI only; VS Code behaviour owner-reported; hooks are labelled Preview in current docs | High | A7, A4, B3 | TODO T8, T9, T12, T18, T38 | owner, live | B-10 |
| G-13 | **Certificate and lineage contracts are insufficient**: no signature, key identity, anchor, revocation, evidence-package binding or scheme schema; no effective period or time-order rule (two genuine FAILs); two incompatible event models | High | A1, A3, A4 | Audit 2.9; EVAL-PRC-DAT-005, DAT-006 | build, owner | B-02, B-01 |
| G-14 | **37 decisions open with no assumption strategy.** 28 need facts or legal readings the repository cannot invent; none has been converted into a labelled, defended assumption | High | C1, C3, A1 | DECISION-REGISTER (37 Open) | owner | B-02 |
| G-15 | **Discovery is not quantified**: no stakeholder map with interests, no success measures with baselines, no cost of inaction | High | C1, B7 | BUSINESS-CASE; D-034 open | owner, build | B-07 |
| G-16 | **Overengineering relative to the deliverable.** About 13,600 lines of harness code and tests, 157,000 words of Markdown, 13 harness ADRs, against about 250 lines of solution code and 0 accepted solution ADRs | High | A4, B1, C3 | Audit 2.10 | owner (decision to freeze) | B-11 |
| G-17 | **Documentation volume without a spine.** 150 Markdown files, a 3,900-word STATE log, overlapping defence documents, no "start here" for a reviewer, stale statements | High | B6, D2 | Audit sections 3 and 4 | build | B-12 |
| G-18 | **Stale or contradictory statements**: README verification line, HARNESS-ARCHITECTURE ADR status, AGENTS.md omits the `infra/` exception | Medium | B6, D2, C3 | Audit section 3 | build | B-12 |
| G-19 | **Evidence records are weaker than they look.** A claim is free text not tied to the command; records are unsigned and unchained; the full output is hashed but only the last 2,000 bytes are kept, so the hash cannot be re-checked; memory writers are self-declared | Medium | A3, B7, C3 | Audit 2.5 | build | B-08 |
| G-20 | **Intermittent test failure (EV-0054) unexplained** | Medium | A4, D2 | Audit 2.8 | build | B-13 |
| G-21 | **"Tested and passing" for 29 requirements invites over-reading.** They are harness and contract tests on synthetic fixtures | Medium | A4, C3, B4 | REQUIREMENTS-COVERAGE | build | B-12 |
| G-22 | **No real engagement evidence identified for D1 and C1.** The guide asks for synthesis grounded in real engagement evidence; the repository is a case-study build | Medium | D1, C1 | none in repository | owner | B-09, B-07 |
| G-23 | **Duplicated code** (five redaction implementations, helpers) | Low | A1, D2 | Audit section 4 | build | B-14 |
| G-24 | **Owner prerequisites unknown to the repository**: panel date, artifact deadline, masterclass count, employer publication and IP approval | High | floors, D3 | not in repository | owner | B-09 |

## Gap detail for the five that matter most

### G-01 and G-02: there is nothing to run, and no AI to evaluate
Criteria A4 to A7 and B3 all ask for something working. The honest disclosure of gaps is already strong (it is exactly what A4 Excellent asks for on the "disclosed proactively" half), but the first half, "all required capabilities working end to end", has no content. A demo that breaks is scored as recovery (B3); a demo that does not exist is scored as absent, and the guide says the build is marked down in A4 only for a genuine implementation gap, which is what this is.

### G-03: numbers
HC-12 (no unsourced figure) is a good rule that now works against the capstone. The way through is not to relax it but to give figures a source: a **measured** value from the slice, a **sourced** unit price (dated), or a **declared assumption** with an owner and a range. That makes every number defensible in Q&A (B4) and visible as a number (B7).

### G-04 and G-14: the posture problem
The repository is built to refuse to decide. A real engagement with missing facts should behave that way; a capstone panel scores whether you "make a recommendation and defend it" (C3) and whether the argument has a recommendation at the end (B1). The decision register can be turned into a short list of explicit, labelled case-study assumptions, each one decided by the architect, each with "if wrong" consequences. The three items that are legal claims must still say "assumed, needs verification by counsel".

### G-05 and G-24: the deadline nobody can see
The artifact is due **no later than two weeks before panel day**, reviewed by two reviewers, and given to the panel five business days before. The panel date is not in the repository. Until it is known, every other priority is unsafely ordered.

### G-09 to G-11: the controls are real but the claim is too broad
The honest sentence is: *named agents are held by a hook in code, the default session by a weaker screen, and nothing is enforced at the operating-system, GitHub or Azure layers yet.* The probes show where the screen leaks, and most fixes are a few lines of policy. The two zero-effort fixes (enable secret scanning and push protection; apply branch protection) need your approval because they change remote settings.
