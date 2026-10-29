# Implementation plan

Status: **proposal for the owner, 2026-10-29. Nothing is approved and no code beyond the read-only discovery script exists.** The plan is staged so that each stage is useful on its own and the riskiest capability (write-back) comes last, behind tests that prove it cannot do what the governance forbids. Sizes are relative (S, M, L); no effort or date is estimated, because nothing here has evidence behind it.

## 1. The safest first step is a decision, not code

The repository's own rules make the studio's authorisation awkward, and the plan should say so before anything is built.

1. **BLK-1: no approver is enrolled.** A new ADR (0016 and above) needs a signed decision approval. An ADR that authorises the studio would be one. Until the owner enrolls (T13, T53), the studio's governing ADR can only be `Proposed`, exactly like ADR 0020 today.
2. **HC-11** forbids "an application build before the phase is raised by a human". The studio holds no bunkering data and is harness tooling, but the constraint does not say so.

**Recommended path:** the owner enrolls as an approver, then signs an ADR that records (a) the studio is harness tooling and not "the application", (b) where it lives, (c) its dependencies, (d) its write allowlist. If the owner prefers to proceed without signing, that should be recorded as a conscious exception in chat, as was done for ADRs 0001 to 0015, and the studio should say on its Overview screen that its own authorisation is unsigned. **The studio must not hide that.**

## 2. Stages

### Stage 0: decisions and groundwork (no studio code)

| Item | Detail | Size |
|---|---|---|
| Resolve OQ-1 to OQ-6 (section 4) | recorded as one Proposed ADR | S |
| Merge path for `main` (OQ-2) | the three unmerged branches reach `main` by pull request, in order, by the owner. Until then the studio reads a named commit | owner |
| Add `studio/` to an agent write list | a control-plane change in `harness/policy/agent-policy.json`, made by the owner, only if an agent will build it | S |

### Stage S0: read model and static viewer (read-only, no server, no token)

| Deliverable | Notes |
|---|---|
| Read-model builder | ports `studio-inventory.mjs` into a tested module that reuses the repository's own parsers; reads a commit SHA through Git objects |
| `model.json` | generated, derived; provenance on every record; `review` list |
| Static viewer | self-contained HTML plus assets generated from `model.json`; opens from disk; no network |
| Golden tests | counts at `392ac02` equal [DECISION-INVENTORY](DECISION-INVENTORY.md): 20 ADRs (13 Accepted, 7 Proposed), 37 open decisions (17 M1, 20 M2), 48 tasks, 0 approvers, 0 signed approvals, 99 requirements, 14 risks, 26 assumptions, 3 Blocked reviews with 177 reasons, 25 distinct blocking decisions |

**Acceptance tests (all must pass before S1):**

1. The model builds identically twice from the same SHA (byte-for-byte).
2. Every displayed record has `source file`, `line`, `sha256` and `rule id`; a test fails if any is missing.
3. **No status is invented:** a test feeds each ADR and asserts the chip is a function of the rule table in DATA-MAPPING section 3 only; an ADR whose status line is unrecognised appears in the review queue, not as Accepted or Proposed.
4. A grandfathered ADR is labelled "unsigned" and a zero-approver registry is labelled so; no screen says "approved" for anything that `validate-approvals` does not.
5. A record containing script or HTML renders inert (sanitiser tests); the page makes **no network request** (CSP and a test that fails on one).
6. The viewer shows the commit, the branch and "N commits behind origin/main".
7. Keyboard navigation and contrast checks on every screen; reduced-motion respected.
8. Memory lag is shown: the five ADRs missing from `memory/` are listed.

### Stage S1: local server (still read-only)

| Deliverable | Notes |
|---|---|
| Node server on `127.0.0.1`, random port, per-session token | serves the same UI; reads Git objects; **no POST route exists** |
| Refresh at a new SHA or branch | `git fetch` then rebuild |

**Acceptance tests:** the server refuses non-loopback binds; rejects bad `Host` or `Origin`; has no write endpoint (a route-table test); a browser end-to-end test walks every screen with the Playwright tooling available in this environment.

### Stage S2: proposals written back through pull requests

| Deliverable | Notes |
|---|---|
| Write adapter with the allowlist and refusals of INTEGRATION-DESIGN section 3.3 | proposals only |
| Annotations folder and schema | `docs/architecture-studio/annotations/*.json`, non-authoritative |
| Approval-request generator | prints the command; the human signs |
| Re-verification after merge | reuses the gate and the approval verifier |

**Acceptance tests (negative tests first):** attempts to write to `main`, to a non-`studio/*` branch, to every control-plane path, to an existing `Status` line, to an Accepted ADR, to the register `Status`, to a path with `..` or a symlink, and with a stale base **all fail**, each with its own test. A positive test creates a Proposed ADR and an annotation on a **throwaway private test repository first**, never on this repository. No token is written to disk (a file-system scan test). The studio never displays "approved" for a proposal.

### Stage S3 (optional, deferred): extras

Dependency-graph polish, evidence deep links, CI wiring of the studio tests into `validate.yml` (owner), and any hosted option. A hosted option stays **rejected** until T36 and T37 are decided and branch protection exists.

## 3. Cost and proportionality (read before approving)

