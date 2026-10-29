# Executive demo: run of show (120 seconds)

**What it is.** A real run of candidate code on synthetic data, paced by the presenter. **What it is not.** The Green-Fuel platform (it does not exist), a measurement of time saved, or a statement about Azure. Say this in the first ten seconds, every time.

Nothing in this document means the demo has been rehearsed. A human rehearsal log is in [REHEARSAL-PLAN-AND-SCORECARD](REHEARSAL-PLAN-AND-SCORECARD.md).

## Setup (before the room fills)

| Step | Command | Pass condition |
|---|---|---|
| 1 | `node harness/demo/run.mjs verify` | every scenario says OK |
| 2 | `node harness/demo/run.mjs exec` | finishes in well under a second, no `[REFUSED]` line |
| 3 | `node harness/demo/run.mjs exec --step` | one line appears per Enter key |
| 4 | Open `docs/capstone/presentation/deck/index.html` offline, press P | slide M08 shows the timeline |
| 5 | Terminal font large enough to read from the back; the banner line visible | |

Run step 2 three times; the rubric's acceptance test is three offline runs under 120 seconds. The program itself takes milliseconds: **the 120 seconds is your narration**, so the demo is paced with `--step`.

## Run of show

Start `node harness/demo/run.mjs exec --step` and press Enter once per line. The banner is on screen from the start.

| Time | Press Enter | On screen | Say (one sentence) | Business "so what" |
|---|---|---|---|---|
| 0:00 | none | Banner: candidate oracles, synthetic data, test-only keys, not the platform | "This is real code on synthetic data. It is not the platform, and nothing here is Azure." | Honesty up front |
| 0:10 | 1 | Methodology approved by three different people | "The calculation method is versioned and approved by three people before it can be used." | Method changes cannot slip in |
| 0:20 | 2 | **1. Transfer completed**, 5 signed events | "A barge delivery completes. Every meter event is signed at the source." | Evidence starts at the meter |
| 0:35 | 3 | **2. Evidence bound**, chain verified, 2,500 kg | "The evidence is bound automatically and checked independently: complete, in order, nothing missing." | No manual reconciliation of readings |
| 0:55 | 4 | **3. Emissions attribute**, 3.75, re-run reproduces it | "The emissions figure comes from deterministic code under that exact method version, and it re-runs to the same answer. No model computes numbers." | Reproducible for any dispute or audit |
| 1:15 | 5 | **4a. Drafted by an agent, validated by a service** | "An agent drafted it. It cannot validate, approve or issue." | AI helps, never decides |
| 1:25 | 6 | **4b. Approved by a human**, then issued | "A quality manager signs the exact content with their own key. Only then is it issued." | The human approval is real and bound to this content |
| 1:40 | 7 | **5. Shipowner verifies**, VALID-AS-OF | "The shipowner checks it themselves, offline, with only a public key and the file. They do not have to trust us." | Trust without a phone call |
| 1:55 | 8 | **6. Time saved: not measured** | "How much time this saves is a scenario figure on the next slide, not something this run measured." | No fake metric |
| 2:00 | none | | Return to the slides. | |

**The one sentence to land:** "A delivery became a certificate the shipowner can verify without trusting us, and a person signed it."

## If something goes wrong (fallback ladder)

Say what happened in plain words, at each step. Do not apologise at length; do not improvise numbers.

| Rung | Trigger | Action | What you say |
|---|---|---|---|
| 1 | Command errors or hangs over 10 s | Run it once more | "One moment. I will run it again." |
| 2 | Fails again | `node harness/demo/run.mjs exec --replay` | "The live run is not working. This is the recording of a genuine run made on [date from the banner]. It is a recording, not live." |
| 3 | Terminal unusable | Open the deck, slide M08, and read the six steps from the timeline; open the recording file in an editor | "I will walk through the recorded output instead." |
| 4 | Nothing works | Continue the talk without the demo | "I will describe what the demo shows and its limits; I will not claim I ran it." |

A recording is never described as live. The replay prints a banner and refuses to play if the file was altered. See [BACKUP-DEMO](BACKUP-DEMO.md).

## Variations

- **60-second version:** press Enter 2, 3, 4, 6, 7 only; skip the methodology and the agent line.
- **Panel asks for the failure case:** run `node harness/demo/run.mjs tamper` or `outage`; see [DEMO-DEEP-DIVE](DEMO-DEEP-DIVE.md).

## Rubric mapping

B3 (demo and executive hook): outcome in under two minutes, shows outcome rather than features, recovers gracefully. **Unverified until a human rehearsal and live observation.**
