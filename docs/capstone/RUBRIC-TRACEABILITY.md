# Rubric traceability

Traceability of the repository against every criterion of the FY27 Azure Master Architect Capstone Assessment Guide (`AMA_Capstone_Rubric_Participants.pdf`, read in full). The "Excellent" wording is quoted from the guide. **No official score is assigned.** Evidence IDs refer to [EVIDENCE-REGISTER](EVIDENCE-REGISTER.md); gap IDs to [CRITICAL-GAPS](CRITICAL-GAPS.md); backlog IDs to [PRIORITIZED-BACKLOG](PRIORITIZED-BACKLOG.md).

## How to read this document

**Assessment mode** says what kind of evidence can ever satisfy the criterion:
- **T**: technical evidence that exists in or can be produced in the repository and re-run.
- **L**: scored live by the panel; the repository can only prepare you.
- **H**: needs human judgment or action (a decision, a rehearsal, a conversation).
- **P**: needs publication or submission outside the repository.

**Evidence now** is a qualitative label, not a score: *Demonstrated* (a re-runnable test or artifact exists), *Documented* (a document exists, nothing runs), *Partial*, *Thin*, *None*.

**Floor exposure** relates to the guide's rules (section minimums, no criterion scored 1, artifact submitted): *High* means the current repository gives a panelist little to credit and a descriptor at the lowest level is a realistic outcome; *Medium*; *Low*.

## Summary

| ID | Criterion | Mode | Evidence now | Floor exposure | Main gap | Backlog | Priority |
|---|---|---|---|---|---|---|---|
| A1 | Architecture, modularity & scalability | T | Documented, partly demonstrated | Medium | no accepted architecture, no scale path | B-02, B-12, B-16 | P0 |
| A2 | Trade-off reasoning & design patterns | T, L | Demonstrated (strongest area) | Low | alternatives exist; none accepted as decisions | B-02 | P0 |
| A3 | Security, compliance & responsible AI | T | Partial | Medium | no solution threat model; hook gaps; AI risks untested | B-05, B-08 | P1 |
| A4 | Implementation completeness | T | Thin for the solution; strong for the harness | **High** | no working solution | B-01 | P0 |
| A5 | Operations: observability, reliability, performance & cost | T | Documented | **High** | nothing instrumented or measured | B-01, B-03 | P1 |
| A6 | AI solution design & evaluation | T | Thin | **High** | no AI solution, no model comparison | B-04 | P1 |
| A7 | Agentic autonomy & orchestration | T, L | Partial (coding harness only) | **High** | no autonomous business agent; VS Code unproven | B-01, B-10 | P1 |
| B1 | Narrative structure & argument | L, H | None | **High** | no narrative; no recommendation | B-06, B-02 | P0 |
| B2 | Audience calibration & register | L, H | Thin | Medium | one register throughout the documents | B-06, B-07 | P2 |
| B3 | Demo & executive hook | L | Thin | **High** | no outcome demo | B-06, B-01 | P0 |
| B4 | Q&A composure & depth under challenge | L, H | Partial (defence material) | Medium | rehearsal not done; material is strong | B-15 | P2 |
| B5 | Delivery craft: pace, presence & time discipline | L | None | Medium | cannot be evidenced in a repository | B-15, B-06 | P2 |
| B6 | Written communication: deck & capstone documentation | T, H | Partial | **High** | no deck; documentation not navigable | B-12, B-06 | P1 |
| B7 | Use of evidence & data storytelling | T, L | Thin | **High** | no use-case numbers | B-03 | P0 |
| C1 | Discovery & business framing | L, H | Documented | Medium | value and cost of inaction not quantified | B-07 | P1 |
| C2 | Active listening & disagreement navigation | L | None | Medium | behaviour only | B-15 | P3 |
| C3 | Influence & intellectual honesty | L, H | Demonstrated honesty; no recommendation | Medium | refuses to recommend | B-02, B-06 | P0 |
| D1 | Substance & originality | P, H | Partial | Medium | artifact not chosen; originality and engagement evidence to articulate | B-09 | P0 |
| D2 | Craft & publish-readiness | P, H | Partial | Medium | needs an edit pass, citations and a README spine | B-09, B-12 | P1 |
| D3 | Dissemination & reach | P | Thin | **High** | public, but no topics, release, post or submission | B-09 | P0 |

