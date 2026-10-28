# Memory model

Persistent memory for the **coding harness**: what the agents and the owner need to remember between sessions so that approved architecture is not forgotten, contradicted or silently rewritten. It is not a memory for the bunkering application and it holds no customer data. The rules for who may change it are in [MEMORY-GOVERNANCE](./MEMORY-GOVERNANCE.md); the decision is [ADR 0010](../adr/0010-persistent-memory.md).

Everything here is implemented in [store.cjs](../../harness/memory/store.cjs), configured by [memory-policy.json](../../harness/policy/memory-policy.json) and exercised by `tests/memory.test.mjs` and `tests/validate-memory.test.mjs`. The files live under [memory/](../../memory/README.md) and are versioned in Git.

## Three categories, ten kinds

| Category | Kind | Folder | Holds |
|---|---|---|---|
| Semantic | decision | `memory/decisions/` | A decision taken or proposed. Approved ones come from Accepted ADRs |
| Semantic | proposal | `memory/decisions/` | A suggestion nobody has approved. Never authoritative |
| Semantic | assumption | `memory/decisions/` | Taken as true for now, without proof, with an expiry so it is revisited |
| Semantic | fact | `memory/architecture-state/` | An observed, evidenced statement |
| Semantic | constraint | `memory/architecture-state/` | A hard rule. Exists only as approved and is pinned in every summary |
| Episodic | lesson, incident, test-failure, resolution | `memory/lessons/` | What happened and what was learned. Expires |
| Working | task-state | `memory/task-state/` | The resumable state of one task |

Facts, assumptions, proposals and superseded decisions are separate **kinds and statuses**, never one pile: a reader sees `[authoritative/approved]`, `[unreviewed/proposed]` or `superseded by DEC-0002` on every result.

`memory/architecture-state/CURRENT.json` is generated. It lists the approved decisions and constraints in force with a hash of each. `validate-memory` regenerates it and fails on any difference, so an approved entry cannot be changed or removed unnoticed.

## What every entry records

Each entry is one JSON file with a strict field list (an unknown field is refused, so memory cannot carry free-form payloads). Among the fields: `id`, `kind`, `title`, a short `statement` (the compact authoritative form), `subject` and `position` (what the entry is about and which way it says), `refs` (requirements, hard constraints, ADRs, evidence, runs, commits), `owner` (a role or agent, never a person) and:

| Group | Fields |
|---|---|
| Provenance | `source`, `ref`, `sourceSha256` (for imports), `trust`, `recordedBy` (writer type and name), `evidence` |
| Time | `createdAt`, `updatedAt`, `validity.validFrom`, `validUntil`, `reviewBy` |
| Validity | `status`, `supersedes`, `supersededBy`, `invalidatedReason`, `invalidatedAt` |
| Authority | `approval` (`by`, `at`, an `ADR-nnnn` reference) and `review` (`by`, `at`, `outcome`, `evidence`) |

## Authority

Trust has four levels. Authority is **earned by a check the code makes**, not claimed by the entry.

| Trust | Meaning | How it is reached |
|---|---|---|
| authoritative | Approved by a human decision that code can verify | The entry carries an `approval.ref` to an ADR that exists and whose Status line is **Accepted**, and its content is derived from that ADR. Only a human or the importer can record it |
| reviewed | Confirmed by someone other than the author, or derived by the engine from a hash-chained record | A named human review, or an engine entry that cites its evidence |
| unreviewed | Written by an agent or person, not yet reviewed | The default for agents |
| untrusted | Came from a tool result or a document | Quarantined: only a proposal, never returned unless asked for, never promoted (a human rewrites it as a new entry) |

If an ADR is later edited so it is no longer Accepted, the entry's trust is reported as unreviewed and `validate-memory` fails.

## Retrieval: relevance and authority, not recency

`retrieve` ranks by `score = relevance × authority × status + recency`.

- **Relevance** is a small BM25-style score over the title, statement, subject, tags, references and body, normalised to the best match. Words are lower-cased, split at hyphens and folded from plural to singular; identifiers such as `HC-01` or `ADR-0008` stay whole and match references with the highest field weight, so asking for an id finds that entry first.
- **Authority** weights are 1, 0.7, 0.4 and 0.1 for authoritative, reviewed, unreviewed and untrusted. **Status** factors are 1 approved, 0.9 active, 0.5 proposed, and 0 for superseded, invalidated, expired and rejected, which are excluded unless history is requested (a superseded result then points to its successor).
- **Recency** is at most 0.05 with a half-life of 180 days. It can break a tie; it cannot lift an entry above a more authoritative, equally relevant one (a test shows a newer lesson ranking below an older approved decision).

