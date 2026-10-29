# Agentic autonomy design record

Status: **proposed design, Phase 0, 2026-10-29. Nothing described here is implemented, tested or evaluated.** No agent exists, no model has been called, and no figure below is a measurement. It is a design for the five **production business agents** of the certification platform. It is unrelated to the GitHub Copilot engineering agents in `.github/agents/`, which build and govern this repository and never touch production data, keys or tenants (AGT-011, [AGENT-ROSTER](../../agents/AGENT-ROSTER.md)). Where this record says "agent" it means a production business agent.

It extends the baseline [AGENT-AUTONOMY-MATRIX](../../context/AGENT-AUTONOMY-MATRIX.md) (action catalogue A-01 to A-28, NEVER list, escalation triggers) and rests on [DES-0003](../../architecture/designs/DES-0003-target-system-architecture.md), [ADR 0016](../../adr/0016-sovereign-evidence-cells-with-federated-coordination.md) and [ADR 0017](../../adr/0017-deterministic-core-and-bounded-agents.md), all **Proposed**. The orchestration choice is argued in [ORCHESTRATION-OPTIONS](ORCHESTRATION-OPTIONS.md) and the evaluation protocol is in [AGENT-EVALUATION-PLAN](AGENT-EVALUATION-PLAN.md). Placeholders are marked PH and are not targets (HC-12).

## 1. Why the agents have not been built

Phase 0 forbids application code (HC-11, BR-009); no approver is enrolled so the phase cannot be raised ([PHASE-1-BLOCKER-REPORT](../../phase/PHASE-1-BLOCKER-REPORT.md)). In addition, a real autonomy evaluation needs a **model deployment whose processing location is verified** for delivery-derived data (D-028, SEC-003), and none has been verified or requested: no Azure sign-in has been used and a priced model meter proves nothing about where prompts are processed. A simulated model would produce numbers that look like an evaluation and are not one. Section 9 lists what is needed.

## 2. The autonomy scale and levels requested

Working scale from the matrix (proposal for D-008): L0 no AI; L1 assistive; L2 drafting; **L3 conditional action: performs pre-approved, low-impact catalogued actions; a human approves everything else**; **L4 bounded autonomy: executes multi-step workflows toward a goal within an explicit catalogue and data scope, escalating exceptions; high-impact actions still need human approval**; L5 not permitted.

| Agent | Baseline matrix ceiling | Requested level | Change | Reconciliation |
|---|---|---|---|---|
| Delivery Evidence | L4 | L4 | none | Binding source evidence as received is catalogued A-02 to A-04 |
| Emissions Attribute | L4 | L4 | none, with a reading of "selects" (section 5.2) | The agent proposes a methodology from the approved set; a deterministic rule table decides applicability (A-05) |
| Dispute Resolution | L3 | L3 | none | Every outward and commercial step is human (A-14 to A-16) |
| Mass-Balance | **L4** | **L3** | **lower** | Monitoring, detecting and proposing only. Posting of derived events is done by the deterministic ledger service, not by an agent decision; adjustments need the quality manager (A-12) |
| Customer Compliance | **L4** | **L3** | **lower** | Answers a catalogued class of documentation questions from authorised evidence; anything outside refuses or escalates; sampled review stays |

The two reductions are **more conservative** than the baseline and are consistent with it. They are recorded here as a proposed change to the baseline for D-008; the approved baseline matrix is not edited by this record (baseline change control). **Ceiling is not operating level** (section 8): each agent starts below its ceiling and rises only on evidence.

## 3. Principles that every agent obeys

