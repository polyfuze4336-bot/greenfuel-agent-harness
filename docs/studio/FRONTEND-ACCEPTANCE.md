# Frontend acceptance: four destinations

The Studio's navigation, Overview, Decisions page and a new Changes page were reworked so the product answers three questions at once: **what needs me, what is blocking progress, what changed.** Nothing was rebuilt from scratch: the stack (Next.js, React, TypeScript, Tailwind 4, Lucide, Radix dialogs) was already in place, no dependency was added, and the existing review, work-queue, baseline and deck features are unchanged and still reachable.

This document records what changed, how it was tested, what the numbers were, and what is not done. Screenshots are real captures of the production build reading this repository ([`screenshots/`](screenshots/)).

## What changed

| Area | Before | After |
|---|---|---|
| Navigation | Six items: Overview, Decision Register, Work Queue, Approvals, Architecture & Evidence, Presentation Studio | Four: **Overview, Decisions, Changes, Presentation**. Pages that used to be primary items are reached from section tabs (Decisions: Register · Work queue · Architecture & evidence. Changes: Updates · Approvals · Readiness). They keep their own addresses, so no link or bookmark broke |
| Overview | A wall of statistics | Readiness in one line, then **Needs your attention**, **What is blocking progress**, **What changed recently**, and a four-figure "At a glance" strip. Every row links to the records behind it |
| Decisions | Four statistic cards, three accordions and two rows of filters before the first decision | Search, priority and status first; the secondary filters (type, category, milestone, grouping, scopes) sit behind **More filters** and open themselves when a link needs them; the table follows immediately; register health moved below it |
| Changes | Did not exist | Readiness, **Pending GitHub updates** (each with its state and pull request), **Conflicts and failures** when there are any, **Approval history**, and repository commits |
| Keyboard | Row arrows and Enter, `Ctrl K` / `/` for search | Added **`g` then `o`, `d`, `c` or `p`** to move between destinations. It does nothing while typing, with a dialog open, or with a modifier held |
| Dark theme | Selected chips and primary buttons were navy on a near-navy canvas | A theme-aware selected colour (`--selected`) is used everywhere a control is selected or primary |

New or changed code: `components/shell/nav.ts`, `section-tabs.tsx`, `go-to-shortcuts.tsx`; `app/page.tsx` (Overview), `app/changes/page.tsx`, `components/recent-changes.tsx`, `components/quiet-empty.tsx`; filter layout in `decision-explorer.tsx`; colour tokens in `globals.css`.

## Real data, no placeholders

Every figure and list comes from the model the Studio already builds from the repository: attention and blocker items from the derived blockers and metrics, commits from git history, proposals and review actions from the Studio's own workflow store, approvals from the approval registry. Nothing on these pages is invented.

- **"Pending GitHub updates" and "Approval history"** show review activity recorded by *this* Studio. When there is none they say so (an empty state, not a sample). The public read-only deployment records no review actions and says that instead of showing an empty list that could be misread as "nobody approved anything"; signed approvals live in the repository and are counted from there.
- **Sign-in and sign-out events** are not shown as approvals.
- Overview figures are checked against the API model by the browser tests.

## Performance

**Targets:** Lighthouse performance of 90 or more on representative pages; no new client dependencies; no full-page reload for routine interactions; reduced-motion respected.

**Conditions (so the numbers can be reproduced):** Lighthouse 12.8.2, Microsoft Edge 155 (headless, own profile), Next.js production build served on `localhost:3100` from a developer laptop, `origin/main` at `ade030e`, three runs per page, median reported. *Desktop* is the Lighthouse desktop preset. *Mobile* is Lighthouse's default mobile emulation with simulated slow-4G and 4x CPU throttling, which is much harsher than a real desktop session. There is no network latency, because the server is local.

| Page | Desktop perf | Desktop LCP | Mobile perf (3 runs) | Mobile LCP | Mobile TBT | CLS | Accessibility / Best practices | Transfer |
|---|---|---|---|---|---|---|---|---|
| Overview | 100 (96, 100, 100) | 0.57 s | 96 (96, 96, 97) | 2.7 s | 36 ms | 0 | 100 / 100 | 241 KB |
| Decisions | 100 (96, 100, 100) | 0.65 s | 92 (92, 92, 94) | 3.3 s | 85 ms | 0 | 100 / 100 | 281 KB |
| Changes | 100 (96, 100, 100) | 0.62 s | 95 (93, 95, 96) | 2.8 s | 39 ms | 0 | 100 / 100 | 236 KB |
| Presentation | 100 (96, 100, 100) | 0.63 s | 95 (92, 95, 97) | 2.6 s | 75 ms | 0 | 100 / 100 | 250 KB |

**Result:** every page meets 90 or more in every run, desktop and mobile. The weakest is Decisions on mobile (92), which carries the full table. The remaining cost is largest-contentful-paint under throttling, not script: total blocking time is under 100 ms and layout shift is zero.

**What this does not show:** the Azure deployment was not measured (and still serves the previous UI); Linux was not measured; Lighthouse lab scores are not field data.

Other measures: no animation library (CSS transitions of at most 200 ms, disabled under `prefers-reduced-motion`); `package.json` and the lockfile are unchanged; navigation between destinations is client-side (a browser test sets a marker on `window` and proves it survives four navigations).

## Tests

