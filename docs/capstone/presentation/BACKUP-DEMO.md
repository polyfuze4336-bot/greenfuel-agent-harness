# Backup demo: using a recorded genuine run

**Rule.** A recording is never presented as live execution. Say that it is a recording, and when it was made, before or as you start it.

## What a recording is

A recording is the captured output of a genuine earlier execution of the same scenario code. Each file in [recordings/](recordings) holds the lines that run printed, the time it was captured, the git commit that contained the code, the Node version and a SHA-256 of the lines. It was produced by `node harness/demo/run.mjs <scenario> --record`, which runs the scenario live and then saves what it printed. Nothing is typed in by hand.

## How the system prevents a recording being mistaken for a live run

| Safeguard | Where | Tested in |
|---|---|---|
| Replay prints `RECORDED RUN: THIS IS A RECORDING, NOT A LIVE EXECUTION`, the capture time and the commit, in a `#` frame | `harness/demo/recording.mjs` `printReplay` | `tests/demo-pipeline.test.mjs` |
| A live run prints `LIVE EXECUTION in this process, now`; a replay never prints it | same | same |
| Replay refuses if the lines no longer match their hash | `loadRecording` | same |
| The file carries `kind: RECORDED-RUN` and `notLive: true` | `makeRecording` | same |
| A test fails if any scenario has no verifying recording | | same |

These safeguards cover the tool. **They do not control what the presenter says.** That is a behaviour and it has not been verified.

## Commands

| Need | Command |
|---|---|
| Check every recording before presenting | `node harness/demo/run.mjs verify` |
| Replay one | `node harness/demo/run.mjs exec --replay` |
| Make fresh recordings of a good live run | `node harness/demo/run.mjs all --record`, then commit |
| List scenarios | `node harness/demo/run.mjs list` |

## What to say when you switch

> "The live run is not working. What you are about to see is a recording of a genuine run made on [date and time from the banner], from the same code. It is a recording, not a live execution."

Point at the banner when it appears. If asked afterwards whether any part was live, answer accurately.

## What the recordings contain and do not

They contain the output of nine scenarios on candidate oracles with synthetic data and test-only keys. The `azure` recording is the deployment-readiness gate's output (NOT-READY) from that moment. They do **not** contain the platform, any Azure resource, real data, or any language-model run. The `agents` recording contains the conventional baseline and states that the LLM arms are NOT RUN.

## When to re-record

Re-record whenever the pipeline, the oracles or the evaluation change, and before every rehearsal and the panel. A recording names its commit; if the code at your presentation commit differs materially from the recorded commit, say so or re-record. The date in the banner is part of what you say aloud.

## Pre-flight checklist

- [ ] `node harness/demo/run.mjs verify` prints "all recordings verify".
- [ ] A live `exec` run finished with no `[REFUSED]` line, three times, offline.
- [ ] You can state the recording date and commit from the banner.
- [ ] The deck opens offline; a printed or exported PDF exists as a second backup (print the deck from the browser).
- [ ] You have decided in advance what you will say at each fallback rung ([DEMO-EXECUTIVE](DEMO-EXECUTIVE.md)).
