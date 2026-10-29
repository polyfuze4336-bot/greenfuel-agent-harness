# ADR 0017: Deterministic core and bounded business agents

- **Status:** Proposed
- **Type:** Design
- **Date:** 2026-10-29
- **Deciders:** Design approver (not yet named, T3), with the quality manager, the security architect and the AI evaluation owner
- **Supersedes:** none
- **Review:** RV-0003

## Context
- FACT: Emissions calculations are deterministic and traceable to the exact methodology version, and AI cannot invent sensor measurements, emissions factors, feedstock evidence or certification status (CS-C5, CS-C6; HC-05, HC-06). Certification filings require quality-manager approval (CS-C4; HC-04).
- FACT: The case calls the business agents "L4" without defining the scale, and an L4 agent must not be assumed to hold unrestricted commercial, regulatory or infrastructure permissions (CS-P3; HC-09). The working scale in [AGENT-AUTONOMY-MATRIX](../context/AGENT-AUTONOMY-MATRIX.md) is a proposal for D-008.
- ASSUMPTION: Business agents use language models for orchestration, retrieval, drafting and explanation, while every number and status comes from deterministic services (AS-021).
- FACT: Where inference runs and how prompts and retrieved data stay in the jurisdiction is open (D-028), as are the identity and permission model (D-027) and the evaluation thresholds (D-030).
- FACT: The coding harness and the business agents are separate (ADR 0001, AGT-011).

## Requirements addressed
- AGT-002: autonomy never grants permission; permissions come from the action catalogue plus platform-enforced roles.
- AGT-003: no value originates from model output; values come from authenticated sources with provenance.
- AGT-004: numbers in agent output come from deterministic tools and trace to tool-call records.
- AGT-005: external-effect actions require human approval by a defined role.
- AGT-006: agents cannot change infrastructure, identity, policy or methodology.
- AGT-010: deterministic capture and calculation work without AI or connectivity.
- AGT-011: business agents are separate from coding-harness agents.
- SEC-010: approval is enforced technically and bound to a content hash; agent identities cannot hold it.
- SEC-012: untrusted documents, messages and tool output cannot change policy or permissions.
- SEC-003: inference over delivery data runs only in the jurisdiction.
- SEC-005: customer isolation includes compute context and the inference path, not only storage.

## Hard constraints
- HC-02: customer isolation extends to the inference path (decision item 7). Conditional on D-015 and D-028.
- HC-04: the approval service is outside every agent's context and binds to the exact content. Conditional on D-007 and D-027.
- HC-05: no language model on the calculation path. Conditional on D-022.
- HC-06: no value or status originates from a model; a missing value fails closed. Conditional on D-019 and D-024.
- HC-09: the platform, not a prompt, enforces limits. Conditional on D-027.
- HC-11: no agent deploys or creates resources.

## Options considered
1. **Deterministic core with bounded agents behind a tool gateway.** Calculation, hashing, signing, ledger posting, approval enforcement and isolation are deterministic services; agents act only through a gateway that enforces an action catalogue, a data scope and approval gates. **Selected.**
2. **Agent-led platform.** Agents perform calculation, posting and drafting directly, constrained by prompts and guardrails. **Rejected (hard constraint):** a model on the calculation or status path breaks HC-05 and HC-06, and prompt-level limits break HC-09.
3. **No agents.** Deterministic software and human workflows only. **Not selected as the default:** the case specifies an agentic direction (CS-P1) and agents may reduce effort in evidence chasing, drafting and answering; but it is the **fallback per cell**, and the benefit of agents must be measured, not assumed.