| Suite | Result |
|---|---|
| Unit (`npm run test:unit`) | **405 of 405** pass, including 5 new tests of the navigation model |
| Browser, full suite, first run | 249 passed, 1 skipped (pre-existing), 8 failed: the eight new visual-regression tests, which had no baselines yet |
| Browser, after baselines and the dark-theme fix | **167 passed, 0 failed, 1 skipped** across the affected specs (accessibility and responsive, destinations, navigation, console, states, shell, read-only, review workflow, work queue, decision intelligence) |
| New `destinations.spec.ts` | 24 tests, all pass, twice (the second run against the recorded baselines) |

What the new and updated tests cover, against the brief:

| Brief | Covered by |
|---|---|
| Navigation | Four primary links; current-page marking; section tabs and the destination staying current on sub-pages; no tabs on a single record; link targets from the Overview all return 200 |
| Responsive layout | No horizontal overflow on all eight pages at 1440, 1280, 1024, 820, 768 and 390 px; correct navigation pattern at each size (sidebar or drawer) |
| Accessibility | axe (WCAG 2.1 A and AA) on every page including the new one, in light and dark; overlays; every control named; visible focus; status never colour-only; reduced motion |
| Keyboard | `g`+key routing, and that it stays out of the way while typing or in a dialog; arrow keys and Enter in the register; Escape returning focus; skip link |
| Console errors | Zero console errors or warnings on every page, including `/changes` |
| Visual regression | Eight baselines (four pages, desktop and mobile). Dynamic text (numbers, hashes, dates, commit list, the table) is masked, so what is compared is layout, spacing, type and colour |
| Loading and error states | Skeleton on client navigation to Changes against a server with an artificial 700 ms delay; repository error panel against a server that cannot read the repository; empty states |
| Approval flow on the new page | An approval submitted in test mode appears under Pending GitHub updates as *Pull request created* with its pull-request link, is gone after the merge, and then appears in the history with the person who made it |

## Screenshot review

All fourteen captures were viewed, not just generated. What the review found, and what happened:

1. **Defect, fixed: the Changes page failed to render.** A server component passed an icon function to a client component. It was caught by looking at the screenshot, not by a test, which is why a server-safe empty state (`quiet-empty.tsx`) now exists and the browser suite includes the page.
2. **Defect, fixed: dark theme hid the selected state.** Selected status chips and the primary buttons were navy on a near-navy canvas. Fixed with a theme-aware colour pair and re-captured (`10b-decisions-dark-selected-filters.png`).
3. **Layout, fixed:** the first Overview left a large gap under the shorter column. Recent changes now sits under Needs your attention.
4. **Content, fixed:** Approval history listed sign-in events. They are filtered out.
5. **Reviewed and acceptable:** the decision panel opens beside the table without losing the list or the filters; mobile stacks cleanly with a drawer; tabs scroll horizontally if they ever overflow; the empty states read plainly.

| Screenshot | Shows |
|---|---|
| [01](screenshots/01-overview-desktop.png), [11](screenshots/11-overview-mobile.png) | Overview, desktop and mobile |
| [02](screenshots/02-decisions-desktop.png), [03](screenshots/03-decisions-more-filters.png) | Decisions, default and with More filters open |
| [04](screenshots/04-decision-panel-keeps-context.png) | A decision opened in the side panel, table still behind it |
| [05](screenshots/05-changes-desktop.png), [13](screenshots/13-changes-mobile.png) | Changes |
| [06](screenshots/06-readiness-tab.png), [07](screenshots/07-work-queue-tab.png) | Readiness and Work queue under their section tabs |
| [08](screenshots/08-presentation-desktop.png) | Presentation |
| [09](screenshots/09-empty-state.png) | Empty search |
| [10](screenshots/10-overview-dark.png), [10b](screenshots/10b-decisions-dark-selected-filters.png) | Dark theme |
| [12](screenshots/12-decisions-mobile.png), [14](screenshots/14-navigation-drawer-mobile.png) | Mobile register and navigation drawer |

## Keyboard map

| Keys | Action |
|---|---|
| `g` then `o` / `d` / `c` / `p` | Go to Overview / Decisions / Changes / Presentation |
| `/` or `Ctrl K` | Search across every record |
| Arrow keys, `Enter` | Move through register rows, open one in the side panel |
| `Esc` | Close the panel, returning focus to the row |
| `Tab` (first press) | Skip link to the main content |

## Known limits

- **Not deployed.** The Azure app still runs the previous image and shows the previous UI. Deploying means a rebuild and rollout (the data already follows `main` on its own).
- **Browser tests are not in CI.** The `studio` workflow runs typecheck, unit tests and a build. The Playwright suite takes about 30 minutes locally and was run by hand. Adding it to CI is a separate decision about cost and runtime.
- **Visual baselines are Edge on Windows.** They are skipped on other platforms, and regenerated on purpose with `--update-snapshots`. Masking hides text and numbers, so a wrong number is caught by the data tests, not the screenshots.
- **Presentation is the existing deck builder page**, retitled; it was not redesigned. The rehearsal list and builder are unchanged.
- **Overview blocker BLK-6 ("Branch protection is not in force") is stale.** It is read from TODO row T14, which has not been updated since the rulesets were applied. That is a repository record to update, not a Studio defect, and the Studio is right to show what the record says.
- **Older screenshots** in `docs/architecture-studio/screenshots/` show the previous six-item UI and are kept as the record of that build.
- Lighthouse numbers are lab measurements on a local server; real-world numbers depend on the network and on where the app is hosted.
