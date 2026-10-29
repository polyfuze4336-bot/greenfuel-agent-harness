# Data mapping

How each thing the Architecture Decision Studio must show is **extracted from the existing files**, with the rule, the ID pattern, the status vocabulary and what (if anything) the studio may later propose to write back. Nothing here introduces a new governance format. Where the repository has no structured field, the mapping says so and the studio must show the value as **derived, with the rule that derived it**, never as fact.

## 1. Principles

1. **Read from authoritative records; show derived values as derived.** Every displayed record carries `source file`, `line`, `SHA-256 of the file`, `commit` and the **extraction rule id** from this document.
2. **Never infer a status.** If a record has no status the rule can read, it is shown as `unmarked / requires review`, not guessed.
3. **Never promote.** `Proposed` is `Proposed`. An ADR that says `Accepted` is shown with its **provenance** (signed approval, grandfathered chat instruction, or delegated), because the repository's own gate says a line of text is not an approval.
4. **One namespace per source.** ID prefixes collide across files (section 6); the studio keys every record as `<source>:<id>`.
5. **Parsers reuse the repository's own.** `validate-context.mjs` and `design-gate.mjs` already parse the context tables, headers and gate status. The studio calls them or ports them with the same tests; it does not write a competing parser.

## 2. Entity mapping

| Entity | Source (authoritative) | ID pattern | Extraction rule | Status vocabulary found | Count |
|---|---|---|---|---|---|
| **Open decision** | `docs/context/DECISION-REGISTER.md` | `D-nnn` | **R-01** table rows whose first cell matches `D-\d{3}`; columns: Kind, Decision needed, Why it matters, Known options, Owner role, Needed by, Status | `Open` (only value) | 37 |
| **ADR (decision record)** | `docs/adr/NNNN-*.md` | `ADR-nnnn` | **R-02** `- **Status:**` line; first word = class; `Type`, `Date`, `Deciders`, `Supersedes` from sibling lines; `## Options considered` numbered list; `- FACT:` / `- ASSUMPTION:` bullets | `Accepted (...)` 13, `Proposed` 7 | 20 |
| **Design** | `docs/architecture/designs/DES-*.md` | `DES-nnnn` | **R-03** header fields `Design ID`, `Review`, `ADRs`, `Tags`; options table with a disposition column | n/a | 3 |
| **Design review** | `docs/architecture/reviews/RV-*.md` | `RV-nnnn` | **R-04** declared status from `- **Status:**`; **computed status and blocking reasons by running** `design-gate.mjs <file>` (read-only) | `Draft, In review, Blocked, Rejected, Approved` (declared); `Blocked, Approvable, Rejected` (computed) | 3 (all Blocked, both ways) |
| **Option disposition** | design option tables | none | **R-05** cells equal to `Selected`, `Not selected`, `Rejected (hard constraint)`, `Deferred` | those four | 3 / 5 / 3 / 2 |
| **Defence question** | `RV-*.md` | `DQ-nn-nn` | **R-06** rows `DQ-..`; second cell | `Answered, Unanswered, Not applicable` | 37 answered, 17 unanswered |
| **Task (owner)** | `docs/state/TODO.md` | `Tn` | **R-07** rows `\| Tn \|`; status = leading bold keyword (`Decided, Done, Approved, Deferred, Open, Agreed, Not granted, Answered`), else `deferred` if in the first section, else `unmarked`; ambiguity flag when more than two other status words appear in the first 600 characters | derived (no status column) | 48 |
| **Decision made (history)** | `docs/state/TODO.md`, table "Decisions made" | date | **R-08** rows whose first cell is a date | n/a | 18 |
| **Roadmap item** | `docs/harness/IMPLEMENTATION-ROADMAP.md` | `Rn` | **R-09** rows `R\d+` | in the row text | 17 numbered (+ `R1b`) |
| **Harness open question** | `docs/harness/OPEN-QUESTIONS.md` | `Qn` | **R-10** rows `Q\d+` | in the row text | 13 |
| **Capstone backlog / gap** | `docs/capstone/PRIORITIZED-BACKLOG.md`, `CRITICAL-GAPS.md` | `B-nn`, `G-nn` | **R-11** bold `**B-nn` and rows `G-nn` | priority column | 16 / 24 |
| **Approval (signed)** | `docs/approvals/*.json`, schema `greenfuel.decision-approval/v1` | `AP-<hex>` | **R-12** parse and verify with `approval-gates.cjs` `verifyDecisionApproval` against `harness/policy/approvers.json` | valid / invalid | **0** |
| **Approver** | `harness/policy/approvers.json` | key id | **R-13** `approvers[]` | enrolled / revoked | **0** |
| **Grandfathered acceptance** | ADR status text | n/a | **R-14** status contains "by instruction in chat" and the number is in `GRANDFATHERED_ADRS` (0001 to 0015) | derived | 13 |
| **Rejection (decision level)** | ADR `Status`, RV status | n/a | **R-15** status class `Rejected` | none found | **0** |
| **Rejection (option level)** | design tables and ADR option lists | n/a | **R-16** `Rejected (hard constraint)` cells (structured, 3); numbered options whose text contains "rejected" (not structured, 26 of 71) | n/a | 3 structured / 26 approximate |
| **Assumption (registered)** | `docs/context/ASSUMPTIONS.md` | `AS-nnn` | **R-17** rows; "Replaced by" cell names a `D-nnn`, an `ADR`, or a requirement | none (all class B) | 26 |
| **Assumption (inline)** | ADR/design/proposal bodies | none | **R-18** lines starting `- ASSUMPTION:` outside run artefacts | none | 28 in 20 files |
| **Model input assumption** | `docs/business/model/inputs.csv` | input id | **R-19** column `class` | `scenario, verified, benchmark` | 79 scenario / 12 verified / 1 benchmark (92) |
| **Risk** | `docs/architecture/RISK-REGISTER.md` | `RK-nnn` | **R-20** rows; Status column | `Open, Mitigated, Accepted, Closed` | 14, all `Open` |
| **Requirement** | `REQUIREMENTS.md`, `NON-FUNCTIONAL-REQUIREMENTS.md` | `BR\|FR\|SEC\|DATA\|AGT\|NFR-nnn` | **R-21** rows; Pri column | `Must, Should, Could` | 99 (80 / 18 / 1) |
| **Hard constraint** | `HARD-CONSTRAINTS.md`; derived copy `memory/architecture-state/CON-*.json` | `HC-nn` | **R-22** rows | approved (ADR 0005) | 12 |
| **Evidence run** | `docs/evidence/records/EV-*.json` | `EV-nnnn` | **R-23** one JSON per run: `claim`, `argv`, `exitCode`, `outputSha256` | exit code | 77 (15 with a non-zero exit, recorded on purpose) |
| **Blocker** | computed | `BLK-n` | **R-24** see [DECISION-INVENTORY](DECISION-INVENTORY.md) section 8 | computed or quoted | 6 |
| **Workflow / policy** | `.github/workflows/*.yml`, `harness/policy/*.json` | file | **R-25** parse YAML keys / JSON | n/a | 2 / 12 |

