# Approvals folder

Signed approval records (`greenfuel.approval/v1`) for P2, P3 and P4 actions live here. See [APPROVAL-WORKFLOWS](../security/APPROVAL-WORKFLOWS.md).

- The folder is part of the **control plane**: agents cannot write it. Humans create records with `node harness/scripts/approval.mjs`.
- A record is valid only if signed by registered approvers in [approvers.json](../../harness/policy/approvers.json). That registry is empty today, so no record can be valid.
- Records contain no secrets: signatures and public key ids only. Private keys never belong here.
- No approval record exists yet.
