# Orchestration options for the production business agents

Status: **proposed evaluation and recommendation, Phase 0, 2026-10-29.** No option was prototyped, benchmarked or verified against Azure; every cell below is reasoning from the requirements, not a measurement. The recommendation is deliberate but not a decision: it needs a Design ADR with a design record and review under the governance gate once the phase is raised, and it depends on D-028. It supports the [agentic autonomy design record](AGENTIC-AUTONOMY-DESIGN-RECORD.md) and builds on [ADR 0017](../../adr/0017-deterministic-core-and-bounded-agents.md) (Proposed).

## 1. What orchestration must do

Derived from the hard constraints and requirements, not from what a framework offers:

| Need | Source |
|---|---|
| Every tool call is authorised against catalogue, scope, role and approval, and audited before it returns, at one enforceable point | HC-09, AGT-002, AGT-007, SEC-009 |
| Runs are durable and resumable: a crash or restart does not repeat a completed step or lose state | CS-C7, NFR-005, NFR-016 |
| Loops are bounded and a hit bound escalates rather than guesses | AGT-008, HC-06 |
| Agents react to domain events (a reading arrived, a package completed) and tolerate intermittent connectivity | CS-C7, BR-007 |
| The model chooses **which approved tool next from the facts**; the platform does not hard-code the sequence | the request; HC-09 |
| Human approval is a durable wait the agent cannot satisfy or bypass | HC-04, SEC-010 |
| State, prompts, traces and inference stay in the originating jurisdiction; customer-facing work is isolated per shipowner on the inference path | HC-01, HC-02, SEC-003, TM-34 |
| Prompt, model and tool versions are recorded with each output and runs can be replayed for audit | AGT-009, FR-029 |
| Small volume, small team, few moving parts | 05 Quality attributes |

## 2. The options

| Option | Name | What it is |
|---|---|---|
| O1 | Explicit state graph | Each agent's work is a graph of states and permitted transitions in a durable workflow engine or library. Model nodes choose among the edges and tools the current state allows |
| O2 | Event-driven choreography | Each agent is a consumer of domain events on a broker. It reacts, runs its own internal loop and publishes events. No central coordinator |
| O3 | Managed agent runtime | A provider-hosted service supplies threads, tool calling, memory and state (for example a managed agent service). The platform configures agents and tools there |
| O4 | Event-triggered, state-machine-bounded runs in a self-hosted runtime | Domain events trigger **agent runs**. Each run is a durable, bounded state machine around the model's plan, act, observe loop, hosted in the cell behind the tool gateway. Cross-agent coordination is by events and catalogued handoffs |
| O5 | Fixed workflow with model steps | A scripted sequence calls the model only to fill in text. **Not autonomy**; kept as the baseline that the evaluation must beat |

## 3. Comparison

Verdict words follow the gate vocabulary: Meets, Conditional, Does not meet, Unknown.

| Criterion | O1 State graph | O2 Event choreography | O3 Managed runtime | O4 Event-triggered bounded runs | O5 Fixed workflow |
|---|---|---|---|---|---|
| Authorisation at one enforceable point | Conditional: the graph limits states, but each tool still needs a gateway | Does not meet: every consumer calls tools, so enforcement is scattered unless a gateway is added | Conditional: the provider's tool layer is not the platform's gateway; enforcement may be partial and provider-side | Meets: the gateway is the only path to tools by construction | Meets: trivially, because nothing is dynamic |
| Durability and resume | Meets: the engine checkpoints state | Conditional: the broker redelivers, but per-run progress is hand-built | Conditional: thread state is the provider's; resume semantics and location unverified | Meets: the run record is checkpointed after every tool result | Meets |
| Bounded loops and escalation | Conditional: edges can bound loops, but inside a model node the loop is free | Does not meet: no run-level bound unless built | Conditional: provider limits exist but are not the platform's policy | Meets: step, repeat, time and cost bounds are run fields with a no-progress rule | Meets |
| Event reaction and intermittent links | Conditional: needs an event adapter | Meets: native | Conditional: needs an adapter; depends on provider connectivity from the cell | Meets: events trigger runs; runs wait on events | Conditional |
| Genuine tool-choice autonomy | Conditional: autonomy exists only within the edges; too rigid a graph is O5 in disguise | Meets | Meets | Meets: the model chooses among the **state-filtered** permitted tools | Does not meet |
| Human approval waits | Meets: a state | Conditional: a separate approval event pattern needed | Conditional: provider "tool approval" features are not the platform's approval service | Meets: WAITING_HUMAN is a status bound to the approval service | Meets |
| Residency and isolation of state and inference | Meets if self-hosted in the cell | Meets if self-hosted | **Unknown, unverified:** where threads, prompts, caches and logs live and whether per-shipowner isolation is possible (D-028) | Meets if hosted in the cell; per-shipowner execution contexts are the unit of a run | Meets |
| Audit and replay | Conditional | Does not meet: reconstructing a run across consumers is hard | Conditional: depends on the provider's trace export | Meets: the run log is the audit record; model and prompt versions are fields | Meets |
| Operational complexity | Conditional: a workflow engine to run | Meets for a single consumer, does not meet across five agents | Meets: least to run, if the provider is acceptable | Conditional: a small runtime to build and own | Meets |
| Vendor dependency | Conditional: depends on the engine | Conditional: a broker | Does not meet: deepest; agent definitions live in the provider | Conditional: model access sits behind an interface, so providers can change | Meets |
| Testability and determinism | Conditional | Does not meet: emergent behaviour | Does not meet: provider behaviour can change under the platform | Meets: runs are replayable against recorded tool results and fixtures | Meets |
| Cost | Unknown | Unknown | Unknown | Unknown: no price of runs, tokens or runtime has been measured | Unknown |