---

## Section A: Technical Excellence

### A1. Architecture, modularity & scalability
- **Excellent expects:** "Clear, documented architecture; components decoupled with defined contracts; scaling path and failure domains explicit"
- **Mode:** T.
- **Evidence now:**
  - A provisional reference architecture ([AZURE-REFERENCE-ARCHITECTURE](../azure/AZURE-REFERENCE-ARCHITECTURE.md)): a jurisdiction cell, candidate services evaluated (16), a Mermaid diagram, the five business agents placed.
  - Two design records with options, trace tables and failure-mode tables ([DES-0001](../architecture/designs/DES-0001-delivery-measurement-storage-topology.md), [DES-0002](../architecture/designs/DES-0002-evidence-ingestion-subsystem.md)).
  - Defined contracts, executable: ingestion contract and tests (EV-0048), candidate lineage, methodology and certificate validators.
  - A non-deployable Bicep scaffold of 8 modules that compiles (EV-0045).
  - The jurisdiction cell is a natural scale unit and failure domain.
- **Missing:** an accepted target architecture (both designs Blocked; ADR 0004 and 0015 Proposed); a one-page architecture a panel can read; a stated scaling path (no volumes, D-032, so scale dimensions are not even named as parameters); failure domains stated for the whole solution rather than for ingestion only; contracts for the other four business capabilities; one event model rather than two.
- **Risk:** the panel asks "how does it scale and what fails together?" and the answer is "no figure exists". Medium: the structure is strong, the commitment is missing.
- **Remediation:** B-02 accepts the designs by assumption; B-12 adds a one-page context and container view naming the jurisdiction cell as the scale unit and failure domain, the scale dimensions as parameters with declared assumed ranges, and an index of contracts; B-16 unifies the event model.
- **Acceptance test:** every container in the diagram has a contract file, an ADR and a failure-domain row; a check fails on a container without them; the scaling section lists dimensions, assumed ranges (tagged assumed) and what breaks first.
- **Dependencies:** B-02, B-16.
- **Priority:** P0.

### A2. Trade-off reasoning & design patterns
- **Excellent expects:** "Patterns chosen deliberately; names the alternatives considered and why they were rejected"
- **Mode:** T, L (defence under challenge is live).
- **Evidence now:**
  - DES-0001 (options A to E) and DES-0002 (options A to D) with a comparison table, tradeoffs TD-001 to TD-004 and assumptions; rejected options are tied to a requirement or hard constraint (A rejected for HC-07, central store for HC-01).
  - A ten-perspective review and a hard-constraint screen (RV-0001, RV-0002) and [ARCHITECTURE-DEFENSE](../acceptance/ARCHITECTURE-DEFENSE.md): 30 questions each with reasoning, evidence and remaining weakness.
  - The reference assessment is a disposition register of reused, adapted and rejected components.
- **Missing:** Accepted solution ADRs (0 of 2); named patterns used deliberately (edge store-and-forward, hash-chained append-only log, outbox, approval gate) are present in substance but not catalogued; the Azure service choice is "candidate, not selected".
- **Risk:** low. This is the repository's strongest criterion. The risk is that the panel sees "Proposed" and "Blocked" and concludes nothing was chosen.
- **Remediation:** B-02; add a short pattern catalogue to the architecture page with the rejected alternative for each pattern.
- **Acceptance test:** each Accepted solution ADR lists at least two rejected alternatives, each with a requirement-linked reason; the defence questions on alternatives (DQ-10-03 and the Azure service choices) have Answered dispositions.
- **Dependencies:** B-02.
- **Priority:** P0 (cheap, because the content exists).

