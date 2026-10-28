# Approval workflows

How a P2, P3 or P4 action becomes possible. The mechanics are in [permissions.json](../../harness/policy/permissions.json) (`approvals`, `workflows`); the signing tool is [approval.mjs](../../harness/scripts/approval.mjs). **No approver key exists yet and the registry [approvers.json](../../harness/policy/approvers.json) is empty, so every P2+ action by an agent is denied today.** That is the intended secure default.

## The approval record

A JSON file in `docs/approvals/` (schema `greenfuel.approval/v1`) naming:

- exact agents and exact operations (no wildcards),
- one environment (never production),
- a scope: branch patterns for P2, resource groups for P3, plus the reviewed commit for a deployment,
- a reason, issue and expiry times, a maximum number of uses and a random nonce,
- one or more Ed25519 signatures over the canonical form of everything above.

The hook verifies the signature against the registered public keys on **every** use, checks the scope against the actual command, and counts uses in a local ledger. Changing any field after signing invalidates it.

Limits (proposed values for the owner to confirm, not derived from an external requirement): see the generated table in [PERMISSION-MODEL](./PERMISSION-MODEL.md).

## P2: Git branches and pull requests

| Step | Who | Enforced by |
|---|---|---|
| 1. Request names agent, branch pattern and operations | Human | `approval.mjs request` |
| 2. A registered approver reads and signs it | Human with a private key | signature and tier check in the engine |
| 3. The agent works only on matching, non-protected branches | Agent | engine; protected-branch operations are never grantable |
| 4. A pull request is opened and CI must pass `npm run validate` and `npm test` | Agent, CI | CI gate (detection and, with branch protection, prevention) |
| 5. A human reviews and merges. Agents never merge | Human | human procedure; branch protection **if** the plan allows it |

"Repository-policy compliance" for P2 means: signed approval verified, branch inside scope, CI passing, review by a human. Branch protection on `main` is specified ([github-protection.json](../../harness/policy/github-protection.json)) but GitHub returns HTTP 403 for it on this private repository, so today merge discipline is a human procedure backed by CI that detects, not prevents.

## P3: approved non-production Azure change

| Step | Who | Enforced by |
|---|---|---|
| 1. Change exists as reviewed infrastructure code at a commit, with a recorded what-if | Human and agent | human review |
| 2. Request names agent, operations, subscription and resource group, and the commit | Human | `approval.mjs request` |
| 3. A registered approver signs it | Human | engine |
| 4. The agent runs under a scoped Azure identity whose role and scope match the approval | Azure | **Azure RBAC: specified, not created** ([azure-identities.json](../../harness/policy/azure-identities.json)) |
| 5. Result recorded as evidence | Agent | evidence recorder |

The engine requires the approval to be bound to the current HEAD commit and to the exact resource groups named in the command. Phase 0 denies it regardless. Azure subscriptions are an open decision (D-037); nothing has been created.

## P4: sensitive infrastructure, data or security operations

A P4 approval is **separate** from any P2 or P3 approval and is never implied by one. It must name each operation, carry a reason and rollback plan, be signed by **two distinct** registered approvers who hold the P4 capability, last no more than the P4 limit and be single use. A post-action review within one working day is a human procedure. See [BREAK-GLASS](./BREAK-GLASS.md) for emergencies.

## What is not approvable

Reading secrets, cross-shipowner or cross-jurisdiction data movement, regulatory filings, commercial settlements, changes to protected branches, writes to the control plane (policy, hooks, approvals, approver registry, CI, MCP configuration) and anything in production. The validator rejects an approval that lists one, and the engine refuses it even if one were forged into the registry.

## Onboarding the first approver (human steps)

1. Run `node harness/scripts/approval.mjs keygen --out <folder outside the repository and outside any synced folder>`. Choose a passphrase of at least 12 characters.
2. Add the printed **public** entry to `harness/policy/approvers.json` through a reviewed change, choosing only the tiers the person is authorised for.
3. Back up the private key as your organisation requires. Never commit it, paste it into a chat or give it to an agent.

Decisions still needed from the owner: who the approvers are (T13), and whether the proposed limits are acceptable.
