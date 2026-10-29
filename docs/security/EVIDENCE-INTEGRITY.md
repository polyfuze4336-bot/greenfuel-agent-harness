# Evidence integrity

How the evidence the harness relies on is protected from silent rewriting, what a failure record now contains, and what is still unproven. This page covers the evidence record store (`docs/evidence/`) and the audit event log.

## What changed in this stage

| Problem found by the audit | Control now |
|---|---|
| A record kept only the last 2,000 bytes of output, so the failing test of EV-0054 was lost and the failure could never be diagnosed | The recorder parses TAP output and stores every `not ok` test with its full name, depth and diagnostic block (`failures`), a `tapSummary`, and a `failureKind` (`nonzero-exit`, `timeout`, `signal`, `spawn-error`). For any failed run the **full redacted log** is kept in `docs/evidence/logs/<ID>.log` with its hash |
| A record could be edited and nothing noticed | `docs/evidence/MANIFEST.json` seals EV-0001 to EV-0066 by canonical-JSON hash. Later records carry `recordSha256` (over themselves) and `prevRecordSha256` (over the previous record), a chain |
| A hand-written record looked the same as a recorded one | After the seal, a record without the chain fields fails verification. A hand-built chain is consistent, so it still needs the next control |
| Rewriting the newest record cannot be seen by a chain | `evidence.mjs verify --base <ref>` fails if any file under `docs/evidence/records`, `logs` or `MANIFEST.json` was modified, deleted or renamed since the base. Only additions pass. CI runs it against the pull-request base or the push's previous commit |
| A record did not say whether the working tree was clean | `treeClean` and `dirtyFileCount` are recorded |
| `*.log` is ignored by Git, which would have dropped the failure logs | `.gitignore` now excepts `docs/evidence/logs/*.log` |
| Audit coverage was denials only | `.harness-logs/audit-events.jsonl` is a hash-chained log of every hook decision (allow, ask, deny) with host and version, every tool outcome, approval and enrollment events, and every evidence record written. It holds names, classes and hashes, never arguments, file contents, tool output or secrets |

Run it: `node harness/scripts/evidence.mjs verify --base origin/main`. Without `--base`, the output says the append-only check was **not run**.

## What this proves, and what it does not

- It shows a record was **not changed after it was written**, within the limits above. It does not show the claim in the record is true: a claim is free text, and a record says what a command did, not whether the command proves the claim.
- A hash chain cannot protect the newest record, nor stop someone who rewrites the whole tail and recomputes every hash. The git base-ref comparison catches that only if the base is trusted, which on a repository without branch protection means CI plus a verified-commit control ([APPROVER-ENROLLMENT](./APPROVER-ENROLLMENT.md)). Evidence is therefore **tamper-evident, not tamper-proof**.
- The audit event log is local and untracked. A process with the same file access can delete it; the chain detects edits and removals of records in the middle, not deletion of the whole file or a rewrite from the start.
- The recorder redacts secrets by pattern and scrubs local paths. A secret in an unusual format could reach a log. Do not record commands that print secrets.

## The intermittent failure (EV-0054)

**Facts.** The record EV-0054 (`npm test` at commit 2c35ce3) shows 762 tests, 761 passed, 1 failed, exit 1, duration 627 s. Its stored output tail begins after the failing test, so the failing test's identity was not preserved. A later run (EV-0055, a later commit) passed with all tests.

**Experiment (this stage).** Eight full-suite runs (770 tests each) of the audit branch tip, from fresh clones: three clones in the temp folder, two runs each, four processes running at the same time to create CPU and disk contention (about 550 s per run, the slowest single test 106 s); and one clone inside the OneDrive-synced folder where EV-0054 happened, two runs, uncontended (357 s). **All eight runs passed 770 of 770.** The earlier audit also passed twice in a clean clone.

**Conclusion.** The failure was **not reproduced and its cause is not identified.** It is classed as an unexplained single failure, not as a known flake and not as resolved. What is established: it happened once, on the slowest run observed (627 s against 250 to 560 s elsewhere), in the OneDrive-synced folder; every other known full run, including the eight above, passed.

**Hypotheses, unranked by evidence:** (1) a time-limited test hit its timeout on a slow run: the evaluation tests use 60 to 180 s child-process limits, the loop test kills a 30 s sleeper within 15 s, and the permission and loop suites spawn a hook process per case; (2) file locking or sync interference from OneDrive on the lock-file or `utimes` tests; (3) a lock directory left by a concurrent hook process. None is confirmed.

**What now exists so the next occurrence is diagnosable:** the failing test name, its diagnostic block and the full redacted log are preserved by the recorder. If a failure recurs, record it with the recorder, do not rerun and overwrite; the cause will then be on disk. Until then the failure stays listed as unexplained in [REMAINING-RISKS](../acceptance/REMAINING-RISKS.md).

## Tests

[tests/evidence-integrity.test.mjs](../../tests/evidence-integrity.test.mjs) (12 tests): clean store verifies; rewriting a sealed record, a chained record (even with its own hash recomputed), deleting a record, removing the manifest, adding a hand-written record, altering or orphaning a failure log, and each append-only violation against a base ref and against real Git history are all detected; the recorder keeps failing-test identity and a redacted log; the real store verifies and is sealed through EV-0066.