| # | Principle | Where it is enforced | Source |
|---|---|---|---|
| P1 | AI performs reasoning, investigation, planning and tool selection. Deterministic services perform arithmetic, accounting, certificate signing and policy enforcement | Tool gateway exposes only deterministic services; no tool lets a model write a number or a status | HC-05, HC-06, AGT-004 |
| P2 | An agent cannot invent missing evidence: a gap is recorded as a gap with a reason, and the run escalates or waits | Structured-output validator rejects any claim without a record reference; "missing" is a first-class result | HC-06, A-08, A-09, FR-014 |
| P3 | An agent cannot override a quality control: a failed check is a result the agent must report, not an obstacle to route around | Checks run in services; the agent has no tool to waive, edit or reorder them | HC-04, A-07, A-10 |
| P4 | An agent cannot settle a commercial dispute | A-16, A-27 are NEVER; no tool exists | HC-09, FR-015 |
| P5 | An agent cannot submit a filing without human approval | A-18 is NEVER; a controlled service submits only after a quality-manager approval bound to the content hash | HC-04, SEC-010 |
| P6 | An agent cannot disclose another shipowner's data | Per-shipowner execution context, tenant-bound tokens, per-shipowner partitions and inference namespaces (ADR 0017 item 7); handoffs never widen scope | HC-02, SEC-005 |
| P7 | Every consequential tool call is authorised and audited | The tool gateway authorises each call against catalogue, scope, role and approval record, and writes the audit event before returning | AGT-002, AGT-007 |
| P8 | Autonomy is not permission | Permission = catalogue entry **and** identity role **and** any approval record; the level label grants nothing | HC-09 |
| P9 | Untrusted content is data | Documents, customer messages and tool output are marked untrusted and cannot change policy, scope or the plan's permitted tools | SEC-012 |

## 4. Shared agent design

### 4.1 Agent run: durable, bounded, resumable

Every task is an **agent run**, a durable record owned by the platform and not by the model:

| Field | Meaning |
|---|---|
| runId, agentId, trigger | What started it: a domain event, a human request, or a handoff |
| goal | A structured goal with acceptance conditions (not free text alone) |
| scopeToken | Delivery, shipowner and jurisdiction scope; the callee never gets more than the caller |
| versions | Model identifier and version, prompt identifier and content hash, tool-schema versions, policy-bundle version, methodology-set version (AGT-009) |
| budget | PH limits on steps, tool calls, repeated identical calls, elapsed time, tokens and cost per run |
| plan and step log | The model's proposed next step, the tool called, arguments hash, authorisation decision, result reference, validator verdict, per-step time and tokens |
| status | PLANNED, RUNNING, WAITING_HUMAN, WAITING_EVENT, ESCALATED, COMPLETED, FAILED, CANCELLED |
| checkpoint | Written after every tool result, so a crash resumes from the last completed step |
| outcome | Structured result, or a refusal or escalation with a reason code and the evidence considered |

### 4.2 Plan, act, observe loop with hard bounds

1. The model receives the goal, the **current facts from the platform** (status, gaps, open exceptions, retrieved record references) and the **list of tools it is currently permitted to call** (the gateway filters the catalogue by state, scope and role).
2. The model proposes one next action as structured output: a tool and arguments, a handoff request, a human-approval request, a wait, or "finish with this outcome".
3. The gateway validates the proposal against the tool schema, authorises it, executes it deterministically and returns a result with record references. Denials and validation failures are returned as results, and a denial is **never retried around**.
4. The orchestrator checkpoints and loops. Which tool comes next is the model's decision given the facts; the sequence is not written in code.

Bounds (all PH, set by the owner under D-030): a step limit; a limit on repeated identical calls; a no-progress rule (a step that adds no new fact or reference twice running ends the run); an elapsed-time limit; a cost limit; **one** repair attempt for a malformed output, then escalation. Hitting a bound ends the run as ESCALATED with the facts gathered, never as a guess.

### 4.3 Structured output and grounding

- Every model output is a typed object checked against a schema before anything acts on it. A schema failure is a validator verdict, not an action.
- **Grounded retrieval.** Retrieval tools return **record references with content hashes** and a quality status, within the caller's scope. An outcome that states a fact must cite references that appear in that run's own tool results; an outcome citing a reference that was never retrieved fails validation. Numbers in text must equal values returned by deterministic tools.
- **Missing is a result.** Retrieval returns "not found in scope" for both absent and out-of-scope records, so existence is not leaked (HC-02) and absence is never filled.

### 4.4 Tool authorisation and audit

A tool call is permitted only if all hold: the action is in the agent's catalogue and currently available in the run's state; the call is inside the scope token; the agent identity holds the role; and any required approval record exists and matches the content hash. The gateway writes an audit event (run, agent, tool, argument hash, decision, result reference, versions, time) **before** returning. Consequential calls are those with a write effect, a handoff, an approval request or a customer-visible output; read calls are logged too.

### 4.5 Handoffs

A handoff is a catalogued call (A-28) carrying goal, references (not content), and a **down-scoped** token. The callee runs as its own agent with the intersection of scopes. A handoff cannot widen scope, so the Customer Compliance Agent cannot hand work to an agent with internal scope; its only upward path is the human escalation queue.

