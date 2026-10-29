# Decision Intelligence Engine

Status: implemented, read-only. Measured at commit `b7a7c7a` on branch `studio/ui-readonly`. Not pushed.

The engine turns the ADRs, the decision register and the records that cite them into one validated, traceable register. It lives in `apps/architecture-studio/src/lib/intel/`. It never writes to the repository and never changes a decision.

## 1. What it produces

57 normalized records, read from 226 files at the commit above.

| Measure | Value |
|---|---|
| Records | 57 (20 ADRs, 37 register entries) |
| Approved | 13 (all ADRs whose status line says Accepted; **none has a signed approval record**) |
| Pending Review | 37 (register entries whose status is Open) |
| Blocked | 6 (ADRs that are Proposed and whose design review is declared Blocked) |
| Proposed | 1 (ADR-0020) |
| Rejected, Deferred, Superseded | 0 each: no source declares one |
| Schema validation | 57 of 57 valid |
| Duplicate or overlap candidates | 5 overlaps (ADR pairs 0004–0015, 0004–0016, 0004–0014, 0015–0016, 0016–0020); no id collision, exact-title or similar-title duplicate |
| AI suggestions loaded | 53 (11 decisions), 0 rejected by the validator |

A re-read with a warm cache reused every cached file and re-parsed none (verified by test).

## 2. Authority model

- **Deterministic parsers are authoritative.** Every populated field is copied or mapped from a source line by a written rule.
- **Missing stays missing.** A field no source states is `null` and appears in the record's `missing` list. Nothing is filled in.
- **AI is interpretive only.** Suggestions live in a separate file, are labelled, and are never merged into a record field.
- **Statuses are mapped, never promoted.** An ADR that says Accepted is shown as Approved, with its approval basis (`owner-instruction-unsigned`) and an "Approved without a signed approval record" flag. The Studio cannot sign anything.

## 3. Schema field → source → rule → when missing

| Field | Source and rule | If missing |
|---|---|---|
| Decision ID | ADR file number (`ADR-00NN`) or register `D-NNN` | Record not created |
| Title | ADR heading or register row | Record not created |
| Description | ADR "Context" section; register row text where it has one | `null`, listed (37 of 57 are empty) |
| Business justification | ADR "Context"/"Decision" statements; traced requirement text | `null`, listed |
| Category | Register category column; ADR category header | `null` |
| Priority | Priority of the requirements the decision traces to | `null` (15 of 57) |
| Status | Section 4 | Never empty |
| Recommended option | ADR "Decision" or the design option marked selected; register: none is chosen | `null` where the register states none is chosen |
| Alternative options | ADR "Options considered" numbered list; design comparison options table; register option list | Empty list |
| Pros and cons per option | Design comparison table, only where a column maps to the option by letter or by an unambiguous position; ADR "Consequences" lines | Declared "none recorded" |
| Cost, security, reliability, data sovereignty, operational implications | ADR sections of those names | `null` (51 of 57) |
| Dependencies, blocking requirements, related ADRs, risks, tasks | Explicit `D-`, `ADR-`, `RK-`, `T` and requirement ids found in the record's own source and in files that cite it | Empty list |
| Required approver role, decision owner | Register and ADR columns and headers | Populated for all 57 |
| Decision date | ADR "Date" header | `null` for register entries |
| Approval history | ADR status line, signed approval records, the TODO decision log | Empty (42 of 57) |
| Source file, line, commit SHA | The file and line where the record starts, and the commit the engine read | Always present |
| Evidence references | `EV-` ids and evidence manifest entries that name the decision | Empty (49 of 57) |
| Rubric mapping | Mentions of rubric criteria in the record or its design review. The official rubric PDF is not in the workspace, so only repository mentions are used | Empty (47 of 57) |

Every populated field also carries a `fieldSources` entry (path, line, rule). The record detail view shows this as a provenance table.

## 4. Status mapping

| Source says | Record status |
|---|---|
| ADR `Accepted` | Approved |
| ADR `Rejected` / `Superseded` / `Deferred` | Rejected / Superseded / Deferred |
| ADR `Proposed`, design review declared Blocked | Blocked |
| ADR `Proposed`, otherwise | Proposed |
| Register `Open` | Pending Review |

The register-wide owner deferral (task T2) is a flag on the records, not a change of status. No rule moves a record into Approved except a written Accepted status.

## 5. Duplicate detection

Pairwise, deterministic, token-based. Candidates are listed for a person; nothing is merged.

| Kind | Rule |
|---|---|
| id-collision | Two sources produce the same id |
| exact-title | Normalised titles are equal |
| similar | Title Jaccard ≥ 0.30 (stop words removed) |
| overlap | ADR pair whose cited-decision sets have Jaccard ≥ 0.45 **and** share at least 4 decisions |
| supersession-gap | One record says it supersedes another that does not say it is superseded |

Body similarity is only considered when both bodies have at least 8 tokens.

## 6. Change detection and incremental sync

- Per-file fragments are cached by git blob id, so an unchanged file is never re-parsed.
- A baseline (commit and per-record content hashes) is saved outside the repository: `STUDIO_CACHE_DIR`, else `<cwd>/.studio-cache` (git-ignored).
- `GET /api/v1/register/changes` compares the current register with the baseline or with a named ref (`?from=origin/main`). The ref is validated and passed as one argument to git, never through a shell.
- Record changes are reported per field. A change in status, or a removed record, carries an alert. In the UI, records with alerts are listed first, and the preview shows 10 records with a "Show all" control.
- `POST /api/v1/register/sync` is the only POST. It reads the repository and saves the baseline in the cache directory. It writes nothing to the repository.