## 3. Status normalisation (for display only)

The studio must display the **repository's own words**, and add a normalised chip beside them. The chip never replaces the words.

| Repository text | Chip | Notes |
|---|---|---|
| ADR `Accepted (... by instruction in chat ...)` and number 0001 to 0015 | **Accepted, grandfathered (unsigned)** | the harness gate exempts it; it is not a signed approval |
| ADR `Accepted`, number 0016 or higher | **Accepted, signature required** until a valid `greenfuel.decision-approval/v1` is found | the harness rule for new ADRs. None exists |
| ADR `Accepted ... the decision is the architect's, made on the owner's instruction` (0013) | **Accepted, delegated: confirm** | requires review |
| ADR `Accepted` with a deferred or excluded part (0014: actual Azure deployment) | **Accepted, partial scope** | the chip lists the excluded part |
| ADR `Proposed` | **Proposed** | never shown as approved |
| Register `Open` | **Open** | there is no `Decided` value; a decision leaves the register by becoming an ADR |
| TODO task, no keyword | **Unmarked** | requires review |
| TODO `Decided ...(architect, on the owner's instruction)` | **Decided by delegation** | requires review |
| RV `Blocked`, computed `Blocked` | **Blocked (computed)** | with the gate's reasons |

## 4. Dependency and relationship edges

