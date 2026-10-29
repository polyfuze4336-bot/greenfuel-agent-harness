# Prioritized backlog

Ordered by **capstone impact**, not engineering novelty. Nothing here is started: the audit stops before implementation. Each item names the rubric criteria it moves, its acceptance test, its dependencies and what needs your approval. Priorities: **P0** closes a floor risk or caps several criteria; **P1** closes a single high-weight gap; **P2** improves a live criterion; **P3** is hygiene.

"Mode": **build** = an agent can do it in the repository once approved; **owner** = needs your decision, fact or approval; **live** = only demonstrated in front of people; **publish** = needs an external action.

## Top ten changes, ranked by capstone impact

| Rank | Item | Why it ranks here | Criteria | Priority |
|---|---|---|---|---|
| 1 | **B-01 Build one thin, working, end-to-end vertical slice** (edge capture with an offline period, jurisdiction cell, deterministic calculation, tamper-evident certificate, quality-manager approval gate, shipowner-isolated compliance answers), local first, Azure only with approval | Without it A4 has nothing, A5 to A7 have little, and B3 and B7 have no outcome to show. It is the one change that moves five Section A criteria and two Section B criteria at once | A4, A5, A6, A7, B3, B7 | P0 |
| 2 | **B-09 Choose, finish and submit the thought-leadership artifact** and confirm the deadline | A missing artifact is "incomplete", a floor failure that no total can offset; Section D is 15% and is scored before panel day. The deadline is unknown | D1, D2, D3, floor | P0 |
| 3 | **B-02 Decide by assumption**: convert the 37 open decisions into labelled, defended case-study assumptions; take decisions on DES-0001 and DES-0002 and accept the solution ADRs | The repository currently refuses to recommend; B1 and C3 reward a defended recommendation, and A1 and A2 need an accepted architecture | A1, A2, B1, C3, C1 | P0 |
| 4 | **B-03 Numbers pack**: measured latency and throughput from the slice, cost per delivery from dated, sourced unit prices and declared volume assumptions, and a value-at-stake scenario | The guide says assertions without evidence cap B7 at 3 and names cost per transaction, latency and evaluation scores | B7, A5, C1 | P0 |
| 5 | **B-06 Narrative, two-minute demo, fallback and rehearsal kit** | Section B is 35% and is scored live; the guide says the commonest loss is presenting the build instead of an argument | B1, B2, B3, B5, B6 | P0 |
| 6 | **B-04 AI evaluation**: at least two models compared on cost, latency and quality over a labelled set, with metrics and a failure-mode register | A6 cannot be scored above "narrow" without a measured comparison; the production-agent tests are all pending today | A6, A7, A3 | P1 |
| 7 | **B-05 Solution threat model and isolation design**, including AI risks, with each threat linked to a requirement and a test | A3 Excellent requires a stated threat model; none exists for the solution | A3, A1 | P1 |
| 8 | **B-07 Discovery brief and value model**: stakeholders, constraints, success measures with definitions and baselines (assumed where unknown), cost of inaction | C1 asks for the value at stake and the cost of inaction; the business case is explicitly not financial | C1, B7, B2 | P1 |
| 9 | **B-12 Documentation spine and stale-claim cleanup**: one "start here", a one-page architecture, an executive summary, fixes for the three stale statements, a relabelled coverage table | B6 asks for documentation that is "complete and navigable"; 150 Markdown files without a spine fail the navigable half | B6, D2, C3 | P1 |
| 10 | **B-08 Hardening quick wins from the probes**, plus enabling secret scanning and push protection and applying branch protection | Cheap, and it removes the easiest challenge a security-minded panelist can make against A3 | A3, A7 | P1 |

Next after the top ten: **B-15** mock panel (B4, C2, C3, B5), **B-10** VS Code live verification (A7, B3), **B-16** contract completeness (A1, A3), **B-13** flaky-test closure, **B-11** harness freeze (should be decided first, at no cost), **B-14** deduplication.

## Recommended order of work

1. **Now, no approval needed:** B-11 (decide to freeze the harness), B-02 draft (assumptions list for you to accept), B-06 narrative draft, B-07, B-12 cleanup that is only documentation.
2. **Your decisions:** name yourself decider for DES-0001 and DES-0002; accept or amend the assumptions; raise the phase by ADR (HC-11); confirm the panel date and artifact deadline; confirm employer publishing and IP rules.
3. **Build:** B-16 and B-01 slice, B-08 hardening, B-05 threat model, B-03 and B-04 once the slice runs.
4. **Land it:** B-09 artifact, B-06 demo rehearsal, B-10 VS Code run, B-15 mock panel.

## Backlog items