| From | To | When | Carries |
|---|---|---|---|
| Delivery Evidence | Emissions Attribute | A package is complete and no calculation exists for the delivery | Delivery reference, package manifest hash |
| Delivery Evidence | Mass-Balance | A blend or transfer event changes a tank position | Event references |
| Delivery Evidence | Human (port operations) | A required item is absent or conflicting | Gap list with reasons |
| Emissions Attribute | Human (quality manager) | No approved applicable methodology, a missing factor, or a re-run difference | Calculation request and failure reason |
| Dispute Resolution | Delivery Evidence | A discrepancy needs evidence that has not been bound or verified | Delivery reference, question |
| Dispute Resolution | Mass-Balance | A quantity discrepancy may be a ledger issue | Delivery and tank references |
| Dispute Resolution | Human (commercial reviewer) | Pack ready, or any outward step | Pack reference |
| Mass-Balance | Human (quality manager) | Shortfall, conflict or proposed adjustment | Evidence list and proposal |
| Customer Compliance | Human (customer-facing staff or compliance) | Outside policy, ambiguous policy, missing evidence, or an attempt to widen scope | Question and reason |

### 4.6 Human approval checkpoints

| ID | Checkpoint | Who | Binds to | Agent may |
|---|---|---|---|---|
| C1 | Certification filing | Quality manager | Content hash of the filing | Draft and request, never approve or submit |
| C2 | Ledger adjustment or correction | Quality manager | Adjustment content hash | Propose |
| C3 | Release of a dispute pack outside the company | Commercial reviewer | Pack hash | Prepare and queue internally |
| C4 | Resolve ambiguous or missing disclosure policy | Customer administrator or compliance | Question and policy version | Escalate |
| C5 | Operational exception (missing reading, device fault) | Port operations lead | Exception record | Raise and describe |
| C6 | Sampled review of automatic outputs | Quality manager or compliance | Sampled run | Nothing; review happens after the fact |
| C7 | Level change for an agent | Programme owner on evidence | Evaluation report hash | Nothing |

### 4.7 Failure recovery

| Failure | Behaviour |
|---|---|
| Model unavailable or slow | The run waits or ends ESCALATED; deterministic capture, calculation and verification continue; customer answers fall back to templates or a human (AGT-010) |
| Tool transient error | Bounded retry with idempotency key; never retry a non-idempotent write without a check that it did not happen |
| Tool denial (authorisation, scope, state) | Final; recorded; the run chooses another permitted path or escalates. No retry around a control |
| Output fails validation | One repair attempt with the validator's message, then ESCALATED |
| Crash or restart | Resume from the last checkpoint; completed steps are not repeated |
| Poison or hostile input | Marked untrusted; if it steers the plan toward a forbidden tool the gateway denies and an alert is raised |
| Conflicting evidence | Never reconciled by the agent; escalated with both references |
| Edge offline | Work that needs shore waits as WAITING_EVENT; the agent does not act on stale partial data as complete |

## 5. The five agents

For each: goal, decision space (what the model decides), tool allow-list with catalogue IDs and mode, never list, handoffs, checkpoints, outputs, and why the level is appropriate. Tool names are design names, not APIs. Modes are from the matrix: AUTO, AUTO+REV, APPROVE (role), DRAFT.

### 5.1 Delivery Evidence Agent, L4

**Goal.** For each delivery, associate the meter readings, transfer events, blend records and feedstock evidence that belong to it, verify what can be verified, and leave a package whose completeness status is true.

**What the model decides.** Which of several candidate items belong to this delivery when identifiers are partial or ambiguous (using vessel, barge, time window, tank, batch references); which verification checks to run in what order; whether a gap is a missing item, a late item or a conflict; which human role to escalate to and with what description; when the package is ready for hand-off.

| Tool (deterministic) | Catalogue | Mode | Notes |
|---|---|---|---|
| `evidence.search` and `evidence.get` | A-01 | AUTO | Scoped read returning references and hashes |
| `package.bind_item` | A-02 | AUTO | Binds an item **as received**; rejects an item with no provenance; cannot edit it |
| `integrity.check_document` | A-03 | AUTO | Hash and format checks recorded |
| `verification.record_outcome` | A-04 | AUTO | Records an outcome **supplied by an approved verifier**, with its provenance; the agent does not infer a verification result |
| `package.completeness` and `sequence.gap_report` | A-01 | AUTO | Deterministic status and gaps |
| `exception.raise` | A-13 | AUTO | Gap, conflict, suspected tampering |
| `handoff.request` | A-28 | AUTO | To Emissions Attribute, Mass-Balance or a human role |

