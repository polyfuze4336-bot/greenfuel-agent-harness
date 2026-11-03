# Presentation Studio: generating the capstone deck

Status: built and tested. The deck it produces today is a **sample**: not approved for presentation, not reviewed by a person, never rehearsed. A final deck cannot be generated yet, and the reasons are on the page and in [Gate](#the-gate-for-a-final-deck). It is not a claim that the deck is VCDX-quality: how it looks says nothing about whether the architecture would survive a panel, and the gate and the limitations below say what is still missing.

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

41 slides in three parts, adapted from the requested structure to what the repository can evidence. The panel's time allocation is not known (see [OQ-DECK-1](#decisions-for-the-owner)), so each slide carries a time and the page totals them.

* **Executive story (E01 to E14, with E02B):** thesis; the problem; the stakeholders; value at stake; benefit and cost of inaction; why today's process is not enough; four options on eleven criteria; the recommendation; why it wins; the agentic workflow; evidence and sovereignty; the live-demo narrative; measured results; cost; the decision.
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

## The brief, mapped to what exists

### The twelve pipeline steps

| # | Step | Where it happens | State |
|---|---|---|---|
| 1 | Read the approved architecture baseline | `context.ts` reads baseline readiness and the policy gates | Done. **No baseline is authorized**, so the deck is a sample and a final deck is refused |
| 2 | Collect supporting evidence | `context.ts` (every source read is hashed), `harness/demo/facts.mjs` | Done |
| 3 | Identify unsupported claims | `claims.ts`; an unsupported claim becomes a visible placeholder | Done (41 of 41 supported) |
| 4 | Create an executive narrative | `content.ts`, executive tier E01 to E14 | Done |
| 5 | Propose a slide outline | "Generate outline" in the builder, and `deck.ts outline` | Done |
| 6 | Approve slides individually | `store.ts`: one slide at a time, no bulk, bound to the content hash | Done |
| 7 | Select the visual type | Alternative visuals, offered only when they lose no information | Done |
| 8 | Editable diagrams and charts | `draw.ts`, `visuals.ts`: native shapes, charts and tables | Done |
| 9 | Add approved imagery | `assets.ts`: needs source, licence, a named approver and a matching hash | **No image is approved.** Original vector artwork is used (OQ-DECK-2) |
| 10 | Render previews | PowerPoint, 41 previews | Done on a Windows computer with PowerPoint |
| 11 | Detect overflow and layout defects | `qa.ts`, reading PowerPoint's own measured layout | Done: 0 errors, 0 warnings on the sample |
| 12 | Export PPTX and PDF | `/api/v1/deck/export/*`, served only if the file matches its recorded hash | Done |

### The requested slide topics

Each topic below has a slide. The test `the requested slide topics` finds them by title and section.

| Topic | Slide |
|---|---|
| Business problem | E02 |
| Commercial stakes | E03, E04 |
| Stakeholders | E02B (built from `docs/business/STAKEHOLDERS.md`; the case names two, the rest are candidates) |
| Architecture alternatives | E06, T11 |
| Recommended solution | E07, E08 |
| Azure architecture | T02, A03 |
| Five business agents | T04, with the workflow on E09 |
| Edge-to-shore flow | T03, A12 |
| Data sovereignty | E10 |
| Evidence integrity | T06 |
| Agent autonomy | T04 (the five agents and their autonomy ceilings share one slide) |
| Security | T05, A06 |
| Reliability and recovery | T08 |
| Cost and ROI | E04, E13, A05 |
| Operational metrics | T07, T09, A04 (placeholders: nothing is instrumented) |
| Evaluation results | E12, T10, A07 |
| Risks | T12, A09 |
| Recommendation | E14 |
| Technical appendix | A01 to A13 |

### Editing

Slide title, visual choice, speaker notes, order, approval, rejection and regeneration are each one action on one slide, checked on the server. Source inspection is the evidence list on each slide, linking every file at the exact commit.

* **Speaker notes** replace the spoken script only. The "say plainly" limit, timing and rubric stay. An edited script is labelled "edited, not claim-checked", because the claim checks do not read it. Saving withdraws any review of the slide. Regenerating the slide restores the generated script.
* **Order** moves one slide one place. The title slide stays first, and nothing can move into its place. A stored order can never drop, repeat or invent a slide. Moving does not withdraw an approval, because the slide itself did not change. A build records its own order, so a preview is always the right slide, and the page says when the order changed after the latest build.

### When an approved decision changes

A slide's content hash includes the **status the register gives each decision the slide leans on**. An approval is stored with the status of each of those decisions at the time. If a decision changes (for example ADR-0016 from Blocked to Approved), every slide that cites it stops counting as reviewed, the page names the slides and says which decision moved, and nothing is rewritten. A person reviews the current version again. A decision a slide does not cite changes nothing on it. (This was a gap: the hash covered decision ids but not their status.)

### Loading only when needed

`pptxgenjs` and `jszip` are imported inside the functions that build or inspect a file. Checked three ways: no browser chunk of the production build contains either, preparing and reviewing all 41 slides loads neither (module cache checked at run time), and a build loads them. The editor does not import them.

## The gate for a final deck

A sample is always buildable and is marked on every slide and in the file name. A final deck needs every blocking item:

| Item | Today |
|---|---|
| An authorized, current architecture baseline exists | **Unmet.** No baseline; none can be authorized yet ([BASELINE](BASELINE.md)) |
| Every decision the deck presents is approved | **Unmet.** 7 of 7 are not (ADR-0016 to 0019 Blocked, ADR-0004 and 0015 Blocked, ADR-0020 Proposed) |
| Every claim is supported by a cited source | Met (41 of 41) |
| A person approved every slide at its current content | **Unmet.** 0 of 41 |
| Rendered, measured by PowerPoint, no layout error | Met when built on this computer |
| Sources are exactly the committed commit | Met on a clean tree |
| Placeholders; rehearsal | Informational. 7 placeholders; 0 of 10 rehearsal criteria recorded |

The deck therefore **cannot claim to present an approved architecture**. The recommendation it states is the recommendation; the register says it is Blocked.

## Audit trail

Each build writes `generation.json` next to the file: the commit and branch, the number of uncommitted tracked files, every source with its sha256 and git blob id, the decision statuses shown, every slide's content hash, review state, who decided it, its claim results and placeholders, the baseline and gate result, the renderer used, the quality summary, the hashes of the `.pptx` and `.pdf`, and the asset report. `deck.ts verify <folder>` re-hashes the outputs and inspects the file (slides, notes, charts, tables, pictures). A committed sample is in `docs/capstone/presentation/pptx/`.

## Tested

| Check | What it covers | Result |
|---|---|---|
| `checks/deck.check.ts` | table parsing and clipping; contrast (29 text and background pairs); claim checks including negative cases; content at HEAD (structure, notes, placeholders, numbers from sources); alternative visuals; slide decisions (stale, reason, acknowledgement, concurrency, control characters); the gate (each item flips it); asset licensing (7 failure modes); quality detectors against deliberately bad input; the built file (native, no pictures, notes on every slide, audit record, final refused); a real PowerPoint render and an overflow detector proven against deliberately overflowing text; a decision change making exactly the citing slides stale (against the real register); moving and note editing, with their limits; the built file following a chosen order and edited notes; every requested topic having a slide; the stakeholder slide; lazy loading | 109 of 109 |
| `e2e/deck.spec.ts` | the page, gate reasons, filters, keyboard, axe, tablet width, loading and error states, real roles (viewer, contributor, owner), stale and cross-origin and CSRF refusals, moving slides and editing notes (including the server refusing a moved title slide, a viewer, a stale revision and a cross-origin call), a preview staying correct after a reorder, a real build with preview and PowerPoint and PDF export, a refused final deck | 17 of 17 |
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
13. **Moving a slide does not rewrite the "next" line in its notes**, which was written for the generated order. The page says so; the presenter rereads the notes after reordering.
14. **A decision change is shown in the browser only as far as the data allows.** The unit tests prove it against the real register and a moved decision. The browser fixture has no way to change a decision in its clone, so the banner and the "decision changed" tag are not driven end to end in a browser.
15. **No generated or licensed maritime photograph is in the deck.** No image generator or licensed image has been approved, and an AI agent cannot approve an asset. The title vessel and diagrams are original vector artwork; a hero image enters only through the asset manifest (OQ-DECK-2).
16. **The stakeholder slide shows a clipped "Decides" text** (shortened with an ellipsis to keep the slide light). The full text is in the cited source.

## Decisions for the owner

* **OQ-DECK-1:** the panel's time allocation, so slides can be cut to fit (the full deck is about 35 minutes if every slide is shown).
* **OQ-DECK-2:** supply or approve a hero photograph and the official Azure icon set (with licence), or accept the vector artwork.
* **OQ-DECK-3:** whether slide approvals should become signed records like the architecture approvals.
* **OQ-DECK-4:** review the wording of slides E05, E08 and T11, where source text is shortened to fit.
* Whether to push this work.
