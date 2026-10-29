# Permission model

Least-privilege permissions for the **coding harness** (the Copilot agents that help build the platform). This is not the permission model of the future bunkering application's business agents; those are governed by [AGENT-AUTONOMY-MATRIX](../context/AGENT-AUTONOMY-MATRIX.md).

Source of truth: [permissions.json](../../harness/policy/permissions.json). The tables below are generated from it, so this page cannot drift from the policy. Whether each rule is technically enforced is in [ENFORCEMENT-STATUS](./ENFORCEMENT-STATUS.md).

## Three dimensions

Every tool call is judged on all three at once. A call must pass each; the tightest answer wins.

| Dimension | Question | Where it is decided |
|---|---|---|
| 1. Agent identity and responsibility | Which agent is calling, and what is it for? | `agentCeilings` and the per-agent tool lists in [agent-policy.json](../../harness/policy/agent-policy.json) |
| 2. Tool and operation | What does this call actually do, whatever the tool is called? | `classifiers` map shell commands and tool names to an operation with a tier |
| 3. Target environment and data classification | Where does it act, and on whose data? | `environments` and `pathClasses` (secret, control plane, shipowner, jurisdiction), plus the session scope |

## Tiers

| Tier | Meaning |
|---|---|
| P0 | Read local project files and approved documentation |
| P1 | Modify local code and run safe tests |
| P2 | Modify Git branches and create pull requests |
| P3 | Modify approved non-production Azure resources |
| P4 | Sensitive infrastructure, data or security operations |

P0 and P1 are **standing ceilings** that an agent's definition grants. P2 and above are never standing: each use needs a signed, scoped, expiring approval ([APPROVAL-WORKFLOWS](./APPROVAL-WORKFLOWS.md)).

## Rules that hold for every agent

1. **Read-only unless justified.** An agent's ceiling is its definition; nothing is inherited.
2. **Unknown is denied.** An unrecognised tool, command segment or agent name is refused for a named agent.
3. **Some operations cannot be approved at all.** Reading secrets, cross-shipowner or cross-jurisdiction movement, regulatory filings, commercial settlements, changing protected branches, writing the control plane and anything in production are never grantable to an agent.
4. **Delegation transfers nothing.** An approval or ceiling belongs to the agent it names. A delegate is judged on its own.
5. **A higher tier is not reached from a lower approval,** even when the approval lists the operation.
6. **Phase 0 allows no Azure or remote change** whatever the approval says.
7. **The core guard runs first.** An approval cannot unlock a command that is outside the agent's own allow-list. Today no agent can run `az` or `azd`, so a P3 or P4 approval is a second key on a door the first lock already holds.

## Data scope

The human sets `HARNESS_SCOPE_SHIPOWNER` and `HARNESS_SCOPE_JURISDICTION` in the shell before a session. An agent cannot change the environment of the process that runs the hooks. With a variable unset, **every** path of that class is denied. A call touching two shipowners or two jurisdictions is denied. A command that can send data off the machine and names isolated, jurisdiction-bound or secret data is denied. Search results over a folder that holds several owners are filtered after the call, dropping whole lines (fail-closed, so some harmless lines may be dropped too).

Residency note: these are controls on a coding harness reading **synthetic fixtures**. They do not show that any Azure region or service satisfies port-jurisdiction residency (see [SOVEREIGNTY-MATRIX](../context/SOVEREIGNTY-MATRIX.md)).

## Generated tables

<!-- generated:start (node harness/scripts/validate-permissions.mjs --write) -->

### Tiers

| Tier | Meaning | Approval needed |
|---|---|---|
| P0 | Read local project files and approved documentation | none |
| P1 | Modify local code and execute safe tests | none; bounded by the agent's write scope and command allow-list |
| P2 | Modify Git branches and create pull requests | signed approval, plus repository-policy compliance checked by CI |
| P3 | Modify approved non-production Azure resources | explicit signed approval naming an approved scope |
| P4 | Sensitive infrastructure, data or security operations | separate P4 authorization by distinct approvers; never satisfied by a generic approval |

### Agent ceilings (standing permission, by environment)

| Agent | local-fs | local-exec | git-local | github-remote | external-docs | azure-nonprod | azure-prod |
|---|---|---|---|---|---|---|---|
| orchestrator | P0 | none | none | none | none | none | none |
| maritime-domain | P0 | none | none | none | none | none | none |
| security-reviewer | P0 | none | none | none | none | none | none |
| architecture-critic | P0 | none | none | none | none | none | none |
| principal-architect | P1 | none | none | none | none | none | none |
| application-engineer | P1 | none | none | none | none | none | none |
| ai-engineer | P1 | none | none | none | none | none | none |
| data-engineer | P1 | none | none | none | none | none | none |
| sre-engineer | P1 | none | none | none | none | none | none |
| azure-platform | P1 | none | none | none | P0 | none | none |
| qa-engineer | P1 | P1 | P0 | P0 | none | none | none |
| design-reviewer | P1 | P1 | P0 | none | none | none | none |

No agent has any standing permission in an Azure environment. An operation above an agent's ceiling needs a signed approval for that agent, and a never-grantable operation cannot be approved at all.

### Operations

