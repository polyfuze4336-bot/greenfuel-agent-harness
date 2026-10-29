# Agent connectivity and relationships

How the twelve coding-harness specialist agents connect to each other, to their tools and to the control plane. These are **coding-harness agents**. The five production business agents (Delivery Evidence, Emissions Attribute, Dispute Resolution, Mass-Balance, Customer Compliance) do not exist yet and are kept separate by design.

The source of truth is [agent-policy.json](../../harness/policy/agent-policy.json) and the files in [.github/agents](../../.github/agents). A test ([agent-connectivity.test.mjs](../../tests/agent-connectivity.test.mjs)) fails if an agent, a delegation or a prerequisite edge in the policy is missing from diagram 1 or from the table below, so this page cannot silently drift. The diagrams show what is configured and enforced by tests; they do not show observed behaviour in VS Code (TODO T9, T12, T38).

## 1. Agent roster, delegation and prerequisites

Solid arrows are native delegation (`agents:` allow-list, recorded by the delegation hook). Dotted arrows mean "its output is a prerequisite of" and are checked for cycles; they are not delegation. Only the orchestrator may delegate, and no agent may delegate back, so a cycle is impossible.

```mermaid
flowchart TB
  H(["Human owner<br/>approves P2+ actions, ADRs, phase changes"])
  ORC["orchestrator<br/>planner, read-only"]

  subgraph PLAN["Planners: read, search, no file writes, no commands"]
    MD["maritime-domain"]
    SR["security-reviewer"]
    AC["architecture-critic"]
  end

  subgraph AUTH["Authors: edit only inside their own write scope, no commands"]
    PA["principal-architect"]
    AZ["azure-platform"]
    DE["data-engineer"]
    APP["application-engineer"]
    AI["ai-engineer"]
    SRE["sre-engineer"]
  end

  subgraph EXEC["Executors: short command allow-list, narrow write scope"]
    QA["qa-engineer"]
    DR["design-reviewer"]
  end

  H --> ORC
  ORC ==>|delegates| PA
  ORC ==>|delegates| MD
  ORC ==>|delegates| AZ
  ORC ==>|delegates| APP
  ORC ==>|delegates| AI
  ORC ==>|delegates| DE
  ORC ==>|delegates| SR
  ORC ==>|delegates| SRE
  ORC ==>|delegates| QA
  ORC ==>|delegates| AC
  ORC ==>|delegates| DR

  MD -.-> PA
  MD -.-> DE
  PA -.-> AZ
  PA -.-> APP
  PA -.-> AI
  PA -.-> DE
  PA -.-> SR
  PA -.-> AC
  PA -.-> DR
  DE -.-> APP
  DE -.-> AI
  DE -.-> QA
  AZ -.-> SRE
  APP -.-> SRE
  APP -.-> QA
  AI -.-> QA
  AC -.-> DR
  SR -.-> DR

  classDef planner fill:#e8f1fb,stroke:#2b6cb0,color:#1a365d
  classDef author fill:#e6f6ec,stroke:#2f855a,color:#1c4532
  classDef executor fill:#fff4e0,stroke:#c05621,color:#7b341e
  classDef human fill:#fde8e8,stroke:#c53030,color:#742a2a
  class ORC,MD,SR,AC planner
  class PA,AZ,DE,APP,AI,SRE author
  class QA,DR executor
  class H human
```

| Agent | Class | May write (Phase 0) | May write once the owner raises the phase | Commands | Prerequisite inputs from |
|---|---|---|---|---|---|
| orchestrator | planner | nothing | nothing | none | none |
| principal-architect | author | designs, ADRs, risk register, state | nothing | none | maritime-domain |
| maritime-domain | planner | nothing | nothing | none | none |
| azure-platform | author | docs/design/azure | infra | none | principal-architect |
| application-engineer | author | docs/design/application | src/api, src/web, src/integration | none | principal-architect, data-engineer |
| ai-engineer | author | docs/design/ai | src/agents, evals | none | principal-architect, data-engineer |
| data-engineer | author | docs/design/data | src/data, src/calc, db | none | principal-architect, maritime-domain |
| security-reviewer | planner | nothing | nothing | none | principal-architect |
| sre-engineer | author | docs/design/operations, runbooks | ops | none | azure-platform, application-engineer |
| qa-engineer | executor | docs/design/test | tests/product | seven allow-listed | application-engineer, data-engineer, ai-engineer |
| architecture-critic | planner | nothing | nothing | none | principal-architect |
| design-reviewer | executor | architecture reviews | nothing | three allow-listed | principal-architect, architecture-critic, security-reviewer |

"Phase 0" is the current phase: design and governance only. The second write column is configured but inert until the owner raises the phase through an ADR (HC-11); nothing in this repository does that.

## 2. What each agent can reach

