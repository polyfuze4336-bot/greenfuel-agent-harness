# greenfuel-agent-harness

A GitHub Copilot harness for VS Code, built to help design, implement, test, deploy and operate an Azure-native agentic solution for **Agentic Green-Fuel Bunkering Certification for an Asian Marine Fuels Group**.

**Status: Phase 0, harness foundation only.** This repository contains no bunkering application code, no infrastructure code, and has created no Azure resources. Raising the phase is a human decision recorded in an ADR.

## What is here

| Area | Contents |
|---|---|
| Rules | [AGENTS.md](AGENTS.md), `.github/instructions/` |
| Roles | `architect` (authors designs), `reviewer` (independent verification), `design-reviewer` (design reviews and the gate), `design-challenger` (adversarial) in `.github/agents/` |
| Workflows | Skills `adr-authoring`, `session-handoff`, `evidence-validation`, `context-loading`, `design-authoring`, `design-review`, `design-defense` in `.github/skills/` |
| Guardrails | `preToolUse` hook (`harness/hooks/policy-guard.cjs`) with data-driven policy (`harness/policy/command-policy.json`), registered by `.github/hooks/policy.json` |
| Evidence | `harness/scripts/record-evidence.mjs`, `harness/scripts/validate-harness.mjs`, `harness/scripts/validate-context.mjs`, `harness/scripts/validate-architecture.mjs`, `harness/scripts/design-gate.mjs`, `tests/`, CI in `.github/workflows/validate.yml` |
| Decisions and state | [docs/adr/](docs/adr/), [docs/state/STATE.md](docs/state/STATE.md), [docs/state/TODO.md](docs/state/TODO.md), [docs/evidence/](docs/evidence/) |
| Architecture governance | [docs/architecture/](docs/architecture/): [hard constraints](docs/architecture/HARD-CONSTRAINTS.md), ten review perspectives, checkpoints, the [design-review gate](docs/architecture/DESIGN-REVIEW-GATE.md), a defence question bank, a risk register, templates, and a worked example ([DES-0001](docs/architecture/designs/DES-0001-delivery-measurement-storage-topology.md) reviewed in [RV-0001](docs/architecture/reviews/RV-0001-delivery-measurement-storage-topology.md)). Roles: `design-reviewer`, `design-challenger` |
| Design of the harness | [docs/harness/](docs/harness/) |
| Product context baseline | [PROBLEMSTATEMENT.md](PROBLEMSTATEMENT.md) and [docs/context/](docs/context/): business case, 99 requirements with traceability, data classification, sovereignty and autonomy matrices, candidate schemes, assumptions, [unresolved decision register](docs/context/DECISION-REGISTER.md), [context-loading strategy](docs/context/CONTEXT-LOADING-STRATEGY.md) |

Read in this order: [REFERENCE-ASSESSMENT](docs/harness/REFERENCE-ASSESSMENT.md), [HARNESS-ARCHITECTURE](docs/harness/HARNESS-ARCHITECTURE.md), [CAPABILITY-MATRIX](docs/harness/CAPABILITY-MATRIX.md), [IMPLEMENTATION-ROADMAP](docs/harness/IMPLEMENTATION-ROADMAP.md), [OPEN-QUESTIONS](docs/harness/OPEN-QUESTIONS.md).

## The six pillars

1. Context & Instructions
2. Tools & Azure Integration
3. Orchestration & Role Separation
4. Guardrails & Human Approval
5. Memory & Resumability
6. Verification & Evidence

Each is mapped to native Copilot features and any custom code in the [capability matrix](docs/harness/CAPABILITY-MATRIX.md).

## Use it

Prerequisites: VS Code with GitHub Copilot, Node.js 20 or later. No packages to install.

1. Open this folder in VS Code and **trust the workspace**. Hooks are not loaded in an untrusted folder, and nothing warns you (observed in Copilot CLI; see [LIVE-TEST-R1](docs/harness/LIVE-TEST-R1.md)). For Copilot CLI, the folder must be in its trusted folders.
2. Start a Copilot chat session, pick the `architect` or `reviewer` agent from the agent picker, and read [docs/state/STATE.md](docs/state/STATE.md) for where work stands.
3. **Canary:** ask the agent to run `azd up`. A reply containing `HARNESS-POLICY AZD-MUTATE` means the hook is active. If the command runs instead, enforcement is off in this session; stop and fix trust first.
4. Check the repository itself:
   ```
   npm test
   npm run validate
   ```

Verified so far: the hook denies in Copilot CLI 1.0.102 in a trusted folder. Not yet verified: VS Code chat behaviour, agent tool restrictions, and skill and instruction loading (roadmap R1).

## Principles

Azure-first and Microsoft-native where practical. Architecture decisions before implementation. Secure by default. Human approval for high-impact actions. Harness and business agents kept separate. Persistent, resumable state in git. Evidence, not self-declared success. Minimal dependencies. No fabricated Azure resources, results or status. No autonomous production deployment.

## Provenance

Informed by an assessment of [astha29may/AICodingAgentHarness](https://github.com/astha29may/AICodingAgentHarness). No code or text was copied (that repository has no licence). What was reused as an idea, adapted, rejected or newly written is recorded in the [disposition register](docs/harness/REFERENCE-ASSESSMENT.md#5-component-disposition-register).
