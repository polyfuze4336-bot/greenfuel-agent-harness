# Narrative: the argument in ten answers

One page for the speaker. Each answer is one claim, its evidence, and its label. The deck follows this order. Numbers are read from committed sources by the deck builder, so they match [the slides](deck/index.html) and [the Q&A](QA-PANEL-50.md).

**Labels:** CASE STUDY, CANDIDATE (inferred or candidate code), SCENARIO (assumption), DESIGN (proposed, unbuilt), REAL RUN (candidate code on synthetic data), MEASURED (synthetic evaluation or a recorded test run), NOT BUILT, NOT RUN.

**The recommendation in one sentence (say it early and again at the end):** Fund a bounded local pilot of sovereign evidence cells on synthetic data, and do not fund Azure deployment or the full build until four inputs turn assumptions into numbers.

| # | Question | Answer | Evidence | Label | Slide |
|---|---|---|---|---|---|
| 1 | What commercial problem? | A green-fuel claim is worth only what its certificate is trusted for. The chain from meter to shipowner is fragile: evidence in many places, methods that change, disputes that need proof | [PROBLEMSTATEMENT](../../../PROBLEMSTATEMENT.md), [STAKEHOLDERS](../../business/STAKEHOLDERS.md) | CASE STUDY, CANDIDATE | M02 |
| 2 | Why does reliability decide competitiveness? | The premium is what the market pays for trust. The model shows a premium pool and the share trustworthy certification protects. No business figure was supplied | [BUSINESS-VALUE-MODEL](../../business/BUSINESS-VALUE-MODEL.md) | SCENARIO | M03 |
| 3 | Value at stake, cost of inaction? | Base case: negative three-year NPV, long payback; break-even needs more deliveries a year than assumed. Inaction keeps manual cost and forgoes the annual benefit | same | SCENARIO | M04 |
| 4 | Alternatives? | Three options costed on eleven criteria: centralised cloud (cheapest, cannot show residency), edge plus one shore platform (conditional), sovereign cells with federated coordination (eligible) | [02-ARCHITECTURE-OPTIONS](../../target-architecture/02-ARCHITECTURE-OPTIONS.md) | DESIGN, SCENARIO | M05 |
| 5 | Recommendation and why? | Sovereign cells, deterministic core, bounded agents: evidence stays in its port; software computes and signs; AI drafts and explains | [03-ARCHITECTURE-VIEWS](../../target-architecture/03-ARCHITECTURE-VIEWS.md), [DES-0003](../../architecture/designs/DES-0003-target-system-architecture.md) (Proposed) | DESIGN | M06 |
| 6 | What is implemented? | Six candidate oracles, an evaluation framework and governance gates, all tested on synthetic data; no application, no Azure resource, no LLM run | [13-SECURITY-REVIEW](../../target-architecture/13-SECURITY-REVIEW.md), [EV-0077](../../evidence/records/EV-0077.json) | CANDIDATE, MEASURED, NOT BUILT | M07, M08 |
| 7 | Behaviour under failure? | Refuse, wait or escalate; never guess. Edge outage, tamper, replay and injection are tested on the candidates; regional outage and recovery are designed, not tested | [08-DESIGN-DEFENSE](../../target-architecture/08-DESIGN-DEFENSE.md), [10-CONTROL-MATRIX](../../target-architecture/10-CONTROL-MATRIX.md) | REAL RUN, DESIGN | M09 |
| 8 | Measured results? | A conventional workflow completed 41 of 42 synthetic cases and passed every hard gate; four bad arms fail; no LLM arm ran; no throughput, latency or availability test exists | [COMPARISON](../../evaluation/agent-runs/COMPARISON.md), [AGENT-EVALUATION-REPORT](../../design/ai/AGENT-EVALUATION-REPORT.md) | MEASURED (synthetic), NOT RUN | M10 |
| 9 | What does it cost? | Base case three-year TCO and a cost per certificate higher than today's labour-only figure; the case rests on disputes and premium protection | [BUSINESS-VALUE-MODEL](../../business/BUSINESS-VALUE-MODEL.md) | SCENARIO | M11 |
| 10 | What decision? | Approve Phase 1a (local, synthetic, no Azure) and an approver; supply volumes, premiums and dispute history; name ports and obtain a legal reading; name a domain reviewer and decide on testing a model | [PHASE-1-BLOCKER-REPORT](../../phase/PHASE-1-BLOCKER-REPORT.md) | DESIGN | M13 |

## Three risks stated unprompted (slide M12)

1. The business case rests on volume nobody has confirmed.
2. Residency is a legal question; no region is verified and no claim is made.
3. AI value and real-model safety are untested.

## What I do not know, and how I would find out

| Unknown | How I would find out |
|---|---|
| Real volumes, premium response, dispute history | Ask the trading head and finance; replace the 79 scenario inputs |
| Which schemes apply and what they accept | Engage a scheme owner or auditor early |
| Meter capabilities, edge connectivity, real failure modes | A pilot cell with a real port |
| Whether a model beats the baseline | An approved model, a reviewer-controlled blind holdout, the pre-registered decision rules |
| The quality manager's real workflow | Shadow the quality manager |

## Concessions to make freely (they are true and they build credibility)

1. The base-case NPV is negative and per-certificate cost rises.
2. Governance and evidence are ahead of the product; the application does not exist.
3. The evaluation is synthetic, author-written, unreviewed, with a holdout that is not blind.

## Reading order

[README](README.md) first; then the [deck](deck/index.html) (press P to present, N for notes); [speaker notes](SPEAKER-NOTES.md); [executive demo](DEMO-EXECUTIVE.md); [deep-dive demos](DEMO-DEEP-DIVE.md); [backup demo](BACKUP-DEMO.md); [Q&A](QA-PANEL-50.md); [rehearsal plan](REHEARSAL-PLAN-AND-SCORECARD.md).
