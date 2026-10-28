# greenfuel-agent-harness

A GitHub Copilot harness for VS Code, built to help design, implement, test, deploy and operate an Azure-native agentic solution for **Agentic Green-Fuel Bunkering Certification for an Asian Marine Fuels Group**.

**Status: Phase 0, harness foundation only.** This repository contains no bunkering application code, no infrastructure code, and has created no Azure resources. Raising the phase is a human decision recorded in an ADR.

## What is here

| Area | Contents |
|---|---|
| Rules | [AGENTS.md](AGENTS.md), `.github/instructions/` |
| Roles | `architect` (design, docs-only edits, no shell), `reviewer` (independent verification, no edits) in `.github/agents/` |
| Workflows | Skills `adr-authoring`, `session-handoff`, `evidence-validation` in `.github/skills/` |
| Guardrails | `preToolUse` hook (`harness/hooks/policy-guard.cjs`) with data-driven policy (`harness/policy/command-policy.json`), registered by `.github/hooks/policy.json` |
| Evidence | `harness/scripts/record-evidence.mjs`, `harness/scripts/validate-harness.mjs`, `tests/`, CI in `.github/workflows/validate.yml` |
| Decisions and state | [docs/adr/](docs/adr/), [docs/state/STATE.md](docs/state/STATE.md), [docs/evidence/](docs/evidence/) |
| Design of the harness | [docs/harness/](docs/harness/) |

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

1. Open this folder in VS Code and trust the workspace. The hook runs only in a trusted workspace.
2. Start a Copilot chat session, pick the `architect` or `reviewer` agent from the agent picker, and read [docs/state/STATE.md](docs/state/STATE.md) for where work stands.
3. Check the repository itself:
   ```
   npm test
   npm run validate
   ```

Not yet verified: that the hook and agents behave as documented inside a live Copilot session. That is roadmap item R1 and is the first thing to test.

## Principles

Azure-first and Microsoft-native where practical. Architecture decisions before implementation. Secure by default. Human approval for high-impact actions. Harness and business agents kept separate. Persistent, resumable state in git. Evidence, not self-declared success. Minimal dependencies. No fabricated Azure resources, results or status. No autonomous production deployment.

## Provenance

Informed by an assessment of [astha29may/AICodingAgentHarness](https://github.com/astha29may/AICodingAgentHarness). No code or text was copied (that repository has no licence). What was reused as an idea, adapted, rejected or newly written is recorded in the [disposition register](docs/harness/REFERENCE-ASSESSMENT.md#5-component-disposition-register).
