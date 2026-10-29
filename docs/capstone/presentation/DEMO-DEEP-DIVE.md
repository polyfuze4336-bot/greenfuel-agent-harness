# Deep-dive demos (technical)

Eight additional demonstrations, each one command, each real execution of candidate code on synthetic data with test-only keys. **None is the platform.** Each states what it does not show. Use them when the panel asks, not as part of the core talk. All have a recording: add `--replay` and announce it as a recording.

Prefix every command with `node harness/demo/run.mjs`. Nothing here has been rehearsed with a human.

| Demo | Command | Time | Slide | Likely questions |
|---|---|---|---|---|
| Agent orchestration | `agents` | 60 s | M10, T06 | Q15, Q29, Q31, Q33 |
| Certificate tampering | `tamper` | 60 s | M09, T03 | Q26 |
| Cross-shipowner isolation | `isolation` | 75 s | M09, T01 | Q15, Q27, Q28 |
| Edge outage and recovery | `outage` | 60 s | M09 | Q24 |
| Evidence lineage | `lineage` | 60 s | T03 | Q17, Q22 |
| Human approval | `approval` | 75 s | T02 | Q46 |
| Observability and tracing | `observability` | 45 s | M10, T04 | Q37 |
| Azure infrastructure and costs | `azure` | 45 s | M11, T08 | Q35, Q37, Q47 |

## 1. Agent orchestration (`agents`)

- **Show.** The conventional deterministic workflow, run just now on 42 synthetic cases: 41 complete, emissions all correct, escalation recall 1, hard gates pass. Four deliberately bad arms fail the gates. The single-agent and multi-agent LLM arms are **NOT RUN**.
- **Say.** "This is orchestration by a fixed workflow behind a tool gateway. I have not run a language model, so I cannot show AI adding value. This is the baseline a model must beat."
- **Does not show.** Any LLM behaviour, any cost or latency of a model, a blind holdout. Expected outcomes are unreviewed.
- **If it fails.** Replay; or open `docs/evaluation/agent-runs/COMPARISON.md`.

## 2. Certificate tampering detection (`tamper`)

- **Show.** A genuine certificate verifies; five attacks fail: quantity edited; edited and hashes recomputed; re-signed with an attacker's key with that key placed inside the file; a meter reading edited in the evidence; a meter event deleted.
- **Say.** "Tamper evidence, not prevention. The verifier ignores keys inside the file; it uses only the trust set it supplies."
- **Does not show.** Key custody, trusted time source, where the audit head is anchored (D-013, D-021), and a stolen-key window.
- **If it fails.** Replay; or run `node --test tests/custody-chain-contract.test.mjs`.

## 3. Cross-shipowner isolation (`isolation`)

- **Show.** A foreign record and a missing record get identical answers; lists and search are tenant-filtered; manipulated ids never return 200; a **scripted** adversarial "model" that obeys an injected instruction tries to file and read another customer's record and is denied and escalated; the audit log records it as hashes.
- **Say.** "The model here is scripted. This shows the controls hold whatever a model proposes. It does not measure a real model."
- **Does not show.** Real-model behaviour, shared inference state (IS-09), a real identity provider.
- **If it fails.** Replay; or `node --test tests/tenant-boundary-contract.test.mjs`.

## 4. Edge outage and recovery (`outage`)

- **Show.** Two events arrive; the link drops; the last event is replayed first and refused as a gap; the buffer resends in order with a duplicate ignored; a full replay is idempotent; the evidence is complete and verified; receipt times come from the cell clock.
- **Say.** "Late data is visible as late and is never back-dated."
- **Does not show.** Real edge hardware, storage, retry timing, the trusted time source (D-018, D-021).
- **If it fails.** Replay.

## 5. Evidence lineage (`lineage`)

- **Show.** Starting from the certificate: the calculation record, the method and factor versions and their content hashes, the evidence manifest recomputed from the five custody events (MATCH), each event with its receipt, and the quantity equal to the sum of the readings, all from files with no database.
- **Say.** "An auditor can reconstruct this from the files alone."
- **Does not show.** Feedstock evidence (a stand-in verifier is used) or any raw-document store.
- **If it fails.** Replay.

## 6. Human approval (`approval`)

- **Show.** Seven attempts to advance a validated certificate without a valid human approval are denied: an agent that holds every role; a hand-written unsigned approval; a signature from the wrong key; an agent issuing; the issuer service issuing without approval; a draft whose own text says "APPROVED"; a replay. Then a human quality manager signs the exact content and it is approved. The audit log holds every denial.
- **Say.** "Text claiming approval is not approval. Approval is a signed record bound to this content."
- **Does not show.** Who holds approver keys and how they are enrolled (CL-15); the harness approver registry is empty (T53).
- **If it fails.** Replay.

## 7. Observability and tracing (`observability`)

- **Show.** A blunt line: NOT IMPLEMENTED: no correlation ids, logs, traces, metrics, token usage, queue depth or dashboards exist. Then the one thing that does exist: the hash-chained audit trail from the flow just run.
- **Say.** "There is no running system to instrument. The specification the build must meet is written, and it is not a result."
- **Does not show.** Any telemetry. Do not describe the audit trail as observability.
- **If it fails.** Replay.

## 8. Azure infrastructure and costs (`azure`)

- **Show.** The deployment-readiness gate, run now, read-only: NOT-READY, with the first blockers; nothing created.
- **Say.** "Read-only discovery was done and nothing was reused or created. The costs on the slide are scenario figures; only Azure list prices are verified."
- **Does not show.** Any Azure resource, deployment, cost actually incurred, or verified residency.
- **If it fails.** Replay; or open `docs/phase/AZURE-DEPLOYMENT-READINESS-REVIEW.md`.

## Rules for all deep dives

1. Say what is real, what is simulated, what is not built.
2. If the panel asks for something that does not exist (a trace, a load result, a recovery test), say "not built" and describe how it would be measured. Do not run an unrelated demo to fill the gap.
3. If a result surprises you, say so and look at it with the panel (concede, then verify).
