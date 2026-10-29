# Rehearsal plan and scorecard (B1 to B7, C1 to C3)

**Status of every criterion below: NOT REHEARSED.** Nothing in this package verifies presentation delivery, executive presence or consultative behaviour. Those are scored live by a panel and can be evidenced beforehand only by human rehearsal. The scorecard exists to run that rehearsal, not to claim its result. **No score is assigned here, and none should be entered until a person has done the rehearsal and recorded who scored it.**

**About the standard.** "Excellent expects" is quoted from [RUBRIC-TRACEABILITY](../RUBRIC-TRACEABILITY.md), which was produced from the official rubric PDF in an earlier stage. The PDF is **not in the workspace now**, so I could not re-read it for this stage. Before the first rehearsal, check these ten quotations against the PDF and correct them here.

## Rehearsal rounds

| Round | What | Who | Output |
|---|---|---|---|
| R0 | Read the speaker notes aloud, slide by slide, without the demo; time each slide | You | Per-slide times, cuts needed |
| R1 | Full run with the live demo, timed, in the room or on the same laptop and screen | You, with a timer | Total time, demo time, any failure |
| R2 | Same, in front of one non-technical and one technical reviewer; they answer the scorecard questions | Two peers | Scorecard entries with names and dates |
| R3 | Panel simulation: five prepared questions from the pack, five you have not seen, and three interruptions | Two or three peers | Q&A entries, restate-first check |
| R4 | Failure drill: the demo is made to fail (rename the script, disconnect the network, close the terminal) and you recover | One peer who triggers the failure without warning you | Recovery observations, the exact words used at the switch |
| R5 | Final dress run, 48 hours before, with fresh recordings and the pre-flight checklist | You | Checklist ticked |

