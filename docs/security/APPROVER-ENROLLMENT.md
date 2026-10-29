# Approver enrollment (owner guide)

**Status: no approver is enrolled.** The registry ([approvers.json](../../harness/policy/approvers.json)) is empty, so no signed approval of any class can currently exist. The assistant that built this harness did not and cannot enroll anyone: the enrollment commands refuse to run without an interactive terminal on your own computer, and the harness contains no key for any person.

This guide is for the repository owner. Follow it on **your own machine, outside the dev container**, yourself.

## What an approval is, and what it is not

An approval is a signed JSON document (Ed25519) that names what it approves and is bound to the exact text or scope it approves. It is valid only when its signing keys are in the registry with the right class. Text in the repository that says "approved", "Decider: owner", a Status line set to Accepted, or a pasted signature block does **not** satisfy any gate: the gates verify a signature against a registered key, and the registry is itself protected (below).

| Class | Approves | Gate that requires it | Key may also be |
|---|---|---|---|
| `architecture` | ADR acceptance, design-review approval, phase raise (one of the two required signatures) | [validate-approvals](../../harness/scripts/validate-approvals.mjs) (local and CI) | `repository` |
| `repository` | P2: Git writes and pull requests on non-protected branches (tier P2) | permission engine (hooks) | `architecture` |
| `deployment` | P3/P4: non-production Azure changes and sensitive operations (tiers P3, P4) | permission engine (hooks) and phase raise (the second required signature) | `deployment` only |
| `filing` | certification filings by the quality manager | production filing gate (not built) | **exclusive**: a filing key can hold no other class |

Separation rules the registry enforces: a filing key is exclusive; an architecture key and a deployment key cannot be the same key; a phase raise needs one architecture signature **and** one deployment signature from different keys; P4 needs two different keys. One person holding both an architecture and a deployment key is allowed and flagged with a warning, because it is a separation-of-duties weakness the code cannot judge. The quality manager's filing key must belong to the quality manager, not to you.

## Enroll yourself (about ten minutes)

1. Open a terminal on your own computer (not the dev container, not an agent session).
2. Create your key and an enrollment request. Choose the classes you actually hold:

   ```
   node harness/scripts/approval.mjs enroll --out "C:\Users\<you>\approver-keys" --holder "Your Full Name" --classes architecture,repository --tiers P2
   ```

   Keep `--out` outside the repository and outside a synced folder. You set a passphrase of at least 12 characters. The private key is encrypted and never leaves that folder. This **registers nothing**; it writes a request under `docs/approvals/enrollment/` and prints a **fingerprint**. Write the fingerprint down from the screen.
3. Register the request:

   ```
   node harness/scripts/approval.mjs register --request docs/approvals/enrollment/ENR-<id>.json
   ```

   You retype the fingerprint (it must match the key in the request) and a confirmation phrase. Typing is the control: it proves a human read the fingerprint. The entry carries a proof of possession (the key signed its own enrollment statement), so an entry made from somebody else's public key is rejected.
4. Confirm with `node harness/scripts/approval.mjs list` and `node harness/scripts/validate-approvals.mjs`.
5. Set up **signed commits** (below), then commit the registry change with `git commit -S` and push it yourself.
6. Add your GitHub login to [control-plane-owners.json](../../harness/policy/control-plane-owners.json) in that same signed commit.
7. When you are ready for the guard to block, set the repository variable `GF_CONTROL_PLANE_ENFORCE` to `true` (Settings, Secrets and variables, Variables) or set `"enforce": true` in the owners file. Until then the guard **reports and does not block**.

To approve an ADR (after reading it):

```
node harness/scripts/approval.mjs decision --type adr --id 0015 --reason "Reviewed ..." --out docs/approvals/AP-<id>.json
node harness/scripts/approval.mjs sign --file docs/approvals/AP-<id>.json --key "C:\Users\<you>\approver-keys\approver-<keyId>.pem"
```

Then set the ADR Status to Accepted in the same signed commit. The signature is bound to the document's hash with the Status line removed, so editing the ADR text after you signed makes the approval invalid. Existing ADRs 0001 to 0015 are a fixed grandfathered list (accepted by chat instruction before signing existed); a new ADR 0016 or later cannot be Accepted without a signed decision.

## Signed commits (GitHub-verified)

The independent control is that a commit touching the control plane must be **GitHub-verified**: signed with a key you registered with GitHub, so GitHub vouches that you made it. The simplest route on Windows is SSH signing:

```
git config --global gpg.format ssh
git config --global user.signingkey "C:\Users\<you>\.ssh\id_ed25519.pub"
git config --global commit.gpgsign true
```

Add the same public key in GitHub, Settings, SSH and GPG keys, **as a Signing Key**. Make a test commit and check for the Verified badge. Use a separate key from your approver key; they do different jobs. Only you, on your computer, hold these keys. The dev container has no signing key and no remote credentials, so nothing running in it can produce a verified commit.

## When branch protection is unavailable

GitHub branch protection and rulesets returned HTTP 403 on this repository's plan while it was private (re-checked in this stage). The workable alternative is three layers; no single one is enough:

| Layer | What it does | State |
|---|---|---|
| A. No credentials in the agent environment | The dev container has no Git credentials, no SSH agent, no tokens, a firewall that does not allow GitHub, and a pre-push hook that refuses. Agents cannot push. | Configured, validated statically, **not built or run** |
| B. CI control-plane guard | Every control-plane commit must be GitHub-verified and by an enrolled owner, judged against the **base** commit's rules; evidence is append-only against the base. | Written and tested with a mocked GitHub API; **report-only until you enable it**; has not yet run on a real pull request |
| C. Branch protection or rulesets | Stops a bad push before it lands; CODEOWNERS review. | **Not applied.** Needs a plan with protection for private repositories, or a public repository. [github-protection.json](../../harness/policy/github-protection.json) and `verify-github-protection.mjs` are ready |

Without layer C, a person with write access can still push to `main`, and the guard detects after the push rather than preventing it. This is the honest limit of the workable alternative. Your decision: upgrade the plan or accept detection-only (recorded in [OPEN-QUESTIONS](../harness/OPEN-QUESTIONS.md) and the TODO list).

## What this does not solve

- **You can forge your own approvals.** You hold the key. The registry proves a named key signed, not that the human read the document. Reading before signing is a human procedure.
- **Self-registration cannot be prevented inside the repository.** Anyone who can commit can write a well-formed entry. What stops it from counting is the verified-owner commit check (layer B) and credential isolation (layer A). Until you enable enforcement, an entry added by an unsigned commit would pass the local validator and be reported, not blocked, by CI.
- **Key loss or compromise.** Use `revoke`, commit it signed, and re-enroll. A revoked key invalidates new approvals; it does not undo past ones.
- **The filing gate is not built.** The `filing` class exists in the registry rules so the quality manager's key can be enrolled later; no production filing path uses it yet.
