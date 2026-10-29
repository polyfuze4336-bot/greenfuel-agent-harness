# Capstone presentation and demonstration package

Status: **prepared, not rehearsed.** Nothing here verifies presentation delivery, executive presence or consultative behaviour. That needs a human rehearsal ([plan and scorecard](REHEARSAL-PLAN-AND-SCORECARD.md)).

The package makes one argument and shows what is real. **It does not claim the platform exists. It does not.** Phase 0 is in force: there is no application and no Azure resource. What exists are candidate oracles, an evaluation framework and governance gates, tested on synthetic data.

## Contents

| File | What it is | Generated |
|---|---|---|
| [deck/index.html](deck/index.html) | 13 core slides, 5 executive appendix, 10 technical appendix. Self-contained, works offline. Keys: P present, arrows move, N notes, print for PDF | Yes |
| [SPEAKER-NOTES.md](SPEAKER-NOTES.md) | Notes and timing per slide, transitions, which Q&A to expect | Yes |
| [NARRATIVE.md](NARRATIVE.md) | The ten answers on one page, with evidence, concessions and unknowns | |
| [DEMO-EXECUTIVE.md](DEMO-EXECUTIVE.md) | The 120-second run of show and the fallback ladder | |
| [DEMO-DEEP-DIVE.md](DEMO-DEEP-DIVE.md) | Eight technical demos, each with what it does not show | |
| [BACKUP-DEMO.md](BACKUP-DEMO.md) | Rules and safeguards for using a recorded genuine run | |
| [recordings/](recordings) | Nine recordings of genuine runs, each hash-verified and marked as not live | Captured by running the demos |
| [QA-PANEL-50.md](QA-PANEL-50.md) | 50 panel questions with responses, evidence, uncertainties and when to concede | Yes |
| [REHEARSAL-PLAN-AND-SCORECARD.md](REHEARSAL-PLAN-AND-SCORECARD.md) | Rehearsal rounds and a scorecard for B1 to B7 and C1 to C3 | |

Generated files are built by `node harness/demo/build-package.mjs` from `harness/demo/deck-data.mjs`, `qa.mjs` and `facts.mjs`. Do not edit them by hand: `tests/presentation.test.mjs` fails if they differ from a fresh build. Every number on a slide is read from a committed source file.

## The demo code

`harness/demo/pipeline.mjs` wires the six candidate oracles into one delivery-to-certificate flow and the eight deep-dive scenarios. It uses synthetic data and test-only keys, an in-memory state, a fixed demo clock, and one stand-in (feedstock verification, for which no oracle exists). Running it also closes gap G-1 (oracles not wired together) for the candidates, **not** for a product.

```
node harness/demo/run.mjs list
node harness/demo/run.mjs exec --step          # the executive demo, paced by Enter
node harness/demo/run.mjs tamper               # and approval, outage, lineage, isolation, agents, observability, azure
node harness/demo/run.mjs exec --replay        # a recording, with an unmissable RECORDED banner
node harness/demo/run.mjs verify               # pre-flight: every recording verifies
```

## Labels used on every slide

| Chip | Meaning |
|---|---|
| CASE STUDY | Stated in the case study |
| CANDIDATE | Inferred, or candidate code on synthetic data |
| SCENARIO | An assumption in the business model; not a fact |
| DESIGN | Proposed and unbuilt; the design record is not approved |
| REAL RUN | A real execution of candidate code, now or recorded |
| MEASURED | A synthetic evaluation result or a recorded test run |
| NOT BUILT, NOT RUN, NOT PROVIDED | Does not exist, did not run, was not supplied |

## About the rubric

The official rubric PDF was read in an earlier stage and is **not in the workspace now**. Criteria wording in this package comes from [RUBRIC-TRACEABILITY](../RUBRIC-TRACEABILITY.md). Check it against the PDF before rehearsal. No official score is assigned anywhere.

## What this package does not do

- It does not present a recording as live, and the tooling prints a banner that says so. What the presenter says is a behaviour and is not verified.
- It does not measure time saved, load, latency, resilience, cost incurred or any production result. Those do not exist.
- It does not recommend Azure deployment. The recommendation is a bounded local pilot ([decision slide M13](deck/index.html#M13)).
- It does not claim legal, regulatory or certification compliance.
- It is not a PowerPoint file. If the panel requires one, the content can be exported from the deck data; that was not done.
- The slot length for the panel is not known here; the timing assumes a core talk of about sixteen minutes and should be fitted to the official guide.
