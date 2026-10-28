# Context-Loading Strategy

Status: baseline v0.1, 2026-10-28. How specialist agents receive the relevant context instead of the whole repository. Source of truth for the profiles is [context-manifest.json](context-manifest.json); this document explains it. The manifest is checked by `npm run validate`.

## 1. Problem
The repository now holds about 227 KB of Markdown and JSON (measured below). A specialist agent working on, say, mass balance does not need the harness design, the reference assessment, or the sovereignty flow inventory. Loading everything wastes context, buries the rules that matter, and raises the chance of an agent citing an unrelated or unverified statement.

## 2. Approach: layered, profile-based, native
Native Copilot features do the loading (always-on files, skills, file links, search). The only custom artefacts are a data file (the manifest) and its checker. There is no custom orchestrator.

| Layer | What | How it loads | Size (bytes) |
|---|---|---|---|
| L0 Always | [AGENTS.md](../../AGENTS.md) | Loaded natively by the runtime in every session | 4,974 |
| L1 Core | [STATE.md](../state/STATE.md) and [PROBLEMSTATEMENT.md](../../PROBLEMSTATEMENT.md) | Agent reads at session start (the agent definitions and AGENTS.md say so) | 8,075 |
| L2 Profile | The documents and the requirement, decision and scheme rows named by one profile | The agent applies the `context-loading` skill: pick a profile, read its documents, then read only the selected rows | see section 5 |
| L3 On demand | A single requirement, decision, ADR or scheme entry by ID | Agent searches for the ID | small |

Sizes of L0 and L1 were measured on 2026-10-28 and will drift as those files change.

## 3. Profiles
Profile names and contents live in the manifest. Summary:

| Profile | Use for | Requirement selection |
|---|---|---|
| business-framing | Scope, value, stakeholders, options | BR-* |
| capability-dea, -eaa, -dra, -mba, -cca | Design or review one business capability | Rows tagged with that capability, plus a short list of cross-cutting rows |
| sovereignty-data | Residency, isolation, classification, data flows | Rows tagged SOV, DATA-*, and selected SEC and NFR rows |
| security-identity | Keys, identity, tamper evidence, approvals | SEC-*, AGT-*, selected NFR and FR rows |
| agent-governance | Agent charters, autonomy, evaluation | AGT-*, FR rows about answers and approvals, selected SEC rows |
| edge-connectivity | Edge platform, offline operation, device security | Rows tagged EDG, SEC-013 |
| nfr-architecture | Quality attributes and targets | NFR-* |
| compliance-verification | Verify class D claims | Every requirement that carries a Verify (D) reference |
| assurance-review | Independent review of the baseline | All requirements |
| baseline-maintenance | Change the baseline itself | All requirements, all context documents |
| harness-engineering | Change the coding harness | None. Harness documents and ADRs only |

Every requirement is reachable from at least one profile other than the two "all" profiles; the validator fails otherwise.

## 4. Procedure an agent follows (skill `context-loading`)
1. Read L0 and L1.
2. Pick the profile that matches the task. If the task spans capabilities, load the union of those profiles, not `baseline-maintenance`.
3. Open the profile's documents. For requirement files, do not read the whole table. Search for the capability tag in the Caps column (for example the text `DEA`) or for the listed IDs, and read only those rows. Read the matching row in the traceability file by ID.
4. Look up only the decision IDs and scheme IDs the profile lists. Treat every scheme entry as an unverified candidate.
5. Begin the response with a one-line **context declaration**: profile used, documents opened, and any requirement ID ranges read. A reviewer can then check what the agent actually saw.
6. If the task needs something outside the profile, say so and fetch that one item by ID rather than loading a whole document.

## 5. Measured cost (bytes of Markdown and JSON, 2026-10-28)
Measured by `node harness/scripts/validate-harness.mjs --stats` on this commit. Bytes are not tokens; no tokenizer was run. "Whole documents" is what loading every listed file in full costs. "Row-filtered" is what the procedure above costs if the agent reads only the selected requirement rows.

