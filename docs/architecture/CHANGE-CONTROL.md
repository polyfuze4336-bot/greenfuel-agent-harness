# Architecture change-control policy

Status: **proposed for the owner's review; not approved.** It describes how the architecture baseline in [BASELINE](../architecture-studio/BASELINE.md) is changed after it has been authorized. Its machine-readable counterpart is [baseline-policy.json](../../harness/policy/baseline-policy.json), whose gate groupings are a proposal (TODO T66). Until the owner approves both, no baseline can exist: the approver registry is empty and the implementation phase is 0.

## Purpose

Work that the architecture is meant to govern must not begin until the decisions it depends on are approved by a person, and must not silently drift away from those decisions afterwards. This policy says what counts as a change, who may authorize one, and what the repository checks do and do not enforce.

## Definitions

| Term | Meaning |
|---|---|
| Area | A kind of work with its own paths and stage: `application`, `infrastructure`, `deployment` |
| Stage | How much of the architecture an area needs before it may start (`phase-1a`, `production`) |
| Gate | A named condition (phase raised, approver enrolled, decisions approved, ...) with a stated source |
| Baseline | `docs/baselines/BL-nnnn/`: a manifest of the approved decisions an area depends on, with hashes, and the commit they were read at |
| Authorization | A signed `baseline` approval, bound to the manifest's canonical hash, from an enrolled approver with an architecture-class key |
| Reopening | A signed `baseline-reopen` approval, bound to the manifest hash, that lets listed decisions change |
| Supersession | A later baseline that names the earlier one; the earlier is then `superseded` |

## Rules

1. **Nothing says "approved" except a signature.** A manifest, a Markdown status line, a commit message or an AI comment cannot authorize a baseline. Status is derived by verifying signed approvals on the ref being read.
2. **A baseline is generated only when every gate of its scope is met.** There is no option to generate over an open gate.
3. **Rejected, Deferred and Pending decisions are never resolved by the validator.** A rejected decision needs a redesign and a new decision; a deferred one blocks only if the policy requires it for the stage.
4. **Optional and future-phase decisions do not block.** They are listed as non-blocking deferred decisions in the manifest, so the owner sees what is being carried.
5. **Authorizing a baseline does not raise the phase and does not authorize regulatory filings or deployment.** Those are separate approvals (HC-11 and the deployment gates). Architecture approval never substitutes for them.
6. **A different person must authorize than the person who generated** where the access policy enforces segregation of duties. With a single owner that rule cannot be met; see TODO T65 item 4.

## Controlled and uncontrolled change

After authorization the validator compares the baseline's source commit with the ref being checked. A change that touches something the baseline recorded (a decision's text or status, a required review, a requirement, the policy itself, the stage) has a severity:

* **invalidates:** the baseline no longer describes the repository. The area is blocked.
* **review:** something needs a person's look (for example a new required decision) but the recorded approvals still stand.

An `invalidates` change is **controlled** only when a signed, correctly bound `baseline-reopen` approval names it. Otherwise it is an **uncontrolled change**: the area is blocked (`baseline-uncontrolled-change`) and, when CI is run with `--change-control`, the pull request fails even if it touches no gated path.

## Reopening

1. Anyone may propose a reopening: `baseline.ts reopen --id BL-0001 --decisions D-xxx --reason "..."` writes a record.
2. An enrolled architecture approver signs it with `approval.mjs`. An unsigned, unbound or mis-bound reopening has **no effect**; the Studio shows it as such.
3. Once authorized the baseline is `reopened` and the affected areas are blocked.
4. The changed decisions go through the normal review workflow.
5. A superseding baseline is generated (`generate --supersedes BL-0001`) and authorized. Only then is the area open again.

## What the repository checks enforce, and what they do not

Enforced, when the workflow runs and is made a required check:

* A pull request that changes paths in a gated area fails unless the area's gate is open.
* Judging code is read from the **base** commit, so a pull request cannot weaken the gate that judges it, except the pull request that first introduces the gate.
* A policy that cannot be read fails closed.
* Deployment workflows can call the same check as a reusable workflow.

**Not** enforced; do not claim otherwise:

* **Local actions.** CI cannot stop a person or an agent editing, committing or running code on a computer. The harness's own hooks and command policy reduce this in the VS Code workflow but are not a security boundary.
* **Pushes that bypass CI.** Branch protection is unavailable on this repository's plan (TODO T14). Without it the check is advisory: a push to main is detected after the fact, not prevented.
* **Review-record signatures in CI** are checked only when the public keys of the Studio's signing key are supplied (`STUDIO_TRUSTED_SIGNING_KEYS`). Otherwise the chain is checked and the output says "not verified".
* **The workflow has never run on GitHub.** It is tested locally against throw-away repositories.
* **The policy is a proposal.** Which decisions gate which area is the owner's call.

## Roles

| Step | Who |
|---|---|
| Review and approve this policy and `baseline-policy.json` | Architecture owner (reviewed pull request) |
| Enroll approvers | Per the access policy and the harness approver registry |
| Generate a baseline or reopening record | Anyone; it has no force until signed |
| Authorize or reopen | Enrolled approver with an architecture-class key; deployment-class baselines need a deployment-tier key |
| Change this policy | Reviewed pull request; the files are control-plane paths in the CODEOWNERS and the command policy |

## Review

Re-read this policy whenever a gate is added or removed, a stage is redefined, or branch protection becomes available (at which point the "advisory" limitation above should be re-examined).