| Operation | Tier | Environment | Approval route | Meaning |
|---|---|---|---|---|
| fs.read | P0 | local-fs | ceiling | Read a file or list a folder |
| fs.search | P0 | local-fs | ceiling | Search file contents or names |
| meta | P0 | local-fs | ceiling | Session housekeeping (intent, todo, skill, ask the user) |
| agent.delegate | P0 | local-fs | ceiling | Hand a task to another agent. Never transfers approvals or ceilings |
| git.read | P0 | git-local | ceiling | git status, diff, log, show |
| gh.read | P0 | github-remote | ceiling | gh pr and run list, view, checks |
| docs.read | P0 | external-docs | ceiling | Approved documentation host or documentation MCP server |
| azure.nonprod.read | P0 | azure-nonprod | ceiling | Read non-production Azure state. Needs a ceiling and a signed-in identity; neither exists |
| fs.write | P1 | local-fs | ceiling | Write a file inside the agent's own write scope |
| exec.test | P1 | local-exec | ceiling | Run the repository's own tests and validators |
| git.write | P2 | git-local | signed P2 approval | Stage, commit, branch, tag, merge, rebase or reset locally |
| git.push.branch | P2 | github-remote | signed P2 approval | Push a non-protected branch |
| pr.write | P2 | github-remote | signed P2 approval | Create, edit, comment on or review a pull request |
| azure.nonprod.write | P3 | azure-nonprod | signed P3 approval | Create or update a non-production Azure resource |
| azure.nonprod.deploy | P3 | azure-nonprod | signed P3 approval | Deploy reviewed infrastructure to non-production (azd, deployment create, terraform apply) |
| azure.delete | P4 | azure-nonprod | separate P4 authorization | Delete, purge or destroy any Azure or cluster resource |
| azure.rbac.write | P4 | azure-nonprod | separate P4 authorization | Create or change role assignments, identities or directory objects |
| azure.policy.write | P4 | azure-nonprod | separate P4 authorization | Change policy, network security or firewall configuration |
| azure.prod.any | P4 | azure-prod | never grantable to an agent | Anything against a production scope |
| secret.read | P4 | local-fs | never grantable to an agent | Read a secret, key, token or credential file |
| secret.write | P4 | local-fs | never grantable to an agent | Create or change a secret or credential file |
| azure.secret.read | P4 | azure-nonprod | never grantable to an agent | Read or list Azure secrets, keys, tokens or connection strings |
| data.cross-shipowner | P4 | local-fs | never grantable to an agent | Read or disclose one shipowner's data while acting for another |
| data.cross-jurisdiction | P4 | local-fs | never grantable to an agent | Move, copy or send jurisdiction-bound data across a jurisdiction boundary or off the machine |
| regulatory.file | P4 | github-remote | never grantable to an agent | Submit a certification or regulatory filing |
| commercial.settle | P4 | github-remote | never grantable to an agent | Settle, pay or finalise a commercial dispute, claim or invoice |
| git.protected.modify | P4 | github-remote | never grantable to an agent | Push or merge to a protected branch, force-push, delete a branch or rewrite history |
| control-plane.write | P4 | local-fs | never grantable to an agent | Change hooks, policy, approvals, approver keys, audit logs, workflows or scripts |
| fs.write.executable | P4 | local-fs | separate P4 authorization | Write an executable or script file outside a phase-enabled code scope. Closes the write-then-run route |
| shell.indirection | P4 | local-exec | never grantable to an agent | A shell command built or hidden at run time (variables joined into a command name, Invoke-Expression, encoded commands, nested shells, inline interpreters, npx). Its real target cannot be classified, so it is refused |
| credential.extract | P4 | local-fs | never grantable to an agent | Extract a token or credential through a command: the GitHub CLI token, a git credential helper, the Windows credential manager, a container registry login. Credentials are never available to an agent |

### Default policy and its enforcement

| ID | Statement | Enforced by |
|---|---|---|
| DEF-01 | Read-only unless additional access is justified | tool lists and write scopes (agent-policy.json); tier ceilings (agentCeilings) |
| DEF-02 | Deny unknown tools and unknown operations | agent-guard: unclassified tools denied; engine: an unclassified command is an unknown operation and is denied for named agents |
| DEF-03 | Deny cross-jurisdiction data movement | engine: jurisdiction path class, session scope, two-jurisdiction rule, egress rule; output filter |
| DEF-04 | Deny cross-shipowner information disclosure | engine: shipowner path class, session scope, two-owner rule; output filter removes other owners' lines from search results |
| DEF-05 | Deny secret extraction and credential exposure | engine and policy-guard: secret path class, azure.secret.read; output hook redaction |
| DEF-06 | Deny destructive cloud operations by default | engine and policy-guard: azure.delete is P4 and never reachable by a generic approval; no agent has an Azure ceiling |
| DEF-07 | Deny modification of protected branches without the approved workflow | engine: git.protected.modify is never grantable to an agent; no agent has git write |
| DEF-08 | Deny deployment of unreviewed infrastructure changes | engine: azure.nonprod.deploy needs a signed approval bound to the reviewed commit; phase gate |
| DEF-09 | Deny autonomous regulatory filings and commercial settlements | engine: regulatory.file and commercial.settle are never grantable to an agent |

### Approval limits (proposed values)

| Tier | Approvers needed | Longest lifetime (minutes) | Uses |
|---|---|---|---|
| P2 | 1 | 1440 | 5 |
| P3 | 1 | 480 | 3 |
| P4 | 2 | 60 | 1 |

<!-- generated:end -->
