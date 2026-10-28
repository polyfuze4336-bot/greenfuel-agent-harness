# Enforcement status

What is **technically enforced**, what is **only specified**, and what **depends on a human**. A Markdown policy is not enforcement; this page says which rules are backed by something that actually refuses an action, and shows the evidence in [NEGATIVE-TESTS](./NEGATIVE-TESTS.md).

Legend: **Enforced** = a hook, validator or CI step refuses or fails. **Partial** = enforced in some paths, with a stated gap. **Specified** = designed and validated as a specification, nothing applied. **Human** = relies on a person following a procedure.

## Default policy

| ID | Rule | Status | Mechanism | Gap |
|---|---|---|---|---|
| DEF-01 | Read-only unless justified | Enforced for named agents | agent tool lists, write scopes, tier ceilings | The default human session is not restricted to read-only; it only gets the always-on denials (see Session mode) |
| DEF-02 | Deny unknown tools and operations | Enforced for named agents | unclassified tool, command segment or agent name is denied | Not applied to the default human session, which would be unusable |
| DEF-03 | Deny cross-jurisdiction data movement | Partial | jurisdiction path class, session scope variable, two-jurisdiction rule, egress rule, output filter | Applies to the synthetic fixture layout and path-shaped arguments; data reached by a path the classifier does not recognise is not seen. Says nothing about real Azure residency |
| DEF-04 | Deny cross-shipowner disclosure | Partial | shipowner path class, scope variable, two-owner rule, output filter | Same limits as DEF-03; filter drops whole lines and is pattern based |
| DEF-05 | Deny secret extraction and credential exposure | Partial | secret path class, `azure.secret.read` classifier, output redaction | Pattern based: unusual secret formats or ordinary file names can pass |
| DEF-06 | Deny destructive cloud operations | Partial in hooks; **Azure RBAC specified, not created** | `azure.delete` is P4 and never reachable by a generic approval; no agent has an Azure ceiling; phase 0 denies all. Covers `az`, `azd`, `terraform`, `kubectl`, Az PowerShell cmdlets and direct ARM REST calls | Recognition is by text. A command assembled at run time is refused as `shell.indirection`, but that is a list of known tricks, not a proof. No Azure identity or lock exists, so the cloud itself would not refuse; a human or a tool outside the hooks is not stopped |
| DEF-07 | Deny protected-branch modification without the approved workflow | Partial | hooks: `git.protected.modify` never grantable, no agent has git write. CI runs on push. **GitHub branch protection could not be applied** (HTTP 403 on this plan) | A human can push to `main`. CODEOWNERS is prepared but has no effect without branch protection |
| DEF-08 | Deny deployment of unreviewed infrastructure changes | Enforced in hooks | deployment needs a signed approval bound to the reviewed commit and exact resource groups; phase gate | No deployment pipeline or Azure environment exists. CI-side deployment gates are not built |
| DEF-09 | Deny autonomous regulatory filings and commercial settlements | Enforced in hooks | operations never grantable; classified by tool name | Name-based classification. A tool with an unrelated name is caught only by deny-unknown |

## Other controls

| Control | Status | Note |
|---|---|---|
| Control-plane writes (policy, hooks, approvals, approver registry, CI, MCP config) denied to agents | Enforced in hooks (CTL-01) | A human can edit them; that is the intended route |
| Write-then-run: agents cannot write executable or script files outside an enabled code scope, and `node --test` only runs files under `tests/` | Enforced in hooks (EXEC-01) | Closes the path where one step writes code and another runs it |
| Signed approvals (Ed25519), expiry, use counting, agent and scope binding, P4 two-person rule | Enforced in hooks | Registry is empty, so no approval is currently valid. Key custody is human |
| Tamper-evident denied-action log | Enforced (hash chain) | Detects edits; does not authenticate the writer ([DENIED-ACTION-AUDIT](./DENIED-ACTION-AUDIT.md)) |
| Output redaction and isolation filter | Enforced (postToolUse hook) | Pattern based |
| CI gates | Enforced as detection | `npm run validate` and `npm test` run on every push; they cannot stop a merge without branch protection |
| Azure RBAC and scoped identities | **Specified, not created** | [azure-identities.json](../../harness/policy/azure-identities.json); needs decision D-037 |
| GitHub branch protection and rulesets | **Cannot be applied** on the current plan | Read-only `gh api` returned HTTP 403 ("Upgrade to GitHub Pro or make this repository public"). [github-protection.json](../../harness/policy/github-protection.json) and `verify-github-protection.mjs` are ready |
| Operating-system permissions | **Not enforced** | Agents run as the developer's OS user, so file ACLs cannot stop them. Real isolation needs a separate account or a dev container (T15) |

## Session mode

A session with no agent identity (the default human session) receives only the always-on denials: unlisted tools, secret paths and credential extraction, destructive and production Azure operations, protected-branch changes, regulatory and settlement tools, cross-owner and cross-jurisdiction access and egress, control-plane writes by tool, and shell commands built at run time. Tier ceilings and deny-unknown apply to **named agents** only. A `git push` to `main` by the owner stays an `ask` prompt. In a session where `HARNESS_SCOPE_SHIPOWNER` or `HARNESS_SCOPE_JURISDICTION` is set, any command that can send data off the machine is refused, because a path built at run time cannot be seen.

**The default-session shell guard is not an authorization boundary.** It is a regular-expression screen over command text. An independent review showed it can be evaded by runtime composition of a command name (for example joining `a` and `z`, then calling the result). Those specific routes, plus `Invoke-Expression`, encoded commands, nested shells, inline interpreters (`node -e`, `python -c`), `npx`, direct ARM REST calls and Az PowerShell cmdlets, are now refused and tested. New evasions are still possible. Named agents are stronger because an unrecognised command is denied by default and their allow-lists are narrow. The only real boundary for a default session is operating-system or container isolation without Azure or Git credentials (T15).

The built-in GitHub MCP server of the Copilot CLI remains available to a default session (a documented decision in ADR 0007). It is not available to named agents, whose MCP grants are exact.

## What still depends on a human

- Holding approver private keys, registering approvers, signing only what has been read.
- Merging pull requests, and not pushing to `main` until protection exists.
- Setting the scope variables before a session on real or fixture data.
- Declaring and reviewing a break-glass event.
- Keeping the folder trusted only for this repository (hooks run only in trusted folders).
- Creating Azure identities, locks and policy after the subscription decision.

## Known limits of the enforcement

1. Hooks see Copilot tool calls only. They do not see a person, another program or a tool outside Copilot.
2. Hooks run in a trusted folder; an untrusted folder switches them off.
3. Hook timeouts fail open in the current Copilot CLI; a crash or timeout passes the call.
4. Classification is by regular expression and path shape. It was tested with adversarial cases and an independent model review, which found real bypasses that were fixed and are now regression tests (see [NEGATIVE-TESTS](./NEGATIVE-TESTS.md)). It is not a formal proof: a novel spelling may be classified as unknown, which is denied for named agents and allowed in the default session.
5. The output isolation filter works from visible path prefixes. Content printed without its path (for example a command that reads an isolated file into a variable and prints it) is not recognised. In a scoped session, run-time-built commands and all egress are refused, which narrows but does not close this. Pattern removal is not a confidentiality control; filesystem isolation (T15) is.
6. All results here concern Copilot CLI 1.0.105 with the repository trusted. VS Code behaviour was not tested in this stage (T12).
