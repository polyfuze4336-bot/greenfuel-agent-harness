# Architecture Decision Studio: read-only UI build report

Status: built and tested locally on branch `studio/ui-readonly`; **not pushed, not merged, not approved**. Date of the figures: 2026-10-29. Commit read by the tests: the branch head at the time of the run (the figures below are for the tree at `df07cf2` plus this work).

This stage implements what the discovery stage recommended as the safe first step: a read model built from git objects, shown in a local web interface. Nothing writes back.

## 1. What exists

| Item | Where |
|---|---|
| Application | [apps/architecture-studio/](../../apps/architecture-studio/) (README there explains running it) |
| Repository adapter | `src/lib/repo/git.ts` (read-only git), `parse.ts`, `build.ts`, `index.ts` |
| Server-side API | `src/app/api/v1/*` (7 read-only GET routes and one cache-reset POST) |
| UI | six pages, global search, notifications, sync status, identity menu, detail panels |
| Unit checks | `apps/architecture-studio/checks/adapter.check.ts` (17 tests) |
| Browser tests | `apps/architecture-studio/e2e/*.spec.ts` (67 tests, Microsoft Edge) |
| Screenshots | [screenshots/](screenshots/) (24 captures from the running application) |

Stack, all pinned by `package-lock.json`: Next.js 16.4.2 (App Router), React 19.3.1, TypeScript 7.0.2, Tailwind CSS 4.3.3, Radix UI primitives (dialog 1.3.1, dropdown-menu 2.2.1, popover 1.3.1), lucide-react 1.61.0, Playwright 1.61.0 and @axe-core/playwright 4.14.0 (tests only). 97 packages in total. Installed with `--ignore-scripts`; `npm audit` found 0 vulnerabilities (run 2026-10-29).

## 2. What is real and what is simulated

| Part | Status |
|---|---|
| Every decision, task, approval fact, requirement, risk, assumption, evidence run, document, slide and question | **Real**: parsed from committed files in this repository |
| Commit, branch, upstream, ahead or behind, last fetch, uncommitted count, recent commits, file history | **Real**: read from the local git repository |
| GitHub permalinks | **Real** but only where a pushed commit holds an identical file. Otherwise labelled Local only |
| "On GitHub" state | Derived from local remote-tracking refs. The Studio does not contact GitHub, so it is as fresh as the last `git fetch` |
| Design-gate result per review, and the `validate-approvals` output | **Derived**: read from `docs/architecture-studio/inventory.snapshot.json`. The gate is not re-run |
| "Blocked tasks" | **Rule-based**: the task is not closed and its own text names an unmet prerequisite, or it is Not granted |
| Identity | The local git `user.name` and `user.email`. The Studio has no sign-in |
| Notifications | Derived attention items (blockers, main behind, unpushed, uncommitted, review flags). Read state is kept in the browser |
| Anything simulated | **None.** There is no synthetic data, fake live metric or placeholder in the interface |

## 3. Figures shown, with their definitions

Values at the tested commit. Each page shows the definition next to the number.

| Figure | Value | Definition |
|---|---|---|
| Total decisions | 57 | 20 ADRs plus 37 open register entries |
| Pending | 44 | 37 Open (register) plus 7 Proposed (ADRs 0004, 0015 to 0020) |
| Accepted ("approved") | 13 | ADR status line says Accepted. 0 have a signed approval record. Shown as Accepted, never as approved |
| Rejected | 0 | No ADR or register entry has a Rejected status |
| Deferred | 0 | No decision has a Deferred status. Owner task T2 records that answering the register was deferred, and the Overview says so |
| Blocked tasks | 10 of 49 owner tasks | rule above. Roadmap rows (18) record no status |
| Outstanding approvals | 10 | 7 Proposed ADRs plus 3 design reviews that are not Approved |
| Architecture readiness | Not ready | 0 of 3 design reviews Approved; 3 Blocked by 25 open decisions; 0 approvers; phase 0. A statement, not a percentage |

