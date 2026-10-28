# ADR 0010: Persistent memory for the coding harness

- **Status:** Accepted (2026-10-28, programme owner, by instruction in chat: "accept and document it"; working values confirmed and T23 decided in the same reply)
- **Type:** Governance
- **Date:** 2026-10-28
- **Deciders:** Programme owner
- **Supersedes:** none

## Context
- FACT: The owner asked for persistent, structured memory in three categories (semantic, episodic, working) that survives restarts, keeps approved architecture from being silently overwritten, separates facts, assumptions, proposals and superseded decisions, records provenance, time, owner and validity on every entry, ranks by relevance and authority, resists poisoning from untrusted documents and tool output, keeps credentials and customer data out, supports compact summaries that keep the constraints, supports expiry, invalidation and task resume, and prefers Git-versioned Markdown and JSON with SQLite only if justified and no vector database unless ordinary indexed retrieval proves insufficient.
- FACT: Before this stage the harness had a human-facing resume point (`docs/state`), the Accepted ADRs, the hash-chained run store of [ADR 0009](./0009-task-execution-framework.md) and a registry entry that rejects Copilot's native `store_memory` as a source of authority because it cannot be reviewed or tied to evidence.
- FACT: Observed on this machine, Node v22.23.4 loads `node:sqlite` but prints an experimental-feature warning. The repository has no runtime dependencies.
- ASSUMPTION: The corpus is small and will stay small for the harness (a few dozen entries today). Weights, expiry periods, size limits and the interruption window are working values chosen by this design, not measurements.
- FACT: Agents have no shell and the permission model of [ADR 0008](./0008-least-privilege-permission-model.md) can make a path control plane that agents cannot write.

## Options considered
1. **Use Copilot native memory.** Rejected for authority: it lives outside the repository and cannot be reviewed, validated or tied to evidence. It stays rejected in the tool registry.
2. **Free-form Markdown notes that agents append to.** Rejected: no provenance or validity, no way to tell a fact from a proposal, trivially poisoned, and an approved decision could be edited like any note.
3. **SQLite for everything.** Rejected for authoritative knowledge: a binary file cannot be reviewed in a pull request and would be a second home for approved decisions. It remains the first step if an execution-history store outgrows files.
4. **A vector database or embeddings.** Rejected: ordinary indexed keyword retrieval has not been shown insufficient, and embeddings would add a service, a dependency and an opaque ranking.
5. **Strict JSON entries in Git, a hash-chained ledger, an in-memory keyword index, deterministic rules for who may write what, and read-only MCP tools (chosen).**

## Decision
Accepted. The owner also confirmed the memory working values (T22: authority and status weights, recency weight and half-life, expiry periods, size limits, the interruption window) and asked the architect to decide how human writers are authenticated (T23). The decision on T23 is the last bullet.
- Adopt:
- The model in [MEMORY-MODEL](../memory/MEMORY-MODEL.md) and the rules in [MEMORY-GOVERNANCE](../memory/MEMORY-GOVERNANCE.md), implemented by [store.cjs](../../harness/memory/store.cjs) and [memory-policy.json](../../harness/policy/memory-policy.json), operated through [memory.mjs](../../harness/scripts/memory.mjs).
- Authority that code verifies: an entry is approved only through a reference to an Accepted ADR, recorded by a human or the importer. A change to an approved entry is a new entry that supersedes it under a different Accepted ADR. A hash-chained ledger and a generated architecture snapshot make edits, deletions and rollbacks detectable.
- Quarantine for tool output and documents, refusal (not redaction) of sensitive data, a strict schema, and a denial log that never records refused text.
- Retrieval ranked by relevance and authority, with recency only as a tie-breaker; compact summaries that never drop a pinned constraint or a conflict.
- `memory/` as a control-plane path: agents cannot write it and read it only through `memory_search` (orchestrator, principal architect, architecture critic) and `memory_resume` (orchestrator).
- [validate-memory.mjs](../../harness/scripts/validate-memory.mjs) in `npm run validate` and CI.
- No SQLite and no vector database now, with the revisit conditions below.
- **T23, human-writer authentication (decided by the architect on the owner's instruction "decide what's best").** Interim: the `human` and `importer` writer types stay self-declared, and the control is procedural plus detective: every change to `memory/` or `docs/adr/` is reviewed by the owner in the diff before it is pushed, the ledger is compared with Git history in CI, and an approved entry must be derived from its Accepted ADR. Target: when approver keys are registered (T13), approve, supersede and invalidate will require a signed approval record verified by the store, using the permission model's existing signing and registry, with no new mechanism. This is not built now because the registry is empty and enabling it would block every approval; it is roadmap item R14 and stays under T23 until T13 is done.

## Consequences
- Approved architecture, the hard constraints and lessons from real incidents are now retrievable by every session, with their authority visible.
- A writer who is not a human cannot approve, review, pin, supersede, invalidate or contradict an approved subject, and cannot store sensitive data. These are enforced by code and tested.
- Memory must be kept current by people: after an ADR is Accepted, the importer is run, and CI fails until it is. This is deliberate friction.
- Authority rests on the ADR files, and the `human` writer type is self-declared by whoever holds the terminal. Neither is solved by this design; see the limits in the governance document. Branch protection with code-owner review would close part of this and is not available on this repository's plan.
- A VS Code restart was not performed. Resume was shown by rebuilding a task in a new process from the files alone.
- More code to maintain: one module with a test suite.

## Reversibility
High. Memory is plain files. Removing the store, the CLI, the validator, the two MCP tools and the policy leaves the files readable, and nothing else depends on them.

## Revisit when
Keyword retrieval is recorded missing relevant entries; the corpus approaches the policy cap; an execution-history store outgrows files (consider SQLite then); branch protection becomes available (add code-owner review for `memory/` and `docs/adr/`); a real authentication source for human writers exists; or the owner changes the working values.

## Evidence
Automated tests in `tests/memory.test.mjs` and `tests/validate-memory.test.mjs` cover the seven requested scenarios (save a decision, rebuild a session in a new process, retrieve it, detect conflicting memory, reject an untrusted override, resume an interrupted task, refuse sensitive fields), plus tamper, deletion and rollback detection, quarantine, review, expiry, invalidation, import and drift, compact summaries, the validator's mutation matrix, the read-only tools, the control-plane denial for every agent and the CLI's write rules. They show the store behaves as described in the tested setup. An independent adversarial review by a separate model found eight issues; six were fixed with regression tests (an Accepted ADR lending authority to unrelated content, invalidation by an unrelated ADR, a consistent rollback of the memory folder, credential header forms, reworded instruction text, path traversal in task context references) and a task-list filter was corrected. Two were not fixable by this design and are stated as limits: the `human` writer type is self-declared, and task-state edits are not detected. That review is not an evidence record. They do not show that retrieval is good enough for real use (no recall figures exist), that the scans catch every sensitive value, or how VS Code behaves across a restart. Recorded evidence IDs are listed in [STATE](../state/STATE.md).