**Never.** Create or change a measurement (A-08), create or assert feedstock evidence (A-09), set certification status (A-10), delete or alter evidence (A-25), waive a failed integrity check.

**Why L4 is appropriate.** The agent acts only on **append-only binding of evidence as received**, inside a closed catalogue; every action is reversible by a superseding record, observable in the package manifest, and **checked by deterministic services** (completeness, integrity, sequence). An error is a wrong association that the manifest shows and a human or the next check can reject, not a wrong number or a certificate. The cost of human binding is high and repetitive, which is where autonomy pays. What keeps it from L5: it cannot decide what counts as evidence (that is a verifier or a human, D-024), and ambiguity ends in escalation. **Earn the level:** begin at L3 (a person approves each batch of bindings) and move to L4 per cell on evaluation evidence (section 8).

### 5.2 Emissions Attribute Agent, L4

**Goal.** For a delivery with a complete package, choose the applicable approved methodology version, obtain a deterministic calculation, and record a result that can be reproduced.

**What the model decides.** Which scheme and methodology candidates plausibly apply given the delivery's fuel, blend, feedstock and date; which missing input to ask for; whether a re-run difference is a data change or a defect worth escalating; how to explain a result for a human.

**What it does not decide.** Applicability and effective period are decided by a **deterministic rule table**: the agent proposes a version from the approved set the table returns, and the table accepts or refuses. The agent cannot choose a version outside the set, change a factor or invent one (A-07, FR-010). This is how "selects an approved versioned methodology" is reconciled with A-05: the model's reasoning narrows and explains; the rule table decides.

| Tool (deterministic) | Catalogue | Mode | Notes |
|---|---|---|---|
| `methodology.list_applicable` | A-05 | AUTO | Returns approved versions applicable by delivery date, scheme and fuel, with effective periods |
| `calculation.run` | A-06 | AUTO | Inputs by reference and hash; stores methodology, factor, build and numeric-policy versions; fails closed on a missing factor |
| `calculation.rerun_compare` | A-06 | AUTO | Re-runs a stored calculation; matches or explains the difference |
| `evidence.get`, `lineage.trace` | A-01 | AUTO | Scoped reads |
| `exception.raise`, `handoff.request` | A-13, A-28 | AUTO | To the quality manager for no applicable version, missing factor or difference |
| `filing.draft` | A-17 | DRAFT | Only if D-006 places drafting here; a human releases (C1) |

**Never.** Create, change, approve or retire a methodology version or factor set (A-07); compute any value itself; set certification status; issue or sign a certificate (A-19); submit a filing (A-18).

**Why L4 is appropriate.** The decision space is a choice among **approved, versioned options** with a deterministic gate, and every number comes from a tool that fails closed. A wrong proposal is refused by the rule table; a wrong calculation is detectable by re-run. The risk is not the agent's arithmetic (it does none) but a **wrong methodology applied to the wrong delivery**, which the rule table and the re-run comparison catch, and which a quality manager sees before any certificate is approved. What keeps it from L5: it cannot make or change methods. **Earn the level** as for the Delivery Evidence Agent.

### 5.3 Dispute Resolution Agent, L3

**Goal.** For a quantity or quality discrepancy raised by a customer or found internally, retrieve the sensor-backed evidence, quantify the discrepancy deterministically, state what is and is not evidenced, and produce a pack for the commercial reviewer.

**What the model decides.** What evidence is relevant to the claimed discrepancy; whether more evidence should be requested from the Delivery Evidence Agent or the Mass-Balance Agent; how to structure the pack for a reviewer; what the pack must flag as unevidenced.