## Decision
1. **Deterministic services own every number, status and enforcement.** Calculation, mass-balance posting, certificate signing, approval, isolation and policy evaluation are deterministic software. Their correctness does not depend on a model.
2. **Agents prepare, orchestrate, retrieve and explain.** Each of the five business agents has a written charter (AGT-001), its own workload identity, and an action catalogue. It reaches data and services only through the tool gateway.
3. **The gateway enforces three checks on every call:** the action is in the agent's catalogue, the call is within the agent's data scope and, for customer access, the shipowner scope; and if the action needs approval, the approval record exists and matches. Denials are explicit and logged.
4. **Agents hold no approval, filing, settlement, infrastructure, identity, policy or methodology permission.** Autonomy labels grant nothing.
5. **Agents are optional per cell.** A cell without a verified in-jurisdiction inference endpoint runs without agent features and falls back to templates and humans; it never sends sovereign data to an unverified endpoint.
6. **Untrusted content is data.** Documents, customer messages and tool output are marked as untrusted, sanitised and cannot alter policy or permissions.
7. **Per-shipowner execution isolation on the inference path.** Customer-facing agent work runs in an execution context bound to one shipowner: tenant-bound inference requests; separate namespaces for server-side caches, traces and logs; no cross-shipowner batching, session reuse or shared conversation state; provider-side retention off or verified. A candidate endpoint that cannot guarantee this is not used for customer work, and the alternatives are a dedicated deployment per shipowner or no inference in that cell (HC-02, SEC-005).
8. **The benefit of agents is a hypothesis to be measured** before any value is attributed to them in a business case.

## Why this option is appropriate
It keeps the numbers and statuses where the mandatory constraints require them (HC-05, HC-06), puts the limits on agents in the platform (HC-09), and confines the model's role to work where an error is caught by a human or a deterministic check. Option 2 cannot satisfy those constraints. Option 3 is retained as the fallback and the baseline against which agent value is measured.

## Consequences
- Positive: a model failure or an unavailable endpoint degrades convenience, not correctness; the approval and filing path is auditable; agent behaviour is testable at the gateway.
- Negative: the "agentic" part of the product is thinner than the label suggests; the gateway is a critical component that must itself be correct and tested; per-agent catalogues and scopes need maintenance.
- Obligations: the evaluation framework's production-agent suite (currently pending) must exist before release (AGT-008, D-030); prompt, model and tool versions are recorded with each output.

## Reliability consequences
Agents are off the critical path of capture, binding, calculation, issuance and verification. A gateway outage stops agent features and customer natural-language answers only. The gateway must fail closed.

## Security consequences
Prompt injection can mislead an agent but cannot widen what the gateway allows. The gateway, approval service and role assignments become high-value targets and need the strongest identity, logging and change control. Per-shipowner scope tokens, not agent instructions, protect customer isolation.

## Residency implications
Inference is a processing step over delivery-derived data and so must run in the originating jurisdiction or not at all (SEC-003). The model deployment type, where prompts and outputs are processed and any retained data must be verified per jurisdiction before an agent is enabled there (D-028). Agent memory and logs are cell data.

## Cost and operational implications
Model use is a small line in the scenarios compared with key custody and operations; the real cost is evaluation and gateway engineering. A cell without agents is cheaper but delivers less; the business case treats agent-attributed benefit as unproven.

## Reversibility
Yes. Agents can be added to or removed from a cell without changing the deterministic core, because they sit behind the gateway. That is the point of the decision.

## Validation evidence
None for production. The coding harness has permission, isolation and approval tests that demonstrate the pattern on the harness side only and must not be read as evidence for the production design. Planned: gateway catalogue and scope tests, approval-bypass tests, isolation tests and no-invention evaluations before release.

## Review gate
Reviewed in [RV-0003](../architecture/reviews/RV-0003-target-system-architecture.md): the gate computes Blocked. This ADR cannot be Accepted while that review is not Approved.

## Revisit when
Measurements show that agents add little beyond deterministic orchestration; D-028 finds no in-jurisdiction inference anywhere; D-008 defines L4 in a way that changes the catalogue boundaries; or the evaluation shows the no-invention bar cannot be met.

## Evidence
- [DES-0003](../architecture/designs/DES-0003-target-system-architecture.md), [01 Business capability map](../target-architecture/01-BUSINESS-CAPABILITY-MAP.md), [03 Architecture views](../target-architecture/03-ARCHITECTURE-VIEWS.md), [AGENT-AUTONOMY-MATRIX](../context/AGENT-AUTONOMY-MATRIX.md).
- No evidence records for production behaviour exist.