### A3. Security, compliance & responsible AI
- **Excellent expects:** "Identity, data protection and isolation addressed against a stated threat model; compliance named; AI risks (grounding, injection, leakage) mitigated"
- **Mode:** T.
- **Evidence now:**
  - Harness controls verified: permission policy as code, per-agent guard, negative tests (EV-0025), hash-chained denial log (chain intact, 111 records), output sanitiser, secrets handling, MCP controls; independent review rounds that found and fixed real bypasses.
  - Sovereignty matrix, data classification, hard constraints HC-01 to HC-12, red-team scenarios RT-01 to RT-11 (executable ones for the harness; production ones pending).
  - Ingestion contract: hostile identifier, payload and prototype-key tests; verifier-owned jurisdiction.
  - Compliance schemes named as candidates, never as confirmed (HC-10).
  - New in this audit: 57 simulated hook probes, 15 candidate gaps in the default session, 4 in named agents (EV-0062 to EV-0064).
- **Missing:** a stated threat model for the solution (none); identity and shipowner isolation design (HC-02 Unresolved, D-015, D-027); verified compliance (all candidates unverified); AI risk mitigation for the business agents (all production-agent tests pending, no agent exists); the hook gaps; secret scanning and push protection disabled; no sandbox; no branch protection.
- **Risk:** medium-high. A security-minded panelist will find the hook gaps and the missing threat model quickly.
- **Remediation:** B-05 (threat model, isolation design, AI risks with tests), B-08 (hardening and approvals), B-16 (signature and anchor).
- **Acceptance test:** every threat in the model has a mitigation, requirement ID and test ID; the probe reports no expected-stop row allowed; secret scanning enabled; cross-shipowner and document-borne injection fixtures refused by the slice.
- **Dependencies:** B-02, B-01 for the AI parts.
- **Priority:** P1.

