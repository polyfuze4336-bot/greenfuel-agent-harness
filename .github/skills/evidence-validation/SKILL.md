---
name: evidence-validation
description: Record verifiable evidence for a completion claim by running the check through the evidence recorder. Use whenever you or another agent state that something works, passes, or is deployed.
---
# Evidence validation

A claim is only as good as an observation that could have contradicted it.

Record a check:

```
node harness/scripts/record-evidence.mjs --id EV-0001 --claim "Harness tests pass" -- node --test
```

The recorder runs the command without a shell, stores argv, exit code, duration, output hash, output tail (secret patterns redacted), git HEAD and runtime versions in `docs/evidence/records/EV-0001.json`, and refuses ids that already exist. It also refuses any command the policy hook would deny.

Interpretation rules:
- `exitCode: 0` supports only the claim the command actually exercises. State the gap between the claim and the command.
- A failed run is recorded as evidence of failure. Do not delete or rerun under a new id to hide it; add a later record.
- Azure state (resources, deployments, health) is never evidenced by this repository in Phase 0. If it is ever claimed, require a read-only query result from the live subscription, recorded the same way, and say which subscription.
- Records are edited only by the script. Direct edits are blocked by the policy hook and are visible in git history.
