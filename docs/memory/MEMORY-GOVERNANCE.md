# Memory governance

Who may write what, how approved architecture is protected, how poisoning and sensitive data are kept out, and which of this is **technically enforced** versus which still **depends on a person**. The model is in [MEMORY-MODEL](./MEMORY-MODEL.md); the decision is [ADR 0010](../adr/0010-persistent-memory.md).

## Who may write

The writer's type comes from the call (the `--as <type>:<name>` flag of [memory.mjs](../../harness/scripts/memory.mjs), or the code calling the store), never from what the entry says about itself. The policy in [memory-policy.json](../../harness/policy/memory-policy.json) sets what each type may do.

| Writer | May create | Highest trust it can assign | Notes |
|---|---|---|---|
| human | any kind | authoritative | Also supersede, invalidate, review, approve, sweep and write the snapshot |
| importer | decision, constraint | authoritative | Derives entries from Accepted ADRs and the hard-constraints table; approved only if the ADR verifies |
| engine | incident, test-failure, resolution, lesson, task-state | reviewed | Must cite the record it was derived from |
| agent | proposal, assumption, lesson, incident, test-failure, resolution, task-state | unreviewed | Cannot approve, review, pin, supersede, invalidate or contradict an approved subject |
| tool, document | proposal | untrusted | Quarantined: only an untrusted, proposed proposal |

Agents have no shell and cannot edit `memory/` (it is a control-plane path, see below). In practice the agent route to memory is the human-run CLI and, for the working state of a task, a human or the engine acting for it. Agents read memory through `memory_search` and `memory_resume`.

## Approved decisions are not silently overwritten

- The store assigns ids. A request that names an existing id is refused, so an entry is never overwritten.
- A decision becomes approved only through a reference to an **Accepted** ADR that the code looks up in `docs/adr/`. A missing, Proposed or Rejected ADR is refused.
- **The content must come from that ADR.** An approved decision must be derived from the ADR it cites (source `adr`, the ADR file and its hash) and its statement must be the ADR's title; an approved constraint must match its row of the hard-constraints table word for word. An Accepted ADR therefore cannot lend its authority to unrelated words. Entries are created this way by `memory.mjs import`; the store refuses a hand-written approved entry that is not derived from its ADR.
- Changing an approved entry is a new approved entry that **supersedes** it. The new entry's ADR must be a different, Accepted ADR whose `Supersedes:` line names the old one. The old entry stays, marked superseded, and points to its successor.
- Invalidating an approved entry needs a different Accepted ADR whose `Invalidates:` or `Supersedes:` line names the ADR that approved the entry, and a reason. An unrelated Accepted ADR cannot retire a decision.
- Approved entries have no expiry. They can become stale (a `reviewBy` date passes), which is reported but never removes them.
- Every change to a decision, constraint, fact or episodic entry appends to the hash-chained `memory/ledger.jsonl`, with a hash of the entry's core that must not change once it was approved and a hash of the whole file. `validate-memory` fails if a file differs from its last ledger record (edited), if a recorded file is missing (deleted), if the last row was dropped (rolled back), if a row was altered, if a file has no record, or if `CURRENT.json` does not match the approved entries.
- Two approved entries that disagree on one subject fail verification.
- **The ledger is anchored in Git.** The ledger only ever grows, so `validate-memory` compares it with the copy at `HEAD`, at `origin/main` and at the previous commit when Git has them, and fails if it has fewer rows or any earlier row differs. This catches a consistent rollback or rewrite of the whole `memory/` folder that the ledger alone cannot (a test shows both).

## Poisoning from untrusted documents and tool output

Memory is a place an attacker would like to write: a poisoned note becomes "context" that later sessions trust. The defences, each tested:

1. **Quarantine.** Anything written by the `tool` or `document` writer, or whose source is a tool result or a document, can exist only as an untrusted proposal. It is excluded from retrieval and summaries unless asked for, and cannot be promoted: a human rewrites it as a new entry.
2. **Authority is checked, not claimed.** An entry that says it is authoritative, approved, reviewed or pinned is refused unless the writer type and the ADR check allow it. An entry file placed by hand with an approval but recorded by an agent fails verification, and so does one with no ledger record.
3. **No contradicting an approved subject.** Non-human writers are refused if they take a different position on an approved subject.
4. **Instruction-like text** (the same pattern list the tool-output guard uses, plus memory-specific patterns for imperative commands, "important:" preambles and "always bypass the approval" phrasing) is refused from non-human writers, and re-checked on verification. Memory holds facts and records, never instructions. Retrieval output is labelled as data, not instructions. These are heuristics: an agent can reword, and the origin of text an agent writes cannot be proven (see Limits).
5. **A strict schema.** Unknown fields, free-form payloads, personal-name owners and non-internal classifications are refused. References are limited to known identifier shapes.
6. **Every refusal is recorded** in a hash-chained denial log (`.harness-logs/memory-denied.jsonl`) with the writer, operation, kind, subject and reasons, and a hash of the input, never the refused text.

## Sensitive data

