# Loop trace: LOOP-58fa845034

Generated from `events.jsonl` by `loop.mjs report`. Do not edit by hand; the event log is the source.

- Task: Placement declaration must satisfy the sovereignty check
- Agent: session
- Final state: **STOPPED** (HARD_CONSTRAINT_VIOLATION)
- Repair attempts: 0/3; check runs 1; events 10

## Acceptance criteria

- The sovereignty validator passes on the placement declaration
- Residency is never satisfied by naming a region

## Timeline

| # | Action | Detail |
|---|---|---|
| 1 | plan |  |
| 2 | state | PLAN to EXECUTE: first attempt opened |
| 3 | attempt-begin | E0 (execute) |
| 4 | attempt-end | E0 changed 1 file(s) |
| 5 | state | EXECUTE to VERIFY: E0 ended |
| 6 | verify-start |  |
| 7 | check | sovereignty FAILED (HARD_CONSTRAINT_VIOLATION), exit 1, E0-v1-sovereignty |
| 8 | failure | HARD_CONSTRAINT_VIOLATION on sovereignty, fingerprint 03b27d083846 |
| 9 | state | VERIFY to STOPPED: HARD_CONSTRAINT_VIOLATION: sovereignty: exit 1 |
| 10 | outcome | STOPPED (HARD_CONSTRAINT_VIOLATION) |

## Outcome

sovereignty: exit 1

**Needs a person:** An architecture decision is needed. Resolve the open decision or constraint conflict; the loop will not repair it, and it must not be worked around.

## Preserved failures

### E0-v1-sovereignty

```
sovereignty: FAIL (2 item(s) checked)
  - tests/fixtures/loop/sovereignty/placement/placement.json: placements[0] (shore-evidence-store): a cloud region is not a residency control (SEC-001, D-009); name the control and its evidence
  note: Matrix consistency is always checked. Placement declarations are optional specifications.
  note: A region name is never accepted as residency evidence.
```


## Integrity

The event chain and the recorded evidence verify.
