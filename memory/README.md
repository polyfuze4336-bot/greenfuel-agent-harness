# Project memory

Persistent, reviewable memory for the coding harness. It is not a memory for the bunkering application and holds no customer data.

| Folder | Holds | Written by |
|---|---|---|
| `decisions/` | decisions (from ADRs), proposals, assumptions | the importer, or a human through the CLI |
| `architecture-state/` | constraints, facts and the generated `CURRENT.json` snapshot of what is approved | the importer, or a human |
| `lessons/` | lessons, incidents, test failures, resolutions | agents (unreviewed), the engine, or a human |
| `task-state/` | resumable task state (objective, checkpoints, dependencies, context hashes) | the agent working the task, the engine, or a human |
| `ledger.jsonl` | hash-chained log of every change to decisions, constraints, facts and lessons | the store only |

**Do not edit these files by hand.** `validate-memory` fails if an entry or the ledger was changed outside the store, if an approved entry changed, or if `CURRENT.json` no longer matches the approved entries. Change an approved decision by superseding it with a new Accepted ADR.

Use `node harness/scripts/memory.mjs` (see its header) or the read-only MCP tools `memory_search` and `memory_resume`. The rules are in [MEMORY-MODEL](../docs/memory/MEMORY-MODEL.md) and [MEMORY-GOVERNANCE](../docs/memory/MEMORY-GOVERNANCE.md).