The earlier forensic audit recorded the risk that the harness is "overengineered relative to the actual capstone deliverable" (gap G-16: about 13,600 lines of harness code and tests against about 250 lines of solution code, 150 Markdown files, no navigable spine, G-17). The studio **addresses G-17** (a spine and a navigable view of what exists) but **adds code to the side that is already heavy**, and it does **not** address G-01, the top critical gap: there is no working solution. The backlog ranks the vertical slice (B-01) first.

**Recommendation: do Stage 0 and S0 only unless the owner decides otherwise.** S0 gives most of the value (seeing every decision, its provenance and what blocks it) with the least risk and the least new surface. S1 and S2 should be separate, deliberate decisions, taken after Phase 1a is decided, because they compete with it for attention.

## 4. Questions the owner must answer (OQ)

| # | Question | Why it matters | Default if unanswered |
|---|---|---|---|
| OQ-1 | Is the studio "harness tooling" or "the application" under HC-11, and does it live in `studio/` in this repository or in a separate repository? | HC-11 forbids an application build before the phase is raised | build nothing |
| OQ-2 | How do the three unmerged branches reach `main`, and when? | the studio would otherwise read an outdated model | read a named commit and show the banner |
| OQ-3 | Will you enroll as an approver (T13, T53) before the studio's ADR is accepted? | a new ADR needs a signature | the studio's ADR stays Proposed and the studio says so |
| OQ-4 | Should `TODO.md` get a structured status field, or stay free text? | task status is derived and ambiguous today | derived, with review flags; no task write-back |
| OQ-5 | Which UI dependencies are acceptable (for example React, a bundler, a markdown sanitiser)? | the repository has none; each is supply-chain surface | S0 uses the fewest that deliver the interface, pinned, `--ignore-scripts` |
| OQ-6 | Confirm the write allowlist and the annotations folder, and whether TODO edits are in scope | defines what the studio may ever write | no write-back |
| OQ-7 | Who resolves the overlaps (ADR 0004 and 0016; 0015 and 0018; 0014 and 0019) and the proposal outside the ADR system? | the studio will display them as unresolved | shown as review items |
| OQ-8 | Please supply the rubric PDF | the workspace has none | use the derived mapping, flagged |
| OQ-9 | May the studio tests be added to `validate.yml` (control plane)? | without it CI will not check the studio | not added |
| OQ-10 | Do you want branch protection (T14: plan upgrade) before any write-back exists? | `main` is unprotected | S2 stays blocked |

## 5. Risks

| Risk | Mitigation |
|---|---|
| The studio shows a number or status the repository does not support | provenance on every record; derived labels; golden tests |
| Parsers drift from the repository's own validators | reuse the validators; tests compare |
| Write-back lets an unreviewed change reach the control plane | allowlist in code, negative tests, pull requests only, no `main` |
| Effort displaces the vertical slice | S0 only by default; separate decisions for S1 and S2 |
| Supply-chain compromise of the UI toolchain | OQ-5; lockfile; no postinstall; review |
| The studio's own authorisation is unsigned | say so on the Overview screen |

## 6. Rubric relevance (item 10)

**Source:** the derived mapping [RUBRIC-TRACEABILITY](../capstone/RUBRIC-TRACEABILITY.md), which quotes the guide. **The PDF is not in the workspace.** No criterion text is reproduced from memory. No score is implied.

| Criterion (as named in the mapping) | How the studio could help | How it could hurt or does not help |
|---|---|---|
| A1 Architecture, modularity & scalability; A2 Trade-off reasoning | makes the alternatives, dispositions and 177 blocking reasons of the three designs easy to inspect and defend | it does not make decisions. The mapping notes "no accepted architecture"; the studio would show that plainly |
| A3 Security, compliance & responsible AI | provenance, honest approval state, a write path that cannot approve | the studio is one more surface to threat-model |
| **A4 Implementation completeness** | none | the mapping rates the floor exposure **High** because there is **no working solution**. A governance tool is not the solution and can read as the over-engineering already noted (G-16) |
| A7 Agentic autonomy & orchestration | shows how the human approval gates work | the studio is not a business agent |
| B1 Narrative & argument; B6 Written communication; B7 Use of evidence | a navigable spine over 150 Markdown files (gap G-17); every claim linked to evidence | it must not become the story; the story still needs a recommendation and numbers |
| B3 Demo & executive hook | a possible technical deep-dive demo of governance | the executive demo needs a business outcome, which the studio is not |
| C3 Influence & intellectual honesty | the honest empty states (no approver, 0 signed approvals, 37 open) are the honesty the criterion rewards | none |
| D1 to D3 Thought leadership | none directly | none |

**Net:** the studio supports the evidence and honesty criteria and the documentation spine, and does not move the criteria with the highest floor exposure (A4, A5, A6, B3, B7). That is why the plan recommends Stage 0 and S0 only unless the owner decides the trade-off differently.

## 7. Immediate next actions, for the owner

1. Decide OQ-1, OQ-2 and OQ-3 (three decisions unblock everything else).
2. Decide whether to stop after S0.
3. Supply the rubric PDF if wording must be re-checked.
4. Nothing else is needed from the owner to review this discovery. No decision was changed.