## 7. Compare Alternatives

`/decisions/[id]/compare` puts the recommended option first, beside the others, using only recorded criteria and verdicts (for ADR-0004: 5 options and 10 criteria from DES-0001). Verdicts are not totalled into a score. Where the sources record no pros or cons (for example D-010), the page says so and shows AI suggestions, if any, in a separate, labelled block.

## 8. AI-assisted analysis

- **File:** `docs/architecture-studio/suggestions/ai-suggestions-2026-10-30.json`. 53 suggestions for D-010, D-011, D-013, D-018, D-021, D-027, D-028, D-030, D-036, ADR-0016 and ADR-0017.
- **Origin:** written by the AI assistant in GitHub Copilot during the session. The model version is not recorded. The Studio does **not** call a model at runtime, and no model endpoint is approved.
- **Schema:** unknown keys such as `status` or `confidence` are rejected. Each item carries the label "AI SUGGESTION", `reviewState: unreviewed`, and `basedOn` paths or ids that must resolve in the repository.
- **Display:** always badged "AI suggestion · unreviewed · not evidence". Confidence is not offered, because it would not be proof of technical or regulatory correctness.
- **Review:** there is no accept action. Adopting a suggestion means a person edits the source record through the normal approval path.

## 9. Interfaces

| Route | Purpose |
|---|---|
| `GET /api/v1/decisions` | Register list; `status`, `type` (`adr` or `register`) and `milestone` filters; an unknown status is refused with 400. Priority, category, text search and grouping are in the UI |
| `GET /api/v1/decisions/[id]` | Record, duplicates, suggestions, alternatives |
| `GET /api/v1/register` | Health: stats, validation, duplicates, suggestion count |
| `GET /api/v1/register/changes` | Changes against the baseline or a ref |
| `GET`/`POST /api/v1/register/sync` | Baseline status / incremental sync |
| `GET /api/v1/source` | Read-only preview; only `docs/`, `harness/policy/` and `harness/scripts/`, with an extension allowlist |

UI: Decision Register (seven status chips, filters, grouping, health panel), decision detail (every field, provenance, approval history, AI block, duplicates, source preview), and the compare page.

## 10. Tests and evidence

| Suite | Result |
|---|---|
| Unit (`npm run test:unit`) | 47 of 47 pass: 30 engine tests plus 17 adapter tests |
| Browser (Playwright, Edge) | 89 of 89 pass, including the new `intel.spec.ts` and axe checks on the compare page, health panel, AI block and source preview |
| `tsc --noEmit`, `next build` | Clean |
| Screenshots | `screenshots/25-…` to `30-…` |

The unit tests build throw-away git repositories, and also check invariants against this repository:

| Required behaviour | How it is tested |
|---|---|
| Approved stays approved | "keeps approved decisions approved and rejected decisions rejected across unrelated changes"; "flags an Approved decision that stops being Approved"; and against the real repository, "keeps existing Accepted ADRs Approved (unsigned) and Proposed ADRs unapproved" |
| Rejected stays rejected | The same tests, which also cover a Rejected ADR that is reopened |
| Missing fields are not fabricated | "a bare ADR yields nulls, empty lists and an honest missing list"; "register entries have no recommended option, no pros or cons and no implications"; "priority comes only from requirements that trace to the decision"; "never changes the record: records are identical with and without the suggestions file" |
| Duplicates detected | "finds identical titles, similar titles, id collisions and supersession gaps"; "does not flag unrelated decisions" |
| Provenance preserved | "preserves provenance: commit, blob, file and line are real for every record and every claim"; "section lines point at the real line in the file" |
| Repository changes detected | "reports the first sync as initial, then exactly what changed, and re-parses only changed files"; "an incremental result equals a full rebuild"; "detects an unreviewed jump to Approved with no history, and compares two commits"; "persists the baseline in the Studio cache folder and never in the repository" |

## 11. Limits

- **The Approved count is not a signed-approval count.** 13 ADRs say Accepted, by owner instruction in chat. No signed approval record and no enrolled approver exist.
- **Heuristic rules.** Overlap thresholds and the position-based option mapping are conventions chosen here, not validated against a labelled set. Treat a candidate as a prompt to read, not a finding.
- **Most register entries are sparse.** They hold a title, category and options. The engine reports the gaps; it does not close them.
- **Rubric mapping is partial.** The official rubric PDF is not in the workspace.
- **GitHub permalinks** appear only where a pushed commit holds an identical blob. `studio/*` branches and recent commits are not pushed, so most links show "Local only".
- **No runtime AI.** AI suggestions are static, reviewed-by-nobody text.
- **Browser coverage is Edge only.** Accessibility is checked by axe; no manual screen-reader review has been done.
- Browser tests assume the current counts (57, 13, 6, 1, 37) and that `origin/main` differs from HEAD. They will need updating when the register or the remote changes.

## 12. Owner decisions still open

Recorded as TODO T61:

- Approval of the Studio's dependency set.
- The authorising ADR for the Studio.
- Pushing the `studio/*` branches.
- Write-back, which is not implemented.

The owner has confirmed that the Studio is not "the application" under HC-11 (2026-10-30). The remaining items stay deferred.
