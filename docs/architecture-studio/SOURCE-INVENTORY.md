# Source inventory

Status: **discovery only, 2026-10-29.** Nothing in this document changes a decision, an approval or any existing record. Every number can be regenerated with `node harness/scripts/studio-inventory.mjs` (read-only; the committed output is [inventory.snapshot.json](inventory.snapshot.json), a **generated, derived** file).

## 1. What was inspected, and the baseline that was used

| Item | Value |
|---|---|
| Repository | `polyfuze4336-bot/greenfuel-agent-harness`, **private**, default branch `main` |
| Fetched | `git fetch origin` on 2026-10-29. `origin/main` = `c6ff681` ("README: remove the Provenance section") |
| Baseline used for all counts | branch `architecture/target-design` at `392ac02`, now pushed to origin; **24 commits ahead of `main`** |
| Working branch for this discovery | `studio/discovery` (local, created from `392ac02`) |
| Files in the baseline | 709 tracked files (552 on `origin/main`) |

### Finding 1: `main` is not the authoritative state

The request was to inspect "the latest main branch". `origin/main` is **24 commits behind** the work this repository's governance has produced. It is missing, among other things: the decision-approval gate (`harness/approvals/approval-gates.cjs`, `registry.cjs`), `control-plane-owners.json`, the dev container, ADRs 0016 to 0020, the target architecture (`docs/target-architecture/`), the capstone audit and presentation (`docs/capstone/`) and the candidate security oracles. Those commits sit on three branches that were never merged:

