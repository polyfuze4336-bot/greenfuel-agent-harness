# Tool registry

Status: v0.1, Proposed (ADR 0007). Source of truth: [tool-registry.json](../../harness/tools/tool-registry.json) for the tools, [agent-policy.json](../../harness/policy/agent-policy.json) for which agent may use what. The tables below are **generated** from those two files and checked by `npm run validate`; do not edit them by hand. Security reasoning is in [MCP-SECURITY](./MCP-SECURITY.md); what each Copilot surface supports is in [TOOL-COMPATIBILITY](./TOOL-COMPATIBILITY.md).

## How to read the registry

Every tool has a purpose, inputs, outputs, a privilege class, a mutation class, an accountable owner (the programme owner; no named person yet, TODO T3), a publisher, where data goes (egress), and a status.

| Status | Meaning |
|---|---|
| enabled | Granted to at least one agent. Checked: a disabled tool must not be granted to anyone |
| phase-gated | Usable only after a human raises the phase (ADR) and the policy is changed |
| pending-approval | Needs an owner decision first, most often permission to sign in to Azure or GitHub. Nothing is configured or authenticated |
| human-only | Humans run it. No agent has it |
| not-available | Nothing exists to point it at yet (no product code) |
| rejected | Considered and refused, with the reason recorded |

**Read-only is separated from mutation.** An enabled MCP tool must have mutation `none` and a read-only privilege. Anything that can change remote state (`remote`, `unbounded`) or needs sign-in cannot be enabled for an agent at all. The few enabled tools that change local state (`edit`, `execute`, test runners) are bounded by the per-agent write scope and anchored command allow-lists, and only authors and executors have them.

**Tool output is not evidence.** A validator result is an observation. A claim of "verified" still needs a recorded run through the [evidence recorder](../evidence/README.md).

## Generated tables

<!-- generated:start (node harness/scripts/validate-tools.mjs --write) -->

### Servers

| Server | Kind | Status | Privilege | Pin | Egress | Authentication |
|---|---|---|---|---|---|---|
| greenfuel-tools | local-stdio | enabled | read-local | repository-commit | none | none |
| microsoft-learn | remote-http | enabled | read-external | remote-service | search text and URLs go to learn.microsoft.com | none |
| azure-mcp | local-stdio | pending-approval | auth-read | @azure/mcp@3.0.0 | Azure Resource Manager and Azure Monitor APIs for the signed-in account; optional Microsoft telemetry unless disabled | az login (explicit human approval required; not performed) |
| github-mcp-server | remote-http | pending-approval | auth-read | remote-service | GitHub API for the signed-in account | OAuth or a read-only token supplied by the host; never stored in a repository file |

### Enabled read-only tools (26)

