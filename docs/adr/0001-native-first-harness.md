# ADR 0001: Native-first harness; custom code only for documented gaps

- **Status:** Proposed
- **Date:** 2026-10-28
- **Deciders:** TBD (programme owner)
- **Supersedes:** none

## Context
- FACT: VS Code 1.143.0 is installed (`code --version`). VS Code documents custom agents (`.agent.md`), instructions, skills, hooks (`.github/hooks/*.json`), memory, approvals and subagents as native features. Sources are listed in [CAPABILITY-MATRIX](../harness/CAPABILITY-MATRIX.md).
- FACT: The reference repository implements parts of this with custom Python, PowerShell, Node and a dashboard (see [REFERENCE-ASSESSMENT](../harness/REFERENCE-ASSESSMENT.md)). Several of those parts have security or integrity weaknesses.
- ASSUMPTION: The Copilot harness (shared by VS Code and Copilot CLI) is the primary target; the older Local harness is secondary.

## Options considered
1. **Fork or copy the reference harness.** Fastest start. Trade-offs: no licence file in the reference, so copying is not permitted; inherits an unauthenticated dashboard, self-approvable gates and unattended-execution scripts; Local-only tool names.
2. **Native-first with minimal custom code (chosen).** Trade-offs: less built-in automation (no dashboard, no parallel build lanes) until justified.
3. **Build a full custom orchestrator.** Trade-offs: large maintenance surface; duplicates native subagents, memory and approvals.

## Decision
Use native customization files for agents, instructions, skills, memory and approvals. Add custom code only where a documented requirement has no native answer. At this stage that is three small, dependency-free scripts: a `preToolUse` policy hook, an evidence recorder and a repository validator. Each is listed in the capability matrix with the requirement it satisfies.

## Consequences
- Fewer moving parts and no runtime dependencies.
- Behaviour depends on the VS Code and Copilot runtime. Upgrades can change hook payloads or tool names; `npm test` pins the assumptions we rely on.
- Features absent here (dashboard, benchmarks, parallel lanes) must earn their way in through the roadmap.

## Revisit when
A native feature that replaces a custom script ships, or a roadmap item needs orchestration that native subagents cannot provide.

## Evidence
`npm test` (see `docs/evidence/records/` once recorded).