| Edge | Extraction | Count found |
|---|---|---|
| Requirement → open decision | traceability column `Decisions` (`D-nnn`) | 139 edges to 30 distinct decisions |
| Requirement → ADR | same column (`ADR-nnnn`) | 3 |
| Requirement → requirement | column `Depends on` | 78 |
| Requirement → open clarification | column `Open (C)` | 98 |
| Requirement → unverified claim | column `Verify (D)` (`V-nn`, see `CERTIFICATION-SCHEMES.md`) | 63 |
| Design → ADRs | header `ADRs` | DES-0001: 1, DES-0002: 1, DES-0003: 4 |
| Design → review | header `Review` | 3 |
| Review → blocking decisions | gate output "conditional on open D-..." | 177 blocking reasons, **25 distinct open decisions** |
| ADR → decision ids mentioned | regex `D-\d{3}` in the ADR body | per ADR in the snapshot |
| Assumption → replacing decision | column `Replaced by` | 23 name a `D-nnn`; 1 names "ADR" generically; 2 name requirement ids |
| Task → what it blocks | the `Blocks` column of `TODO.md` (free text) | not parsed as edges; shown as text |
| Task → decision | `D-nnn` mentions in the task text | a convenience link, **not** a dependency |
| Memory `DEC-nnnn` → ADR | `subject: adr.nnnn`, `provenance.sourceSha256` | 15; ADRs 0016 to 0020 have none |

**Not found:** an explicit dependency between ADRs, or any `Supersedes` that is not `none`. Overlapping ADRs (section 10 of [DECISION-INVENTORY](DECISION-INVENTORY.md)) have **no declared relationship**, so the studio shows the overlap as a review item and must not draw an edge the repository does not state.

## 5. Provenance carried by every record

```
record: { key: "adr:0016", title, status: {text, chip}, fields: {...},
          source: { file, line, sha256, commit, rule: "R-02" },
          derivedFrom: [ ... ]   // only for derived values, with the rule
          links: [ { type, target, source: {file,line}, declared: true|false } ],
          review: [ { why, rule } ]   // requires-review reasons
        }
```

A link whose `declared` is `false` (found by a text mention rather than a table or header field) is drawn dashed and labelled "mentioned".

## 6. ID namespaces that collide

| Prefix | Meaning in file A | Meaning in file B |
|---|---|---|
| `T` | owner task `Tn` in `TODO.md` | evaluation scenario ids (`T2-a1`) in run artefacts; tool ids in the capability matrix |
| `G` | capstone critical gap `G-nn` (24) | control-matrix gap `G-1` to `G-6`; evaluation gates `G-SEC-nn` |
| `B` | capstone backlog `B-nn` (16) | assumption class "B" in the class legend |
| `R` | roadmap `Rn` | review rules; harness requirement groups |
| `C` | requirement class C (clarification) | decision kind C |
| `D` | decision register `D-nnn` | requirement class D; decision kind D |
| `A` | autonomy action catalogue `A-nn` | requirement class A |
| `Q` | harness open question `Qn` | panel questions `Qnn` in the presentation (50) |

The studio keys every record by source (`todo:T13`, `capstone-gap:G-05`, `control-matrix-gap:G-1`) and shows the short id only inside its own list.

## 7. Write-back policy per entity (proposal; no write exists yet)

| Entity | May the studio propose a change? | How | Never |
|---|---|---|---|
| ADR | **Draft a new ADR as `Proposed`** | a file `docs/adr/NNNN-*.md` from the template, on a branch, via pull request | edit an existing `Status`; write `Accepted`; edit an existing accepted ADR (the template says supersede instead) |
| Decision approval | **Generate an approval request** (`approval.mjs decision --type adr --id ...`) as text for the human to run | the human signs in a terminal; the studio re-verifies the committed record | sign, hold a key, write `docs/approvals/` (control plane) |
| Open decision (D-nnn) | **Record a proposed answer as a note** with an evidence link | a non-authoritative annotation file (new, see integration design) | change `Status`; a decision leaves the register only by becoming an ADR |
| Task | **Propose a status change** as a note or a TODO edit in a pull request | the owner merges | mark a task Done without the evidence the row names |
| Assumption | **Annotate** (confirm, challenge, attach evidence) | annotation file | rewrite the assumption text |
| Risk | **Annotate** | annotation file | change `Status` |
| Requirement, constraint, policy, workflow, memory, evidence | **None** | | any write (control plane, derived, or evidence) |
| Rejection | **Record a proposed rejection as a note** | annotation file | write a `Rejected` status to an ADR |

## 8. What is derived and must be regenerated, never hand-edited

`memory/**`, `docs/acceptance/TEST-EVIDENCE-INDEX.md`, `docs/business/model/results.json`, `docs/architecture-studio/inventory.snapshot.json`, and the gate's computed status. The studio shows each with a "derived, generated at commit X, may lag" label and, for memory, the list of ADRs it does not yet contain.
