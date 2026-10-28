# Break-glass procedure

For restoring service or containing an incident when the normal approval workflow cannot be followed in time. It is a **human** procedure. An agent never declares an emergency, and nothing here lets an agent bypass a control on its own.

## What break-glass can and cannot do

| Can | Cannot |
|---|---|
| Authorise an agent-run operation that is above its ceiling, for a short time, with two approvers | Authorise anything in `neverGrantable`: secret reads, cross-shipowner or cross-jurisdiction movement, regulatory filings, commercial settlements, protected-branch changes, control-plane writes, production |
| Be used in phase 1 and later on non-production Azure | Operate in phase 0 (no Azure or remote change is possible there) |
| Be used by a human acting directly under their own credentials, outside the agent | Disable hooks, edit the registry or change the policy: those are control-plane writes and stay denied to agents |

A human acting directly (for example in the Azure portal) is outside this harness; the organisation's own incident process governs that, and the harness only records what the agent attempted.

## Procedure

1. **Declare.** A human states the incident or change reference and the reason. Without a reference the approval is invalid (enforced).
2. **Request.** `node harness/scripts/approval.mjs request --tier P4 --break-glass --reference <ref> ...` naming the exact agent, operation, environment and scope.
3. **Two approvers.** Two distinct registered approvers who hold the P4 capability each sign it. One signature, a duplicated signature or a key without the P4 capability is rejected (enforced).
4. **Time limit and single use.** The record expires within the P4 limit and works once (enforced).
5. **Act and watch.** The action runs; denied and allowed actions are in the audit log.
6. **Close.** Within one working day: post-incident review, revoke any credential issued, attach the relevant audit entries, decide whether the normal workflow needs to change. These steps are **human procedure** and nothing checks that they happened.

## Contacts and owners

Not yet defined. Who declares an emergency, who the two P4 approvers are and how they are reached are decisions for the owner (T13, T16). Until then, break-glass cannot be used because the approver registry is empty.

## Honest limitations

- The two-person rule is cryptographic only if the two keys are held by two different people. The engine cannot tell.
- Approvers' private keys live on their machines. Key theft or a shared passphrase defeats the control.
- A break-glass record is not a retrospective authorisation: review is a human duty.
