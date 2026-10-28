# ADR 0006: Specialist custom-agent roster and enforcement model

- **Status:** Proposed
- **Type:** Governance
- **Date:** 2026-10-28
- **Deciders:** Programme owner (not yet decided; see TODO T6)
- **Supersedes:** none. Replaces the earlier `architect`, `reviewer` and `design-challenger` agent files, which were consolidated into this roster.

## Context
- FACT: The owner asked for specialist agents with least-privilege tools, no circular delegation, separation of planners from agents that modify files or call tools, and a validation utility. The owner also said not to assume supported features and to use executable checks where native enforcement is unavailable.
- FACT: Supported custom-agent frontmatter and the hook format were inspected on 2026-10-28; sources are listed in `harness/policy/agent-policy.json`. Native features carry tool lists, the `agents` list, invocation flags and agent-scoped `hooks`. There is no native per-path write scoping and no native command allow-list.
- FACT: Live tests in Copilot CLI 1.0.105 observed guard denials and a read-only delegation ([DEMO-READONLY-DELEGATION](../agents/DEMO-READONLY-DELEGATION.md)). VS Code chat was not driven.
- ASSUMPTION: The roster is the right decomposition. It mirrors the owner's list and adds one agent (`design-reviewer`).

## Options considered
1. **Prompts only.** Smallest, but restraint would rest on instructions a model can ignore.
2. **Native tool lists, plus a policy file, an agent-scoped guard hook and a validator (chosen).** Uses native features for what they cover and executable checks for the rest.
3. **A custom orchestration runtime.** Stronger control, but it replaces native capability, adds dependencies and a maintenance burden, and no documented requirement needs it.

## Decision
Proposed for approval: adopt the twelve-agent roster in [AGENT-ROSTER](../agents/AGENT-ROSTER.md):
- Three classes: planners (read-only), authors (edit only their own folders, no commands), executors (anchored single-command allow-list plus a narrow edit scope).
- Only the orchestrator delegates, one level deep. It cannot be selected by other agents. Specialists return to it.
- `agent-policy.json` is the source of truth. Each agent file must match it. `validate-agents.mjs` and `agent-guard.cjs` carry the checks the platform does not. Both are covered by unit and mutation tests.
- Product-code write scopes stay closed until a human raises the phase.
- Features judged unsupported or not portable are rejected by the validator (handoffs, MCP servers, model pinning, and others).

## Consequences
- Role changes are control-plane changes and need human approval. Changing a role means editing the policy and the file together.
- The guard is a guardrail, not a sandbox. It needs a trusted folder; a timeout fails open; a model can still write a wrong document inside its own scope. Review and the design-review gate remain the controls on content.
- The roster does not make any design approvable. No decider is named (TODO T3), so approval remains impossible by design.
- Not observed: VS Code chat behaviour, a write attempted inside a delegated subagent, and native `agents` allow-list enforcement on its own. These are tracked in TODO T9.

## Reversibility
High. The agents, policy, hook and validator can be removed together without affecting the baseline, the governance capability or the evidence records.

## Revisit when
Copilot changes agent or hook behaviour (the validator has a version check), a role proves too narrow or too wide in real use, the product code layout is decided (open question Q8), or any observation in TODO T9 contradicts this ADR.

## Evidence
Unit and mutation tests for the guard and validator, a clean validator run, and the live observations in the demo record. These show the controls act as described in the tested versions. They do not show that the agents produce good designs.
