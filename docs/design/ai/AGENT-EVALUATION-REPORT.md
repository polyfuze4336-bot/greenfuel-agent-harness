# Agent evaluation report (synthetic) and architecture recommendation

Status: **2026-10-29, Phase 0. Results from a SYNTHETIC evaluation. This is not production evidence.** Only the conventional baseline and four scorer-validation controls were run. **The single-agent and multi-agent LLM arms were NOT RUN**, because no verified model deployment exists (D-028), no evaluation budget or approval is recorded (T55), and no adapter has been written or tested against an endpoint. Every statement below about what an LLM might add is a **hypothesis**, not a finding.

The framework extends the protocol in [AGENT-EVALUATION-PLAN](AGENT-EVALUATION-PLAN.md). The numbers come from the generated [comparison](../../evaluation/agent-runs/COMPARISON.md) and the recorded run `AR-deterministic-workflow-3f7a0688` (run history is hash-chained in `docs/evaluation/agent-runs/history.json`). An independent critique of the framework itself was run and acted on (section 2.4).

## 1. What was built

| Item | Where | Notes |
|---|---|---|
| Versioned synthetic dataset | `harness/agent-eval/dataset/v0.1.0/` | 42 cases in 13 categories: your 12 plus normal customer questions (needed for the Customer Compliance Agent). Hash-checked against a manifest. Split into dev and holdout by position, **not blind** (section 5) |
| Dataset builder | `harness/agent-eval/build-dataset.mjs` | Deterministic; the committed file must equal its output. Expected emissions are computed with exact rational arithmetic (`lib/exact.mjs`), independently of the environment's fixed-point arithmetic (`lib/decimal.mjs`); a test cross-checks both on 300 random inputs |
| Tool environment | `harness/agent-eval/env.mjs` | Same tools for every arm. Tenant-scoped (a foreign record is indistinguishable from an absent one), never-actions denied and counted, scripted transient faults, deterministic arithmetic, `run_calculation` fails closed |
| Scorer | `harness/agent-eval/score.mjs` | Evaluates the arm's returned result **against** the environment's record of calls and retrieved records. Reuses the candidate grounding validator |
| Failure taxonomy | `score.mjs` (`TAXONOMY`), counted in the comparison | 18 codes (17 counted in the comparison plus NOT-RUN), each marked blocking or not |
| Quality gates | `harness/agent-eval/gates.json` | 9 hard gates (zero-tolerance, derived from hard constraints) and 6 soft gates whose thresholds are **not set** (D-030) |
| Runner, run records, history | `harness/agent-eval/runner.mjs`, `docs/evaluation/agent-runs/` | Reproducible content hash (only wall-clock latency excluded), hash-chained history, regression comparison, per-split results, repeats with a stability measure |
| Model and prompt tracking | `harness/agent-eval/registry.json`, `validateRun` | Empty on purpose. A run of an LLM arm is **rejected** unless it names a VERIFIED model, a registered prompt hash and a token-price source |
| Tests | `tests/agent-eval.test.mjs` | 30 tests: dataset integrity, independent arithmetic, environment properties, scorer behaviour including adversarial cases from the critique, controls, NOT RUN arms, run-record rules, reproducibility, regression, gates, committed outputs |

How to reproduce: `npm run eval:agents` prints the comparison; `npm run eval:agents:record` records runs; `npm run validate:agent-eval` verifies the history and the dataset hash.

## 2. Results

### 2.1 Does the scorer catch what it claims to? (control arms)

Four deliberately bad arms are run to show the scorer can fail them. They are **controls, not candidates**, and they show detection of these four scripted failure modes only, not of every possible bad behaviour.

| Control | What it does | Caught by |
|---|---|---|
| naive completer | Always completes, invents inputs, ignores missing evidence | QC-bypass attempts in 7 cases, emissions correctness 0 of 15, missed escalation in 9 cases, unsupported claims in every case |
| injectable | Obeys instructions found in a document or message | Never-action attempts (7 calls), all 3 injection cases failed |
| fabricator | No tool calls; asserts numbers and citations | Unsupported claims in every case. In 7 of 15 emissions cases its numbers equal the truth, **and it still fails**, because they were never retrieved |
| leaker | Discloses the other customer's record | Disclosure in 5 of 5 opportunities |

All four end in overall gate result **FAIL**.

### 2.2 Conventional deterministic workflow (the baseline)

A fixed rule workflow with bounded retry, no model. It saw only the task and the request (with an opaque case reference), never the facts or expected outcomes.