### B-01 Thin end-to-end vertical slice (P0, build, owner)
- **Scope (proposed, to be cut down by you):** S1 unify the event and lineage models and complete the certificate contract (B-16); S2 deterministic emissions calculation with a versioned method and effective period; S3 certificate record with signature and a quality-manager approval gate that a model cannot satisfy; S4 one business agent (Customer Compliance, grounded, shipowner-isolated) and the Delivery Evidence flow; S5 optional Azure non-production deployment.
- **Criteria:** A4, A5, A6, A7, B3, B7.
- **Acceptance test:** (a) one command runs the whole slice offline in CI and passes; (b) a scripted offline-then-sync delivery ends with a verifiable certificate; (c) a tampered certificate is detected; (d) a filing without human approval is refused; (e) a cross-shipowner question is refused with a logged reason; (f) the demo script runs in under two minutes.
- **Dependencies:** B-02 (assumptions), B-16, an ADR raising the phase (HC-11). Azure steps also need T32, T33, T36 and signed approvals; none is required for S1 to S4.
- **Needs your approval:** raising the phase. No Azure deployment is implied.

### B-02 Decide by assumption (P0, owner then build)
- **What:** write one Accepted ADR listing every open decision as an explicit assumption with an owner, a "valid until" trigger and an "if wrong" consequence; mark the eight items that involve a regulatory or certification claim (register kind D) as "assumed for design, needs verification by counsel"; name a decider; run the design gate on DES-0001 and DES-0002; accept ADR 0004 and ADR 0015 if the gate allows.
- **Criteria:** A1, A2, B1, C3, C1.
- **Acceptance test:** every one of the 37 decisions has a state of Decided, Assumed (with consequence) or Deferred (with reason); the gate computes Approvable or states which Must requirements still block; no assumption contains an unsourced legal or standards claim stated as fact.
- **Dependencies:** your decisions (TODO T2, T3, T37).

### B-03 Numbers pack (P0, build, owner)
- **What:** `docs/capstone/NUMBERS.md` and a reproduction script. Every number is tagged **measured** (from the slice), **sourced** (dated public source such as the Azure Retail Prices API) or **assumed** (owner and range). Cost per delivery, cost per certificate, latency distribution of ingest and of calculation, evaluation scores, a value-at-stake scenario.
- **Criteria:** B7, A5, C1.
- **Acceptance test:** a check fails if any figure in the capstone documents lacks a tag; measured values are reproduced by one command; assumed values appear only with an owner and a range.
- **Dependencies:** B-01 for measured values; B-02 for assumptions. HC-12 is respected, not relaxed.

### B-04 AI evaluation (P1, build)
- **What:** a labelled set for the compliance and evidence tasks; metrics: groundedness and citation accuracy, correct refusal across shipowners, resistance to injected instructions in documents, rate of invented values (must be zero), correct delegation of arithmetic to the deterministic service; at least two models compared on quality, latency and cost; a documented failure-mode register.
- **Criteria:** A6, A7, A3.
- **Acceptance test:** a committed evaluation run table with thresholds; the offline subset runs in CI from recorded responses; the 16 pending production-agent tests are converted to executable or re-justified.
- **Dependencies:** B-01 (the agent), model access, B-05 (what counts as a failure).
- **Needs your approval:** any Azure OpenAI or other model access.

### B-05 Solution threat model and isolation design (P1, build)
- **What:** trust-boundary diagram; threats by boundary (including edge tampering, certificate forgery, shipowner leakage, document-borne prompt injection, grounding failure, model data leakage); mitigations linked to requirements and tests; shipowner isolation design (HC-02).
- **Criteria:** A3, A1.
- **Acceptance test:** every threat has a mitigation, a requirement ID and a test ID (executable, or pending with a stated reason); a check fails on an unmapped threat; red-team scenarios RT-01 to RT-11 run against the slice where applicable.
- **Dependencies:** B-02, B-01.

### B-06 Narrative, demo and rehearsal kit (P0, build then live)
- **What:** a storyline (problem, stakes, options, recommendation, cost, risks) with every claim linked to an evidence ID; an executive summary; a demo script that shows the outcome in under two minutes, a "if it breaks" script, a recorded fallback, and a timed run sheet; a known, assumed and unknown cheat-sheet.
- **Criteria:** B1, B2, B3, B5, B6, C3.
- **Acceptance test:** the demo runs offline in under 120 seconds three times in a row; the narrative has no claim without an evidence link; a timed human rehearsal finishes inside the slot with time for questions (live).
- **Dependencies:** the draft can start now; the demo needs B-01.

### B-07 Discovery brief and value model (P1, owner, build)
- **What:** stakeholder map (roles, interests, constraints, what each needs to see), success measures with definition, unit, baseline (assumed where unknown) and measurement source, a cost-of-inaction scenario, ten discovery questions with answers or stated assumptions.
- **Criteria:** C1, B7, B2.
- **Acceptance test:** each KPI has all five fields; the scenario model reproduces from stated parameters; every parameter is tagged as in B-03.
- **Dependencies:** B-02.

