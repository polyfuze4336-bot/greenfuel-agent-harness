# Demonstration: jurisdiction-local evidence store

A live run of the [task-execution framework](./ORCHESTRATION.md) on a sample architecture request. It was run on 2026-10-28 in GitHub Copilot CLI 1.0.105 on Windows, in a throwaway `COPILOT_HOME` that trusts only this repository. VS Code chat was not driven. No Azure or GitHub call was made, no one was signed in, and no resource was created.

**Request:** design a jurisdiction-local evidence store for delivery measurement evidence. The principal architect proposes a design, the security reviewer assesses residency, the architecture critic challenges the assumptions, and the orchestrator consolidates the result.

**Outcome:** the framework ran the whole chain and produced real artifacts and a verified execution trace. The run ended **NEEDS_HUMAN**, not COMPLETED, and the owner then **closed it with the REWORK as the recorded outcome** (event 45), because the independent critic returned **REWORK on the architect's design twice** and the bounded rework allowance was spent. That is the framework working: the design is not approved and nothing in the repository treats it as approved.

## What ran

| Step | Mechanism | Who |
|---|---|---|
| Draft the plan from the request | Native orchestrator agent, validating with the read-only `check_plan` tool. It checked clean on the first call | orchestrator (live) |
| Independent check, then create the run | `tasks.mjs check-plan`, `tasks.mjs init`. The run id comes from the plan hash | operator (me) |
| Delegate T1 to T3 in dependency order | Native `task` delegation. The hook started each attempt and, after each reply, stored it and ran its acceptance tests | orchestrator, delegation hook |
| Review | T3 (critic) is the declared independent review of T1; it ended with a `Verdict:` line the engine parsed | architecture-critic |
| Rework | A human reopened T1 after the first REWORK. The engine reset T2 and T3, archived their replies, and gave T1 one more attempt | operator, engine |
| Consolidate | The orchestrator wrote the consolidation as its final reply. **A human captured it** as T4 with `tasks.mjs submit`; the log records that source | orchestrator, operator |
| Final gate | T4's command check `npm run validate` ran through `tasks.mjs validate` and was recorded as evidence | engine |

The full sequence, with timestamps, actors and hashes, is the generated [TRACE](../state/runs/RUN-afb2a0466e/TRACE.md): 45 events, 10 checkpoints, hash chain verified. Events 43 and 44 are the human-run integrity upgrade described below; event 45 is the owner's decision to close the run. The deterministic summary is the generated [REPORT](../state/runs/RUN-afb2a0466e/REPORT.md).

## Real artifacts

| Artifact | What it is | Status |
|---|---|---|
| [EVIDENCE-STORE-PROPOSAL.md](../design/system/EVIDENCE-STORE-PROPOSAL.md) | The architect's proposal, revision 2, written by the agent into its own write scope | A model-written draft. It labels itself proposed and unverified, and contains no invented SKUs, prices or compliance figures. **Not reviewed or approved by a human; the critic rejected it twice** |
| Security reviews: `T2-a1.md`, `T2-s1.md` | The security reviewer's two replies. The second found no constraint that the proposal demonstrably meets and called the HC-01 and HC-02 verdicts Unresolved or Conditional rather than Satisfied | Captured replies, untrusted |
| Critic challenges: `T3-a1.md`, `T3-s1.md` | Two independent challenges, each ending `Verdict: REWORK`. The second found the proposal cites the wrong decisions for isolation and retention, calls an alternative "not eliminated" only by omission, and rests several constraints on unresolved decisions | Captured replies, untrusted |
| Consolidation: `T4-s1.md` | The orchestrator's report: findings by agent, conflicts, unverified claims, decisions for a human, and what changed between the two passes | Captured reply, untrusted |
| `run.json`, `events.jsonl`, `checkpoints/`, `evidence/` | The durable state, history, snapshots and the command evidence | Engine-written, tamper-evident |

All run files are under `docs/state/runs/RUN-afb2a0466e/`. The first-pass replies were kept, not overwritten, and are still verified.

## What the framework did that a plain delegation would not

