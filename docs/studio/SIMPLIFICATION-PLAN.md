# Simplification plan

Based on [CURRENT-STATE-AUDIT](CURRENT-STATE-AUDIT.md). Principle: **the Studio exists and works; make it faster, safer, smaller and discoverable. Do not rebuild it, and do not damage the harness.** Nothing here is implemented. Items marked **(owner)** need your decision or an action only you can take.

## 1. Keep, merge, simplify, remove

| Item | Action | Reason (audit ref) |
|---|---|---|
| `apps/architecture-studio` (Next.js, one app, one API layer) | **Keep** as the single web app | Works; replacing it has no measured benefit |
| Harness validators, approvals, hooks, memory, policies | **Keep untouched** | Reused, not duplicated (§2.6) |
| 12 agents, instructions, skills, hooks, MCP tools | **Keep; add none** | F-13 |
| Whole-model 5 s TTL cache (`repo/index.ts`) | **Replace** with a commit-keyed, async, stale-while-revalidate snapshot | F-14 to F-16 |
| Three `createRequire` sites into `harness/` | **Merge** into one module `src/lib/harness-bridge.ts` | F-09 |
| Deck builder (`src/lib/deck`, `components/deck`, `scripts/deck.ts`, `render-deck.ps1`, `pptxgenjs`, `jszip`) | **Isolate** as an optional feature: own folder, own route group, loaded only when enabled; declare `jszip`. Not deleted: it supports a capstone deliverable | F-10, F-11 |
| Studio docs in `docs/architecture-studio/` (14), `docs/studio-acceptance/` (10), `docs/studio/` (4) | **Merge** into `docs/studio/` with a one-page index; leave short redirect stubs so existing links do not break | F-04 |
| `docs/state/loops/` (65 files) and similar generated traces | **Stop tracking new ones** (publish as CI artifacts); keep the existing audit trail untouched (it is hash-sealed, see A5) | F-12 |
| `memory/decisions/DEC-*.json` mirror of ADRs | **Derive** by the existing importer in CI instead of hand-synchronizing; the ADR stays authoritative | F-08 |
| Register and Work Queue server-rendered in full | **Page** them (50 rows) and load detail on demand | U-5, U-6, U-10 |
| Explanatory prose on every page | **Cut** to one headline, one number, one action; move definitions behind an info popover | U-4, U-7 |
| `@radix-ui/react-dropdown-menu` (1 file) | **Remove** if the popover can do the job | §4 |
| Native `<select>` filters | **Replace** with a single filter bar of popover menus (Radix popover already present) | U-5 |

## 2. Reuse map: what the Studio should call instead of re-implementing

| Need | Existing harness service | Today |
|---|---|---|
| Is an approval valid | `harness/approvals/approval-gates.cjs`, `registry.cjs` | Reused (3 sites) |
| Is a design Blocked | `harness/scripts/design-gate.mjs` | Re-implemented in `intel`; add an **equivalence test** before any change |
| Requirements and architecture checks | `harness/scripts/spec-validators.mjs` | Not used by the Studio |
| Owner tasks | `harness/scripts/tasks.mjs`, `docs/state/TODO.md` | Re-derived in `queue/derive.ts` |
| Resumable state and decision memory | `harness/memory/store.cjs` | Not used; the Studio keeps its own proposal store (see [TARGET-ARCHITECTURE](TARGET-ARCHITECTURE.md) §5) |
| Evidence integrity | `harness/lib/evidence-integrity.cjs` | Not used by the Studio |

The rule: **a fact that a harness validator can compute is computed by that validator.** The Studio parses to display and explain; it does not decide differently.

## 3. Implementation priorities

Each phase ends with a measurable exit. Effort: S under 1 day, M 1 to 3 days, L over 3 days. All work goes through pull requests from feature branches; `main` is preserved.

### Phase A: make it trustworthy and fast (about 3 days)

