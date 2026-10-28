# ADR 0002: Phase gating and human-approval enforcement via hooks

- **Status:** Accepted (2026-10-28, programme owner, by instruction in chat after reviewing the Stage 0 summary)
- **Date:** 2026-10-28
- **Deciders:** Programme owner
- **Supersedes:** none

## Context
- FACT: The brief forbids autonomous production deployment and forbids building the bunkering application yet.
- FACT: VS Code "Allow all" and Autopilot skip approval prompts ([approvals](https://code.visualstudio.com/docs/agents/run/approvals)). Instructions alone cannot enforce a prohibition on a model that has those modes enabled.
- FACT: Per the Copilot hooks reference, a command `preToolUse` hook can allow, deny or modify a tool call; a crash or non-zero exit denies; a timeout fails open; `ask` is treated as deny when no user can answer.
- FACT: The reference harness stores approvals in a JSON file the gated agent can write (see REFERENCE-ASSESSMENT, finding S2).
- ASSUMPTION: Hook behaviour under the user's exact VS Code build matches the documentation. Not yet observed in a live session (see OPEN-QUESTIONS Q4).

## Options considered
1. **Instructions only.** Trade-offs: bypassed by Allow all, prompt injection or model error.
2. **`preToolUse` hook with a data-driven policy and a phase flag (chosen).** Trade-offs: pattern matching is evadable by a determined shell command, timeouts fail open, and it adds a Node dependency on the host.
3. **OS or container sandbox.** Strongest isolation. Trade-offs: more setup; Windows sandbox support is unverified (OPEN-QUESTIONS Q5). Planned as a roadmap item, not a replacement.

## Decision
- Phase is a field in `harness/policy/command-policy.json`. In Phase 0 the hook denies writes to application and IaC paths and any Azure mutation.
- Approvals are not stored in a file agents can write. A human approves by setting an ADR to `Accepted` and by editing the control-plane files, which the hook marks as requiring approval.
- Hook, policy, workflows and recorder scripts are control-plane: agent edits need a human decision.

## Consequences
- The guard is a speed bump and an audit aid, not a security boundary. Defence in depth: VS Code approval settings, sandboxing where available, Azure RBAC that gives agents no write role, and CI that re-runs checks outside the agent's session.
- Raising the phase is a deliberate, reviewable edit.

## Revisit when
Live testing shows hooks do not fire in the user's session type, or a native phase/permission feature replaces this.

## Evidence
Unit tests in `tests/policy-guard.test.mjs`. Live test in Copilot CLI 1.0.102 on 2026-10-28 ([LIVE-TEST-R1](../harness/LIVE-TEST-R1.md)): with the folder trusted the hook denied `azd up` and a write to `src/`; with the folder untrusted the hook did not run and `azd up` executed. Consequence accepted into this ADR: **enforcement exists only in trusted folders where hooks are loaded**, so the hook must be paired with a user-run canary, CI and review. VS Code chat has not been tested.
