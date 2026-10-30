# Presentation Studio: generating the capstone deck

Status: built and tested locally on this computer. **Not pushed, not approved, not reviewed by a person, never rehearsed.** The deck it produces today is a **sample**. A final deck cannot be generated yet, and the reasons are on the page and in [Gate](#the-gate-for-a-final-deck).

## What it does

It reads this repository at one commit and builds an **editable PowerPoint** with speaker notes, a source list on every slide, an evidence-class label on every figure, and an audit record. With Microsoft PowerPoint installed it also renders the PDF and a preview of every slide, and uses PowerPoint's own measurements to find overflow. The pages are `/presentation/deck` (the builder, reached from `/presentation`) and the CLI [deck.ts](../../apps/architecture-studio/scripts/deck.ts).

```
 repository @ commit ──► sources (hashed) ──► slide content (data) ──► claim checks ──► person's edits and reviews
                                                                            │
         static quality checks ◄── PptxGenJS build (native objects) ◄───────┘
                │                           │
                │                           └─► Microsoft PowerPoint: PDF, previews, measured layout ──► rendered checks
                └──────────────► gate ──► sample deck always │ final deck only if every blocking item is met ──► generation.json
```

| Stage | Where |
|---|---|
| Read sources at a commit, hash each | [context.ts](../../apps/architecture-studio/src/lib/deck/context.ts) |
| Slide content from tables and facts in the sources | [content.ts](../../apps/architecture-studio/src/lib/deck/content.ts), [mdtable.ts](../../apps/architecture-studio/src/lib/deck/mdtable.ts) |
| Claim checks; unsupported claim becomes a placeholder | [claims.ts](../../apps/architecture-studio/src/lib/deck/claims.ts) |
| Alternative visuals, edits, content hash | [slides.ts](../../apps/architecture-studio/src/lib/deck/slides.ts) |
| Drawing: theme, primitives, 13 visual kinds | [theme.ts](../../apps/architecture-studio/src/lib/deck/theme.ts), [draw.ts](../../apps/architecture-studio/src/lib/deck/draw.ts), [visuals.ts](../../apps/architecture-studio/src/lib/deck/visuals.ts), [build.ts](../../apps/architecture-studio/src/lib/deck/build.ts) |
| Quality checks | [qa.ts](../../apps/architecture-studio/src/lib/deck/qa.ts) |
| Render and measure (PowerPoint) | [render.ts](../../apps/architecture-studio/src/lib/deck/render.ts), [render-deck.ps1](../../apps/architecture-studio/scripts/render-deck.ps1) |
| Slide decisions and their rules | [store.ts](../../apps/architecture-studio/src/lib/deck/store.ts) |
| Gate and audit record | [gate.ts](../../apps/architecture-studio/src/lib/deck/gate.ts), [service.ts](../../apps/architecture-studio/src/lib/deck/service.ts) |
| Image and icon licensing | [assets.ts](../../apps/architecture-studio/src/lib/deck/assets.ts) |
| Studio routes, authorization, UI | `/api/v1/deck/*`, [auth.ts](../../apps/architecture-studio/src/lib/deck/auth.ts), [deck-studio.tsx](../../apps/architecture-studio/src/components/deck/deck-studio.tsx) |

## The deck

40 slides in three parts, adapted from the requested structure to what the repository can evidence. The panel's time allocation is not known (see [OQ-DECK-1](#decisions-for-the-owner)), so each slide carries a time and the page totals them.

* **Executive story (E01 to E14):** thesis; the problem; value at stake; benefit and cost of inaction; why today's process is not enough; four options on eleven criteria; the recommendation; why it wins; the agentic workflow; evidence and sovereignty; the live-demo narrative; measured results; cost; the decision.
* **Technical defence (T01 to T13):** context and requirements; Azure service selection; edge-to-shore flows; the five agents and their autonomy ceilings; security, identity and isolation; evidence integrity; scalability; availability and recovery; observability; AI evaluation; trade-offs and rejected alternatives; risks; roadmap.
* **Appendix (A01 to A13):** ADR status; requirement traceability; Azure topology; data-flow register; performance evidence; cost assumptions; threat model; agent evaluation; test coverage; known gaps; panel Q&A; rubric coverage; provenance.

Every slide has one title that carries the message, one supporting line, a body drawn from data, a source footer, speaker notes (script, next slide, "say plainly", timing, rubric, sources), and the status of any decision it leans on **read from the register, never written by hand**.

### Where the numbers come from

Nothing on a slide is typed in. Tables are parsed from the cited documents (the eleven-criterion options comparison, the sovereignty matrix, the Azure service matrix, the autonomy matrix, the recovery and observability tables, the gap register); figures come from `harness/demo/facts.mjs`, which already reads the business model, the evaluation run and the recorded test run from committed files; decision status comes from the register. Charts are native PowerPoint charts of those values. Where the repository holds no evidence the slide says so with a **review placeholder** (7 today: `PH-VOLUME`, `PH-TIME`, `PH-PERF`, `PH-DR`, `PH-OBS`, `PH-PERF-A`, `PH-REHEARSAL`) and never with a figure.

Evidence classes (SCENARIO, MEASURED, DESIGN, CANDIDATE, CASE STUDY, NOT BUILT, NOT RUN, NOT PROVIDED) are shown on every charted figure and are checked by a test.

## Design

16:9, Segoe UI, a restrained maritime palette, a fixed grid, one idea per slide, no decorative charts. Diagrams are drawn deterministically from data and fixed geometry: the verdict heatmap, the sovereign-cell architecture, the data-flow schematic with arrows coloured by design position, the chain of trust, the autonomy ladder, the Azure topology. The title-slide vessel is original vector artwork built from shapes.

Contrast is a test: every text and background pair the design uses must meet WCAG AA 4.5:1. The first run **failed two pairs** (footers 4.02:1, the "meets" green 4.44:1), which were darkened.

### Imagery and icons

No photograph is used. There is no approved image generator and no licensed photograph in the repository, and nothing is generated or scraped. A photograph or an Azure icon enters the deck only through [deck-assets/manifest.json](../../apps/architecture-studio/deck-assets/manifest.json) with a source, a licence, a named approver and a matching file hash; otherwise the deck uses the vector artwork or a labelled monogram tile, and `generation.json` records which. The manifest is empty. To use a licensed hero photograph or the official Azure icon set, add the files and entries; the `hero` slot and the `azure-*` slots are already wired.

## Rules enforced by code

| Rule | Where it is enforced | Test |
|---|---|---|
| A slide's claims are checked against the sources it cites; an unsupported claim becomes a visible placeholder | `claims.ts` | deck.check.ts (5 cases) |
| A slide approval or rejection is bound to the content hash it was given against; editing, regenerating or changed evidence makes it stale and it does not count | `store.ts`, `slides.ts` | unit and e2e |
| A rejection needs a reason; approving a slide that shows a placeholder needs a written acknowledgement | `store.ts` | unit and e2e |
| Every change needs the revision the caller saw; a stale submission is refused | `store.ts`, route | unit and e2e |
| Editing needs the permission to propose; approving, rejecting or a final build needs the permission to recommend; checked on the server on every request, with origin, session and CSRF checks | `auth.ts`, routes | e2e: viewer, contributor, owner, bypass attempts |
| No bulk approval; unknown actions are refused; titles lose control characters and are bounded | route, `store.ts` | unit and e2e |
| A final deck is refused until the gate is met, and leaves no file behind | `service.ts` | unit, CLI, e2e |
| A photograph or icon needs source, licence, named approver and a matching hash | `assets.ts` | unit (7 cases) |
| Exports and previews are served from the latest build only; no path comes from the request | routes | e2e |

An AI agent has no session, so it cannot approve a slide. The slide decision is an **editorial** decision recorded with the person's identity in the Studio's own state; it is not an architecture approval and authorizes nothing outside the deck.

## The gate for a final deck

A sample is always buildable and is marked on every slide and in the file name. A final deck needs every blocking item:

| Item | Today |
|---|---|
| An authorized, current architecture baseline exists | **Unmet.** No baseline; none can be authorized yet ([BASELINE](BASELINE.md)) |
| Every decision the deck presents is approved | **Unmet.** 7 of 7 are not (ADR-0016 to 0019 Blocked, ADR-0004 and 0015 Blocked, ADR-0020 Proposed) |
| Every claim is supported by a cited source | Met (40 of 40) |
| A person approved every slide at its current content | **Unmet.** 0 of 40 |
| Rendered, measured by PowerPoint, no layout error | Met when built on this computer |
| Sources are exactly the committed commit | Met on a clean tree |
| Placeholders; rehearsal | Informational. 7 placeholders; 0 of 10 rehearsal criteria recorded |

The deck therefore **cannot claim to present an approved architecture**. The recommendation it states is the recommendation; the register says it is Blocked.

## Audit trail

Each build writes `generation.json` next to the file: the commit and branch, the number of uncommitted tracked files, every source with its sha256 and git blob id, the decision statuses shown, every slide's content hash, review state, who decided it, its claim results and placeholders, the baseline and gate result, the renderer used, the quality summary, the hashes of the `.pptx` and `.pdf`, and the asset report. `deck.ts verify <folder>` re-hashes the outputs and inspects the file (slides, notes, charts, tables, pictures). A committed sample is in `docs/capstone/presentation/pptx/`.

## Tested

| Check | What it covers | Result |
|---|---|---|
| `checks/deck.check.ts` | table parsing and clipping; contrast (29 text and background pairs); claim checks including negative cases; content at HEAD (structure, notes, placeholders, numbers from sources); alternative visuals; slide decisions (stale, reason, acknowledgement, concurrency, control characters); the gate (each item flips it); asset licensing (7 failure modes); quality detectors against deliberately bad input; the built file (native, no pictures, notes on every slide, audit record, final refused); a real PowerPoint render and an overflow detector proven against deliberately overflowing text | 93 of 93 |
| `e2e/deck.spec.ts` | the page, gate reasons, filters, keyboard, axe, tablet width, loading and error states, real roles (viewer, contributor, owner), stale and cross-origin and CSRF refusals, a real build with preview and PowerPoint and PDF export, a refused final deck | 16 of 16 |
| CLI on this repository | `check`, refused `final`, `build`, `verify` | as expected, exit 2 for the refusals |

The sample deck was built and rendered by Microsoft PowerPoint: 0 errors, 0 warnings, 8 notes (placeholders and live-only criteria). I inspected the rendered slides myself at contact-sheet resolution and fixed what I saw (a text-width estimator that was too conservative, a cell diagram that clipped, a table that overran, truncated table cells, ambiguous icon monograms).

## Limitations

1. **No photography, no official Azure icons.** The artwork is original vector shapes and the icons are labelled tiles, because no licensed or approved asset exists. The deck is clean without them but is less rich than one with a licensed hero image.
2. **Rendering needs Windows and Microsoft PowerPoint.** Without them the deck still builds, but it is not rendered, the PDF and previews are unavailable, overflow is only estimated, and the `qa` gate item stays unmet.
3. **Slide approvals are local editorial state**, kept in the Studio's state folder, not signed and not in the repository, so CI cannot verify them. A final deck depends on them. This is a real weakness of the gate and is stated in the generation record.
4. **A claim check proves a source exists and says what the claim relies on. It does not prove the claim true.** The reviewer does that.
5. **Every business figure is a scenario input.** The deck says so on each slide; it cannot say more.
6. **No human has reviewed the design, the wording or the order.** My inspection is not a design review, and the PowerPoint file's accessibility is partly checked only: charts have alt text, text is live, contrast is tested, but shapes have no alt text and reading order was not verified.
7. **Delivery is unverified.** Pace, presence, listening and composure (B5, C2) cannot be shown by a deck; the rehearsal scorecard has no entry.
8. **The official rubric is not in the workspace.** The deck uses the derived traceability. I read the official PDF's Section B descriptors in `Downloads` for the design standard.
9. **The speaker notes of the first 14 slides reuse the HTML deck's**, so the two decks stay consistent; an edit to one needs the other regenerated.
10. **Font.** Segoe UI; PowerPoint on another system will substitute and layout may change.
11. **Not tested in a pull request or CI**; PowerPoint rendering cannot run on a hosted runner.
12. **Single-owner reality:** one person can edit and approve their own slides. Segregation of duties is not applied to slides.

## Decisions for the owner

* **OQ-DECK-1:** the panel's time allocation, so slides can be cut to fit (the full deck is about 35 minutes if every slide is shown).
* **OQ-DECK-2:** supply or approve a hero photograph and the official Azure icon set (with licence), or accept the vector artwork.
* **OQ-DECK-3:** whether slide approvals should become signed records like the architecture approvals.
* **OQ-DECK-4:** review the wording of slides E05, E08 and T11, where source text is shortened to fit.
* Whether to push this work.
