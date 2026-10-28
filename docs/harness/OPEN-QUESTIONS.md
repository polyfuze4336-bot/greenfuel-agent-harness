# Open Questions

Each question blocks or shapes a decision. "Needed by" is the roadmap item that cannot finish without an answer. Answers should be recorded here, then reflected in an ADR where they change a decision.

| ID | Question | Why it matters | Needed by | Default I used |
|---|---|---|---|---|
| Q1 | Where should the repository live and be hosted? It was created inside a OneDrive-synced folder and has no remote. | OneDrive can corrupt `.git` and lock files. A GitHub remote is needed for CI, branch protection and review. | R4 | Local only; recommend moving it outside OneDrive before real use |
| Q2 | Which Copilot plan and Copilot Chat build are in use, and which harness (Copilot or Local) do you run day to day? `code --list-extensions` shows no Copilot Chat extension. | Hooks, agent fields and tool names differ by harness. Plan or tenant policy may disable hooks or features. | R1 | Copilot harness primary, Local secondary |
| Q3 | Who are the named deciders for ADR acceptance and for raising the phase? | "Human approval" needs a person or role. | Stage 0 gate | You (programme owner) |
| Q4 | Do repository hooks fire in your VS Code session (workspace trust, `chat.useHooks`, session type)? | The whole enforcement design (ADR 0002) depends on it. | R1 | **Partly answered 2026-10-28:** fires in Copilot CLI when the folder is trusted; silently not loaded when untrusted ([LIVE-TEST-R1](LIVE-TEST-R1.md)). VS Code chat still untested |
| Q5 | Is terminal sandboxing available on your Windows setup, and would you accept a dev container for agent work? | Strongest isolation; the hook alone is evadable. | R3 | Not adopted |
| Q6 | Which Azure tenant and subscription will the project use, which Azure MCP tools may agents call, and can a read-only identity be provisioned for agents? | No Azure resource has been created or queried. Agents need least privilege before any Azure read. | R2 | No Azure access; mutation denied |
| Q7 | What is the data classification of the programme material (client documents, meeting content, certification data), and where may it be processed? Is Microsoft 365 retrieval (WorkIQ) permitted? | Marine-fuel certification data may be commercially sensitive or regulated. Chat content, memory and evidence records persist. | R9, Stage 2 | Nothing sensitive is in this repository; WorkIQ not used. A product-level classification scheme is proposed in [DATA-CLASSIFICATION](../context/DATA-CLASSIFICATION.md) but not approved |
| Q8 | Where do the product's business-agent design artefacts live (for example `docs/product/`), and what separates them from harness docs? | Pillar 3 boundary; validator rules depend on it. | R8 | All design in `docs/`; code later in `src/` |
| Q9 | Does your organisation apply enterprise-managed Copilot settings (permission levels, hooks, sandbox)? | Could enforce or restrict this design centrally. | R1, R3 | Unknown |
| Q10 | Do you want the harness to run on other team members' machines (macOS, Linux)? | Policy patterns include PowerShell cmdlets and POSIX commands; shell tool names differ. | R1 | Windows primary; POSIX patterns also present |
| Q11 | The reference repository has no licence. Do you want to contact its author if any of its code is wanted later? | Nothing was copied. Reuse of code would need permission. | none | No code reused |
| Q12 | Which certification schemes, regulations and standards are in scope for the use case, and who supplies authoritative sources? | Agents must not invent regulatory content. Needed to start design. | Stage 2 | None assumed. Candidates are listed, unverified, in [CERTIFICATION-SCHEMES](../context/CERTIFICATION-SCHEMES.md); tracked as D-001 and D-002 |
| Q13 | Are evidence record output tails acceptable to commit, or should records keep hashes only? | Tails may contain environment details. | Stage 1 | 2 KB tails with pattern redaction |

## Assumptions made without confirmation

| ID | Assumption | Risk if wrong |
|---|---|---|
| A1 | The six pillars were derived from your ten design principles and you confirmed the list when asked | Low: recorded in [HARNESS-ARCHITECTURE](HARNESS-ARCHITECTURE.md) |
| A2 | Node.js 20+ may be a prerequisite for hooks and scripts on every machine using the harness | Medium: a missing Node causes the hook to fail closed and block tool calls |
| A3 | `.vscode/settings.json` keys `chat.useHooks`, `chat.tools.global.autoApprove` and `chat.tools.terminal.autoApprove` are recognised by 1.143.0 as documented | Low: unknown settings are ignored by VS Code, but then protect nothing |
| A4 | Hook command path `node harness/hooks/policy-guard.cjs` resolves from the repository root in your session | Medium: documented for hook commands, not observed |
| A5 | Agent tool aliases `read`, `search`, `edit`, `web`, `todo`, `execute` resolve in both harnesses | Medium: documented in examples, not observed for all aliases |
