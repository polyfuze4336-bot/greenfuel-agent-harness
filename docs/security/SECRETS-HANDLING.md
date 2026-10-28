# Credential and secret handling

Rules for the coding harness. The aim is that a secret never enters a prompt, a log, a tool result the model sees, or Git. None of the controls below is perfect; the last section says where they stop.

## Rules

1. **No secrets in the repository.** Not in code, docs, fixtures, tests, MCP configuration or CI files. Test values that look like secrets are assembled at run time so no file contains one.
2. **No stored credential for agents.** Agents run with no Azure or GitHub sign-in. If an identity is ever needed it is a non-standing, scoped identity using federated or interactive sign-in, never a stored key ([azure-identities.json](../../harness/policy/azure-identities.json), specified, not created).
3. **Approver private keys are human-held.** Passphrase-encrypted, outside the repository and outside synced folders, never given to an agent or pasted into a chat.
4. **Secret reads are never grantable.** `secret.read` and `azure.secret.read` cannot be approved for an agent by any tier.
5. **Prefer references to values.** Configuration holds names (for example a Key Vault secret name), not values.
6. **Rotate on suspicion.** If a secret reaches a prompt, a log or a commit, treat it as exposed: revoke and replace it, then review the audit log.

## Where each rule is enforced

| Control | Mechanism | Technical or human |
|---|---|---|
| Secret-looking files cannot be read, written, searched or copied by an agent | `secret` path class in the engine: `.env`, `*.pem`, `*.pfx`, `*.key`, `id_rsa`, `.npmrc`, `local.settings.json`, `simulated-secrets/` (DEF-05) | Technical (hook) |
| Credential-extracting Azure commands are denied for agents and default sessions | classifier `azure.secret.read` (token, Key Vault secret show, key listing, connection-string and app-setting listing, credential reset, publishing profile) | Technical (hook) |
| A secret that appears in a tool result is redacted before the model sees it | `tool-output-guard.cjs` with [secret-patterns.json](../../harness/policy/secret-patterns.json) | Technical (hook, pattern-based) |
| Search hits inside secret files are dropped | output filter, leading path token only | Technical (hook) |
| The audit log holds no content or full arguments | hashed arguments, redacted preview, preview withheld for secret paths | Technical (code) |
| Secrets cannot be committed | `.gitignore` patterns and the repository secret scan in `npm run validate`, run in CI | Technical after the fact (detection, not prevention) |
| Approver key custody | encrypted key outside the repository | **Human procedure** |
| Rotation and incident response | see above | **Human procedure** |

## Where this stops

- Redaction and secret-path rules are **pattern based**. A secret in an unusual format, a secret in a file with an ordinary name, or one split across lines can pass. Pattern lists reduce risk; they do not prove absence.
- A hook protects only tool calls it sees. A human at the keyboard, a program the agent cannot start, or another tool outside Copilot is outside it.
- Hooks run only in a trusted folder. Opening the repository untrusted switches them off. Keep the folder trusted only for this repository.
- Agents run as the same operating-system user as the developer, so file permissions cannot stop them reading a file the user can read. Real isolation needs a separate account or container (T15).
- `git add` of an ignored secret file still needs `-f`; a developer can do that. The scan runs in CI after a push, so a pushed secret is already exposed and must be rotated.

## If a secret appears anywhere

1. Stop. Do not repeat the value in chat or a commit message.
2. Revoke or rotate it at the source.
3. Remove it from Git history only after rotation (history rewriting is a protected-branch operation and needs the owner).
4. Review `.harness-logs/denied-actions.jsonl` and the output-hook log for related activity.