### B-08 Hardening quick wins from the probes (P1, build, owner)
- **Build:** add negative tests for every probe class that passed through (backtick-escaped command names, base64 pipe to a shell, `gh auth token`, reads of `.azure`, `.config/gh`, `.kube`, `.docker` credential stores by shell or `view`, default-session edits of `.vscode/`, `package.json`, `memory/`, agent files and `.git/hooks`); fix the policy; add a claim-to-command check or a structured claim field to the evidence recorder, retain the full output file under a hash, and chain the records.
- **Owner approvals:** enable secret scanning and push protection on the public repository; apply branch protection (TODO T14).
- **Criteria:** A3, A7.
- **Acceptance test:** the probe script reports zero candidate gaps for the expected rows; `gh api` shows scanning enabled; `verify-github-protection` reports protected; the full suite passes.
- **Dependencies:** none.

### B-09 Thought-leadership artifact (P0, owner, publish)
- **What:** decide the format. The guide treats a reference implementation (working code with a README covering purpose, architecture, setup and known limitations) as equal to a white paper (about 2,000 or more words, structured and sourced) or a blog post (about 800 or more words, published or formally submitted). A deck alone is not sufficient. Recommended: the repository as the reference implementation, with an explicit README spine, plus a short written piece stating the insight and the engagement evidence in your own words.
- **Criteria:** D1, D2, D3 and the submitted-artifact floor.
- **Acceptance test:** the artifact exists in a format the guide accepts; submission proof exists; repository topics and a release tag are set; README sections are present; reviewers have the link at least two weeks before panel day.
- **Dependencies:** the panel date; employer publishing and IP confirmation; B-12. The guide says the insight, the engagement evidence and the recommendation must be yours and that you will be examined on them.
- **Needs your action:** the submission and the publishing approval.

### B-10 VS Code live verification (P2, owner, live)
- **What:** run the end-to-end scenario from the repository root in VS Code with the twelve agents, in a trusted folder; record what happens (TODO T38, T8, T9, T12).
- **Criteria:** A7, A4, B3.
- **Acceptance test:** each agent invoked at least once; the canary denial seen; a write attempted by a delegated read-only agent is blocked; observations committed as a live-test record.
- **Dependencies:** none. The assistant cannot observe VS Code from this environment.

### B-11 Freeze harness features (P2, owner)
- **What:** an ADR stating the harness is complete for the capstone: demonstrate, fix, document, do not extend.
- **Criteria:** A4, B1, C3.
- **Acceptance test:** ADR Accepted; no backlog item adds a harness component.

### B-12 Documentation spine and stale-claim cleanup (P1, build)
- **What:** `docs/capstone/README` with a reading order; a one-page solution architecture (context and containers, scale unit, failure domains); a glossary; correct the three stale statements (README verification line, HARNESS-ARCHITECTURE ADR status, AGENTS.md `infra/` exception); relabel "tested and passing" as "passing in the harness or on a fixture"; move dated history out of STATE.
- **Criteria:** B6, D2, C3, A1.
- **Acceptance test:** a reader test: ten canonical questions answered within two clicks of the README; a checker compares ADR status mentions with the ADR files; links and anchors resolve.
- **Dependencies:** none for the cleanup; the architecture page depends on B-02.

### B-13 Close the intermittent failure (P2, build)
- **What:** make the recorder keep failing-test names (TODO T41); run the suite in place 20 times, including under CPU load; move the repository out of the synchronised folder (T5).
- **Criteria:** A4, D2.
- **Acceptance test:** 20 consecutive passes in place, or a root cause with a fix and a regression test.

### B-14 Deduplicate helpers (P3, build)
- **What:** one shared redaction and one shared JSON and write helper in `harness/lib`, without behaviour change.
- **Acceptance test:** all existing tests pass unchanged; the number of redaction implementations is one.

### B-15 Mock panel and Q&A rehearsals (P2, live)
- **What:** three rehearsals with peers scoring against the guide: restate the challenge before answering, answer past the prepared material, separate known from assumed, say "I don't know, here is how I would find out".
- **Criteria:** B4, C2, C3, B5.
- **Acceptance test:** recorded peer scores against the rubric descriptors and a list of concessions made.
- **Dependencies:** B-06.

### B-16 Contract completeness (P1, build, owner)
- **What:** add signature, key identifier, external anchor and revocation to the certificate contract, bind it to the evidence package hash, add effective periods for methodology and factors and the time rules to the lineage contract (roadmap R16, ADR 0013), and merge the lineage and ingestion event models.
- **Criteria:** A1, A3, A4.
- **Acceptance test:** EVAL-PRC-DAT-005 and DAT-006 pass in a committed run; certificate tamper, wrong-signer and revoked-certificate fixtures are detected; one event model remains.
- **Dependencies:** B-02 (D-013 as an assumption).

## Approvals needed before building

| Approval | Why | Items |
|---|---|---|
| Raise the phase by an Accepted ADR | HC-11 forbids application code until then | B-01, B-16, B-04 |
| Name yourself decider for the designs (TODO T3, T37) | The gate refuses approval without a named human | B-02 |
| Enable secret scanning and push protection; apply branch protection | Remote settings change | B-08 |
| Model access for evaluation | Any Azure OpenAI or other model service needs your account and approval | B-04 |
| Azure subscription, read-only sign-in, then deployment | Deployment is deferred (TODO T36); the slice does not need it | optional S5 of B-01 |
| Publishing and employer IP confirmation | External action | B-09 |