| ID | Category | Kind | Name | Privilege | Egress | Output untrusted | Granted to |
|---|---|---|---|---|---|---|---|
| repo-git-read | repository | cli | git status / diff / log / show | read-local | none | no | qa-engineer, design-reviewer |
| repo-gh-read | repository | cli | gh pr / run list / view / checks | read-external | GitHub API using the developer's existing gh sign-in | yes | qa-engineer |
| repo-code-search | repository | native | search (grep, glob) | read-local | none | no | orchestrator, principal-architect, maritime-domain, azure-platform, application-engineer, ai-engineer, data-engineer, security-reviewer, sre-engineer, qa-engineer, architecture-critic, design-reviewer |
| docs-microsoft-learn-search | documentation | mcp | microsoft_docs_search | read-external | query text to learn.microsoft.com | yes | azure-platform |
| docs-microsoft-learn-fetch | documentation | mcp | microsoft_docs_fetch | read-external | URL to learn.microsoft.com | yes | azure-platform |
| docs-microsoft-code-samples | documentation | mcp | microsoft_code_sample_search | read-external | query text to learn.microsoft.com | yes | azure-platform |
| docs-web-fetch | documentation | native | web_fetch (host allow-list) | read-external | URL to the allowed host | yes | azure-platform |
| eng-filesystem-read | engineering | native | read (view) | read-local | none | no | orchestrator, principal-architect, maritime-domain, azure-platform, application-engineer, ai-engineer, data-engineer, security-reviewer, sre-engineer, qa-engineer, architecture-critic, design-reviewer |
| eng-validate-tools | engineering | mcp | validate_tools | read-local | none | no | security-reviewer, qa-engineer |
| test-repo-validation | testing | cli | npm run validate | read-local | none | no | qa-engineer |
| test-contract-evidence-lineage | testing | mcp | validate_evidence_lineage | read-local | none | no | data-engineer, qa-engineer |
| test-contract-emissions-methods | testing | mcp | validate_emissions_methods | read-local | none | no | maritime-domain, data-engineer, qa-engineer |
| test-contract-certificate-integrity | testing | mcp | validate_certificate_integrity | read-local | none | no | maritime-domain, data-engineer, qa-engineer |
| arch-validate-requirements | architecture | mcp | validate_requirements | read-local | none | no | principal-architect, qa-engineer, architecture-critic |
| arch-validate-architecture | architecture | mcp | validate_architecture | read-local | none | no | principal-architect, qa-engineer, architecture-critic, design-reviewer |
| arch-validate-agent-permissions | architecture | mcp | validate_agent_permissions | read-local | none | no | security-reviewer, qa-engineer |
| arch-validate-sovereignty | architecture | mcp | validate_sovereignty | read-local | none | no | azure-platform, data-engineer, security-reviewer, qa-engineer |
| arch-validate-deployment-readiness | architecture | mcp | validate_deployment_readiness | read-local | none | no | orchestrator, azure-platform, sre-engineer, qa-engineer |
| arch-trace-requirement | architecture | mcp | trace_requirement | read-local | none | no | principal-architect, maritime-domain, azure-platform, application-engineer, ai-engineer, data-engineer, security-reviewer, sre-engineer, qa-engineer, architecture-critic, design-reviewer |
| arch-design-gate | architecture | cli | node harness/scripts/design-gate.mjs | read-local | none | no | qa-engineer, design-reviewer |
| obs-tool-audit-log | observability | hook | .harness-logs/tool-audit.jsonl | read-local | none | no | orchestrator, principal-architect, maritime-domain, azure-platform, application-engineer, ai-engineer, data-engineer, security-reviewer, sre-engineer, qa-engineer, architecture-critic, design-reviewer |
| mem-accepted-decisions | memory | mcp | get_accepted_decisions | read-local | none | no | orchestrator, principal-architect, maritime-domain, application-engineer, ai-engineer, security-reviewer, architecture-critic, design-reviewer |
| mem-task-state | memory | mcp | get_task_state | read-local | none | no | orchestrator, principal-architect |
| mem-implementation-history | memory | mcp | get_implementation_history | read-local | none | no | orchestrator, qa-engineer |
| eng-delegation | engineering | native | agent (task delegation) | read-local | none | no | orchestrator |
| mem-session-todo | memory | native | todo | read-local | none | no | orchestrator |

### Enabled tools that can change local state, bounded by agent scope or an allow-list (3)

| ID | Category | Name | Mutation | Bounded by | Granted to |
|---|---|---|---|---|---|
| eng-filesystem-edit | engineering | edit (create, edit) | local-scoped | Scope comes from agent-policy.json writes; the agent guard enforces it. Control-plane paths ask a human. | principal-architect, azure-platform, application-engineer, ai-engineer, data-engineer, sre-engineer, qa-engineer, design-reviewer |
| eng-terminal | engineering | execute (shell) | local-scoped | Only executors have it, with anchored command patterns. Not a sandbox: a permitted test runner executes whatever the tests contain. | qa-engineer, design-reviewer |
| test-unit | testing | node --test, npm test | local-scoped | qa-engineer only. Record results through the evidence recorder. | qa-engineer |

### Not enabled (18)