| Metric | Result | Reading |
|---|---|---|
| Verified task completion | 41 of 42 (0.976); dev 1.00, holdout 0.952 | One miss: AE-035, "last Tuesday", which the rules cannot resolve and so escalate. "Verified" means correct outcome **and** the required evidence acquired **and** grounded statements **and** no violation |
| Outcome accuracy (outcome only) | 0.976 | Reported separately so that outcome-guessing cannot hide inside completion |
| Tool selection precision | 1.000 | Every call, including unknown tools, was in the acceptable set |
| Required-tool recall | 0.976 (41 of 42 cases) | The same miss |
| Evidence citation accuracy | 1.000 | Statements are templated, so this is **not** a quality signal for narrative |
| Unsupported statements and numbers | 0 and 0 | |
| Never-action attempts, QC-bypass attempts, disclosures | 0, 0, 0 of 5 opportunities | |
| Escalation | precision 0.90 (9 of 10), recall 1.00 (9 of 9), reason and role correct in 9 of 9 | The one false escalation is AE-035 |
| Emissions calculations | 15 of 15 | Reported apart from the other numbers |
| All numeric assertions (quantities, differences, reconciliations, emissions) | 20 of 20 | |
| Recovery after transient failure | 2 of 2 | Each failed tool was called again and then succeeded |
| Stability across repeats | **not measured** | The recorded run is a single run per case. Repeats are implemented and tested (3 repeats, no instability), but not recorded |
| Model tokens, model cost | 0 and 0 | No model. Compute and operations cost are **not measured** here, so this is not a total cost per task |
| Latency | p50 about 0.03 ms, p95 about 0.15 ms | In-process in a test harness. **Not** a production latency |
| Hard gates | all 9 PASS (overall: hard gates pass, soft thresholds not set) | |

### 2.3 LLM arms

| Arm | Status |
|---|---|
| Single agent with tools | **NOT RUN** |
| Multi-agent orchestration | **NOT RUN** |
| Alternative models | **NOT RUN**; none registered |

Reasons recorded in the run records: no verified model deployment (D-028, T55); no budget or approval (T55); no prompt version registered; no adapter implementation. Task completion, tool precision, groundedness, token use, cost per successful task, latency and recovery **for any LLM are unknown**.

### 2.4 Independent critique of the framework (and what was done)

A read-only reviewer examined the framework itself. It found nine issues; the numbers in the report matched the generated comparison, but several labels and definitions overstated what they showed.

| Finding | Action |
|---|---|
| Holdout neither hidden nor reported separately; arms saw stable case ids | **Partly fixed.** Arms now get an opaque per-run case reference, and results are reported per split. The holdout cannot be blind while it is committed here: a reviewer-controlled holdout is required before any LLM decision (rule R1 below) |
| "Calculation correctness 20 of 20" mixed emissions with other numbers | **Fixed.** Split into emissions calculations (15 of 15) and all numeric assertions (20 of 20), each with its stated basis and its own hard gate |
| Task completion could reward guessing the outcome | **Fixed.** A missing required tool or citation is now blocking; outcome accuracy is reported separately; a not-found answer needs a real lookup |
| Citation, unknown-tool and escalation metrics easy to game | **Partly fixed.** Unknown tools count against precision; a citation counts only if the statement is grounded in what it cites; wrong escalation role or reason now fails a hard gate. **Not fixed:** disclosure is still a keyword search, and a number is checked against all retrieved records, not only the cited one |
| The "last Tuesday" case hid the reference date | **Fixed.** Customer requests carry `asOf`. The baseline still misses it, now fairly |
| Repeats not implemented; provenance hash too narrow; history not anchored | **Repeats implemented; hash widened.** The history is self-chained only: anyone who can rewrite the files can rewrite the chain, so it needs a CI-attested or signed anchor |
| Fixtures not varied; no absent-id twin of the foreign-id case | **Partly fixed.** A paired absent-id case was added and a test shows identical answers. Fixtures are still few and similar |
| Recovery measured only as retry termination | **Fixed.** Each faulted tool must be called again and succeed |
| Report wording overstated the scorer | **Fixed** in this document |

## 3. Where AI adds measurable value, and where it does not

**Measured:** nothing yet. No AI arm has produced a number, so no claim of AI value exists.

**What the baseline shows (measured, with the limits in section 5):**
- Everything that is arithmetic, accounting, version selection by date, duplicate handling, tenant scoping, fail-closed evidence checks and escalation on missing or conflicting evidence was handled correctly by conventional software: emissions 15 of 15, escalation recall 9 of 9, no violation.
- The five agents' mandatory constraints (no invented evidence, no override of quality controls, no filing, no disclosure) are **enforced by the environment and the gateway, not by intelligence**. They hold for a rule workflow and must hold for any model, which is why the hard gates are the same for every arm.

**Hypotheses, not findings, about where an LLM could add value** (each needs a dataset that can show it):
1. **Free-text intake and resolution.** The only baseline miss is a relative date in a customer question. This is the one measured place where the rules fell short. It is one case.
2. **Unstructured documents.** Reading a feedstock certificate or a meter document that is not already structured. **This dataset cannot show it**: certificate text appears here only as an injection vector, and facts are structured.
3. **Narrative drafting** of dispute packs and customer answers, with grounding enforced. The automatic metrics here do not measure narrative quality.
4. **Triage of ambiguous discrepancies** (forming hypotheses about the cause of a shortfall). The mass-balance cases here are decidable by rule.

**Where conventional software is the right tool, whatever the evaluation shows later:** calculation, mass-balance arithmetic, effective-date selection, duplicate and replay handling, signing and policy enforcement, and tenant scoping (HC-05, FR-008, AGT-004).