| # | Work | Effort | Exit |
|---|---|---|---|
| A1 | Commit-keyed snapshot, async git (`execFile`), stale-while-revalidate | M | p95 page TTFB under 500 ms after idle; no 3.5 s stalls (re-run the audit probe) |
| A2 | `studio` CI job: `npm ci`, `tsc`, unit tests, `next build` on Ubuntu | S | Job green on a PR; fails on an injected type error |
| A3 | Fix hydration #418 and render Markdown in decision text | S | Zero console errors on 13 pages; no literal `**` |
| A4 | Update README, AGENTS.md, Studio `package.json` description; docs index | S | A newcomer reaches the Studio from README in one click |
| A5 | Declare `jszip`. **Redaction of the 6 local-path files was tried and reverted:** those loop records are hash-sealed, redacting breaks `validate-loop` (verified), and rewriting evidence to hide a path is the wrong trade. The path stays in history and in those 6 files | S | `npm ls` clean; a test fails on any undeclared import |
| A6 **(owner; done 2026-11-02, see [PHASE-A-RESULTS](PHASE-A-RESULTS.md))** | Ruleset on `main`: PR required, `validate`, `evaluate`, `studio` and `gate` required, no force push, no deletion, no bypass. **CODEOWNERS review and required approvals were not enabled** because there is one approver | S | `gh api …/branches/main/protection` returns rules; a direct push is refused |

### Phase B: make it a control centre with real data (about 3 days)

**Status 2026-11-02:** B2 and B4 done; B3 partly done (payload and queue cut, page-latency target not met); B1 needs the owner's signing key. See [PHASE-B-RESULTS](PHASE-B-RESULTS.md).

| # | Work | Effort | Exit |
|---|---|---|---|
| B1 **(owner)** | Enrol one architecture-class approver key; take **one** real decision (a genuinely small one, for example a new ADR on the Studio's own hosting or the ruleset in A6) through review, PR, validation, merge | S | A real `docs/decision-reviews/…` record and signed approval exist on `main`; the Overview shows 1 signed approval |
| B2 | Equivalence test: Studio Blocked status versus `design-gate.mjs` on every ADR and RV | S | Test in CI |
| B3 | Page the register and queue; trim page payloads | M | `/decisions` HTML under 150 KB; Work Queue under 1,500 DOM nodes |
| B4 | Single bridge module for harness calls | S | One `createRequire` site |

### Phase C: polish and simplify (about 4 days)

| # | Work | Effort | Exit |
|---|---|---|---|
| C1 | Overview: one message, one primary action; defined-term popovers | M | Product acceptance criteria UX-1 to UX-6 |
| C2 | Filter bar and keyboard model | M | Keyboard-only run of the decision review passes |
| C3 | Isolate the deck builder as an optional module; Windows-only parts behind a flag | M | Studio builds and runs with the module disabled |
| C4 | Consolidate Studio docs; stubs for old paths | S | Link check passes |
| C5 | Derive `memory/decisions` from ADRs | M | `validate-memory` passes without manual edits |

### Phase D: only when approved

Hosting, real Entra and GitHub App, and the Windows rendering decision: see [DEPLOYMENT-PLAN](../studio-acceptance/DEPLOYMENT-PLAN.md). Out of scope here (T36, HC-11).

## 4. Dependencies

| Action | Dependency |
|---|---|
| Retain | `next`, `react`, `react-dom`, `lucide-react`, `@radix-ui/react-dialog`, `@radix-ui/react-popover`, `tailwindcss`, `@tailwindcss/postcss`, `postcss`, `typescript`, `@playwright/test`, `@axe-core/playwright` |
| Retain, make optional | `pptxgenjs`, `jszip` (declare it) |
| Remove if unneeded after C2 | `@radix-ui/react-dropdown-menu` |
| Add | **None.** No state library, UI kit, ORM, cache or queue |

## 5. Explicit non-goals

No database, Redis, Kubernetes, broker or microservice; no new specialist agent; no rewrite; no change to the approval model or to `AGENTS.md`; no Azure deployment; no change to any decision's status.

## 6. Rejected alternatives

See [TARGET-ARCHITECTURE](TARGET-ARCHITECTURE.md) §7.

## 7. Decisions needed from you

1. Approve a ruleset on `main` (A6) and the exact rules.
2. Name the real approver and who holds a second role, so segregation of duties is testable (B1).
3. Is the deck builder kept in this repository as an optional module, or moved to its own repository (C3)?
4. Which phases to start, and which real decision B1 should use (ADR-0021 exists only in the synthetic acceptance world, not in this repository).