| ID | Category | Status | Mutation | Why not enabled |
|---|---|---|---|---|
| repo-git-write | repository | human-only | remote | No agent may run these. Pushes need explicit owner approval; the repository-wide policy hook asks on push. |
| repo-gh-write | repository | human-only | remote | Pull request creation and merge are human actions. |
| repo-github-mcp | repository | pending-approval | none | Candidate in harness/tools/mcp-candidates.json; not configured. |
| azure-cli-read | azure | pending-approval | none | Needs az login, which has not been approved or done. No Azure resource exists to read. |
| azure-resource-graph | azure | pending-approval | none | Needs sign-in and a subscription decision (D-037). Query text is not allow-listed yet. |
| azure-bicep-validate | azure | phase-gated | local-scoped | Phase 0 forbids Bicep. Becomes usable only after a human raises the phase and a policy change adds a pattern for it. |
| azure-mcp-readonly | azure | pending-approval | none | Candidate with pinned version in harness/tools/mcp-candidates.json; not configured; no authentication performed. |
| azure-mutation | azure | human-only | unbounded | HC-11: no autonomous deployment. The repository-wide policy hook denies these. |
| docs-standards-hosts | documentation | pending-approval | none | Candidate hosts, unverified. The owner decides which standards are in scope (TODO T4); only then are hosts added to webHosts. Standards are candidates, not confirmed applicable. |
| docs-web-search | documentation | rejected | none | Unbounded sources and synthesised answers cannot be tied to a primary source; the guard denies it. |
| eng-dependency-install | engineering | human-only | unbounded | The harness has zero dependencies and the validator rejects any. Installs run package scripts, so each needs review of the package, its scripts and its integrity hash. |
| eng-build | engineering | not-available | local-scoped | No application exists and Phase 0 forbids one. Choice of build tooling waits for open question Q8. |
| test-integration | testing | not-available | local-scoped | No product components exist. |
| test-security-scan | testing | not-available | none | No product code or dependencies exist. Only the repository secret-pattern scan runs today. |
| test-e2e-browser | testing | rejected | unbounded | Browser automation can act on any site and reads untrusted pages. Rejected until a UI exists and a sandboxed test environment is approved. |
| obs-azure-monitor | observability | pending-approval | none | Nothing is deployed to observe. Needs sign-in approval and a workspace decision. |
| obs-app-insights | observability | pending-approval | none | Telemetry data may be jurisdiction-bound (F-04); in-jurisdiction placement must be decided first. |
| mem-copilot-memory | memory | rejected | remote | A persistent store that cannot be reviewed, validated or tied to evidence. The guard denies tools it does not classify. |

<!-- generated:end -->

## Specialised utilities

These small deterministic checks run from the command line (`node harness/scripts/spec-validators.mjs <name>`, also `npm run validate:<name>`) and through the read-only `greenfuel-tools` MCP server. They validate **specifications, candidate contracts and synthetic fixtures**. No product application exists, so nothing here validates one.

| Utility | MCP tool | Validates | Does not do |
|---|---|---|---|
| validate-requirements | validate_requirements | Requirements baseline: IDs, classes, traceability, decision register, context manifest | Judge whether a requirement is right |
| validate-architecture | validate_architecture | ADRs, designs, review records, gate consistency, risks, defence questions | Approve a design |
| validate-sovereignty | validate_sovereignty | Placement matrix against data classification and decision register; optional placement declarations. A region name is rejected as residency evidence | Prove residency of anything; decide D-009 to D-011 |
| validate-agent-permissions | validate_agent_permissions | Agent files against agent-policy.json: tools, MCP grants, write scopes, delegation, hooks | Show how a Copilot build behaves |
| validate-evidence-lineage | validate_evidence_lineage | Candidate lineage bundles: raw to calculation to evidence package to certificate, append-only sequences, methodology and build recorded, no model origin, human approval | Check stored production evidence (none exists) |
| validate-emissions-methods | validate_emissions_methods | Candidate methodology records: immutable versions, content hash, units, sourced factors, verification only by a named human, scheme status respected | Judge a methodology's correctness; hold or invent factor values |
| validate-certificate-integrity | validate_certificate_integrity | Candidate certificate hash chains: payload and record hashes, chain links, local hosting zone, human quality-manager approval | Decide the tamper-evidence mechanism (D-013 is open) |
| validate-deployment-readiness | validate_deployment_readiness | Recorded preconditions that block a deployment (phase, infrastructure spec, approved design, open decisions, named decider, tool configuration) | Authorise or test a deployment. `NO-BLOCKERS-FOUND` is not an approval |
| validate-tools | validate_tools | This registry, MCP configuration, pins, limits, grants, secret patterns | Start or contact any server |

Results are PASS, FAIL, EMPTY or NOT-READY. **EMPTY means no specification was found and nothing was checked.** It is never reported as a pass, and `--require` turns it into a failure. Today only the baseline checks have material to examine; the three data-contract checks have only synthetic test fixtures under `tests/fixtures/`.

The contract schemas end in `v0-candidate`. They are test oracles for ideas still being decided, not decisions.

## Changing a tool

1. Edit `tool-registry.json` and, if an agent gains or loses access, `agent-policy.json` and that agent's `tools:` line.
2. Run `node harness/scripts/validate-tools.mjs --write`, then `npm run validate` and `npm test`.
3. Enabling a tool, adding a server, or changing a pin is a control-plane change. A human approves it, and a new server or version also needs the review in [MCP-SECURITY](./MCP-SECURITY.md), section "Approving a candidate".