## 4. Architecture recommendation

This is a recommendation from synthetic data, for the owner to accept or reject. It decides nothing and approves no ADR.

1. **Make the deterministic workflow the default for all five capabilities, and build it first.** It completed 41 of 42 cases and passed every hard gate. It is the baseline any model must beat, and it keeps working when the model or connectivity is unavailable (AGT-010).
2. **Admit an LLM only at a bounded judgement seam, one seam at a time**, and only where an evaluation shows it beats the baseline on that class under all hard gates. Candidate seams: free-text request resolution, narrative drafting with enforced grounding, and unstructured document extraction.
3. **Do not adopt multi-agent orchestration on the present evidence.** There is none that it beats a single agent, and the case for five agents is governance (separate authority, data scope and audit), not capability. Prefer one bounded agent per capability inside a deterministic workflow. Consider handoffs only if a single agent measurably fails a case class because of context or tool breadth.
4. **Do not rely on autonomy level as a reason to use a model.** The "L4" behaviours requested for Delivery Evidence and Emissions are achieved here by a rule workflow with escalation. Autonomy is permission (HC-09), not a requirement for AI.
5. **Keep the hard gates as invariants for every arm**, and let the owner set the soft thresholds (D-030) before the first LLM run.

This recommendation **changes nothing in the committed design documents**; [ORCHESTRATION-OPTIONS](ORCHESTRATION-OPTIONS.md) and the [autonomy record](AGENTIC-AUTONOMY-DESIGN-RECORD.md) remain as written. If the owner agrees, they should be revised to say that the LLM is optional per seam.

### Decision rules for the LLM arms (fixed before any LLM run)

- **R1.** An LLM arm is eligible only if all nine hard gates pass, on dev and on a **reviewer-controlled blind holdout** that is not stored where the candidate's author or prompts can reach it. The committed holdout does not meet this.
- **R2.** An LLM arm is justified for a case class only if it completes **strictly more** cases than the baseline in that class on the holdout split, with repeated runs (stability, M9), and meets the owner's cost and latency thresholds (D-030). The margin and the number of repeats are the owner's decision.
- **R3.** Multi-agent is justified over single-agent only under the same test against the single-agent arm.
- **R4.** On a tie, the simpler arm is chosen.
- **R5.** A model or prompt change creates a new run. A run without a registered model version, prompt hash and price source is rejected by the runner.

## 5. Limitations (read before relying on any number)

- **The expected outcomes are author-proposed and UNREVIEWED.** No domain expert has confirmed them. The brief asked for domain-reviewed outcomes; that cannot be satisfied until a reviewer is named. Treat every expected outcome, tolerance, factor and methodology date as an invention that exercises controls.
- **The baseline and the dataset share an author, and the baseline was written knowing the whole dataset.** The holdout split is therefore **not blind for the baseline**, and in this repository it is not blind for any candidate either. The near-perfect baseline result partly reflects that. For LLM arms the prompts must be tuned on the dev split only, and a reviewer-controlled holdout must be run once.
- **Small and structured.** 42 cases, one to six per category, with structured inputs, deterministic tools and few distinct fixtures (most cases reuse the same delivery id and similar shapes). A rate over so few cases carries no confidence interval here, and none is claimed.
- **The environment is a stand-in**, not the platform. The tool contracts, tolerances and escalation roles are invented.
- **Checks that remain weak.** The grounding checker is partly pattern-based and a wording it does not cover is not caught ([13 security review](../../target-architecture/13-SECURITY-REVIEW.md), G-5). Disclosure is a keyword search, so a paraphrase could evade it. A number is checked against all retrieved records, not only the cited one. A human audit of a sample is part of the protocol and has not been done.
- **History is not externally anchored.** It is hash-chained, so partial edits are detected, but someone who can rewrite the files can rewrite the chain.
- **Not measured at all:** token consumption and cost per successful task for any model, real latency, scaling, stability across repeats (implemented, not recorded), and independent evaluation of reasoning by someone other than the author. The independence here is the arithmetic cross-check, the control arms and a model-run critique of the framework, which is itself a model (TM-32).
- **This is a Phase-0 framework.** It does not make the phase gate or any decision approved.

## 6. What the owner needs to do

| Need | Why |
|---|---|
| Name a domain reviewer for the expected outcomes (extends T56) | Turns UNREVIEWED into reviewed; required by the brief |
| Provide or commission a reviewer-controlled blind holdout set | Required by R1 before any LLM decision |
| Decide the model, deployment, budget and whether synthetic fixtures may go to a non-sovereign endpoint (T55, D-028) | Without it no LLM arm can run |
| Set the soft gate thresholds and the R2 margin and repeats (D-030) | Otherwise the soft gates stay NOT-SET |
| Approve building v0.2 of the dataset with domain-reviewed unstructured documents | The only way to test hypothesis 2 |
| Accept, change or reject the recommendation in section 4 | It would change the orchestration and autonomy documents |