About 227 KB of Markdown and JSON in the whole repository (227,271 bytes when measured; this document itself and later edits change it). L0 plus L1: 13,049 bytes.

| Profile | Requirements selected | Whole documents | Row-filtered |
|---|---|---|---|
| business-framing | 9 | 81,558 | 43,661 |
| capability-dea | 21 | 90,339 | 50,217 |
| capability-eaa | 22 | 93,965 | 54,137 |
| capability-dra | 17 | 90,339 | 48,474 |
| capability-mba | 17 | 93,965 | 51,820 |
| capability-cca | 19 | 90,339 | 48,911 |
| sovereignty-data | 22 | 80,728 | 40,580 |
| security-identity | 33 | 79,113 | 43,514 |
| agent-governance | 23 | 64,527 | 32,001 |
| edge-connectivity | 10 | 74,034 | 28,277 |
| nfr-architecture | 21 | 35,371 | 21,571 |
| compliance-verification | 41 | 84,827 | 53,091 |
| assurance-review | 99 | 110,539 | 110,539 |
| baseline-maintenance | 99 | 127,301 | 127,301 |
| harness-engineering | 0 | 50,157 | 50,157 |

**What this shows.** Loading whole documents saves little: capability profiles cost about 40 percent of the repository because the requirements and traceability tables are large and every capability profile must also carry the sovereignty matrix and part of the requirements. Row filtering brings capability profiles to roughly 21 to 24 percent. The sovereignty matrix and the other matrices are still counted whole in the row-filtered figure, so a section-level read would save more. Row filtering relies on the agent following the procedure; that is not yet tested. The profiles `assurance-review` and `baseline-maintenance` are intentionally large because their task is to see the whole baseline; they are the cost of independent review (49 and 56 percent).

Sovereignty controls were added to every capability profile after an independent review showed that a specialist could otherwise design processing of delivery data without seeing the residency rules. Smaller context was traded for safety on purpose.

## 6. What is deliberately kept out of product profiles
- `docs/harness/*`, the reference assessment, ADR 0000 to 0002: they describe the coding harness, not the product. Only `harness-engineering` loads them.
- `docs/evidence/records/*`: raw run records. Loaded only to verify a specific claim.
- Other capabilities' rows: a capability profile does not load the other four unless the task crosses capabilities.

## 7. Conflict and trust order
When documents disagree: (1) [PROBLEMSTATEMENT](../../PROBLEMSTATEMENT.md) (class A, case-study statements); (2) accepted ADRs; (3) the requirements baseline; (4) [ASSUMPTIONS](ASSUMPTIONS.md); (5) everything else. Anything in [CERTIFICATION-SCHEMES](CERTIFICATION-SCHEMES.md) is an unverified candidate at every position in that list. An agent that finds a conflict reports it; it does not pick a winner silently.

## 8. Limits and risks
- **Not enforced.** Copilot has no native way to restrict which repository files an agent may read. The strategy is guidance plus a declaration the reviewer can check. An agent can still search the whole repository.
- **Staleness.** Profiles can drift from the documents. The validator catches missing files, unknown IDs and uncovered requirements, but it cannot judge whether a profile is sensible.
- **Missing context.** A profile that omits something relevant produces a confident but incomplete answer. The declaration line and the `assurance-review` profile exist to expose this.
- **Size drift.** Section 5 numbers become stale when documents change. Rerun the command and update this section; do not edit numbers by hand.
- **Untested with real agents.** No live session has yet shown that agents follow the procedure. Roadmap item R11 tests that, and only if it fails does a generated "context pack" script become justified (ADR 0001 requires a documented gap before custom code).

## 9. Changing the strategy
Add or change a profile in the manifest, run `npm run validate`, then update sections 3 and 5 here. New requirement documents or capability tags need a manifest and validator review.