| Tool (deterministic) | Catalogue | Mode | Notes |
|---|---|---|---|
| `evidence.search`, `evidence.get`, `lineage.trace` | A-01 | AUTO | Internal scope for the case |
| `meter.status` | A-01 | AUTO | Meter verification status and sample references at delivery time (FR-033) |
| `discrepancy.quantify` | A-01 | AUTO | Deterministic difference between claimed and recorded quantities and qualities, with units and rounding policy |
| `pack.assemble` | A-14 | AUTO | Builds the internal pack from references; marks evidenced and unevidenced statements |
| `pack.draft_release` | A-15 | DRAFT | A reviewer releases outside the company (C3) |
| `exception.raise`, `handoff.request` | A-13, A-28 | AUTO | |

**Never.** Decide, concede, settle or communicate an outcome or any commercial concession (A-16); price, credit or invoice (A-27); release a pack outside the company (A-15 is DRAFT only); extrapolate or fill a gap (FR-014).

**Why L3 is appropriate.** The work is investigative, but its **consequence is commercial and external**. Even a good pack changes what a person decides about money. L3 lets the agent run the investigation and assemble the pack on its own inside the catalogue, because that is internal, reversible and reviewed, and keeps every outward and commercial step human. L4 is not justified: the value of autonomy ends where the pack leaves the company, and the cost of an unsupported statement in a dispute is a concession or a reputational loss. **Evaluation target:** a reviewer's corrections per pack and zero unevidenced statements presented as evidenced.

### 5.4 Mass-Balance Agent, L3

**Goal.** Monitor tank, blend and delivery accounting, detect shortfalls and inconsistencies, and propose corrective actions for human decision.

**What the model decides.** Which anomalies matter and why; whether a shortfall is more likely a measurement, timing, blending or allocation issue (as hypotheses with references, never as facts); what evidence to gather; what corrective action to propose and to whom.

| Tool (deterministic) | Catalogue | Mode | Notes |
|---|---|---|---|
| `ledger.read_position` | A-01 | AUTO | Position by tank, batch and period |
| `ledger.detect_shortfall` | A-01 | AUTO | Deterministic conservation and availability checks, including the scheme's boundary and period rules (D-023) |
| `ledger.propose_adjustment` | A-12 | APPROVE (quality manager) | Creates a **proposal**; nothing posts without C2 |
| `evidence.search`, `evidence.get`, `lineage.trace` | A-01 | AUTO | |
| `exception.raise`, `handoff.request` | A-13, A-28 | AUTO | To the quality manager, Dispute Resolution or Delivery Evidence |

Posting of derived events (A-11) is done by the **deterministic ledger service** from signed source events, not by an agent decision. The agent reads the result.

**Never.** Post a manual adjustment or change a certified quantity (A-12 without approval), resolve a conflict silently, allocate beyond the certified balance (FR-019), alter evidence.

**Why L3 is appropriate.** Accounting errors compound and a wrong adjustment changes what the group may claim as certified, so the agent is an **analyst, not a poster**. It can investigate autonomously and propose; a human approves any change. The baseline matrix allowed L4 for posting derived events; at L3 that posting is a service behaviour, which makes the agent's own autonomy smaller and cheaper to assure. **Evaluation target:** shortfalls detected versus planted shortfalls, with no false certainty about cause.

### 5.5 Customer Compliance Agent, L3

**Goal.** Answer delivery-specific documentation questions from a shipowner using only that shipowner's authorised evidence and disclosure policy, citing the records and methodology version.

**What the model decides.** Which authorised records answer the question; how to phrase the answer; whether the question is inside the policy, outside it, or ambiguous (the policy engine decides what is permitted; the model interprets the question and chooses a response class); when to refuse or escalate.

| Tool (deterministic) | Catalogue | Mode | Notes |
|---|---|---|---|
| `customer.policy.evaluate` | A-20 | AUTO | **Runs first.** Returns permitted record classes and fields for this customer and question class, or a refusal code |
| `records.retrieve_scoped` | A-01 | AUTO | Retrieves only inside the customer scope; absent and out-of-scope look identical |
| `answer.validate` | A-20 | AUTO+REV | Deterministic check that every statement cites retrieved references and every number matches a tool result |
| `escalation.create` | A-13 | AUTO | Customer-facing staff or compliance (C4) |
| Any external communication beyond an answer | A-26 | DRAFT | |

**Never.** Answer outside the policy or add a disclosure category (A-21); change a policy (A-22); move data across jurisdictions (A-23); disclose another customer's data; hand work to an agent with wider scope.