## 4. Recommendation: O4, with O5 as the baseline and O3 as a later candidate

**Choose O4.** Domain events (a reading arrived, a package completed, a customer asked) trigger **agent runs**. Each run is a durable, bounded state machine owned by the platform around the model's plan, act, observe loop, hosted in the cell behind the tool gateway. Agents coordinate through domain events and catalogued handoffs.

Why, in order:
1. **One enforcement point.** Authorisation, scope and audit happen in the gateway whatever the model proposes. The model cannot reach a tool any other way (HC-09, AGT-002).
2. **Bounded by construction.** The run record carries the budget; hitting it escalates. A free-running model node cannot exceed the platform's bounds (AGT-008).
3. **Real autonomy without a fixed script.** The platform filters the tool list by state and scope; the model chooses among what remains from the facts. This is autonomy within a policy, not a hard-coded path.
4. **Fits the constraints.** Events suit intermittent connectivity (CS-C7); self-hosting in the cell keeps state, prompts and inference in the jurisdiction and lets customer-facing work run in per-shipowner contexts (HC-01, HC-02); the run log is the audit trail and replay source (FR-029).
5. **Small.** A bounded run is a modest state machine with a handful of states and one loop. It is built once and reused by all five agents.

Why not the others:
- **O1 alone** is the right shape for the run's lifecycle but a graph that dictates the tools is the baseline in disguise. O4 uses a state machine for **lifecycle and bounds** and leaves **tool choice** to the model.
- **O2 alone** gives no single place to authorise, bound or audit.
- **O3 is deferred, not rejected.** It offers the least operations, but the location of its state and processing, per-shipowner isolation and the platform's control over tool authorisation are **unverified** (D-028, TM-34), and its agent definitions would live outside the platform. It becomes a candidate if a provider verifiably offers in-jurisdiction hosting and the platform's gateway and approval service can remain the only tool path. Evaluate it against O4 on the same scenarios when it can be verified.
- **O5** is not an option for the product; it is kept as the **baseline** the evaluation must beat (see the evaluation plan).

## 5. Conditions and open points

1. O4 depends on a **verified in-jurisdiction model deployment** (D-028). Without one, a cell runs without agent features or the choice reverts to a decision about evaluation on non-sovereign synthetic data only.
2. **Build versus adopt.** A small runtime for the loop can be written, or an open agent framework adopted as the loop's engine behind the same gateway. Candidates exist, including Microsoft's agent framework; none has been reviewed for dependencies, licence, maintenance, telemetry or data handling, and **no choice is made here**. The decision belongs in the Design ADR with a dependency review.
3. **Language and runtime** follow the engineering lean in [PHASE-1-BLOCKER-REPORT](../../phase/PHASE-1-BLOCKER-REPORT.md) (TypeScript on Node) unless the calculation core is built elsewhere; the loop is orthogonal to the calculation service's language.
4. **Per-shipowner execution contexts** are part of the design of a run for the Customer Compliance Agent (ADR 0017 item 7) and must be evidenced for any chosen inference endpoint.

## 6. What the evaluation will compare

Only what can be compared fairly once an environment exists:

| Comparison | Purpose |
|---|---|
| O4 with a hosted model against O4 with a smaller model | Cost, latency and accuracy trade-off between models |
| O4 against O5 (fixed sequence) | Proof that the agents add decisions a script cannot make |
| O4 against O3 | Only if O3 can be verified in-jurisdiction; otherwise not run, and the report says so |
| O4 with a rules-only planner as the lower bound | How much of the success is the platform's deterministic checks and how much the model's choices |

Methods, metrics and thresholds are in [AGENT-EVALUATION-PLAN](AGENT-EVALUATION-PLAN.md). **No comparison has been run.**

## 7. Reversibility

Yes for the model and the loop's engine: both sit behind interfaces. Partly for the run record schema and tool contracts: they become the audit format. The costly mistake to avoid is placing agent definitions or state in a provider before residency and isolation are verified.