Memory never stores credentials, personal data or customer data. The store **rejects** an entry that appears to contain any, rather than redacting it, so nothing sensitive is half-stored. It checks every free-text field for credential shapes (the repository secret patterns, key/value forms such as `password = ...`, `Authorization`, bearer and basic tokens, cookies, JWTs, private-key headers and connection-string keys), email addresses, phone numbers, bank and card numbers, vessel and delivery-note identifiers, shipowner identifiers and the customer data marker, and for hidden control and zero-width characters. A file reference into a secret, shipowner, jurisdiction or audit path class, or one that leaves the workspace (`..`, an absolute path), is refused, including in a task's context references. The result names the kind (`personal-data`, `secret`, `customer-data`, `hidden-characters`, `protected-path`) and never the matched text. A test checks that none of the refused values appears in any memory or log file. The same rule binds a human writer.

## Expiry and invalidation

Assumptions (90 days), proposals (60), incident and resolution and lesson (365), test failures (180) and task state (14 days since last activity) get an expiry when written; these values are working values chosen by this design. An expired entry is excluded from retrieval and summaries and reported by verification. `memory.mjs sweep` marks expired entries through the ledger. A human can invalidate any entry with a reason. Invalidated and superseded entries are kept for history.

## Enforced technically

| Control | Mechanism | Evidence |
|---|---|---|
| Writer capabilities, schema, sensitive-data and injection refusal | `store.cjs` and `memory-policy.json` | `tests/memory.test.mjs` |
| Approved entries cannot be overwritten, only superseded or invalidated through an Accepted ADR that names them, and must be derived from the ADR they cite | `store.cjs` ADR lookup and binding | same |
| Tampering, deletion and rollback are detected | Ledger hash chain, per-entry hashes, `CURRENT.json`, and a comparison of the ledger with its Git history | same, and `validate-memory` in CI |
| Policy and wiring cannot be loosened unnoticed | `validate-memory` checks writer limits, weights, quarantine, tools, grants and docs | `tests/validate-memory.test.mjs` (mutations) |
| Agents cannot edit `memory/` | `memory/` is a control-plane path in `permissions.json`; the agent hook denies the write (rule CTL-01) and denies running the memory CLI | `tests/validate-memory.test.mjs` |
| Agent access is read-only | The two MCP tools are read-only, schema-validated and size-capped; no memory write tool exists | `tests/validate-memory.test.mjs`, `tests/mcp-server.test.mjs` |
| Resume reads the run store without changing it | Engine read-only mode | `tests/memory.test.mjs` |

Hook enforcement applies where the hooks run, which in VS Code and Copilot CLI means a trusted folder (see [ADR 0008](../adr/0008-least-privilege-permission-model.md)).

## Human procedure: what still depends on a person

| Procedure | Why it is not technical |
|---|---|
| Accepting an ADR only on the owner's instruction | The Status line is text in a file the principal architect agent may edit. If an agent changed it, CI fails until someone runs the importer, but a person who runs the importer without checking would approve it. Review changes to `docs/adr/` |
| Running `memory.mjs import` after an ADR is Accepted, and `snapshot` after changes | A human act; CI fails if it was forgotten |
| Reviewing pull requests that touch `memory/` | `CODEOWNERS` lists `memory/`, but it takes effect only when branch protection requires code-owner review, which this repository's plan does not offer |
| Honest writer names and independent reviews | A `human` writer is declared by whoever holds the terminal. The "someone other than the author" check compares names and cannot prove a different person |
| Sweeping, and reviewing stale approved entries | Reported, not automatic |
| Recording an owner-reported check as owner-reported | A convention for authors, shown in the seeded lessons |

## Limits

- The `human` and `importer` writer types are self-declared on the command line and in the store API: the store trusts the type the caller states. A non-human process that states `human` can write an approved entry (it must still be derived from an Accepted ADR, which narrows what it can say, and it leaves a ledger row and a Git diff). They stop agents (which have no shell) and mistakes, not a person at a terminal. Real authentication of human writers would use the signed approvals of the permission model, which needs registered approver keys (an owner decision still open, T13). Environment seams `HARNESS_MEMORY_DIR`, `HARNESS_LOG_DIR` and `HARNESS_ADR_DIR` exist for tests; a person who sets them can point the store at other files.
- The ledger is **tamper-evident, not tamper-proof**. A rewrite of the ledger, every entry and the snapshot that is committed and pushed with nothing earlier to compare against is not detected: the Git comparison needs a previous commit or `origin/main` to exist locally (CI fetches two commits). Branch protection is the real defence and is not available here.
- The sensitive-data and injection scans are heuristics. They cannot prove the absence of sensitive data or of a cleverly worded instruction. The strict schema, the short fields and the quarantine do most of the work.
- Authority rests on the ADR files. A forged Accepted ADR plus a careless importer run produces an approved entry.
- Task state is mutable and not hash-chained: an edit to a task file that is still valid is not detected. It carries no authority and expires, but a resume pack built from a tampered file would be wrong. Treat a resume pack as a starting point and check the run and the files it names.
- Quarantine depends on the writer and source the caller declares. An agent that copies web or document text and records it as its own is not caught by the quarantine, only by the pattern checks above. Such an entry is at best unreviewed and is labelled so in every result.
- Concurrent writers are serialised by a lock folder with a stale-lock timeout. This was exercised in a single process and by consecutive processes, not by deliberately racing processes.
- Retrieval weights, expiry periods, size limits and the interruption window are working values, not measured.
- A VS Code restart has not been performed or tested.