**Why L3 is appropriate.** This is the only agent that **talks to a customer** and the one where the hard constraint is disclosure (HC-02). L3 lets it answer a **catalogued class** of documentation questions on its own because the policy engine and the validator bound what it can say, and sampled human review follows. Anything new, ambiguous or sensitive goes to a person. L4 is not justified until isolation on the inference path is evidenced (TM-34, D-028), because an error here is a disclosure to a third party that cannot be recalled. **Evaluation target:** zero unauthorised disclosures; refusals and escalations correct when the policy is silent.

## 6. Demonstrating real autonomy: how it will be shown, not asserted

A fixed sequence of tool calls labelled "agent" would pass the ordinary tests and prove nothing. The demonstration is therefore designed so that **a scripted sequence cannot pass**:

1. The platform presents only **state-dependent tool lists**; the model must choose among them from the facts. Different delivery states offer different choices.
2. At least **eight scenarios** (section 4 of the evaluation plan) differ in what is missing, conflicting or requested, so the correct tool path differs by scenario and, within a scenario, by what earlier tool results revealed.
3. A **fixed-sequence baseline** is run on the same scenarios. The claim "autonomous" holds only if the agent completes scenarios the baseline fails, and the agent's tool sequences differ across scenarios in ways the facts explain.
4. **Trap scenarios** reward the right refusal: a request that needs a NEVER action, an injected instruction in a document, a cross-customer question, a missing factor. A sequence that always proceeds fails them.
5. The trace records, for each step, the facts offered, the tools permitted, the tool chosen and the reason code, so a reviewer can see context-dependence rather than infer it.

None of this has been run. It is the acceptance design for when the phase and a verified model deployment exist.

## 7. Model and prompt versioning

Each agent has a **versioned prompt package**: system instructions, tool descriptions and output schemas, with a content hash. A run records model identifier and version, prompt package hash, tool-schema versions and policy-bundle version. A change to any of them is a new version and requires a re-run of the evaluation suite before the agent's operating level can be kept (C7). Prompts are code: reviewed, stored in version control, and never edited in production. Prompts hold no secrets and no customer data (SEC-011).

## 8. Graduated autonomy: ceiling versus operating level

| Level in operation | Meaning | Move up when |
|---|---|---|
| Shadow | The agent runs and records what it would do; humans do the work | Evaluation thresholds met on the scenario suite (D-030) |
| L2 | Drafts; a human performs | Reviewer correction rate within threshold |
| L3 | Acts on pre-approved low-impact catalogue actions; humans approve the rest | Sustained results in sampled review, zero critical incidents |
| L4 (DEA and EAA only) | Executes multi-step workflows in scope | Programme owner decision on an evidence report (C7) |

Every agent can be reduced a level, or switched off, per cell by a platform administrator, immediately (kill switch, AGT-006). Moving up is slow and evidence-based; moving down is fast.

## 9. What is needed before this can be built

| Need | Why | Owner |
|---|---|---|
| Phase raised for application work (ADR 0020 and signed approvals) | HC-11 | Programme owner |
| D-008: confirm the scale and the levels in section 2, including the two reductions | The matrix is a proposal | Programme owner |
| D-028: a model deployment whose processing location is verified, or a decision to evaluate on non-sovereign synthetic data with an explicitly non-production model | A real evaluation needs a real model; synthetic scenarios contain no real data (DATA-009), but a production claim needs the verified deployment | Compliance, platform |
| D-030: evaluation thresholds | The release bar; none is invented here | Programme owner, quality manager |
| Budget for model calls and a decision on which services may be used | Cost and latency are measured, not assumed | Sponsor |
| D-027, D-007: identity and approver roles | Tool authorisation and checkpoints depend on them | Security, quality manager |
| D-006, D-013: certificate definition and custody | Hand-offs to certificate issuance | Programme owner |

Note: synthetic scenarios contain no real delivery data, so **evaluating against a non-sovereign model on synthetic fixtures can be allowed by an explicit owner decision** without breaching HC-01. That would validate behaviour only. It would say nothing about whether a model may see real data in any jurisdiction.

## 10. Limits

- Everything here is a design. No agent, prompt, tool service, queue, model call or trace exists.
- The levels are proposals for D-008 and the baseline matrix has not been changed.
- Limits and thresholds are placeholders. No cost, latency, accuracy or autonomy claim is made.
- The design relies on a gateway and deterministic services that do not exist; their correctness is the control, so they need the strongest testing.
