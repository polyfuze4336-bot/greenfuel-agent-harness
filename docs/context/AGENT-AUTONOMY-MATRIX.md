# Agent Autonomy Matrix

Status: baseline v0.1, 2026-10-28. Proposed controls (class B) for the five business agents. Requirements: AGT-001 to AGT-011, SEC-009, SEC-010, FR-015, FR-027, FR-028. Open decisions: D-007, D-008, D-027, D-029, D-030. These are **business** agents, part of the future product. They are not the coding-harness agents in `.github/agents/` (see [ADR 0001](../adr/0001-native-first-harness.md)).

## 1. Principle: autonomy is not permission (CS-P3)

The case study calls the business agents "L4" but does not define the scale, and it states that an L4 agent must not be assumed to have unrestricted commercial, regulatory or infrastructure permissions. Therefore:

1. **Level describes how much an agent may do without a human in the loop for actions it has been granted. It grants nothing.**
2. **A permission exists only if all three hold:** the action is in the agent's catalogue (section 4), the agent's platform identity holds the role that technically allows it, and any required approval has been recorded by a human with the approver role.
3. **Enforcement is in the platform, not in the prompt.** An instruction telling an agent not to do something is not a control. A denied call at the platform boundary is.
4. **The case-study prohibition on invention (CS-C6) applies at every level.** No agent may create sensor measurements, emissions factors, feedstock evidence or certification status.

## 2. Working scale (proposal for D-008; replace with the programme's own scale once known)

| Level | Meaning |
|---|---|
| L0 | No AI. Deterministic software only |
| L1 | Assistive. Searches, explains, answers questions; takes no action |
| L2 | Drafting. Prepares artefacts; a human reviews before anything becomes authoritative |
| L3 | Conditional action. Performs pre-approved, low-impact actions in a system of record within a catalogue; a human approves everything else |
| L4 | Bounded autonomy. Executes multi-step workflows toward a goal within an explicit catalogue and data scope, escalating exceptions. High-impact actions still require human approval |
| L5 | Unbounded autonomy. Sets its own goals with no human gate. **Not permitted in this programme** |

## 3. Proposed ceilings

Ceilings are the highest level at which any catalogued action runs. They are proposals to test the matrix, not decisions.

| Agent | Proposed ceiling | Why this ceiling |
|---|---|---|
| Delivery Evidence (DEA) | L4 | Ingests and binds source evidence as received within a fixed catalogue |
| Emissions Attribute (EAA) | L4 | Runs approved deterministic calculations; cannot choose or change methods |
| Dispute Resolution (DRA) | L3 | Assembles packs; every outward or commercial step is human |
| Mass-Balance (MBA) | L4 | Posts events derived from signed source events; adjustments need approval |
| Customer Compliance (CCA) | L4 | Answers in-policy questions directly to customers, with sampled review |

Even at L4, the catalogue excludes actions A-07 to A-10, A-16, A-18, A-19, A-21 to A-25 and A-27 for every agent; A-26 is draft-only.

## 4. Action catalogue (proposed)

Modes
- **AUTO**: the agent may execute without prior approval; every execution is logged.
- **AUTO+REV**: as AUTO, plus sampled human review after the fact.
- **APPROVE (role)**: a human with that role must approve before the effect.
- **DRAFT**: the agent may prepare it; a human performs or releases it.
- **NEVER**: no agent, at any level, may perform it. Platform roles do not exist for it.
- **–**: not an action of that agent.