Run R2 to R4 at least once each and R1 at least three times (the rubric's acceptance tests ask for three timed rehearsals inside the slot). **The slot length is not known to this package: take it from the official guide** and write it here: ______ minutes, plus ______ minutes for questions.

## Evidence the rehearsers may use

| Artifact | Use |
|---|---|
| [Deck](deck/index.html) (P presents, N shows notes) and [speaker notes](SPEAKER-NOTES.md) | R0 to R5 |
| [Executive demo script](DEMO-EXECUTIVE.md) and [fallback ladder](BACKUP-DEMO.md) | R1, R4 |
| [Deep-dive demos](DEMO-DEEP-DIVE.md) | R3 |
| [Q&A pack](QA-PANEL-50.md) | R3 |
| [Narrative](NARRATIVE.md) | R2 |

## Scorecard

How to use: for each criterion, rehearsers watch for the observable behaviours, tick what they actually observed, write one sentence of evidence, and sign. A criterion's status changes only when a named person has observed the behaviour; the package author never ticks it. Use the rubric's own descriptors for any level; do not invent a score.

### B1. Narrative structure and argument
- **Excellent expects:** "Clear arc — problem, stakes, options, recommendation; the conclusion follows from the evidence presented"
- **Prepared:** [NARRATIVE](NARRATIVE.md), deck M02 to M13 in the order of the ten questions, recommendation stated on M01 and M13.
- **Observe (tick when seen):** [ ] a listener restates the recommendation correctly after the talk; [ ] each claim has evidence on its slide; [ ] the talk presents an argument, not a build tour; [ ] options are compared before the recommendation.
- **Rehearsal test:** a non-technical reviewer restates the recommendation and the main risk after the deck; timed read of the narrative takes under ten minutes.
- **Status:** NOT REHEARSED. Rehearser, date, evidence: ______

### B2. Audience calibration and register
- **Excellent expects:** "Pitches depth to the room; moves between executive and technical registers without losing either audience"
- **Prepared:** executive appendix (E01 to E05) and technical appendix (T01 to T10) separate from the core; glossary slide E05.
- **Observe:** [ ] the core talk uses no unexplained jargon; [ ] when a technical question arrives you move to the appendix and back; [ ] the executive does not feel lost, the technical reviewer finds the contract and test in two clicks.
- **Rehearsal test:** R2 with one non-technical and one technical reviewer; each says what they would have wanted more or less of.
- **Status:** NOT REHEARSED. ______

### B3. Demo and executive hook
- **Excellent expects:** "Demo lands the 'so what' in under two minutes, shows outcome rather than features, and recovers gracefully if something breaks"
- **Prepared:** [executive demo run of show](DEMO-EXECUTIVE.md), `--step` pacing, nine verified recordings, [fallback ladder](BACKUP-DEMO.md).
- **Observe:** [ ] the business point is clear inside two minutes; [ ] the opening states it is candidate code on synthetic data; [ ] a recording, if used, is announced as a recording with its date; [ ] in R4 the recovery is calm and accurate.
- **Rehearsal test:** three offline runs under 120 seconds; one deliberate failure (R4).
- **Status:** NOT REHEARSED. ______

### B4. Q&A composure and depth under challenge
- **Excellent expects:** "Answers go deeper than the prepared material; separates what is known from what is assumed; stays composed under pressure"
- **Prepared:** [50 questions](QA-PANEL-50.md) with evidence, uncertainties and concession guidance; technical appendix.
- **Observe:** [ ] answers separate known, assumed and unknown; [ ] you can go one level deeper than the pack on at least five questions without the document; [ ] composure under an interruption; [ ] you can explain every control without notes (this repository was built quickly with heavy AI assistance, so test this honestly).
- **Rehearsal test:** R3 with five unseen questions; peers note any answer that overclaimed.
- **Status:** NOT REHEARSED. ______

### B5. Delivery craft: pace, presence and time discipline
- **Excellent expects:** "Composed and engaging; paces to land the key points; finishes inside the slot with room for questions"
- **Prepared:** per-slide seconds and cumulative timing in [SPEAKER-NOTES](SPEAKER-NOTES.md); core talk about 16 minutes; appendices excluded.
- **Observe:** [ ] total time inside the slot with room for questions; [ ] you cut a slide rather than rush; [ ] pauses after the key sentences; [ ] eye contact with the room, not the screen.
- **Rehearsal test:** three timed runs in the slot (R1, R5), recorded times written below.
- **Status:** NOT REHEARSED. Times: ______ / ______ / ______

### B6. Written communication: deck and capstone documentation
- **Excellent expects:** "Slides carry one idea each and standalone without narration; capstone documentation is complete and navigable"
- **Prepared:** one headline and one message per slide, a test that limits words per slide and checks that every evidence path exists, a package index and reading order.
- **Observe:** [ ] a reader who has not seen the talk can state each slide's point from the headline and message; [ ] ten canonical questions can be answered within two clicks from the package index; [ ] no slide has more than one idea.
- **Rehearsal test:** hand the deck and the index to someone unseen; ask ten questions; record how many they answer within two clicks.
- **Status:** NOT REHEARSED. ______ (automated checks of the deck are in `tests/presentation.test.mjs`; a human reader test is still needed)

### B7. Use of evidence and data storytelling
- **Excellent expects:** "Claims backed by numbers the audience can act on; visuals chosen to make the point, not to display the data"
- **Prepared:** every number comes from a committed source and carries a class (SCENARIO, MEASURED, REAL RUN); charts only where they carry a claim (benefit by source, cost per certificate, arm results); no invented figures.
- **Observe:** [ ] each number is introduced with its label; [ ] you can name the source of every number on a slide; [ ] you say "not measured" where no measurement exists; [ ] no chart is decoration.
- **Rehearsal test:** a peer points at five numbers and asks "where from and how sure"; record the answers.
- **Status:** NOT REHEARSED. ______

### C1. Discovery and business framing
- **Excellent expects:** "Names the real stakeholders, constraints and success measures; quantify the value at stake and the cost of inaction"
- **Prepared:** [STAKEHOLDERS](../../business/STAKEHOLDERS.md) (candidates, with discovery questions), the value model, cost of inaction in M04 notes and Q08.
- **Observe:** [ ] you state plainly that discovery with real people has not happened (Q01); [ ] you name the stakeholders and what each must see; [ ] you quantify value and cost of inaction and label them as scenarios.
- **Rehearsal test:** a peer plays the sponsor and asks "who did you talk to, and what do I lose by waiting".
- **Status:** NOT REHEARSED. ______

### C2. Active listening and disagreement navigation
- **Excellent expects:** "Answers the question asked; restates challenges accurately before responding; disagrees without dismissing, and concedes when the point is good"
- **Prepared:** restate-first rule on every Q&A entry; "concede or verify" guidance for all 50; three concessions to make freely ([NARRATIVE](NARRATIVE.md)).
- **Observe:** [ ] the question is restated accurately before each answer (peer confirms); [ ] you answer the question asked, not a neighbouring one; [ ] when a point is good, you concede in one sentence; [ ] disagreement is calm, with evidence.
- **Rehearsal test:** R3 with a peer who deliberately gives a good objection and one who gives a mistaken one.
- **Status:** NOT REHEARSED. ______

### C3. Influence and intellectual honesty
- **Excellent expects:** "Makes a recommendation and defends it; surfaces risk unprompted; says 'I don't know' without losing credibility"
- **Prepared:** explicit recommendation on M01 and M13; risks stated unprompted on M12; "what I do not know and how I would find out" in [NARRATIVE](NARRATIVE.md); stop conditions in Q45.
- **Observe:** [ ] the recommendation is stated in one sentence; [ ] three risks are raised before anyone asks; [ ] at least two honest "I don't know, here is how I would find out" answers; [ ] you do not retreat from the recommendation under pressure, and you do not overclaim to defend it.
- **Rehearsal test:** R3 with a peer who pushes you to say "it will work" or "it is compliant"; record whether you resist.
- **Status:** NOT REHEARSED. ______

## Readiness rule

This package is **ready to rehearse**, not ready to present. It becomes ready to present when, for each of B1 to B7 and C1 to C3, a named person has observed the behaviours in at least one of R2 to R4, the timed runs are recorded, and the pre-flight checklist in [BACKUP-DEMO](BACKUP-DEMO.md) is ticked. Until then do not tell anyone that delivery or consultative skills have been verified.

## Rehearsal log

| Date | Round | Rehearser(s) | Criteria observed | Time | What went wrong | Fix |
|---|---|---|---|---|---|---|
| | | | | | | |

## Three honest concessions to rehearse aloud

1. "Under placeholder inputs the base case does not repay in three years, and cost per certificate rises."
2. "Governance and evidence are ahead of the product. The application does not exist."
3. "My evaluation is synthetic and unreviewed, the holdout is not blind, and no language model has run."