```mermaid
flowchart LR
  subgraph AG["Specialist agents"]
    A1["orchestrator"]
    A2["principal-architect"]
    A3["azure-platform"]
    A4["security-reviewer"]
    A5["architecture-critic"]
    A6["qa-engineer"]
    A7["other agents"]
  end

  subgraph MCP["MCP servers, read-only tools only"]
    GT["greenfuel-tools<br/>local, zero dependencies<br/>validators, trace, decisions, memory, run status"]
    ML["microsoft-learn<br/>remote documentation search"]
  end

  subgraph NOT["Candidates: not configured, not authenticated"]
    AZM["Azure MCP<br/>pinned and reviewed"]
    GHM["GitHub MCP<br/>read-only candidate"]
  end

  A1 -->|"plan, run status, memory"| GT
  A2 -->|"requirements, architecture, trace"| GT
  A3 -->|"sovereignty, readiness"| GT
  A3 -->|"approved hosts only"| ML
  A4 -->|"permissions, sovereignty, tools"| GT
  A5 -->|"architecture, requirements"| GT
  A6 -->|"all validators"| GT
  A7 -->|"trace, decisions"| GT
  A3 -.->|"blocked until T11, T33"| AZM
  A2 -.->|"blocked until T11"| GHM
```

Per-agent tool lists are in [TOOL-REGISTRY](TOOL-REGISTRY.md) and are generated from the registry, not written by hand.

## 3. Control plane around the agents

Everything an agent does passes through deterministic checks that are code, not prompts. The hook is a screen and not a security boundary: agents run as the user's operating-system account (TODO T15, roadmap R15).

```mermaid
flowchart TB
  U(["Human owner"])
  AGT["Specialist agent<br/>VS Code or Copilot CLI session"]

  subgraph HOOKS["Native hooks, run before and after every tool call"]
    PG["policy-guard<br/>permission engine and denial log"]
    AGD["agent-guard<br/>per-agent tools, write scope, MCP grants"]
    DG["delegation-guard<br/>delegation rules, run recording"]
    TOG["tool-output-guard<br/>redact secrets, strip hidden text, size cap, untrusted boundary"]
  end

  subgraph POL["Policy as code"]
    P1["permissions.json<br/>tiers P0 to P4"]
    P2["agent-policy.json<br/>roster and scopes"]
    P3["command, secret, orchestration,<br/>memory, loop, evaluation policies"]
    P4["approvers.json<br/>signed approvals, empty registry"]
  end

  subgraph STORE["Durable state, Git-versioned"]
    MEM["memory/<br/>decisions, lessons, task state, ledger"]
    RUN["task runs<br/>hash-chained history"]
    EVD["evidence records<br/>command, exit code, output hash, commit"]
    AUD["denied-action log<br/>local, hash-chained"]
  end

  subgraph VAL["Verification, executable"]
    VH["validate-harness and the specialist validators"]
    GATE["design gate<br/>hard-constraint screen and ten perspectives"]
    EV["evaluation<br/>73 tests, gates G1 to G7"]
    LOOP["repair loop<br/>3 repairs, 2 identical failures, then escalate"]
    CI["GitHub Actions<br/>validate, infra-validate, evaluation re-run"]
  end

  U -->|"approves"| AGT
  AGT --> PG --> AGD --> DG
  AGT --> TOG
  PG -.->|reads| POL
  AGD -.->|reads| POL
  PG -->|"denials"| AUD
  DG -->|"records"| RUN
  AGT -->|"reads, proposes"| MEM
  AGT -->|"claims"| EVD
  EVD --> VH
  VH --> GATE --> EV
  AGT --> LOOP
  LOOP --> EVD
  EV --> CI
  CI -->|"blocks on failure"| U
```

## 4. Where the six pillars sit

| Pillar | Components in the diagrams | Honest status |
|---|---|---|
| Tools | MCP servers, tool registry, tool-output-guard | Verified for local read-only tools; Azure and GitHub MCP not configured |
| Context | context-loading profiles, requirements baseline, hard constraints, design gate | Verified for consistency; live loading unverified (R11) |
| Execution | orchestrator, delegation-guard, task runs | Verified in Copilot CLI; VS Code owner-reported |
| Permissions | policy-guard, agent-guard, permission policy, approvers | Hook-level only; no sandbox, no real approver, no branch protection |
| Memory | memory store, ledger, task state | Verified with fixtures; no VS Code restart tested |
| Loop | repair loop, evidence records, evaluation | Verified in scenarios; no sandbox for code under test |

The full classification with evidence is in [HARNESS-ACCEPTANCE-REPORT](../acceptance/HARNESS-ACCEPTANCE-REPORT.md).

## 5. Comparison with the reference repository

The reference ([AICodingAgentHarness](https://github.com/astha29may/AICodingAgentHarness)) draws a single left-to-right pipeline of build agents: problem statement, architecture, plan, parallel build, verification, with an iterate-or-pass loop back to the build orchestrator and then documentation. This harness differs on purpose: a hub-and-spoke delegation from one read-only orchestrator, prerequisite edges between specialists instead of a build pipeline, a review and challenge lane that cannot write, and a control plane that is enforced in code. See [REFERENCE-ASSESSMENT](REFERENCE-ASSESSMENT.md).
