# Denied-action audit records

Every denial by a hook is appended to `.harness-logs/denied-actions.jsonl` (Git-ignored; the directory can be moved with `HARNESS_LOG_DIR`). The log answers "what was refused, for whom, by which rule" without storing anything sensitive.

## Record

Schema `greenfuel.denied-action/v1`, one JSON object per line:

| Field | Content |
|---|---|
| seq, ts | sequence number and UTC time |
| session, agent, mode | session id; the agent name or empty; `agent` or `session` |
| tool, operations, tier, environment | what was attempted and how it classified |
| decision, rules, reason | always `deny`; rule IDs such as DEF-06; a short reason |
| paths, scope | classified target paths; the data scope in force |
| argsSha256, argsPreview | SHA-256 of the arguments; a short preview with secret-shaped text redacted, and withheld for secret paths |
| approvals | ids of approvals considered |
| prevHash, hash | hash chain |

**Never recorded:** file contents, tool output, full arguments, secret values.

## Tamper evidence

Each record's `hash` covers its content and the previous record's hash. Editing, removing or reordering a record breaks the chain. Verify and summarise:

```
node harness/scripts/audit-denials.mjs verify
node harness/scripts/audit-denials.mjs summary
```

`verify` exits 1 on a broken chain. `summary` prints counts per rule and never prints arguments.

## Limits

- A hash chain proves **internal consistency**, not authenticity. Someone able to rewrite the whole file can rebuild a valid chain. Stronger assurance needs an external anchor (for example copying the last hash to a system the agent cannot write), which is not implemented.
- The log is local and Git-ignored, so it is not shared evidence. Copy it to a reviewed location for an incident.
- Logging is best effort: a failure to write never changes the decision, so a denial could occur without a record. The denial itself is unaffected.
- Only denials are recorded; allowed actions are not logged here.
- The log is writable by the developer's account; the policy denies agents from writing it, but an OS permission does not.
- Retention and review ownership are not decided (T16).