These weights are working values chosen by this design. They are not derived from measurement, and `validate-memory` only checks their ordering. Each result carries its score breakdown so a reviewer can see why it ranked where it did, and its warnings (proposed, unreviewed, past its review date).

Untrusted entries and entries that contradict an approved entry are excluded by default and counted in `excluded`, so the omission is visible.

## Conflict detection

Live entries (approved, active, proposed) are grouped by `subject`. Different `position`s in one group are a conflict:

| Type | Severity | Meaning |
|---|---|---|
| approved against approved | critical | Verification fails. One must supersede the other through a new Accepted ADR |
| lower authority against approved | high | The approved entry stands; the other is excluded from retrieval and flagged |
| proposals against each other, none approved | medium | A human decision is needed |

The writers cannot create the first two by themselves: an agent or a tool is refused if it contradicts an approved subject, and a human can contest an approved decision only by superseding it.

## Compact summaries that keep the constraints

`summarise` builds a budgeted text from the `statement` fields. Pinned entries (approved and `critical`, which includes the twelve hard constraints) and every conflict are placed first and **never trimmed**. If they cannot fit the budget the call fails rather than return a summary that omits one. The remaining entries are added by authority, in labelled sections, and the summary states how many were omitted. A focus phrase moves relevant entries up.

## Resume after interruption

A `task-state` entry holds the objective, requirements, dependencies, an optional run reference, context references with a hash of each file, and an ordered list of checkpoints (summary, done, next, open questions). `memory_resume` or `memory.mjs task resume` rebuilds a **resume pack from files only**:

- the last checkpoint, open questions and recommended next action;
- whether the task looks interrupted (active but idle for more than the policy window, 60 minutes as a working value);
- warnings for what changed while it was away: a context file whose hash differs, a referenced decision that was superseded (with its successor), invalidated or expired, a missing dependency;
- the run's state and next action, read through the orchestration engine in read-only mode when the task names a run;
- the pinned constraints and the memory most relevant to the task.

Task state is mutable working memory: it is not hash-chained, it expires after 14 days of inactivity (a working value), and it never carries authority.

## Survives restarts

All state is in files in the repository. Nothing depends on an editor or chat session. The tests prove this by rebuilding the session in a **new process** and in a **new context object** that shares only the files. **A VS Code restart has not been performed**, and no test claims one. What was shown is that a new process can resume from the files; how a particular VS Code session reloads its tools after a restart was not observed.

## Why not SQLite, and why no vector database

Authoritative memory must be reviewable in a pull request and diffable, so Git-versioned JSON is the source of truth. A database file is a binary that cannot be reviewed line by line and would be a second place for approved decisions to live.

Retrieval needs no index on disk. The corpus is small (the policy caps it at 2000 entries, a working value; the repository holds a few dozen), and an in-memory index is rebuilt for each query. SQLite would also add a runtime dependency: `node:sqlite` loads on Node v22.23.4 here but prints an experimental-feature warning, and the repository has no other dependencies.

A vector database was not introduced because ordinary indexed keyword retrieval was not shown to be insufficient. **Revisit when** a recorded evaluation shows relevant entries being missed by keyword search, or when the corpus approaches its cap. SQLite is the first step for an execution-history store that outgrows files; vectors come only after a measured recall problem. No recall or latency figures exist yet, and none are claimed.

## Relationship to native Copilot memory

Copilot's own `store_memory` is rejected as a source of authority (`mem-copilot-memory` in the [tool registry](../harness/TOOL-REGISTRY.md)): it persists outside the repository where it cannot be reviewed, validated or tied to evidence. This memory is read through two read-only MCP tools, `memory_search` and `memory_resume`, granted to the orchestrator (both) and to the principal architect and architecture critic (search). It complements `docs/state` (the human-facing resume point) and the [run store](../orchestration/ORCHESTRATION.md) (task execution history); it does not replace them.
