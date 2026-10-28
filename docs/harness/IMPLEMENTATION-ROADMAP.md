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
| ADR 0001 and 0002 | Proposed; awaiting human acceptance |

**Gate to leave Stage 0:** the owner reviews this repository and accepts ADR 0001 and 0002 (or rejects with changes). No automatic progression.

## Stage 1: Prove it works in a real session

| ID | Work | Exit criteria (observable) | Approval needed |
|---|---|---|---|
| R1 | Live-session verification of hooks, agents, skills and instructions in VS Code 1.143.0, in both Copilot and Local harnesses | A written test script and results showing: hook fires for shell and edit tools; deny and ask appear as documented; `architect` has no shell; `reviewer` cannot edit; skills load; failing cases recorded as findings, not hidden | Owner runs or watches the session |
| R2 | Azure access model for agents: read-only identity, subscription and tenant scoping, Azure MCP allow-list per agent | ADR Accepted; Azure RBAC shows no write role for the agent identity (read-only query result recorded); allow-list written into agent `tools` | Subscription owner |
| R3 | Isolation: evaluate terminal sandbox, dev container and assisted permissions | ADR with test results on this Windows machine; chosen mechanism documented in HARNESS-ARCHITECTURE | Owner |
| R4 | GitHub remote with branch protection, required CI, secret scanning, CODEOWNERS on control-plane paths | CI run green on a pull request, recorded; protection rules listed from the API | Owner creates or authorises the remote |

## Stage 2: Use the harness for design (not harness building)

Product architecture work (requirements, constraints, options, ADRs, VCDX-style design artefacts) using `architect` and `reviewer`. It needs [OPEN-QUESTIONS](OPEN-QUESTIONS.md) Q7 and Q12 answered first. Output goes to `docs/`. Phase stays 0 until an ADR accepts a reference architecture and proposes raising it.

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