A unit test compares these counts with the independent discovery snapshot (decisions by class, tasks by status, assumptions, risks, requirements, reviews, approvers). An end-to-end test compares the numbers on screen with the API.

## 4. Requirement coverage

| Requirement in the brief | Result |
|---|---|
| Next.js, TypeScript, React, Tailwind, accessible primitives, lucide, server API, responsive | Done |
| Six primary navigation items | Done; the active page carries `aria-current` |
| Global search, filters, notifications, sync status, identity menu | Search palette (Ctrl+K or `/`, type filters, keyboard navigation); notifications popover; sync popover with a working re-read; identity menu. Filters live on each list (status, type, milestone, scope, source, section, group, sort) and in the search palette |
| Overview with repository-derived metrics | Done (section 3) |
| Decision Register: table and detail, filter, sort, search, group | Done. Detail opens as a side panel (`?id=`) or a full page (`/decisions/{id}`) |
| Every record traceable to GitHub | Path and line on every record; permalink when pushed, otherwise Local only |
| Meaningful empty states, polished loading and error states, skeletons | Done and tested |
| All controls functional, no placeholders, no invented metrics | Verified: no form or editable field exists; a tour makes only GET requests plus the cache-reset POST |
| Read-only adapter, no write-back | Done and proven (section 5) |
| Premium, restrained design | Navy sidebar, cool paper canvas, one sea-blue accent, system type stack, 200 ms or shorter motion that honours reduced-motion, dark theme. No gradients except a skeleton shimmer, no sparkle icons, no emoji, no decorative charts (the one chart is the real status distribution, with a full legend) |

## 5. Test evidence