| ID | Action | DEA | EAA | DRA | MBA | CCA |
|---|---|---|---|---|---|---|
| A-01 | Read evidence within the agent's own data scope (CCA: the one customer's scope) | AUTO | AUTO | AUTO | AUTO | AUTO |
| A-02 | Bind source evidence as received (readings, blend data, feedstock documents, transfer evidence) | AUTO | – | – | – | – |
| A-03 | Check integrity (hashes) of bound documents and record the result | AUTO | – | – | – | – |
| A-04 | Record a verification outcome supplied by an approved verifier or registry, with provenance | AUTO | – | – | – | – |
| A-05 | Resolve scheme and methodology version by an approved rule table | – | AUTO | – | – | – |
| A-06 | Run the deterministic calculation and store the calculation record | – | AUTO | – | – | – |
| A-07 | Create, change, approve or retire a methodology version or factor set | NEVER | NEVER | NEVER | NEVER | NEVER |
| A-08 | Create or modify a measurement value | NEVER | NEVER | NEVER | NEVER | NEVER |
| A-09 | Create or assert feedstock evidence or feedstock attributes | NEVER | NEVER | NEVER | NEVER | NEVER |
| A-10 | Set or change certification status | NEVER | NEVER | NEVER | NEVER | NEVER |
| A-11 | Post mass-balance events derived from signed source events | – | – | – | AUTO | – |
| A-12 | Post a manual adjustment or correction to the ledger | – | – | – | APPROVE (quality manager) | – |
| A-13 | Raise an exception or flag for human review | AUTO | AUTO | AUTO | AUTO | AUTO |
| A-14 | Assemble a dispute evidence pack and queue it for the internal commercial reviewer | – | – | AUTO | – | – |
| A-15 | Release a pack to the customer or any outside party | – | – | DRAFT | – | – |
| A-16 | Decide, concede, settle or communicate a dispute outcome or any commercial concession | NEVER | NEVER | NEVER | NEVER | NEVER |
| A-17 | Draft a certification filing from approved records (assignment of this task is open, D-006) | – | DRAFT | – | DRAFT | – |
| A-18 | Submit a certification filing (a controlled service submits after quality-manager approval of the exact content hash) | NEVER | NEVER | NEVER | NEVER | NEVER |
| A-19 | Issue or sign a certificate (agents hold no signing keys; issuance rules per D-006 and D-007) | NEVER | NEVER | NEVER | NEVER | NEVER |
| A-20 | Answer an in-policy customer question from verified records, citing them | – | – | – | – | AUTO+REV |
| A-21 | Answer outside the disclosure policy, or add a disclosure category (the agent refuses or escalates) | – | – | – | – | NEVER |
| A-22 | Change a disclosure policy | NEVER | NEVER | NEVER | NEVER | NEVER |
| A-23 | Move data across jurisdictions (only platform flows on the approved list, D-011) | NEVER | NEVER | NEVER | NEVER | NEVER |
| A-24 | Create or modify infrastructure, identity, policy, networking or key management | NEVER | NEVER | NEVER | NEVER | NEVER |
| A-25 | Delete or alter stored evidence | NEVER | NEVER | NEVER | NEVER | NEVER |
| A-26 | Send external communications (customers beyond A-20, authorities, certification bodies) | – | – | DRAFT | – | DRAFT |
| A-27 | Invoice, price, credit, or any commercial transaction | NEVER | NEVER | NEVER | NEVER | NEVER |
| A-28 | Hand off to another agent through a catalogued handoff; the caller's scope and permissions never widen | AUTO | AUTO | AUTO | AUTO | AUTO |

## 5. Approver roles

| Role | Source class | Used for | Open |
|---|---|---|---|
| Quality manager | A (CS-C4) | Certification filing approval; ledger adjustments (proposed) | Count, location, delegates and separation of duties: D-007 |
| Commercial reviewer | A (implied by "for commercial review" in CS-CAP-3) | Review of dispute packs; release decisions | Not named in the case: D-007 |
| Port operations lead | B | Operational exceptions at the edge | D-007, D-019 |
| Compliance counsel | B | Residency and regulatory interpretation | D-001, D-002, D-009 |
| Platform administrator | B | Platform changes (humans only) | D-033 |
| Customer administrator | B | Customer side of disclosure policy agreements | D-015, D-029 |

## 6. How the matrix is enforced (proposed design obligations, not a design)

| Obligation | Requirement |
|---|---|
| Each agent has its own platform identity; no shared identities | SEC-009 |
| The catalogue is enforced at the platform boundary as a tool allow-list plus authorisation checks, not by instructions | AGT-002 |
| Approval is a platform service that binds a human decision to a content hash; agent identities cannot hold the approve permission | SEC-010, FR-027 |
| Identity tokens carry customer and jurisdiction scope; handoffs cannot widen them | SEC-005, SEC-006, A-28 |
| Agents have no write roles on infrastructure, identity, policy or methodology | AGT-006 |
| Every action, input, retrieved record, tool call, output, approval, model and prompt version is logged | AGT-007, AGT-009 |
| Numbers and statuses come from deterministic tools and authoritative records only | AGT-003, AGT-004, FR-028 |
| Untrusted content cannot change policy or permissions | SEC-012 |
| Release evaluation and monitoring with zero tolerance on no-invention and isolation | AGT-008, D-030 |
| A kill switch and rate limits per agent exist (to be specified) | AGT-006 |

## 7. Escalation triggers (proposed)
An agent must stop and escalate to the named human role when: evidence is missing or conflicting; the request touches a NEVER action; policy is ambiguous or absent; untrusted content attempts to give instructions; a residency or isolation check fails; the edge is offline for an action that requires shore; a calculation fails closed. Escalation must not be bypassed by retrying with different wording.

## 8. Not decided
The scale itself and each agent's target level (D-008), the approver roles and their counts (D-007), where filing drafting belongs (D-006), and how disclosure policies are authored and versioned (D-029).