| Branch | Commits ahead of `main` | Relationship |
|---|---|---|
| `origin/capstone/rubric-enhancement` | 4 | ancestor of the baseline |
| `origin/hardening/governance-controls` | 8 | ancestor of the baseline |
| `origin/architecture/target-design` | 24 | the baseline (pushed today at the owner's request, as a branch only; **no merge, no pull request**) |

**A studio that read `main` would show the owner an outdated governance model** (ADRs 0001 to 0015 only, no decision-approval gate, no target architecture). It must read a **named commit**, and the owner must decide the merge path (open question OQ-1 in [IMPLEMENTATION-PLAN](IMPLEMENTATION-PLAN.md)). This document records the decision to read the baseline branch as a discovery choice, not as an approval of anything.

## 2. Source map

**Authority classes.** **A** = authoritative: the record a human or the harness itself treats as the decision or fact. **R** = authoritative *register*: a table that defines the IDs. **D** = derived: produced from an A record by a tool; it must never be edited by hand and can lag. **G** = generated report. **E** = evidence of a run. **H** = history or narrative.

| Area | Path | Class | Format | Written by | Count |
|---|---|---|---|---|---|
| Open decisions | `docs/context/DECISION-REGISTER.md` | **R** | Markdown table, ID `D-nnn` | humans and agents (docs) | 37 rows |
| Decision records | `docs/adr/NNNN-*.md` (+ `0000-template.md`) | **A** | Markdown with `- **Status:**` header fields | agents draft; a human accepts | 20 ADRs |
| Designs | `docs/architecture/designs/DES-*.md` | **A** | Markdown, header fields | agents | 3 |
| Design reviews | `docs/architecture/reviews/RV-*.md` | **A** (declared status); **computed status** is produced by `harness/scripts/design-gate.mjs` | Markdown tables | agents; a human decides | 3 |
| Hard constraints | `docs/architecture/HARD-CONSTRAINTS.md` | **A** (ADR 0005) | table `HC-nn` | human-approved | 12 |
| Risks | `docs/architecture/RISK-REGISTER.md` | **R** | table `RK-nnn` | agents | 14 |
| Assumptions | `docs/context/ASSUMPTIONS.md` | **R** | table `AS-nnn` | agents | 26 |
| Requirements | `docs/context/REQUIREMENTS.md`, `NON-FUNCTIONAL-REQUIREMENTS.md` | **R** | tables, six prefixes | agents; baseline approved by ADR 0003 | 99 |
| Traceability | `docs/context/REQUIREMENTS-TRACEABILITY.md` | **R** (edges) | table | agents | 99 rows |
| Owner tasks | `docs/state/TODO.md` | **R** | tables `Tn` in six sections | owner and agents | 48 open rows, 18 "decisions made" rows |
| State narrative | `docs/state/STATE.md` | **H** | prose | agents | 1 file |
| Approver registry | `harness/policy/approvers.json` | **A** (control plane) | JSON | **humans only** | 0 approvers |
| Decision approvals | `docs/approvals/*.json` | **A** (control plane) | JSON, schema `greenfuel.decision-approval/v1` | **humans only** | **0 records** |
| Approval mechanics | `harness/approvals/*.cjs`, `harness/scripts/approval.mjs` | code | Node | owner | 2 modules, 1 CLI |
| Permission model | `harness/policy/permissions.json`, `agent-policy.json`, `control-plane-owners.json`, `github-protection.json` and 8 more | **A** (control plane) | JSON | owner | 12 files |
| Persistent memory | `memory/decisions/DEC-*.json`, `architecture-state/CON-*.json`, `CURRENT.json`, `lessons/`, `ledger.jsonl` | **D** | JSON, hash-chained ledger | importer and store only | 34 entries (15 DEC, 12 CON, 7 lessons) |
| Evidence records | `docs/evidence/records/EV-*.json`, `MANIFEST.json` | **E** | JSON | the recorder | 77 |
| Evaluation runs | `docs/evaluation/**`, `docs/state/runs/**`, `docs/state/loops/**` | **E** | JSON | harness | about 170 files; **not decision sources** |
| Generated reports | `docs/acceptance/*.md`, `docs/capstone/*.md` | **G**/**H** | Markdown | scripts and agents | see section 3 |
| Context profiles | `docs/context/context-manifest.json` | **A** (config) | JSON | owner | 1 |
| Workflows | `.github/workflows/*.yml` | **A** (control plane) | YAML | owner | 2 |
| Code owners | `.github/CODEOWNERS` | **A**, inactive on this plan | text | owner | 9 paths |
| Infrastructure scaffold | `infra/**` | **A**, phase-gated | Bicep, KQL | none yet | not a decision source |
| Business model | `docs/business/model/*.json`, `inputs.csv` | **A** (inputs); results **G** | JSON, CSV | model script | 92 inputs |

## 3. Derived, generated and narrative files that must never be treated as decisions

| Path | Why it is not a decision source |
|---|---|
| `memory/**` | **Derived** from ADRs by an importer. It currently holds ADRs 0001 to 0015 only; **ADRs 0016 to 0020 have no memory record**, so it lags. `memory.mjs verify` passes (34 entries). |
| `docs/acceptance/TEST-EVIDENCE-INDEX.md`, `HARNESS-ACCEPTANCE-REPORT.md`, `REQUIREMENTS-COVERAGE.md` | Generated by `acceptance-reports.mjs`, regenerated after each stage |
| `docs/capstone/**` | Audit and presentation narrative. Contains its own ID spaces (`G-nn`, `B-nn`) that collide with others (see [DATA-MAPPING](DATA-MAPPING.md) section 6) |
| `docs/target-architecture/**` (13 numbered documents) | Supporting analysis for DES-0003; **duplicates the subject of ADRs 0016 to 0019** and DES-0003 in prose form |
| `docs/design/system/EVIDENCE-STORE-PROPOSAL.md` | A **proposal outside the ADR system**, with its own "Status: Proposed, authored, unverified (revision 2)" |
| `docs/business/model/results.json` | Generated from the model by `business-model.mjs` |
| `docs/state/STATE.md` | Narrative; repeats decisions in prose |
| `docs/state/runs/**`, `docs/state/loops/**`, `docs/evaluation/**` | Run artefacts |

## 4. Existing Markdown conventions the parser must follow

| Convention | Where | Rule |
|---|---|---|
| Header fields | ADR, DES, RV | `- **Field:** value` lines in the first lines of the file |
| ADR status | `- **Status:** Accepted (date, who, how)` or `Proposed` | the first word is the class; the rest is provenance text |
| Register tables | DECISION-REGISTER, RISK-REGISTER, ASSUMPTIONS, TRACEABILITY | pipe tables, first cell is the ID |
| Fact vs assumption bullets | ADR, DES | `- FACT:`, `- ASSUMPTION:` at line start |
| Task status | TODO.md | **no status column**; the state is a leading bold keyword in the text (`**Done 2026-10-29:**`, `**Open: ...**`) or the section heading |
| Requirement classes | all context docs | class legend A (case study), B (assumption), C (clarification), D (claim to verify) |
| Template | `docs/architecture/templates/ADR-DESIGN.template.md` | `0000-template.md` is only a pointer to it |

The existing parser to reuse, rather than rewrite, is `harness/scripts/validate-context.mjs` (`loadContext`, `rowsOf`) and `harness/scripts/design-gate.mjs` (`tableRows`, `cellsOf`, the computed status and its blocking reasons).

## 5. Existing governance and approval mechanisms (inspected, not changed)

| Mechanism | State today | Source |
|---|---|---|
| Phase gate | **Phase 0.** Application paths (`src/`, `infra/`, `db/`, `ops/`, `evals/`, `tests/product/`) are denied to agents | ADR 0002, `permissions.json`, `agent-policy.json` |
| Decision approval (`greenfuel.decision-approval/v1`) | Exists and tested. Approving an ADR needs an **architecture-class** signature; a design review needs the same; a phase raise needs an architecture **and** a deployment key from different approvers. **A line of text saying "Accepted" is never enough** for a new ADR | `harness/approvals/approval-gates.cjs` |
| Grandfathered ADRs | ADRs **0001 to 0015** are exempt (accepted by owner instruction in chat before signing existed). "A new ADR is never added to it" | `GRANDFATHERED_ADRS` in the same file |
| Approver registry | **Empty.** `validate-approvals`: "0 trusted approver(s). ADRs accepted: 13 (13 grandfathered, unsigned ...; 0 signed). Reviews approved: 0. Phase: 0" | `approvers.json`, `validate-approvals.mjs` |
| Signing | Ed25519, human-only: the CLI refuses without an interactive terminal; private keys stay outside the repository | `approval.mjs` |
| Control-plane protection | Paths `harness/`, `.github/`, `.vscode/`, `.mcp.json`, `docs/approvals/`, `memory/`, `evaluation/`, `docs/evaluation/`, `package.json` are agent-write-denied | `permissions.json` pathClasses |
| CI control-plane guard | Present, `enforce: false`, owner list **empty** | `control-plane-owners.json`, `ci-control-plane-guard.mjs` |

## 6. GitHub workflows and branch policy

| Item | Observed |
|---|---|
| Workflows | `validate.yml` (jobs `evaluate` and `validate`: `validate-harness`, permissions, orchestration, memory, loop, evaluation, azure, approvals, isolation) and `infra-validate.yml` (static infrastructure checks and Bicep compile; no Azure sign-in) |
| Triggers | `push` to **`main` only** and `pull_request`. **A push to a feature branch runs no CI** until a pull request is opened |
| Permissions and pinning | `contents: read`; every action pinned to a commit SHA |
| Branch protection | **Not enabled and not enableable on this plan.** `gh api .../branches/main/protection` and `.../rulesets` return **HTTP 403 "Upgrade to GitHub Pro or make this repository public"** (read-only check made 2026-10-29). `github-protection.json` specifies the intended rules and says so |
| Repository settings | private; default branch `main`; security-and-analysis settings not visible to the token |
| CODEOWNERS | present, **inactive** without branch protection |
| Recent CI | last five runs on `main`: three success, two failure (privacy-check commits, since fixed) |

Consequence for write-back: **nothing technical stops a push to `main`.** The only controls are human procedure, the agents' lack of Git credentials, and detection after the fact. A studio that writes to GitHub must impose its own restrictions (see [INTEGRATION-DESIGN](INTEGRATION-DESIGN.md)).

## 7. Rubric (item 10)

**The official rubric PDF is not in the workspace.** The earlier audit says it read `AMA_Capstone_Rubric_Participants.pdf` in full, but no PDF, Word or PowerPoint file exists anywhere under the workspace folder now. The only rubric artefact available is the earlier derived mapping [RUBRIC-TRACEABILITY.md](../capstone/RUBRIC-TRACEABILITY.md), which quotes criterion wording. **I have used that mapping and not reconstructed the rubric from memory.** Please supply the PDF if the criterion wording must be re-checked. The mapping to the studio is in [IMPLEMENTATION-PLAN](IMPLEMENTATION-PLAN.md) section 6.

## 8. Not found

- No signed decision approval record and no enrolled approver.
- No machine-readable decision record other than the derived `memory/decisions/` (the ADR Markdown is the only authoritative form).
- No status field for owner tasks.
- No rubric PDF in the workspace.
- No existing web application, API or UI in the repository.