### A4. Implementation completeness
- **Excellent expects:** "All required capabilities working end to end; known gaps disclosed proactively"
- **Mode:** T (with the guide's note that a broken demo is marked in A4 only if it reveals a real gap).
- **Evidence now:**
  - The harness works and is verified: 770 of 770 tests twice in a clean clone, all validators pass, CI green (EV-0055, EV-0058, EV-0061, audit runs).
  - Gap disclosure is exceptional: the acceptance report, remaining risks, evaluation FAILs left visible.
  - A candidate ingestion contract and reference model, a certificate chain validator, a compiling Bicep scaffold.
- **Missing:** every one of the five business capabilities; any running application; any Azure resource; any end-to-end path. The "known gaps disclosed proactively" half is satisfied; the "all required capabilities working" half is not started.
- **Risk:** critical. The section floor (A 21 of 35) and the "no criterion scored 1" rule both make A4 the most dangerous single criterion.
- **Remediation:** B-01, cut to the smallest slice that shows the outcome; B-16; B-13 so a flaky test does not undermine the claim.
- **Acceptance test:** the end-to-end script passes in CI offline; the demo runs in under two minutes; known gaps are listed in the README and match the audit.
- **Dependencies:** B-02, B-16, phase ADR.
- **Priority:** P0.

### A5. Operations: observability, reliability, performance & cost
- **Excellent expects:** "Structured logging, metrics and traces; targets stated and measured; resilience patterns applied; cost modelled per unit of business value"
- **Mode:** T.
- **Evidence now:**
  - [OPERATIONS-AND-DR](../azure/OPERATIONS-AND-DR.md) and [COST-AND-CAPACITY](../azure/COST-AND-CAPACITY.md) specify method and cost drivers; no figures by rule (HC-12).
  - Resilience patterns exist in the ingestion reference model (store-and-forward, hold on gap, idempotent repeat, conflicting-repeat refusal) with tests.
  - Structured, hash-chained logging exists for the harness (denial log, run store, evidence records).
- **Missing:** instrumentation of anything that runs for the business; targets (D-031) and measurements; a performance test; any cost model; per-unit cost.
- **Risk:** high. The guide names this criterion's Excellent level as "measured", and the repository has chosen not to measure.
- **Remediation:** instrument the slice (structured logs, metrics, traces through OpenTelemetry, optionally Application Insights if Azure is approved); state targets as assumptions (B-02); measure and publish them with the cost model (B-03); run an edge-disconnect resilience test.
- **Acceptance test:** a reproducible command emits p50 and p95 latency of ingest and calculation and a failure-injection result; the cost per delivery is computed from dated, sourced unit prices and a tagged volume assumption.
- **Dependencies:** B-01, B-02, B-03.
- **Priority:** P1.

### A6. AI solution design & evaluation
- **Excellent expects:** "Model choice justified against alternatives on cost, latency and quality; evaluation harness with defined metrics and documented failure modes"
- **Mode:** T.
- **Evidence now:**
  - A deterministic evaluation framework with 73 tests across 12 domains and gates G1 to G7, rerunnable in CI (committed run `EVRUN-9b6110b026`, verified by EV-0065; EV-0051 verified the earlier, superseded run).
  - A model-use rule (a model only where its processing location is verified; never on the calculation path) and candidate services (Azure OpenAI, Foundry) described with their data-processing caveats.
  - Failure modes for the harness are recorded; three real findings stay FAIL.
- **Missing:** a model in the solution; a model choice; any comparison on cost, latency or quality; any dataset or metric for the business tasks; documented failure modes for the AI behaviour. The framework measures the harness, which the guide does not ask for.
- **Risk:** high. Floor exposure for A6 is real: "no evaluation" is the lowest descriptor and the framework is aimed at the wrong subject.
- **Remediation:** B-04.
- **Acceptance test:** a committed run table comparing at least two models on defined metrics, thresholds from assumptions, a failure-mode register, and an offline subset in CI.
- **Dependencies:** B-01, B-05, model access (needs your approval).
- **Priority:** P1.

### A7. Agentic autonomy & orchestration
- **Excellent expects:** "Agent acts autonomously within clear guardrails; handoff, reflection or state-graph patterns used deliberately and justified"
- **Mode:** T, L.
- **Evidence now:**
  - Orchestrator-to-specialist delegation with a recorded run (`RUN-afb2a0466e`), a task state machine, a bounded Plan, Execute, Verify, Critique, Repair loop with six scenarios, and an agent autonomy matrix for the production agents. Patterns are justified in ADR 0006, ADR 0009 and ADR 0011.
  - Reflection exists as the critic and reviewer roles; guardrails exist as hooks and permission tiers.
- **Missing:** autonomous action by a business agent (none exists); in the coding harness, begin, end and review are human-run and no model-driven repair has been run, so the panel may call it a scripted flow with human steps; VS Code behaviour unproven; the loop and the task engine are not used by any product agent.
- **Risk:** high. "Largely a scripted flow presented as agentic" is a plausible reading of the current evidence.
- **Remediation:** B-01 includes one autonomous business-agent workflow with a guardrail, a handoff and a reflection step; B-10 shows the coding agents working in VS Code; B-04 measures the agent.
- **Acceptance test:** an agent completes a bounded task end to end with no human step up to the approval gate; its trace shows a guardrail refusal of an out-of-scope action, a recorded handoff and a reflection that catches a seeded error.
- **Dependencies:** B-01, B-04, B-10.
- **Priority:** P1.

---

## Section B: Communication & Executive Presence (scored live)

### B1. Narrative structure & argument
- **Excellent expects:** "Clear arc — problem, stakes, options, recommendation; the conclusion follows from the evidence presented"
- **Mode:** L, H.
- **Evidence now:** problem statement, business case, option comparisons and an exceptionally honest evidence trail exist. No storyline exists, and the decision register says no option is recommended.
- **Missing:** a one-page argument that ends in a recommendation and what it costs; a mapping of each claim to evidence.
- **Risk:** high. The guide says the commonest loss is "presenting the build instead of making an argument".
- **Remediation:** B-06 (storyline with evidence links) after B-02 (a recommendation to argue).
- **Acceptance test:** every claim in the storyline links to an evidence ID; a human reads it in under ten minutes and states the recommendation correctly; timed rehearsal (live).
- **Dependencies:** B-02.
- **Priority:** P0.

### B2. Audience calibration & register
- **Excellent expects:** "Pitches depth to the room; moves between executive and technical registers without losing either audience"
- **Mode:** L, H.
- **Evidence now:** the documents use one register (precise, detailed); no executive summary.
- **Missing:** an executive register and a technical register of the same story; a glossary.
- **Risk:** medium.
- **Remediation:** B-06 executive summary plus technical appendix; B-07 stakeholder map so you know who is in the room.
- **Acceptance test:** a non-technical reviewer restates the recommendation and the main risk after one page; a technical reviewer finds the contracts and tests in two clicks.
- **Dependencies:** B-06, B-07.
- **Priority:** P2.

### B3. Demo & executive hook
- **Excellent expects:** "Demo lands the 'so what' in under two minutes, shows outcome rather than features, and recovers gracefully if something breaks"
- **Mode:** L (graceful recovery is observed live; the demo itself can be prepared and rehearsed).
- **Evidence now:** harness demonstrations ([DEMO-EVIDENCE-STORE](../orchestration/DEMO-EVIDENCE-STORE.md), [TOOL-DEMO](../harness/TOOL-DEMO.md)) are feature tours of the harness. The ingestion contract tests could drive a short outcome demonstration, but none is scripted.
- **Missing:** a two-minute outcome demo (for example: an offline delivery syncs, a tampered certificate is caught, a filing without approval is refused, a cross-shipowner question is refused); a fallback; a rehearsal record.
- **Risk:** high. Without a slice the demo is a harness feature tour, which the guide scores as a "feature walkthrough".
- **Remediation:** B-06 on top of B-01; recorded fallback; a "if it breaks" script.
- **Acceptance test:** the demo runs offline in under 120 seconds three times; the fallback recording exists; a human rehearsal is timed (live).
- **Dependencies:** B-01.
- **Priority:** P0.

### B4. Q&A composure & depth under challenge
- **Excellent expects:** "Answers go deeper than the prepared material; separates what is known from what is assumed; stays composed under pressure"
- **Mode:** L, H.
- **Evidence now:** 30 defence answers each with a "remaining assumptions or weaknesses" field, a 60-question bank, an honest evidence trail. This is unusually good preparation for the "known versus assumed" half.
- **Missing:** rehearsal evidence; second-level probes; updated answers after the slice exists; a one-page known, assumed, unknown sheet. A risk specific to this repository: it was built quickly with heavy AI assistance, and the guide says you will be examined on specifics, so you must be able to answer without the document.
- **Risk:** medium.
- **Remediation:** B-15; update the defence after B-01 and B-03.
- **Acceptance test:** peers score recorded rehearsals; the cheat-sheet covers every Critical gap in this audit with a one-sentence honest answer.
- **Dependencies:** B-06.
- **Priority:** P2.

### B5. Delivery craft: pace, presence & time discipline
- **Excellent expects:** "Composed and engaging; paces to land the key points; finishes inside the slot with room for questions"
- **Mode:** L.
- **Evidence now:** none possible in a repository.
- **Missing:** a timed run sheet and rehearsal log.
- **Risk:** medium; cannot be reduced by repository work except through preparation material.
- **Remediation:** B-06 run sheet; B-15 timed rehearsals.
- **Acceptance test:** three timed rehearsals inside the slot with time left for questions.
- **Dependencies:** B-06.
- **Priority:** P2.

### B6. Written communication: deck & capstone documentation
- **Excellent expects:** "Slides carry one idea each and standalone without narration; capstone documentation is complete and navigable"
- **Mode:** T (documentation), H (deck).
- **Evidence now:** 150 Markdown files, about 157,000 words, a README with a diagram, a generated coverage index, an acceptance report with a classification matrix.
- **Missing:** a deck; a single entry point and reading order; a one-page architecture; an executive summary; correct statements (three stale items); less duplication. Volume is not navigability.
- **Risk:** high. "Complete" is met; "navigable" is not.
- **Remediation:** B-12 and B-06.
- **Acceptance test:** a reader test with ten canonical questions answered within two clicks; stale-claim and link checkers pass; each slide has one idea and a standalone note.
- **Dependencies:** B-02 for the architecture page.
- **Priority:** P1.

### B7. Use of evidence & data storytelling
- **Excellent expects:** "Claims backed by numbers the audience can act on; visuals chosen to make the point, not to display the data"
- **Mode:** T, L.
- **Evidence now:** real, re-runnable numbers about the harness (770 tests, 73 evaluation tests, 53 pass, 3 fail, gates, coverage classes, 15 candidate hook gaps). None is about the use case.
- **Missing:** latency, throughput, cost per delivery or certificate, evaluation scores for an AI agent, value at stake, cost of inaction. The guide says assertions without evidence cap B7 at 3.
- **Risk:** high.
- **Remediation:** B-03, with figures tagged measured, sourced or assumed so that HC-12 is kept and each number survives Q&A.
- **Acceptance test:** a check fails on any untagged figure in the capstone documents; measured numbers reproduce from one command; one chart per claim, chosen to make the point.
- **Dependencies:** B-01, B-02, B-04.
- **Priority:** P0.

---

## Section C: Consultative & Stakeholder Skills (scored live)

### C1. Discovery & business framing
- **Excellent expects:** "Names the real stakeholders, constraints and success measures; quantify the value at stake and the cost of inaction"
- **Mode:** L, H.
- **Evidence now:** [PROBLEMSTATEMENT](../../PROBLEMSTATEMENT.md), [BUSINESS-CASE](../context/BUSINESS-CASE.md) (framing, explicitly not financial), 99 requirements each with a business justification, 26 assumptions, 37 decisions with owner roles, constraints captured as hard constraints.
- **Missing:** a stakeholder map with interests and what each must see; success measures with definitions and baselines (D-034 open); any quantification of value or of cost of inaction. "Real" stakeholders: the repository does not say whether discovery was done with people or is a case-study reading; you need to state which.
- **Risk:** medium; the guide's Satisfactory level is "requirements restated rather than interrogated", which is close to what the documents do.
- **Remediation:** B-07; state plainly what is assumed and what was learned from people.
- **Acceptance test:** each success measure has definition, unit, baseline (or a labelled assumption) and source; the cost-of-inaction scenario reproduces from tagged parameters.
- **Dependencies:** B-02.
- **Priority:** P1.

### C2. Active listening & disagreement navigation
- **Excellent expects:** "Answers the question asked; restates challenges accurately before responding; disagrees without dismissing, and concedes when the point is good"
- **Mode:** L.
- **Evidence now:** none possible. The audit and RV-0002 do show the author conceding to reviewers (one reported blocker was checked and recorded as mistaken; several were accepted and fixed), which is a habit worth rehearsing aloud.
- **Missing:** rehearsal.
- **Risk:** medium; behavioural.
- **Remediation:** B-15 with restate-first practice; prepare three real concessions the audit gives you (the hook gaps, the evidence-record weakness, the posture of not recommending).
- **Acceptance test:** peers confirm the challenge was restated accurately before each answer in rehearsal.
- **Dependencies:** B-06.
- **Priority:** P3.

### C3. Influence & intellectual honesty
- **Excellent expects:** "Makes a recommendation and defends it; surfaces risk unprompted; says 'I don't know' without losing credibility"
- **Mode:** L, H.
- **Evidence now:** the strongest honesty record possible: genuine FAILs kept visible, recorded failures kept, remaining risks listed, "not verified" stated everywhere, no invented figures, stale claims found by the repository's own audit.
- **Missing:** a recommendation. The repository states "no option is recommended" and "needs the owner" throughout, which matches the guide's Satisfactory descriptor "presents options without taking a position". A second risk is the opposite one: a claim such as "unauthorized operations are technically blocked" stated without its exceptions would be an overclaim.
- **Risk:** medium. Cheap to fix and high value.
- **Remediation:** B-02 (take positions, labelled assumptions); B-06 (an explicit recommendation and a "what I don't know and how I would find out" list); B-12 (correct the over-broad statements).
- **Acceptance test:** the narrative states the recommendation in one sentence, with the three strongest risks unprompted and an "I don't know, here is how I would find out" for each unknown; no statement in the README or the acceptance report is broader than its evidence.
- **Dependencies:** B-02.
- **Priority:** P0.

---

## Section D: Thought Leadership Artifact (scored before panel day by two reviewers)

### D1. Substance & originality
- **Excellent expects:** "Original synthesis grounded in real engagement evidence; another architect could act on it on Monday"
- **Mode:** P, H.
- **Evidence now:** a plausible original contribution exists: a coding-agent harness whose controls are code, whose evidence is recorded and whose gates compute, with documented lessons (for example: independent reviewers found real defects in several separate stages; a privacy check that flagged an ordinary word on CI; a recorder that refused to record an indirect command). A public repository with MIT licence.
- **Missing:** the choice of artifact and the stated insight; "real engagement evidence" (what happened in the engagement that grounds it); a "what to do on Monday" section; separation of what is yours from what is assistant-generated, because the guide permits AI assistance but says the insight, evidence and recommendation must be yours and that you will be examined on them.
- **Risk:** medium. The risk is a derivative reading ("a lot of governance scaffolding") rather than a transferable insight.
- **Remediation:** B-09: choose the format; write the insight and the lessons with data from this repository; add an "apply it on Monday" section.
- **Acceptance test:** another architect can reproduce the controls from the README in a fresh clone (already true, EV-0057); the artifact states the insight in the first paragraph; every lesson cites a recorded failure or finding.
- **Dependencies:** panel date; B-12.
- **Priority:** P0.

### D2. Craft & publish-readiness
- **Excellent expects:** "Structured, edited and cited; ready to publish or file with no rework"
- **Mode:** P, H.
- **Evidence now:** a README with purpose, status, a diagram and setup; consistent document style; a licence. The reference-implementation format requires "a README covering purpose, architecture, setup and known limitations": architecture and setup are present, **known limitations are not collected in one section**.
- **Missing:** a limitations section; an edit pass; citations; removal or correction of stale statements; contribution and security notes if you want outside readers.
- **Risk:** medium.
- **Remediation:** B-09 and B-12; add the four required README sections.
- **Acceptance test:** a test confirms the four README sections exist and the stale-claim checker passes; a peer edit pass with no structural rework requested.
- **Dependencies:** B-12.
- **Priority:** P1.

### D3. Dissemination & reach
- **Excellent expects:** "Published, filed or delivered to a real audience beyond the cohort; discoverable by architects outside the program"
- **Mode:** P.
- **Evidence now:** the repository is public (anonymous HTTP 200), MIT licensed, with a description. No topics, no release, no announcement, no internal-library or Tech Community submission, no filing.
- **Missing:** discoverability (topics, release, a post), a submission or acceptance record, and the employer's publishing and IP confirmation. The guide's levels turn on submission and acceptance, which only you can obtain.
- **Risk:** high. "Produced for the rubric only; no publication path identified" is the lowest descriptor.
- **Remediation:** B-09: add topics and a release; submit a short article to the chosen outlet; keep proof of submission.
- **Acceptance test:** proof of submission or acceptance exists; the repository is discoverable by search for its topics; a release tag is published.
- **Dependencies:** your publishing approval; B-09.
- **Priority:** P0 (deadline-driven).

---

## Rules from the guide that shape priorities

- Floors are applied first and a total never overrides them: A at least 21 of 35, B at least 21 of 35, C at least 9 of 15, D at least 9 of 15; no criterion scored 1; artifact submitted; required masterclasses attended (not visible in the repository: please confirm).
- A broken demo is scored as recovery in B3, and marked in A4 only if it reveals a real gap. The current gap is real.
- One Q&A exchange is scored twice: answer quality (B4) and listening and disagreement (C2).
- Capstone documentation is scored in B6; the artifact only in Section D. They are separate deliverables, so the artifact cannot double as the capstone documentation.
- Assertions without evidence cap B7 at 3.
