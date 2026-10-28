# TODO

Owner-facing list of pending answers and approvals. Items are removed only when answered and reflected in an ADR or the relevant document. The engineering backlog is in [IMPLEMENTATION-ROADMAP](../harness/IMPLEMENTATION-ROADMAP.md); this file is for things only the owner can supply.

## Owner has deferred ("will answer later", 2026-10-28)

| # | Item | Source | Blocks |
|---|---|---|---|
| T1 | Answer harness open questions Q1-Q13 | [OPEN-QUESTIONS](../harness/OPEN-QUESTIONS.md) | R1-R4, R9 |
| T2 | Answer stakeholder clarification items in the unresolved decision register (all `Open` entries). **Deferred by the owner on 2026-10-28.** Until answered, no design can be Approved: the gate blocks on every open M1 and M2 decision linked to an in-scope Must requirement | [DECISION-REGISTER](../context/DECISION-REGISTER.md) | Stage 2 design approval |
| T3 | Name the deciders for ADR acceptance, phase changes, CP4 design approval and each approval role (quality manager, commercial reviewer, data owner, compliance counsel). **Deferred again by the owner on 2026-10-28.** Until done, the gate cannot produce a valid Approved status, so no design can be Approved | Q3, D-007, [ADR 0005](../adr/0005-approve-architecture-governance-v0-1.md) | Any design approval or approval workflow |
| T4 | Confirm which standards and regulations are in scope, and nominate a qualified person to verify candidate citations. This also decides which standards-body hosts may be added to the web fetch allow-list (registry entry `docs-standards-hosts`) | [CERTIFICATION-SCHEMES](../context/CERTIFICATION-SCHEMES.md), D-001, D-002 | Any compliance claim; reading standards sites |
| T5 | Decide whether to move the repository out of the OneDrive-synced folder | Q1 | Repository reliability |
| T8 | Run or watch the remaining R1 checks in VS Code chat, the R11 context-loading test and the R12 review-role test | [IMPLEMENTATION-ROADMAP](../harness/IMPLEMENTATION-ROADMAP.md) | Trust in the guardrails, the context strategy and the review roles |
| T9 | Agent checks not yet observed: agent-scoped hooks in VS Code chat; a write attempted inside a delegated subagent; native `agents` allow-list enforcement on its own (the hook acted first in the test); a second delegation run on a different design to judge consistency. **Deferred by the owner on 2026-10-28** | [DEMO-READONLY-DELEGATION](../agents/DEMO-READONLY-DELEGATION.md), [ADR 0006](../adr/0006-specialist-agent-roster-and-enforcement.md) | Relying on agent restrictions beyond the Copilot CLI |
| T11 | Decide whether and when to approve the pending MCP candidates (Azure MCP pinned to 3.0.0; GitHub MCP read-only), which means approving Azure and GitHub sign-in, the read-only role and the subscription (D-037). Nothing was installed, started or authenticated. **Deferred by the owner on 2026-10-28** | [MCP-SECURITY](../harness/MCP-SECURITY.md) section "Approving a candidate" | Any Azure or GitHub reading by an agent; Azure Monitor and Application Insights diagnostics |
| T12 | Verify in VS Code chat: MCP server start and trust prompts, `server/tool` entries in agent `tools:`, and the output hook; also whether the CLI kills a server at its timeout. **Deferred by the owner on 2026-10-28** | [TOOL-COMPATIBILITY](../harness/TOOL-COMPATIBILITY.md) | Relying on the tool layer outside the Copilot CLI |

## Decisions made

| Date | Decision | Recorded in |
|---|---|---|
| 2026-10-28 | ADR 0001 and ADR 0002 accepted | [ADR 0001](../adr/0001-native-first-harness.md), [ADR 0002](../adr/0002-phase-gating-and-approval-enforcement.md) |
| 2026-10-28 | GitHub repo `polyfuze4336-bot/greenfuel-agent-harness`, private, owner is the authenticated `gh` account | [STATE](STATE.md) |
| 2026-10-28 | Roadmap item R1 (live-session verification) approved to run | [IMPLEMENTATION-ROADMAP](../harness/IMPLEMENTATION-ROADMAP.md) |
| 2026-10-28 | Requirements baseline v0.1 approved; the 37 decisions stay open and deferred | [ADR 0003](../adr/0003-adopt-requirements-baseline-v0-1.md) |
| 2026-10-28 | The two baseline commits pushed to the private repo; CI succeeded | [STATE](STATE.md) |
| 2026-10-28 | Governance commits pushed; CI succeeded on `90245f3` | [STATE](STATE.md) |
| 2026-10-28 | Architecture governance capability v0.1 approved (process only; DES-0001 and ADR 0004 not approved) | [ADR 0005](../adr/0005-approve-architecture-governance-v0-1.md) |
| 2026-10-28 | Governance commit pushed (owner approval); naming deciders deferred again (T3) | [STATE](STATE.md) |
| 2026-10-28 | Tool layer approved (ADR 0007 Accepted); the two tool-layer commits pushed; Azure and GitHub MCP candidates (T11) and VS Code tool checks (T12) deferred | [ADR 0007](../adr/0007-tool-layer-mcp-and-output-controls.md) |
| 2026-10-28 | Specialist agent roster approved (ADR 0006 Accepted); the three agent commits pushed; CI succeeded on `2f52908`; remaining agent checks deferred (T9) | [ADR 0006](../adr/0006-specialist-agent-roster-and-enforcement.md) |
