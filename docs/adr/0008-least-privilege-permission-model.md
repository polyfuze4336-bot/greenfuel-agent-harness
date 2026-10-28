# ADR 0008: Least-privilege permission model for the coding harness

- **Status:** Proposed
- **Type:** Governance
- **Date:** 2026-10-28
- **Deciders:** Programme owner (not yet decided)
- **Supersedes:** none

## Context
- FACT: The owner asked for a least-privilege model across three dimensions (agent identity, tool and operation, target environment and data class), five tiers P0 to P4, default denials (unknown tools and operations, cross-jurisdiction movement, cross-shipowner disclosure, secret extraction, destructive cloud operations, protected-branch changes, unreviewed deployments, autonomous filings and settlements), approvals that escalate by tier, and enforcement through real mechanisms rather than Markdown.
- FACT: Observed 2026-10-28 with `gh api` (read-only): GitHub branch protection and rulesets return HTTP 403 on this private repository on the current plan, so they cannot be applied.
- FACT: Nothing in Azure exists (decision D-037 is open), so Azure RBAC and scoped identities can be specified but not created.
- FACT: Agents run as the developer's operating-system user, so file permissions cannot restrain them.
- FACT: Hooks load only in a trusted folder, see only Copilot tool calls, and fail open on timeout in Copilot CLI 1.0.105 ([ENFORCEMENT-STATUS](../security/ENFORCEMENT-STATUS.md)).
- ASSUMPTION: Approval lifetimes, use counts and approver counts (P2 1 approver, 24 hours, 5 uses; P3 1, 8 hours, 3; P4 2, 1 hour, 1) are placeholder proposals for the owner to confirm; they are not derived from any external requirement.

## Options considered
1. **Markdown policy only.** Rejected: the owner stated a Markdown policy is not enforcement.
2. **Rely on GitHub branch protection, Azure RBAC and OS permissions.** The right long-term answer, but none can be applied today (plan limit, no subscription, same OS user).
3. **A policy-as-code engine called by the native hooks, signed approvals, an audit chain, validators and tests, with the unavailable mechanisms specified and verified read-only (chosen).** Uses native hooks and tool lists for what they can do, adds custom code only for classification, approval verification and audit, and states plainly what stays human procedure.
4. **A container or separate-account sandbox for all sessions.** Strongest and the only true boundary for shell access, but it needs owner decisions on tooling and a user account (T15); recorded as the next step rather than assumed.

## Decision
Proposed for approval:
- Adopt [permissions.json](../../harness/policy/permissions.json) as the policy-as-code source: tiers P0 to P4, environments, per-agent ceilings (P0 or P1 only, none for Azure), operations with tiers, classifiers, path classes, default rules DEF-01 to DEF-09 and extra rules CTL-01 and EXEC-01.
- Enforce through [permission-engine.cjs](../../harness/hooks/permission-engine.cjs), called by the agent-scoped guard, the repository-wide guard and the output hook; deny unknown tools and operations for named agents; apply the always-on denials to every session.
- P2 and above require a signed, expiring, scoped, use-limited approval naming exact agents and operations, verified with Ed25519 against a registry of public keys. The registry is empty, so every P2+ operation by an agent is denied until the owner registers approvers. P4 needs two distinct approvers and is never implied by a lower-tier approval. Some operations are never grantable to an agent.
- Phase 0 permits no Azure or remote change whatever the approval.
- Record every denial in a hash-chained, content-free audit log.
- Specify, but do not create, Azure identities with a custom role excluding delete and authorization writes ([azure-identities.json](../../harness/policy/azure-identities.json)); specify GitHub protection with a read-only verifier and CODEOWNERS ([github-protection.json](../../harness/policy/github-protection.json)). Neither is applied.
- Refuse shell commands built at run time as a never-grantable operation, classify direct ARM REST calls and Az PowerShell, and refuse egress in sessions scoped to isolated data.
- Validate the model with `validate-permissions`, run negative tests in CI and treat [ENFORCEMENT-STATUS](../security/ENFORCEMENT-STATUS.md) as the authoritative list of what is enforced.

## Consequences
- No agent can currently do anything at P2 or above; the owner must register approvers first (T13).
- The default human session is screened, not sandboxed; the screen is a heuristic and not an authorization boundary. Real isolation is T15.
- GitHub branch protection, Azure RBAC and OS isolation remain unenforced until the owner acts (T14, T17, T15).
- Classifier rules and approval limits are control-plane files; changing them is a human, reviewed change. Maintaining the classifier is ongoing work as new evasions are found.
- Some legitimate commands (`npx`, inline interpreters, nested shells) are refused by named agents and default sessions; use a script under `tests/` or the validators instead.

## Reversibility
High for the code and policy: they can be removed or tightened independently. The approval record format is versioned (`greenfuel.approval/v1`); changing it invalidates old records, which is acceptable because none exist.

## Revisit when
Branch protection becomes available; an Azure subscription and identities exist; an approver is registered; a sandbox is adopted; Copilot changes hook behaviour (timeouts, trust, agent identity in the payload); or a new bypass is found.

## Evidence
Automated: negative tests for the five requested scenarios plus filings, protected branches and audit tamper detection; engine, approval, audit, GitHub-comparison and validator mutation tests. Live: the five scenarios in Copilot CLI 1.0.105 with Azure CLI pointed at an empty configuration, recorded in [NEGATIVE-TESTS](../security/NEGATIVE-TESTS.md), including the limit that no hook denial was produced for a delegated delete because the models declined it themselves. An independent model review found three real bypasses (run-time-built commands, direct ARM REST, run-time-built paths in a scoped session); all were fixed with regression tests, and two limits were documented, not fixed (output filter provenance, built-in GitHub MCP in a default session). These tests show the controls act as described in the tested setup; they do not show that no bypass exists.
