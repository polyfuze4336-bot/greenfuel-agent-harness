# Implementation Roadmap

Scope: the **harness**. The product architecture and application are separate stages that this harness will support; they are listed only as downstream context. Each item has exit criteria stated as observations, and nothing is marked done without a recorded observation (see [STATE](../state/STATE.md)).

Status legend: **Done** (observed), **Written** (files exist, not observed live), **Planned**.

## Stage 0: Foundation (this stage)

| Item | Status |
|---|---|
| Reference assessment with evidence | Done: [REFERENCE-ASSESSMENT](REFERENCE-ASSESSMENT.md) |
| Repo structure, AGENTS.md, two agents, three skills, two instruction files | Written; validator passes |
| Policy hook, evidence recorder, validator, tests | Done for unit tests; hook Written, not observed live |
| CI workflow | Written; not run (no remote) |
| ADR 0001 and 0002 | Accepted 2026-10-28 by the programme owner |

**Gate to leave Stage 0:** passed 2026-10-28. The owner accepted ADR 0001 and ADR 0002. R1 was approved to run.

## Stage 1: Prove it works in a real session

| ID | Work | Exit criteria (observable) | Approval needed |
|---|---|---|---|
| R1 | Live-session verification of hooks, agents, skills and instructions in VS Code 1.143.0, in both Copilot and Local harnesses | **Partly done 2026-10-28** in Copilot CLI only ([LIVE-TEST-R1](LIVE-TEST-R1.md)): hook denies in a trusted folder, does nothing in an untrusted one. Remaining: VS Code chat (both harnesses), planners cannot edit, skills and instructions load, `ask` path. Failing cases recorded as findings | Owner runs or watches the VS Code session |
| R1b | Hook-active canary and trust prerequisite | README states the trust prerequisite and a one-line canary the user runs (ask the agent to run `azd up`; a `HARNESS-POLICY` denial means hooks are active). Optionally a SessionStart hook that injects a visible banner | Owner |
| R2 | Azure access model for agents: read-only identity, subscription and tenant scoping, Azure MCP allow-list per agent | ADR Accepted; Azure RBAC shows no write role for the agent identity (read-only query result recorded); allow-list written into agent `tools`. **Prepared 2026-10-28:** the Azure MCP server is a pinned, reviewed, unconfigured candidate with a read-only start and an approval procedure ([MCP-SECURITY](MCP-SECURITY.md)). Still needs the owner's sign-in approval and D-037 | Subscription owner |
| R3 | Isolation: evaluate terminal sandbox, dev container and assisted permissions | ADR with test results on this Windows machine; chosen mechanism documented in HARNESS-ARCHITECTURE | Owner |
| R4 | GitHub remote with branch protection, required CI, secret scanning, CODEOWNERS on control-plane paths, and an approver registry | Remote exists (done 2026-10-28, private). Still to do: protection rules listed from the API; required review and CODEOWNERS on `docs/architecture/`, `docs/adr/`, `harness/` and `.github/hooks/`; an approver registry for CP4 decisions (RK-011, RK-014) | Owner authorises the rules |

## Stage 2: Use the harness for design (not harness building)

**Started 2026-10-28 with the requirements baseline** in [docs/context/](../context/) (see [DECISION-REGISTER](../context/DECISION-REGISTER.md) for what blocks the next step). Product architecture work (options analysis, ADRs, VCDX-style design artefacts) uses `architect` and `reviewer`. It cannot begin options analysis until the 17 M1 decisions in the register are answered or explicitly deferred by the owner. Output goes to `docs/`. Phase stays 0 until an ADR accepts a reference architecture and proposes raising it.

| ID | Work | Exit criteria | Approval |
|---|---|---|---|
| R11 | Live test of context loading: give a specialist agent a task under each of three profiles and check the `Context:` line against what it actually read | Recorded results show whether agents follow the procedure; if not, a documented gap justifies a context-pack generator (ADR 0001) | Owner |
| R12 | Live test of the review roles: run `design-reviewer` and `architecture-critic` on a new design in VS Code and compare with the gate | Recorded results show whether the roles follow the skills, avoid editing outside their folders, and never set Approved | Owner |
| R15 | Run loop checks in a sandbox (a dev container or a separate account without Azure and Git credentials) so code under test cannot subvert the test runner or touch the machine; then consider letting a constrained agent run loop commands (T24) | Sandbox design, ADR, tests that a hostile fixture is contained | Owner |
| R14 | Authenticate human memory writers: require a signed approval record, verified by the memory store with the permission model's signing and registry, for approve, supersede and invalidate | Approver keys registered (T13); store change, tests with synthetic keys, ADR 0010 follow-up | Owner |
| R13 | Sibling designs that DES-0001 depends on, in this order: certificate hosting and signing; edge security and platform; identity and roles; customer isolation; retention and recovery; non-production environments; evidence-package completeness and reconstruction; calculation and methodology distribution | Each has a design, a review and a Design ADR, and the gate result is recorded. None can be Approved until its M1 and M2 decisions are answered | Owner |

## Stage 3: Harness measurement and learning (only if needed)

| ID | Work | Exit criteria | Approval |
|---|---|---|---|
| R5 | Harness evaluations: small task set with fixtures that measure agent behaviour (without allow-all) | Baseline results recorded with date, model and settings; regressions detectable | Owner |
| R6 | Memory curation: decide whether native memory plus STATE.md is enough, or a promotion workflow is needed | ADR; if a workflow is adopted, it is human-gated and tested against injected content | Owner |
| R7 | Retrospective loop over session history | Design that treats transcripts as untrusted input and never writes to instructions without a human diff review | Owner |

## Stage 4: Implementation phase (after the product architecture is accepted)

| ID | Work | Exit criteria | Approval |
|---|---|---|---|
| R8 | Implementation-phase harness: raise phase via ADR; add build-lane agents, TDD, coding-style and observability instructions; bounded-iteration rule; business agents under `src/` with their own identity and evaluation | Phase change is a reviewed commit; harness and business agent folders remain separate (validator-enforced); first change passes CI | Owner (phase change), reviewer agent plus human (merge) |
| R9 | Requirements intake from client sources, including any Microsoft 365 retrieval | Data-handling ADR Accepted (Q7); retrieval scoped and logged | Data owner |
| R10 | Plugin and marketplace policy | List of allowed sources; review checklist | Owner |

## What will not be built without a new decision
A dashboard, a custom orchestrator, a custom memory store, unattended or headless runs with allow-all, any autonomous deployment, any Azure resource creation by an agent.

## Dependencies and risks
- R1 gates trust in everything labelled "Written". If hooks do not fire in the real session, ADR 0002 must be revisited before any later stage.
- R2 and R4 need the owner's Azure and GitHub authority; the harness cannot grant these to itself.