Run on 2026-10-29, Windows, Node 22.23.4, Microsoft Edge (Chromium), commands from `apps/architecture-studio`:

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run test:unit` | 17 of 17 pass |
| `npm run build` | compiled; 16 routes |
| `npm run test:e2e` | **67 of 67 pass** (3.3 minutes) |
| `node harness/scripts/validate-harness.mjs` | OK |

Browser tests by file: `studio.spec.ts` 18 (navigation, figures, register, queue, approvals, architecture, presentation), `shell.spec.ts` 10 (search, notifications, sync, identity), `states.spec.ts` 11 (errors, empty, loading, hardening), `a11y-responsive.spec.ts` 18, `readonly.spec.ts` 6, `screenshots.spec.ts` 4.

| Area asked for | How it is tested |
|---|---|
| Responsive layouts | Six viewports (1440, 1280, 1024, 820, 768, 390): no horizontal page overflow on any page, sidebar at 1024 and above, navigation sheet below, detail panel fits at 820 |
| Navigation | All six destinations, current-page marking, one `h1` per page, skip link, back and forward restore filter state |
| Accessibility | axe-core (WCAG 2.1 A and AA) on every page, on the densest pages in dark theme, and with the panel, search, notifications and menu open; accessible names on every control; visible focus; status never conveyed by colour alone; reduced motion |
| Keyboard | Ctrl+K and `/`, arrow keys through results and through table rows, Enter, Escape, focus returns to the row after a panel closes |
| Search and filters | Id, title and text search; status, type, milestone, scope, source, group, sort; counts; URL state |
| Empty states | Every list, with a way back |
| Error handling | Unreadable repository (separate server with a bad ref), RFC 7807 API errors, path traversal and bad input, write methods rejected with 405, simulated search and history failures with retry |
| Loading | A separate server with a 700 ms test-only delay shows the skeleton on client navigation |
| Read-only | A tour leaves HEAD, refs, the index and `git status` unchanged; only GET requests plus the cache-reset POST; no form, textarea or editable field; unit test that the adapter refuses any write subcommand |
| Hardening | Foreign `Host` header gets 403; CSP and hardening headers present; pages run under the CSP with no violations; no third-party request |

### Screenshots

Captured by `screenshots.spec.ts` from the running application. Files in [screenshots/](screenshots/):

| Desktop 1440 | Tablet and states |
|---|---|
| 01 overview, 02 register, 03 register grouped, 04 Proposed ADR detail, 05 unsigned Accepted ADR detail, 06 queue (blocked), 07 task detail, 08 approvals, 09 architecture reviews, 10 requirement detail, 11 presentation, 12 search, 13 notifications, 14 sync status, 15 identity menu | 16 empty state, 17 error state, 18 loading skeleton, 19 dark theme, 20 and 21 tablet landscape, 22 to 24 tablet portrait (register, detail, navigation sheet) |

## 6. Defects found by testing, and fixed

Recorded because they show what the test suite is for.

1. The Architecture & Evidence page crashed at runtime: a server component passed an icon component (a function) to a client component. The production build and a plain HTTP check both passed (the framework streams a 200 with the error boundary), so only the browser test caught it. Fixed with a name-based pill.
2. The not-found page had the same defect (also rendered for a missing favicon). Fixed, and a real favicon added.
3. The full-page decision route had no `h1`.
4. Several accessible names did not contain their visible text (search, sync, avatar, source links).
5. The secondary text colour failed contrast (4.4 to 1); darkened.
6. A dropdown menu hid focusable content with `aria-hidden` (axe); menu made non-modal.
7. Focus was not restored to the table row after closing a panel (Radix returns it only to a Dialog trigger); fixed in the sheet component.
8. Horizontal overflow at 390 px on the Architecture page and with long select options.
9. Some of my first test assertions raced the 120 ms search debounce, so they read results before filtering finished; the tests now wait on the results.

## 7. Decisions and approvals needed from the owner

| # | Needed | Why |
|---|---|---|
| 1 | **Confirm the Studio is not "the application" for HC-11**, and that `apps/architecture-studio/` is the right place (discovery question OQ-1). The Studio is not under a phase-gated path (`src/`, `infra/`, `db/`, `ops/`, `evals/`, `tests/product/`), but HC-11 is a rule about intent | The build followed your instruction; it is not a signature |
| 2 | **Accept or reject the dependency set** (97 packages, listed in section 1). TypeScript 7.0.2 and Next.js 16.4.2 are new major versions I did not previously use here | New third-party code in the repository. Scripts were not run at install |
| 3 | **An authorising ADR for the Studio** (status Proposed until an approver is enrolled) | None exists. I did not draft one as Accepted |
| 4 | **Whether to push `studio/ui-readonly`** and `studio/discovery` | Nothing from this stage is on GitHub. Until it is, the Studio correctly shows its own files as Local only |
| 5 | **Whether write-back (S2) should be built next, or stop** | Designed, not built. The discovery recommendation still stands: proposals as branches and pull requests only, no signing |

Recorded as owner TODO T61.

## 8. Limits, stated plainly

- Tested in Microsoft Edge only. Firefox and Safari were not run.
- Automated accessibility testing finds only part of the problems. **No manual screen-reader or keyboard-only review by a person has been done**, so accessibility is not claimed as verified beyond the automated checks.
- The "Apple-inspired" design is a judgement. No user has reviewed it. The system type stack renders Segoe UI Variable on this Windows machine; SF Pro is not available.
- The 1.4 second model build was observed once on this machine; it is not a benchmark. The 5 second cache hides it on repeat views.
- "Blocked tasks" and "pending" follow stated rules, not recorded fields. A person should confirm the rule is the one they want. T2 (status ambiguous) is flagged where shown.
- The design-gate result is the snapshot's, not a fresh computation. If the snapshot is stale the Studio says what it says and shows its file.
- The Studio reads one commit. The three unmerged branches (`origin/main` is 25 commits behind this work) mean the view differs by branch. `STUDIO_REF` selects another.
- Pages for Presentation Studio list the package; the recommended answers in the question bank are in the source files and are not duplicated.
- Write-back is not implemented. No approval is signed, proposed or recorded by the Studio.

## 9. Reproduce

```powershell
cd apps\architecture-studio
npm ci --ignore-scripts
npm run check          # typecheck and unit checks
npm run build
npm run test:e2e       # also regenerates the screenshots
```