- **Refused out-of-order or wrong-agent delegation, and recorded it.** Event 24 is a logged refusal.
- **Judged each reply by tests, not by the reply's own claim.** Every accepted task shows the checks that passed; the critic's verdict was parsed from its text, and REWORK made the run NEEDS_HUMAN instead of letting it complete.
- **Bounded the rework.** The reopen cascade reset only the dependents, kept their earlier replies, and spent T1's last attempt.
- **Kept history reconstructable.** `tasks.mjs verify` re-hashes the chain, the checkpoints and every captured reply, including the archived ones.
- **Ran a real command check.** `npm run validate` ran (exit 0, output hash recorded). The record names HEAD `3a3fcdf` while the working tree had uncommitted changes, which is why the engine now also records `workingTreeDirty`.

## Defects the live run exposed (all fixed, with regression tests)

| Found in the run | Cause | Fix |
|---|---|---|
| A malformed delegation call (missing `name`) was rejected by the tool, yet its attempt had been started. The run showed T1 RUNNING with attempt 2 of 2 spent and nobody working (events 23 to 25) | The pre hook started the attempt before the tool validated its arguments | The hook now denies a tracked call missing `name`, `agent_type` or `prompt` before starting anything (ORCH-ARGS). A human can `release` an orphaned attempt, which refunds it and logs why. I used it for event 25 |
| After a reopen, a reset task would have overwritten its earlier captured reply | Replies were named by attempt number, and attempts restart at zero | Replies are named by a never-resetting submission counter, the earlier generation is archived in `run.json`, and `verify` re-hashes the archive |
| A `no-secret` check on a reply could never fail | Redaction ran before the check | A reply that needed redaction now fails the check |
| A nested `node --test` reports success even when a test fails | It inherits the parent runner's context | Command checks run with that variable removed |
| An independent model review of the framework (after the run) found four more flaws: untracked delegation was allowed while a run was NEEDS_HUMAN; a quoted early `Verdict: ACCEPT` could mask a final REWORK; the state hash left out the plan, order, limits and `policyBlocking`, so one edited field turned a REWORK run into COMPLETED; and `verify` ignored accepted file artifacts | See [ORCHESTRATION](./ORCHESTRATION.md) | Untracked delegation is now denied in ACTIVE, NEEDS_HUMAN and STOPPED runs, and a human ends a run with `tasks.mjs close`; conflicting verdict lines fail the check; the state hash covers the whole run and blocking verdicts come from the policy; `verify` re-hashes accepted files and command evidence, tolerating only line-ending differences. This run was upgraded to the new hash by a logged, human-run checkpoint (events 43 and 44) |

## Limits this run showed

- **No task failed acceptance, so the retry path, error classes, lease expiry, approval pause and task approvals were not exercised live.** They are covered by the automated tests only. The approver registry is empty, so a task approval cannot succeed today.
- **An undeclared file went unnoticed.** The architect also created a scratch file, `EVIDENCE-STORE-PROPOSAL.md.new` (one word, `placeholder`), inside its write scope. The engine tracks declared artifacts only; the critic's glob found it, and I removed it. A framework that must catch such writes needs a before-and-after snapshot of the agent's scope, which is not built.
- **The consolidation was captured by a human**, because an orchestrator-run task has no hook. The engine proves the text was stored and passed its tests; it cannot prove the consolidation is faithful. It cites the replies, which a reader can check.
- **The agent read `run.json` directly with its read tool** as well as calling `get_run_status`. That is allowed and harmless, but shows the state files are visible to agents, not hidden.
- **Content quality is not established.** The tests check structure, citations that exist and a different reviewer. They do not establish that the proposal or either review is correct. The remaining unverified claims are listed in the consolidation and in the proposal's own "Unverified claims" section.
- One pass of one scenario, on one runtime. The two REWORK verdicts are model output and could differ on another run.

## What a human decides next

**Decided 2026-10-28 (T19):** the owner accepted the critic's REWORK as the outcome and stopped; the run is CLOSED and the proposal stays an unapproved draft. Closing approves nothing. Still open, because the reviewers say they block any acceptance of a design like this: the baseline decisions the reviewers say block any acceptance (D-009, D-010, D-011 on residency and hosting; D-013, D-015, D-016, D-018 and others); and whether the documentation rule for links in design files applies. They remain in the decision register.

## Reproduce or verify

```
node harness/scripts/tasks.mjs status --run RUN-afb2a0466e
node harness/scripts/tasks.mjs verify --run RUN-afb2a0466e
node harness/scripts/tasks.mjs trace  --run RUN-afb2a0466e
node harness/scripts/validate-orchestration.mjs
```
