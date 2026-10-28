# Evidence records

Machine-generated facts about checks that were actually run. Written only by `harness/scripts/record-evidence.mjs`; the policy hook blocks agent edits here.

```
node harness/scripts/record-evidence.mjs --id EV-0001 --claim "Harness tests pass" -- node --test
```

A record says what was run and what happened. It does not say the claim is true; reviewers decide that. See the `evidence-validation` skill for interpretation rules.

Records are committed. Output tails are limited to 2 KB with common secret patterns redacted; do not run commands that print secrets.
